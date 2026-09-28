-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0134: registro dos backups so para o dono/service_role, leitura so
-- do admin, e o aviso diario de atraso e de falha (sem duplicar no mesmo dia).
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0134-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0134-' || p_rotulo)::uuid,
                      'email', 'ts-0134-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

do $$
declare
  v_rotulo text;
  v_avisos integer;
begin
  if to_regclass('public.backups_execucoes') is null then
    raise exception '0134: tabela backups_execucoes ausente';
  end if;
  if has_table_privilege('anon', 'public.backups_execucoes', 'SELECT')
     or has_table_privilege('authenticated', 'public.backups_execucoes', 'INSERT') then
    raise exception '0134: backups_execucoes aberta demais (anon lê ou usuário grava)';
  end if;
  if has_function_privilege('authenticated', 'kontrol_private.verificar_backups()', 'EXECUTE') then
    raise exception '0134: verificar_backups executável por usuário';
  end if;

  foreach v_rotulo in array array['admin', 'tecnico'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0134-' || v_rotulo)::uuid,
            'authenticated', 'authenticated', 'ts-0134-' || v_rotulo || '@example.invalid',
            '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis set papel = v_rotulo, suspenso = false, senha_provisoria = false
     where id = md5('kontrol-0134-' || v_rotulo)::uuid;
  end loop;

  -- Sem nenhum backup registrado: um aviso de atraso por tipo, sem repetir no mesmo dia.
  -- (começa sem avisos de backup: a rotina diária pode já ter rodado hoje neste banco)
  delete from public.notificacoes where dedupe_key like 'backup-%';
  delete from public.backups_execucoes;
  v_avisos := kontrol_private.verificar_backups();
  if v_avisos <> 2 then
    raise exception '0134: sem backup deveria avisar banco e arquivos (avisos %)', v_avisos;
  end if;
  if kontrol_private.verificar_backups() <> 0 then
    raise exception '0134: repetiu o aviso de atraso no mesmo dia';
  end if;
  if not exists (select 1 from public.notificacoes
                  where dedupe_key = 'backup-atrasado:banco:' || current_date and papel_destino = 'admin') then
    raise exception '0134: aviso de atraso do banco não foi para o admin';
  end if;

  -- Backups bons recentes + uma falha do banco: só o aviso de falha.
  delete from public.notificacoes where dedupe_key like 'backup-%';
  insert into public.backups_execucoes(tipo, status, tamanho_bytes, origem)
  values ('banco', 'ok', 1000, 'ts-0134'), ('arquivos', 'ok', 10, 'ts-0134'),
         ('banco', 'falha', null, 'ts-0134');
  v_avisos := kontrol_private.verificar_backups();
  if v_avisos <> 1 or not exists (select 1 from public.notificacoes where dedupe_key = 'backup-falhou:banco:' || current_date) then
    raise exception '0134: falha recente deveria gerar só o aviso de falha (avisos %)', v_avisos;
  end if;

  -- Backup bom de 30 horas atrás: atraso de novo.
  delete from public.notificacoes where dedupe_key like 'backup-%';
  delete from public.backups_execucoes;
  insert into public.backups_execucoes(tipo, status, concluido_em)
  values ('banco', 'ok', now() - interval '30 hours'), ('arquivos', 'ok', now());
  -- chamada separada da checagem: no mesmo comando, a subconsulta não veria o aviso recém-criado
  v_avisos := kontrol_private.verificar_backups();
  if v_avisos <> 1
     or not exists (select 1 from public.notificacoes where dedupe_key = 'backup-atrasado:banco:' || current_date) then
    raise exception '0134: backup de 30 horas atrás deveria contar como atraso (avisos %)', v_avisos;
  end if;
end $$;

-- Leitura: admin vê, técnico não.
set local role authenticated;
select pg_temp.como('tecnico');
do $$
begin
  if exists (select 1 from public.backups_execucoes) then
    raise exception '0134: técnico enxerga o registro de backups';
  end if;
  begin
    insert into public.backups_execucoes(tipo, status) values ('banco', 'ok');
    raise exception '0134: usuário conseguiu registrar backup';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.como('admin');
do $$
begin
  if not exists (select 1 from public.backups_execucoes) then
    raise exception '0134: admin não enxerga o registro de backups';
  end if;
end $$;
reset role;

rollback;
