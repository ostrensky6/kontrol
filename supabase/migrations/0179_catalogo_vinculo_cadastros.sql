-- =====================================================================
-- 0179 — Catálogo de custos de projeto ligado aos cadastros de Insumos e
-- Técnicos (decisão 5 de Antonio, 11/11/2026; diagnóstico aprovado às 19:12
-- UTC e etapa 0 lida em produção às 19:18 UTC, só leitura).
--
-- O que muda:
--   1. Vínculo opcional, item a item: colunas anuláveis insumo_id (só MC) e
--      tecnico_id (só PE) no catálogo, mais vinculo_base (embalagem ou
--      unidade no insumo; mês ou hora no técnico), vinculo_em e vinculo_por.
--   2. O cadastro manda no item ligado: ao ligar e sempre que o custo do
--      insumo ou o valor do técnico muda, o valor do catálogo passa a ser o
--      do cadastro, com histórico (evento valor_cadastro). Cadastro com custo
--      zero ou vazio não substitui o valor do catálogo.
--   3. Item ligado deixa de "aprender" o valor digitado nos orçamentos: a
--      revisão de custos só liga a linha ao item (o valor alterado vale só
--      naquela proposta) e a planilha não muda o valor dele (acao cadastro).
--   4. Ligar e desfazer só pela RPC catalogo_projeto_vincular (permissão
--      "Modelos e catálogos"; pessoal exige também "Ver salário dos
--      técnicos"). Gatilho impede ligar, desfazer, trocar a rubrica ou o
--      valor de item ligado por gravação direta.
--   5. Leitura dos vínculos por RPC (orcamento_projeto_catalogo_vinculos),
--      sem o valor do cadastro; pessoal sem permissão não diz se há valor.
--
-- O que não muda: cada linha de orçamento guarda o valor que foi lançado nela
-- (proposta emitida não muda), item sem vínculo segue como hoje, item novo
-- digitado no orçamento continua entrando como item livre, o salário segue
-- saindo só pela regra de pessoal (0112/0137). A listagem do catálogo, os
-- modelos e a conclusão da revisão continuam lendo preco_unitario.
--
-- Impacto: aditiva. Colunas novas anuláveis (nenhuma linha muda ao aplicar:
-- nenhum item nasce ligado), dois eventos novos aceitos no histórico, funções
-- novas e o corpo de duas funções trocado (plano da revisão, 0137; importação
-- da planilha, 0139) só no ramo do item ligado. Não remove tabela, coluna,
-- RLS nem gatilho de auditoria. Backup lógico antes de aplicar em produção
-- (orcamento_projeto_catalogo, orcamento_projeto_catalogo_valores, insumos,
-- tecnicos, orcamento_projeto_custos).
--
-- Rollback (nesta ordem; os itens ligados voltam a ser livres com o valor
-- que têm no momento):
--   drop trigger if exists trg_insumo_valor_catalogo on public.insumos;
--   drop trigger if exists trg_tecnico_valor_catalogo on public.tecnicos;
--   drop trigger if exists trg_catalogo_vinculo_cadastro on public.orcamento_projeto_catalogo;
--   drop function if exists public.catalogo_projeto_vincular(text, bigint, bigint, text);
--   drop function if exists public.orcamento_projeto_catalogo_vinculos();
--   drop function if exists kontrol_private.fn_insumo_valor_catalogo();
--   drop function if exists kontrol_private.fn_tecnico_valor_catalogo();
--   drop function if exists kontrol_private.fn_catalogo_vinculo_cadastro();
--   drop function if exists kontrol_private.aplicar_valor_cadastro_catalogo(text, text, text);
--   drop function if exists kontrol_private.valor_cadastro_catalogo(bigint, bigint, text);
--   recriar kontrol_private.plano_catalogo_revisao(bigint) com o corpo da 0137 e
--   public.catalogo_projeto_importar(jsonb, boolean) com o corpo da 0139.
--   As colunas e os eventos novos do histórico podem ficar: são aditivos e o
--   código antigo os ignora.
-- =====================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $$
begin
  if to_regprocedure('kontrol_private.exigir_permissao(text)') is null
    or to_regprocedure('kontrol_private.pode_ver_salario()') is null
    or to_regprocedure('kontrol_private.pode_ver_pessoal_orcamento()') is null
    or to_regprocedure('kontrol_private.plano_catalogo_revisao(bigint)') is null
    or to_regprocedure('public.catalogo_projeto_importar(jsonb,boolean)') is null
    or to_regclass('public.orcamento_projeto_catalogo_valores') is null then
    raise exception '0179: requer as migrations 0112, 0124, 0137 e 0139';
  end if;
end $$;

-- ---- 1. Colunas do vínculo ----------------------------------------------------
alter table public.orcamento_projeto_catalogo
  add column if not exists insumo_id bigint references public.insumos(id) on delete set null,
  add column if not exists tecnico_id bigint references public.tecnicos(id) on delete set null,
  add column if not exists vinculo_base text,
  add column if not exists vinculo_em timestamptz,
  add column if not exists vinculo_por text;

alter table public.orcamento_projeto_catalogo
  drop constraint if exists orcamento_projeto_catalogo_vinculo_um_check,
  add constraint orcamento_projeto_catalogo_vinculo_um_check
    check (insumo_id is null or tecnico_id is null),
  drop constraint if exists orcamento_projeto_catalogo_vinculo_insumo_check,
  add constraint orcamento_projeto_catalogo_vinculo_insumo_check
    check (insumo_id is null or (rubrica = 'MC' and vinculo_base in ('embalagem', 'unidade'))),
  drop constraint if exists orcamento_projeto_catalogo_vinculo_tecnico_check,
  add constraint orcamento_projeto_catalogo_vinculo_tecnico_check
    check (tecnico_id is null or (rubrica = 'PE' and vinculo_base in ('mes', 'hora')));

create index if not exists orcamento_projeto_catalogo_insumo_idx
  on public.orcamento_projeto_catalogo (insumo_id) where insumo_id is not null;
create index if not exists orcamento_projeto_catalogo_tecnico_idx
  on public.orcamento_projeto_catalogo (tecnico_id) where tecnico_id is not null;

comment on column public.orcamento_projeto_catalogo.insumo_id is
  'Insumo de onde vem o valor do item (só MC). Nulo = item livre. Liga e desfaz só por catalogo_projeto_vincular.';
comment on column public.orcamento_projeto_catalogo.tecnico_id is
  'Técnico de onde vem o valor do item (só PE). Nulo = item livre. Liga e desfaz só por catalogo_projeto_vincular.';
comment on column public.orcamento_projeto_catalogo.vinculo_base is
  'Como o valor sai do cadastro: embalagem (custo total da embalagem) ou unidade (custo unitário) no insumo; mes (valor mensal) ou hora (valor mensal / horas do mês) no técnico.';

-- Colunas não sensíveis legíveis como as demais (o valor do cadastro nunca sai daqui).
grant select (insumo_id, tecnico_id, vinculo_base, vinculo_em, vinculo_por)
  on public.orcamento_projeto_catalogo to authenticated;

-- ---- 2. Eventos novos no histórico ------------------------------------------
-- vinculo_cadastro = ligou ou desfez; valor_cadastro = valor trazido do cadastro.
do $$
declare
  v_nome text;
begin
  -- a regra antiga dos eventos foi criada sem nome explícito (0137)
  for v_nome in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.orcamento_projeto_catalogo_valores'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%carga_inicial%'
  loop
    execute format('alter table public.orcamento_projeto_catalogo_valores drop constraint %I', v_nome);
  end loop;
end $$;
alter table public.orcamento_projeto_catalogo_valores
  add constraint orcamento_projeto_catalogo_valores_evento_check
    check (evento in ('carga_inicial', 'item_novo', 'valor_alterado', 'edicao_catalogo', 'unificacao',
                      'pendente_permissao', 'vinculo_cadastro', 'valor_cadastro'));

-- ---- 3. Valor do cadastro (interno; pode ser salário) -----------------------
create or replace function kontrol_private.valor_cadastro_catalogo(
  p_insumo_id bigint,
  p_tecnico_id bigint,
  p_base text
)
returns numeric
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select case
    when p_insumo_id is not null then (
      select case p_base
               when 'embalagem' then i.custo_total_embalagem
               when 'unidade' then i.custo_unitario
             end
        from public.insumos i
       where i.id = p_insumo_id)
    when p_tecnico_id is not null then (
      select case p_base
               when 'mes' then t.valor_mes
               when 'hora' then case when t.horas_mes_base > 0 then round(t.valor_mes / t.horas_mes_base, 2) end
             end
        from public.tecnicos t
       where t.id = p_tecnico_id)
  end
$$;
revoke all on function kontrol_private.valor_cadastro_catalogo(bigint, bigint, text)
  from public, anon, authenticated, service_role;

-- Traz o valor do cadastro para o item ligado. Cadastro sem custo não substitui.
-- Devolve true quando o valor do catálogo mudou.
create or replace function kontrol_private.aplicar_valor_cadastro_catalogo(
  p_id text,
  p_usuario text,
  p_observacao text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_item public.orcamento_projeto_catalogo%rowtype;
  v_valor numeric;
begin
  select * into v_item from public.orcamento_projeto_catalogo k where k.id = p_id for update;
  if not found or (v_item.insumo_id is null and v_item.tecnico_id is null) then
    return false;
  end if;
  v_valor := kontrol_private.valor_cadastro_catalogo(v_item.insumo_id, v_item.tecnico_id, v_item.vinculo_base);
  if v_valor is null or v_valor <= 0 or v_valor = v_item.preco_unitario then
    return false;
  end if;

  perform set_config('kontrol.catalogo_cadastro', 'on', true);
  update public.orcamento_projeto_catalogo k
     set preco_unitario = v_valor,
         atualizado_em = now(),
         valor_atualizado_em = now(),
         valor_atualizado_por = p_usuario,
         valor_origem_orcamento_projeto_id = null,
         valor_origem_demanda_id = null
   where k.id = p_id;
  perform set_config('kontrol.catalogo_cadastro', 'off', true);

  insert into public.orcamento_projeto_catalogo_valores
    (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, preco_anterior, usuario, observacao)
  values
    (p_id, v_item.rubrica, v_item.descricao, v_item.unidade, 'valor_cadastro', v_valor, v_item.preco_unitario,
     p_usuario, p_observacao);
  return true;
end $$;
revoke all on function kontrol_private.aplicar_valor_cadastro_catalogo(text, text, text)
  from public, anon, authenticated, service_role;

-- ---- 4. Proteção do vínculo contra gravação direta ---------------------------
-- Invoker de propósito: current_user diz se a gravação veio direto da API
-- (authenticated/anon) ou de função do banco/ação de chave estrangeira (dono).
create or replace function kontrol_private.fn_catalogo_vinculo_cadastro()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_pelo_cadastro boolean := coalesce(current_setting('kontrol.catalogo_cadastro', true), '') = 'on';
  v_direto boolean := current_user::text in ('authenticated', 'anon');
  v_cadastro text;
begin
  if tg_op = 'INSERT' then
    if (new.insumo_id is not null or new.tecnico_id is not null) and not v_pelo_cadastro then
      raise exception 'Item novo nasce livre; ligue ao cadastro depois, em Modelos e catálogo.' using errcode = '42501';
    end if;
    return new;
  end if;

  v_cadastro := case when old.insumo_id is not null then 'Insumos' else 'Técnicos' end;

  -- Vínculo desfeito porque o insumo ou o técnico foi excluído (chave estrangeira).
  if (old.insumo_id is not null or old.tecnico_id is not null)
     and new.insumo_id is null and new.tecnico_id is null
     and not v_pelo_cadastro and not v_direto then
    new.vinculo_base := null;
    new.vinculo_em := now();
    new.vinculo_por := null;
    insert into public.orcamento_projeto_catalogo_valores
      (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, observacao)
    values
      (old.id, old.rubrica, old.descricao, old.unidade, 'vinculo_cadastro', old.preco_unitario,
       format('O cadastro de %s ligado foi excluído; o item ficou livre com o último valor.', v_cadastro));
    return new;
  end if;

  if v_pelo_cadastro then
    return new;
  end if;

  if (new.insumo_id, new.tecnico_id, new.vinculo_base)
     is distinct from (old.insumo_id, old.tecnico_id, old.vinculo_base) then
    raise exception 'O vínculo com o cadastro só muda em Modelos e catálogo (Ligar ao cadastro).' using errcode = '42501';
  end if;
  if old.insumo_id is not null or old.tecnico_id is not null then
    if new.rubrica is distinct from old.rubrica then
      raise exception 'O item % está ligado ao cadastro de %; desfaça o vínculo antes de mudar a rubrica.', old.id, v_cadastro
        using errcode = '22023';
    end if;
    if new.preco_unitario is distinct from old.preco_unitario then
      raise exception 'O item % segue o cadastro de %; para mudar o valor, altere o cadastro ou desfaça o vínculo.', old.id, v_cadastro
        using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
revoke all on function kontrol_private.fn_catalogo_vinculo_cadastro()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_catalogo_vinculo_cadastro on public.orcamento_projeto_catalogo;
create trigger trg_catalogo_vinculo_cadastro
  before insert or update on public.orcamento_projeto_catalogo
  for each row execute function kontrol_private.fn_catalogo_vinculo_cadastro();

-- ---- 5. Cadastro mudou: o catálogo acompanha ---------------------------------
create or replace function kontrol_private.fn_insumo_valor_catalogo()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
  v_id text;
begin
  if new.custo_total_embalagem is not distinct from old.custo_total_embalagem
     and new.custo_unitario is not distinct from old.custo_unitario then
    return null;
  end if;
  for v_id in
    select k.id from public.orcamento_projeto_catalogo k
     where k.insumo_id = new.id and k.substituido_por is null
     order by k.id
  loop
    perform kontrol_private.aplicar_valor_cadastro_catalogo(
      v_id, v_email, format('Custo do insumo #%s mudou no cadastro de Insumos.', new.id));
  end loop;
  return null;
end $$;
revoke all on function kontrol_private.fn_insumo_valor_catalogo()
  from public, anon, authenticated, service_role;

create or replace function kontrol_private.fn_tecnico_valor_catalogo()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
  v_id text;
begin
  if new.valor_mes is not distinct from old.valor_mes
     and new.horas_mes_base is not distinct from old.horas_mes_base then
    return null;
  end if;
  for v_id in
    select k.id from public.orcamento_projeto_catalogo k
     where k.tecnico_id = new.id and k.substituido_por is null
     order by k.id
  loop
    perform kontrol_private.aplicar_valor_cadastro_catalogo(
      v_id, v_email, 'Valor do técnico mudou no cadastro de Técnicos.');
  end loop;
  return null;
end $$;
revoke all on function kontrol_private.fn_tecnico_valor_catalogo()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_insumo_valor_catalogo on public.insumos;
create trigger trg_insumo_valor_catalogo
  after update of custo_total_embalagem, custo_unitario on public.insumos
  for each row execute function kontrol_private.fn_insumo_valor_catalogo();

drop trigger if exists trg_tecnico_valor_catalogo on public.tecnicos;
create trigger trg_tecnico_valor_catalogo
  after update of valor_mes, horas_mes_base on public.tecnicos
  for each row execute function kontrol_private.fn_tecnico_valor_catalogo();

-- ---- 6. Ligar e desfazer ------------------------------------------------------
-- p_insumo_id e p_tecnico_id nulos = desfazer. Devolve o que aconteceu com o valor.
create or replace function public.catalogo_projeto_vincular(
  p_id text,
  p_insumo_id bigint,
  p_tecnico_id bigint,
  p_base text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
  v_item public.orcamento_projeto_catalogo%rowtype;
  v_nome text;
  v_ativo boolean;
  v_valor numeric;
  v_aplicado boolean := false;
  v_base text := nullif(btrim(coalesce(p_base, '')), '');
begin
  perform kontrol_private.exigir_permissao('orcamentos.modelos');
  if p_insumo_id is not null and p_tecnico_id is not null then
    raise exception 'Ligue o item a um insumo ou a um técnico, não aos dois.' using errcode = '22023';
  end if;
  if p_insumo_id is not null and (v_base is null or v_base not in ('embalagem', 'unidade')) then
    raise exception 'Diga se o valor do insumo é por embalagem ou por unidade.' using errcode = '22023';
  end if;
  if p_tecnico_id is not null and (v_base is null or v_base not in ('mes', 'hora')) then
    raise exception 'Diga se o valor do técnico é por mês ou por hora.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('kontrol.orcamento_projeto_catalogo'));

  select * into v_item from public.orcamento_projeto_catalogo k where k.id = p_id for update;
  if not found then
    raise exception 'Item do catálogo não encontrado.' using errcode = 'P0002';
  end if;
  if v_item.substituido_por is not null then
    raise exception 'Este item foi unificado em %; ligue esse item.', v_item.substituido_por using errcode = '22023';
  end if;
  if (p_tecnico_id is not null or v_item.tecnico_id is not null)
     and not kontrol_private.pode_ver_salario() then
    raise exception 'Ligar pessoal ao cadastro de Técnicos exige a permissão "Ver salário dos técnicos".' using errcode = '42501';
  end if;

  if p_insumo_id is not null then
    if v_item.rubrica <> 'MC' then
      raise exception 'Só itens de Material de consumo (MC) se ligam ao cadastro de Insumos.' using errcode = '22023';
    end if;
    select i.especificacao, i.ativo into v_nome, v_ativo
      from public.insumos i where i.id = p_insumo_id;
    if not found then
      raise exception 'Insumo não encontrado.' using errcode = 'P0002';
    end if;
    if not v_ativo then
      raise exception 'O insumo % está inativo; escolha um insumo ativo.', v_nome using errcode = '22023';
    end if;
  elsif p_tecnico_id is not null then
    if v_item.rubrica <> 'PE' then
      raise exception 'Só itens de Pessoal (PE) se ligam ao cadastro de Técnicos.' using errcode = '22023';
    end if;
    select t.nome, t.ativo into v_nome, v_ativo from public.tecnicos t where t.id = p_tecnico_id;
    if not found then
      raise exception 'Técnico não encontrado.' using errcode = 'P0002';
    end if;
    if not v_ativo then
      raise exception 'O técnico % está inativo; escolha um técnico ativo.', v_nome using errcode = '22023';
    end if;
  elsif v_item.insumo_id is null and v_item.tecnico_id is null then
    return jsonb_build_object('ligado', false, 'aplicado', false, 'sem_custo', false);
  end if;

  if (p_insumo_id, p_tecnico_id, v_base) is not distinct from (v_item.insumo_id, v_item.tecnico_id, v_item.vinculo_base) then
    v_valor := kontrol_private.valor_cadastro_catalogo(p_insumo_id, p_tecnico_id, v_base);
    return jsonb_build_object('ligado', true, 'aplicado', false,
                              'sem_custo', v_valor is null or v_valor <= 0);
  end if;

  perform set_config('kontrol.catalogo_cadastro', 'on', true);
  update public.orcamento_projeto_catalogo k
     set insumo_id = p_insumo_id,
         tecnico_id = p_tecnico_id,
         vinculo_base = case when p_insumo_id is null and p_tecnico_id is null then null else v_base end,
         vinculo_em = now(),
         vinculo_por = v_email,
         atualizado_em = now()
   where k.id = p_id;
  perform set_config('kontrol.catalogo_cadastro', 'off', true);

  insert into public.orcamento_projeto_catalogo_valores
    (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, usuario, observacao)
  values
    (p_id, v_item.rubrica, v_item.descricao, v_item.unidade, 'vinculo_cadastro', v_item.preco_unitario, v_email,
     case
       when p_insumo_id is not null then
         format('Ligado ao insumo #%s (%s), valor por %s.', p_insumo_id, v_nome, v_base)
       when p_tecnico_id is not null then
         format('Ligado ao técnico #%s (%s), valor por %s.', p_tecnico_id, v_nome,
                case v_base when 'mes' then 'mês' else 'hora' end)
       else 'Vínculo com o cadastro desfeito; o item ficou livre com o valor atual.'
     end);

  if p_insumo_id is null and p_tecnico_id is null then
    return jsonb_build_object('ligado', false, 'aplicado', false, 'sem_custo', false);
  end if;

  v_aplicado := kontrol_private.aplicar_valor_cadastro_catalogo(
    p_id, v_email, case when p_insumo_id is not null then 'Valor trazido do cadastro de Insumos ao ligar.'
                        else 'Valor trazido do cadastro de Técnicos ao ligar.' end);
  v_valor := kontrol_private.valor_cadastro_catalogo(p_insumo_id, p_tecnico_id, v_base);
  return jsonb_build_object('ligado', true, 'aplicado', v_aplicado, 'sem_custo', v_valor is null or v_valor <= 0);
end $$;

comment on function public.catalogo_projeto_vincular(text, bigint, bigint, text) is
  'Liga (insumo MC por embalagem/unidade; técnico PE por mês/hora) ou desfaz (os dois nulos) o vínculo de um item do catálogo com o cadastro. Ligado, o valor do catálogo vem do cadastro; cadastro sem custo não substitui.';

revoke all on function public.catalogo_projeto_vincular(text, bigint, bigint, text) from public, anon;
grant execute on function public.catalogo_projeto_vincular(text, bigint, bigint, text) to authenticated, service_role;

-- ---- 7. Leitura dos vínculos (sem valores) -----------------------------------
create or replace function public.orcamento_projeto_catalogo_vinculos()
returns table (
  catalogo_item_id text,
  insumo_id bigint,
  insumo_nome text,
  insumo_unidade text,
  tecnico_id bigint,
  tecnico_nome text,
  vinculo_base text,
  cadastro_sem_custo boolean,
  vinculo_em timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with acesso as (select kontrol_private.pode_ver_pessoal_orcamento() as pode)
  select k.id,
         k.insumo_id,
         i.especificacao,
         i.unidade,
         k.tecnico_id,
         t.nome,
         k.vinculo_base,
         -- pessoal sem permissão não diz se o técnico tem valor
         case when k.tecnico_id is not null and not a.pode then null
              else coalesce(kontrol_private.valor_cadastro_catalogo(k.insumo_id, k.tecnico_id, k.vinculo_base), 0) <= 0
         end,
         k.vinculo_em
    from public.orcamento_projeto_catalogo k
    cross join acesso a
    left join public.insumos i on i.id = k.insumo_id
    left join public.tecnicos t on t.id = k.tecnico_id
   where k.insumo_id is not null or k.tecnico_id is not null
   order by k.id
$$;

comment on function public.orcamento_projeto_catalogo_vinculos() is
  'Itens do catálogo ligados ao cadastro: insumo ou técnico, base do valor e se o cadastro está sem custo (nulo para pessoal sem "Valores de pessoal no orçamento"). Nunca devolve o valor do cadastro.';

revoke all on function public.orcamento_projeto_catalogo_vinculos() from public, anon;
grant execute on function public.orcamento_projeto_catalogo_vinculos() to authenticated, service_role;

-- ---- 8. Revisão de custos: item ligado não aprende o valor digitado ----------
-- Corpo da 0137; muda só o ramo do item ligado (vincular ou inalterado, nunca
-- atualizar) e ele não fica pendente de permissão.
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
           (k.insumo_id is not null or k.tecnico_id is not null) as ligado_cadastro,
           case
             when a.sem_edicao then 'inalterado'
             when a.item_id is null then 'novo'
             when a.valor = k.preco_unitario
               or k.insumo_id is not null or k.tecnico_id is not null then
               -- item ligado ao cadastro: o valor digitado vale só nesta proposta
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
           -- (item ligado ao cadastro não grava valor e vincular não revela nada)
           when o.rubrica = 'PE' and not a.pode and o.acao_base in ('novo', 'atualizar', 'vincular')
             and not coalesce(o.ligado_cadastro, false)
             then 'pendente_permissao'
           else o.acao_base
         end,
         case when o.rubrica = 'PE' and not a.pode then null else o.preco_catalogo end,
         o.preco_em
    from ordenadas o
    cross join acesso a
   order by o.rubrica, o.id
$$;

revoke all on function kontrol_private.plano_catalogo_revisao(bigint) from public, anon, authenticated;

-- ---- 9. Planilha: item ligado não muda de valor pela planilha -----------------
-- Corpo da 0139; acrescenta a ação "cadastro" (item ligado com valor diferente).
create or replace function public.catalogo_projeto_importar(p_itens jsonb, p_aplicar boolean default false)
returns table (
  linha integer,
  rubrica text,
  descricao text,
  unidade text,
  preco numeric,
  categoria text,
  acao text,
  catalogo_item_id text,
  preco_atual numeric,
  mensagem text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
  v_pode boolean := kontrol_private.pode_ver_pessoal_orcamento();
  v_r record;
  v_item text;
begin
  perform kontrol_private.exigir_permissao('orcamentos.modelos');
  if jsonb_typeof(coalesce(p_itens, '[]'::jsonb)) <> 'array' then
    raise exception 'Planilha inválida.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) > 3000 then
    raise exception 'A planilha tem mais de 3.000 linhas; divida em partes.' using errcode = '22023';
  end if;
  if coalesce(p_aplicar, false) then
    perform pg_advisory_xact_lock(hashtext('kontrol.orcamento_projeto_catalogo'));
  end if;

  for v_r in
    with entrada as (
      select e.ord::integer as n,
             upper(btrim(coalesce(e.item->>'rubrica', ''))) as rub,
             nullif(btrim(coalesce(e.item->>'descricao', '')), '') as des,
             nullif(btrim(coalesce(e.item->>'unidade', '')), '') as uni,
             case when jsonb_typeof(e.item->'preco') = 'number' then (e.item->>'preco')::numeric end as pre,
             nullif(btrim(coalesce(e.item->>'categoria', '')), '') as cat
        from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) with ordinality as e(item, ord)
    ),
    chaves as (
      select en.*,
             kontrol_private.normalizar_texto_catalogo(en.des) as ch_d,
             kontrol_private.normalizar_unidade_catalogo(en.uni) as ch_u
        from entrada en
    ),
    alvo as (
      select c.*,
             k.id as item_id,
             k.preco_unitario as preco_k,
             case when k.insumo_id is not null then 'Insumos'
                  when k.tecnico_id is not null then 'Técnicos' end as cadastro_k,
             row_number() over (partition by c.rub, c.ch_d, c.ch_u order by c.n desc) as ordem
        from chaves c
        left join public.orcamento_projeto_catalogo k
          on k.substituido_por is null and k.rubrica = c.rub and k.chave_descricao = c.ch_d and k.chave_unidade = c.ch_u
    )
    select a.n, a.rub, a.des, a.uni, a.pre, a.cat, a.item_id, a.preco_k,
           case
             when a.rub not in ('PE', 'MC', 'MP', 'ST', 'VD', 'OU') then 'erro'
             when a.des is null then 'erro'
             when a.pre is null or a.pre < 0 then 'erro'
             when a.ordem > 1 then 'repetido'
             when a.rub = 'PE' and not v_pode then 'sem_permissao'
             when a.item_id is null then 'novo'
             when a.pre = a.preco_k then 'igual'
             when a.cadastro_k is not null then 'cadastro'
             else 'atualizar'
           end as decisao,
           case
             when a.rub not in ('PE', 'MC', 'MP', 'ST', 'VD', 'OU') then 'Rubrica inválida (use PE, MC, MP, ST, VD ou OU).'
             when a.des is null then 'Sem descrição.'
             when a.pre is null or a.pre < 0 then 'Valor ausente ou negativo.'
             when a.ordem > 1 then 'O mesmo item aparece mais abaixo na planilha; vale a última linha.'
             when a.rub = 'PE' and not v_pode then 'Pessoal exige a permissão "Valores de pessoal no orçamento".'
             when a.item_id is not null and a.pre is distinct from a.preco_k and a.cadastro_k is not null then
               format('Segue o cadastro de %s; o valor da planilha não entra.', a.cadastro_k)
           end as aviso
      from alvo a
     order by a.n
  loop
    v_item := v_r.item_id;
    if coalesce(p_aplicar, false) and v_r.decisao = 'novo' then
      v_item := v_r.rub || '-' || nextval('public.orcamento_projeto_catalogo_id_seq');
      insert into public.orcamento_projeto_catalogo
        (id, rubrica, descricao, unidade, categoria, preco_unitario, ativo, origem, valor_atualizado_em, valor_atualizado_por)
      values
        (v_item, v_r.rub, v_r.des, v_r.uni, v_r.cat, v_r.pre, true, 'importacao_planilha', now(), v_email);
      insert into public.orcamento_projeto_catalogo_valores
        (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, usuario, observacao)
      values
        (v_item, v_r.rub, v_r.des, v_r.uni, 'item_novo', v_r.pre, v_email, 'Importado de planilha.');
    elsif coalesce(p_aplicar, false) and v_r.decisao = 'atualizar' then
      update public.orcamento_projeto_catalogo k
         set preco_unitario = v_r.pre,
             categoria = coalesce(v_r.cat, k.categoria),
             ativo = true,
             atualizado_em = now(),
             valor_atualizado_em = now(),
             valor_atualizado_por = v_email,
             valor_origem_orcamento_projeto_id = null,
             valor_origem_demanda_id = null
       where k.id = v_r.item_id;
      insert into public.orcamento_projeto_catalogo_valores
        (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, preco_anterior, usuario, observacao)
      values
        (v_r.item_id, v_r.rub, v_r.des, v_r.uni, 'edicao_catalogo', v_r.pre, v_r.preco_k, v_email, 'Importado de planilha.');
    end if;

    linha := v_r.n;
    rubrica := v_r.rub;
    descricao := v_r.des;
    unidade := v_r.uni;
    preco := v_r.pre;
    categoria := v_r.cat;
    acao := v_r.decisao;
    catalogo_item_id := v_item;
    preco_atual := case when v_r.rub = 'PE' and not v_pode then null else v_r.preco_k end;
    mensagem := v_r.aviso;
    return next;
  end loop;
end $$;

comment on function public.catalogo_projeto_importar(jsonb, boolean) is
  'Prévia (p_aplicar = false) ou importação da planilha do catálogo: cada linha vira novo, atualizar, igual, cadastro (item ligado ao cadastro, valor não entra), repetido, sem_permissao ou erro. Mesma identidade do item da 0137; vale a última linha repetida.';

commit;
