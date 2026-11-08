-- SOMENTE clone sintético local. Valida a 0162: registrar e acompanhar
-- incidentes, avisos e permissão. Termina em ROLLBACK.
\if :{?kontrol_test_local}
\else
  \echo '0162: falta acknowledgement explícito de banco descartável local.'
  \quit 3
\endif
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $$
begin
  if inet_server_addr() is not null
     and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception '0162: conexão não local.';
  end if;
end $$;

do $$
declare
  v_coord uuid := md5('kontrol-0162-coord')::uuid;
  v_lab uuid := md5('kontrol-0162-lab')::uuid;
  v_inc bigint;
  n integer;
  v_causa text;
begin
  insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at) values
    ('00000000-0000-0000-0000-000000000000', v_coord, 'authenticated', 'authenticated', 'ts-0162-coord@example.invalid', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_lab, 'authenticated', 'authenticated', 'ts-0162-lab@example.invalid', now(), now());
  update public.perfis set papel = 'coordenador', suspenso = false, senha_provisoria = false where id = v_coord;
  update public.perfis set papel = 'laboratorio', suspenso = false, senha_provisoria = false where id = v_lab;

  -- Laboratório não registra.
  perform set_config('request.jwt.claim.sub', v_lab::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lab, 'role', 'authenticated')::text, true);
  begin
    perform public.registrar_incidente('TS-0162 negado', 'x', 'todos', 'aguarde');
    raise exception '0162: Laboratório registrou incidente';
  exception when insufficient_privilege then null;
  end;

  -- Coordenador registra; causa vazia fica desconhecida; aviso para todos.
  perform set_config('request.jwt.claim.sub', v_coord::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  v_inc := public.registrar_incidente('TS-0162 freezer', 'Freezer -80 desligou.', 'Laboratório de DNA',
    'Não abra o freezer; use o freezer reserva.', '  ', 'laboratorio');
  select causa into v_causa from public.incidentes where id = v_inc;
  if v_causa is not null then
    raise exception '0162: causa em branco não ficou desconhecida';
  end if;
  select count(*) into n from public.notificacoes
   where entidade_tipo = 'incidente' and entidade_id = v_inc and papel_destino = 'laboratorio'
     and corpo like '%ainda desconhecida%';
  if n <> 1 then
    raise exception '0162: aviso de abertura errado (%)', n;
  end if;

  -- Laboratório lê o incidente e o aviso.
  perform set_config('request.jwt.claim.sub', v_lab::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lab, 'role', 'authenticated')::text, true);
  if not kontrol_private.notificacao_visivel(null, 'laboratorio', null) then
    raise exception '0162: Laboratório não vê o aviso';
  end if;
  begin
    perform public.atualizar_incidente(v_inc, 'resolvido', 'tentei');
    raise exception '0162: Laboratório atualizou incidente';
  exception when insufficient_privilege then null;
  end;

  -- Coordenador acompanha e resolve com causa.
  perform set_config('request.jwt.claim.sub', v_coord::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  perform public.atualizar_incidente(v_inc, 'em_andamento', 'Técnico chamado.');
  perform public.atualizar_incidente(v_inc, 'resolvido', 'Freezer religado.', 'Disjuntor desarmou.');
  select count(*) into n from public.incidentes
   where id = v_inc and situacao = 'resolvido' and resolvido_em is not null and causa = 'Disjuntor desarmou.'
     and orientacao like 'Não abra%';
  if n <> 1 then
    raise exception '0162: resolução não gravou';
  end if;
  select count(*) into n from public.incidentes_atualizacoes where incidente_id = v_inc;
  if n <> 3 then
    raise exception '0162: acompanhamento com % passos', n;
  end if;
  select count(*) into n from public.notificacoes where entidade_tipo = 'incidente' and entidade_id = v_inc;
  if n <> 3 then
    raise exception '0162: % avisos em vez de 3', n;
  end if;
  -- Reabrir limpa a data de resolução.
  perform public.atualizar_incidente(v_inc, 'aberto', 'Desligou de novo.');
  if (select resolvido_em from public.incidentes where id = v_inc) is not null then
    raise exception '0162: reabrir não limpou resolvido_em';
  end if;
  begin
    perform public.atualizar_incidente(v_inc, 'sumido', 'x');
    raise exception '0162: situação inválida aceita';
  exception when invalid_parameter_value then null;
  end;
  -- Escrita direta é negada.
  begin
    execute 'set local role authenticated';
    update public.incidentes set titulo = 'mexido' where id = v_inc;
    raise exception '0162: update direto passou';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
