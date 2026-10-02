-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0143: vinculo de codigo pela triagem e registro de leituras (colunas
-- antigas), entrada e saida por leitura (FEFO, reserva, vencido, sem
-- embalagem), repeticao idempotente, desfazer, recebimento pelo pedido,
-- auditoria e inventario por insumo. Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0143-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0143-' || p_rotulo)::uuid,
                      'email', 'ts-0143-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

do $$
declare
  v_rotulo text;
  v_a bigint;
  v_b bigint;
  v_legado bigint;
  v_ped bigint;
  v_item bigint;
  v_plano bigint;
  v_lote_reservado bigint;
begin
  foreach v_rotulo in array array['tecnico', 'tecnico2', 'coordenador'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0143-' || v_rotulo)::uuid,
            'authenticated', 'authenticated', 'ts-0143-' || v_rotulo || '@example.invalid', now(), now());
    update public.perfis set papel = case when v_rotulo like 'tecnico%' then 'tecnico' else v_rotulo end,
                             suspenso = false, permissoes = '{}'::jsonb
    where id = md5('kontrol-0143-' || v_rotulo)::uuid;
  end loop;

  -- A: frascos de 100 mL; lote antigo sem validade, lote que vence antes e
  -- lote que vence depois.
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao,
                              custo_total_embalagem, custo_unitario)
  values ('TS-0143 Tampao A', 'mL', 'µL', 100, 1000, 300, 3) returning id into v_a;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values
    (v_a, 'TS-0143-A-SEMVAL', 2, 2, 'aceito', null, 'EMBALAGEM_FECHADA', 'mL', 100, 'µL', 1000),
    (v_a, 'TS-0143-A-DEPOIS', 2, 2, 'aceito', current_date + 200, 'EMBALAGEM_FECHADA', 'mL', 100, 'µL', 1000),
    (v_a, 'TS-0143-A-ANTES', 1, 1, 'aceito', current_date + 20, 'EMBALAGEM_FECHADA', 'mL', 100, 'µL', 1000),
    (v_a, 'TS-0143-A-VENCIDO', 3, 3, 'aceito', current_date - 1, 'EMBALAGEM_FECHADA', 'mL', 100, 'µL', 1000);

  -- B: 1 frasco, todo reservado para um plano.
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao,
                              custo_total_embalagem, custo_unitario)
  values ('TS-0143 Kit B', 'kit', 'reacao', 50, 1, 500, 10) returning id into v_b;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_b, 'TS-0143-B1', 1, 1, 'aceito', current_date + 100, 'EMBALAGEM_FECHADA', 'kit', 50, 'reacao', 1)
  returning id into v_lote_reservado;
  insert into public.planejamento (nome) values ('TS-0143 plano') returning id into v_plano;
  insert into public.reservas_estoque (planejamento_id, insumo_id, lote_id, quantidade, status)
  values (v_plano, v_b, v_lote_reservado, 1, 'reservado');

  -- Legado por volume.
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao, custo_unitario)
  values ('TS-0143 Legado', 'mL', 'mL', 10, 1, 1) returning id into v_legado;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status)
  values (v_legado, 'TS-0143-L1', 10, 10, 'aceito');

  -- Compra aprovada de 3 frascos de A.
  insert into public.pedidos_compra (status, solicitante) values ('aprovado', 'ts-0143') returning id into v_ped;
  insert into public.pedidos_compra_itens (pedido_id, insumo_id, quantidade, quantidade_em, conteudo_embalagem, custo_unitario_estimado)
  values (v_ped, v_a, 3, 'embalagem', 100, 280) returning id into v_item;

  perform set_config('t0143.a', v_a::text, true);
  perform set_config('t0143.b', v_b::text, true);
  perform set_config('t0143.legado', v_legado::text, true);
  perform set_config('t0143.ped', v_ped::text, true);
  perform set_config('t0143.item', v_item::text, true);
end $$;

-- ---- Colunas antigas: vinculo e registro de leitura gravam sem tipo/valor ----
do $$
begin
  insert into public.identificadores (codigo, codigo_normalizado, formato, entidade_tipo, entidade_id, origem)
  values ('7891234567895', '7891234567895', 'codigo_barras', 'insumo', current_setting('t0143.a')::bigint, 'fabricante');
  if (select tipo || '|' || valor from public.identificadores where codigo_normalizado = '7891234567895') <> 'codigo_barras|7891234567895' then
    raise exception '0143: tipo/valor do identificador deveriam ser completados';
  end if;
  insert into public.scan_eventos (codigo, acao, resultado) values ('TS-0143-LIDO', 'buscar', 'nao_encontrado');
  if (select valor_lido from public.scan_eventos where codigo = 'TS-0143-LIDO') <> 'TS-0143-LIDO' then
    raise exception '0143: valor_lido deveria ser completado';
  end if;
  if not exists (select 1 from public.auditoria where tabela = 'identificadores' and valor_novo->>'codigo' = '7891234567895') then
    raise exception '0143: vinculo de codigo deveria entrar na auditoria';
  end if;
end $$;

set local role authenticated;

-- ---- Saida por leitura: FEFO, vencido fora, sem escolher lote ----------------
select pg_temp.como('tecnico');
do $$
declare
  v_a bigint := current_setting('t0143.a')::bigint;
  op uuid := gen_random_uuid();
  r jsonb;
  r2 jsonb;
begin
  r := public.abrir_embalagem_por_leitura(v_a, '7891234567895', op);
  if r->>'codigo_lote' <> 'TS-0143-A-ANTES' or (r->>'fechadas')::numeric <> 7 then
    raise exception '0143: a saida deveria abrir o lote que vence antes (obtido %)', r;
  end if;
  -- repeticao do mesmo envio nao baixa de novo
  r2 := public.abrir_embalagem_por_leitura(v_a, '7891234567895', op);
  if (r2->>'repetido')::boolean is not true
     or (select sum(quantidade_atual) from public.lotes_estoque where insumo_id = v_a and status = 'aceito') <> 7 then
    raise exception '0143: repetir a mesma leitura nao deveria baixar de novo (obtido %)', r2;
  end if;
  r := public.abrir_embalagem_por_leitura(v_a, '7891234567895', gen_random_uuid());
  if r->>'codigo_lote' <> 'TS-0143-A-DEPOIS' then
    raise exception '0143: depois do lote que vence antes, sai o proximo com validade (obtido %)', r;
  end if;
  if not exists (select 1 from public.estoque_movimentacoes
                 where insumo_id = v_a and tipo = 'saida' and usuario = 'ts-0143-tecnico@example.invalid') then
    raise exception '0143: a saida deveria registrar o usuario na movimentacao';
  end if;
  if (select count(*) from public.scan_eventos where acao = 'saida_leitura' and entidade_id = v_a) <> 2 then
    raise exception '0143: cada saida deveria ficar registrada como leitura';
  end if;
  perform set_config('t0143.op_saida', op::text, true);
end $$;

-- ---- Reservado, sem embalagem e legado: avisa e nao registra -----------------
do $$
begin
  begin
    perform public.abrir_embalagem_por_leitura(current_setting('t0143.b')::bigint, 'B', gen_random_uuid());
    raise exception '0143: embalagem toda reservada nao deveria sair';
  exception when invalid_parameter_value then
    if sqlerrm not like '%reservadas%' then raise; end if;
  end;
  begin
    perform public.abrir_embalagem_por_leitura(current_setting('t0143.legado')::bigint, 'L', gen_random_uuid());
    raise exception '0143: insumo legado nao deveria sair por leitura';
  exception when invalid_parameter_value then null;
  end;
  if (select quantidade_atual from public.lotes_estoque where codigo_lote = 'TS-0143-B1') <> 1 then
    raise exception '0143: lote reservado nao deveria mudar';
  end if;
end $$;

-- ---- Desfazer: so quem leu; depois a abertura volta --------------------------
select pg_temp.como('tecnico2');
do $$
begin
  perform public.desfazer_leitura_estoque(current_setting('t0143.op_saida')::uuid);
  raise exception '0143: outro tecnico nao deveria desfazer a leitura';
exception when insufficient_privilege then null;
end $$;

select pg_temp.como('tecnico');
do $$
declare
  r jsonb;
begin
  r := public.desfazer_leitura_estoque(current_setting('t0143.op_saida')::uuid);
  if (select quantidade_atual || status from public.lotes_estoque where codigo_lote = 'TS-0143-A-ANTES') <> '1aceito' then
    raise exception '0143: desfazer a saida deveria devolver a embalagem (obtido %)', r;
  end if;
  r := public.desfazer_leitura_estoque(current_setting('t0143.op_saida')::uuid);
  if (r->>'repetido')::boolean is not true
     or (select quantidade_atual from public.lotes_estoque where codigo_lote = 'TS-0143-A-ANTES') <> 1 then
    raise exception '0143: desfazer duas vezes nao deveria devolver duas embalagens';
  end if;
end $$;

-- ---- Entrada por leitura: lote interno, validade, desfazer -------------------
do $$
declare
  v_a bigint := current_setting('t0143.a')::bigint;
  op uuid := gen_random_uuid();
  r jsonb;
  v_lote bigint;
begin
  r := public.registrar_entrada_por_leitura(v_a, 2, current_date + 300, null, '7891234567895', op);
  v_lote := (r->>'lote_id')::bigint;
  if (select status || '|' || quantidade_atual || '|' || validade || '|' || modelo_quantidade
        from public.lotes_estoque where id = v_lote)
     <> 'aceito|2|' || (current_date + 300) || '|EMBALAGEM_FECHADA'
     or r->>'codigo_lote' not like 'LEIT-%' then
    raise exception '0143: entrada por leitura deveria criar lote interno liberado com validade (obtido %)', r;
  end if;
  if (public.registrar_entrada_por_leitura(v_a, 2, current_date + 300, null, '7891234567895', op)->>'repetido')::boolean is not true
     or (select count(*) from public.lotes_estoque where insumo_id = v_a and codigo_lote like 'LEIT-%') <> 1 then
    raise exception '0143: repetir a mesma entrada nao deveria criar outro lote';
  end if;
  r := public.desfazer_leitura_estoque(op);
  if (select status || quantidade_atual from public.lotes_estoque where id = v_lote) <> 'descartado0' then
    raise exception '0143: desfazer a entrada deveria zerar o lote criado';
  end if;
  -- vencido nao entra
  begin
    perform public.registrar_entrada_por_leitura(v_a, 1, current_date - 1, null, '7891234567895', gen_random_uuid());
    raise exception '0143: entrada vencida foi aceita';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ---- Recebimento pelo pedido: sem lancamento duplo ---------------------------
select pg_temp.como('coordenador');
do $$
declare
  v_a bigint := current_setting('t0143.a')::bigint;
  r jsonb;
begin
  r := public.registrar_recebimento_por_leitura(
    v_a, current_setting('t0143.ped')::bigint, current_setting('t0143.item')::bigint,
    2, current_date + 250, null, '7891234567895', gen_random_uuid());
  if (select quantidade_recebida from public.pedidos_compra_itens where id = current_setting('t0143.item')::bigint) <> 2
     or (select count(*) from public.pedidos_compra_item_recebimentos where pedido_compra_item_id = current_setting('t0143.item')::bigint) <> 1
     or (select status from public.lotes_estoque where id = (r->>'lote_id')::bigint) <> 'aceito' then
    raise exception '0143: a entrada pelo pedido deveria receber o item e liberar o lote (obtido %)', r;
  end if;
end $$;

-- ---- Inventario por insumo ----------------------------------------------------
do $$
declare
  v_a bigint := current_setting('t0143.a')::bigint;
  v_ciclo bigint;
  v_contagem bigint;
  v_sistema numeric;
begin
  insert into public.inventario_ciclos (nome) values ('TS-0143 ciclo') returning id into v_ciclo;
  select sum(quantidade_atual) into v_sistema from public.lotes_estoque
  where insumo_id = v_a and modelo_quantidade = 'EMBALAGEM_FECHADA' and status = 'aceito';
  insert into public.inventario_contagens (ciclo_id, insumo_id, quantidade_sistema, quantidade_contada, divergencia, justificativa)
  values (v_ciclo, v_a, v_sistema, v_sistema - 1, -1, 'frasco quebrado') returning id into v_contagem;
  perform public.aplicar_ajuste_inventario_contagem(v_contagem);
  if (select sum(quantidade_atual) from public.lotes_estoque
      where insumo_id = v_a and modelo_quantidade = 'EMBALAGEM_FECHADA' and status = 'aceito') <> v_sistema - 1 then
    raise exception '0143: ajuste por insumo deveria tirar 1 embalagem';
  end if;
  begin
    insert into public.inventario_contagens (ciclo_id, quantidade_sistema, quantidade_contada, divergencia)
    values (v_ciclo, 1, 1, 0);
    raise exception '0143: contagem sem lote e sem insumo foi aceita';
  exception when check_violation then null;
  end;
end $$;

reset role;

do $$
begin
  if not exists (select 1 from public.auditoria
                 where tabela = 'estoque_movimentacoes' and valor_novo->>'motivo' like 'leitura desfeita%') then
    raise exception '0143: movimentacoes deveriam entrar na auditoria';
  end if;
end $$;

rollback;
