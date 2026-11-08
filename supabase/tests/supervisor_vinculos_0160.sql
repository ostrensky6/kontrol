-- SOMENTE clone sintético local. Valida a 0160: Supervisor (nível e caixinhas)
-- e vínculos de projeto de Coordenador/Gestor. Termina em ROLLBACK.
\if :{?kontrol_test_local}
\else
  \echo '0160: falta acknowledgement explícito de banco descartável local.'
  \quit 3
\endif
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $$
begin
  if inet_server_addr() is not null
     and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception '0160: conexão não local.';
  end if;
end $$;

do $$
declare
  v_admin uuid := md5('kontrol-0160-admin')::uuid;
  v_sup uuid := md5('kontrol-0160-sup')::uuid;
  v_coord uuid := md5('kontrol-0160-coord')::uuid;
  v_gestor uuid := md5('kontrol-0160-gestor')::uuid;
  v_p1 bigint; v_p2 bigint; v_p3 bigint; v_pedido bigint;
  n integer;
begin
  -- Níveis: Supervisor entre Gestor e Admin.
  if not (kontrol_private.nivel_papel('gestor') < kontrol_private.nivel_papel('supervisor')
          and kontrol_private.nivel_papel('supervisor') < kontrol_private.nivel_papel('admin')
          and kontrol_private.nivel_papel('coordenador') < kontrol_private.nivel_papel('gestor')) then
    raise exception '0160: hierarquia errada';
  end if;

  insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at) values
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated', 'ts-0160-admin@example.invalid', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_sup, 'authenticated', 'authenticated', 'ts-0160-sup@example.invalid', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_coord, 'authenticated', 'authenticated', 'ts-0160-coord@example.invalid', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_gestor, 'authenticated', 'authenticated', 'ts-0160-gestor@example.invalid', now(), now());
  update public.perfis set papel = 'admin', suspenso = false, senha_provisoria = false where id = v_admin;
  update public.perfis set papel = 'supervisor', suspenso = false, senha_provisoria = false where id = v_sup;
  update public.perfis set papel = 'coordenador', suspenso = false, senha_provisoria = false,
    permissoes = jsonb_build_object('projetos.editar', true) where id = v_coord;
  update public.perfis set papel = 'gestor', suspenso = false, senha_provisoria = false,
    permissoes = jsonb_build_object('projetos.editar', true) where id = v_gestor;

  insert into public.projetos (nome) values ('TS-0160 ligado') returning id into v_p1;
  insert into public.projetos (nome) values ('TS-0160 sem vínculo') returning id into v_p2;
  insert into public.projetos (nome, coordenador_id) values ('TS-0160 coordenado', v_coord) returning id into v_p3;
  insert into kontrol_private.projetos_vinculos (projeto_id, usuario_id) values (v_p1, v_coord), (v_p1, v_gestor);

  -- Supervisor: alcança "Gestor ou acima", não "Admin"; tem caixinhas do Gestor.
  perform set_config('request.jwt.claim.sub', v_sup::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_sup, 'role', 'authenticated')::text, true);
  if not public.papel_minimo('gestor') or public.papel_minimo('admin') then
    raise exception '0160: papel_minimo do Supervisor errado';
  end if;
  if (select permissoes from public.permissoes_categorias where papel = 'supervisor')
     is distinct from (select permissoes from public.permissoes_categorias where papel = 'gestor') then
    raise exception '0160: Supervisor não recebeu as caixinhas do Gestor';
  end if;
  -- Supervisor não precisa de vínculo.
  if not kontrol_private.pode_agir_no_projeto(v_p2) then
    raise exception '0160: Supervisor barrado por vínculo';
  end if;

  -- Coordenador: age no ligado e no que coordena; barrado no outro.
  perform set_config('request.jwt.claim.sub', v_coord::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  if not kontrol_private.pode_agir_no_projeto(v_p1) or not kontrol_private.pode_agir_no_projeto(v_p3)
     or kontrol_private.pode_agir_no_projeto(v_p2) then
    raise exception '0160: vínculo do Coordenador errado';
  end if;
  update public.projetos set descricao = 'ok' where id = v_p1;
  begin
    update public.projetos set descricao = 'não' where id = v_p2;
    raise exception '0160: Coordenador alterou projeto sem vínculo';
  exception when insufficient_privilege then null;
  end;

  -- Gestor que cria um projeto fica ligado a ele.
  perform set_config('request.jwt.claim.sub', v_gestor::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);
  insert into public.projetos (nome) values ('TS-0160 do gestor') returning id into v_p2;
  if not exists (select 1 from kontrol_private.projetos_vinculos where projeto_id = v_p2 and usuario_id = v_gestor) then
    raise exception '0160: criador não foi ligado ao projeto';
  end if;

  -- Pedido interno em validação de projeto sem vínculo: Coordenador não decide.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.pedido_interno_transicao', 'permitida', true);
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id)
  values ('TS-0160 pedido', 'rascunho', 'ts-0160-pedinte@example.invalid', v_p2) returning id into v_pedido;
  update public.pedidos_internos set status = 'em_validacao' where id = v_pedido;
  perform set_config('request.jwt.claim.sub', v_coord::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  begin
    update public.pedidos_internos set status = 'validado' where id = v_pedido;
    raise exception '0160: Coordenador validou pedido de projeto sem vínculo';
  exception when insufficient_privilege then null;
  end;

  -- Lista de quem atua: só o Admin.
  begin
    perform * from public.vinculos_projeto(v_p1);
    raise exception '0160: Coordenador listou vínculos';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select count(*) into n from public.vinculos_projeto(v_p1) v where v.vinculado;
  if n < 2 then
    raise exception '0160: lista de vínculos incompleta (%)', n;
  end if;
  if not exists (select 1 from public.vinculos_projeto(v_p3) v where v.usuario_id = v_coord and v.coordenador_cadastrado) then
    raise exception '0160: coordenador cadastrado não apareceu';
  end if;
end $$;

rollback;
