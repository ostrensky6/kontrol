-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida 0110: baixa_manual_embalagens (embalagens fechadas) e as guardas
-- novas de baixa_manual_lote. Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
declare
  uid uuid := md5('kontrol-baixa-0110-tecnico')::uuid;
  v_insumo bigint;
  v_insumo_legado bigint;
begin
  if to_regprocedure('public.baixa_manual_embalagens(bigint,integer,integer,uuid,text)') is null then
    raise exception '0110: RPC baixa_manual_embalagens ausente';
  end if;
  if has_function_privilege('anon', 'public.baixa_manual_embalagens(bigint,integer,integer,uuid,text)', 'EXECUTE') then
    raise exception '0110: anon pode executar baixa_manual_embalagens';
  end if;
  if not has_function_privilege('authenticated', 'public.baixa_manual_embalagens(bigint,integer,integer,uuid,text)', 'EXECUTE') then
    raise exception '0110: authenticated sem EXECUTE em baixa_manual_embalagens';
  end if;
  if has_function_privilege('anon', 'public.baixa_manual_lote(bigint,numeric,text)', 'EXECUTE') then
    raise exception '0110: anon pode executar baixa_manual_lote';
  end if;

  if exists(select 1 from auth.users where id = uid) then
    raise exception '0110: fixture id ja existe';
  end if;
  insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
          'ts-baixa-0110@example.invalid', now(), now());
  update public.perfis set papel = 'laboratorio', suspenso = false where id = uid;
  if not found then raise exception '0110: perfil fixture ausente'; end if;

  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem,
                              fator_conversao, custo_total_embalagem, custo_unitario)
  values ('TS-0110 Kit fechado', 'kit', 'reacao', 100, 100, 500, 5)
  returning id into v_insumo;
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem,
                              fator_conversao, custo_total_embalagem, custo_unitario)
  values ('TS-0110 Reagente legado', 'mL', 'mL', 10, 1, 50, 5)
  returning id into v_insumo_legado;

  -- lote A: 5 embalagens fechadas, aceito, valido
  insert into public.lotes_estoque (
    insumo_id, codigo_lote, validade, quantidade_inicial, quantidade_atual,
    custo_unitario, status, modelo_quantidade, unidade_fisica_snapshot,
    conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot
  ) values (
    v_insumo, 'TS-0110-A', current_date + 30, 5, 5, 500, 'aceito',
    'EMBALAGEM_FECHADA', 'kit', 100, 'reacao', 100
  );
  -- lote B: embalagens fechadas vencido
  insert into public.lotes_estoque (
    insumo_id, codigo_lote, validade, quantidade_inicial, quantidade_atual,
    custo_unitario, status, modelo_quantidade, unidade_fisica_snapshot,
    conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot
  ) values (
    v_insumo, 'TS-0110-B', current_date - 1, 2, 2, 500, 'aceito',
    'EMBALAGEM_FECHADA', 'kit', 100, 'reacao', 100
  );
  -- lote C: legado por volume
  insert into public.lotes_estoque (
    insumo_id, codigo_lote, validade, quantidade_inicial, quantidade_atual,
    custo_unitario, status
  ) values (
    v_insumo_legado, 'TS-0110-C', current_date + 30, 10, 10, 5, 'aceito'
  );
end $$;

-- Resultados observados como authenticated ficam em GUCs locais da transacao
-- (ts0110.*) e sao conferidos depois como owner.
set local role authenticated;
select set_config('request.jwt.claim.sub', md5('kontrol-baixa-0110-tecnico')::uuid::text, true);

do $$
declare
  v_a bigint := (select id from public.lotes_estoque where codigo_lote = 'TS-0110-A');
  v_b bigint := (select id from public.lotes_estoque where codigo_lote = 'TS-0110-B');
  v_c bigint := (select id from public.lotes_estoque where codigo_lote = 'TS-0110-C');
  v_r jsonb;
  v_estado text;
begin
  -- baixa parcial: 2 de 5 embalagens
  v_r := public.baixa_manual_embalagens(v_a, 2, 5,
    '00000000-0000-4000-8000-000000000110'::uuid, 'Perda/quebra: frasco trincado');
  perform set_config('ts0110.parcial', v_r::text, true);

  -- reenvio identico e idempotente
  v_r := public.baixa_manual_embalagens(v_a, 2, 5,
    '00000000-0000-4000-8000-000000000110'::uuid, 'Perda/quebra: frasco trincado');
  perform set_config('ts0110.repetido', v_r::text, true);

  -- mesmo operacao_id com outro payload e recusado
  begin
    perform public.baixa_manual_embalagens(v_a, 1, 3,
      '00000000-0000-4000-8000-000000000110'::uuid, 'Outro');
    raise exception '0110: payload divergente aceito';
  exception when unique_violation then null;
  end;

  -- quantidade esperada desatualizada (concorrencia)
  begin
    perform public.baixa_manual_embalagens(v_a, 1, 5, gen_random_uuid(), 'Consumo em análise');
    raise exception '0110: quantidade esperada desatualizada aceita';
  exception when serialization_failure then null;
  end;

  -- mais que o saldo
  begin
    perform public.baixa_manual_embalagens(v_a, 4, 3, gen_random_uuid(), 'Consumo em análise');
    raise exception '0110: baixa acima do saldo aceita';
  exception when invalid_parameter_value then null;
  end;

  -- lote vencido: desde a 0117 so aceita baixa com o motivo "Vencimento"
  begin
    perform public.baixa_manual_embalagens(v_b, 1, 2, gen_random_uuid(), 'Consumo em análise');
    raise exception '0110: baixa de consumo em lote vencido aceita';
  exception when invalid_parameter_value then null;
  end;

  -- motivo obrigatorio
  begin
    perform public.baixa_manual_embalagens(v_a, 1, 3, gen_random_uuid(), '  ');
    raise exception '0110: baixa sem motivo aceita';
  exception when invalid_parameter_value then null;
  end;

  -- lote legado nao passa pela RPC de embalagens
  begin
    perform public.baixa_manual_embalagens(v_c, 1, 10, gen_random_uuid(), 'Outro: teste');
    raise exception '0110: lote legado aceito na baixa por embalagens';
  exception when invalid_parameter_value then null;
  end;

  -- baixa_manual_lote recusa lote de embalagens fechadas
  begin
    perform public.baixa_manual_lote(v_a, 1, 'Consumo em análise');
    raise exception '0110: baixa_manual_lote aceitou embalagens fechadas';
  exception when invalid_parameter_value then null;
  end;

  -- legado preservado: baixa fracionada leva a em_uso
  perform public.baixa_manual_lote(v_c, 1.5, 'Consumo em análise');
  select status || ':' || quantidade_atual::text into v_estado
  from public.lotes_estoque where id = v_c;
  perform set_config('ts0110.legado', v_estado, true);
end $$;

reset role;

-- reservas ativas (fixture como owner) --------------------------------------
insert into public.reservas_estoque (planejamento_id, insumo_id, lote_id, quantidade, status)
select null, l.insumo_id, l.id, 2, 'reservado'
from public.lotes_estoque l where l.codigo_lote = 'TS-0110-A';
insert into public.reservas_estoque (planejamento_id, insumo_id, lote_id, quantidade, status)
select null, l.insumo_id, l.id, 8, 'reservado'
from public.lotes_estoque l where l.codigo_lote = 'TS-0110-C';

set local role authenticated;
select set_config('request.jwt.claim.sub', md5('kontrol-baixa-0110-tecnico')::uuid::text, true);

do $$
declare
  v_a bigint := (select id from public.lotes_estoque where codigo_lote = 'TS-0110-A');
  v_c bigint := (select id from public.lotes_estoque where codigo_lote = 'TS-0110-C');
begin
  -- saldo 3, reservado 2: baixar 2 invadiria a reserva
  begin
    perform public.baixa_manual_embalagens(v_a, 2, 3, gen_random_uuid(), 'Consumo em análise');
    raise exception '0110: baixa invadiu reserva (embalagens)';
  exception when object_not_in_prerequisite_state then null;
  end;
  -- saldo legado 8,5, reservado 8: baixar 1 invadiria a reserva
  begin
    perform public.baixa_manual_lote(v_c, 1, 'Consumo em análise');
    raise exception '0110: baixa invadiu reserva (legado)';
  exception when object_not_in_prerequisite_state then null;
  end;
  -- 1 embalagem livre pode ser baixada
  perform public.baixa_manual_embalagens(v_a, 1, 3, gen_random_uuid(), 'Consumo em análise');
end $$;

reset role;

do $$
declare
  v_lote public.lotes_estoque%rowtype;
  v_movs integer;
  v_em_maos numeric;
  v_r jsonb;
begin
  select * into v_lote from public.lotes_estoque where codigo_lote = 'TS-0110-A';
  if v_lote.quantidade_atual <> 2 or v_lote.status <> 'aceito' then
    raise exception '0110: lote A deveria ficar aceito com 2 (obtido %/%)', v_lote.status, v_lote.quantidade_atual;
  end if;

  v_r := current_setting('ts0110.parcial')::jsonb;
  if (v_r->>'quantidade_embalagens')::int <> 3 or (v_r->>'repetido')::boolean then
    raise exception '0110: resultado da baixa parcial inesperado: %', v_r;
  end if;
  v_r := current_setting('ts0110.repetido')::jsonb;
  if not (v_r->>'repetido')::boolean then
    raise exception '0110: reenvio nao marcado como repetido: %', v_r;
  end if;

  -- desde a 0117, "Perda/quebra" e gravada como 'ajuste' (fora da previsao de consumo)
  select count(*) into v_movs from public.estoque_movimentacoes
  where lote_id = v_lote.id and tipo in ('saida', 'ajuste') and motivo like 'baixa manual: %';
  if v_movs <> 2 then
    raise exception '0110: esperadas 2 baixas no lote A (obtidas %)', v_movs;
  end if;
  if exists (select 1 from public.estoque_movimentacoes
             where lote_id = v_lote.id and referencia ~ '^plano [0-9]+') then
    raise exception '0110: baixa manual usou referencia de plano';
  end if;

  -- saldo restante continua visivel (bug corrigido: nada vira em_uso):
  -- 2 do lote A + 2 do lote B (vencido, mas ainda em maos)
  select em_maos into v_em_maos from public.v_estoque_saldo where insumo_id = v_lote.insumo_id;
  if v_em_maos <> 4 then
    raise exception '0110: v_estoque_saldo.em_maos deveria ser 4 (obtido %)', v_em_maos;
  end if;

  if current_setting('ts0110.legado') <> 'em_uso:8.5' then
    raise exception '0110: comportamento legado alterado: %', current_setting('ts0110.legado');
  end if;
end $$;

-- zerar o lote marca consumido (reserva liberada como owner)
update public.reservas_estoque set status = 'liberado'
where lote_id = (select id from public.lotes_estoque where codigo_lote = 'TS-0110-A');

set local role authenticated;
select set_config('request.jwt.claim.sub', md5('kontrol-baixa-0110-tecnico')::uuid::text, true);
select public.baixa_manual_embalagens(
  (select id from public.lotes_estoque where codigo_lote = 'TS-0110-A'),
  2, 2, gen_random_uuid(), 'Consumo em análise');
reset role;

do $$
begin
  if (select status from public.lotes_estoque where codigo_lote = 'TS-0110-A') <> 'consumido' then
    raise exception '0110: lote zerado deveria ficar consumido';
  end if;
end $$;

rollback;
