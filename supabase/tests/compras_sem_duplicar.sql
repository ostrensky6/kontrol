-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Provas negativas do fluxo de compras (revisão do plano em 10/11/2026, pontos 4 e 7):
--   * reenviar e formalizar de novo um pedido devolvido não cria segunda compra
--     nem repete os itens da compra;
--   * repetir o mesmo recebimento não cria segundo lote, segundo registro no
--     livro nem aumenta o estoque;
--   * recebimento parcial não vira total: o item e o pedido seguem em aberto, o
--     pagamento continua travado, não se recebe além do pedido e item completo
--     não recebe de novo.
-- Não valida migration nova: prova o comportamento que já existe.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- a trava do ciclo depende do dia de hoje: aqui todo ciclo já está aberto.
create or replace function kontrol_private.hoje_brasilia() returns date
  language sql stable set search_path = '' as $$ select date '2999-12-01' $$;

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-dup-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-dup-' || p_rotulo)::uuid,
                      'email', 'ts-dup-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-dup-' || p_rotulo)::uuid
$$;

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'sem duplicar: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception 'sem duplicar: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_pedido bigint;
  v_insumo bigint;
begin
  foreach v_rotulo in array array['pedinte', 'coord', 'nath'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-dup-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-DUP ' || v_rotulo,
           papel = case v_rotulo when 'pedinte' then 'laboratorio' when 'nath' then 'compra' else 'coordenador' end,
           suspenso = false, senha_provisoria = false,
           permissoes = case v_rotulo
             when 'pedinte' then '{"pedido.criar": true, "recebimento.registrar": false}'::jsonb
             else '{"pedido.criar": true, "pedido.aprovar": true, "compras.aprovar": true, "recebimento.registrar": true}'::jsonb end
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-DUP projeto', pg_temp.uid('coord')) returning id into v_projeto;
  if to_regclass('kontrol_private.projetos_vinculos') is not null then
    execute 'insert into kontrol_private.projetos_vinculos (projeto_id, usuario_id) values ($1, $2) on conflict do nothing'
      using v_projeto, pg_temp.uid('coord');
  end if;
  insert into public.insumos (especificacao, unidade, fator_conversao, custo_unitario)
  values ('TS-DUP kit de extração', 'un', 1, 0) returning id into v_insumo;
  perform set_config('tdup.insumo', v_insumo::text, true);

  -- a: percorre envio, validação, formalização, devolução e reenvio
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa, urgencia)
  values ('TS-DUP pedido a', 'rascunho', 'ts-dup-pedinte@example.invalid', v_projeto,
          'material_consumo_geral', 'projeto', 'Extração das amostras de campo', 'normal')
  returning id into v_pedido;
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade, orcamento_previo, insumo_id)
  values (v_pedido, 'material', 'TS-DUP kit', 2, 'un', 150, v_insumo);
  perform set_config('tdup.a', v_pedido::text, true);

  -- r: já comprado, esperando a chegada de 4 unidades
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa, urgencia)
  values ('TS-DUP pedido r', 'compra_fechada', 'ts-dup-pedinte@example.invalid', v_projeto,
          'material_consumo_geral', 'projeto', 'Extração das amostras de campo', 'normal')
  returning id into v_pedido;
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade, orcamento_previo, insumo_id)
  values (v_pedido, 'material', 'TS-DUP kit', 4, 'un', 150, v_insumo);
  perform set_config('tdup.r', v_pedido::text, true);
  perform set_config('tdup.r_item', (select id::text from public.pedidos_internos_itens where pedido_interno_id = v_pedido), true);

  update public.responsaveis_compras set usuario_id = pg_temp.uid('nath'), substituto_id = null where etapa = 'administrativo';
end $$;

-- ==== 1. Reenvio e nova formalização não criam segunda compra =============================
set local role authenticated;
select pg_temp.como('pedinte');
select public.transicionar_pedido_interno(current_setting('tdup.a')::bigint, 'em_validacao', 'Envio', 'registrado', null);
select pg_temp.como('coord');
select public.transicionar_pedido_interno(current_setting('tdup.a')::bigint, 'validado', 'Validação', 'aprovado', null);

select pg_temp.como('nath');
do $$
declare
  v_a bigint := current_setting('tdup.a')::bigint;
  v_r jsonb;
begin
  v_r := public.formalizar_pedido_interno(v_a);
  if (v_r ->> 'pedido_compra_id') is null or coalesce((v_r ->> 'retomada')::boolean, false) then
    raise exception 'sem duplicar: a primeira formalização deveria criar a compra: %', v_r;
  end if;
  perform set_config('tdup.compra', v_r ->> 'pedido_compra_id', true);
end $$;
select public.registrar_etapa_pedido_interno(current_setting('tdup.a')::bigint, 'analise_administrativa', 'Análise', 'registrado', null,
  '{"fonte_recurso": "Projeto", "rubrica": "Material de consumo", "conformidade_admin": "ok"}'::jsonb);
select public.transicionar_pedido_interno(current_setting('tdup.a')::bigint, 'ajuste_compras', 'Análise', 'devolvido', 'Anexe o orçamento prévio.');

select pg_temp.como('pedinte');
do $$
declare
  v_a bigint := current_setting('tdup.a')::bigint;
  v_r jsonb := public.reenviar_pedido_interno(v_a, 'Orçamento anexado.');
begin
  if not (v_r ->> 'aprovacoes_mantidas')::boolean then
    raise exception 'sem duplicar: reenvio sem mudança deveria manter as aprovações: %', v_r;
  end if;
end $$;

select pg_temp.como('nath');
do $$
declare
  v_a bigint := current_setting('tdup.a')::bigint;
  v_r jsonb := public.formalizar_pedido_interno(v_a);
begin
  if (v_r ->> 'pedido_compra_id') is distinct from current_setting('tdup.compra')
     or not coalesce((v_r ->> 'retomada')::boolean, false) then
    raise exception 'sem duplicar: formalizar de novo deveria retomar a compra % e não criar outra: %',
      current_setting('tdup.compra'), v_r;
  end if;
end $$;

reset role;
do $$
declare
  v_a bigint := current_setting('tdup.a')::bigint;
  v_compra bigint := current_setting('tdup.compra')::bigint;
  v_compras integer;
  v_itens integer;
begin
  select count(*) into v_compras from public.pedidos_compra c
   where c.projeto_id = (select projeto_id from public.pedidos_internos where id = v_a);
  select count(*) into v_itens from public.pedidos_compra_itens where pedido_id = v_compra;
  if v_compras <> 1 then
    raise exception 'sem duplicar: o projeto deveria ter 1 compra depois do reenvio, tem %', v_compras;
  end if;
  if v_itens <> 1 then
    raise exception 'sem duplicar: a compra deveria ter 1 item depois do reenvio, tem %', v_itens;
  end if;
  if (select pedido_compra_id from public.pedidos_internos where id = v_a) <> v_compra then
    raise exception 'sem duplicar: o pedido deveria continuar ligado à mesma compra';
  end if;
  if exists (select 1 from public.lotes_estoque where insumo_id = current_setting('tdup.insumo')::bigint) then
    raise exception 'sem duplicar: reenvio e formalização não podem criar lote em estoque';
  end if;
end $$;

-- ==== 2. Repetir o mesmo recebimento não repete lote, livro nem estoque ====================
set local role authenticated;
select pg_temp.como('pedinte');
select pg_temp.exigir_erro(
  format('select public.receber_item_pedido_interno(%s, %s, %s, 1, gen_random_uuid())',
    current_setting('tdup.r'), current_setting('tdup.r_item'), current_setting('tdup.insumo')),
  '42501', 'recebimento.registrar');

select pg_temp.como('nath');
do $$
declare
  v_r bigint := current_setting('tdup.r')::bigint;
  v_item bigint := current_setting('tdup.r_item')::bigint;
  v_insumo bigint := current_setting('tdup.insumo')::bigint;
  v_op uuid := md5('kontrol-dup-op-1')::uuid;
  v_lote1 bigint;
  v_lote2 bigint;
begin
  v_lote1 := public.receber_item_pedido_interno(v_r, v_item, v_insumo, 1, v_op, current_date + 300, 150, 'TS-DUP-L1');
  v_lote2 := public.receber_item_pedido_interno(v_r, v_item, v_insumo, 1, v_op, current_date + 300, 150, 'TS-DUP-L1');
  if v_lote1 is distinct from v_lote2 then
    raise exception 'sem duplicar: o mesmo envio deveria devolver o mesmo lote (% e %)', v_lote1, v_lote2;
  end if;
  perform set_config('tdup.lote1', v_lote1::text, true);
end $$;

-- o mesmo envio com outra quantidade é recusado, não somado
select pg_temp.exigir_erro(
  format('select public.receber_item_pedido_interno(%s, %s, %s, 2, %L::uuid, current_date + 300, 150, ''TS-DUP-L1'')',
    current_setting('tdup.r'), current_setting('tdup.r_item'), current_setting('tdup.insumo'), md5('kontrol-dup-op-1')::uuid),
  '23505', 'payload diferente');

reset role;
do $$
declare
  v_r bigint := current_setting('tdup.r')::bigint;
  v_item bigint := current_setting('tdup.r_item')::bigint;
  v_insumo bigint := current_setting('tdup.insumo')::bigint;
  v_lotes integer;
  v_livro integer;
  v_em_maos numeric;
  i record;
begin
  select count(*) into v_lotes from public.lotes_estoque where insumo_id = v_insumo;
  select count(*) into v_livro from public.pedidos_internos_item_recebimentos where pedido_interno_item_id = v_item;
  select em_maos into v_em_maos from public.v_estoque_saldo where insumo_id = v_insumo;
  if v_lotes <> 1 or v_livro <> 1 or v_em_maos <> 1 then
    raise exception 'sem duplicar: envio repetido deveria deixar 1 lote, 1 registro e saldo 1 (lotes %, livro %, saldo %)',
      v_lotes, v_livro, v_em_maos;
  end if;

  -- ==== 3. Parcial não vira total =========================================================
  select * into i from public.pedidos_internos_itens where id = v_item;
  if i.quantidade_recebida <> 1 or i.recebido_em is not null then
    raise exception 'sem duplicar: 1 de 4 recebido não fecha o item (recebida %, recebido_em %)',
      i.quantidade_recebida, i.recebido_em;
  end if;
  if (select recebido_em from public.pedidos_internos where id = v_r) is not null then
    raise exception 'sem duplicar: pedido com item parcial não pode constar como recebido';
  end if;
  if public.pendencia_pagamento_pedido_interno(v_r) not like '%recebimento%' then
    raise exception 'sem duplicar: recebimento parcial deveria manter o pagamento travado: %',
      public.pendencia_pagamento_pedido_interno(v_r);
  end if;
end $$;

set local role authenticated;
select pg_temp.como('nath');
-- não se recebe além do que foi pedido (faltam 3)
select pg_temp.exigir_erro(
  format('select public.receber_item_pedido_interno(%s, %s, %s, 4, gen_random_uuid(), current_date + 300, 150, ''TS-DUP-L2'')',
    current_setting('tdup.r'), current_setting('tdup.r_item'), current_setting('tdup.insumo')),
  '22023', 'excede o saldo pendente');
select public.receber_item_pedido_interno(current_setting('tdup.r')::bigint, current_setting('tdup.r_item')::bigint,
  current_setting('tdup.insumo')::bigint, 3, md5('kontrol-dup-op-2')::uuid, current_date + 300, 150, 'TS-DUP-L2');
-- item completo não recebe de novo, nem com um envio novo
select pg_temp.exigir_erro(
  format('select public.receber_item_pedido_interno(%s, %s, %s, 1, gen_random_uuid(), current_date + 300, 150, ''TS-DUP-L3'')',
    current_setting('tdup.r'), current_setting('tdup.r_item'), current_setting('tdup.insumo')),
  '22023', 'Item ja recebido');

reset role;
do $$
declare
  v_r bigint := current_setting('tdup.r')::bigint;
  v_item bigint := current_setting('tdup.r_item')::bigint;
  v_insumo bigint := current_setting('tdup.insumo')::bigint;
  i record;
begin
  select * into i from public.pedidos_internos_itens where id = v_item;
  if i.quantidade_recebida <> 4 or i.recebido_em is null then
    raise exception 'sem duplicar: 4 de 4 recebido deveria fechar o item (recebida %, recebido_em %)',
      i.quantidade_recebida, i.recebido_em;
  end if;
  if (select em_maos from public.v_estoque_saldo where insumo_id = v_insumo) <> 4 then
    raise exception 'sem duplicar: o saldo deveria ser 4 depois dos dois recebimentos';
  end if;
  if (select count(*) from public.pedidos_internos_item_recebimentos where pedido_interno_item_id = v_item) <> 2 then
    raise exception 'sem duplicar: o livro deveria ter 2 recebimentos';
  end if;
  if (select recebido_em from public.pedidos_internos where id = v_r) is null then
    raise exception 'sem duplicar: com todos os itens recebidos o pedido deveria constar como recebido';
  end if;
end $$;

rollback;
