-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Todas as fixtures e operacoes sao revertidas no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------
-- Fixtures (owner): usuarios, analise, insumo e planos em cada situacao.
-- ---------------------------------------------------------------------
do $$
declare
  rotulo text;
  uid uuid;
  v_insumo bigint;
  v_plano bigint;
begin
  if to_regprocedure('public.excluir_planejamento(bigint,text)') is null
    or to_regprocedure('public.cancelar_planejamento(bigint,text)') is null then
    raise exception '0111: migration ausente';
  end if;
  if has_function_privilege('anon', 'public.excluir_planejamento(bigint,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.cancelar_planejamento(bigint,text)', 'EXECUTE') then
    raise exception '0111: RPC acessivel a anon';
  end if;
  if not has_function_privilege('authenticated', 'public.excluir_planejamento(bigint,text)', 'EXECUTE') then
    raise exception '0111: RPC inacessivel a authenticated';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.planejamento'::regclass and tgname = 'aud_planejamento'
  ) or not exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.planejamento_itens'::regclass and tgname = 'aud_planejamento_itens'
  ) then
    raise exception '0111: gatilhos de auditoria ausentes';
  end if;

  foreach rotulo in array array['coordenador', 'tecnico'] loop
    uid := md5('kontrol-0111-' || rotulo)::uuid;
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
            format('ts-0111-%s@example.invalid', rotulo), now(), now());
    update public.perfis set papel = case when rotulo = 'tecnico' then 'laboratorio' else rotulo end, suspenso = false where id = uid;
    if not found then raise exception '0111: perfil fixture ausente para %', rotulo; end if;
  end loop;

  insert into public.analises(codigo, nome) values ('TS-0111', 'Analise teste 0111');
  insert into public.insumos(especificacao) values ('TS-0111 insumo') returning id into v_insumo;
  perform set_config('t0111.insumo', v_insumo::text, true);

  -- A: rascunho com item e reservas ja liberadas + uma ativa -> excluivel.
  insert into public.planejamento(nome) values ('TS-0111 A') returning id into v_plano;
  insert into public.planejamento_itens(planejamento_id, codigo_analise, n_amostras) values (v_plano, 'TS-0111', 3);
  insert into public.reservas_estoque(planejamento_id, insumo_id, quantidade, status) values
    (v_plano, v_insumo, 2, 'liberado'),
    (v_plano, v_insumo, 1, 'parcial');
  insert into public.pedidos_internos(titulo, planejamento_id, status) values ('TS-0111 cancelado', v_plano, 'cancelado');
  perform set_config('t0111.a', v_plano::text, true);

  -- B: reserva consumida -> so cancelar.
  insert into public.planejamento(nome) values ('TS-0111 B') returning id into v_plano;
  insert into public.reservas_estoque(planejamento_id, insumo_id, quantidade, quantidade_consumida, status)
    values (v_plano, v_insumo, 1, 1, 'consumido');
  perform set_config('t0111.b', v_plano::text, true);

  -- C: pedido interno ativo -> exclusao recusada listando o pedido.
  insert into public.planejamento(nome) values ('TS-0111 C') returning id into v_plano;
  insert into public.pedidos_internos(titulo, planejamento_id) values ('TS-0111 ativo', v_plano);
  perform set_config('t0111.c', v_plano::text, true);

  -- D: saida de estoque referenciando o plano -> so cancelar.
  insert into public.planejamento(nome) values ('TS-0111 D') returning id into v_plano;
  insert into public.estoque_movimentacoes(insumo_id, tipo, quantidade, motivo, referencia)
    values (v_insumo, 'saida', 1, 'baixa analise lote reservado', 'plano ' || v_plano || '; analise TS-0111; reserva 0');
  perform set_config('t0111.d', v_plano::text, true);

  -- E: reservado (itens editaveis, marca de reserva desatualizada).
  insert into public.planejamento(nome) values ('TS-0111 E') returning id into v_plano;
  insert into public.planejamento_itens(planejamento_id, codigo_analise, n_amostras) values (v_plano, 'TS-0111', 1);
  perform set_config('app.planejamento_transicao', 'permitida', true);
  update public.planejamento set status_operacional = 'reservado' where id = v_plano;
  perform set_config('t0111.e', v_plano::text, true);

  -- F: cancelado sem baixa -> itens bloqueados, mas exclusao permitida.
  insert into public.planejamento(nome) values ('TS-0111 F') returning id into v_plano;
  insert into public.planejamento_itens(planejamento_id, codigo_analise, n_amostras) values (v_plano, 'TS-0111', 1);
  update public.planejamento set status_operacional = 'cancelado' where id = v_plano;
  perform set_config('app.planejamento_transicao', '', true);
  perform set_config('t0111.f', v_plano::text, true);

  perform set_config('t0111.audit_baseline', (select count(*)::text from public.auditoria), true);
end $$;

-- ---------------------------------------------------------------------
-- Tecnico: nao exclui nem cancela; nao edita itens de plano cancelado.
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', md5('kontrol-0111-tecnico')::uuid, 'email', 'ts-0111-tecnico@example.invalid', 'role', 'authenticated')::text, true);

do $$
begin
  begin
    perform public.excluir_planejamento(current_setting('t0111.a')::bigint, 'duplicado');
    raise exception '0111: tecnico excluiu planejamento';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.cancelar_planejamento(current_setting('t0111.b')::bigint, 'teste');
    raise exception '0111: tecnico cancelou planejamento';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.planejamento_itens(planejamento_id, codigo_analise, n_amostras)
      values (current_setting('t0111.f')::bigint, 'TS-0111', 2);
    raise exception '0111: item incluido em plano cancelado';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------
-- Coordenador: regras de exclusao, cancelamento e marca de reserva.
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', md5('kontrol-0111-coordenador')::uuid, 'email', 'ts-0111-coordenador@example.invalid', 'role', 'authenticated')::text, true);

do $$
declare
  v_res jsonb;
  v_msg text;
  v_status text;
  v_flag boolean;
  n bigint;
begin
  -- DELETE direto continua bloqueado.
  begin
    delete from public.planejamento where id = current_setting('t0111.a')::bigint;
    get diagnostics n = row_count;
    if n > 0 then raise exception '0111: DELETE direto removeu planejamento'; end if;
  exception when insufficient_privilege then null;
  end;

  -- Motivo obrigatorio.
  begin
    perform public.excluir_planejamento(current_setting('t0111.a')::bigint, '  ');
    raise exception '0111: exclusao sem motivo aceita';
  exception when invalid_parameter_value then null;
  end;

  -- Baixa por reserva consumida -> recusa; cancelamento aceito.
  begin
    perform public.excluir_planejamento(current_setting('t0111.b')::bigint, 'duplicado');
    raise exception '0111: plano com baixa foi excluido';
  exception when invalid_parameter_value then
    get stacked diagnostics v_msg = message_text;
    if position('baixa' in v_msg) = 0 then raise exception '0111: mensagem inesperada: %', v_msg; end if;
  end;
  v_res := public.cancelar_planejamento(current_setting('t0111.b')::bigint, 'Material ja usado');
  select status_operacional into v_status from public.planejamento where id = current_setting('t0111.b')::bigint;
  if v_status <> 'cancelado' then raise exception '0111: cancelamento nao aplicado (%)', v_status; end if;
  if not exists (select 1 from public.eventos_status
                  where entidade = 'planejamento' and entidade_id = current_setting('t0111.b')::bigint
                    and para_status = 'cancelado' and observacao like '%Material ja usado%') then
    raise exception '0111: motivo do cancelamento nao registrado';
  end if;
  begin
    perform public.cancelar_planejamento(current_setting('t0111.b')::bigint, 'de novo');
    raise exception '0111: cancelamento duplicado aceito';
  exception when invalid_parameter_value then null;
  end;

  -- Saida de estoque referenciando o plano -> recusa.
  begin
    perform public.excluir_planejamento(current_setting('t0111.d')::bigint, 'duplicado');
    raise exception '0111: plano com saida de estoque foi excluido';
  exception when invalid_parameter_value then null;
  end;

  -- Pedido interno ativo -> recusa listando o pedido.
  begin
    perform public.excluir_planejamento(current_setting('t0111.c')::bigint, 'duplicado');
    raise exception '0111: plano com pedido interno ativo foi excluido';
  exception when foreign_key_violation then
    get stacked diagnostics v_msg = message_text;
    if position('rascunho' in v_msg) = 0 then raise exception '0111: pedido nao listado: %', v_msg; end if;
  end;

  -- Reservado: alterar item marca a reserva como desatualizada.
  update public.planejamento_itens set n_amostras = 5
   where planejamento_id = current_setting('t0111.e')::bigint;
  get diagnostics n = row_count;
  if n <> 1 then raise exception '0111: item de plano reservado nao editado (%)', n; end if;
  select reserva_desatualizada into v_flag from public.planejamento where id = current_setting('t0111.e')::bigint;
  if not v_flag then raise exception '0111: reserva_desatualizada nao marcada'; end if;

  -- Cancelado sem baixa: itens bloqueados, exclusao permitida.
  begin
    delete from public.planejamento_itens where planejamento_id = current_setting('t0111.f')::bigint;
    raise exception '0111: item removido de plano cancelado';
  exception when invalid_parameter_value then null;
  end;
  v_res := public.excluir_planejamento(current_setting('t0111.f')::bigint, 'Plano cancelado por engano');
  if exists (select 1 from public.planejamento where id = current_setting('t0111.f')::bigint) then
    raise exception '0111: plano cancelado sem baixa nao foi excluido';
  end if;

  -- Rascunho com reservas liberadas/parcial e pedido cancelado -> excluido.
  v_res := public.excluir_planejamento(current_setting('t0111.a')::bigint, 'Plano duplicado');
  if (v_res->>'itens_removidos')::int <> 1 or (v_res->>'reservas_liberadas')::int <> 1 then
    raise exception '0111: retorno inesperado %', v_res;
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------
-- Verificacoes finais (owner): trilha, cascade, set null e marca.
-- ---------------------------------------------------------------------
do $$
declare
  v_plano bigint := current_setting('t0111.a')::bigint;
  v_flag boolean;
begin
  if exists (select 1 from public.planejamento where id = v_plano)
     or exists (select 1 from public.planejamento_itens where planejamento_id = v_plano)
     or exists (select 1 from public.reservas_estoque where planejamento_id = v_plano) then
    raise exception '0111: exclusao incompleta';
  end if;
  if not exists (select 1 from public.pedidos_internos where titulo = 'TS-0111 cancelado' and planejamento_id is null) then
    raise exception '0111: pedido cancelado nao preservado com planejamento_id nulo';
  end if;
  if not exists (select 1 from public.eventos_status
                  where entidade = 'planejamento' and entidade_id = v_plano
                    and para_status = 'excluido' and observacao like '%Plano duplicado%') then
    raise exception '0111: evento de exclusao nao registrado';
  end if;
  if not exists (select 1 from public.auditoria
                  where tabela = 'planejamento' and registro_id = v_plano::text
                    and acao = 'exclusao_solicitada' and justificativa = 'Plano duplicado') then
    raise exception '0111: auditoria com motivo ausente';
  end if;
  if not exists (select 1 from public.auditoria
                  where tabela = 'planejamento' and registro_id = v_plano::text and acao = 'delete') then
    raise exception '0111: gatilho aud_planejamento nao registrou o delete';
  end if;

  -- Nova reserva limpa a marca; inicio bloqueado enquanto marcada.
  v_plano := current_setting('t0111.e')::bigint;
  perform set_config('app.planejamento_transicao', 'permitida', true);
  begin
    update public.planejamento set status_operacional = 'em_execucao' where id = v_plano;
    raise exception '0111: inicio aceito com reserva desatualizada';
  exception when invalid_parameter_value then null;
  end;
  insert into public.reservas_estoque(planejamento_id, insumo_id, quantidade, status)
    values (v_plano, current_setting('t0111.insumo')::bigint, 5, 'parcial');
  select reserva_desatualizada into v_flag from public.planejamento where id = v_plano;
  if v_flag then raise exception '0111: nova reserva nao limpou a marca'; end if;
  update public.planejamento set status_operacional = 'em_execucao' where id = v_plano;
  perform set_config('app.planejamento_transicao', '', true);

  begin
    insert into public.planejamento_itens(planejamento_id, codigo_analise, n_amostras) values (v_plano, 'TS-0111', 1);
    raise exception '0111: item incluido em plano em execucao';
  exception when invalid_parameter_value then null;
  end;
end $$;

rollback;
