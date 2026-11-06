-- SOMENTE clone sintético local. Exemplo: psql -X -v ON_ERROR_STOP=1
-- -v kontrol_test_local=1 -f supabase/tests/exclusao_por_privilegio_0147.sql
-- Valida a 0147: a exclusão definitiva segue a caixinha de Privilégios, não a
-- função. Insumo com histórico: "Editar insumos". Lote: "Corrigir estoque".
-- Lote de recebimento ainda valendo é recusado; o motivo vai para a
-- auditoria. Tudo termina no ROLLBACK final.
\if :{?kontrol_test_local}
\else
  \echo '0147: falta acknowledgement explícito de banco descartável local.'
  \quit 3
\endif
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';
do $$
begin
  if inet_server_addr() is not null
     and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception '0147: conexão não local.';
  end if;
end $$;

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0147-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', md5('kontrol-0147-' || p_rotulo)::uuid,
    'email', 'ts-0147-' || p_rotulo || '@example.invalid', 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.novo_lote(p_insumo bigint, p_codigo text) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into public.lotes_estoque(insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (p_insumo, p_codigo, 5, 5, 'aceito', current_date + 20, 'EMBALAGEM_FECHADA', 'mL', 100, 'mL', 1)
  returning id into v_id;
  return v_id;
end $$;

do $$
declare
  v_rotulo text;
  v_a bigint;
  v_b bigint;
  v_lote bigint;
  v_lote_compra bigint;
  v_lote_vizinho bigint;
  v_ped bigint;
  v_item bigint;
  v_resultado jsonb;
begin
  -- laboratorio: sem Editar insumos e sem Corrigir estoque (padrão).
  -- cadastro: tem Editar insumos (padrão), não tem Corrigir estoque.
  -- compra com Corrigir estoque marcado individualmente.
  foreach v_rotulo in array array['laboratorio', 'cadastro', 'compra'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0147-' || v_rotulo)::uuid,
      'authenticated', 'authenticated', 'ts-0147-' || v_rotulo || '@example.invalid', now(), now());
    update public.perfis set papel = v_rotulo, suspenso = false, senha_provisoria = false,
      permissoes = case when v_rotulo = 'compra' then '{"estoque.lote.gerir":true}'::jsonb else '{}'::jsonb end
    where id = md5('kontrol-0147-' || v_rotulo)::uuid;
  end loop;

  insert into public.insumos(especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao)
  values ('TS-0147 apagar', 'mL', 'mL', 100, 1) returning id into v_a;
  insert into public.insumos(especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao)
  values ('TS-0147 lotes', 'mL', 'mL', 100, 1) returning id into v_b;
  perform pg_temp.novo_lote(v_a, 'TS-0147-A');
  v_lote := pg_temp.novo_lote(v_b, 'TS-0147-ERRADO');
  v_lote_vizinho := pg_temp.novo_lote(v_b, 'TS-0147-CERTO');
  v_lote_compra := pg_temp.novo_lote(v_b, 'TS-0147-COMPRA');
  insert into public.estoque_movimentacoes(insumo_id, lote_id, tipo, quantidade, motivo)
  values (v_b, v_lote, 'entrada', 5, 'TS-0147'), (v_b, v_lote, 'saida', 1, 'TS-0147'),
         (v_b, v_lote_vizinho, 'entrada', 5, 'TS-0147');
  insert into public.identificadores(codigo, codigo_normalizado, formato, entidade_tipo, entidade_id, origem)
  values ('TS-0147-LOTE', 'TS-0147-LOTE', 'codigo_barras', 'lote', v_lote, 'fabricante');

  insert into public.pedidos_compra(status, solicitante) values ('aprovado', 'ts-0147') returning id into v_ped;
  insert into public.pedidos_compra_itens(pedido_id, insumo_id, quantidade, quantidade_em, conteudo_embalagem, custo_unitario_estimado)
  values (v_ped, v_b, 1, 'embalagem', 100, 200) returning id into v_item;
  update public.pedidos_compra_itens set lote_id = v_lote_compra, quantidade_recebida = 1 where id = v_item;
  insert into public.pedidos_compra_item_recebimentos(pedido_compra_id, pedido_compra_item_id, lote_id, insumo_id, quantidade)
  values (v_ped, v_item, v_lote_compra, v_b, 1);

  -- 1. Insumo com histórico: Laboratório (sem Editar insumos) não apaga.
  perform pg_temp.como('laboratorio');
  begin
    perform public.excluir_insumo_em_cascata(v_a);
    raise exception '0147: laboratório apagou insumo sem Editar insumos';
  exception when insufficient_privilege then null;
  end;

  -- 2. Cadastro (com Editar insumos, sem ser admin) apaga.
  perform pg_temp.como('cadastro');
  v_resultado := public.excluir_insumo_em_cascata(v_a);
  if exists (select 1 from public.insumos where id = v_a)
     or exists (select 1 from public.lotes_estoque where insumo_id = v_a) then
    raise exception '0147: cadastro com Editar insumos não conseguiu apagar: %', v_resultado;
  end if;

  -- 3. Lote: sem Corrigir estoque não apaga (nem a função Cadastro).
  begin
    perform public.excluir_lote_estoque(v_lote, 'digitado errado');
    raise exception '0147: cadastro apagou lote sem Corrigir estoque';
  exception when insufficient_privilege then null;
  end;

  -- 4. Compra com Corrigir estoque marcado: motivo obrigatório; apaga o lote e o histórico dele.
  perform pg_temp.como('compra');
  begin
    perform public.excluir_lote_estoque(v_lote, ' ');
    raise exception '0147: aceitou exclusão sem motivo';
  exception when invalid_parameter_value then null;
  end;
  v_resultado := public.excluir_lote_estoque(v_lote, 'digitado errado');
  if exists (select 1 from public.lotes_estoque where id = v_lote)
     or exists (select 1 from public.estoque_movimentacoes where lote_id = v_lote)
     or exists (select 1 from public.identificadores where entidade_tipo = 'lote' and entidade_id = v_lote) then
    raise exception '0147: sobrou histórico do lote apagado';
  end if;
  if (v_resultado #>> '{removidos,estoque_movimentacoes}')::int <> 2 then
    raise exception '0147: resumo incorreto: %', v_resultado;
  end if;
  if not exists (select 1 from public.auditoria where tabela = 'lotes_estoque'
                 and registro_id = v_lote::text and acao = 'delete' and justificativa = 'digitado errado') then
    raise exception '0147: auditoria sem o motivo da exclusão';
  end if;
  if not exists (select 1 from public.lotes_estoque where id = v_lote_vizinho)
     or (select count(*) from public.estoque_movimentacoes where lote_id = v_lote_vizinho) <> 1 then
    raise exception '0147: a exclusão atingiu outro lote';
  end if;

  -- 5. Lote de compra com recebimento valendo: pede o estorno antes.
  begin
    perform public.excluir_lote_estoque(v_lote_compra, 'digitado errado');
    raise exception '0147: apagou lote com recebimento valendo';
  exception when invalid_parameter_value then null;
  end;

  -- 6. Depois do estorno (marcado aqui direto), o lote pode ser apagado.
  update public.pedidos_compra_item_recebimentos set estornado_em = now(), estornado_por = 'ts-0147'
   where lote_id = v_lote_compra;
  update public.pedidos_compra_itens set lote_id = null, quantidade_recebida = null where id = v_item;
  perform public.excluir_lote_estoque(v_lote_compra, 'estornado e lançado errado');
  if exists (select 1 from public.lotes_estoque where id = v_lote_compra)
     or not exists (select 1 from public.pedidos_compra_itens where id = v_item) then
    raise exception '0147: lote estornado não foi apagado ou o item da compra sumiu';
  end if;

  -- 7. Lote inexistente.
  begin
    perform public.excluir_lote_estoque(v_lote, 'de novo');
    raise exception '0147: aceitou lote inexistente';
  exception when no_data_found then null;
  end;

  raise notice '0147 OK';
end $$;

rollback;
