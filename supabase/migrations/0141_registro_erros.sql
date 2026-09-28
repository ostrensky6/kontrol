-- 0141 — registro dos erros do app e aviso ao administrador (auditoria de 28/09/2026).
--
-- Até aqui nenhum erro chegava a um monitor: mensagemDoBanco traduzia a recusa
-- para o usuário e descartava o original, e os erros das telas só apareciam no
-- log da Vercel, que ninguém olhava. Agora o servidor do app grava cada erro
-- aqui (com a chave de serviço), e uma rotina de hora em hora avisa os
-- administradores em Notificações quando houve erro na última hora.
-- Registros com mais de 90 dias são apagados pela mesma rotina.
--
-- Rollback: cron.unschedule('kontrol-erros-verificacao'); drop function
-- kontrol_private.verificar_erros(); drop table public.erros_app.

begin;

create table if not exists public.erros_app (
  id bigint generated always as identity primary key,
  ocorrido_em timestamptz not null default now(),
  origem text not null check (origem in ('servidor', 'navegador', 'banco')),
  rota text check (rota is null or char_length(rota) <= 500),
  mensagem text not null check (char_length(mensagem) <= 2000),
  codigo text check (codigo is null or char_length(codigo) <= 100),
  digest text check (digest is null or char_length(digest) <= 100),
  detalhe text check (detalhe is null or char_length(detalhe) <= 8000),
  usuario_id uuid
);

comment on table public.erros_app is
  'Erros do app (servidor, navegador e recusas técnicas do banco). Gravado pelo servidor do app com service_role; lido só pelo admin. 0141.';

create index if not exists erros_app_ocorrido_idx on public.erros_app (ocorrido_em desc);

alter table public.erros_app enable row level security;
revoke all on public.erros_app from public, anon, authenticated;
grant select on public.erros_app to authenticated;
grant select, insert, delete on public.erros_app to service_role;
grant usage on sequence public.erros_app_id_seq to service_role;

drop policy if exists erros_app_admin_le on public.erros_app;
create policy erros_app_admin_le on public.erros_app
  for select to authenticated using (public.current_papel() = 'admin');

create or replace function kontrol_private.verificar_erros()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total integer;
  v_rotas text;
  v_linhas integer;
begin
  delete from erros_app where ocorrido_em < now() - interval '90 days';

  select count(*) into v_total
    from erros_app where ocorrido_em > now() - interval '1 hour';
  if v_total = 0 then
    return 0;
  end if;

  select string_agg(coalesce(rota, 'sem rota') || ' (' || n || ')', ', ' order by n desc)
    into v_rotas
    from (
      select rota, count(*) as n
        from erros_app
       where ocorrido_em > now() - interval '1 hour'
       group by rota
       order by count(*) desc
       limit 3
    ) r;

  insert into notificacoes(tipo, titulo, corpo, papel_destino, dedupe_key)
  values (
    'sistema',
    case when v_total = 1 then '1 erro no app na última hora'
         else v_total || ' erros no app na última hora' end,
    'Onde: ' || v_rotas || '. Os detalhes ficam em Governança > Erros do app.',
    'admin',
    'erros-app:' || to_char(date_trunc('hour', now()), 'YYYY-MM-DD"T"HH24')
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_linhas = row_count;
  return v_linhas;
end $function$;

revoke all on function kontrol_private.verificar_erros() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'kontrol-erros-verificacao';
    perform cron.schedule(
      'kontrol-erros-verificacao',
      '5 * * * *',
      $cron$select kontrol_private.verificar_erros();$cron$
    );
  else
    raise notice '0141: pg_cron ausente; agende kontrol_private.verificar_erros() de hora em hora.';
  end if;
end $$;

commit;
