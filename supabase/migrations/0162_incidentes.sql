-- 0162 — incidentes: registrar, avisar quem foi afetado e orientar.
--
-- Um incidente é algo que atrapalha o uso do app ou do laboratório (sistema
-- fora do ar, dado errado, falta de energia, equipamento parado). Quem
-- registra diz o que aconteceu, a quem afeta e o que as pessoas devem fazer
-- enquanto isso. Causa não confirmada fica vazia e a tela mostra "causa ainda
-- desconhecida" (nunca se inventa causa).
--
-- Fluxo: aberto -> em_andamento -> resolvido (pode reabrir). Cada passo vira
-- uma linha só de inserção em incidentes_atualizacoes e um aviso (notificação
-- 'sistema') para a função escolhida "ou acima". Registrar e atualizar:
-- Coordenador, Gestor, Supervisor e Admin. Ler: qualquer pessoa ativa.
--
-- Aditivo: duas tabelas novas (auditadas) e duas funções. Nada existente muda.
-- Rollback: drop function public.atualizar_incidente(bigint,text,text,text,text);
-- drop function public.registrar_incidente(text,text,text,text,text,text);
-- drop table public.incidentes_atualizacoes; drop table public.incidentes;
-- (os avisos já criados ficam em notificacoes, como os demais).
begin;
set local lock_timeout = '10s';

create table public.incidentes (
  id bigint generated always as identity primary key,
  titulo text not null check (char_length(btrim(titulo)) between 3 and 200),
  descricao text not null check (char_length(btrim(descricao)) between 1 and 2000),
  afetados text not null check (char_length(btrim(afetados)) between 1 and 500),
  orientacao text not null check (char_length(btrim(orientacao)) between 1 and 2000),
  -- Vazia = causa ainda desconhecida.
  causa text check (causa is null or char_length(btrim(causa)) between 1 and 2000),
  papel_destino text not null default 'laboratorio'
    check (papel_destino in ('laboratorio', 'coordenador', 'gestor', 'supervisor', 'admin')),
  situacao text not null default 'aberto' check (situacao in ('aberto', 'em_andamento', 'resolvido')),
  registrado_por uuid not null default auth.uid(),
  registrado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  resolvido_em timestamptz
);
comment on table public.incidentes is
  'Incidentes (0162): o que aconteceu, quem é afetado, o que fazer e a causa quando confirmada. Alteração só pelas funções registrar_incidente/atualizar_incidente.';
comment on column public.incidentes.papel_destino is
  'Quem recebe os avisos: laboratorio = todas as funções; senão a função escolhida ou acima.';
create index incidentes_situacao_idx on public.incidentes (situacao, registrado_em desc);

create table public.incidentes_atualizacoes (
  id bigint generated always as identity primary key,
  incidente_id bigint not null references public.incidentes(id) on delete cascade,
  situacao text not null check (situacao in ('aberto', 'em_andamento', 'resolvido')),
  nota text not null check (char_length(btrim(nota)) between 1 and 2000),
  criado_por uuid not null default auth.uid(),
  criado_em timestamptz not null default now()
);
comment on table public.incidentes_atualizacoes is
  'Acompanhamento de cada incidente (0162). Só inserção, pelas funções do incidente.';
create index incidentes_atualizacoes_incidente_idx
  on public.incidentes_atualizacoes (incidente_id, criado_em);

alter table public.incidentes enable row level security;
alter table public.incidentes_atualizacoes enable row level security;
revoke all on table public.incidentes from public, anon, authenticated;
revoke all on table public.incidentes_atualizacoes from public, anon, authenticated;
grant select on table public.incidentes to authenticated;
grant select on table public.incidentes_atualizacoes to authenticated;
grant all on table public.incidentes, public.incidentes_atualizacoes to service_role;

create policy incidentes_leitura on public.incidentes for select to authenticated
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and not p.suspenso));
create policy incidentes_atualizacoes_leitura on public.incidentes_atualizacoes for select to authenticated
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and not p.suspenso));

create trigger aud_incidentes
  after insert or update or delete on public.incidentes
  for each row execute function public.fn_auditoria();
create trigger aud_incidentes_atualizacoes
  after insert or update or delete on public.incidentes_atualizacoes
  for each row execute function public.fn_auditoria();

create function kontrol_private.pode_registrar_incidente()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(kontrol_private.nivel_papel(p.papel) >= kontrol_private.nivel_papel('coordenador'), false)
    from public.perfis p
   where p.id = auth.uid() and not p.suspenso;
$$;
revoke all on function kontrol_private.pode_registrar_incidente() from public, anon;
grant execute on function kontrol_private.pode_registrar_incidente() to authenticated;

create function public.registrar_incidente(
  p_titulo text,
  p_descricao text,
  p_afetados text,
  p_orientacao text,
  p_causa text default null,
  p_papel_destino text default 'laboratorio'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_causa text := nullif(btrim(coalesce(p_causa, '')), '');
begin
  if not coalesce(kontrol_private.pode_registrar_incidente(), false) then
    raise exception 'Somente Coordenador, Gestor, Supervisor ou Administrador registram incidentes.'
      using errcode = '42501';
  end if;
  insert into public.incidentes (titulo, descricao, afetados, orientacao, causa, papel_destino, registrado_por)
  values (btrim(p_titulo), btrim(p_descricao), btrim(p_afetados), btrim(p_orientacao), v_causa,
          coalesce(nullif(p_papel_destino, ''), 'laboratorio'), auth.uid())
  returning id into v_id;
  insert into public.incidentes_atualizacoes (incidente_id, situacao, nota, criado_por)
  values (v_id, 'aberto', 'Incidente registrado.', auth.uid());
  insert into public.notificacoes (tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, dedupe_key)
  values ('sistema', 'Incidente: ' || btrim(p_titulo),
          'O que fazer: ' || btrim(p_orientacao)
            || E'\nCausa: ' || coalesce(v_causa, 'ainda desconhecida.'),
          'incidente', v_id, coalesce(nullif(p_papel_destino, ''), 'laboratorio'),
          'incidente-' || v_id || '-aberto');
  return v_id;
end $$;
revoke all on function public.registrar_incidente(text, text, text, text, text, text) from public, anon;
grant execute on function public.registrar_incidente(text, text, text, text, text, text) to authenticated;

-- Passo do acompanhamento. Causa/orientação vazias mantêm o que já havia.
create function public.atualizar_incidente(
  p_incidente_id bigint,
  p_situacao text,
  p_nota text,
  p_causa text default null,
  p_orientacao text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidentes%rowtype;
  v_atualizacao bigint;
  v_causa text := nullif(btrim(coalesce(p_causa, '')), '');
  v_orientacao text := nullif(btrim(coalesce(p_orientacao, '')), '');
  v_titulo text;
begin
  if not coalesce(kontrol_private.pode_registrar_incidente(), false) then
    raise exception 'Somente Coordenador, Gestor, Supervisor ou Administrador atualizam incidentes.'
      using errcode = '42501';
  end if;
  if p_situacao not in ('aberto', 'em_andamento', 'resolvido') then
    raise exception 'Situação inválida.' using errcode = '22023';
  end if;
  -- Trava a linha: duas atualizações ao mesmo tempo entram uma depois da outra.
  select * into v_inc from public.incidentes where id = p_incidente_id for update;
  if not found then
    raise exception 'Incidente não encontrado.' using errcode = 'P0002';
  end if;

  update public.incidentes
     set situacao = p_situacao,
         causa = coalesce(v_causa, causa),
         orientacao = coalesce(v_orientacao, orientacao),
         atualizado_em = now(),
         resolvido_em = case when p_situacao = 'resolvido' then coalesce(resolvido_em, now()) else null end
   where id = p_incidente_id;
  insert into public.incidentes_atualizacoes (incidente_id, situacao, nota, criado_por)
  values (p_incidente_id, p_situacao, btrim(p_nota), auth.uid())
  returning id into v_atualizacao;

  v_titulo := case p_situacao
    when 'resolvido' then 'Incidente resolvido: '
    when 'aberto' then 'Incidente reaberto: '
    else 'Incidente atualizado: ' end || v_inc.titulo;
  insert into public.notificacoes (tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, dedupe_key)
  values ('sistema', v_titulo, btrim(p_nota), 'incidente', p_incidente_id, v_inc.papel_destino,
          'incidente-' || p_incidente_id || '-atualizacao-' || v_atualizacao);
  return v_atualizacao;
end $$;
revoke all on function public.atualizar_incidente(bigint, text, text, text, text) from public, anon;
grant execute on function public.atualizar_incidente(bigint, text, text, text, text) to authenticated;

commit;
