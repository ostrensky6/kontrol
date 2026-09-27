-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0120 (auditoria de processos de 2026-09-26) com os mesmos cenarios
-- que reproduziram os defeitos. Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- Fixtures (como owner)
-- ---------------------------------------------------------------------------
do $$
declare
  v_papel text;
  v_uid uuid;
begin
  foreach v_papel in array array['tecnico', 'coordenador', 'gestor'] loop
    v_uid := md5('kontrol-0120-' || v_papel)::uuid;
    if exists (select 1 from auth.users where id = v_uid) then
      raise exception '0120: fixture % ja existe', v_papel;
    end if;
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
            'ts-0120-' || v_papel || '@example.invalid', now(), now());
    update public.perfis set papel = v_papel, suspenso = false where id = v_uid;
    if not found then raise exception '0120: perfil fixture % ausente', v_papel; end if;
  end loop;

  -- Frasco de 100 mL; receita em µL (fator 1000); 3 frascos fechados.
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem,
                              fator_conversao, custo_total_embalagem, custo_unitario)
  values ('TS-0120 Tampao 100 mL', 'mL', 'µL', 100, 1000, 500, 5);
  insert into public.lotes_estoque (
    insumo_id, codigo_lote, validade, quantidade_inicial, quantidade_atual, custo_unitario,
    status, modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot,
    unidade_consumo_snapshot, fator_conversao_snapshot
  )
  select id, 'TS-0120-F', current_date + 200, 3, 3, 500, 'aceito',
         'EMBALAGEM_FECHADA', 'mL', 100, 'µL', 1000
  from public.insumos where especificacao = 'TS-0120 Tampao 100 mL';

  -- Etanol por volume: lotes A e B com 10 mL; Q tentou entrar em quarentena
  -- (0130: entra disponível).
  insert into public.insumos (especificacao, unidade, fator_conversao, custo_unitario)
  values ('TS-0120 Etanol', 'mL', 1, 0.1);
  insert into public.lotes_estoque (insumo_id, codigo_lote, validade, quantidade_inicial, quantidade_atual, status)
  select id, c, current_date + d, 10, 10, s
  from public.insumos, (values ('TS-0120-A', 100, 'aceito'), ('TS-0120-B', 200, 'aceito'),
                               ('TS-0120-Q', 200, 'quarentena')) v(c, d, s)
  where especificacao = 'TS-0120 Etanol';

  insert into public.insumos (especificacao, unidade, fator_conversao) values ('TS-0120 Sem uso', 'un', 1);

  insert into public.planejamento (nome) values ('TS-0120 plano 2 mL'), ('TS-0120 plano 250 mL'),
    ('TS-0120 plano fantasma'), ('TS-0120 plano liberar');

  insert into public.pedidos_compra (status, solicitante) values ('solicitado', 'ts-0120');
  insert into public.pedidos_compra_itens (pedido_id, insumo_id, quantidade, custo_unitario_estimado)
  select (select max(id) from public.pedidos_compra where solicitante = 'ts-0120'), id, 300, 0.1
  from public.insumos where especificacao = 'TS-0120 Etanol';
end $$;

-- ---------------------------------------------------------------------------
-- A. Acesso anonimo
-- ---------------------------------------------------------------------------
do $$
declare
  v text;
begin
  select string_agg(c.relname, ', ') into v
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
    and has_table_privilege('anon', c.oid, 'SELECT');
  if v is not null then
    raise exception '0120: anon ainda le as views: %', v;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
               and tablename in ('eventos_status', 'tipo_insumos') and 'anon' = any(roles)) then
    raise exception '0120: policy de leitura anonima ainda existe';
  end if;
  -- 0132: a leitura do link passou a ser so do servidor; a aprovacao segue publica.
  if not has_function_privilege('anon', 'public.aprovar_orcamento_publico(text, text)', 'EXECUTE') then
    raise exception '0120: aprovacao publica deixou de ser executavel por anon';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- B. Plano x embalagens fechadas (como tecnico)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', md5('kontrol-0120-tecnico')::uuid::text, true);
select set_config('request.jwt.claims',
  json_build_object('sub', md5('kontrol-0120-tecnico')::uuid, 'email', 'ts-0120-tecnico@example.invalid',
                    'role', 'authenticated')::text, true);

do $$
declare
  v_ins bigint := (select id from public.insumos where especificacao = 'TS-0120 Tampao 100 mL');
  v_p2 bigint := (select id from public.planejamento where nome = 'TS-0120 plano 2 mL');
  v_p250 bigint := (select id from public.planejamento where nome = 'TS-0120 plano 250 mL');
  v_r jsonb;
  v_qtd numeric;
  v_status text;
begin
  -- 250 mL cabem em 3 frascos: sem falta
  v_r := public.reservar_plano(v_p250, jsonb_build_array(jsonb_build_object('insumo_id', v_ins, 'quantidade', 250)));
  if jsonb_array_length(v_r->'shortfalls') <> 0 then
    raise exception '0120: 250 mL com 300 mL em estoque acusou falta: %', v_r;
  end if;
  select sum(quantidade) into v_qtd from public.reservas_estoque
  where planejamento_id = v_p250 and status = 'reservado';
  if v_qtd <> 3 then
    raise exception '0120: 250 mL deveria reservar 3 frascos (obtido %)', v_qtd;
  end if;
  perform public.reservar_plano(v_p250, '[]'::jsonb); -- libera para o proximo cenario

  -- 2,5 mL: 1 frasco inteiro; a baixa nao viola a constraint
  v_r := public.reservar_plano(v_p2, jsonb_build_array(jsonb_build_object('insumo_id', v_ins, 'quantidade', 2.5)));
  select sum(quantidade) into v_qtd from public.reservas_estoque
  where planejamento_id = v_p2 and status = 'reservado';
  if v_qtd <> 1 then
    raise exception '0120: 2,5 mL deveria reservar 1 frasco (obtido %)', v_qtd;
  end if;
  perform public.dar_baixa_plano(v_p2);

  select quantidade_atual, status into v_qtd, v_status
  from public.lotes_estoque where codigo_lote = 'TS-0120-F';
  if v_qtd <> 2 or v_status <> 'aceito' then
    raise exception '0120: depois da baixa o lote deveria ter 2 frascos aceitos (obtido % %)', v_qtd, v_status;
  end if;
  if (select em_maos from public.v_estoque_saldo where insumo_id = v_ins) <> 2 then
    raise exception '0120: frascos restantes sumiram do saldo';
  end if;
  if (select disponivel_unidade from public.v_estoque_disponivel_unidade where insumo_id = v_ins) <> 200 then
    raise exception '0120: disponivel na unidade fisica deveria ser 200 mL';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- C. Reserva-fantasma; D. desbloqueio (como gestor)
-- ---------------------------------------------------------------------------
do $$
declare
  v_ins bigint := (select id from public.insumos where especificacao = 'TS-0120 Etanol');
  v_p bigint := (select id from public.planejamento where nome = 'TS-0120 plano fantasma');
begin
  perform public.reservar_plano(v_p, jsonb_build_array(jsonb_build_object('insumo_id', v_ins, 'quantidade', 10)));
  if (select lote_id from public.reservas_estoque where planejamento_id = v_p and status = 'reservado')
     <> (select id from public.lotes_estoque where codigo_lote = 'TS-0120-A') then
    raise exception '0120: FEFO deveria reservar o lote A';
  end if;
end $$;

select set_config('request.jwt.claim.sub', md5('kontrol-0120-gestor')::uuid::text, true);
select set_config('request.jwt.claims',
  json_build_object('sub', md5('kontrol-0120-gestor')::uuid, 'email', 'ts-0120-gestor@example.invalid',
                    'role', 'authenticated')::text, true);

do $$
declare
  v_ins bigint := (select id from public.insumos where especificacao = 'TS-0120 Etanol');
  v_p bigint := (select id from public.planejamento where nome = 'TS-0120 plano fantasma');
  v_a bigint := (select id from public.lotes_estoque where codigo_lote = 'TS-0120-A');
  v_q bigint := (select id from public.lotes_estoque where codigo_lote = 'TS-0120-Q');
begin
  perform public.descartar_lote(v_a, 'contaminado');
  if exists (select 1 from public.reservas_estoque where lote_id = v_a and status in ('reservado', 'parcial')) then
    raise exception '0120: reserva do lote descartado continuou ativa';
  end if;
  if not (select reserva_desatualizada from public.planejamento where id = v_p) then
    raise exception '0120: plano deveria ficar com reserva desatualizada';
  end if;
  if (select disponivel from public.v_estoque_saldo where insumo_id = v_ins) <> 20 then
    raise exception '0120: disponivel deveria ser 20 (lotes B e Q livres)';
  end if;

  perform public.bloquear_lote(v_q, 'suspeita');
  perform public.desbloquear_lote(v_q);
  if (select status from public.lotes_estoque where id = v_q) <> 'aceito' then
    raise exception '0120/0130: lote desbloqueado deveria voltar disponivel';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- E. Inventario; H. liberar reservas; I. encerrar compra (como coordenador)
-- ---------------------------------------------------------------------------
reset role;
insert into public.inventario_ciclos (nome, status) values ('TS-0120 ciclo', 'aberto');
insert into public.inventario_contagens (ciclo_id, lote_id, quantidade_sistema, quantidade_contada, divergencia, justificativa)
select (select max(id) from public.inventario_ciclos where nome = 'TS-0120 ciclo'), id, 10, 9, -1, 'contagem fisica'
from public.lotes_estoque where codigo_lote = 'TS-0120-B';

set local role authenticated;
select set_config('request.jwt.claim.sub', md5('kontrol-0120-tecnico')::uuid::text, true);
select set_config('request.jwt.claims',
  json_build_object('sub', md5('kontrol-0120-tecnico')::uuid, 'email', 'ts-0120-tecnico@example.invalid',
                    'role', 'authenticated')::text, true);
select public.baixa_manual_lote((select id from public.lotes_estoque where codigo_lote = 'TS-0120-B'), 3, 'uso');

select set_config('request.jwt.claim.sub', md5('kontrol-0120-coordenador')::uuid::text, true);
select set_config('request.jwt.claims',
  json_build_object('sub', md5('kontrol-0120-coordenador')::uuid, 'email', 'ts-0120-coordenador@example.invalid',
                    'role', 'authenticated')::text, true);

do $$
declare
  v_contagem bigint := (select c.id from public.inventario_contagens c
                        join public.lotes_estoque l on l.id = c.lote_id where l.codigo_lote = 'TS-0120-B');
  v_ins bigint := (select id from public.insumos where especificacao = 'TS-0120 Etanol');
  v_p bigint := (select id from public.planejamento where nome = 'TS-0120 plano liberar');
  v_ped bigint := (select max(id) from public.pedidos_compra where solicitante = 'ts-0120');
  v_item bigint;
  v_nova bigint;
begin
  begin
    perform public.aplicar_ajuste_inventario_contagem(v_contagem);
    raise exception '0120: inventario aplicou contagem com saldo alterado';
  exception when serialization_failure then null;
  end;
  if (select quantidade_atual from public.lotes_estoque where codigo_lote = 'TS-0120-B') <> 7 then
    raise exception '0120: saldo do lote B deveria continuar 7';
  end if;

  perform public.reservar_plano(v_p, jsonb_build_array(jsonb_build_object('insumo_id', v_ins, 'quantidade', 1)));
  perform public.liberar_plano(v_p);
  if (select status_operacional from public.planejamento where id = v_p) <> 'rascunho' then
    raise exception '0120: liberar reservas deveria devolver o plano ao rascunho';
  end if;

  select id into v_item from public.pedidos_compra_itens where pedido_id = v_ped;
  perform public.transicionar_pedido_compra(v_ped, 'aprovado', null, null);
  perform public.transicionar_pedido_compra(v_ped, 'enviado', null, null);
  perform public.receber_item_pedido_compra(v_ped, v_item, gen_random_uuid(), 100, current_date + 300, 'TS-0120-R', null);

  begin
    perform public.transicionar_pedido_compra(v_ped, 'cancelado', 'fornecedor', null);
    raise exception '0120: compra com recebimento foi cancelada';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.encerrar_compra_com_pendencia(v_ped, 'nova_compra', '  ');
    raise exception '0120: encerramento sem motivo aceito';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.encerrar_compra_com_pendencia(v_ped, null, 'fornecedor nao entrega o restante');
    raise exception '0120/0130: encerramento sem destino aceito';
  exception when invalid_parameter_value then null;
  end;
  -- 0130: compra direta (sem pedido interno); o que faltou vira nova compra
  v_nova := (public.encerrar_compra_com_pendencia(v_ped, 'nova_compra', 'fornecedor nao entrega o restante')
             ->> 'nova_compra_id')::bigint;
  if (select status from public.pedidos_compra where id = v_ped) <> 'recebido' then
    raise exception '0120: compra deveria ficar encerrada';
  end if;
  if (select divergencia_recebimento from public.pedidos_compra_itens where id = v_item) not like 'Encerrado com pendência: recebido 100 de 300%' then
    raise exception '0120: pendencia nao registrada no item';
  end if;
  if v_nova is null
     or (select status from public.pedidos_compra where id = v_nova) <> 'solicitado'
     or (select compra_origem_id from public.pedidos_compra where id = v_nova) <> v_ped
     or (select sum(quantidade) from public.pedidos_compra_itens where pedido_id = v_nova) <> 200
     or (select compra_pendencia_id from public.pedidos_compra_itens where id = v_item) <> v_nova
     or (select quantidade_nao_atendida from public.pedidos_compra_itens where id = v_item) <> 200 then
    raise exception '0120/0130: o que faltou (200) deveria virar a compra #% ligada a #%', v_nova, v_ped;
  end if;
  -- compra sem pedido interno segue a regra própria: basta aprovar compras
  perform public.transicionar_pedido_compra(v_nova, 'aprovado', null, null);

  -- J. Exclusao com historico recusada; sem historico, permitida
  begin
    delete from public.insumos where id = v_ins;
    raise exception '0120: insumo com historico foi excluido';
  exception when foreign_key_violation then null;
  end;
  delete from public.insumos where especificacao = 'TS-0120 Sem uso';
  if exists (select 1 from public.insumos where especificacao = 'TS-0120 Sem uso') then
    raise exception '0120: insumo sem historico deveria poder ser excluido';
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- F. Custo medio normalizado; G. margem casa "plano N;"
-- ---------------------------------------------------------------------------
do $$
declare
  v_custo numeric;
begin
  select custo_normalizado into v_custo
  from public.v_custo_estoque_vigente
  where especificacao = 'TS-0120 Tampao 100 mL';
  if round(v_custo, 6) <> 0.005 then
    raise exception '0120: custo por µL deveria ser 0,005 (obtido %)', v_custo;
  end if;
  if pg_get_viewdef('public.v_margem_real_planejamento'::regclass) not like '%;%' then
    raise exception '0120: margem real nao casa a referencia da baixa';
  end if;
end $$;

rollback;
