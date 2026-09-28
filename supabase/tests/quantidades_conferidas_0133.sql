-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0133: o pedido de faltas recusa insumo fora do plano e quantidade
-- acima do teto da demanda (e aceita o pedido legitimo); a compra ainda
-- "solicitada" acompanha um ajuste so de embalagem. Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0133-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0133-' || p_rotulo)::uuid,
                      'email', 'ts-0133-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

do $$
declare
  v_uid uuid := md5('kontrol-0133-comprador')::uuid;
  v_ins bigint;
  v_fora bigint;
  v_plano bigint;
  v_compra bigint;
  v_pedido bigint;
  v_item bigint;
begin
  insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
          'ts-0133-comprador@example.invalid', now(), now());
  update public.perfis
     set papel = 'coordenador', suspenso = false, senha_provisoria = false,
         permissoes = '{"pedido.criar": true, "pedido.aprovar": true}'::jsonb
   where id = v_uid;
  if not found then raise exception '0133: perfil fixture ausente'; end if;

  insert into public.analises(codigo, nome) values ('TS-0133', 'Analise teste 0133');
  -- 2 mL por amostra; 10 amostras + 2 controles -> demanda 24 mL; frasco de 100 mL.
  insert into public.insumos(especificacao, unidade, quantidade_embalagem, fator_conversao)
  values ('TS-0133 reagente', 'mL', 100, 1) returning id into v_ins;
  insert into public.insumos(especificacao, unidade) values ('TS-0133 fora do plano', 'un') returning id into v_fora;
  insert into public.insumo_analise(codigo_analise, nome_etapa, nome_atividade, insumo_id, quantidade_por_amostra, modo_cobranca)
  values ('TS-0133', 'Extracao', 'Lise', v_ins, 2, 'por_amostra');
  insert into public.planejamento(nome) values ('TS-0133 plano') returning id into v_plano;
  insert into public.planejamento_itens(planejamento_id, codigo_analise, n_amostras, n_controles)
  values (v_plano, 'TS-0133', 10, 2);

  -- Pedido interno validado cuja compra formal ainda esta "solicitada".
  insert into public.pedidos_compra(status) values ('solicitado') returning id into v_compra;
  perform set_config('app.pedido_interno_transicao', 'permitida', true);
  insert into public.pedidos_internos(titulo, status, pedido_compra_id)
  values ('TS-0133 pedido', 'validado', v_compra) returning id into v_pedido;
  insert into public.pedidos_internos_itens(pedido_interno_id, tipo, insumo_id, especificacao, quantidade,
                                            quantidade_em, conteudo_embalagem)
  values (v_pedido, 'material', v_ins, 'TS-0133 reagente', 2, 'embalagem', 100) returning id into v_item;
  insert into public.pedidos_compra_itens(pedido_id, insumo_id, pedido_interno_item_id, quantidade,
                                          quantidade_em, conteudo_embalagem)
  values (v_compra, v_ins, v_item, 2, 'embalagem', 100);
  -- Ajuste so de embalagem: frasco passa a ter 250 mL.
  update public.pedidos_internos_itens set conteudo_embalagem = 250 where id = v_item;

  perform set_config('t0133.ins', v_ins::text, true);
  perform set_config('t0133.fora', v_fora::text, true);
  perform set_config('t0133.plano', v_plano::text, true);
  perform set_config('t0133.compra', v_compra::text, true);
  perform set_config('t0133.pedido', v_pedido::text, true);
end $$;

set local role authenticated;
select pg_temp.como('comprador');

do $$
declare
  v_ins bigint := current_setting('t0133.ins')::bigint;
  v_fora bigint := current_setting('t0133.fora')::bigint;
  v_plano bigint := current_setting('t0133.plano')::bigint;
  v_res jsonb;
begin
  -- 1. Insumo que nao pertence as analises do plano.
  begin
    perform public.criar_pedido_faltas_planejamento(v_plano, jsonb_build_array(
      jsonb_build_object('insumo_id', v_fora, 'quantidade', 1, 'quantidade_em', 'unidade')));
    raise exception '0133: aceitou insumo fora do plano';
  exception when invalid_parameter_value then
    if sqlerrm not like '%não faz parte%' then raise; end if;
  end;

  -- 2. Quantidade inflada: 5 frascos (500 mL) para uma demanda de 24 mL.
  begin
    perform public.criar_pedido_faltas_planejamento(v_plano, jsonb_build_array(
      jsonb_build_object('insumo_id', v_ins, 'quantidade', 5, 'quantidade_em', 'embalagem', 'conteudo_embalagem', 100)));
    raise exception '0133: aceitou quantidade acima da necessidade do plano';
  exception when invalid_parameter_value then
    if sqlerrm not like '%passa da necessidade%' then raise; end if;
  end;

  -- 3. Pedido legitimo: 1 frasco de 100 mL cobre os 24 mL.
  v_res := public.criar_pedido_faltas_planejamento(v_plano, jsonb_build_array(
    jsonb_build_object('insumo_id', v_ins, 'quantidade', 1, 'quantidade_em', 'embalagem', 'conteudo_embalagem', 100,
                       'especificacao', 'TS-0133 reagente', 'unidade', 'frasco(s) de 100 mL')));
  if coalesce((v_res->>'itens')::int, 0) <> 1 then
    raise exception '0133: pedido legitimo nao gerou o item (resposta %)', v_res;
  end if;
end $$;

-- 4. Formalizar de novo leva o ajuste so de embalagem para a compra solicitada.
do $$
declare
  v_pedido bigint := current_setting('t0133.pedido')::bigint;
begin
  perform public.formalizar_pedido_interno(v_pedido);
end $$;

reset role;

do $$
declare
  v_compra bigint := current_setting('t0133.compra')::bigint;
  v_conteudo numeric;
begin
  select conteudo_embalagem into v_conteudo from public.pedidos_compra_itens where pedido_id = v_compra;
  if v_conteudo is distinct from 250 then
    raise exception '0133: ajuste so de embalagem nao chegou a compra (conteudo %)', v_conteudo;
  end if;
end $$;

rollback;
