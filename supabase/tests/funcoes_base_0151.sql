-- SOMENTE clone sintético local. Valida a 0151: vínculo de projeto pelo Admin
-- (configurar_vinculo_projeto) e proteção do último Administrador ativo.
-- Termina em ROLLBACK.
\if :{?kontrol_test_local}
\else
  \echo '0151: falta acknowledgement explícito de banco descartável local.'
  \quit 3
\endif
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $$
begin
  if inet_server_addr() is not null
     and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception '0151: conexão não local.';
  end if;
end $$;

create function pg_temp.uid(p text) returns uuid language sql immutable
as $$ select md5('kontrol-0151-' || p)::uuid $$;
create function pg_temp.sid(p text) returns uuid language sql immutable
as $$ select md5('kontrol-0151-sessao-' || p)::uuid $$;
create function pg_temp.como(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.uid(p)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', pg_temp.uid(p), 'role', 'authenticated', 'session_id', pg_temp.sid(p),
    'email', 'ts-0151-' || p || '@example.invalid')::text, true);
end $$;
grant execute on function pg_temp.uid(text), pg_temp.sid(text), pg_temp.como(text) to authenticated;

insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.uid(r), 'authenticated', 'authenticated',
       'ts-0151-' || r || '@example.invalid', now(), now()
from unnest(array['admin', 'admin2', 'coord', 'lab']) r;
insert into auth.sessions(id, user_id, created_at, updated_at)
select pg_temp.sid(r), pg_temp.uid(r), now(), now()
from unnest(array['admin', 'admin2', 'coord', 'lab']) r;
update public.perfis set suspenso = false, senha_provisoria = false, permissoes = '{}'::jsonb
 where id in (pg_temp.uid('admin'), pg_temp.uid('admin2'), pg_temp.uid('coord'), pg_temp.uid('lab'));
update public.perfis set papel = 'admin' where id = pg_temp.uid('admin');
update public.perfis set papel = 'coordenador' where id = pg_temp.uid('coord');
update public.perfis set papel = 'laboratorio' where id in (pg_temp.uid('lab'), pg_temp.uid('admin2'));

do $$
declare
  v_p bigint;
begin
  insert into public.projetos (nome) values ('TS-0151 projeto') returning id into v_p;
  perform set_config('t0151.projeto', v_p::text, true);
end $$;

set local role authenticated;

-- ---- 1. Vínculo de projeto ------------------------------------------------------
do $$
declare
  v_p bigint := current_setting('t0151.projeto')::bigint;
  v_coord uuid := pg_temp.uid('coord');
  r jsonb;
begin
  -- só Admin
  perform pg_temp.como('coord');
  begin
    perform public.configurar_vinculo_projeto(v_p, v_coord, true);
    raise exception '0151: Coordenador configurou vínculo';
  exception when insufficient_privilege then null;
  end;

  -- sem sessão válida, nem o Admin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', pg_temp.uid('admin'), 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
  perform set_config('request.jwt.claim.sub', pg_temp.uid('admin')::text, true);
  begin
    perform public.configurar_vinculo_projeto(v_p, v_coord, true);
    raise exception '0151: vínculo aceito com sessão inexistente';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.como('admin');
  -- vínculo explícito só para Coordenador ou Gestor
  begin
    perform public.configurar_vinculo_projeto(v_p, pg_temp.uid('lab'), true);
    raise exception '0151: Laboratório recebeu vínculo de projeto';
  exception when invalid_parameter_value then null;
  end;

  r := public.configurar_vinculo_projeto(v_p, v_coord, true);
  if not (r ->> 'alterado')::boolean or not (r ->> 'vinculado')::boolean then
    raise exception '0151: vínculo não criado: %', r;
  end if;
  r := public.configurar_vinculo_projeto(v_p, v_coord, true);
  if (r ->> 'alterado')::boolean then
    raise exception '0151: vincular de novo deveria ser neutro: %', r;
  end if;
  r := public.configurar_vinculo_projeto(v_p, v_coord, false);
  if not (r ->> 'alterado')::boolean then
    raise exception '0151: desvincular não alterou: %', r;
  end if;
end $$;

reset role;
do $$
declare
  v_chave text := current_setting('t0151.projeto') || ':' || pg_temp.uid('coord')::text;
begin
  -- uma linha de trilha por mudança, sem duplicar com o gatilho da 0167
  if (select count(*) from public.auditoria where tabela = 'projetos_vinculos' and registro_id = v_chave) <> 2
     or not exists (select 1 from public.auditoria where tabela = 'projetos_vinculos'
                     and registro_id = v_chave and acao = 'insert')
     or not exists (select 1 from public.auditoria where tabela = 'projetos_vinculos'
                     and registro_id = v_chave and acao = 'delete') then
    raise exception '0151: trilha do vínculo errada (% linhas)',
      (select count(*) from public.auditoria where tabela = 'projetos_vinculos' and registro_id = v_chave);
  end if;
end $$;

-- ---- 2. Último Administrador ativo -----------------------------------------------
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
do $$
begin
  if exists (select 1 from public.perfis where papel = 'admin' and not suspenso and not senha_provisoria
              and id <> pg_temp.uid('admin')) then
    raise notice '0151: há outro Admin ativo no banco; proteção do último Admin não testada aqui';
    return;
  end if;
  begin
    update public.perfis set papel = 'laboratorio' where id = pg_temp.uid('admin');
    raise exception '0151: rebaixou o último Admin';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.perfis set suspenso = true where id = pg_temp.uid('admin');
    raise exception '0151: suspendeu o último Admin';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.perfis set senha_provisoria = true where id = pg_temp.uid('admin');
    raise exception '0151: último Admin voltou para senha provisória';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.perfis where id = pg_temp.uid('admin');
    raise exception '0151: apagou o último Admin';
  exception when insufficient_privilege then null;
  end;
  -- com outro Admin ativo, pode
  update public.perfis set papel = 'admin' where id = pg_temp.uid('admin2');
  update public.perfis set papel = 'laboratorio' where id = pg_temp.uid('admin');
  if (select papel from public.perfis where id = pg_temp.uid('admin')) <> 'laboratorio' then
    raise exception '0151: com outro Admin ativo o rebaixamento deveria passar';
  end if;
end $$;

rollback;
