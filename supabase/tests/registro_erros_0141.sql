-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0141: registro de erros gravado so pelo service_role, lido so pelo
-- admin, aviso de hora em hora sem repetir e limpeza dos registros antigos.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0141-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0141-' || p_rotulo)::uuid,
                      'email', 'ts-0141-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

do $$
declare
  v_rotulo text;
  v_avisos integer;
begin
  if to_regclass('public.erros_app') is null then
    raise exception '0141: tabela erros_app ausente';
  end if;
  if has_table_privilege('anon', 'public.erros_app', 'SELECT')
     or has_table_privilege('anon', 'public.erros_app', 'INSERT')
     or has_table_privilege('authenticated', 'public.erros_app', 'INSERT') then
    raise exception '0141: erros_app aberta demais (anon lê/grava ou usuário grava)';
  end if;
  if not has_table_privilege('service_role', 'public.erros_app', 'INSERT') then
    raise exception '0141: service_role não grava erros';
  end if;
  if has_function_privilege('authenticated', 'kontrol_private.verificar_erros()', 'EXECUTE') then
    raise exception '0141: verificar_erros executável por usuário';
  end if;

  foreach v_rotulo in array array['admin', 'tecnico'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0141-' || v_rotulo)::uuid,
            'authenticated', 'authenticated', 'ts-0141-' || v_rotulo || '@example.invalid',
            '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis set papel = v_rotulo, suspenso = false, senha_provisoria = false
     where id = md5('kontrol-0141-' || v_rotulo)::uuid;
  end loop;

  -- Sem erro na última hora: nenhum aviso.
  delete from public.notificacoes where dedupe_key like 'erros-app:%';
  delete from public.erros_app;
  if kontrol_private.verificar_erros() <> 0 then
    raise exception '0141: avisou sem nenhum erro';
  end if;

  -- Dois erros recentes e um antigo: um aviso, sem repetir na mesma hora; o antigo sai.
  insert into public.erros_app(origem, rota, mensagem, ocorrido_em)
  values ('servidor', '/estoque', 'falha A', now()),
         ('banco', '/compras', 'falha B', now()),
         ('navegador', '/velho', 'falha antiga', now() - interval '91 days');
  v_avisos := kontrol_private.verificar_erros();
  if v_avisos <> 1 then
    raise exception '0141: dois erros recentes deveriam gerar um aviso (avisos %)', v_avisos;
  end if;
  if kontrol_private.verificar_erros() <> 0 then
    raise exception '0141: repetiu o aviso na mesma hora';
  end if;
  if not exists (select 1 from public.notificacoes
                  where dedupe_key like 'erros-app:%' and papel_destino = 'admin'
                    and titulo = '2 erros no app na última hora') then
    raise exception '0141: aviso não foi para o admin com a contagem certa';
  end if;
  if exists (select 1 from public.erros_app where rota = '/velho') then
    raise exception '0141: registro com mais de 90 dias não foi apagado';
  end if;

  -- Mensagem acima do limite é recusada (o app corta antes de gravar).
  begin
    insert into public.erros_app(origem, mensagem) values ('servidor', repeat('x', 2001));
    raise exception '0141: aceitou mensagem acima do limite';
  exception when check_violation then null;
  end;
end $$;

-- Leitura: admin vê, técnico não; usuário não grava.
set local role authenticated;
select pg_temp.como('tecnico');
do $$
begin
  if exists (select 1 from public.erros_app) then
    raise exception '0141: técnico enxerga o registro de erros';
  end if;
  begin
    insert into public.erros_app(origem, mensagem) values ('navegador', 'forjado');
    raise exception '0141: usuário conseguiu gravar erro direto';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.como('admin');
do $$
begin
  if not exists (select 1 from public.erros_app) then
    raise exception '0141: admin não enxerga o registro de erros';
  end if;
end $$;
reset role;

rollback;
