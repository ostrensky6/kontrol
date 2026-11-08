-- 0159: validação de reagentes alternativos (grupo de escolha) da análise.
--
-- Plano de evolução aprovado (07/11/2026): uma alternativa só deixa de ser
-- orçada quando Laboratório, Coordenador, Supervisor ou Admin registram que ela
-- não serve. O registro fica no histórico (só inserção, auditado) e a situação
-- atual fica na própria linha de insumo_analise, que todas as telas já leem.
--
-- Não destrutiva: só acrescenta colunas, uma tabela, uma função e gatilhos.

alter table public.insumo_analise
  add column if not exists alternativa_situacao text
    check (alternativa_situacao in ('valida', 'invalida')),
  add column if not exists alternativa_observacao text,
  add column if not exists alternativa_validada_por uuid references auth.users(id) on delete set null,
  add column if not exists alternativa_validada_em timestamptz;

comment on column public.insumo_analise.alternativa_situacao is
  '0159: valida/invalida para linhas com grupo de escolha. NULL = ainda não avaliada (continua valendo). Alterada só por public.validar_alternativa_insumo.';

create table public.insumo_analise_validacoes (
  id bigint generated always as identity primary key,
  insumo_analise_id bigint not null references public.insumo_analise(id) on delete cascade,
  codigo_analise text not null,
  grupo_escolha text not null,
  especificacao_insumo text,
  decisao text not null check (decisao in ('valida', 'invalida')),
  observacao text not null check (char_length(btrim(observacao)) between 1 and 1000),
  papel text not null,
  validado_por uuid not null default auth.uid(),
  criado_em timestamptz not null default now()
);
comment on table public.insumo_analise_validacoes is
  '0159: histórico de quem validou ou invalidou cada alternativa de insumo. Só inserção, pela função validar_alternativa_insumo.';
create index insumo_analise_validacoes_linha_idx
  on public.insumo_analise_validacoes (insumo_analise_id, criado_em desc);

alter table public.insumo_analise_validacoes enable row level security;
revoke all on table public.insumo_analise_validacoes from public, anon, authenticated;
grant select on table public.insumo_analise_validacoes to authenticated;
-- Mesma leitura de insumo_analise (aberta a quem tem login).
create policy insumo_analise_validacoes_leitura
  on public.insumo_analise_validacoes for select to authenticated using (true);

create trigger aud_insumo_analise_validacoes
  after insert or update or delete on public.insumo_analise_validacoes
  for each row execute function public.fn_auditoria();

-- A situação só muda pela função; trocar o insumo ou o grupo zera a avaliação.
create function kontrol_private.proteger_alternativa_situacao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('kontrol.validando_alternativa', true), '') = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.alternativa_situacao := null;
    new.alternativa_observacao := null;
    new.alternativa_validada_por := null;
    new.alternativa_validada_em := null;
    return new;
  end if;
  if new.insumo_id is distinct from old.insumo_id
     or new.especificacao_insumo is distinct from old.especificacao_insumo
     or nullif(btrim(new.grupo_escolha), '') is distinct from nullif(btrim(old.grupo_escolha), '') then
    new.alternativa_situacao := null;
    new.alternativa_observacao := null;
    new.alternativa_validada_por := null;
    new.alternativa_validada_em := null;
  else
    new.alternativa_situacao := old.alternativa_situacao;
    new.alternativa_observacao := old.alternativa_observacao;
    new.alternativa_validada_por := old.alternativa_validada_por;
    new.alternativa_validada_em := old.alternativa_validada_em;
  end if;
  return new;
end $$;

create trigger insumo_analise_proteger_alternativa
  before insert or update on public.insumo_analise
  for each row execute function kontrol_private.proteger_alternativa_situacao();

create function public.validar_alternativa_insumo(
  p_insumo_analise_id bigint,
  p_decisao text,
  p_observacao text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_papel text := public.current_papel();
  v_linha public.insumo_analise%rowtype;
  v_grupo text;
  v_restantes integer;
  v_obs text := btrim(coalesce(p_observacao, ''));
begin
  if auth.uid() is null then
    raise exception 'Entre novamente para registrar.' using errcode = '28000';
  end if;
  if v_papel is null or v_papel not in ('laboratorio', 'tecnico', 'coordenador', 'supervisor', 'admin') then
    raise exception 'Só Laboratório, Coordenador, Supervisor ou Admin validam alternativas.' using errcode = '42501';
  end if;
  if p_decisao not in ('valida', 'invalida') then
    raise exception 'Decisão inválida.' using errcode = '22023';
  end if;
  if char_length(v_obs) < 1 or char_length(v_obs) > 1000 then
    raise exception 'Escreva uma observação (até 1000 caracteres).' using errcode = '22023';
  end if;

  select * into v_linha from public.insumo_analise where id = p_insumo_analise_id for update;
  if not found then
    raise exception 'Linha de insumo não encontrada.' using errcode = 'P0002';
  end if;
  v_grupo := nullif(btrim(v_linha.grupo_escolha), '');
  if v_grupo is null then
    raise exception 'Só insumos com grupo de escolha (alternativas) são validados.' using errcode = '22023';
  end if;

  if p_decisao = 'invalida' then
    select count(*) into v_restantes
    from public.insumo_analise ia
    where ia.codigo_analise = v_linha.codigo_analise
      and nullif(btrim(ia.grupo_escolha), '') = v_grupo
      and ia.id <> v_linha.id
      and ia.alternativa_situacao is distinct from 'invalida';
    if v_restantes = 0 then
      raise exception 'O grupo "%" ficaria sem nenhuma alternativa válida.', v_grupo using errcode = '23514';
    end if;
  end if;

  insert into public.insumo_analise_validacoes(
    insumo_analise_id, codigo_analise, grupo_escolha, especificacao_insumo, decisao, observacao, papel, validado_por)
  values (v_linha.id, v_linha.codigo_analise, v_grupo, v_linha.especificacao_insumo, p_decisao, v_obs, v_papel, auth.uid());

  perform set_config('kontrol.validando_alternativa', '1', true);
  update public.insumo_analise
     set alternativa_situacao = p_decisao,
         alternativa_observacao = v_obs,
         alternativa_validada_por = auth.uid(),
         alternativa_validada_em = now()
   where id = v_linha.id;
  perform set_config('kontrol.validando_alternativa', '', true);

  return jsonb_build_object('id', v_linha.id, 'situacao', p_decisao);
end $$;

comment on function public.validar_alternativa_insumo(bigint, text, text) is
  '0159: registra que uma alternativa de insumo serve (valida) ou não serve (invalida). Laboratório, Coordenador, Supervisor e Admin. Não deixa o grupo sem alternativa.';

revoke all on function public.validar_alternativa_insumo(bigint, text, text) from public, anon;
grant execute on function public.validar_alternativa_insumo(bigint, text, text) to authenticated, service_role;
revoke all on function kontrol_private.proteger_alternativa_situacao() from public, anon, authenticated;
