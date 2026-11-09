-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0171 (decisão D2 de 09/11/2026: toda compra tem 3 orçamentos):
--   * só quem conduz a compra registra orçamentos, e só nas etapas de cotação;
--   * "Cotações recebidas" exige 3 fornecedores diferentes;
--   * a aprovação final exige um orçamento escolhido; fora do menor valor,
--     com justificativa; a escolha só pela RPC e vai para a compra ligada.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0171-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0171-' || p_rotulo)::uuid,
                      'email', 'ts-0171-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-0171-' || p_rotulo)::uuid
$$;

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception '0171: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception '0171: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

create function pg_temp.cotar(p_fornecedor text, p_valor numeric, p_fornecedor_id bigint default null) returns bigint
language plpgsql as $$
declare v_id bigint;
begin
  insert into public.pedidos_internos_cotacoes (pedido_interno_id, fornecedor_id, fornecedor_nome, valor_total, prazo_entrega_dias)
  values (current_setting('t0171.pedido')::bigint, p_fornecedor_id, p_fornecedor, p_valor, 10)
  returning id into v_id;
  return v_id;
end $$;

do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_compra bigint;
  v_pedido bigint;
  v_fornecedor bigint;
begin
  foreach v_rotulo in array array['pedinte', 'compras'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-0171-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-0171 ' || v_rotulo,
           papel = case v_rotulo when 'compras' then 'coordenador' else 'laboratorio' end,
           suspenso = false, senha_provisoria = false,
           permissoes = case v_rotulo
             when 'compras' then '{"pedido.criar": true, "pedido.aprovar": true}'::jsonb
             else '{"pedido.criar": true, "pedido.aprovar": false}'::jsonb end
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-0171 projeto', pg_temp.uid('compras')) returning id into v_projeto;
  insert into public.fornecedores (nome) values ('TS-0171 Fornecedor Caro') returning id into v_fornecedor;
  insert into public.pedidos_compra (status, solicitante, projeto_id)
  values ('solicitado', 'ts-0171-pedinte@example.invalid', v_projeto) returning id into v_compra;
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa, pedido_compra_id)
  values ('TS-0171 pedido', 'orcamentos', 'ts-0171-pedinte@example.invalid', v_projeto,
          'material_consumo_geral', 'projeto', 'teste', v_compra)
  returning id into v_pedido;
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade)
  values (v_pedido, 'material', 'TS-0171 item', 1, 'un');

  perform set_config('t0171.pedido', v_pedido::text, true);
  perform set_config('t0171.compra', v_compra::text, true);
  perform set_config('t0171.fornecedor', v_fornecedor::text, true);
end $$;

set local role authenticated;

-- ---- quem registra -------------------------------------------------------------------
select pg_temp.como('pedinte');
select pg_temp.exigir_erro('select pg_temp.cotar(''Loja A'', 100)', '42501', 'row-level security');

select pg_temp.como('compras');
select pg_temp.cotar('Loja A', 100);
select pg_temp.cotar('Loja B', 120);
select pg_temp.exigir_erro('select pg_temp.cotar(''  loja a '', 90)', '23505', 'fornecedor_unico');
select pg_temp.exigir_erro(
  format('insert into public.pedidos_internos_cotacoes (pedido_interno_id, fornecedor_nome, valor_total, escolhida) values (%s, ''Loja X'', 50, true)',
         current_setting('t0171.pedido')),
  '42501', 'botão');

-- ---- 3 orçamentos para "Cotações recebidas" --------------------------------------------
select pg_temp.exigir_erro(
  format('select public.transicionar_pedido_interno(%s, ''orcamentos_recebidos'', ''Cotações recebidas'', ''registrado'', null)',
         current_setting('t0171.pedido')),
  '22023', 'tem 2');
select set_config('t0171.caro', pg_temp.cotar('TS-0171 Fornecedor Caro', 150, current_setting('t0171.fornecedor')::bigint)::text, true);
select public.transicionar_pedido_interno(current_setting('t0171.pedido')::bigint, 'orcamentos_recebidos', 'Cotações recebidas', 'registrado', null);

-- ---- escolha antes da aprovação final -------------------------------------------------
select pg_temp.exigir_erro(
  format('select public.transicionar_pedido_interno(%s, ''aguardando_aprovacao_final'', ''Aprovação final'', ''registrado'', null)',
         current_setting('t0171.pedido')),
  '22023', 'Escolha um dos orçamentos');
select pg_temp.exigir_erro(
  format('update public.pedidos_internos_cotacoes set escolhida = true where id = %s', current_setting('t0171.caro')),
  '42501', 'botão');
select pg_temp.exigir_erro(
  format('select public.escolher_orcamento_pedido_interno(%s, null)', current_setting('t0171.caro')),
  '22023', 'mais barato');

select pg_temp.como('pedinte');
select pg_temp.exigir_erro(
  format('select public.escolher_orcamento_pedido_interno(%s, ''Prazo de entrega menor e garantia'')', current_setting('t0171.caro')),
  '42501', 'Aprovar pedidos internos');

select pg_temp.como('compras');
select public.escolher_orcamento_pedido_interno(current_setting('t0171.caro')::bigint,
  'Único com entrega em 10 dias e garantia de 2 anos');
select pg_temp.exigir_erro(
  format('delete from public.pedidos_internos_cotacoes where id = %s', current_setting('t0171.caro')),
  '22023', 'escolhido não pode ser removido');
select public.transicionar_pedido_interno(current_setting('t0171.pedido')::bigint, 'aguardando_aprovacao_final', 'Aprovação final', 'registrado', null);

-- fechada a cotação, orçamento não entra mais
select pg_temp.exigir_erro('select pg_temp.cotar(''Loja C'', 80)', '22023', 'só entram ou mudam');

reset role;
do $$
declare
  v_pedido bigint := current_setting('t0171.pedido')::bigint;
  v_resumo jsonb := kontrol_private.resumo_orcamentos(current_setting('t0171.pedido')::bigint);
begin
  if (v_resumo ->> 'fornecedores')::integer <> 3
     or (v_resumo ->> 'escolhida_id')::bigint <> current_setting('t0171.caro')::bigint
     or (v_resumo ->> 'menor_valor')::numeric <> 100 then
    raise exception '0171: resumo dos orçamentos errado: %', v_resumo;
  end if;
  if (select escolhida_por from public.pedidos_internos_cotacoes where id = current_setting('t0171.caro')::bigint)
       <> 'ts-0171-compras@example.invalid'
     or (select registrada_por from public.pedidos_internos_cotacoes where id = current_setting('t0171.caro')::bigint)
       <> 'ts-0171-compras@example.invalid' then
    raise exception '0171: quem registrou ou escolheu não ficou gravado';
  end if;
  if not exists (select 1 from public.pedidos_internos_aprovacoes
                  where pedido_interno_id = v_pedido and etapa = 'Orçamento escolhido'
                    and comentario like 'TS-0171 Fornecedor Caro: R$ 150,00 — Único com entrega%') then
    raise exception '0171: escolha do orçamento fora das aprovações';
  end if;
  if (select fornecedor_id from public.pedidos_compra where id = current_setting('t0171.compra')::bigint)
       is distinct from current_setting('t0171.fornecedor')::bigint then
    raise exception '0171: fornecedor escolhido não chegou à compra ligada';
  end if;
  if (select status from public.pedidos_internos where id = v_pedido) <> 'aguardando_aprovacao_final' then
    raise exception '0171: pedido não seguiu para a aprovação final';
  end if;
  if not exists (select 1 from public.auditoria where tabela = 'pedidos_internos_cotacoes') then
    raise exception '0171: orçamentos fora da auditoria';
  end if;
end $$;

rollback;
