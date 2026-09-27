-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0127: ciclo fisico do insumo (itens de compra travados, livro
-- preservado, recebimento pelo tecnico, aceite por outra pessoa, entrada e
-- baixa idempotentes, reservas de lote vencido, encerramento com pendencia no
-- pedido interno, retomada da compra formal, estorno bilateral e "comprar
-- faltas" sem pedido em dobro). Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0127-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0127-' || p_rotulo)::uuid,
                      'email', 'ts-0127-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

do $$
declare
  v_rotulo text;
  v_frasco bigint;
  v_volume bigint;
  v_ped bigint;
  v_plano bigint;
  v_lote bigint;
begin
  foreach v_rotulo in array array['tecnico', 'coordenador'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0127-' || v_rotulo)::uuid,
            'authenticated', 'authenticated', 'ts-0127-' || v_rotulo || '@example.invalid', now(), now());
    update public.perfis set papel = v_rotulo, suspenso = false, permissoes = '{}'::jsonb
    where id = md5('kontrol-0127-' || v_rotulo)::uuid;
  end loop;

  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao, custo_unitario)
  values ('TS-0127 Tampao 100 mL', 'mL', 'µL', 100, 1000, 5) returning id into v_frasco;
  insert into public.insumos (especificacao, unidade, quantidade_embalagem, fator_conversao, custo_unitario, validade_apos_abertura_dias)
  values ('TS-0127 Etanol 1 L', 'mL', 1000, 1, 0.1, 30) returning id into v_volume;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status,
                                    data_abertura, validade_apos_abertura)
  values (v_volume, 'TS-0127-ABERTO', 500, 500, 'em_uso', current_date - 40, current_date - 10);

  -- Compra aprovada com dois itens em frascos
  insert into public.pedidos_compra (status, solicitante) values ('aprovado', 'ts-0127') returning id into v_ped;
  insert into public.pedidos_compra_itens (pedido_id, insumo_id, quantidade, custo_unitario_estimado)
  values (v_ped, v_frasco, 3, 500), (v_ped, v_frasco, 1, 500);

  -- Lote em frascos reservado a um plano; depois vence
  insert into public.planejamento (nome) values ('TS-0127 plano') returning id into v_plano;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_frasco, 'TS-0127-RES', 2, 2, 'aceito', current_date - 1, 'EMBALAGEM_FECHADA', 'mL', 100, 'µL', 1000)
  returning id into v_lote;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_frasco, 'TS-0127-BOM', 2, 2, 'aceito', current_date + 200, 'EMBALAGEM_FECHADA', 'mL', 100, 'µL', 1000);
  insert into public.reservas_estoque (planejamento_id, insumo_id, lote_id, quantidade, status)
  values (v_plano, v_frasco, v_lote, 2, 'reservado');
  perform set_config('app.planejamento_transicao', 'permitida', true);
  update public.planejamento set status_operacional = 'reservado' where id = v_plano;

  perform set_config('t0127.frasco', v_frasco::text, true);
  perform set_config('t0127.volume', v_volume::text, true);
  perform set_config('t0127.ped', v_ped::text, true);
  perform set_config('t0127.plano', v_plano::text, true);
end $$;

-- ---- EST2-4: reservado só conta lote utilizável ----------------------------
do $$
declare
  v_frasco bigint := current_setting('t0127.frasco')::bigint;
  s record;
begin
  select * into s from public.v_estoque_saldo where insumo_id = v_frasco;
  if s.reservado <> 0 or s.disponivel <> 2 then
    raise exception '0127: reserva em lote vencido nao pode esconder o disponivel (reservado %, disponivel %)', s.reservado, s.disponivel;
  end if;
  if s.unidade_saldo <> 'frasco(s) de 100 mL' then
    raise exception '0127: unidade do saldo deveria ser "frasco(s) de 100 mL" (obtido %)', s.unidade_saldo;
  end if;
  if not exists (select 1 from public.v_alertas_estoque a join public.lotes_estoque l on l.id = a.lote_id
                 where a.tipo = 'vencido' and l.codigo_lote = 'TS-0127-RES') then
    raise exception '0127: alerta de lote vencido deveria trazer o lote';
  end if;
  if kontrol_private.liberar_reservas_de_lotes_vencidos() < 1 then
    raise exception '0127: rotina diaria nao liberou a reserva do lote vencido';
  end if;
  if exists (select 1 from public.reservas_estoque r join public.lotes_estoque l on l.id = r.lote_id
             where l.codigo_lote = 'TS-0127-RES' and r.status in ('reservado', 'parcial'))
     or not (select reserva_desatualizada from public.planejamento where id = current_setting('t0127.plano')::bigint) then
    raise exception '0127: reserva do lote vencido deveria ser liberada e o plano marcado como desatualizado';
  end if;
end $$;

set local role authenticated;

-- ---- Técnico registra a chegada; não aceita o próprio lote ------------------
select pg_temp.como('tecnico');
do $$
declare
  v_ped bigint := current_setting('t0127.ped')::bigint;
  v_frasco bigint := current_setting('t0127.frasco')::bigint;
  v_item bigint;
  v_lote bigint;
  v_linhas integer;
begin
  select id into v_item from public.pedidos_compra_itens where pedido_id = v_ped and quantidade = 3;
  v_lote := public.receber_item_pedido_compra(v_ped, v_item, gen_random_uuid(), 2, current_date + 300, 'TS-0127-C1', null, 50, null);
  perform set_config('t0127.lote_tecnico', v_lote::text, true);
  if (select recebido_por_id from public.lotes_estoque where id = v_lote) <> auth.uid() then
    raise exception '0127: lote deveria guardar quem registrou a chegada';
  end if;
  if (select conteudo_embalagem_snapshot from public.lotes_estoque where id = v_lote) <> 50
     or (select conteudo_embalagem from public.pedidos_compra_itens where id = v_item) <> 100
     or (select conteudo_embalagem from public.pedidos_compra_item_recebimentos where lote_id = v_lote) <> 50 then
    raise exception '0127: volume informado na chegada deveria ir so para lote e livro';
  end if;
  begin
    perform public.aceitar_lote(v_lote, null, null);
    raise exception '0127: tecnico sem a caixinha aceitou lote';
  exception when insufficient_privilege then null;
  end;

  -- EST2-9: item recebido não muda nem sai; compra fora de solicitado também não
  begin
    update public.pedidos_compra_itens set quantidade = 10 where id = v_item;
    raise exception '0127: item recebido teve a quantidade alterada';
  exception when invalid_parameter_value then null;
  end;
  begin
    delete from public.pedidos_compra_itens where id = v_item;
    raise exception '0127: item recebido foi excluido';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.pedidos_compra_itens set quantidade = 5
    where pedido_id = v_ped and quantidade = 1;
    raise exception '0127: item de compra aprovada foi alterado';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.pedidos_compra_itens set quantidade_recebida = 3 where id = v_item;
    raise exception '0127: dados de recebimento alterados direto';
  exception when insufficient_privilege then null;
  end;

  -- PER2-6: técnico (compras.solicitar) não altera compra aprovada
  update public.pedidos_compra set observacao = 'mexido' where id = v_ped;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then
    raise exception '0127: tecnico alterou compra fora de solicitado';
  end if;
end $$;

select pg_temp.como('coordenador');
do $$
declare
  v_lote bigint := current_setting('t0127.lote_tecnico')::bigint;
begin
  perform public.aceitar_lote(v_lote, null, null);
  if (select status from public.lotes_estoque where id = v_lote) <> 'aceito' then
    raise exception '0127: coordenador deveria aceitar o lote recebido pelo tecnico';
  end if;
end $$;

-- Quem recebeu não aceita o próprio lote (coordenador recebe e tenta aceitar)
do $$
declare
  v_ped bigint := current_setting('t0127.ped')::bigint;
  v_item bigint;
  v_lote bigint;
begin
  select id into v_item from public.pedidos_compra_itens where pedido_id = v_ped and quantidade = 3;
  v_lote := public.receber_item_pedido_compra(v_ped, v_item, gen_random_uuid(), 1, current_date - 1, 'TS-0127-C2', null);
  begin
    perform public.aceitar_lote(v_lote, null, null);
    raise exception '0127: lote vencido foi aceito';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Quem recebeu não aceita o próprio lote (lote válido recebido pelo coordenador)
do $$
declare
  v_ped bigint := current_setting('t0127.ped')::bigint;
  v_item bigint;
  v_lote bigint;
begin
  select id into v_item from public.pedidos_compra_itens where pedido_id = v_ped and quantidade = 1;
  v_lote := public.receber_item_pedido_compra(v_ped, v_item, gen_random_uuid(), 1, current_date + 100, 'TS-0127-C3', null);
  begin
    perform public.aceitar_lote(v_lote, null, null);
    raise exception '0127: quem recebeu aceitou o proprio lote';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---- EST-2: estorno de recebimento de compra formal ------------------------
do $$
declare
  v_ped bigint := current_setting('t0127.ped')::bigint;
  v_lote bigint := (select id from public.lotes_estoque where codigo_lote = 'TS-0127-C2');
  v_item bigint;
  r jsonb;
begin
  select id into v_item from public.pedidos_compra_itens where pedido_id = v_ped and quantidade = 3;
  begin
    perform public.estornar_recebimento_do_lote(v_lote, '');
    raise exception '0127: estorno sem motivo foi aceito';
  exception when invalid_parameter_value then null;
  end;
  r := public.estornar_recebimento_do_lote(v_lote, 'Frasco chegou violado');
  if (select status from public.lotes_estoque where id = v_lote) <> 'descartado'
     or (select estornado_em from public.pedidos_compra_item_recebimentos where lote_id = v_lote) is null
     or (select quantidade_recebida from public.pedidos_compra_itens where id = v_item) <> 2 then
    raise exception '0127: estorno bilateral incompleto (%)', r;
  end if;
  if (public.estornar_recebimento_do_lote(v_lote, 'Frasco chegou violado') ->> 'repetido')::boolean is not true then
    raise exception '0127: estorno repetido deveria ser idempotente';
  end if;
end $$;

-- ---- EST2-3/EST-5: entrada avulsa em frascos e idempotente ------------------
select pg_temp.como('tecnico');
do $$
declare
  v_frasco bigint := current_setting('t0127.frasco')::bigint;
  v_op uuid := gen_random_uuid();
  r jsonb;
  l public.lotes_estoque%rowtype;
begin
  r := public.entrada_inventario(v_frasco, 2, v_op, current_date + 100, 400, 'TS-0127-E1', null, 'doacao');
  select * into l from public.lotes_estoque where id = (r->>'lote_id')::bigint;
  if l.modelo_quantidade <> 'EMBALAGEM_FECHADA' or l.quantidade_atual <> 2 or l.custo_unitario <> 400 then
    raise exception '0127: entrada de insumo em frascos deveria criar lote de 2 frascos (obtido % % %)',
      l.modelo_quantidade, l.quantidade_atual, l.custo_unitario;
  end if;
  r := public.entrada_inventario(v_frasco, 2, v_op, current_date + 100, 400, 'TS-0127-E1', null, 'doacao');
  if (r->>'repetido')::boolean is not true
     or (select count(*) from public.lotes_estoque where codigo_lote = 'TS-0127-E1') <> 1 then
    raise exception '0127: entrada repetida criou outro lote';
  end if;
  begin
    perform public.entrada_inventario(v_frasco, 1.5, gen_random_uuid(), current_date + 100, 400, 'TS-0127-E2', null, 'x');
    raise exception '0127: entrada fracionaria em frascos foi aceita';
  exception when invalid_parameter_value then null;
  end;
  if kontrol_private.modelo_quantidade_insumo(v_frasco) <> 'EMBALAGEM_FECHADA' then
    raise exception '0127: entrada avulsa mudou o insumo para volume';
  end if;
end $$;

-- ---- EST-8 e baixa idempotente por volume ----------------------------------
do $$
declare
  v_lote bigint := (select id from public.lotes_estoque where codigo_lote = 'TS-0127-ABERTO');
  v_op uuid := gen_random_uuid();
begin
  begin
    perform public.baixa_manual_lote(v_lote, 10, 'uso', gen_random_uuid());
    raise exception '0127: baixa ignorou a validade apos abertura';
  exception when invalid_parameter_value then null;
  end;
  perform public.baixa_manual_lote(v_lote, 10, 'Vencimento', v_op);
  perform public.baixa_manual_lote(v_lote, 10, 'Vencimento', v_op);
  if (select quantidade_atual from public.lotes_estoque where id = v_lote) <> 490
     or (select count(*) from public.estoque_movimentacoes where lote_id = v_lote) <> 1 then
    raise exception '0127: baixa repetida gravou duas saidas';
  end if;
end $$;

-- ---- Item 13, EST2-7 e dados da etapa --------------------------------------
select pg_temp.como('coordenador');
do $$
declare
  v_frasco bigint := current_setting('t0127.frasco')::bigint;
  v_pedido bigint;
  v_compra bigint;
  v_item_a bigint;
  v_item_b bigint;
  r jsonb;
begin
  insert into public.pedidos_internos (titulo, status, solicitante, tipo_demanda, justificativa)
  values ('TS-0127 pedido', 'rascunho', 'ts-0127-coordenador@example.invalid', 'laboratorio', 'teste')
  returning id into v_pedido;
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, insumo_id)
  values (v_pedido, 'material', 'Tampao A', 2, v_frasco) returning id into v_item_a;
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, insumo_id)
  values (v_pedido, 'material', 'Tampao B', 1, v_frasco) returning id into v_item_b;

  perform public.registrar_etapa_pedido_interno(v_pedido, 'em_validacao', 'envio', 'registrado', null, '{}');
  if (select enviado_validacao_em from public.pedidos_internos where id = v_pedido) is null then
    raise exception '0127: etapa deveria gravar a data de envio';
  end if;
  perform public.registrar_etapa_pedido_interno(v_pedido, 'validado', 'validacao', 'aprovado', null,
    '{"aprovador_coordenador": "Coord TS"}');
  if (select aprovador_coordenador from public.pedidos_internos where id = v_pedido) <> 'Coord TS' then
    raise exception '0127: etapa deveria gravar o aprovador';
  end if;
  r := public.formalizar_pedido_interno(v_pedido);
  v_compra := (r->>'pedido_compra_id')::bigint;

  -- devolvido depois de formalizado e ajustado: retoma a mesma compra
  begin
    perform public.registrar_etapa_pedido_interno(v_pedido, 'analise_administrativa', 'analise', 'registrado', null, '{}');
    raise exception '0127: analise administrativa sem rubrica foi aceita';
  exception when invalid_parameter_value then null;
  end;
  perform public.registrar_etapa_pedido_interno(v_pedido, 'analise_administrativa', 'analise', 'registrado', 'ok',
    '{"fonte_recurso": "Projeto X", "rubrica": "Material", "conformidade_admin": "ok"}');
  perform public.transicionar_pedido_interno(v_pedido, 'ajuste_compras', 'analise', 'devolvido', 'ajustar');
  update public.pedidos_internos_itens set quantidade = 3 where id = v_item_a;
  perform public.transicionar_pedido_interno(v_pedido, 'em_validacao', 'envio', 'registrado', null);
  perform public.transicionar_pedido_interno(v_pedido, 'validado', 'validacao', 'aprovado', null);
  r := public.formalizar_pedido_interno(v_pedido);
  if (r->>'pedido_compra_id')::bigint <> v_compra or (r->>'retomada')::boolean is not true
     or (select status from public.pedidos_internos where id = v_pedido) <> 'formalizado'
     or (select quantidade from public.pedidos_compra_itens where pedido_interno_item_id = v_item_a) <> 3 then
    raise exception '0127: pedido devolvido deveria retomar a compra #% com o item ajustado (obtido %)', v_compra, r;
  end if;

  -- compra aprovada, recebe parte do item A e encerra com pendência
  perform public.transicionar_pedido_compra(v_compra, 'aprovado', 'ok', null);
  perform public.receber_item_pedido_compra(v_compra,
    (select id from public.pedidos_compra_itens where pedido_interno_item_id = v_item_a),
    gen_random_uuid(), 1, current_date + 300, 'TS-0127-PI', null);
  perform public.transicionar_pedido_compra(v_compra, 'recebido', 'Fornecedor sem estoque', null);
  if (select recebido_em from public.pedidos_internos_itens where id = v_item_b) is null
     or (select divergencia_recebimento from public.pedidos_internos_itens where id = v_item_a) not like '%encerrada com pendência%'
     or (select recebido_em from public.pedidos_internos where id = v_pedido) is null then
    raise exception '0127: pedido interno deveria concluir o recebimento com a pendencia registrada';
  end if;

  -- livro não some: pedido interno com recebimento não é excluído
  begin
    delete from public.pedidos_internos_itens where id = v_item_a;
    raise exception '0127: item de pedido interno com recebimento foi excluido';
  exception when foreign_key_violation or invalid_parameter_value then null;
  end;
end $$;

-- ---- "Comprar faltas": sem pedido em dobro ---------------------------------
select pg_temp.como('tecnico');
do $$
declare
  v_plano bigint := current_setting('t0127.plano')::bigint;
  v_frasco bigint := current_setting('t0127.frasco')::bigint;
  v_itens jsonb;
  r jsonb;
begin
  v_itens := jsonb_build_array(jsonb_build_object(
    'insumo_id', v_frasco, 'especificacao', 'Tampao', 'quantidade', 2,
    'quantidade_em', 'embalagem', 'conteudo_embalagem', 100, 'unidade', 'frasco(s) de 100 mL'));
  r := public.criar_pedido_faltas_planejamento(v_plano, v_itens);
  if (r->>'itens')::int <> 1 then
    raise exception '0127: comprar faltas deveria criar 1 item (obtido %)', r;
  end if;
  begin
    perform public.criar_pedido_faltas_planejamento(v_plano, v_itens);
    raise exception '0127: segundo clique criou outro pedido para a mesma falta';
  exception when invalid_parameter_value then null;
  end;
  -- falta maior: pede só a diferença
  r := public.criar_pedido_faltas_planejamento(v_plano, jsonb_set(v_itens, '{0,quantidade}', '3'));
  if (select quantidade from public.pedidos_internos_itens where pedido_interno_id = (r->>'pedido_id')::bigint) <> 1 then
    raise exception '0127: comprar faltas deveria descontar o ja pedido';
  end if;
end $$;

-- ---- EST-4: retirada sai do lote conferido ---------------------------------
reset role;
do $$
declare
  v_frasco bigint := current_setting('t0127.frasco')::bigint;
  v_plano bigint;
  v_a bigint;
  v_b bigint;
begin
  insert into public.planejamento (nome) values ('TS-0127 plano conferido') returning id into v_plano;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_frasco, 'TS-0127-FEFO', 3, 3, 'aceito', current_date + 30, 'EMBALAGEM_FECHADA', 'mL', 100, 'µL', 1000)
  returning id into v_a;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_frasco, 'TS-0127-BANCADA', 3, 3, 'aceito', current_date + 90, 'EMBALAGEM_FECHADA', 'mL', 100, 'µL', 1000)
  returning id into v_b;
  insert into public.reservas_estoque (planejamento_id, insumo_id, lote_id, quantidade, status)
  values (v_plano, v_frasco, v_a, 1, 'reservado');
  insert into public.planejamento_lote_conferencias (planejamento_id, insumo_id, lote_id, quantidade_prevista, quantidade_conferida, status, justificativa)
  values (v_plano, v_frasco, v_b, 1, 1, 'excecao_fefo', 'frasco aberto na bancada');
  perform set_config('app.planejamento_transicao', 'permitida', true);
  update public.planejamento set status_operacional = 'reservado', reserva_desatualizada = false where id = v_plano;
  perform set_config('t0127.plano_conf', v_plano::text, true);
end $$;
set local role authenticated;
select pg_temp.como('tecnico');
do $$
declare
  v_plano bigint := current_setting('t0127.plano_conf')::bigint;
begin
  perform public.dar_baixa_plano(v_plano);
  if (select quantidade_atual from public.lotes_estoque where codigo_lote = 'TS-0127-BANCADA') <> 2
     or (select quantidade_atual from public.lotes_estoque where codigo_lote = 'TS-0127-FEFO') <> 3 then
    raise exception '0127: retirada deveria sair do lote conferido, nao do reservado';
  end if;
end $$;

-- ---- PER2-7: ajuste de inventário exige a caixinha -------------------------
do $$
begin
  begin
    perform public.aplicar_ajuste_inventario_contagem(-1);
    raise exception '0127: tecnico aplicou ajuste de inventario';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- ---- Livro preservado: compra com recebimento não é apagada -----------------
do $$
declare
  v_ped bigint := current_setting('t0127.ped')::bigint;
begin
  begin
    delete from public.pedidos_compra where id = v_ped;
    raise exception '0127: compra com recebimento foi apagada junto com o livro';
  exception when foreign_key_violation or invalid_parameter_value then null;
  end;
  if (select permissoes -> 'compras.receber' from public.permissoes_categorias where papel = 'tecnico') <> 'true'::jsonb then
    raise exception '0127: padrao do tecnico deveria incluir compras.receber';
  end if;
end $$;

rollback;
