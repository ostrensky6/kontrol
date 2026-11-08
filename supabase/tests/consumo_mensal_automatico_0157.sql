-- SOMENTE clone sintético local. Valida a 0157: consumo mensal calculado,
-- confiança, consumo de referência e exclusão em cascata com estimativa
-- manual. Termina em ROLLBACK.
\if :{?kontrol_test_local}
\else
  \echo '0157: falta acknowledgement explícito de banco descartável local.'
  \quit 3
\endif
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $$
begin
  if inet_server_addr() is not null
     and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception '0157: conexão não local.';
  end if;
end $$;

do $$
declare
  v_admin uuid := md5('kontrol-0157-admin')::uuid;
  v_mes date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  v_a bigint; v_b bigint; v_c bigint; v_d bigint; v_vizinho bigint;
  v_r jsonb; v_lista jsonb; v_res jsonb;
  k integer;
begin
  insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
          'ts-0157-admin@example.invalid', now(), now());
  update public.perfis set papel = 'admin', suspenso = false, senha_provisoria = false where id = v_admin;

  insert into public.insumos(especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao)
  values ('TS-0157 regular', 'mL', 'mL', 100, 1) returning id into v_a;
  insert into public.insumos(especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao)
  values ('TS-0157 recente', 'mL', 'mL', 100, 1) returning id into v_b;
  insert into public.insumos(especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao)
  values ('TS-0157 parado', 'mL', 'mL', 100, 1) returning id into v_c;
  insert into public.insumos(especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao)
  values ('TS-0157 sem embalagem', 'g', 'g', null, 1) returning id into v_d;
  insert into public.insumos(especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao)
  values ('TS-0157 vizinho', 'mL', 'mL', 100, 1) returning id into v_vizinho;

  -- A: 8 meses completos com 200 mL (2 embalagens) por mês, um ajuste e
  -- uma saída no mês corrente (que ainda não fechou e não entra).
  for k in 1..8 loop
    insert into public.estoque_movimentacoes(insumo_id, tipo, quantidade, data, motivo)
    values (v_a, 'saida', 200, (v_mes - make_interval(months => k) + interval '10 days')::date, 'fixture 0157');
  end loop;
  insert into public.estoque_movimentacoes(insumo_id, tipo, quantidade, data, motivo)
  values (v_a, 'ajuste', 50, (v_mes - interval '2 months' + interval '3 days')::date, 'fixture 0157'),
         (v_a, 'saida', 900, v_mes, 'fixture 0157');
  -- B: só dois meses de histórico, com estimativa manual de 5 embalagens.
  insert into public.estoque_movimentacoes(insumo_id, tipo, quantidade, data, motivo)
  values (v_b, 'saida', 100, (v_mes - interval '2 months' + interval '5 days')::date, 'fixture 0157'),
         (v_b, 'saida', 300, (v_mes - interval '1 month' + interval '5 days')::date, 'fixture 0157');
  insert into kontrol_private.consumo_manual_insumos(insumo_id, revisao, operacao_id, quantidade_embalagens_mes,
    conteudo_embalagem, unidade_conteudo, fonte, motivo, data_referencia, ator_id)
  values (v_b, 1, gen_random_uuid(), 5, 100, 'mL', 'fixture 0157', 'teste', current_date, v_admin),
         (v_a, 1, gen_random_uuid(), 9, 100, 'mL', 'fixture 0157', 'teste', current_date, v_admin),
         (v_vizinho, 1, gen_random_uuid(), 1, 100, 'mL', 'fixture 0157', 'teste', current_date, v_admin);
  -- D: sem conteúdo de embalagem; o cálculo fica na unidade do cadastro.
  for k in 1..3 loop
    insert into public.estoque_movimentacoes(insumo_id, tipo, quantidade, data, motivo)
    values (v_d, 'saida', 30, (v_mes - make_interval(months => k) + interval '1 day')::date, 'fixture 0157');
  end loop;

  -- Sem sessão: recusado.
  begin
    perform public.consumo_mensal_insumo(v_a);
    raise exception '0157: leitura sem sessão foi aceita';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated',
    'email', 'ts-0157-admin@example.invalid')::text, true);
  set local role authenticated;

  v_r := public.consumo_mensal_insumo(v_a);
  if v_r ->> 'unidade' <> 'embalagem' or (v_r ->> 'meses_historico')::int <> 8
     or (v_r ->> 'meses_com_saida')::int <> 8 or (v_r ->> 'media_mensal')::numeric <> 2
     or (v_r ->> 'ajustes')::int <> 1 or v_r ->> 'confianca' <> 'alta'
     or v_r -> 'referencia' ->> 'origem' <> 'calculado' or (v_r -> 'referencia' ->> 'valor')::numeric <> 2
     or (v_r -> 'manual' ->> 'valor')::numeric <> 9 then
    raise exception '0157: insumo regular calculado errado: %', v_r;
  end if;
  if v_r -> 'meses' -> 0 ->> 'mes' <> to_char(v_mes - interval '1 month', 'YYYY-MM') then
    raise exception '0157: mês corrente entrou ou ordem errada: %', v_r -> 'meses';
  end if;

  v_r := public.consumo_mensal_insumo(v_b);
  if v_r ->> 'confianca' <> 'baixa' or (v_r ->> 'media_mensal')::numeric <> 2
     or v_r -> 'referencia' ->> 'origem' <> 'manual' or (v_r -> 'referencia' ->> 'valor')::numeric <> 5 then
    raise exception '0157: histórico curto deveria usar a estimativa manual: %', v_r;
  end if;

  v_r := public.consumo_mensal_insumo(v_c);
  if v_r ->> 'confianca' <> 'sem_dados' or v_r -> 'referencia' ->> 'origem' <> 'nenhuma'
     or v_r -> 'media_mensal' <> 'null'::jsonb then
    raise exception '0157: insumo sem movimento deveria ficar sem dados: %', v_r;
  end if;

  v_r := public.consumo_mensal_insumo(v_d);
  if v_r ->> 'unidade' <> 'g' or (v_r ->> 'media_mensal')::numeric <> 30 or v_r ->> 'confianca' <> 'media'
     or v_r -> 'referencia' ->> 'origem' <> 'calculado' then
    raise exception '0157: insumo sem conteúdo de embalagem calculado errado: %', v_r;
  end if;

  v_lista := public.consumo_mensal_insumos(array[v_a, v_b, v_c, v_d, -1]);
  if jsonb_array_length(v_lista) <> 4 then
    raise exception '0157: lista deveria ignorar insumo inexistente: %', v_lista;
  end if;

  -- Exclusão em cascata com estimativa manual: apaga o insumo e só a dele.
  v_res := public.excluir_insumo_em_cascata(v_a);
  reset role;

  if exists (select 1 from public.insumos where id = v_a) then
    raise exception '0157: insumo com estimativa manual não foi excluído';
  end if;
  if (v_res -> 'removidos' ->> 'consumo_manual_insumos')::int is distinct from 1 then
    raise exception '0157: resumo sem a estimativa apagada: %', v_res;
  end if;
  if not exists (select 1 from kontrol_private.consumo_manual_insumos where insumo_id = v_vizinho) then
    raise exception '0157: a exclusão apagou a estimativa do vizinho';
  end if;
end $$;

rollback;
