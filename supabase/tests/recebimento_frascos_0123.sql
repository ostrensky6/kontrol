-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0123: compra em frascos e recebimento no modelo do insumo, sem
-- misturar frascos com volume. Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_uid uuid := md5('kontrol-0123-coordenador')::uuid;
  v_frasco bigint;
  v_volume bigint;
  v_ped bigint;
begin
  insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
          'ts-0123-coordenador@example.invalid', now(), now());
  update public.perfis set papel = 'coordenador', suspenso = false where id = v_uid;

  -- Insumo novo, sem lotes: contado em frascos de 100 mL
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao, custo_unitario)
  values ('TS-0123 Tampao 100 mL', 'mL', 'µL', 100, 1000, 5) returning id into v_frasco;
  -- Insumo com lote antigo por volume ainda com saldo
  insert into public.insumos (especificacao, unidade, quantidade_embalagem, fator_conversao, custo_unitario)
  values ('TS-0123 Etanol 1 L', 'mL', 1000, 1, 0.1) returning id into v_volume;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status)
  values (v_volume, 'TS-0123-ANTIGO', 500, 500, 'aceito');

  insert into public.pedidos_compra (status, solicitante) values ('enviado', 'ts-0123') returning id into v_ped;
  -- sem quantidade_em: segue o modelo do insumo
  insert into public.pedidos_compra_itens (pedido_id, insumo_id, quantidade, custo_unitario_estimado)
  values (v_ped, v_frasco, 3, 500), (v_ped, v_volume, 2000, 0.1);
  -- explicitamente em frascos para o insumo por volume
  insert into public.pedidos_compra_itens (pedido_id, insumo_id, quantidade, custo_unitario_estimado, quantidade_em)
  values (v_ped, v_volume, 2, 100, 'embalagem');
  -- item antigo em mL para o insumo contado em frascos
  insert into public.pedidos_compra_itens (pedido_id, insumo_id, quantidade, custo_unitario_estimado, quantidade_em)
  values (v_ped, v_frasco, 300, 5, 'unidade');

  if (select quantidade_em from public.pedidos_compra_itens where pedido_id = v_ped and insumo_id = v_frasco and quantidade = 3) <> 'embalagem'
     or (select conteudo_embalagem from public.pedidos_compra_itens where pedido_id = v_ped and insumo_id = v_frasco and quantidade = 3) <> 100 then
    raise exception '0123: item sem unidade de insumo em frascos deveria ficar em embalagem de 100';
  end if;
  if (select quantidade_em from public.pedidos_compra_itens where pedido_id = v_ped and insumo_id = v_volume and quantidade = 2000) <> 'unidade' then
    raise exception '0123: item de insumo por volume deveria ficar em unidade';
  end if;

  -- Previsao: 3 frascos + 300 mL (= 3 frascos) em aberto para o insumo em frascos
  if (select qtd_pedida_aberta from public.v_previsao_suprimentos where insumo_id = v_frasco) <> 6 then
    raise exception '0123: previsao deveria converter o aberto para frascos (obtido %)',
      (select qtd_pedida_aberta from public.v_previsao_suprimentos where insumo_id = v_frasco);
  end if;
  -- insumo por volume: 2000 mL + 2 frascos de 1000 mL = 4000 mL
  if (select qtd_pedida_aberta from public.v_previsao_suprimentos where insumo_id = v_volume) <> 4000 then
    raise exception '0123: previsao deveria converter frascos para mL no insumo por volume';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', md5('kontrol-0123-coordenador')::uuid::text, true);
select set_config('request.jwt.claims',
  json_build_object('sub', md5('kontrol-0123-coordenador')::uuid, 'email', 'ts-0123-coordenador@example.invalid',
                    'role', 'authenticated')::text, true);

do $$
declare
  v_ped bigint := (select max(id) from public.pedidos_compra where solicitante = 'ts-0123');
  v_frasco bigint := (select id from public.insumos where especificacao = 'TS-0123 Tampao 100 mL');
  v_volume bigint := (select id from public.insumos where especificacao = 'TS-0123 Etanol 1 L');
  v_item bigint;
  v_lote bigint;
  l public.lotes_estoque%rowtype;
begin
  -- 2 frascos do insumo em frascos → lote de embalagens fechadas
  select id into v_item from public.pedidos_compra_itens where pedido_id = v_ped and insumo_id = v_frasco and quantidade = 3;
  v_lote := public.receber_item_pedido_compra(v_ped, v_item, gen_random_uuid(), 2, current_date + 300, 'TS-0123-F1', null);
  select * into l from public.lotes_estoque where id = v_lote;
  if l.modelo_quantidade <> 'EMBALAGEM_FECHADA' or l.quantidade_atual <> 2 or l.conteudo_embalagem_snapshot <> 100
     or l.custo_unitario <> 500 or l.status <> 'quarentena' then
    raise exception '0123: lote recebido deveria ser 2 frascos de 100 mL a 500 (obtido % % % %)',
      l.modelo_quantidade, l.quantidade_atual, l.conteudo_embalagem_snapshot, l.custo_unitario;
  end if;

  -- frasco com volume diferente na chegada (0127: informado no recebimento,
  -- vale só para o lote/livro; o item da compra continua com 100)
  v_lote := public.receber_item_pedido_compra(v_ped, v_item, gen_random_uuid(), 1, current_date + 300, 'TS-0123-F2', null, 50);
  if (select conteudo_embalagem_snapshot from public.lotes_estoque where id = v_lote) <> 50 then
    raise exception '0123: volume do frasco informado na chegada nao foi registrado';
  end if;
  if (select conteudo_embalagem from public.pedidos_compra_itens where id = v_item) <> 100 then
    raise exception '0127: volume informado na chegada nao pode alterar o item da compra';
  end if;

  -- 300 mL antigos para insumo em frascos: 150 mL nao fecha frasco; 200 mL = 2 frascos
  select id into v_item from public.pedidos_compra_itens where pedido_id = v_ped and insumo_id = v_frasco and quantidade = 300;
  begin
    perform public.receber_item_pedido_compra(v_ped, v_item, gen_random_uuid(), 150, current_date + 300, 'TS-0123-X', null);
    raise exception '0123: recebimento que nao fecha frasco foi aceito';
  exception when invalid_parameter_value then null;
  end;
  v_lote := public.receber_item_pedido_compra(v_ped, v_item, gen_random_uuid(), 200, current_date + 300, 'TS-0123-F3', null);
  select * into l from public.lotes_estoque where id = v_lote;
  if l.modelo_quantidade <> 'EMBALAGEM_FECHADA' or l.quantidade_atual <> 2 or l.custo_unitario <> 500 then
    raise exception '0123: 200 mL deveriam virar 2 frascos a 500 (obtido % % %)', l.modelo_quantidade, l.quantidade_atual, l.custo_unitario;
  end if;

  -- 2 frascos de 1 L para insumo por volume → lote por volume de 2000 mL
  select id into v_item from public.pedidos_compra_itens
  where pedido_id = v_ped and insumo_id = v_volume and quantidade_em = 'embalagem';
  v_lote := public.receber_item_pedido_compra(v_ped, v_item, gen_random_uuid(), 2, null, 'TS-0123-V1', null);
  select * into l from public.lotes_estoque where id = v_lote;
  if l.modelo_quantidade <> 'LEGADO' or l.quantidade_atual <> 2000 or l.custo_unitario <> 0.1 then
    raise exception '0123: frascos de insumo por volume deveriam virar 2000 mL a 0,1 (obtido % % %)',
      l.modelo_quantidade, l.quantidade_atual, l.custo_unitario;
  end if;
  if exists (select 1 from public.lotes_estoque
             where insumo_id = v_volume and modelo_quantidade = 'EMBALAGEM_FECHADA') then
    raise exception '0123: insumo por volume recebeu lote de frascos (mistura)';
  end if;
end $$;

rollback;
