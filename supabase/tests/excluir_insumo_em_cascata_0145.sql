-- SOMENTE clone sintético local. Exemplo: psql -X -v ON_ERROR_STOP=1
-- -v kontrol_test_local=1 -f supabase/tests/excluir_insumo_em_cascata_0145.sql
-- Valida a 0145: só admin apaga em cascata; a exclusão simples continua
-- bloqueada; a cascata remove o insumo e todo o histórico dele (inclusive
-- compra já recebida), sem tocar em outro insumo, e deixa a auditoria.
-- Tudo termina no ROLLBACK final.
\if :{?kontrol_test_local}
\else
  \echo '0145: falta acknowledgement explícito de banco descartável local.'
  \quit 3
\endif
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';
do $$
begin
  if inet_server_addr() is not null
     and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception '0145: conexão não local.';
  end if;
end $$;

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0145-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', md5('kontrol-0145-' || p_rotulo)::uuid,
    'email', 'ts-0145-' || p_rotulo || '@example.invalid', 'role', 'authenticated')::text, true);
end $$;

do $$
declare
  v_rotulo text;
  v_a bigint;
  v_outro bigint;
  v_lote bigint;
  v_lote_outro bigint;
  v_ped bigint;
  v_item bigint;
  v_item_outro bigint;
  v_resultado jsonb;
  v_n bigint;
begin
  foreach v_rotulo in array array['admin', 'tecnico'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0145-' || v_rotulo)::uuid,
      'authenticated', 'authenticated', 'ts-0145-' || v_rotulo || '@example.invalid', now(), now());
    update public.perfis set papel = v_rotulo, suspenso = false, senha_provisoria = false,
      permissoes = case when v_rotulo = 'tecnico' then '{"insumos.editar":true}'::jsonb else '{}'::jsonb end
    where id = md5('kontrol-0145-' || v_rotulo)::uuid;
  end loop;

  insert into public.insumos(especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao)
  values ('TS-0145 com histórico', 'mL', 'mL', 100, 1) returning id into v_a;
  insert into public.insumos(especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao)
  values ('TS-0145 vizinho', 'mL', 'mL', 100, 1) returning id into v_outro;

  insert into public.lotes_estoque(insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_a, 'TS-0145-A', 5, 5, 'aceito', current_date + 20, 'EMBALAGEM_FECHADA', 'mL', 100, 'mL', 1)
  returning id into v_lote;
  insert into public.lotes_estoque(insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_outro, 'TS-0145-B', 5, 5, 'aceito', current_date + 20, 'EMBALAGEM_FECHADA', 'mL', 100, 'mL', 1)
  returning id into v_lote_outro;

  insert into public.estoque_movimentacoes(insumo_id, lote_id, tipo, quantidade, motivo)
  values (v_a, v_lote, 'entrada', 5, 'TS-0145'), (v_a, v_lote, 'saida', 1, 'TS-0145'),
         (v_outro, v_lote_outro, 'entrada', 5, 'TS-0145');
  insert into public.identificadores(codigo, codigo_normalizado, formato, entidade_tipo, entidade_id, origem)
  values ('TS-0145-COD-A', 'TS-0145-COD-A', 'codigo_barras', 'insumo', v_a, 'fabricante'),
         ('TS-0145-COD-B', 'TS-0145-COD-B', 'codigo_barras', 'insumo', v_outro, 'fabricante');

  -- Compra já recebida: o item tem lote e quantidade recebida e um recebimento.
  insert into public.pedidos_compra(status, solicitante) values ('aprovado', 'ts-0145') returning id into v_ped;
  insert into public.pedidos_compra_itens(pedido_id, insumo_id, quantidade, quantidade_em, conteudo_embalagem, custo_unitario_estimado)
  values (v_ped, v_a, 3, 'embalagem', 100, 200) returning id into v_item;
  insert into public.pedidos_compra_itens(pedido_id, insumo_id, quantidade, quantidade_em, conteudo_embalagem, custo_unitario_estimado)
  values (v_ped, v_outro, 1, 'embalagem', 100, 200) returning id into v_item_outro;
  update public.pedidos_compra_itens set lote_id = v_lote, quantidade_recebida = 3 where id = v_item;
  insert into public.pedidos_compra_item_recebimentos(pedido_compra_id, pedido_compra_item_id, lote_id, insumo_id, quantidade)
  values (v_ped, v_item, v_lote, v_a, 3);

  -- Exclusão simples continua bloqueada pela 0144.
  begin
    delete from public.insumos where id = v_a;
    raise exception '0145: exclusão simples não foi bloqueada';
  exception when foreign_key_violation then null;
  end;

  -- Técnico com insumos.editar não apaga em cascata.
  perform pg_temp.como('tecnico');
  begin
    perform public.excluir_insumo_em_cascata(v_a);
    raise exception '0145: técnico apagou em cascata';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.como('admin');
  v_resultado := public.excluir_insumo_em_cascata(v_a);

  if exists (select 1 from public.insumos where id = v_a) then
    raise exception '0145: insumo continua no banco';
  end if;
  if exists (select 1 from public.lotes_estoque where insumo_id = v_a)
     or exists (select 1 from public.estoque_movimentacoes where insumo_id = v_a or lote_id = v_lote)
     or exists (select 1 from public.pedidos_compra_itens where id = v_item)
     or exists (select 1 from public.pedidos_compra_item_recebimentos where pedido_compra_item_id = v_item)
     or exists (select 1 from public.identificadores where entidade_tipo = 'insumo' and entidade_id = v_a) then
    raise exception '0145: sobrou histórico do insumo apagado';
  end if;
  if (v_resultado #>> '{removidos,estoque_movimentacoes}')::int <> 2
     or (v_resultado #>> '{removidos,lotes_estoque}')::int <> 1
     or (v_resultado #>> '{removidos,pedidos_compra_itens}')::int <> 1
     or (v_resultado #>> '{removidos,pedidos_compra_item_recebimentos}')::int <> 1 then
    raise exception '0145: resumo de removidos incorreto: %', v_resultado;
  end if;

  -- O vizinho e a compra ficam intactos.
  select count(*) into v_n from public.estoque_movimentacoes where insumo_id = v_outro;
  if v_n <> 1 or not exists (select 1 from public.lotes_estoque where id = v_lote_outro)
     or not exists (select 1 from public.pedidos_compra_itens where id = v_item_outro)
     or not exists (select 1 from public.identificadores where entidade_tipo = 'insumo' and entidade_id = v_outro)
     or not exists (select 1 from public.pedidos_compra where id = v_ped) then
    raise exception '0145: a cascata atingiu outro insumo ou a compra';
  end if;

  -- Insumo inexistente.
  begin
    perform public.excluir_insumo_em_cascata(v_a);
    raise exception '0145: aceitou insumo inexistente';
  exception when no_data_found then null;
  end;

  raise notice '0145 OK: %', v_resultado;
end $$;

rollback;
