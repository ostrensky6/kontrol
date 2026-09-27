-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0130: entrada direta no estoque (sem quarentena), reposicao com
-- prazo total (tramitacao + fornecedor), ponto cadastrado na sugestao, compra
-- atrasada (alerta e aviso semanal) e margem do plano pela proposta aprovada.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0130-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0130-' || p_rotulo)::uuid,
                      'email', 'ts-0130-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

do $$
declare
  v_rotulo text;
  v_forn bigint;
  v_a bigint;
  v_b bigint;
  v_c bigint;
  v_lote bigint;
  v_ped bigint;
  v_dem bigint;
  v_versao bigint;
  v_plano bigint;
begin
  foreach v_rotulo in array array['tecnico', 'coordenador'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0130-' || v_rotulo)::uuid,
            'authenticated', 'authenticated', 'ts-0130-' || v_rotulo || '@example.invalid', now(), now());
    update public.perfis set papel = v_rotulo, suspenso = false, permissoes = '{}'::jsonb
    where id = md5('kontrol-0130-' || v_rotulo)::uuid;
  end loop;

  -- Tramitação na universidade: 60 dias; janela de consumo: 90 dias.
  insert into public.parametros (chave, valor, unidade) values ('prazo_tramitacao_compra_dias', 60, 'dias')
  on conflict (chave) do update set valor = 60;
  insert into public.parametros (chave, valor, unidade) values ('janela_consumo_previsao_dias', 90, 'dias')
  on conflict (chave) do update set valor = 90;

  insert into public.fornecedores (nome, prazo_medio_dias) values ('TS-0130 Fornecedor', 20) returning id into v_forn;

  -- A: frascos, prazo do insumo zerado (cai para os 20 dias do fornecedor),
  -- segurança de 1 frasco; 8 frascos saíram aqui e 1 na baixa do plano (9 em
  -- 90 dias); restam 3.
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao,
                              custo_unitario, fornecedor_id, lead_time_dias, estoque_seguranca)
  values ('TS-0130 Tampao A', 'mL', 'µL', 100, 1000, 5, v_forn, 0, 1) returning id into v_a;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_a, 'TS-0130-A1', 12, 3, 'aceito', current_date + 300, 'EMBALAGEM_FECHADA', 'mL', 100, 'µL', 1000)
  returning id into v_lote;
  insert into public.estoque_movimentacoes (insumo_id, tipo, quantidade, custo_unitario, motivo, lote_id, data)
  values (v_a, 'saida', 8, 500, 'TS-0130 entrega ao laboratorio', v_lote, current_date - 10);

  -- B: sem consumo, ponto de reposição cadastrado 5, disponível 2.
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao,
                              custo_unitario, fornecedor_id, ponto_reposicao)
  values ('TS-0130 Tampao B', 'mL', 'µL', 100, 1000, 5, v_forn, 5) returning id into v_b;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_b, 'TS-0130-B1', 2, 2, 'aceito', current_date + 300, 'EMBALAGEM_FECHADA', 'mL', 100, 'µL', 1000);

  -- C: para a entrada avulsa.
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao, custo_unitario)
  values ('TS-0130 Tampao C', 'mL', 'µL', 100, 1000, 5) returning id into v_c;

  -- Compra de 2 frascos de A pedida há 200 dias, ainda sem aprovação: atrasada.
  insert into public.pedidos_compra (status, solicitante, fornecedor_id, data_solicitacao)
  values ('solicitado', 'ts-0130', v_forn, current_date - 200) returning id into v_ped;
  insert into public.pedidos_compra_itens (pedido_id, insumo_id, quantidade, quantidade_em, conteudo_embalagem, custo_unitario_estimado)
  values (v_ped, v_a, 2, 'embalagem', 100, 500);

  -- Proposta emitida: laboratório custa 1000, projeto 500 do total de 2500.
  insert into public.demandas_propostas (titulo) values ('TS-0130 proposta') returning id into v_dem;
  insert into public.orcamento_final_versoes (demanda_id, versao, numero, status,
    total_laboratorio_custo, total_laboratorio_preco, total_projeto_custo, total_projeto_final, total_final)
  values (v_dem, 1, 'OF-TS-0130-v1', 'emitido', 1000, 1300, 400, 500, 2500) returning id into v_versao;
  insert into public.planejamento (nome, orcamento_final_versao_id, origem_planejamento)
  values ('TS-0130 plano', v_versao, 'orcamento') returning id into v_plano;
  insert into public.estoque_movimentacoes (insumo_id, tipo, quantidade, custo_unitario, motivo, referencia, lote_id)
  values (v_a, 'saida', 1, 300, 'TS-0130 baixa do plano', 'plano ' || v_plano || '; analise X', v_lote);

  perform set_config('t0130.a', v_a::text, true);
  perform set_config('t0130.b', v_b::text, true);
  perform set_config('t0130.c', v_c::text, true);
  perform set_config('t0130.ped', v_ped::text, true);
  perform set_config('t0130.plano', v_plano::text, true);
end $$;

-- ---- Reposição: prazo total, ponto cadastrado e compra atrasada -------------
do $$
declare
  p record;
begin
  select * into p from public.v_previsao_suprimentos where insumo_id = current_setting('t0130.a')::bigint;
  if p.prazo_fornecedor_dias <> 20 or p.prazo_tramitacao_dias <> 60 or p.lead_time_dias <> 80 then
    raise exception '0130: prazo deveria ser 60 + 20 = 80 dias (obtido % + % = %)',
      p.prazo_tramitacao_dias, p.prazo_fornecedor_dias, p.lead_time_dias;
  end if;
  -- necessidade = 0,1/dia x 80 + 1 = 9; 9 − 3 disponíveis − 2 a caminho = 4
  if p.ponto_reposicao_sugerido <> 9 or p.qtd_pedida_aberta <> 2 or p.qtd_sugerida_compra <> 4 then
    raise exception '0130: A deveria pedir 4 (ponto %, a caminho %, sugerido %)',
      p.ponto_reposicao_sugerido, p.qtd_pedida_aberta, p.qtd_sugerida_compra;
  end if;
  if p.qtd_compra_atrasada <> 2 or p.compra_atrasada_desde is null then
    raise exception '0130: compra de A deveria constar como atrasada (obtido % desde %)',
      p.qtd_compra_atrasada, p.compra_atrasada_desde;
  end if;

  select * into p from public.v_previsao_suprimentos where insumo_id = current_setting('t0130.b')::bigint;
  if p.qtd_sugerida_compra <> 3 then
    raise exception '0130: B (ponto cadastrado 5, disponivel 2) deveria pedir 3 (obtido %)', p.qtd_sugerida_compra;
  end if;

  if not exists (select 1 from public.v_alertas_estoque
                 where tipo = 'compra_atrasada' and insumo_id = current_setting('t0130.a')::bigint)
     or not exists (select 1 from public.v_alertas_estoque
                    where tipo = 'reposicao' and insumo_id = current_setting('t0130.b')::bigint) then
    raise exception '0130: alertas de compra atrasada (A) e reposicao (B) deveriam aparecer';
  end if;
  if exists (select 1 from public.v_alertas_estoque where tipo = 'quarentena') then
    raise exception '0130: nao existe mais alerta de quarentena';
  end if;
end $$;

-- Rotina diária (sem sessão, como o cron): rascunhos pelo que falta e aviso de
-- compra atrasada uma vez por semana.
do $$
declare
  r jsonb;
begin
  r := public.gerar_reposicao_automatica();
  if (select sum(i.quantidade) from public.pedidos_compra_itens i join public.pedidos_compra p on p.id = i.pedido_id
      where p.observacao = 'Rascunho automatico de reposicao' and i.insumo_id = current_setting('t0130.a')::bigint) <> 4
     or (select sum(i.quantidade) from public.pedidos_compra_itens i join public.pedidos_compra p on p.id = i.pedido_id
         where p.observacao = 'Rascunho automatico de reposicao' and i.insumo_id = current_setting('t0130.b')::bigint) <> 3 then
    raise exception '0130: rotina deveria pedir 4 de A (mesmo com compra aberta) e 3 de B (obtido %)', r;
  end if;
  if (select count(*) from public.notificacoes
      where titulo = 'Compra atrasada' and entidade_id = current_setting('t0130.ped')::bigint
        and permissao_destino = 'compras.aprovar') <> 1 then
    raise exception '0130: compra atrasada deveria gerar um aviso a quem aprova compras';
  end if;
  r := public.gerar_reposicao_automatica();
  if (r->>'itens_criados')::int <> 0
     or (select count(*) from public.notificacoes
         where titulo = 'Compra atrasada' and entidade_id = current_setting('t0130.ped')::bigint) <> 1 then
    raise exception '0130: segunda rodada no mesmo dia nao deveria repetir pedido nem aviso (obtido %)', r;
  end if;
end $$;

-- ---- Margem do plano pela proposta ------------------------------------------
do $$
declare
  m record;
begin
  select * into m from public.v_margem_real_planejamento where planejamento_id = current_setting('t0130.plano')::bigint;
  if m.receita_origem <> 'proposta' or m.receita_orcada <> 2000 or m.custo_orcado <> 1000
     or m.custo_real_insumos <> 300 or m.margem_real_parcial <> 1700 then
    raise exception '0130: margem deveria usar 2500 − 500 = 2000 de receita e 300 de insumos (obtido % % % % %)',
      m.receita_origem, m.receita_orcada, m.custo_orcado, m.custo_real_insumos, m.margem_real_parcial;
  end if;
end $$;

set local role authenticated;

-- ---- Entrada direta: técnico registra e o material fica disponível ----------
select pg_temp.como('tecnico');
do $$
declare
  v_c bigint := current_setting('t0130.c')::bigint;
  r jsonb;
begin
  r := public.entrada_inventario(v_c, 2, gen_random_uuid(), current_date + 100, 400, 'TS-0130-E1', null, 'doacao');
  if (select status from public.lotes_estoque where id = (r->>'lote_id')::bigint) <> 'aceito'
     or (select disponivel from public.v_estoque_saldo where insumo_id = v_c) <> 2 then
    raise exception '0130: entrada avulsa deveria ficar disponivel na hora (obtido %)', r;
  end if;
  begin
    perform public.entrada_inventario(v_c, 1, gen_random_uuid(), current_date - 1, 400, 'TS-0130-E2', null, 'x');
    raise exception '0130: entrada de material vencido foi aceita';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ---- Página inicial não pede mais aceite de lote ----------------------------
select pg_temp.como('coordenador');
do $$
begin
  if exists (select 1 from jsonb_array_elements(public.aguardando_voce()) e where e->>'chave' = 'lotes_quarentena') then
    raise exception '0130: "Aguardando voce" nao deveria listar lotes em quarentena';
  end if;
end $$;

reset role;
rollback;
