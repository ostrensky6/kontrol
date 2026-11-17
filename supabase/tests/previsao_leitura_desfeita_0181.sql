-- SOMENTE clone sintético local. Valida a 0181: o consumo da previsão de
-- suprimentos (Repor) desconta a leitura desfeita como a ficha do insumo
-- (0167), nunca fica negativo, e a view guarda colunas, filtro de ativo e
-- security_invoker. Termina em ROLLBACK.
\if :{?kontrol_test_local}
\else
  \echo '0181: falta acknowledgement explícito de banco descartável local.'
  \quit 3
\endif
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $$
begin
  if inet_server_addr() is not null
     and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception '0181: conexão não local.';
  end if;
end $$;

-- ---- 1. A devolução da leitura abate a saída ---------------------------------
do $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_janela integer := coalesce((select p.valor::integer from public.parametros p
                                where p.chave = 'janela_consumo_previsao_dias'), 90);
  v_a bigint;
  v_b bigint;
  v_c bigint;
  v_lote bigint;
  r record;
begin
  -- A: duas aberturas por leitura, uma desfeita, e um ajuste comum de inventário
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao)
  values ('TS-0181 frasco A', 'mL', 'mL', 100, 1) returning id into v_a;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_a, 'TS-0181-A1', 5, 4, 'aceito', current_date + 100, 'EMBALAGEM_FECHADA', 'mL', 100, 'mL', 1)
  returning id into v_lote;
  insert into public.estoque_movimentacoes (insumo_id, tipo, quantidade, data, motivo, lote_id) values
    (v_a, 'saida', 1, v_hoje - 3, 'abertura de embalagem', v_lote),
    (v_a, 'saida', 1, v_hoje - 2, 'abertura de embalagem', v_lote),
    (v_a, 'ajuste', 1, v_hoje - 2, 'leitura desfeita: abertura de embalagem', v_lote),
    (v_a, 'ajuste', 2, v_hoje - 1, 'inventário', v_lote);
  select * into r from public.v_previsao_suprimentos where insumo_id = v_a;
  if not found then
    raise exception '0181: insumo de teste deveria aparecer na previsão';
  end if;
  if r.consumo_janela <> 1 then
    raise exception '0181: a leitura desfeita deveria abater a saída (consumo %, esperado 1)', r.consumo_janela;
  end if;
  if round(r.consumo_medio_diario, 8) <> round(1::numeric / v_janela, 8) then
    raise exception '0181: consumo médio diário deveria sair do consumo líquido (%)', r.consumo_medio_diario;
  end if;

  -- B: só a devolução na janela (a saída ficou fora dela): nunca negativo
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao)
  values ('TS-0181 frasco B', 'mL', 'mL', 100, 1) returning id into v_b;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_b, 'TS-0181-B1', 5, 5, 'aceito', current_date + 100, 'EMBALAGEM_FECHADA', 'mL', 100, 'mL', 1)
  returning id into v_lote;
  insert into public.estoque_movimentacoes (insumo_id, tipo, quantidade, data, motivo, lote_id) values
    (v_b, 'saida', 1, v_hoje - v_janela - 5, 'abertura de embalagem', v_lote),
    (v_b, 'ajuste', 1, v_hoje - 1, 'leitura desfeita: abertura de embalagem', v_lote);
  select * into r from public.v_previsao_suprimentos where insumo_id = v_b;
  if r.consumo_janela <> 0 or r.consumo_medio_diario <> 0 or r.dias_cobertura is not null then
    raise exception '0181: consumo só com devolução deveria ser zero (consumo %, médio %, cobertura %)',
      r.consumo_janela, r.consumo_medio_diario, r.dias_cobertura;
  end if;
  if r.qtd_sugerida_compra < 0 then
    raise exception '0181: quantidade sugerida negativa (%)', r.qtd_sugerida_compra;
  end if;

  -- C: saídas sem nada desfeito e outros ajustes continuam como antes
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao)
  values ('TS-0181 frasco C', 'mL', 'mL', 100, 1) returning id into v_c;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_c, 'TS-0181-C1', 9, 6, 'aceito', current_date + 100, 'EMBALAGEM_FECHADA', 'mL', 100, 'mL', 1)
  returning id into v_lote;
  insert into public.estoque_movimentacoes (insumo_id, tipo, quantidade, data, motivo, lote_id) values
    (v_c, 'saida', 2, v_hoje - 10, 'abertura de embalagem', v_lote),
    (v_c, 'saida', 1, v_hoje - 4, 'uso em análise', v_lote),
    (v_c, 'ajuste', 4, v_hoje - 4, 'leitura desfeita: entrada por código de barras', v_lote),
    (v_c, 'ajuste', 1, v_hoje - 3, 'inventário', v_lote);
  select * into r from public.v_previsao_suprimentos where insumo_id = v_c;
  if r.consumo_janela <> 3 then
    raise exception '0181: só a devolução de abertura desconta; saídas comuns contam inteiras (consumo %, esperado 3)',
      r.consumo_janela;
  end if;

  -- insumo inativo continua fora da previsão (0144)
  update public.insumos set ativo = false where id = v_c;
  if exists (select 1 from public.v_previsao_suprimentos where insumo_id = v_c) then
    raise exception '0181: insumo inativo não deveria aparecer na previsão';
  end if;
end $$;

-- ---- 2. A view guarda o contrato ---------------------------------------------
do $$
declare
  v_colunas text;
begin
  select string_agg(a.attname, ',' order by a.attnum) into v_colunas
  from pg_attribute a
  where a.attrelid = 'public.v_previsao_suprimentos'::regclass and a.attnum > 0 and not a.attisdropped;
  if v_colunas <> 'insumo_id,especificacao,unidade,disponivel,em_maos,reservado,ponto_reposicao_configurado,estoque_seguranca,lead_time_dias,janela_dias,consumo_janela,consumo_medio_diario,dias_cobertura,ponto_reposicao_sugerido,qtd_sugerida_compra,qtd_pedida_aberta,fornecedor_id,fornecedor_nome,custo_unitario,categoria_compra,unidade_saldo,prazo_fornecedor_dias,prazo_tramitacao_dias,qtd_compra_atrasada,compra_atrasada_desde,qtd_pedida_pendente,qtd_reposicao_pendente' then
    raise exception '0181: colunas da previsão mudaram (%)', v_colunas;
  end if;
  if not exists (
    select 1 from pg_class c
    where c.oid = 'public.v_previsao_suprimentos'::regclass
      and c.reloptions @> array['security_invoker=true']
  ) then
    raise exception '0181: a previsão deveria continuar com security_invoker';
  end if;
  if not has_table_privilege('authenticated', 'public.v_previsao_suprimentos', 'select') then
    raise exception '0181: authenticated deveria continuar lendo a previsão';
  end if;
  -- os alertas leem a previsão: continuam respondendo
  perform count(*) from public.v_alertas_estoque;
end $$;

rollback;
\echo '0181: previsão desconta leitura desfeita OK'
