-- 0134 — registro dos backups e alerta de atraso (auditoria de 27/09/2026, item 3).
--
-- Os backups rodam no computador do laboratório (tarefa agendada do Windows),
-- e uma falha não avisava ninguém. Agora cada execução fica registrada aqui
-- (banco: pg_dump; arquivos: cópia do Storage), e uma rotina diária avisa os
-- administradores em Notificações quando o último backup bom ficou velho ou
-- quando houve falha. Pega também o computador desligado e a tarefa parada.
--
-- Rollback: cron.unschedule('kontrol-backup-verificacao'); drop function
-- kontrol_private.verificar_backups(); drop table public.backups_execucoes.

begin;

create table if not exists public.backups_execucoes (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('banco', 'arquivos')),
  status text not null check (status in ('ok', 'falha')),
  iniciado_em timestamptz not null default now(),
  concluido_em timestamptz not null default now(),
  tamanho_bytes bigint check (tamanho_bytes is null or tamanho_bytes >= 0),
  arquivos integer check (arquivos is null or arquivos >= 0),
  origem text,
  detalhe text
);

comment on table public.backups_execucoes is
  'Execuções dos backups feitos fora do banco (pg_dump e cópia do Storage). Gravado pelos scripts com a conexão do dono ou service_role. 0134.';

create index if not exists backups_execucoes_tipo_idx
  on public.backups_execucoes (tipo, status, concluido_em desc);

alter table public.backups_execucoes enable row level security;
revoke all on public.backups_execucoes from public, anon, authenticated;
grant select on public.backups_execucoes to authenticated;
grant select, insert on public.backups_execucoes to service_role;
grant usage on sequence public.backups_execucoes_id_seq to service_role;

drop policy if exists backups_execucoes_admin_le on public.backups_execucoes;
create policy backups_execucoes_admin_le on public.backups_execucoes
  for select to authenticated using (public.current_papel() = 'admin');

create or replace function kontrol_private.verificar_backups()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tipo text;
  v_ultimo timestamptz;
  v_falhas integer;
  v_avisos integer := 0;
  v_linhas integer;
  v_rotulo text;
begin
  foreach v_tipo in array array['banco', 'arquivos'] loop
    v_rotulo := case v_tipo when 'banco' then 'do banco' else 'dos arquivos (anexos e assinaturas)' end;

    select max(concluido_em) into v_ultimo
      from backups_execucoes where tipo = v_tipo and status = 'ok';

    -- Duas execuções por dia: 26 horas sem nenhuma boa já é atraso.
    if v_ultimo is null or v_ultimo < now() - interval '26 hours' then
      insert into notificacoes(tipo, titulo, corpo, papel_destino, dedupe_key)
      values (
        'sistema',
        'Backup ' || v_rotulo || ' atrasado',
        case when v_ultimo is null
          then 'Nenhum backup ' || v_rotulo || ' registrado. '
          else 'O último backup ' || v_rotulo || ' bom foi em '
               || to_char(v_ultimo at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI') || '. '
        end
        || 'Confira a tarefa "Kontrol - Backup banco nuvem" no computador do laboratório e o espaço no Dropbox.',
        'admin',
        'backup-atrasado:' || v_tipo || ':' || current_date
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
      get diagnostics v_linhas = row_count;
      v_avisos := v_avisos + v_linhas;
    end if;

    select count(*) into v_falhas
      from backups_execucoes
     where tipo = v_tipo and status = 'falha' and concluido_em > now() - interval '24 hours';
    if v_falhas > 0 then
      insert into notificacoes(tipo, titulo, corpo, papel_destino, dedupe_key)
      values (
        'sistema',
        'Backup ' || v_rotulo || ' falhou',
        v_falhas || ' execução(ões) com falha nas últimas 24 horas. O motivo fica registrado em backups_execucoes.detalhe.',
        'admin',
        'backup-falhou:' || v_tipo || ':' || current_date
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
      get diagnostics v_linhas = row_count;
      v_avisos := v_avisos + v_linhas;
    end if;
  end loop;
  return v_avisos;
end $function$;

revoke all on function kontrol_private.verificar_backups() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'kontrol-backup-verificacao';
    -- 11h UTC = 8h em Brasília, depois do backup da madrugada (00h30).
    perform cron.schedule(
      'kontrol-backup-verificacao',
      '0 11 * * *',
      $cron$select kontrol_private.verificar_backups();$cron$
    );
  else
    raise notice '0134: pg_cron ausente; agende kontrol_private.verificar_backups() diariamente.';
  end if;
end $$;

commit;
