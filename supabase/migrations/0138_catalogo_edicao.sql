-- =====================================================================
-- 0138 — Edição do catálogo de custos de projeto na tela (Fase D do desenho
-- docs/superpowers/specs/2026-09-28-orcamento-projeto-catalogo-vivo-design.md)
--
-- O dono precisa editar o catálogo (28/09): até aqui a tela só listava e
-- arquivava. Quatro RPCs, todas com a trava do catálogo da 0137
-- (pg_advisory_xact_lock) para não disputar com a conclusão de revisões:
--   1. catalogo_projeto_salvar_item: cria ou edita (rubrica, descrição,
--      unidade, grupo, valor). Mesmo item = mesma rubrica + descrição +
--      unidade (0137): repetição é recusada com o item existente na mensagem.
--      Troca de valor grava o histórico (evento edicao_catalogo).
--   2. catalogo_projeto_definir_ativo: arquivar e reativar (item unificado
--      não volta; usa-se o item que ficou).
--   3. catalogo_projeto_unificar: junta dois itens da mesma rubrica; o
--      removido aponta para o que fica e sai de uso.
--   4. catalogo_projeto_historico: valores do item com data, proposta e
--      pessoa; pessoal mascarado sem "Valores de pessoal no orçamento".
-- Gravar exige "Modelos e catálogos" (orcamentos.modelos, como a RLS da
-- 0124); criar, mudar valor ou mover para/de PE exige também a permissão
-- de pessoal (kontrol_private.pode_ver_pessoal_orcamento, 0137).
--
-- Impacto: aditiva (só funções novas). Nada é apagado.
--
-- Rollback:
--   drop function if exists public.catalogo_projeto_historico(text);
--   drop function if exists public.catalogo_projeto_unificar(text, text);
--   drop function if exists public.catalogo_projeto_definir_ativo(text, boolean);
--   drop function if exists public.catalogo_projeto_salvar_item(text, text, text, text, text, numeric);
-- =====================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('kontrol_private.pode_ver_pessoal_orcamento()') is null
    or to_regclass('public.orcamento_projeto_catalogo_valores') is null
    or to_regclass('public.orcamento_projeto_catalogo_id_seq') is null then
    raise exception '0138: requer a migration 0137';
  end if;
end $$;

-- ---- 1. Criar ou editar item ------------------------------------------------
create or replace function public.catalogo_projeto_salvar_item(
  p_id text,
  p_rubrica text,
  p_descricao text,
  p_unidade text,
  p_categoria text,
  p_preco numeric
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
  v_descricao text := nullif(btrim(coalesce(p_descricao, '')), '');
  v_unidade text := nullif(btrim(coalesce(p_unidade, '')), '');
  v_categoria text := nullif(btrim(coalesce(p_categoria, '')), '');
  v_atual public.orcamento_projeto_catalogo%rowtype;
  v_conflito record;
  v_id text;
  v_mudou_preco boolean;
begin
  perform kontrol_private.exigir_permissao('orcamentos.modelos');
  if p_rubrica is null or p_rubrica not in ('PE', 'MC', 'MP', 'ST', 'VD', 'OU') then
    raise exception 'Escolha uma rubrica válida (PE, MC, MP, ST, VD ou OU).' using errcode = '22023';
  end if;
  if v_descricao is null then
    raise exception 'Informe a descrição do item.' using errcode = '22023';
  end if;
  if p_preco is not null and p_preco < 0 then
    raise exception 'O valor não pode ser negativo.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('kontrol.orcamento_projeto_catalogo'));

  if p_id is not null then
    select * into v_atual from public.orcamento_projeto_catalogo k where k.id = p_id for update;
    if not found then
      raise exception 'Item do catálogo não encontrado.' using errcode = 'P0002';
    end if;
    if v_atual.substituido_por is not null then
      raise exception 'Este item foi unificado em %; edite esse item.', v_atual.substituido_por using errcode = '22023';
    end if;
  elsif p_preco is null then
    raise exception 'Informe o valor do item novo.' using errcode = '22023';
  end if;

  -- Pessoal: criar, mudar o valor ou mover de/para PE exige a permissão de pessoal.
  if not kontrol_private.pode_ver_pessoal_orcamento() and (
       (p_id is null and p_rubrica = 'PE')
    or (p_id is not null and (v_atual.rubrica = 'PE' or p_rubrica = 'PE')
        and (p_rubrica is distinct from v_atual.rubrica
             or (p_preco is not null and p_preco is distinct from v_atual.preco_unitario)))
  ) then
    raise exception 'Valores de pessoal exigem a permissão "Valores de pessoal no orçamento".' using errcode = '42501';
  end if;

  select k.id, k.descricao, k.unidade into v_conflito
    from public.orcamento_projeto_catalogo k
   where k.substituido_por is null
     and k.rubrica = p_rubrica
     and k.chave_descricao = kontrol_private.normalizar_texto_catalogo(v_descricao)
     and k.chave_unidade = kontrol_private.normalizar_unidade_catalogo(v_unidade)
     and k.id is distinct from p_id
   limit 1;
  if found then
    raise exception 'Já existe no catálogo: % — % (%). Edite esse item ou mude a descrição ou a unidade.',
      v_conflito.id, v_conflito.descricao, coalesce(v_conflito.unidade, 'un') using errcode = '23505';
  end if;

  if p_id is null then
    v_id := p_rubrica || '-' || nextval('public.orcamento_projeto_catalogo_id_seq');
    insert into public.orcamento_projeto_catalogo
      (id, rubrica, descricao, unidade, categoria, preco_unitario, ativo, origem,
       valor_atualizado_em, valor_atualizado_por)
    values
      (v_id, p_rubrica, v_descricao, v_unidade, v_categoria, p_preco, true, 'cadastro_catalogo', now(), v_email);
    insert into public.orcamento_projeto_catalogo_valores
      (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, usuario, observacao)
    values
      (v_id, p_rubrica, v_descricao, v_unidade, 'item_novo', p_preco, v_email, 'Cadastrado na tela do catálogo.');
    return v_id;
  end if;

  v_mudou_preco := p_preco is not null and p_preco is distinct from v_atual.preco_unitario;
  update public.orcamento_projeto_catalogo k
     set rubrica = p_rubrica,
         descricao = v_descricao,
         unidade = v_unidade,
         categoria = v_categoria,
         preco_unitario = case when v_mudou_preco then p_preco else k.preco_unitario end,
         atualizado_em = now(),
         valor_atualizado_em = case when v_mudou_preco then now() else k.valor_atualizado_em end,
         valor_atualizado_por = case when v_mudou_preco then v_email else k.valor_atualizado_por end,
         valor_origem_orcamento_projeto_id = case when v_mudou_preco then null else k.valor_origem_orcamento_projeto_id end,
         valor_origem_demanda_id = case when v_mudou_preco then null else k.valor_origem_demanda_id end
   where k.id = p_id;
  if v_mudou_preco then
    insert into public.orcamento_projeto_catalogo_valores
      (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, preco_anterior, usuario, observacao)
    values
      (p_id, p_rubrica, v_descricao, v_unidade, 'edicao_catalogo', p_preco, v_atual.preco_unitario, v_email,
       'Valor editado na tela do catálogo.');
  end if;
  return p_id;
end $$;

comment on function public.catalogo_projeto_salvar_item(text, text, text, text, text, numeric) is
  'Cria (p_id nulo) ou edita item do catálogo de custos de projeto. p_preco nulo na edição = manter o valor. Recusa item repetido (rubrica + descrição + unidade).';

-- ---- 2. Arquivar e reativar -------------------------------------------------
create or replace function public.catalogo_projeto_definir_ativo(p_id text, p_ativo boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_substituido text;
begin
  perform kontrol_private.exigir_permissao('orcamentos.modelos');
  perform pg_advisory_xact_lock(hashtext('kontrol.orcamento_projeto_catalogo'));
  select k.substituido_por into v_substituido from public.orcamento_projeto_catalogo k where k.id = p_id for update;
  if not found then
    raise exception 'Item do catálogo não encontrado.' using errcode = 'P0002';
  end if;
  if coalesce(p_ativo, false) and v_substituido is not null then
    raise exception 'Este item foi unificado em %; use esse item.', v_substituido using errcode = '22023';
  end if;
  update public.orcamento_projeto_catalogo k
     set ativo = coalesce(p_ativo, false), atualizado_em = now()
   where k.id = p_id;
end $$;

-- ---- 3. Unificar dois itens -------------------------------------------------
create or replace function public.catalogo_projeto_unificar(p_manter text, p_remover text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
  v_manter public.orcamento_projeto_catalogo%rowtype;
  v_remover public.orcamento_projeto_catalogo%rowtype;
begin
  perform kontrol_private.exigir_permissao('orcamentos.modelos');
  if p_manter is null or p_remover is null or p_manter = p_remover then
    raise exception 'Escolha dois itens diferentes para unificar.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('kontrol.orcamento_projeto_catalogo'));

  select * into v_manter from public.orcamento_projeto_catalogo k where k.id = p_manter for update;
  if not found then
    raise exception 'Item % não encontrado.', p_manter using errcode = 'P0002';
  end if;
  select * into v_remover from public.orcamento_projeto_catalogo k where k.id = p_remover for update;
  if not found then
    raise exception 'Item % não encontrado.', p_remover using errcode = 'P0002';
  end if;
  if v_manter.substituido_por is not null or v_remover.substituido_por is not null then
    raise exception 'Um dos itens já foi unificado antes.' using errcode = '22023';
  end if;
  if v_manter.rubrica <> v_remover.rubrica then
    raise exception 'Só é possível unificar itens da mesma rubrica.' using errcode = '22023';
  end if;
  if v_manter.rubrica = 'PE' and not kontrol_private.pode_ver_pessoal_orcamento() then
    raise exception 'Valores de pessoal exigem a permissão "Valores de pessoal no orçamento".' using errcode = '42501';
  end if;

  update public.orcamento_projeto_catalogo k
     set substituido_por = p_manter, ativo = false, atualizado_em = now()
   where k.id = p_remover;
  insert into public.orcamento_projeto_catalogo_valores
    (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, usuario, observacao)
  values
    (p_remover, v_remover.rubrica, v_remover.descricao, v_remover.unidade, 'unificacao', v_remover.preco_unitario, v_email,
     format('Unificado em %s (%s) na tela do catálogo.', p_manter, v_manter.descricao));
end $$;

-- ---- 4. Histórico do item ---------------------------------------------------
create or replace function public.catalogo_projeto_historico(p_id text)
returns table (
  registrado_em timestamptz,
  evento text,
  preco_unitario numeric,
  preco_anterior numeric,
  aplicado boolean,
  demanda_id bigint,
  demanda_titulo text,
  usuario text,
  observacao text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_pode boolean;
begin
  perform kontrol_private.exigir_permissao('orcamentos.visualizar');
  v_pode := kontrol_private.pode_ver_pessoal_orcamento();
  return query
    select v.registrado_em,
           v.evento,
           case when v.rubrica = 'PE' and not v_pode then null else v.preco_unitario end,
           case when v.rubrica = 'PE' and not v_pode then null else v.preco_anterior end,
           v.aplicado,
           v.demanda_id,
           d.titulo,
           v.usuario,
           v.observacao
      from public.orcamento_projeto_catalogo_valores v
      left join public.demandas_propostas d on d.id = v.demanda_id
     where v.catalogo_item_id = p_id
     order by v.registrado_em desc, v.id desc
     limit 100;
end $$;

revoke all on function public.catalogo_projeto_salvar_item(text, text, text, text, text, numeric) from public, anon;
revoke all on function public.catalogo_projeto_definir_ativo(text, boolean) from public, anon;
revoke all on function public.catalogo_projeto_unificar(text, text) from public, anon;
revoke all on function public.catalogo_projeto_historico(text) from public, anon;
grant execute on function public.catalogo_projeto_salvar_item(text, text, text, text, text, numeric) to authenticated, service_role;
grant execute on function public.catalogo_projeto_definir_ativo(text, boolean) to authenticated, service_role;
grant execute on function public.catalogo_projeto_unificar(text, text) to authenticated, service_role;
grant execute on function public.catalogo_projeto_historico(text) to authenticated, service_role;

commit;
