-- SOMENTE clone sintético local. Valida a 0158: avisos de manutenção e
-- calibração, antecedência configurável, encaminhamento e permissões.
-- Termina em ROLLBACK.
\if :{?kontrol_test_local}
\else
  \echo '0158: falta acknowledgement explícito de banco descartável local.'
  \quit 3
\endif
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $$
begin
  if inet_server_addr() is not null
     and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception '0158: conexão não local.';
  end if;
end $$;

do $$
declare
  v_admin uuid := md5('kontrol-0158-admin')::uuid;
  v_lab uuid := md5('kontrol-0158-lab')::uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_eq bigint; v_u1 bigint; v_u2 bigint; v_u3 bigint;
  r record;
begin
  insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at) values
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated', 'ts-0158-admin@example.invalid', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_lab, 'authenticated', 'authenticated', 'ts-0158-lab@example.invalid', now(), now());
  update public.perfis set papel = 'admin', suspenso = false, senha_provisoria = false where id = v_admin;
  update public.perfis set papel = 'compra', suspenso = false, senha_provisoria = false where id = v_lab;

  insert into public.equipamentos(nome) values ('TS-0158 balança') returning id into v_eq;
  insert into public.equipamento_unidades(equipamento_id, codigo_patrimonio) values (v_eq, 'TS-0158-1') returning id into v_u1;
  insert into public.equipamento_unidades(equipamento_id, codigo_patrimonio) values (v_eq, 'TS-0158-2') returning id into v_u2;
  insert into public.equipamento_unidades(equipamento_id, codigo_patrimonio) values (v_eq, 'TS-0158-3') returning id into v_u3;

  -- Plano do equipamento: calibração anual. A unidade 3 tem plano próprio
  -- com antecedência de 10 dias, que vale sobre o do equipamento.
  insert into public.equipamento_planos_manutencao(equipamento_id, tipo, periodicidade_dias, tolerancia_dias, obrigatorio, ativo)
  values (v_eq, 'calibracao', 365, 0, true, true);
  insert into public.equipamento_planos_manutencao(equipamento_unidade_id, tipo, periodicidade_dias, tolerancia_dias, obrigatorio, ativo, antecedencia_aviso_dias)
  values (v_u3, 'calibracao', 365, 0, true, true, 10);

  -- U1: calibrada há 300 dias → vence em 65 dias, dentro dos 90 padrão.
  insert into public.equipamento_manutencoes(equipamento_unidade_id, tipo, data_programada, data_conclusao, status)
  values (v_u1, 'calibracao', v_hoje - 300, v_hoje - 300, 'concluida');
  -- U2: sem nenhum registro.
  -- U3: calibrada há 300 dias, mas antecedência própria de 10 dias → sem aviso.
  insert into public.equipamento_manutencoes(equipamento_unidade_id, tipo, data_programada, data_conclusao, status)
  values (v_u3, 'calibracao', v_hoje - 300, v_hoje - 300, 'concluida');

  select * into r from public.v_equipamento_avisos where equipamento_unidade_id = v_u1;
  if r.situacao is distinct from 'proximo' or r.vencimento <> v_hoje + 65 or r.dias_para_vencer <> 65
     or r.antecedencia_dias <> 90 or r.encaminhado then
    raise exception '0158: aviso da unidade 1 errado: %', row_to_json(r);
  end if;
  select * into r from public.v_equipamento_avisos where equipamento_unidade_id = v_u2;
  if r.situacao is distinct from 'sem_registro' or r.vencimento is not null then
    raise exception '0158: unidade sem registro deveria avisar: %', row_to_json(r);
  end if;
  if exists (select 1 from public.v_equipamento_avisos where equipamento_unidade_id = v_u3) then
    raise exception '0158: plano da unidade deveria valer sobre o do equipamento';
  end if;

  -- Próxima data registrada vence antes do cálculo: vale a registrada.
  insert into public.equipamento_manutencoes(equipamento_unidade_id, tipo, data_programada, data_conclusao, proxima_data, status)
  values (v_u3, 'calibracao', v_hoje - 1, v_hoje - 1, v_hoje - 2, 'concluida');
  select * into r from public.v_equipamento_avisos where equipamento_unidade_id = v_u3;
  if r.situacao is distinct from 'vencido' or r.dias_para_vencer <> -2 then
    raise exception '0158: próxima data registrada ignorada: %', row_to_json(r);
  end if;

  -- Agendar a calibração conta como encaminhado.
  insert into public.equipamento_manutencoes(equipamento_unidade_id, tipo, data_programada, status)
  values (v_u3, 'calibracao', v_hoje + 5, 'agendada');
  if not (select encaminhado from public.v_equipamento_avisos where equipamento_unidade_id = v_u3) then
    raise exception '0158: manutenção agendada deveria contar como encaminhado';
  end if;

  -- Quem não edita cadastros não encaminha.
  perform set_config('request.jwt.claim.sub', v_lab::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lab, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.equipamento_aviso_encaminhamentos(equipamento_unidade_id, tipo, vencimento, decisao, observacao)
    values (v_u1, 'calibracao', v_hoje + 65, 'agendar', 'sem permissão');
    raise exception '0158: perfil sem cadastros.editar encaminhou aviso';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- Admin encaminha; o aviso continua na view, marcado como encaminhado.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.equipamento_aviso_encaminhamentos(equipamento_unidade_id, tipo, vencimento, decisao, observacao)
  values (v_u1, 'calibracao', v_hoje + 65, 'agendar', 'Pedir orçamento ao fornecedor');
  select * into r from public.v_equipamento_avisos where equipamento_unidade_id = v_u1;
  if not r.encaminhado or r.encaminhamento_decisao <> 'agendar' or r.encaminhado_por <> v_admin then
    raise exception '0158: encaminhamento não apareceu: %', row_to_json(r);
  end if;
  -- Não dá para apagar nem reescrever o encaminhamento.
  begin
    update public.equipamento_aviso_encaminhamentos set observacao = 'x' where equipamento_unidade_id = v_u1;
    raise exception '0158: encaminhamento foi reescrito';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.equipamento_aviso_encaminhamentos where equipamento_unidade_id = v_u1;
    raise exception '0158: encaminhamento foi apagado';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- A auditoria registrou o encaminhamento.
  if not exists (select 1 from public.auditoria a where a.tabela = 'equipamento_aviso_encaminhamentos') then
    raise exception '0158: encaminhamento sem auditoria';
  end if;
end $$;

rollback;
