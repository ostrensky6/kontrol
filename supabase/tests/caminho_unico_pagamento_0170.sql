-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0170 (decisões de 09/11/2026):
--   * D6: pagamento só depois da entrega (materiais recebidos, serviço
--     confirmado), diária paga antes, exceção só com acordo registrado;
--   * marcas de entrega e exceção só pelas RPCs;
--   * D7: a compra ligada é aprovada junto com o pedido interno.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0170-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0170-' || p_rotulo)::uuid,
                      'email', 'ts-0170-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-0170-' || p_rotulo)::uuid
$$;

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception '0170: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception '0170: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

-- pedido já na etapa indicada, com um item do tipo indicado
create function pg_temp.pedido(p_natureza text, p_status text, p_tipo_item text) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa)
  values ('TS-0170 ' || p_natureza, p_status, 'ts-0170-pedinte@example.invalid',
          current_setting('t0170.projeto')::bigint, p_natureza, 'projeto', 'teste')
  returning id into v_id;
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade)
  values (v_id, p_tipo_item, 'TS-0170 item', 1, 'un');
  return v_id;
end $$;

create function pg_temp.pagar(p_pedido bigint) returns void language plpgsql as $$
begin
  perform public.transicionar_pedido_interno(p_pedido, 'aguardando_pagamento_nf', 'Pagamento', 'registrado', null);
end $$;

do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_compra bigint;
  v_pedido bigint;
begin
  foreach v_rotulo in array array['pedinte', 'coord'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-0170-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-0170 ' || v_rotulo,
           papel = case v_rotulo when 'coord' then 'coordenador' else 'laboratorio' end,
           suspenso = false, senha_provisoria = false,
           permissoes = case v_rotulo
             when 'coord' then '{"pedido.criar": true, "pedido.aprovar": true, "recebimento.registrar": true}'::jsonb
             else '{"pedido.criar": true, "pedido.aprovar": false, "recebimento.registrar": false}'::jsonb end
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-0170 projeto', pg_temp.uid('coord')) returning id into v_projeto;
  perform set_config('t0170.projeto', v_projeto::text, true);

  perform set_config('t0170.servico', pg_temp.pedido('servico', 'compra_fechada', 'servico')::text, true);
  perform set_config('t0170.material', pg_temp.pedido('material_consumo_geral', 'encaminhado_instituicao', 'material')::text, true);
  perform set_config('t0170.diaria', pg_temp.pedido('diaria', 'compra_fechada', 'servico')::text, true);
  v_pedido := pg_temp.pedido('material_consumo_geral', 'compra_fechada', 'material');
  update public.pedidos_internos_itens set recebido_em = now(), quantidade_recebida = 1 where pedido_interno_id = v_pedido;
  update public.pedidos_internos set recebido_em = now() where id = v_pedido;
  perform set_config('t0170.recebido', v_pedido::text, true);

  -- D7: compra solicitada ligada a um pedido em aprovação final
  insert into public.pedidos_compra (status, solicitante, projeto_id)
  values ('solicitado', 'ts-0170-pedinte@example.invalid', v_projeto) returning id into v_compra;
  v_pedido := pg_temp.pedido('material_consumo_geral', 'aguardando_aprovacao_final', 'material');
  update public.pedidos_internos set pedido_compra_id = v_compra where id = v_pedido;
  perform set_config('t0170.compra', v_compra::text, true);
  perform set_config('t0170.final', v_pedido::text, true);
end $$;

set local role authenticated;
select pg_temp.como('coord');

-- ---- D6: serviço só paga com entrega confirmada ------------------------------------
select pg_temp.exigir_erro(format('select pg_temp.pagar(%s)', current_setting('t0170.servico')), '22023', 'serviço for prestado');
select pg_temp.exigir_erro(
  format('update public.pedidos_internos set entrega_confirmada_em = now() where id = %s', current_setting('t0170.servico')),
  '42501', 'botões do pedido');

select pg_temp.como('pedinte');
select pg_temp.exigir_erro(
  format('select public.confirmar_entrega_pedido_interno(%s, null)', current_setting('t0170.servico')),
  '42501', 'Registrar recebimento');

select pg_temp.como('coord');
select public.confirmar_entrega_pedido_interno(current_setting('t0170.servico')::bigint, 'Coleta realizada em 08/11');
select pg_temp.exigir_erro(
  format('select public.confirmar_entrega_pedido_interno(%s, null)', current_setting('t0170.servico')),
  '22023', 'já foi confirmada');
select pg_temp.pagar(current_setting('t0170.servico')::bigint);

-- ---- D6: material só paga recebido; exceção só com acordo registrado -------------
do $$
begin
  if public.pendencia_pagamento_pedido_interno(current_setting('t0170.material')::bigint) not like '%recebimento%' then
    raise exception '0170: pendência de pagamento do material não explicada';
  end if;
end $$;
select pg_temp.exigir_erro(format('select pg_temp.pagar(%s)', current_setting('t0170.material')), '22023', 'recebimento');
select pg_temp.exigir_erro(
  format('select public.confirmar_entrega_pedido_interno(%s, null)', current_setting('t0170.material')),
  '22023', 'sem recebimento');
select pg_temp.exigir_erro(
  format('select public.registrar_excecao_pagamento(%s, ''curto'')', current_setting('t0170.material')),
  '22023', 'Descreva o acordo');
select public.registrar_excecao_pagamento(current_setting('t0170.material')::bigint,
  'Fundação exige pagamento antecipado pelo convênio 12/2026, acordado com Antonio');
select pg_temp.pagar(current_setting('t0170.material')::bigint);

-- material recebido paga; diária paga antes da viagem
select pg_temp.pagar(current_setting('t0170.recebido')::bigint);
select pg_temp.pagar(current_setting('t0170.diaria')::bigint);

-- ---- D7: a compra ligada é aprovada junto com o pedido -----------------------------
select public.transicionar_pedido_interno(current_setting('t0170.final')::bigint, 'aprovado_para_compra', 'Aprovação final', 'aprovado', null);

reset role;
do $$
declare
  v_compra bigint := current_setting('t0170.compra')::bigint;
begin
  if (select status from public.pedidos_internos where id = current_setting('t0170.servico')::bigint) <> 'aguardando_pagamento_nf'
     or (select entrega_confirmada_por from public.pedidos_internos where id = current_setting('t0170.servico')::bigint)
        <> 'ts-0170-coord@example.invalid'
     or not exists (select 1 from public.pedidos_internos_aprovacoes
                     where pedido_interno_id = current_setting('t0170.servico')::bigint
                       and etapa = 'Entrega confirmada (serviço prestado)' and comentario = 'Coleta realizada em 08/11') then
    raise exception '0170: confirmação de entrega não ficou registrada';
  end if;
  if (select excecao_pagamento_por from public.pedidos_internos where id = current_setting('t0170.material')::bigint)
       <> 'ts-0170-coord@example.invalid'
     or not exists (select 1 from public.pedidos_internos_aprovacoes
                     where pedido_interno_id = current_setting('t0170.material')::bigint
                       and etapa like 'Exceção: pagamento antes da entrega%') then
    raise exception '0170: exceção de pagamento não ficou registrada';
  end if;
  if (select status from public.pedidos_compra where id = v_compra) <> 'aprovado'
     or (select aprovador from public.pedidos_compra where id = v_compra) <> 'ts-0170-coord@example.invalid'
     or not exists (select 1 from public.eventos_status
                     where entidade = 'pedido_compra' and entidade_id = v_compra
                       and para_status = 'aprovado' and observacao like 'Aprovada junto com o pedido interno%') then
    raise exception '0170: compra ligada não foi aprovada junto com o pedido';
  end if;
  if exists (select 1 from public.auditoria
              where tabela = 'pedidos_internos' and registro_id = current_setting('t0170.material')
                and valor_novo ->> 'excecao_pagamento' is not null) is not true then
    raise exception '0170: exceção de pagamento fora da auditoria';
  end if;
end $$;

rollback;
