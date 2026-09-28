-- =====================================================================
-- 0137 — Catálogo vivo de custos de projeto (Fase B do desenho
-- docs/superpowers/specs/2026-09-28-orcamento-projeto-catalogo-vivo-design.md)
--
-- O que muda:
--   1. Identidade do item = rubrica + descrição + unidade normalizadas
--      (colunas geradas chave_descricao/chave_unidade) e índice único parcial.
--   2. Itens repetidos (mesma identidade) são unificados: fica o de maior
--      valor (DC1); o outro vira ativo = false com substituido_por.
--   3. Histórico de valores por item (orcamento_projeto_catalogo_valores),
--      com carga inicial dos valores atuais.
--   4. Linhas de custo guardam catalogo_valor_base (valor do catálogo quando
--      entraram), para a conclusão saber o que foi digitado.
--   5. RPCs previa_catalogo_revisao_projeto e concluir_revisao_custos_projeto:
--      a conclusão grava no catálogo (vale a última a concluir; linha não
--      alterada não grava; pessoal só com "Valores de pessoal no orçamento").
--   7. kontrol_private.pode_ver_pessoal_orcamento(): quem vê e grava pessoal
--      (orcamentos.pessoal ou tecnicos.salario.ver). Decisão do dono, 28/09.
--   6. orcamento_projeto_catalogo_listar() devolve também a origem do valor.
--
-- Impacto: aditiva. Não remove tabelas, colunas, RLS nem gatilhos de
-- auditoria; nenhum item do catálogo é apagado; propostas emitidas não são
-- tocadas. Pré-requisito: backup lógico de orcamento_projeto_catalogo,
-- orcamento_projeto_custos e orcamento_projetos antes de aplicar em produção.
--
-- Rollback (objetos criados por esta migration; exige o backup acima):
--   update public.orcamento_projeto_catalogo set ativo = true, substituido_por = null
--    where substituido_por is not null;
--   drop function if exists public.concluir_revisao_custos_projeto(bigint, text);
--   drop function if exists public.previa_catalogo_revisao_projeto(bigint);
--   drop function if exists kontrol_private.plano_catalogo_revisao(bigint);
--   drop function if exists kontrol_private.item_catalogo_vigente(text);
--   drop function if exists kontrol_private.pode_ver_pessoal_orcamento();  (depois de recriar a listagem da 0112)
--   drop index if exists public.orcamento_projeto_catalogo_item_unico_uidx;
--   drop table if exists public.orcamento_projeto_catalogo_valores;
--   drop sequence if exists public.orcamento_projeto_catalogo_id_seq;
--   recriar public.orcamento_projeto_catalogo_listar() como na 0112 (mesmos grants).
--   As colunas novas podem ficar: são aditivas e ignoradas pelo código antigo.
-- =====================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regprocedure('kontrol_private.exigir_permissao(text)') is null
    or to_regprocedure('kontrol_private.pode_ver_salario()') is null
    or to_regprocedure('kontrol_private.tem_permissao_efetiva(text)') is null
    or to_regprocedure('public.transicionar_orcamento_projeto(bigint,text,text)') is null
    or to_regprocedure('public.orcamento_projeto_catalogo_listar()') is null then
    raise exception '0137: requer as migrations 0112, 0124 e 0131';
  end if;
end $$;

-- ---- 1. Normalização: fonte única da identidade do item ----------------------
create or replace function kontrol_private.normalizar_texto_catalogo(p_texto text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select nullif(btrim(regexp_replace(
    lower(translate(coalesce(p_texto, ''),
      'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')),
    '\s+', ' ', 'g')), '')
$$;

create or replace function kontrol_private.normalizar_unidade_catalogo(p_unidade text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case u.v
    when '' then 'un'
    when 'und' then 'un' when 'unid' then 'un' when 'unidade' then 'un' when 'unidades' then 'un'
    when 'lt' then 'l' when 'litro' then 'l' when 'litros' then 'l'
    when 'mililitro' then 'ml' when 'mililitros' then 'ml'
    when 'quilo' then 'kg' when 'quilos' then 'kg' when 'quilograma' then 'kg' when 'quilogramas' then 'kg'
    when 'grama' then 'g' when 'gramas' then 'g'
    when 'meses' then 'mes'
    when 'diarias' then 'diaria'
    when 'caixa' then 'cx' when 'caixas' then 'cx'
    when 'pacote' then 'pct' when 'pacotes' then 'pct'
    when 'conjunto' then 'conj' when 'conjuntos' then 'conj'
    else u.v
  end
  from (select regexp_replace(coalesce(kontrol_private.normalizar_texto_catalogo(p_unidade), ''), '\.$', '') as v) u
$$;

revoke all on function kontrol_private.normalizar_texto_catalogo(text) from public, anon;
revoke all on function kontrol_private.normalizar_unidade_catalogo(text) from public, anon;
grant execute on function kontrol_private.normalizar_texto_catalogo(text) to authenticated, service_role;
grant execute on function kontrol_private.normalizar_unidade_catalogo(text) to authenticated, service_role;

-- ---- 1b. Quem vê e grava valores de pessoal no orçamento (dono, 28/09) --------
-- Quem faz orçamento de projeto recebe "Valores de pessoal no orçamento"
-- (orcamentos.pessoal; padrão só admin). Quem já via salário continua vendo.
create or replace function kontrol_private.pode_ver_pessoal_orcamento()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select kontrol_private.tem_permissao_efetiva('orcamentos.pessoal')
      or kontrol_private.pode_ver_salario()
$$;

revoke all on function kontrol_private.pode_ver_pessoal_orcamento() from public, anon, authenticated, service_role;
grant execute on function kontrol_private.pode_ver_pessoal_orcamento() to authenticated, service_role;

-- Padrão das categorias (mesmo padrão de src/lib/auth/permissions.ts): coordenador e gestor
-- fazem orçamento; técnico não. Não sobrescreve escolha já feita pelo administrador.
update public.permissoes_categorias
   set permissoes = permissoes || '{"orcamentos.pessoal": true}'::jsonb,
       atualizado_em = now()
 where papel in ('coordenador', 'gestor')
   and not (permissoes ? 'orcamentos.pessoal');

-- ---- 2. Colunas novas do catálogo --------------------------------------------
alter table public.orcamento_projeto_catalogo
  add column if not exists chave_descricao text
    generated always as (kontrol_private.normalizar_texto_catalogo(descricao)) stored,
  add column if not exists chave_unidade text
    generated always as (kontrol_private.normalizar_unidade_catalogo(unidade)) stored,
  add column if not exists substituido_por text
    references public.orcamento_projeto_catalogo(id) on delete restrict,
  add column if not exists valor_atualizado_em timestamptz,
  add column if not exists valor_atualizado_por text,
  add column if not exists valor_origem_orcamento_projeto_id bigint
    references public.orcamento_projetos(id) on delete set null,
  add column if not exists valor_origem_demanda_id bigint
    references public.demandas_propostas(id) on delete set null;

alter table public.orcamento_projeto_catalogo
  drop constraint if exists orcamento_projeto_catalogo_substituido_check,
  add constraint orcamento_projeto_catalogo_substituido_check
    check (substituido_por is null or (substituido_por <> id and not ativo));

-- Origem: amplia os valores aceitos (o check da 0012 tem nome gerado; é trocado pelo conteúdo).
do $$
declare
  v_nome text;
begin
  for v_nome in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.orcamento_projeto_catalogo'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%origem%'
  loop
    execute format('alter table public.orcamento_projeto_catalogo drop constraint %I', v_nome);
  end loop;
end $$;
alter table public.orcamento_projeto_catalogo
  add constraint orcamento_projeto_catalogo_origem_check
    check (origem in ('kontrol', 'orcamento_projetos_antigo', 'revisao_custos', 'cadastro_catalogo', 'importacao_planilha'));

update public.orcamento_projeto_catalogo
   set valor_atualizado_em = coalesce(valid_from, criado_em)
 where valor_atualizado_em is null;

grant select (chave_descricao, chave_unidade, substituido_por, valor_atualizado_em,
              valor_atualizado_por, valor_origem_orcamento_projeto_id, valor_origem_demanda_id)
  on public.orcamento_projeto_catalogo to authenticated;

comment on column public.orcamento_projeto_catalogo.substituido_por is
  'Item que ficou quando este foi unificado (mesma rubrica, descrição e unidade). Unificado = inativo.';

-- ---- 3. Histórico de valores -------------------------------------------------
create table if not exists public.orcamento_projeto_catalogo_valores (
  id                   bigint generated always as identity primary key,
  catalogo_item_id     text references public.orcamento_projeto_catalogo(id) on delete restrict,
  rubrica              text not null check (rubrica in ('PE','MC','MP','ST','VD','OU')),
  descricao            text not null,
  unidade              text,
  evento               text not null check (evento in ('carga_inicial', 'item_novo', 'valor_alterado',
                                                       'edicao_catalogo', 'unificacao', 'pendente_permissao')),
  preco_unitario       numeric not null check (preco_unitario >= 0),
  preco_anterior       numeric,
  aplicado             boolean not null default true,
  orcamento_projeto_id bigint references public.orcamento_projetos(id) on delete set null,
  demanda_id           bigint references public.demandas_propostas(id) on delete set null,
  usuario              text,
  observacao           text,
  registrado_em        timestamptz not null default now(),
  constraint orcamento_projeto_catalogo_valores_pendente_check
    check (aplicado or evento = 'pendente_permissao'),
  constraint orcamento_projeto_catalogo_valores_item_check
    check (catalogo_item_id is not null or evento = 'pendente_permissao')
);
create index if not exists orcamento_projeto_catalogo_valores_item_idx
  on public.orcamento_projeto_catalogo_valores (catalogo_item_id, registrado_em desc);
create index if not exists orcamento_projeto_catalogo_valores_pendentes_idx
  on public.orcamento_projeto_catalogo_valores (registrado_em desc) where not aplicado;

alter table public.orcamento_projeto_catalogo_valores enable row level security;
revoke all on table public.orcamento_projeto_catalogo_valores from public, anon, authenticated;
grant all on table public.orcamento_projeto_catalogo_valores to service_role;
comment on table public.orcamento_projeto_catalogo_valores is
  'Histórico de valores do catálogo de custos de projeto. Sem acesso direto: grava só pelas funções do catálogo; leitura por RPC com pessoal mascarado.';

insert into public.orcamento_projeto_catalogo_valores
  (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, observacao, registrado_em)
select c.id, c.rubrica, c.descricao, c.unidade, 'carga_inicial', c.preco_unitario,
       case c.origem when 'orcamento_projetos_antigo' then 'Valor importado do app antigo.'
                     else 'Valor existente na criação do histórico.' end,
       coalesce(c.valor_atualizado_em, c.criado_em)
  from public.orcamento_projeto_catalogo c
 where not exists (select 1 from public.orcamento_projeto_catalogo_valores v where v.catalogo_item_id = c.id);

-- ---- 4. Unificação dos repetidos (DC1: fica o maior valor, ativos primeiro) ---
with grupos as (
  select c.id,
         first_value(c.id) over (
           partition by c.rubrica, c.chave_descricao, c.chave_unidade
           order by c.ativo desc, c.preco_unitario desc, c.id
         ) as manter,
         count(*) over (partition by c.rubrica, c.chave_descricao, c.chave_unidade) as quantidade
    from public.orcamento_projeto_catalogo c
   where c.substituido_por is null and c.chave_descricao is not null
), unificados as (
  update public.orcamento_projeto_catalogo c
     set substituido_por = g.manter, ativo = false, atualizado_em = now()
    from grupos g
   where c.id = g.id and g.quantidade > 1 and g.id <> g.manter
  returning c.id, c.rubrica, c.descricao, c.unidade, c.preco_unitario, c.substituido_por
)
insert into public.orcamento_projeto_catalogo_valores
  (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, observacao)
select u.id, u.rubrica, u.descricao, u.unidade, 'unificacao', u.preco_unitario,
       format('Unificado em %s (mesma rubrica, descrição e unidade); ficou o maior valor.', u.substituido_por)
  from unificados u;

create unique index if not exists orcamento_projeto_catalogo_item_unico_uidx
  on public.orcamento_projeto_catalogo (rubrica, chave_descricao, chave_unidade)
  where substituido_por is null;

-- Códigos dos itens novos: <RUBRICA>-<n>, a partir de 101 (o app antigo foi até 48).
create sequence if not exists public.orcamento_projeto_catalogo_id_seq start with 101;
revoke all on sequence public.orcamento_projeto_catalogo_id_seq from public, anon, authenticated;
grant usage on sequence public.orcamento_projeto_catalogo_id_seq to service_role;

-- ---- 5. Linhas de custo: valor do catálogo quando a linha entrou -------------
alter table public.orcamento_projeto_custos
  add column if not exists catalogo_valor_base numeric;
comment on column public.orcamento_projeto_custos.catalogo_valor_base is
  'Valor do catálogo quando a linha entrou ou foi sincronizada. A conclusão só grava no catálogo se custo_unitario for diferente.';
-- Linhas antigas ligadas ao catálogo contam como não alteradas: nunca desfazem valor mais novo.
update public.orcamento_projeto_custos
   set catalogo_valor_base = custo_unitario
 where catalogo_item_id is not null and catalogo_valor_base is null;

-- ---- 6. Decisão linha a linha (usada pela prévia e pela conclusão) -----------
create or replace function kontrol_private.item_catalogo_vigente(p_id text)
returns text
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_id text := p_id;
  v_proximo text;
  v_saltos integer := 0;
begin
  if p_id is null then
    return null;
  end if;
  loop
    select k.substituido_por into v_proximo from public.orcamento_projeto_catalogo k where k.id = v_id;
    if not found then
      return null;
    end if;
    exit when v_proximo is null;
    v_id := v_proximo;
    v_saltos := v_saltos + 1;
    if v_saltos > 20 then
      raise exception 'Unificação do catálogo em ciclo a partir de %.', p_id using errcode = '22023';
    end if;
  end loop;
  return v_id;
end $$;

create or replace function kontrol_private.plano_catalogo_revisao(p_orcamento_projeto_id bigint)
returns table (
  linha_id bigint,
  rubrica text,
  descricao text,
  unidade text,
  valor numeric,
  catalogo_item_id text,
  acao text,
  valor_catalogo numeric,
  valor_catalogo_em timestamptz
)
language sql
stable
set search_path = pg_catalog, public
as $$
  with acesso as (
    select kontrol_private.pode_ver_pessoal_orcamento() as pode
  ),
  linhas as (
    select c.id,
           coalesce(c.rubrica, 'OU') as rubrica,
           c.descricao,
           c.unidade,
           c.custo_unitario as valor,
           c.catalogo_item_id,
           kontrol_private.normalizar_texto_catalogo(c.descricao) as chave_descricao,
           kontrol_private.normalizar_unidade_catalogo(c.unidade) as chave_unidade,
           -- ligada ao catálogo e com o valor de quando entrou = não foi digitada
           (c.catalogo_item_id is not null
             and c.custo_unitario = coalesce(c.catalogo_valor_base, c.custo_unitario)) as sem_edicao
      from public.orcamento_projeto_custos c
     where c.orcamento_projeto_id = p_orcamento_projeto_id
  ),
  alvos as (
    select l.*,
           case
             when l.sem_edicao then coalesce(kontrol_private.item_catalogo_vigente(l.catalogo_item_id), k.id)
             else k.id
           end as item_id
      from linhas l
      left join public.orcamento_projeto_catalogo k
        on k.substituido_por is null
       and k.rubrica = l.rubrica
       and k.chave_descricao = l.chave_descricao
       and k.chave_unidade = l.chave_unidade
  ),
  decididas as (
    select a.*,
           k.preco_unitario as preco_catalogo,
           k.valor_atualizado_em as preco_em,
           case
             when a.sem_edicao then 'inalterado'
             when a.item_id is null then 'novo'
             when a.valor = k.preco_unitario then
               case when a.catalogo_item_id is distinct from a.item_id then 'vincular' else 'inalterado' end
             else 'atualizar'
           end as acao_base
      from alvos a
      left join public.orcamento_projeto_catalogo k on k.id = a.item_id
  ),
  ordenadas as (
    select d.*,
           row_number() over (
             partition by d.rubrica, d.chave_descricao, d.chave_unidade, d.acao_base in ('novo', 'atualizar')
             order by d.id desc
           ) as ordem
      from decididas d
  )
  select o.id,
         o.rubrica,
         o.descricao,
         o.unidade,
         o.valor,
         o.item_id,
         case
           when o.acao_base in ('novo', 'atualizar') and o.ordem > 1 then 'repetido'
           -- sem "Valores de pessoal no orçamento", pessoal nunca grava nem revela se o valor bate com o catálogo
           when o.rubrica = 'PE' and not a.pode and o.acao_base in ('novo', 'atualizar', 'vincular')
             then 'pendente_permissao'
           else o.acao_base
         end,
         case when o.rubrica = 'PE' and not a.pode then null else o.preco_catalogo end,
         o.preco_em
    from ordenadas o
    cross join acesso a
   order by o.rubrica, o.id
$$;

revoke all on function kontrol_private.item_catalogo_vigente(text) from public, anon, authenticated;
revoke all on function kontrol_private.plano_catalogo_revisao(bigint) from public, anon, authenticated;

-- ---- 7. Prévia (somente leitura) ---------------------------------------------
create or replace function public.previa_catalogo_revisao_projeto(p_orcamento_projeto_id bigint)
returns table (
  linha_id bigint,
  rubrica text,
  descricao text,
  unidade text,
  valor numeric,
  catalogo_item_id text,
  acao text,
  valor_catalogo numeric,
  valor_catalogo_em timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  perform kontrol_private.exigir_permissao('orcamentos.visualizar');
  return query select * from kontrol_private.plano_catalogo_revisao(p_orcamento_projeto_id);
end $$;

comment on function public.previa_catalogo_revisao_projeto(bigint) is
  'O que a conclusão da revisão faria no catálogo, linha a linha (novo, atualizar, vincular, inalterado, repetido, pendente_permissao). Pessoal mascarado sem "Valores de pessoal no orçamento".';

-- ---- 8. Conclusão: grava no catálogo e muda o status numa transação só ------
create or replace function public.concluir_revisao_custos_projeto(
  p_orcamento_projeto_id bigint,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
  v_demanda bigint;
  v_justificativa text;
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
  v_linha record;
  v_item text;
  v_anterior numeric;
  v_novos integer := 0;
  v_atualizados integer := 0;
  v_pendentes integer := 0;
  v_repetidos integer := 0;
begin
  perform kontrol_private.exigir_permissao('orcamentos.emitir');

  select p.status, p.demanda_id, p.projeto_sem_custo_justificativa
    into v_status, v_demanda, v_justificativa
    from public.orcamento_projetos p
   where p.id = p_orcamento_projeto_id
   for update;
  if not found then
    raise exception 'Orçamento de projeto não encontrado.' using errcode = 'P0002';
  end if;
  if v_status is distinct from 'rascunho' then
    raise exception 'Só é possível concluir a revisão de custos que estão em edição.' using errcode = '22023';
  end if;
  if v_justificativa is null
     and not exists (select 1 from public.orcamento_projeto_custos c where c.orcamento_projeto_id = p_orcamento_projeto_id)
     and not exists (select 1 from public.orcamento_projeto_analises a where a.orcamento_projeto_id = p_orcamento_projeto_id) then
    raise exception 'Adicione ao menos um custo ou análise antes de concluir a revisão.' using errcode = '22023';
  end if;

  -- Uma conclusão por vez grava no catálogo: a segunda espera e vale a última.
  perform pg_advisory_xact_lock(hashtext('kontrol.orcamento_projeto_catalogo'));

  for v_linha in
    select * from kontrol_private.plano_catalogo_revisao(p_orcamento_projeto_id)
  loop
    if v_linha.acao = 'novo' then
      v_item := v_linha.rubrica || '-' || nextval('public.orcamento_projeto_catalogo_id_seq');
      insert into public.orcamento_projeto_catalogo
        (id, rubrica, descricao, unidade, preco_unitario, ativo, origem,
         valor_atualizado_em, valor_atualizado_por, valor_origem_orcamento_projeto_id, valor_origem_demanda_id)
      values
        (v_item, v_linha.rubrica, btrim(v_linha.descricao), nullif(btrim(coalesce(v_linha.unidade, '')), ''),
         v_linha.valor, true, 'revisao_custos', now(), v_email, p_orcamento_projeto_id, v_demanda);
      insert into public.orcamento_projeto_catalogo_valores
        (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario,
         orcamento_projeto_id, demanda_id, usuario)
      values
        (v_item, v_linha.rubrica, v_linha.descricao, v_linha.unidade, 'item_novo', v_linha.valor,
         p_orcamento_projeto_id, v_demanda, v_email);
      update public.orcamento_projeto_custos
         set catalogo_item_id = v_item, catalogo_valor_base = v_linha.valor
       where id = v_linha.linha_id;
      v_novos := v_novos + 1;

    elsif v_linha.acao = 'atualizar' then
      select k.preco_unitario into v_anterior
        from public.orcamento_projeto_catalogo k
       where k.id = v_linha.catalogo_item_id
       for update;
      update public.orcamento_projeto_catalogo
         set preco_unitario = v_linha.valor,
             ativo = true,
             atualizado_em = now(),
             valor_atualizado_em = now(),
             valor_atualizado_por = v_email,
             valor_origem_orcamento_projeto_id = p_orcamento_projeto_id,
             valor_origem_demanda_id = v_demanda
       where id = v_linha.catalogo_item_id;
      insert into public.orcamento_projeto_catalogo_valores
        (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, preco_anterior,
         orcamento_projeto_id, demanda_id, usuario)
      values
        (v_linha.catalogo_item_id, v_linha.rubrica, v_linha.descricao, v_linha.unidade, 'valor_alterado',
         v_linha.valor, v_anterior, p_orcamento_projeto_id, v_demanda, v_email);
      update public.orcamento_projeto_custos
         set catalogo_item_id = v_linha.catalogo_item_id, catalogo_valor_base = v_linha.valor
       where id = v_linha.linha_id;
      v_atualizados := v_atualizados + 1;

    elsif v_linha.acao = 'vincular' then
      update public.orcamento_projeto_custos
         set catalogo_item_id = v_linha.catalogo_item_id, catalogo_valor_base = v_linha.valor
       where id = v_linha.linha_id;

    elsif v_linha.acao = 'pendente_permissao' then
      insert into public.orcamento_projeto_catalogo_valores
        (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, aplicado,
         orcamento_projeto_id, demanda_id, usuario, observacao)
      values
        (v_linha.catalogo_item_id, v_linha.rubrica, v_linha.descricao, v_linha.unidade, 'pendente_permissao',
         v_linha.valor, false, p_orcamento_projeto_id, v_demanda, v_email,
         'Valor de pessoal concluído sem a permissão "Valores de pessoal no orçamento".');
      v_pendentes := v_pendentes + 1;

    elsif v_linha.acao = 'repetido' then
      v_repetidos := v_repetidos + 1;
    end if;
  end loop;

  -- Linhas repetidas (e as ligadas a item unificado) passam a apontar para o item
  -- vigente; a base é o valor da própria linha, para ela não gravar de novo.
  update public.orcamento_projeto_custos c
     set catalogo_item_id = k.id, catalogo_valor_base = c.custo_unitario
    from public.orcamento_projeto_catalogo k
   where c.orcamento_projeto_id = p_orcamento_projeto_id
     and c.catalogo_item_id is distinct from k.id
     and k.substituido_por is null
     and k.rubrica = coalesce(c.rubrica, 'OU')
     and k.chave_descricao = kontrol_private.normalizar_texto_catalogo(c.descricao)
     and k.chave_unidade = kontrol_private.normalizar_unidade_catalogo(c.unidade)
     and (coalesce(c.rubrica, 'OU') <> 'PE' or kontrol_private.pode_ver_pessoal_orcamento());

  perform public.transicionar_orcamento_projeto(
    p_orcamento_projeto_id,
    'enviado',
    coalesce(nullif(btrim(p_observacao), ''), 'Revisão dos custos de projeto concluída.')
  );

  return jsonb_build_object(
    'novos', v_novos,
    'atualizados', v_atualizados,
    'pendentes', v_pendentes,
    'repetidos', v_repetidos
  );
end $$;

comment on function public.concluir_revisao_custos_projeto(bigint, text) is
  'Conclui a revisão dos custos de projeto e alimenta o catálogo: item novo entra, valor digitado sobrepõe (vale a última conclusão), linha não alterada não grava, pessoal só com "Valores de pessoal no orçamento" (senão fica pendente).';

revoke all on function public.previa_catalogo_revisao_projeto(bigint) from public, anon;
revoke all on function public.concluir_revisao_custos_projeto(bigint, text) from public, anon;
grant execute on function public.previa_catalogo_revisao_projeto(bigint) to authenticated, service_role;
grant execute on function public.concluir_revisao_custos_projeto(bigint, text) to authenticated, service_role;

-- ---- 9. Listagem com a origem do valor (mesma máscara e grants da 0112) ------
drop function if exists public.orcamento_projeto_catalogo_listar();
create function public.orcamento_projeto_catalogo_listar()
returns table (
  id text,
  rubrica text,
  descricao text,
  unidade text,
  preco_unitario numeric,
  preco_mascarado boolean,
  categoria text,
  ativo boolean,
  valid_from timestamptz,
  origem text,
  criado_em timestamptz,
  atualizado_em timestamptz,
  substituido_por text,
  valor_atualizado_em timestamptz,
  valor_atualizado_por text,
  valor_origem_demanda_id bigint,
  valor_origem_demanda_titulo text
)
language sql stable security definer
set search_path = pg_catalog
as $$
  with acesso as (select kontrol_private.pode_ver_pessoal_orcamento() as pode)
  select c.id, c.rubrica, c.descricao, c.unidade,
    case when c.rubrica = 'PE' and not a.pode then null else c.preco_unitario end,
    (c.rubrica = 'PE' and not a.pode),
    c.categoria, c.ativo, c.valid_from, c.origem, c.criado_em, c.atualizado_em,
    c.substituido_por, c.valor_atualizado_em, c.valor_atualizado_por,
    c.valor_origem_demanda_id, d.titulo
  from public.orcamento_projeto_catalogo c
  cross join acesso a
  left join public.demandas_propostas d on d.id = c.valor_origem_demanda_id
  order by c.rubrica, c.descricao, c.id
$$;

revoke all on function public.orcamento_projeto_catalogo_listar() from public, anon, authenticated, service_role;
grant execute on function public.orcamento_projeto_catalogo_listar() to authenticated, service_role;

commit;
