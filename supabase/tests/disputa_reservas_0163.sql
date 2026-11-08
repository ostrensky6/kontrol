-- SOMENTE clone sintético local. Valida a 0163: pedido de reserva de outro
-- plano, decisão (transferir/negar) e trava contra decisão dupla. ROLLBACK.
\if :{?kontrol_test_local}
\else
  \echo '0163: falta acknowledgement explícito de banco descartável local.'
  \quit 3
\endif
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $$
begin
  if inet_server_addr() is not null
     and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception '0163: conexão não local.';
  end if;
end $$;

do $$
declare
  v_admin uuid := md5('kontrol-0163-admin')::uuid;
  v_lab uuid := md5('kontrol-0163-lab')::uuid;
  v_coord uuid := md5('kontrol-0163-coord')::uuid;
  v_insumo bigint; v_lote bigint; v_a bigint; v_b bigint; v_c bigint;
  v_disputa bigint; v_disputa2 bigint;
  v_res jsonb;
  n numeric;
begin
  insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at) values
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated', 'ts-0163-admin@example.invalid', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_lab, 'authenticated', 'authenticated', 'ts-0163-lab@example.invalid', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_coord, 'authenticated', 'authenticated', 'ts-0163-coord@example.invalid', now(), now());
  update public.perfis set papel = 'admin', suspenso = false, senha_provisoria = false where id = v_admin;
  update public.perfis set papel = 'laboratorio', suspenso = false, senha_provisoria = false,
    permissoes = jsonb_build_object('planejamento.executar', true, 'planejamento.ver', true) where id = v_lab;
  update public.perfis set papel = 'coordenador', suspenso = false, senha_provisoria = false where id = v_coord;

  insert into public.insumos (especificacao, fator_conversao) values ('TS-0163 enzima', 1) returning id into v_insumo;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade)
  values (v_insumo, 'TS-0163-L1', 10, 10, 'aceito', current_date + 200) returning id into v_lote;
  insert into public.planejamento (nome) values ('TS-0163 A') returning id into v_a;
  insert into public.planejamento (nome) values ('TS-0163 B') returning id into v_b;
  insert into public.planejamento (nome) values ('TS-0163 C') returning id into v_c;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'ts-0163-admin@example.invalid')::text, true);
  perform public.reservar_plano(v_a, jsonb_build_array(jsonb_build_object('insumo_id', v_insumo, 'quantidade', 10)));
  perform public.reservar_plano(v_b, jsonb_build_array(jsonb_build_object('insumo_id', v_insumo, 'quantidade', 4)));
  perform public.reservar_plano(v_c, jsonb_build_array(jsonb_build_object('insumo_id', v_insumo, 'quantidade', 2)));
  if kontrol_private.falta_reservada(v_b, v_insumo) <> 4 then
    raise exception '0163: preparo errado, falta de B = %', kontrol_private.falta_reservada(v_b, v_insumo);
  end if;

  -- Laboratório pede; A aparece como candidato.
  perform set_config('request.jwt.claim.sub', v_lab::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lab, 'role', 'authenticated')::text, true);
  begin
    perform public.pedir_reserva_de_outro_plano(v_a, v_insumo, 'A não tem falta');
    raise exception '0163: pedido sem falta aceito';
  exception when invalid_parameter_value then null;
  end;
  v_disputa := public.pedir_reserva_de_outro_plano(v_b, v_insumo, 'B começa antes');
  begin
    perform public.pedir_reserva_de_outro_plano(v_b, v_insumo, 'de novo');
    raise exception '0163: pedido duplicado aceito';
  exception when unique_violation then null;
  end;
  select reservado into n from public.planos_com_reserva(v_insumo, v_b) where planejamento_id = v_a;
  if n is distinct from 10 then
    raise exception '0163: candidato A com % reservado', n;
  end if;
  if not exists (select 1 from public.notificacoes where entidade_tipo = 'disputa_reserva' and entidade_id = v_disputa) then
    raise exception '0163: pedido sem aviso';
  end if;
  -- Laboratório não decide.
  begin
    perform public.decidir_disputa_reserva(v_disputa, 'transferir', v_a, 'eu decido');
    raise exception '0163: Laboratório decidiu';
  exception when insufficient_privilege then null;
  end;

  -- Coordenador transfere.
  perform set_config('request.jwt.claim.sub', v_coord::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  begin
    perform public.decidir_disputa_reserva(v_disputa, 'transferir', v_a, '  ');
    raise exception '0163: decisão sem motivo aceita';
  exception when invalid_parameter_value then null;
  end;
  v_res := public.decidir_disputa_reserva(v_disputa, 'transferir', v_a, 'B tem prazo de entrega');
  if (v_res->>'transferido')::numeric <> 4 then
    raise exception '0163: transferiu % em vez de 4', v_res->>'transferido';
  end if;
  if kontrol_private.falta_reservada(v_b, v_insumo) <> 0 then
    raise exception '0163: B continua com falta';
  end if;
  select sum(quantidade) into n from public.reservas_estoque
   where planejamento_id = v_b and lote_id = v_lote and status = 'reservado';
  if n is distinct from 4 then
    raise exception '0163: B recebeu %', n;
  end if;
  select sum(quantidade) into n from public.reservas_estoque
   where planejamento_id = v_a and lote_id = v_lote and status = 'reservado';
  if n is distinct from 6 then
    raise exception '0163: A ficou com % reservado', n;
  end if;
  if kontrol_private.falta_reservada(v_a, v_insumo) <> 4 then
    raise exception '0163: A não ganhou a falta cedida';
  end if;
  -- Soma reservada do lote não passa do saldo.
  select sum(quantidade) into n from public.reservas_estoque where lote_id = v_lote and status = 'reservado';
  if n > 10 then
    raise exception '0163: lote reservado acima do saldo (%)', n;
  end if;
  -- Segunda decisão do mesmo pedido é recusada.
  begin
    perform public.decidir_disputa_reserva(v_disputa, 'negar', null, 'tarde');
    raise exception '0163: decisão dupla aceita';
  exception when object_not_in_prerequisite_state then null;
  end;

  -- Negar: C pede, Coordenador nega; nada muda nas reservas.
  perform set_config('request.jwt.claim.sub', v_lab::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lab, 'role', 'authenticated')::text, true);
  v_disputa2 := public.pedir_reserva_de_outro_plano(v_c, v_insumo, 'C também precisa');
  perform set_config('request.jwt.claim.sub', v_coord::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  v_res := public.decidir_disputa_reserva(v_disputa2, 'negar', null, 'Compra chega amanhã');
  if v_res->>'status' <> 'negada' or kontrol_private.falta_reservada(v_c, v_insumo) <> 2 then
    raise exception '0163: negar mexeu nas reservas';
  end if;
  if not exists (select 1 from public.notificacoes where entidade_tipo = 'disputa_reserva'
                  and entidade_id = v_disputa2 and usuario_destino = v_lab) then
    raise exception '0163: quem pediu não foi avisado';
  end if;
  -- A trilha da auditoria registrou os pedidos.
  if not exists (select 1 from public.auditoria where tabela = 'reservas_disputas') then
    raise exception '0163: sem auditoria';
  end if;
end $$;

rollback;
