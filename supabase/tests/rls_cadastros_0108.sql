-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Todas as fixtures e operacoes sao revertidas no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
declare
  t text;
  campo text;
  rotulo text;
  uid uuid;
  chave text;
  op text;
  p record;
begin
  if to_regprocedure('kontrol_private.pode_editar_cadastro(text)') is null
    or to_regprocedure('public.__rls0108_probe(text,boolean)') is not null then
    raise exception '0108: migration ausente ou probe ja existente';
  end if;
  if has_function_privilege('anon', 'kontrol_private.pode_editar_cadastro(text)', 'EXECUTE')
    or has_schema_privilege('anon', 'kontrol_private', 'USAGE') then
    raise exception '0108: helper privado acessivel a anon';
  end if;

  foreach t in array array[
    'projetos', 'insumos', 'equipamentos', 'tecnicos',
    'overhead', 'clientes', 'fornecedores', 'locais'
  ] loop
    chave := case t when 'projetos' then 'projetos.editar'
      when 'insumos' then 'insumos.editar' else 'cadastros.editar' end;
    campo := case t when 'insumos' then 'especificacao'
      when 'overhead' then 'item' else 'nome' end;
    if (select count(*) from pg_catalog.pg_policies
        where schemaname = 'public' and tablename = t
          and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')) <> 3 then
      raise exception '0108: policy write extra/ausente em %', t;
    end if;
    foreach op in array array['insert', 'update', 'delete'] loop
      select * into p from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = t
        and policyname = format('rls_permissao_%s_%s', op, t)
        and cmd = upper(op);
      if not found or p.roles <> array['authenticated']::name[]
        or position(format('%s(''%s''', case when t = 'insumos'
                      then 'tem_permissao_efetiva' else 'pode_editar_cadastro' end, chave)
                    in coalesce(p.qual, '') || coalesce(p.with_check, '')) = 0 then
        raise exception '0108: policy incorreta em %/%', t, op;
      end if;
    end loop;

    execute format('insert into public.%I (%I) values ($1)', t, campo)
      using format('TS-RLS0108-UPDATE-%s', t);
    foreach rotulo in array array[
      'tecnico_true', 'tecnico_false', 'coordenador_true',
      'coordenador_false', 'gestor_false', 'admin', 'suspenso',
      'sem_perfil', 'categoria', 'anon'
    ] loop
      execute format('insert into public.%I (%I) values ($1)', t, campo)
        using format('TS-RLS0108-DELETE-%s-%s', rotulo, t);
    end loop;
  end loop;

  -- Defaults do clone sao controlados somente dentro desta transacao.
  update public.permissoes_categorias
  set permissoes = jsonb_build_object(
    'projetos.editar', true, 'insumos.editar', true, 'cadastros.editar', true)
  where papel = 'coordenador';
  if not found then raise exception '0108: categoria coordenador ausente'; end if;

  foreach rotulo in array array[
    'tecnico_true', 'tecnico_false', 'coordenador_true',
    'coordenador_false', 'gestor_false', 'admin', 'suspenso',
    'sem_perfil', 'categoria'
  ] loop
    uid := md5('kontrol-rls-0108-' || rotulo)::uuid;
    if exists(select 1 from auth.users where id = uid) then
      raise exception '0108: fixture id ja existe para %', rotulo;
    end if;
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values (
      '00000000-0000-0000-0000-000000000000', uid,
      'authenticated', 'authenticated',
      format('ts-rls-0108-%s@example.invalid', rotulo), now(), now()
    );
    if rotulo = 'sem_perfil' then
      delete from public.perfis where id = uid;
    else
      update public.perfis
      set papel = case
          when rotulo like 'tecnico_%' then 'tecnico'
          when rotulo like 'coordenador_%' or rotulo = 'categoria' then 'coordenador'
          when rotulo = 'gestor_false' then 'gestor'
          else 'admin' end,
        suspenso = (rotulo = 'suspenso'),
        permissoes = case
          when rotulo in ('tecnico_true', 'coordenador_true', 'suspenso')
            then jsonb_build_object('projetos.editar', true,
              'insumos.editar', true, 'cadastros.editar', true)
          when rotulo = 'categoria' then '{}'::jsonb
          else jsonb_build_object('projetos.editar', false,
            'insumos.editar', false, 'cadastros.editar', false) end
      where id = uid;
      if not found then raise exception '0108: perfil fixture ausente para %', rotulo; end if;
    end if;
  end loop;
  perform set_config('rls0108.audit_baseline',
    (select count(*)::text from public.auditoria), true);
end $$;

-- SECURITY INVOKER: as queries abaixo rodam com o papel/JWT sintetico,
-- passando pelas policies reais, e nunca recebem tabela/coluna do runner.
create function public.__rls0108_probe(p_rotulo text, p_allow boolean)
returns void language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  t text;
  campo text;
  n bigint;
  marcador text;
begin
  foreach t in array array[
    'projetos', 'insumos', 'equipamentos', 'tecnicos',
    'overhead', 'clientes', 'fornecedores', 'locais'
  ] loop
    campo := case t when 'insumos' then 'especificacao'
      when 'overhead' then 'item' else 'nome' end;
    marcador := format('TS-RLS0108-INSERT-%s-%s', p_rotulo, t);
    begin
      execute format('insert into public.%I (%I) values ($1)', t, campo)
        using marcador;
      if not p_allow then
        raise exception '0108: INSERT indevido para %/%', p_rotulo, t;
      end if;
    exception when insufficient_privilege then
      if p_allow then raise; end if;
    end;

    begin
      execute format('update public.%I set %I = %I where %I = $1',
        t, campo, campo, campo)
        using format('TS-RLS0108-UPDATE-%s', t);
      get diagnostics n = row_count;
      if n <> (case when p_allow then 1 else 0 end) then
        raise exception '0108: UPDATE divergente para %/%: %', p_rotulo, t, n;
      end if;
    exception when insufficient_privilege then
      if p_allow then raise; end if;
    end;

    begin
      execute format('delete from public.%I where %I = $1', t, campo)
        using format('TS-RLS0108-DELETE-%s-%s', p_rotulo, t);
      get diagnostics n = row_count;
      if n <> (case when p_allow then 1 else 0 end) then
        raise exception '0108: DELETE divergente para %/%: %', p_rotulo, t, n;
      end if;
    exception when insufficient_privilege then
      if p_allow then raise; end if;
    end;
  end loop;

  if p_rotulo = 'tecnico_false' then
    begin
      update public.perfis set permissoes = jsonb_build_object(
        'projetos.editar', true, 'insumos.editar', true, 'cadastros.editar', true)
      where id = auth.uid();
      get diagnostics n = row_count;
      if n <> 0 then raise exception '0108: tecnico se auto-concedeu permissoes'; end if;
    exception when insufficient_privilege then null;
    end;
  end if;
  if p_rotulo = 'admin' and (
    kontrol_private.pode_editar_cadastro(null)
    or kontrol_private.pode_editar_cadastro('usuarios.gerenciar')
  ) then
    raise exception '0108: helper aceitou chave nula/desconhecida para admin';
  end if;
end $$;

revoke all on function public.__rls0108_probe(text, boolean) from public;
grant execute on function public.__rls0108_probe(text, boolean) to authenticated, anon;

set local role authenticated;
select set_config('request.jwt.claim.sub', md5('kontrol-rls-0108-tecnico_true')::uuid::text, true);
select public.__rls0108_probe('tecnico_true', true);
select set_config('request.jwt.claim.sub', md5('kontrol-rls-0108-tecnico_false')::uuid::text, true);
select public.__rls0108_probe('tecnico_false', false);
select set_config('request.jwt.claim.sub', md5('kontrol-rls-0108-coordenador_true')::uuid::text, true);
select public.__rls0108_probe('coordenador_true', true);
select set_config('request.jwt.claim.sub', md5('kontrol-rls-0108-coordenador_false')::uuid::text, true);
select public.__rls0108_probe('coordenador_false', false);
select set_config('request.jwt.claim.sub', md5('kontrol-rls-0108-gestor_false')::uuid::text, true);
select public.__rls0108_probe('gestor_false', false);
select set_config('request.jwt.claim.sub', md5('kontrol-rls-0108-admin')::uuid::text, true);
select public.__rls0108_probe('admin', true);
select set_config('request.jwt.claim.sub', md5('kontrol-rls-0108-suspenso')::uuid::text, true);
select public.__rls0108_probe('suspenso', false);
select set_config('request.jwt.claim.sub', md5('kontrol-rls-0108-sem_perfil')::uuid::text, true);
select public.__rls0108_probe('sem_perfil', false);
select set_config('request.jwt.claim.sub', md5('kontrol-rls-0108-categoria')::uuid::text, true);
select public.__rls0108_probe('categoria', true);
reset role;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select public.__rls0108_probe('anon', false);
reset role;

do $$
begin
  if (select count(*) from public.auditoria)
      <= current_setting('rls0108.audit_baseline')::bigint then
    raise exception '0108: trilha de auditoria nao registrou as escritas permitidas';
  end if;
end $$;

rollback;
