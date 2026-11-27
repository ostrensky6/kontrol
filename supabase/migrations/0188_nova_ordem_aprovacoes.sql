-- 0188 — Nova ordem das aprovações do pedido interno, orçamentos junto com o
-- pedido e fonte de pagamento em lista.
--
-- Pedido de Antonio em 27/11/2026 (thread "Corrigir bugs e ajustes de 27/11"),
-- para o Kontrol seguir o processo que a equipe faz hoje à mão, e decisão dele
-- no cartão de 27/11 19:11 UTC ("Sim, seguir assim"):
--   * quem pede manda os 3 orçamentos junto com o pedido;
--   * três aprovações, nesta ordem: (1) laboratório OU campo (LGA, LQA, LHM,
--     LAPOA ou Campo, sempre um deles), (2) financeiro (função Administrativo),
--     (3) coordenador do projeto;
--   * aprovar segue; devolver volta a quem pediu para corrigir e, corrigido,
--     volta para quem devolveu, sem recomeçar (se o que foi aprovado não mudou);
--     reprovar encerra (0186);
--   * a fonte de pagamento sai de uma lista (Ineo, Funpar, ATGC, CNPq) que o
--     cadastro amplia.
--
-- O que muda no banco:
--   1. pedidos_internos.fluxo: 1 = ordem antiga, 2 = ordem nova. Os pedidos que
--      já saíram do rascunho ficam no 1 e terminam do jeito antigo; rascunhos e
--      pedidos novos ficam no 2. O banco recusa misturar as duas ordens.
--   2. Três status novos: aguardando_area, aguardando_financeiro e
--      aguardando_projeto. Depois do coordenador do projeto, o pedido vai direto
--      para aprovado_para_compra (a compra formal nasce nesse momento) e segue
--      como antes: compra fechada ou instituição, pagamento e conclusão.
--   3. RPCs enviar_pedido_interno (envio e reenvio) e decidir_aprovacao_pedido
--      (aprovar ou devolver em cada uma das três vezes); reprovar_pedido_interno
--      passa a valer também nas três vezes novas.
--   4. Os orçamentos entram no rascunho (e no ajuste) pelo próprio solicitante;
--      o envio exige 3 fornecedores diferentes, cada um com o documento, e marca
--      o de menor valor como escolhido (quem aprova pode trocar, com
--      justificativa, até a aprovação do projeto).
--   5. fontes_recurso: a lista de fontes de pagamento, com o modelo de
--      documento de cada uma (Solicitação de Compras da Ineo, Termo de
--      Referência da Funpar).
--   6. Os gatilhos que dependem do status (avisos, "Aguardando você", ciclo do
--      dia 10, foto da validação, Funpar, carimbo de envio) conhecem os status
--      novos.
--
-- Não destrutiva: acrescenta coluna, status, tabela e funções; troca o corpo de
-- funções existentes (as definições antigas estão nas migrations 0127, 0169,
-- 0171, 0172, 0173, 0175, 0176, 0177, 0184, 0185 e 0186). RLS e auditoria
-- continuam; a tabela nova tem RLS e auditoria.
--
-- Rollback (só se nenhum pedido estiver nos status novos; conferir antes com
--   select id, status from public.pedidos_internos
--    where status in ('aguardando_area','aguardando_financeiro','aguardando_projeto');):
--   recriar as funções a partir das migrations citadas acima (o backup do
--   deploy guarda as definições atuais), drop function public.enviar_pedido_interno(bigint, text),
--   public.decidir_aprovacao_pedido(bigint, text, text, jsonb),
--   kontrol_private.aprovadores_fluxo2(bigint, bigint),
--   kontrol_private.formalizar_compra_fluxo2(bigint);
--   drop policy dos orçamentos do solicitante; drop table public.fontes_recurso;
--   alter table public.pedidos_internos drop column fluxo, drop column
--   aprovacao_financeiro_em, drop column aprovacao_financeiro_por, drop column
--   devolvido_na_etapa; e o check de status sem os três status novos.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'insumos'
                    and column_name = 'criterio_aceitabilidade') then
    raise exception '0188: requer a migration 0187';
  end if;
end $$;

-- ---- 1. Colunas do pedido ---------------------------------------------------------------
-- default 1 na criação da coluna: as linhas existentes ficam na ordem antiga sem
-- precisar de UPDATE (nenhum gatilho dispara); depois o padrão passa a 2.
alter table public.pedidos_internos
  add column if not exists fluxo smallint not null default 1,
  add column if not exists aprovacao_financeiro_em timestamptz,
  add column if not exists aprovacao_financeiro_por text,
  add column if not exists devolvido_na_etapa text;

alter table public.pedidos_internos alter column fluxo set default 2;

alter table public.pedidos_internos drop constraint if exists pedidos_internos_fluxo_check;
alter table public.pedidos_internos add constraint pedidos_internos_fluxo_check check (fluxo in (1, 2));

alter table public.pedidos_internos drop constraint if exists pedidos_internos_devolvido_etapa_check;
alter table public.pedidos_internos add constraint pedidos_internos_devolvido_etapa_check check (
  devolvido_na_etapa is null
  or devolvido_na_etapa in ('aguardando_area', 'aguardando_financeiro', 'aguardando_projeto'));

comment on column public.pedidos_internos.fluxo is
  '0188: ordem das aprovações. 1 = antiga (coordenador, laboratório, administrativo, cotação, aprovação final); 2 = nova (laboratório ou campo, financeiro, coordenador do projeto, com os orçamentos enviados pelo solicitante).';
comment on column public.pedidos_internos.aprovacao_financeiro_em is
  '0188: quando o financeiro (função Administrativo) aprovou. Gravado só pela RPC decidir_aprovacao_pedido.';
comment on column public.pedidos_internos.aprovacao_financeiro_por is
  '0188: e-mail de quem aprovou pelo financeiro. Gravado só pela RPC decidir_aprovacao_pedido.';
comment on column public.pedidos_internos.devolvido_na_etapa is
  '0188: em qual das três aprovações o pedido foi devolvido; corrigido sem mudar o que foi aprovado, volta para ela.';

-- rascunhos ainda não enviados já seguem a ordem nova
update public.pedidos_internos set fluxo = 2 where status = 'rascunho' and fluxo = 1;

-- ---- 2. Status novos -----------------------------------------------------------------------
alter table public.pedidos_internos drop constraint if exists pedidos_internos_status_check;
alter table public.pedidos_internos add constraint pedidos_internos_status_check check (status = any (array[
  'rascunho', 'em_validacao', 'ajuste_solicitante', 'validado', 'formalizado', 'analise_administrativa',
  'ajuste_compras', 'aprovado_compra', 'orcamentos', 'orcamentos_recebidos', 'aguardando_aprovacao_final',
  'aprovado_para_compra', 'compra_fechada', 'encaminhado_instituicao', 'aguardando_pagamento_nf',
  'compra_concluida', 'cancelado',
  'aguardando_area', 'aguardando_financeiro', 'aguardando_projeto'
]::text[])) not valid;

-- ---- 3. Fontes de pagamento ----------------------------------------------------------------
create table if not exists public.fontes_recurso (
  id bigint generated always as identity primary key,
  nome text not null,
  descricao text,
  modelo_documento text,
  ativo boolean not null default true,
  ordem integer not null default 100,
  criado_em timestamptz not null default now(),
  constraint fontes_recurso_nome_check check (char_length(btrim(nome)) between 1 and 80),
  constraint fontes_recurso_descricao_check check (coalesce(char_length(descricao), 0) <= 300),
  constraint fontes_recurso_modelo_check check (
    modelo_documento is null or modelo_documento in ('solicitacao_compras', 'termo_referencia'))
);

create unique index if not exists fontes_recurso_nome_unico on public.fontes_recurso (lower(btrim(nome)));

comment on table public.fontes_recurso is
  '0188: fontes de pagamento do pedido interno (o financeiro escolhe uma na aprovação). modelo_documento diz qual documento a fonte pede: Solicitação de Compras (Ineo) ou Termo de Referência (Funpar).';

alter table public.fontes_recurso enable row level security;

drop policy if exists fontes_recurso_ler on public.fontes_recurso;
create policy fontes_recurso_ler on public.fontes_recurso
  for select to authenticated using (true);
drop policy if exists fontes_recurso_incluir on public.fontes_recurso;
create policy fontes_recurso_incluir on public.fontes_recurso
  for insert to authenticated with check (kontrol_private.pode_editar_cadastro('cadastros.editar'));
drop policy if exists fontes_recurso_alterar on public.fontes_recurso;
create policy fontes_recurso_alterar on public.fontes_recurso
  for update to authenticated
  using (kontrol_private.pode_editar_cadastro('cadastros.editar'))
  with check (kontrol_private.pode_editar_cadastro('cadastros.editar'));
drop policy if exists fontes_recurso_excluir on public.fontes_recurso;
create policy fontes_recurso_excluir on public.fontes_recurso
  for delete to authenticated using (kontrol_private.pode_editar_cadastro('cadastros.editar'));

revoke all on public.fontes_recurso from anon;
grant select, insert, update, delete on public.fontes_recurso to authenticated;
grant all on public.fontes_recurso to service_role;

drop trigger if exists aud_fontes_recurso on public.fontes_recurso;
create trigger aud_fontes_recurso
  after insert or update or delete on public.fontes_recurso
  for each row execute function public.fn_auditoria('id');

insert into public.fontes_recurso (nome, descricao, modelo_documento, ordem)
select v.nome, v.descricao, v.modelo, v.ordem
  from (values
    ('Ineo', 'Instituto Ineo (projeto Piraupiá). Documento: Solicitação de Compras.', 'solicitacao_compras', 10),
    ('Funpar', 'Fundação da UFPR (projetos Petrobras). Documento: Termo de Referência.', 'termo_referencia', 20),
    ('ATGC', 'Recurso próprio da ATGC.', null, 30),
    ('CNPq', 'Recurso do CNPq.', null, 40)
  ) as v(nome, descricao, modelo, ordem)
 where not exists (select 1 from public.fontes_recurso f where lower(btrim(f.nome)) = lower(v.nome));

-- ---- 4. Orçamentos: o solicitante registra no rascunho e no ajuste --------------------------
drop policy if exists pedidos_internos_cotacoes_solicitante_incluir on public.pedidos_internos_cotacoes;
create policy pedidos_internos_cotacoes_solicitante_incluir on public.pedidos_internos_cotacoes
  for insert to authenticated
  with check (
    kontrol_private.tem_permissao_efetiva('pedido.criar')
    and exists (select 1 from public.pedidos_internos pi
                 where pi.id = pedidos_internos_cotacoes.pedido_interno_id
                   and pi.fluxo = 2
                   and pi.status in ('rascunho', 'ajuste_solicitante')
                   and lower(btrim(coalesce(pi.solicitante, ''))) = lower(coalesce(auth.jwt() ->> 'email', '-'))));
drop policy if exists pedidos_internos_cotacoes_solicitante_alterar on public.pedidos_internos_cotacoes;
create policy pedidos_internos_cotacoes_solicitante_alterar on public.pedidos_internos_cotacoes
  for update to authenticated
  using (
    kontrol_private.tem_permissao_efetiva('pedido.criar')
    and exists (select 1 from public.pedidos_internos pi
                 where pi.id = pedidos_internos_cotacoes.pedido_interno_id
                   and pi.fluxo = 2
                   and pi.status in ('rascunho', 'ajuste_solicitante')
                   and lower(btrim(coalesce(pi.solicitante, ''))) = lower(coalesce(auth.jwt() ->> 'email', '-'))))
  with check (
    kontrol_private.tem_permissao_efetiva('pedido.criar')
    and exists (select 1 from public.pedidos_internos pi
                 where pi.id = pedidos_internos_cotacoes.pedido_interno_id
                   and pi.fluxo = 2
                   and pi.status in ('rascunho', 'ajuste_solicitante')
                   and lower(btrim(coalesce(pi.solicitante, ''))) = lower(coalesce(auth.jwt() ->> 'email', '-'))));
drop policy if exists pedidos_internos_cotacoes_solicitante_excluir on public.pedidos_internos_cotacoes;
create policy pedidos_internos_cotacoes_solicitante_excluir on public.pedidos_internos_cotacoes
  for delete to authenticated
  using (
    kontrol_private.tem_permissao_efetiva('pedido.criar')
    and exists (select 1 from public.pedidos_internos pi
                 where pi.id = pedidos_internos_cotacoes.pedido_interno_id
                   and pi.fluxo = 2
                   and pi.status in ('rascunho', 'ajuste_solicitante')
                   and lower(btrim(coalesce(pi.solicitante, ''))) = lower(coalesce(auth.jwt() ->> 'email', '-'))));

-- Quem pode mexer nos orçamentos, em que etapa (gatilho da 0171).
create or replace function kontrol_private.proteger_cotacao()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_pedido_id bigint;
  v_status text;
  v_fluxo smallint;
  v_mexeu_escolha boolean := false;
  v_aberto boolean;
begin
  if tg_op = 'DELETE' then
    v_pedido_id := old.pedido_interno_id;
  else
    v_pedido_id := new.pedido_interno_id;
  end if;
  select pi.status, pi.fluxo into v_status, v_fluxo from public.pedidos_internos pi where pi.id = v_pedido_id;

  if current_user = 'authenticated' then
    if tg_op = 'UPDATE' then
      if new.pedido_interno_id is distinct from old.pedido_interno_id then
        raise exception 'O orçamento não muda de pedido.' using errcode = '42501';
      end if;
      v_mexeu_escolha := new.escolhida is distinct from old.escolhida
        or new.escolhida_por is distinct from old.escolhida_por
        or new.escolhida_em is distinct from old.escolhida_em
        or new.justificativa_escolha is distinct from old.justificativa_escolha;
    elsif tg_op = 'INSERT' then
      v_mexeu_escolha := new.escolhida or new.escolhida_por is not null
        or new.escolhida_em is not null or new.justificativa_escolha is not null;
    end if;
    if v_mexeu_escolha then
      raise exception 'A escolha do orçamento só é registrada pelo botão "Escolher" do pedido.' using errcode = '42501';
    end if;
    -- 0188: na ordem nova, os orçamentos vêm com o pedido (rascunho e ajuste)
    v_aberto := case when coalesce(v_fluxo, 1) = 2
                     then coalesce(v_status, '') in ('rascunho', 'ajuste_solicitante')
                     else coalesce(v_status, '') in ('orcamentos', 'orcamentos_recebidos') end;
    if not v_aberto then
      if coalesce(v_fluxo, 1) = 2 then
        raise exception 'Os orçamentos entram com o pedido, no rascunho ou quando ele volta para ajuste. Para trocar um orçamento agora, devolva o pedido a quem pediu.'
          using errcode = '22023';
      end if;
      raise exception 'Orçamentos só entram ou mudam com o pedido em "Cotações solicitadas" ou "Cotações recebidas".'
        using errcode = '22023';
    end if;
    if tg_op = 'DELETE' then
      -- na ordem antiga o escolhido fica; na nova a escolha é refeita no envio
      if old.escolhida and coalesce(v_fluxo, 1) <> 2 then
        raise exception 'O orçamento escolhido não pode ser removido. Escolha outro antes.' using errcode = '22023';
      end if;
      return old;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.registrada_em := now();
    new.registrada_por := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
                                   new.registrada_por);
  end if;
  new.fornecedor_nome := btrim(new.fornecedor_nome);
  return new;
end $function$;

-- Escolher outro orçamento: na ordem nova, de quem aprova, até a aprovação do projeto.
create or replace function public.escolher_orcamento_pedido_interno(p_cotacao_id bigint, p_justificativa text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'sistema');
  v_cot public.pedidos_internos_cotacoes%rowtype;
  v_pedido public.pedidos_internos%rowtype;
  v_menor numeric;
  v_just text := nullif(btrim(coalesce(p_justificativa, '')), '');
  v_compras integer := 0;
begin
  if not kontrol_private.tem_permissao_efetiva('pedido.aprovar') then
    raise exception 'Escolher o orçamento exige a permissão "Aprovar pedidos internos".' using errcode = '42501';
  end if;

  select * into v_cot from public.pedidos_internos_cotacoes where id = p_cotacao_id;
  if not found then
    raise exception 'Orçamento não encontrado.' using errcode = 'P0002';
  end if;
  select * into v_pedido from public.pedidos_internos where id = v_cot.pedido_interno_id for update;
  if v_pedido.fluxo = 2 then
    if v_pedido.status not in ('aguardando_area', 'aguardando_financeiro', 'aguardando_projeto') then
      raise exception 'O orçamento é trocado durante as aprovações (laboratório ou campo, financeiro, projeto). No rascunho, o de menor valor é escolhido no envio.'
        using errcode = '22023';
    end if;
  elsif v_pedido.status <> 'orcamentos_recebidos' then
    raise exception 'O orçamento é escolhido com o pedido em "Cotações recebidas".' using errcode = '22023';
  end if;
  if coalesce((kontrol_private.resumo_orcamentos(v_pedido.id) ->> 'fornecedores')::integer, 0) < 3 then
    raise exception 'Toda compra precisa de 3 orçamentos de fornecedores diferentes antes da escolha.' using errcode = '22023';
  end if;

  select min(valor_total) into v_menor from public.pedidos_internos_cotacoes where pedido_interno_id = v_pedido.id;
  if v_cot.valor_total > v_menor and coalesce(char_length(v_just), 0) < 15 then
    raise exception 'Este não é o orçamento mais barato. Escreva por que ele foi escolhido (prazo, qualidade, exclusividade...).'
      using errcode = '22023';
  end if;
  if char_length(coalesce(v_just, '')) > 1000 then
    raise exception 'Justificativa muito longa (até 1000 caracteres).' using errcode = '22023';
  end if;

  update public.pedidos_internos_cotacoes
     set escolhida = false, escolhida_por = null, escolhida_em = null, justificativa_escolha = null
   where pedido_interno_id = v_pedido.id and escolhida and id <> v_cot.id;
  update public.pedidos_internos_cotacoes
     set escolhida = true, escolhida_por = v_email, escolhida_em = now(), justificativa_escolha = v_just
   where id = v_cot.id;

  insert into public.pedidos_internos_aprovacoes (
    pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino)
  values (
    v_pedido.id, 'Orçamento escolhido', 'registrado', v_email, public.current_papel(),
    format('%s: R$ %s%s', v_cot.fornecedor_nome, replace(to_char(v_cot.valor_total, 'FM999999999990.00'), '.', ','),
           case when v_just is not null then ' — ' || v_just else ' (menor valor)' end),
    v_pedido.status, v_pedido.status);

  -- um caminho só: o fornecedor escolhido vai para a compra formal ainda não enviada
  if v_cot.fornecedor_id is not null and v_pedido.pedido_compra_id is not null then
    update public.pedidos_compra
       set fornecedor_id = v_cot.fornecedor_id
     where id = v_pedido.pedido_compra_id
       and status in ('solicitado', 'aprovado')
       and fornecedor_id is distinct from v_cot.fornecedor_id;
    get diagnostics v_compras = row_count;
  end if;

  return jsonb_build_object('pedido_id', v_pedido.id, 'cotacao_id', v_cot.id,
                            'menor_valor', v_cot.valor_total <= v_menor, 'compra_atualizada', v_compras > 0);
end $function$;

-- ---- 5. Quem aprova cada uma das três vezes -------------------------------------------------
create or replace function kontrol_private.aprovadores_fluxo2(p_projeto_id bigint, p_area_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  -- coordenador do projeto (ou Supervisão, sem projeto): a mesma regra da 0169
  v_base jsonb := kontrol_private.aprovadores_pedido(p_projeto_id, null, null);
  v_area_nome text;
  v_area_ativa boolean;
  v_lab_id uuid;
  v_sub_id uuid;
  v_lab_nome text;
  v_sub_nome text;
  v_lab_ids jsonb := '[]'::jsonb;
  v_area jsonb;
  v_falta_area text;
  v_resp uuid := kontrol_private.responsavel_compras('administrativo');
  v_fin_ids jsonb;
  v_fin_nomes text;
begin
  if p_area_id is null then
    v_falta_area := 'Escolha o laboratório ou o campo do pedido (Editar, no topo do pedido): é a primeira aprovação.';
  else
    select c.nome, c.ativo, c.coordenador_id, c.substituto_id
      into v_area_nome, v_area_ativa, v_lab_id, v_sub_id
      from public.coordenacoes_area c where c.id = p_area_id;
    if v_area_nome is null or not coalesce(v_area_ativa, false) then
      v_falta_area := 'O laboratório ou campo escolhido não está ativo. Escolha outro (Editar, no topo do pedido).';
    else
      select coalesce(pf.nome, pf.email) into v_lab_nome
        from public.perfis pf where pf.id = v_lab_id and not coalesce(pf.suspenso, false);
      select coalesce(pf.nome, pf.email) into v_sub_nome
        from public.perfis pf where pf.id = v_sub_id and not coalesce(pf.suspenso, false);
      if v_lab_nome is not null then
        v_lab_ids := v_lab_ids || jsonb_build_array(v_lab_id);
      end if;
      if v_sub_nome is not null then
        v_lab_ids := v_lab_ids || jsonb_build_array(v_sub_id);
      end if;
      if jsonb_array_length(v_lab_ids) = 0 then
        v_falta_area := format(
          '%s não tem coordenação cadastrada. O pedido não segue: peça ao Administrador para indicar o coordenador em Cadastros > Laboratórios e áreas.',
          v_area_nome);
      else
        v_area := jsonb_build_object(
          'area_id', p_area_id,
          'area', v_area_nome,
          'nome', coalesce(v_lab_nome, v_sub_nome),
          'substituto_nome', case when v_lab_nome is not null then v_sub_nome end,
          'ids', v_lab_ids);
      end if;
    end if;
  end if;

  -- financeiro: quem tem a função Administrativo e o responsável do administrativo
  select coalesce(jsonb_agg(pf.id order by coalesce(pf.nome, pf.email)), '[]'::jsonb),
         string_agg(coalesce(pf.nome, pf.email), ', ' order by coalesce(pf.nome, pf.email))
    into v_fin_ids, v_fin_nomes
    from public.perfis pf
   where not coalesce(pf.suspenso, false)
     and (pf.papel = 'administrativo' or pf.id = v_resp);

  return v_base || jsonb_build_object(
    'fluxo', 2,
    'laboratorio_exigido', true,
    'laboratorio', v_area,
    'falta_laboratorio', v_falta_area,
    'financeiro', case when jsonb_array_length(v_fin_ids) > 0
                       then jsonb_build_object('nome', v_fin_nomes, 'ids', v_fin_ids) end,
    'falta_financeiro', case when jsonb_array_length(v_fin_ids) = 0
      then 'Não há usuário ativo com a função Administrativo: a aprovação financeira fica com o Administrador ou com quem tem "Conduzir a compra inteira".' end);
end $function$;

revoke all on function kontrol_private.aprovadores_fluxo2(bigint, bigint) from public, anon;
grant execute on function kontrol_private.aprovadores_fluxo2(bigint, bigint) to authenticated, service_role;

-- Leitura para a tela: a ordem do próprio pedido.
create or replace function public.aprovadores_pedido_interno(p_pedido_id bigint)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_projeto_id bigint;
  v_natureza text;
  v_area_id bigint;
  v_fluxo smallint;
begin
  select pi.projeto_id, pi.natureza, pi.area_id, pi.fluxo
    into v_projeto_id, v_natureza, v_area_id, v_fluxo
    from public.pedidos_internos pi where pi.id = p_pedido_id;
  if not found then
    return null;
  end if;
  if v_fluxo = 2 then
    return kontrol_private.aprovadores_fluxo2(v_projeto_id, v_area_id);
  end if;
  return kontrol_private.aprovadores_pedido(v_projeto_id, v_natureza, v_area_id);
end $function$;

revoke all on function public.aprovadores_pedido_interno(bigint) from public, anon;
grant execute on function public.aprovadores_pedido_interno(bigint) to authenticated, service_role;

-- Nome de cada vez como fica gravado em pedidos_internos_aprovacoes.etapa.
create or replace function kontrol_private.etapa_fluxo2(p_status text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case p_status
           when 'aguardando_area' then 'Aprovação do laboratório ou campo'
           when 'aguardando_financeiro' then 'Aprovação financeira'
           when 'aguardando_projeto' then 'Aprovação do coordenador do projeto'
         end
$function$;

revoke all on function kontrol_private.etapa_fluxo2(text) from public, anon;
grant execute on function kontrol_private.etapa_fluxo2(text) to authenticated, service_role;

-- Quem decide a vez em que o pedido está (titular, substituto cadastrado ou quem conduz a compra inteira).
create or replace function kontrol_private.pode_decidir_fluxo2(p_status text, p_aprovadores jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null and (
    coalesce(kontrol_private.conduz_compra(), false)
    or case p_status
         when 'aguardando_area' then coalesce((p_aprovadores -> 'laboratorio' -> 'ids') ? auth.uid()::text, false)
         when 'aguardando_financeiro' then coalesce((p_aprovadores -> 'financeiro' -> 'ids') ? auth.uid()::text, false)
         when 'aguardando_projeto' then coalesce((p_aprovadores -> 'coordenador' -> 'ids') ? auth.uid()::text, false)
         else false
       end)
$function$;

revoke all on function kontrol_private.pode_decidir_fluxo2(text, jsonb) from public, anon;
grant execute on function kontrol_private.pode_decidir_fluxo2(text, jsonb) to authenticated, service_role;

create or replace function kontrol_private.recusa_fluxo2(p_status text, p_aprovadores jsonb)
returns text
language sql
stable
set search_path = ''
as $function$
  select case p_status
    when 'aguardando_area' then format(
      'Esta aprovação é da coordenação de %s (%s). Na ausência, o substituto cadastrado, o Administrador ou quem tem "Conduzir a compra inteira" decide.',
      coalesce(p_aprovadores -> 'laboratorio' ->> 'area', 'laboratório ou campo'),
      coalesce(p_aprovadores -> 'laboratorio' ->> 'nome', 'sem coordenação'))
    when 'aguardando_financeiro' then format(
      'Esta aprovação é do financeiro (%s). Na ausência, o Administrador ou quem tem "Conduzir a compra inteira" decide.',
      coalesce(p_aprovadores -> 'financeiro' ->> 'nome', 'função Administrativo'))
    when 'aguardando_projeto' then format(
      'Esta aprovação é de %s (%s). Na ausência, o Administrador ou quem tem "Conduzir a compra inteira" decide como substituto.',
      coalesce(p_aprovadores -> 'coordenador' ->> 'nome', 'quem coordena'),
      coalesce(p_aprovadores -> 'coordenador' ->> 'rotulo', 'coordenador do projeto'))
    else 'Este pedido não está esperando uma das três aprovações.'
  end
$function$;

revoke all on function kontrol_private.recusa_fluxo2(text, jsonb) from public, anon;
grant execute on function kontrol_private.recusa_fluxo2(text, jsonb) to authenticated, service_role;

-- ---- 6. A compra formal nasce na aprovação do projeto ---------------------------------------
-- O mesmo que a formalização (0088/0127) fazia: cria a compra com os itens
-- rastreáveis, ou acompanha os itens se ela ainda não foi aprovada. O
-- fornecedor do orçamento escolhido vai junto.
create or replace function kontrol_private.formalizar_compra_fluxo2(p_pedido_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_p record;
  v_compra record;
  v_compra_id bigint;
  v_fornecedor bigint;
  v_email text;
begin
  begin
    v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_email := null;
  end;
  select pi.id, pi.titulo, pi.solicitante, pi.projeto_id, pi.pedido_compra_id
    into v_p
    from public.pedidos_internos pi where pi.id = p_pedido_id;
  select c.fornecedor_id into v_fornecedor
    from public.pedidos_internos_cotacoes c
   where c.pedido_interno_id = p_pedido_id and c.escolhida
   limit 1;

  if v_p.pedido_compra_id is not null then
    select pc.id, pc.status into v_compra
      from public.pedidos_compra pc where pc.id = v_p.pedido_compra_id for update;
    if not found or v_compra.status = 'cancelado' then
      raise exception 'A compra formal #% deste pedido foi cancelada. Cancele este pedido interno e registre um novo.',
        v_p.pedido_compra_id using errcode = '22023';
    end if;
    v_compra_id := v_compra.id;
    if v_compra.status = 'solicitado' then
      update public.pedidos_compra_itens ci
         set insumo_id = pii.insumo_id,
             quantidade = pii.quantidade,
             custo_unitario_estimado = pii.orcamento_previo,
             quantidade_em = coalesce(pii.quantidade_em, ci.quantidade_em),
             conteudo_embalagem = coalesce(pii.conteudo_embalagem, ci.conteudo_embalagem)
        from public.pedidos_internos_itens pii
       where ci.pedido_id = v_compra_id
         and ci.pedido_interno_item_id = pii.id
         and pii.pedido_interno_id = p_pedido_id
         and pii.insumo_id is not null
         and (ci.insumo_id, ci.quantidade, ci.custo_unitario_estimado, ci.quantidade_em, ci.conteudo_embalagem)
             is distinct from (pii.insumo_id, pii.quantidade, pii.orcamento_previo,
                               coalesce(pii.quantidade_em, ci.quantidade_em),
                               coalesce(pii.conteudo_embalagem, ci.conteudo_embalagem));
      insert into public.pedidos_compra_itens (pedido_id, insumo_id, pedido_interno_item_id, quantidade, custo_unitario_estimado)
      select v_compra_id, pii.insumo_id, pii.id, pii.quantidade, pii.orcamento_previo
        from public.pedidos_internos_itens pii
       where pii.pedido_interno_id = p_pedido_id
         and pii.insumo_id is not null
         and not exists (select 1 from public.pedidos_compra_itens ci
                          where ci.pedido_id = v_compra_id and ci.pedido_interno_item_id = pii.id);
      delete from public.pedidos_compra_itens ci
       where ci.pedido_id = v_compra_id
         and ci.pedido_interno_item_id is not null
         and not exists (select 1 from public.pedidos_internos_itens pii
                          where pii.id = ci.pedido_interno_item_id
                            and pii.pedido_interno_id = p_pedido_id
                            and pii.insumo_id is not null);
      if v_fornecedor is not null then
        update public.pedidos_compra set fornecedor_id = v_fornecedor
         where id = v_compra_id and fornecedor_id is distinct from v_fornecedor;
      end if;
    end if;
    return v_compra_id;
  end if;

  insert into public.pedidos_compra (projeto_id, solicitante, status, observacao, fornecedor_id)
  values (v_p.projeto_id, coalesce(v_p.solicitante, v_email), 'solicitado',
          'Formalizado a partir do pedido interno #' || v_p.id || ': ' || v_p.titulo, v_fornecedor)
  returning id into v_compra_id;

  insert into public.pedidos_compra_itens (pedido_id, insumo_id, pedido_interno_item_id, quantidade, custo_unitario_estimado)
  select v_compra_id, pii.insumo_id, pii.id, pii.quantidade, pii.orcamento_previo
    from public.pedidos_internos_itens pii
   where pii.pedido_interno_id = p_pedido_id and pii.insumo_id is not null;

  update public.pedidos_internos
     set pedido_compra_id = v_compra_id, formalizado_em = coalesce(formalizado_em, now())
   where id = p_pedido_id;

  insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('pedido_compra', v_compra_id, null, 'solicitado', v_email,
          'Criado pelo pedido interno #' || p_pedido_id || ' na aprovação do coordenador do projeto.');
  return v_compra_id;
end $function$;

revoke all on function kontrol_private.formalizar_compra_fluxo2(bigint) from public, anon;

-- ---- 7. Envio e reenvio na ordem nova -------------------------------------------------------
create or replace function public.enviar_pedido_interno(p_pedido_id bigint, p_observacao text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text;
  v_p record;
  v_ap jsonb;
  v_obs text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_fornecedores integer;
  v_com_documento integer;
  v_destino text := 'aguardando_area';
  v_mantem boolean := false;
  v_sit jsonb;
  v_comentario text;
begin
  perform kontrol_private.exigir_permissao('pedido.criar');
  begin
    v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_email := null;
  end;

  select pi.* into v_p from public.pedidos_internos pi where pi.id = p_pedido_id for update;
  if not found then
    raise exception 'Pedido interno não encontrado.' using errcode = 'P0002';
  end if;
  if v_p.fluxo <> 2 then
    raise exception 'Este pedido segue a ordem antiga de aprovações: use "Enviar para validação".' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(v_p.solicitante, ''))) <> lower(coalesce(v_email, '-'))
     and not kontrol_private.tem_permissao_efetiva('pedido.aprovar') then
    raise exception 'Só quem abriu o pedido o envia para aprovação.' using errcode = '42501';
  end if;
  if v_p.status not in ('rascunho', 'ajuste_solicitante') then
    raise exception 'Só pedido em rascunho ou devolvido para ajuste é enviado para aprovação.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.pedidos_internos_itens i where i.pedido_interno_id = p_pedido_id) then
    raise exception 'Inclua ao menos um item antes de enviar.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(v_p.justificativa, '')), '') is null then
    raise exception 'Escreva a justificativa técnica antes de enviar.' using errcode = '22023';
  end if;
  if v_p.area_id is null then
    raise exception 'Escolha o laboratório ou o campo do pedido (Editar, no topo do pedido): é a primeira aprovação.'
      using errcode = '22023';
  end if;
  if coalesce(v_p.urgencia, 'normal') in ('alta', 'critica')
     and char_length(btrim(coalesce(v_p.urgencia_justificativa, ''))) < 15 then
    raise exception 'Pedido urgente fura o ciclo do dia 10 e precisa de justificativa: escreva por que não pode esperar o próximo ciclo.'
      using errcode = '22023';
  end if;

  v_ap := kontrol_private.aprovadores_fluxo2(v_p.projeto_id, v_p.area_id);
  if not kontrol_private.conduz_compra() then
    if v_ap ->> 'falta_laboratorio' is not null then
      raise exception '%', v_ap ->> 'falta_laboratorio' using errcode = '22023';
    end if;
    if v_ap ->> 'falta_coordenador' is not null then
      raise exception '%', v_ap ->> 'falta_coordenador' using errcode = '22023';
    end if;
  end if;

  -- os 3 orçamentos vão junto, cada um com o documento
  select count(distinct lower(btrim(c.fornecedor_nome))),
         count(distinct lower(btrim(c.fornecedor_nome))) filter (where c.anexo_id is not null)
    into v_fornecedores, v_com_documento
    from public.pedidos_internos_cotacoes c
   where c.pedido_interno_id = p_pedido_id;
  if v_fornecedores < 3 then
    raise exception 'Toda compra precisa de 3 orçamentos de fornecedores diferentes, enviados junto com o pedido. Este pedido tem %. Registre os orçamentos (com o documento de cada um) e envie de novo.',
      v_fornecedores using errcode = '22023';
  end if;
  if v_com_documento < 3 then
    raise exception 'Anexe o documento de cada orçamento (PDF, foto ou planilha do fornecedor). Há % com documento; são precisos 3.',
      v_com_documento using errcode = '22023';
  end if;
  -- sem escolha, vale o de menor valor (quem aprova pode trocar, com justificativa)
  if not exists (select 1 from public.pedidos_internos_cotacoes c
                  where c.pedido_interno_id = p_pedido_id and c.escolhida) then
    update public.pedidos_internos_cotacoes
       set escolhida = true, escolhida_por = 'menor valor, no envio', escolhida_em = now(), justificativa_escolha = null
     where id = (select c.id from public.pedidos_internos_cotacoes c
                  where c.pedido_interno_id = p_pedido_id
                  order by c.valor_total, c.id limit 1);
  end if;

  -- devolvido e corrigido sem mudar o que foi aprovado: volta para quem devolveu
  if v_p.status = 'ajuste_solicitante' and v_p.devolvido_na_etapa is not null
     and v_p.devolvido_na_etapa <> 'aguardando_area' then
    v_sit := public.reenvio_mantem_aprovacoes(p_pedido_id);
    if coalesce((v_sit ->> 'mantem')::boolean, false)
       and (v_p.devolvido_na_etapa <> 'aguardando_projeto' or v_p.aprovacao_financeiro_em is not null)
       and v_p.aprovacao_area_em is not null then
      v_destino := v_p.devolvido_na_etapa;
      v_mantem := true;
    end if;
  end if;

  perform set_config('app.pedido_interno_transicao', 'permitida', true);
  update public.pedidos_internos
     set status = v_destino,
         enviado_validacao_em = now(),
         devolvido_na_etapa = null,
         aprovacao_area_em = case when v_mantem then aprovacao_area_em end,
         aprovacao_area_por = case when v_mantem then aprovacao_area_por end,
         aprovacao_financeiro_em = case when v_mantem and v_destino = 'aguardando_projeto' then aprovacao_financeiro_em end,
         aprovacao_financeiro_por = case when v_mantem and v_destino = 'aguardando_projeto' then aprovacao_financeiro_por end
   where id = p_pedido_id;
  perform set_config('app.pedido_interno_transicao', '', true);

  v_comentario := concat_ws(' ',
    case when v_mantem then format('Corrigido e reenviado: volta para %s, com as aprovações anteriores mantidas.',
                                   lower(kontrol_private.etapa_fluxo2(v_destino)))
         when v_p.status = 'ajuste_solicitante' then 'Corrigido e reenviado: as três aprovações recomeçam pelo laboratório ou campo.'
    end,
    v_obs);

  insert into public.pedidos_internos_aprovacoes (
    pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino)
  values (p_pedido_id,
          case when v_p.status = 'rascunho' then 'Envio para aprovação' else 'Reenvio depois do ajuste' end,
          'registrado', v_email, public.current_papel(), nullif(v_comentario, ''), v_p.status, v_destino);
  insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('pedido_interno', p_pedido_id, v_p.status, v_destino, v_email, nullif(v_comentario, ''));

  return jsonb_build_object('status_origem', v_p.status, 'status_destino', v_destino,
                            'aprovacoes_mantidas', v_mantem, 'mudou', coalesce(v_sit -> 'mudou', '[]'::jsonb));
end $function$;

comment on function public.enviar_pedido_interno(bigint, text) is
  '0188: envia (ou reenvia, depois do ajuste) o pedido da ordem nova: exige item, justificativa, laboratório ou campo, quem aprove e 3 orçamentos com documento; escolhe o de menor valor se ninguém escolheu.';

revoke all on function public.enviar_pedido_interno(bigint, text) from public, anon;
grant execute on function public.enviar_pedido_interno(bigint, text) to authenticated;

-- ---- 8. Aprovar ou devolver em cada uma das três vezes --------------------------------------
create or replace function public.decidir_aprovacao_pedido(
  p_pedido_id bigint,
  p_decisao text,
  p_observacao text default null,
  p_dados jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_papel text := public.current_papel();
  v_p record;
  v_ap jsonb;
  v_etapa text;
  v_destino text;
  v_obs text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_dados jsonb := coalesce(p_dados, '{}'::jsonb);
  v_fonte text;
  v_rubrica text;
  v_conformidade text;
  v_compra_id bigint;
begin
  if v_uid is null then
    raise exception 'Entre no Kontrol para registrar a decisão.' using errcode = '42501';
  end if;
  begin
    v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_email := null;
  end;
  if p_decisao is null or p_decisao not in ('aprovado', 'devolvido') then
    raise exception 'Decisão inválida: use aprovar ou devolver. Para encerrar o pedido, use Reprovar.' using errcode = '22023';
  end if;

  select pi.* into v_p from public.pedidos_internos pi where pi.id = p_pedido_id for update;
  if not found then
    raise exception 'Pedido interno não encontrado.' using errcode = 'P0002';
  end if;
  if v_p.fluxo <> 2 or v_p.status not in ('aguardando_area', 'aguardando_financeiro', 'aguardando_projeto') then
    raise exception 'Este pedido não está esperando uma das três aprovações (laboratório ou campo, financeiro, projeto). A tela foi atualizada.'
      using errcode = '22023';
  end if;
  v_etapa := kontrol_private.etapa_fluxo2(v_p.status);
  v_ap := kontrol_private.aprovadores_fluxo2(v_p.projeto_id, v_p.area_id);
  if not kontrol_private.pode_decidir_fluxo2(v_p.status, v_ap) then
    raise exception '%', kontrol_private.recusa_fluxo2(v_p.status, v_ap) using errcode = '42501';
  end if;

  if p_decisao = 'devolvido' then
    if v_obs is null then
      raise exception 'Escreva o que precisa ser corrigido: quem pediu recebe este texto.' using errcode = '22023';
    end if;
    perform set_config('app.pedido_interno_transicao', 'permitida', true);
    update public.pedidos_internos
       set status = 'ajuste_solicitante', devolvido_na_etapa = v_p.status
     where id = p_pedido_id;
    perform set_config('app.pedido_interno_transicao', '', true);
    insert into public.pedidos_internos_aprovacoes (
      pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino)
    values (p_pedido_id, v_etapa, 'devolvido', v_email, v_papel, v_obs, v_p.status, 'ajuste_solicitante');
    insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
    values ('pedido_interno', p_pedido_id, v_p.status, 'ajuste_solicitante', v_email, 'Devolvido: ' || v_obs);
    return jsonb_build_object('pedido_id', p_pedido_id, 'decisao', p_decisao, 'etapa', v_etapa,
                              'status_origem', v_p.status, 'status_destino', 'ajuste_solicitante');
  end if;

  -- 0136 (D2): quem pediu não aprova o próprio pedido (salvo coordenador do projeto,
  -- Administrador ou quem conduz a compra inteira)
  if not kontrol_private.pode_decidir_proprio_pedido(v_p.solicitante, v_p.projeto_id) then
    raise exception 'Quem pediu não pode validar nem aprovar o próprio pedido. Peça ao coordenador do projeto ou a outra pessoa com a permissão.'
      using errcode = '42501';
  end if;

  perform set_config('app.pedido_interno_transicao', 'permitida', true);
  if v_p.status = 'aguardando_area' then
    v_destino := 'aguardando_financeiro';
    update public.pedidos_internos
       set status = v_destino, aprovacao_area_em = now(), aprovacao_area_por = coalesce(v_email, v_uid::text)
     where id = p_pedido_id;

  elsif v_p.status = 'aguardando_financeiro' then
    v_fonte := nullif(btrim(coalesce(v_dados ->> 'fonte_recurso', '')), '');
    v_rubrica := nullif(btrim(coalesce(v_dados ->> 'rubrica', '')), '');
    v_conformidade := nullif(btrim(coalesce(v_dados ->> 'conformidade_admin', '')), '');
    if v_fonte is null then
      raise exception 'Escolha a fonte de pagamento (Ineo, Funpar, ATGC, CNPq...).' using errcode = '22023';
    end if;
    if not exists (select 1 from public.fontes_recurso f where lower(btrim(f.nome)) = lower(v_fonte) and f.ativo) then
      raise exception 'A fonte "%" não está na lista de fontes de pagamento. Escolha uma da lista ou peça para cadastrá-la em Cadastros.',
        v_fonte using errcode = '22023';
    end if;
    select f.nome into v_fonte from public.fontes_recurso f where lower(btrim(f.nome)) = lower(v_fonte) limit 1;
    if char_length(coalesce(v_rubrica, '')) > 200 or char_length(coalesce(v_conformidade, '')) > 1000 then
      raise exception 'Texto muito longo na rubrica (até 200) ou na conformidade (até 1000 caracteres).' using errcode = '22023';
    end if;
    if exists (select 1 from public.pedidos_internos_itens i
                where i.pedido_interno_id = p_pedido_id
                  and i.tipo in ('material', 'equipamento') and i.insumo_id is null) then
      raise exception 'Há item novo, ainda sem cadastro. Use "Cadastrar insumo" na lista de itens antes da aprovação financeira.'
        using errcode = '22023';
    end if;
    if not exists (select 1 from public.pedidos_internos_cotacoes c
                    where c.pedido_interno_id = p_pedido_id and c.escolhida) then
      raise exception 'Escolha um dos orçamentos antes de aprovar.' using errcode = '22023';
    end if;
    v_destino := 'aguardando_projeto';
    update public.pedidos_internos
       set status = v_destino,
           fonte_recurso = v_fonte,
           rubrica = coalesce(v_rubrica, rubrica),
           conformidade_admin = coalesce(v_conformidade, conformidade_admin),
           observacao_compras = coalesce(v_obs, observacao_compras),
           analisado_em = now(),
           aprovacao_financeiro_em = now(),
           aprovacao_financeiro_por = coalesce(v_email, v_uid::text)
     where id = p_pedido_id;

  else
    -- coordenador do projeto: a última aprovação. A compra formal nasce aqui e
    -- é aprovada junto (aprovar_compra_ligada, 0170).
    v_destino := 'aprovado_para_compra';
    v_compra_id := kontrol_private.formalizar_compra_fluxo2(p_pedido_id);
    update public.pedidos_internos
       set status = v_destino,
           validado_em = now(),
           aprovado_coordenador_em = now(),
           aprovador_coordenador = coalesce(v_email, v_uid::text),
           aprovacao_final_em = now()
     where id = p_pedido_id;
  end if;
  perform set_config('app.pedido_interno_transicao', '', true);

  insert into public.pedidos_internos_aprovacoes (
    pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino)
  values (p_pedido_id, v_etapa, 'aprovado', v_email, v_papel,
          concat_ws(' ', case when v_fonte is not null then format('Fonte: %s.', v_fonte) end, v_obs),
          v_p.status, v_destino);
  insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('pedido_interno', p_pedido_id, v_p.status, v_destino, v_email,
          concat_ws(' ', v_etapa || ': aprovado.', case when v_fonte is not null then format('Fonte: %s.', v_fonte) end, v_obs));

  return jsonb_build_object('pedido_id', p_pedido_id, 'decisao', p_decisao, 'etapa', v_etapa,
                            'status_origem', v_p.status, 'status_destino', v_destino,
                            'pedido_compra_id', v_compra_id);
end $function$;

comment on function public.decidir_aprovacao_pedido(bigint, text, text, jsonb) is
  '0188: aprova ou devolve o pedido na vez em que ele está (laboratório ou campo, financeiro com a fonte de pagamento, coordenador do projeto). A aprovação do projeto cria a compra formal e libera a compra.';

revoke all on function public.decidir_aprovacao_pedido(bigint, text, text, jsonb) from public, anon;
grant execute on function public.decidir_aprovacao_pedido(bigint, text, text, jsonb) to authenticated;

-- ---- 9. Reprovar também nas três vezes novas (0186) -----------------------------------------
create or replace function public.reprovar_pedido_interno(p_pedido_id bigint, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_papel text := public.current_papel();
  v_p record;
  v_ap jsonb;
  v_etapa text;
  v_quem text;
  v_compra record;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if v_uid is null then
    raise exception 'Entre no Kontrol para registrar a decisão.' using errcode = '42501';
  end if;
  begin
    v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_email := null;
  end;
  if v_motivo is null then
    raise exception 'Escreva o motivo da reprovação: o solicitante vê esse texto.' using errcode = '22023';
  end if;

  select pi.id, pi.status, pi.natureza, pi.area_id, pi.projeto_id, pi.aprovacao_area_em,
         pi.pedido_compra_id, pi.titulo, pi.fluxo
    into v_p
    from public.pedidos_internos pi
   where pi.id = p_pedido_id
   for update;
  if not found then
    raise exception 'Pedido interno não encontrado.' using errcode = 'P0002';
  end if;

  if v_p.fluxo = 2 and v_p.status in ('aguardando_area', 'aguardando_financeiro', 'aguardando_projeto') then
    -- 0188: a vez em que o pedido está
    v_etapa := kontrol_private.etapa_fluxo2(v_p.status);
    v_ap := kontrol_private.aprovadores_fluxo2(v_p.projeto_id, v_p.area_id);
    if not kontrol_private.pode_decidir_fluxo2(v_p.status, v_ap) then
      raise exception '%', kontrol_private.recusa_fluxo2(v_p.status, v_ap) using errcode = '42501';
    end if;
  else
    v_ap := kontrol_private.aprovadores_pedido(v_p.projeto_id, v_p.natureza, v_p.area_id);
    if v_p.status = 'em_validacao' then
      v_etapa := 'Validação das especificações técnicas';
      if not kontrol_private.conduz_compra()
         and not coalesce((v_ap -> 'coordenador' -> 'ids') ? v_uid::text, false) then
        raise exception 'Este pedido é decidido por % (%). Na ausência, o Administrador ou quem tem "Conduzir a compra inteira" decide como substituto.',
          coalesce(v_ap -> 'coordenador' ->> 'nome', 'quem coordena'),
          coalesce(v_ap -> 'coordenador' ->> 'rotulo', 'coordenador competente')
          using errcode = '42501';
      end if;
    elsif v_p.status = 'validado' and coalesce(v_p.natureza, '') = 'material_consumo_lab'
          and v_p.aprovacao_area_em is null then
      v_etapa := 'Aprovação da coordenação do laboratório';
      if not kontrol_private.conduz_compra()
         and not coalesce((v_ap -> 'laboratorio' -> 'ids') ? v_uid::text, false) then
        raise exception 'Esta etapa é da coordenação do laboratório % (%). Na ausência, o substituto cadastrado, o Administrador ou quem tem "Conduzir a compra inteira" decide.',
          coalesce(v_ap -> 'laboratorio' ->> 'area', ''), coalesce(v_ap -> 'laboratorio' ->> 'nome', 'sem coordenador')
          using errcode = '42501';
      end if;
    elsif v_p.status in ('formalizado', 'analise_administrativa') then
      v_etapa := 'Análise de fonte de recurso, rubrica e conformidade';
      perform kontrol_private.exigir_permissao('pedido.aprovar');
    else
      raise exception 'Este pedido não está esperando aprovação. Só se reprova na vez do laboratório, do administrativo ou do coordenador do projeto; em outra etapa, use Cancelar.'
        using errcode = '22023';
    end if;
  end if;

  -- compra ligada (nasce na formalização): nesta etapa nada chegou, então é cancelada junto
  if v_p.pedido_compra_id is not null then
    select pc.id, pc.status into v_compra
      from public.pedidos_compra pc
     where pc.id = v_p.pedido_compra_id
     for update;
    if found and v_compra.status <> 'cancelado' then
      if v_compra.status not in ('solicitado', 'aprovado') then
        raise exception 'A compra deste pedido já foi enviada ao fornecedor. Cancele a compra antes de reprovar.'
          using errcode = '22023';
      end if;
      perform set_config('app.pedido_compra_transicao', 'permitida', true);
      update public.pedidos_compra set status = 'cancelado' where id = v_compra.id;
      perform set_config('app.pedido_compra_transicao', '', true);
    end if;
  end if;

  perform set_config('app.pedido_interno_transicao', 'permitida', true);
  update public.pedidos_internos set status = 'cancelado' where id = p_pedido_id;
  perform set_config('app.pedido_interno_transicao', '', true);

  insert into public.pedidos_internos_aprovacoes (
    pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino)
  values (p_pedido_id, v_etapa, 'reprovado', v_email, v_papel, v_motivo, v_p.status, 'cancelado');

  insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('pedido_interno', p_pedido_id, v_p.status, 'cancelado', v_email, 'Reprovado: ' || v_motivo);

  -- o aviso de cancelamento ao solicitante (avisar_passagem_etapa) já foi gravado
  -- neste mesmo comando; ele passa a dizer quem reprovou e por quê
  select coalesce(nullif(btrim(pf.nome), ''), v_email) into v_quem
    from public.perfis pf where pf.id = v_uid;
  update public.notificacoes n
     set titulo = 'Seu pedido interno foi reprovado',
         corpo = format('Pedido interno #%s: %s. Reprovado por %s (%s). Motivo: %s O pedido foi encerrado.',
                        p_pedido_id, coalesce(v_p.titulo, 'sem título'), coalesce(v_quem, 'quem aprova'),
                        lower(v_etapa), v_motivo || case when right(v_motivo, 1) in ('.', '!', '?') then '' else '.' end)
   where n.entidade_tipo = 'pedido_interno'
     and n.entidade_id = p_pedido_id
     and n.dedupe_key like format('etapa:pedidos_internos:%s:cancelado:%%', p_pedido_id)
     and n.criado_em >= now();

  return jsonb_build_object('pedido_id', p_pedido_id, 'etapa', v_etapa, 'status_origem', v_p.status);
end $function$;

revoke all on function public.reprovar_pedido_interno(bigint, text) from public, anon;
grant execute on function public.reprovar_pedido_interno(bigint, text) to authenticated;

-- ---- 10. Gatilhos que dependem do status ----------------------------------------------------
-- 10a. Competência e as duas ordens sem mistura (0169/0184)
create or replace function kontrol_private.exigir_competencia_pedido()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_ap jsonb;
begin
  if current_user = 'authenticated' and (
       new.aprovacao_area_em is distinct from old.aprovacao_area_em
       or new.aprovacao_area_por is distinct from old.aprovacao_area_por) then
    raise exception 'A aprovação da coordenação do laboratório só é registrada pelo botão do pedido.'
      using errcode = '42501';
  end if;
  -- 0188: o que só as RPCs da ordem nova gravam
  if current_user = 'authenticated' and (
       new.fluxo is distinct from old.fluxo
       or new.aprovacao_financeiro_em is distinct from old.aprovacao_financeiro_em
       or new.aprovacao_financeiro_por is distinct from old.aprovacao_financeiro_por
       or new.devolvido_na_etapa is distinct from old.devolvido_na_etapa) then
    raise exception 'A ordem das aprovações e as decisões do pedido só mudam pelos botões do pedido.'
      using errcode = '42501';
  end if;

  if current_user = 'authenticated'
     and old.status not in ('rascunho', 'ajuste_solicitante', 'ajuste_compras')
     and (new.area_id is distinct from old.area_id
          or new.natureza is distinct from old.natureza
          or new.projeto_id is distinct from old.projeto_id) then
    raise exception 'Projeto, tipo de material e laboratório só mudam com o pedido em rascunho ou devolvido para ajuste.'
      using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  -- 0188: cada pedido segue uma ordem só
  if new.fluxo = 2 and new.status in ('em_validacao', 'validado', 'formalizado', 'analise_administrativa',
                                       'ajuste_compras', 'aprovado_compra', 'orcamentos', 'orcamentos_recebidos',
                                       'aguardando_aprovacao_final') then
    raise exception 'Este pedido segue a ordem nova de aprovações (laboratório ou campo, financeiro, projeto): use "Enviar para aprovação" e os botões de cada aprovação.'
      using errcode = '22023';
  end if;
  if new.fluxo = 1 and new.status in ('aguardando_area', 'aguardando_financeiro', 'aguardando_projeto') then
    raise exception 'Este pedido segue a ordem antiga de aprovações e termina nela.' using errcode = '22023';
  end if;
  if new.fluxo = 2 then
    -- as passagens da ordem nova são validadas pelas RPCs enviar_pedido_interno e decidir_aprovacao_pedido
    return new;
  end if;

  -- Envio para validação: precisa haver quem valide (e, para material de
  -- consumo de laboratório, quem aprove pelo laboratório).
  if new.status = 'em_validacao' then
    -- 0184: quem conduz a compra inteira envia mesmo sem coordenador indicado
    if v_uid is not null and not kontrol_private.conduz_compra() then
      v_ap := kontrol_private.aprovadores_pedido(new.projeto_id, new.natureza, new.area_id);
      if v_ap ->> 'falta_coordenador' is not null then
        raise exception '%', v_ap ->> 'falta_coordenador' using errcode = '22023';
      end if;
      if v_ap ->> 'falta_laboratorio' is not null then
        raise exception '%', v_ap ->> 'falta_laboratorio' using errcode = '22023';
      end if;
    end if;
    new.aprovacao_area_em := null;
    new.aprovacao_area_por := null;
    return new;
  end if;

  if old.status = 'em_validacao' and new.status = 'validado' and v_uid is not null then
    v_ap := kontrol_private.aprovadores_pedido(new.projeto_id, new.natureza, new.area_id);
    if v_ap ->> 'falta_coordenador' is not null and not kontrol_private.conduz_compra() then
      raise exception '%', v_ap ->> 'falta_coordenador' using errcode = '42501';
    end if;
    if not kontrol_private.conduz_compra()
       and not coalesce((v_ap -> 'coordenador' -> 'ids') ? v_uid::text, false) then
      raise exception 'Este pedido é validado por % (%). Na ausência, o Administrador ou quem tem "Conduzir a compra inteira" valida como substituto.',
        coalesce(v_ap -> 'coordenador' ->> 'nome', 'quem coordena'),
        coalesce(v_ap -> 'coordenador' ->> 'rotulo', 'coordenador competente')
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'validado'
     and new.status not in ('ajuste_solicitante', 'cancelado')
     and coalesce(new.natureza, '') = 'material_consumo_lab'
     and new.aprovacao_area_em is null then
    raise exception 'Material de consumo de laboratório precisa da aprovação da coordenação do laboratório antes de seguir para compras.'
      using errcode = '42501';
  end if;

  return new;
end $function$;

revoke all on function kontrol_private.exigir_competencia_pedido() from public, anon;

-- 10b. Ciclo do dia 10 (0172): na ordem nova, o ciclo nasce na aprovação do projeto
create or replace function kontrol_private.definir_ciclo_pagamento()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_urgente boolean := coalesce(new.urgencia, 'normal') in ('alta', 'critica');
begin
  if tg_op = 'INSERT' then
    if v_urgente and nullif(btrim(coalesce(new.urgencia_justificativa, '')), '') is null
       and new.origem = 'reposicao_estoque' then
      new.urgencia_justificativa := 'Reposição de insumo crítico abaixo do mínimo (gerada pelo painel de estoque).';
    end if;
    if current_user = 'authenticated' then
      new.ciclo_pagamento := null;
    end if;
    return new;
  end if;

  if current_user = 'authenticated' and new.ciclo_pagamento is distinct from old.ciclo_pagamento then
    raise exception 'O ciclo de pagamento é definido pelo sistema na aprovação da coordenação.' using errcode = '42501';
  end if;

  -- envio (ou reenvio): urgência precisa de justificativa; ciclo recomeça
  if new.status in ('em_validacao', 'aguardando_area') and new.status is distinct from old.status then
    if v_urgente and char_length(btrim(coalesce(new.urgencia_justificativa, ''))) < 15 then
      raise exception 'Pedido urgente fura o ciclo do dia 10 e precisa de justificativa: escreva por que não pode esperar o próximo ciclo.'
        using errcode = '22023';
    end if;
    new.ciclo_pagamento := null;
    return new;
  end if;

  -- 0188: ordem nova, a última aprovação (coordenador do projeto) define o ciclo
  if old.status = 'aguardando_projeto' and new.status = 'aprovado_para_compra' then
    new.ciclo_pagamento := kontrol_private.ciclo_para(now(), v_urgente);
    return new;
  end if;
  if new.fluxo = 2 then
    return new;
  end if;

  if old.status = 'em_validacao' and new.status = 'validado' then
    new.ciclo_pagamento := kontrol_private.ciclo_para(now(), v_urgente);
    return new;
  end if;
  if new.aprovacao_area_em is not null and old.aprovacao_area_em is null then
    new.ciclo_pagamento := kontrol_private.ciclo_para(new.aprovacao_area_em, v_urgente);
  end if;
  return new;
end $function$;

-- 10c. Trava do ciclo seguinte (0176/0184): na ordem nova, a compra só fecha quando o ciclo abre
create or replace function kontrol_private.travar_ciclo_seguinte()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_libera date;
  v_email text;
  v_de text;
begin
  if current_user = 'authenticated'
     and old.status not in ('rascunho', 'ajuste_solicitante', 'ajuste_compras')
     and (coalesce(new.urgencia, 'normal') is distinct from coalesce(old.urgencia, 'normal')
          or nullif(btrim(coalesce(new.urgencia_justificativa, '')), '')
             is distinct from nullif(btrim(coalesce(old.urgencia_justificativa, '')), '')) then
    raise exception 'A urgência só muda com o pedido em rascunho ou devolvido para ajuste. Para mudar, devolva o pedido ao solicitante.'
      using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;
  -- 0188: ordem nova, a trava fica na saída de "aprovado para compra"
  v_de := case when new.fluxo = 2 then 'aprovado_para_compra' else 'validado' end;
  if old.status <> v_de
     or new.status in ('ajuste_solicitante', 'ajuste_compras', 'em_validacao', 'cancelado') then
    return new;
  end if;

  v_libera := kontrol_private.ciclo_libera_em(new.ciclo_pagamento, new.urgencia, new.urgencia_justificativa);
  if v_libera is not null and auth.uid() is not null and kontrol_private.conduz_compra() then
    begin
      v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
    exception when others then
      v_email := null;
    end;
    insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
    values ('pedido_interno', new.id, null, old.status, v_email,
            format('Seguiu para compras antes do ciclo de %s abrir (%s), por quem conduz a compra inteira.',
                   kontrol_private.rotulo_ciclo(v_libera), to_char(v_libera, 'DD/MM/YYYY')));
    return new;
  end if;
  if v_libera is not null then
    raise exception 'Este pedido entrou no ciclo de compras de % porque foi aprovado depois do prazo do dia 10. Ele segue para compras a partir de %. Só pedido urgente, com justificativa, ou quem tem "Conduzir a compra inteira" fura o ciclo.',
      kontrol_private.rotulo_ciclo(v_libera), to_char(v_libera, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  return new;
end $function$;

revoke all on function kontrol_private.travar_ciclo_seguinte() from public, anon;

-- 10d. Foto do que foi aprovado (0175/0177): na ordem nova, tirada no envio
create or replace function kontrol_private.guardar_validacao_pedido()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_user = 'authenticated' and (
       new.validacao_projeto_id is distinct from old.validacao_projeto_id
       or new.validacao_justificativa is distinct from old.validacao_justificativa
       or new.validacao_valor is distinct from old.validacao_valor
       or new.validacao_itens is distinct from old.validacao_itens
       or new.validacao_registrada_em is distinct from old.validacao_registrada_em) then
    raise exception 'A foto da validação é gravada pelo sistema.' using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  -- 0188: ordem nova. O envio que (re)começa pelo laboratório ou campo guarda o
  -- que foi enviado; o reenvio que volta para quem devolveu mantém a foto.
  if new.status = 'aguardando_area' and old.status in ('rascunho', 'ajuste_solicitante') then
    new.validacao_projeto_id := new.projeto_id;
    new.validacao_justificativa := new.justificativa;
    new.validacao_valor := kontrol_private.valor_pedido_interno(new.id);
    new.validacao_itens := kontrol_private.marca_itens_pedido_interno(new.id);
    new.validacao_registrada_em := now();
    return new;
  end if;

  if old.status = 'em_validacao' and new.status = 'validado' then
    new.validacao_projeto_id := new.projeto_id;
    new.validacao_justificativa := new.justificativa;
    new.validacao_valor := kontrol_private.valor_pedido_interno(new.id);
    new.validacao_itens := kontrol_private.marca_itens_pedido_interno(new.id);
    new.validacao_registrada_em := now();
    return new;
  end if;

  if new.status = 'em_validacao' then
    new.validacao_projeto_id := null;
    new.validacao_justificativa := null;
    new.validacao_valor := null;
    new.validacao_itens := null;
    new.validacao_registrada_em := null;
  end if;
  return new;
end $function$;

-- 10e. Carimbo do envio
create or replace function kontrol_private.carimbar_envio_pedido_interno()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.status in ('em_validacao', 'aguardando_area') and old.status is distinct from new.status then
    new.enviado_validacao_em := now();
  end if;
  return new;
end $function$;

-- 10f. Produto controlado só pela Funpar (0174)
create or replace function kontrol_private.exigir_funpar_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_itens text;
  v_base text;
begin
  if new.status is not distinct from old.status
     or new.status not in ('em_validacao', 'aguardando_area', 'aprovado_compra', 'aguardando_projeto',
                           'compra_fechada', 'encaminhado_instituicao') then
    return new;
  end if;
  v_itens := kontrol_private.itens_controlados_pedido(new.id);
  if v_itens is null then
    return new;
  end if;
  v_base := format('Produto controlado (%s): a ATGC não tem licença, a compra só sai pela FUNPAR, em projeto com recurso na fundação.', v_itens);

  if new.status in ('em_validacao', 'aguardando_area') and new.projeto_id is null then
    raise exception '% Escolha o projeto do pedido (Editar, no topo).', v_base using errcode = '22023';
  end if;
  if new.status = 'aprovado_compra' and coalesce(new.fonte_recurso, '') !~* 'funpar' then
    raise exception '% Na análise administrativa, a fonte do recurso tem que ser a FUNPAR.', v_base using errcode = '22023';
  end if;
  if new.status = 'aguardando_projeto' and coalesce(new.fonte_recurso, '') !~* 'funpar' then
    raise exception '% Na aprovação financeira, a fonte de pagamento tem que ser a Funpar.', v_base using errcode = '22023';
  end if;
  if new.status = 'compra_fechada' then
    raise exception '% Não pode ser compra direta: use "Encaminhar à instituição", com destino FUNPAR.', v_base using errcode = '22023';
  end if;
  if new.status = 'encaminhado_instituicao' and coalesce(new.instituicao_destino, '') !~* 'funpar' then
    raise exception '% Encaminhe à FUNPAR (instituição de destino: FUNPAR).', v_base using errcode = '22023';
  end if;
  return new;
end $function$;

-- 10g. Campos que só as etapas mudam (0125/0127)
create or replace function kontrol_private.proteger_pedido_interno_direto()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_editaveis constant text[] := array['rascunho', 'ajuste_solicitante', 'ajuste_compras'];
  v_protegidas constant text[] := array[
    'status', 'solicitante', 'pedido_compra_id', 'validado_em', 'formalizado_em', 'analisado_em',
    'orcamentos_em', 'fechado_em', 'encaminhado_em', 'aprovacao_final_em', 'pagamento_nf_em',
    'concluido_em', 'recebido_em', 'recebido_por', 'rubrica', 'conformidade_admin',
    'observacao_compras', 'comprador_responsavel', 'aprovador_coordenador',
    'aprovado_coordenador_em', 'aprovador_coordenador_diferente', 'modalidade_compra',
    'modalidade_definida_em', 'modalidade_definida_por', 'instituicao_destino',
    'protocolo_externo', 'data_envio_instituicao', 'data_retorno_instituicao',
    'observacao_administrativa', 'origem',
    -- 0188
    'fluxo', 'aprovacao_financeiro_em', 'aprovacao_financeiro_por', 'devolvido_na_etapa'
  ];
  v_novo jsonb;
  v_antigo jsonb;
  v_coluna text;
begin
  if current_user <> 'authenticated'
    or kontrol_private.tem_permissao_efetiva('pedido.aprovar') then
    return new;
  end if;

  if lower(coalesce(old.solicitante, '')) <> lower(coalesce(auth.jwt() ->> 'email', '-')) then
    raise exception 'Só quem abriu o pedido interno pode alterá-lo. Quem aprova pedidos usa as etapas do pedido.'
      using errcode = '42501';
  end if;

  v_novo := to_jsonb(new) - 'atualizado_em' - 'enviado_validacao_em';
  v_antigo := to_jsonb(old) - 'atualizado_em' - 'enviado_validacao_em';

  if not (old.status = any (v_editaveis)) then
    if v_novo = v_antigo then
      new.enviado_validacao_em := old.enviado_validacao_em;
      return new;
    end if;
    raise exception 'O pedido interno só pode ser alterado em rascunho ou em ajuste.'
      using errcode = '42501';
  end if;

  foreach v_coluna in array v_protegidas loop
    if (v_novo -> v_coluna) is distinct from (v_antigo -> v_coluna) then
      raise exception 'O campo % só muda pelas etapas do pedido interno.', v_coluna
        using errcode = '42501';
    end if;
  end loop;
  return new;
end $function$;

-- 10h. Avisos de cada passagem (0173/0176): as três vezes novas avisam quem decide
create or replace function kontrol_private.avisar_passagem_etapa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_coluna text := coalesce(nullif(tg_argv[0], ''), 'status');
  v_novo_reg jsonb := to_jsonb(new);
  v_novo text;
  v_antigo text;
  v_id bigint := (to_jsonb(new) ->> 'id')::bigint;
  v_permissao text;
  v_titulo text;
  v_corpo text;
  v_entidade_tipo text;
  v_entidade_id bigint := (to_jsonb(new) ->> 'id')::bigint;
  v_chave text;
  v_rotulo text;
  v_usuario uuid;
  v_solicitante uuid;
  v_pedido text;
  v_admin_resp uuid;
  v_libera date;
  v_reenvio text;
begin
  v_novo := v_novo_reg ->> v_coluna;
  if tg_op = 'UPDATE' then
    v_antigo := to_jsonb(old) ->> v_coluna;
  end if;
  if v_novo is null or v_novo is not distinct from v_antigo then
    return null;
  end if;
  v_chave := format('etapa:%s:%s:%s:%s', tg_table_name, v_id, v_novo,
    (extract(epoch from clock_timestamp()) * 1000)::bigint);

  if tg_table_name = 'pedidos_internos' then
    v_pedido := format('Pedido interno #%s: %s.', v_id, coalesce(v_novo_reg ->> 'titulo', 'sem título'));
    v_solicitante := kontrol_private.usuario_por_email(v_novo_reg ->> 'solicitante');
    v_admin_resp := kontrol_private.responsavel_compras('administrativo');
    v_reenvio := case when v_antigo = 'ajuste_solicitante' then ' Corrigido e reenviado por quem pediu.' else '' end;

    -- ---- 0188: ordem nova ----
    if v_novo = 'aguardando_area' then
      select coalesce(c.coordenador_id, c.substituto_id), c.nome into v_usuario, v_rotulo
        from public.coordenacoes_area c
       where c.id = nullif(v_novo_reg ->> 'area_id', '')::bigint;
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando a sua aprovação (laboratório ou campo)',
        format('%s %s: primeira das três aprovações. Solicitante: %s.%s', v_pedido, coalesce(v_rotulo, 'Laboratório ou campo'),
               coalesce(v_novo_reg ->> 'solicitante', '—'), v_reenvio),
        v_id, v_usuario, 'pedido.aprovar', v_chave);

    elsif v_novo = 'aguardando_financeiro' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando a aprovação financeira',
        format('%s O laboratório ou campo já aprovou. Escolha a fonte de pagamento e aprove.%s', v_pedido, v_reenvio),
        v_id, v_admin_resp, null, v_chave, 'admin');

    elsif v_novo = 'aguardando_projeto' then
      if nullif(v_novo_reg ->> 'projeto_id', '') is not null then
        select coordenador_id into v_usuario
          from public.projetos where id = (v_novo_reg ->> 'projeto_id')::bigint;
      else
        select pf.id into v_usuario
          from public.perfis pf
         where pf.papel = 'supervisor' and not coalesce(pf.suspenso, false)
         order by coalesce(pf.nome, pf.email)
         limit 1;
      end if;
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando a sua aprovação (coordenador do projeto)',
        format('%s Laboratório ou campo e financeiro (fonte: %s) já aprovaram. Falta a sua, a última.%s', v_pedido,
               coalesce(v_novo_reg ->> 'fonte_recurso', '—'), v_reenvio),
        v_id, v_usuario, 'pedido.aprovar', v_chave);

    elsif v_novo = 'ajuste_solicitante' and (v_novo_reg ->> 'fluxo') = '2' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno devolvido para você corrigir',
        format('%s Devolvido na %s. Corrija e reenvie: se itens, valor, justificativa e projeto não mudarem, ele volta direto para quem devolveu.',
               v_pedido, lower(coalesce(kontrol_private.etapa_fluxo2(v_novo_reg ->> 'devolvido_na_etapa'), 'aprovação'))),
        v_id, v_solicitante, null, v_chave);

    -- ---- ordem antiga (0136/0169/0173/0176) ----
    elsif v_novo = 'em_validacao' then
      if nullif(v_novo_reg ->> 'projeto_id', '') is not null then
        select coordenador_id into v_usuario
          from public.projetos where id = (v_novo_reg ->> 'projeto_id')::bigint;
      else
        select pf.id into v_usuario
          from public.perfis pf
         where pf.papel = 'supervisor' and not coalesce(pf.suspenso, false)
         order by coalesce(pf.nome, pf.email)
         limit 1;
      end if;
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando validação',
        format('%s Solicitante: %s.', v_pedido, coalesce(v_novo_reg ->> 'solicitante', '—')),
        v_id, v_usuario, 'pedido.aprovar', v_chave);

    elsif v_novo = 'validado' and coalesce(v_novo_reg ->> 'natureza', '') = 'material_consumo_lab'
          and v_novo_reg ->> 'aprovacao_area_em' is null then
      select c.coordenador_id, c.nome into v_usuario, v_rotulo
        from public.coordenacoes_area c
       where c.id = nullif(v_novo_reg ->> 'area_id', '')::bigint;
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando a coordenação do laboratório',
        format('%s Laboratório: %s. O coordenador do projeto já validou.', v_pedido, coalesce(v_rotulo, 'não informado')),
        v_id, v_usuario, 'pedido.aprovar', v_chave);

    elsif v_novo = 'validado'
          and kontrol_private.ciclo_libera_em(nullif(v_novo_reg ->> 'ciclo_pagamento', '')::date,
                v_novo_reg ->> 'urgencia', v_novo_reg ->> 'urgencia_justificativa') is not null then
      v_libera := kontrol_private.ciclo_libera_em(nullif(v_novo_reg ->> 'ciclo_pagamento', '')::date,
                    v_novo_reg ->> 'urgencia', v_novo_reg ->> 'urgencia_justificativa');
      perform kontrol_private.notificar_pedido('sistema',
        format('Pedido interno validado: aguarda o ciclo de %s', kontrol_private.rotulo_ciclo(v_libera)),
        format('%s %s Aprovado depois do prazo do dia 10, entrou no ciclo de %s: a formalização abre em %s, e você recebe outro aviso nesse dia.',
               v_pedido,
               case when v_antigo in ('ajuste_solicitante', 'ajuste_compras')
                    then 'Reenviado depois do ajuste, com as aprovações mantidas.'
                    else 'O coordenador validou.' end,
               kontrol_private.rotulo_ciclo(v_libera), to_char(v_libera, 'DD/MM/YYYY')),
        v_id, v_admin_resp, null, v_chave, 'admin');

    elsif v_novo = 'validado' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno validado: formalizar a compra',
        format('%s %s Formalize para seguir à autorização administrativa.', v_pedido,
               case when v_antigo in ('ajuste_solicitante', 'ajuste_compras')
                    then 'Reenviado depois do ajuste, com as aprovações mantidas.'
                    else 'O coordenador validou.' end),
        v_id, v_admin_resp, null, v_chave, 'admin');

    elsif v_novo in ('ajuste_solicitante', 'ajuste_compras') then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno devolvido para ajuste',
        format('%s Devolvido %s. Ajuste e reenvie: se valor, justificativa e projeto não mudarem, as aprovações continuam valendo.', v_pedido,
               case v_novo when 'ajuste_solicitante' then 'pela validação' else 'pelo administrativo' end),
        v_id, v_solicitante, null, v_chave);

    elsif v_novo in ('formalizado', 'analise_administrativa') and v_antigo is distinct from 'formalizado' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando autorização administrativa',
        format('%s Defina fonte e rubrica e autorize a compra.', v_pedido),
        v_id, v_admin_resp, null, v_chave, 'admin');

    elsif v_novo = 'aprovado_compra' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Compra autorizada: pedir os 3 orçamentos',
        format('%s Autorizado pelo administrativo (fonte: %s; rubrica: %s).', v_pedido,
               coalesce(v_novo_reg ->> 'fonte_recurso', '—'), coalesce(v_novo_reg ->> 'rubrica', '—')),
        v_id, v_admin_resp, null, v_chave, 'admin');

    elsif v_novo = 'orcamentos_recebidos' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Orçamentos recebidos: escolher o orçamento',
        format('%s Os 3 orçamentos foram registrados. Escolha um e envie para a aprovação final.', v_pedido),
        v_id, v_admin_resp, null, v_chave, 'admin');

    elsif v_novo = 'aguardando_aprovacao_final' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando aprovação final',
        format('%s Orçamento escolhido; falta a aprovação final da compra.', v_pedido),
        v_id, v_admin_resp, null, v_chave, 'admin');

    -- ---- daqui em diante, as duas ordens seguem iguais ----
    elsif v_novo = 'aprovado_para_compra' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Compra aprovada: fechar com o fornecedor',
        format('%s %s Feche com o fornecedor ou encaminhe à instituição.', v_pedido,
               case when v_antigo = 'aguardando_projeto' then 'As três aprovações foram dadas.' else '' end),
        v_id, v_admin_resp, null, v_chave, 'admin');
      perform kontrol_private.notificar_pedido('sistema', 'Seu pedido interno foi aprovado para compra',
        format('%s A compra foi aprovada.', v_pedido), v_id, v_solicitante, null, v_chave || ':solicitante');

    elsif v_novo in ('compra_fechada', 'encaminhado_instituicao') then
      perform kontrol_private.notificar_pedido('sistema', 'Seu pedido interno está a caminho',
        format('%s %s Quando chegar (ou o serviço for prestado), registre no pedido: o pagamento só sai depois disso.', v_pedido,
               case v_novo when 'compra_fechada' then 'A compra foi fechada com o fornecedor.' else 'Foi encaminhado à instituição.' end),
        v_id, v_solicitante, null, v_chave);

    elsif v_novo = 'aguardando_pagamento_nf' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando pagamento e nota fiscal',
        format('%s Entrega registrada. Faça o pagamento e anexe a nota fiscal.', v_pedido),
        v_id, kontrol_private.responsavel_compras('pagamento'), null, v_chave, 'admin');

    elsif v_novo = 'compra_concluida' then
      perform kontrol_private.notificar_pedido('sistema', 'Seu pedido interno foi concluído',
        format('%s Compra concluída e paga.', v_pedido), v_id, v_solicitante, null, v_chave);

    elsif v_novo = 'cancelado' then
      perform kontrol_private.notificar_pedido('sistema', 'Seu pedido interno foi cancelado',
        format('%s O motivo está no histórico do pedido.', v_pedido), v_id, v_solicitante, null, v_chave);
    end if;
    return null;
  end if;

  if tg_table_name = 'pedidos_compra' and v_novo = 'solicitado' then
    if coalesce(v_novo_reg ->> 'observacao', '') like 'Formalizado a partir do pedido interno #%' then
      return null;
    end if;
    v_permissao := 'compras.aprovar';
    v_titulo := 'Compra aguardando aprovação';
    v_corpo := format('Compra #%s solicitada%s.', v_id,
      coalesce(' para ' || nullif(v_novo_reg ->> 'projeto', ''), ''));
    v_entidade_tipo := 'pedido_compra';
  elsif tg_table_name = 'pedidos_compra' and v_novo in ('aprovado', 'enviado') then
    v_permissao := 'compras.receber';
    v_titulo := case v_novo when 'aprovado' then 'Compra aprovada: acompanhe até o recebimento'
      else 'Compra enviada: prepare o recebimento' end;
    v_corpo := format('Compra #%s está %s.', v_id, case v_novo when 'aprovado' then 'aprovada' else 'enviada' end);
    v_entidade_tipo := 'pedido_compra';
  elsif tg_table_name = 'lotes_estoque' and v_novo = 'quarentena' then
    v_permissao := 'estoque.lote.aceitar';
    select especificacao into v_rotulo from public.insumos where id = (v_novo_reg ->> 'insumo_id')::bigint;
    v_titulo := 'Lote em quarentena aguardando aceite';
    v_corpo := format('Lote %s de %s aguarda conferência e aceite.',
      coalesce(v_novo_reg ->> 'codigo_lote', '#' || v_id), coalesce(v_rotulo, 'insumo'));
    v_entidade_tipo := 'lote';
    v_chave := format('etapa:lotes_estoque:%s:quarentena', v_id);
  elsif tg_table_name = 'orcamentos' and v_novo = 'revisado' then
    v_permissao := 'orcamentos.emitir';
    v_titulo := 'Módulo laboratorial revisado: proposta pronta para emissão';
    v_corpo := format('O orçamento de análises #%s foi revisado.', v_id);
    if v_novo_reg ->> 'demanda_id' is not null then
      v_entidade_tipo := 'demanda';
      v_entidade_id := (v_novo_reg ->> 'demanda_id')::bigint;
    else
      v_entidade_tipo := 'orcamento';
    end if;
  elsif tg_table_name = 'orcamento_projetos' and v_novo = 'enviado' then
    v_permissao := 'orcamentos.emitir';
    v_titulo := 'Custos de projeto revisados: proposta pronta para emissão';
    v_corpo := format('Os custos de projeto #%s foram revisados.', v_id);
    if v_novo_reg ->> 'demanda_id' is not null then
      v_entidade_tipo := 'demanda';
      v_entidade_id := (v_novo_reg ->> 'demanda_id')::bigint;
    else
      v_entidade_tipo := 'orcamento_projeto';
    end if;
  else
    return null;
  end if;

  begin
    insert into public.notificacoes (tipo, titulo, corpo, entidade_tipo, entidade_id, permissao_destino, usuario_destino, dedupe_key)
    values ('aprovacao_pendente', v_titulo, v_corpo, v_entidade_tipo, v_entidade_id, v_permissao, v_usuario, v_chave)
    on conflict do nothing;
  exception when others then
    raise warning 'Kontrol: aviso de etapa não gravado (% #%): %', tg_table_name, v_id, sqlerrm;
  end;
  return null;
end $function$;

-- 10i. "Aguardando você" (0173/0176/0185): as três vezes novas entram nas mesmas filas
create or replace function public.aguardando_voce()
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_saida jsonb := '[]'::jsonb;
  v_qtd bigint;
  v_itens jsonb;
  v_uid uuid := auth.uid();
  v_admin boolean := coalesce(public.current_papel(), '') = 'admin';
  v_conduz boolean := coalesce(kontrol_private.conduz_compra(), false);
  v_financeiro boolean := false;
begin
  if v_uid is null then
    return v_saida;
  end if;
  -- 0188: financeiro = função Administrativo ou o responsável do administrativo
  v_financeiro := coalesce(public.current_papel(), '') = 'administrativo'
    or v_uid is not distinct from kontrol_private.responsavel_compras('administrativo');

  -- coordenador do projeto: validação (ordem antiga) e a última aprovação (ordem nova)
  with minhas as (
    select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo,
           coalesce(p.enviado_validacao_em, p.atualizado_em, p.criado_em) as desde
      from public.pedidos_internos p
     where p.status in ('em_validacao', 'aguardando_projeto')
       and (v_admin or coalesce(
             (kontrol_private.aprovadores_pedido(p.projeto_id, p.natureza, p.area_id) -> 'coordenador' -> 'ids') ? v_uid::text,
             false))
  )
  select (select count(*) from minhas),
         coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                     from (select id, rotulo from minhas order by desde limit 3) s), '[]'::jsonb)
    into v_qtd, v_itens;
  if v_qtd > 0 or kontrol_private.tem_permissao_efetiva('pedido.aprovar') then
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_validacao', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  -- coordenação do laboratório ou do campo (coordenador ou substituto)
  with minhas as (
    select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo, p.atualizado_em as desde
      from public.pedidos_internos p
      join public.coordenacoes_area c on c.id = p.area_id
     where ((p.status = 'validado' and p.natureza = 'material_consumo_lab' and p.aprovacao_area_em is null)
            or p.status = 'aguardando_area')
       and (v_admin or v_uid in (c.coordenador_id, c.substituto_id))
  )
  select (select count(*) from minhas),
         coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                     from (select id, rotulo from minhas order by desde limit 3) s), '[]'::jsonb)
    into v_qtd, v_itens;
  if v_qtd > 0 then
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_laboratorio', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  -- etapas de compras (responsável do administrativo; sem ele, o Administrador),
  -- quem conduz a compra inteira e, na ordem nova, o financeiro
  if v_admin or v_conduz or v_financeiro then
    with fila as (
      select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo, p.atualizado_em as desde
        from public.pedidos_internos p
       where p.status in ('formalizado', 'analise_administrativa', 'aguardando_financeiro')
          or (p.status = 'validado'
              and (coalesce(p.natureza, '') <> 'material_consumo_lab' or p.aprovacao_area_em is not null)
              and (v_conduz
                   or kontrol_private.ciclo_libera_em(p.ciclo_pagamento, p.urgencia, p.urgencia_justificativa) is null))
    )
    select (select count(*) from fila),
           coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                       from (select id, rotulo from fila order by desde limit 3) s), '[]'::jsonb)
      into v_qtd, v_itens;
    if v_qtd > 0 then
      v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_administrativo', 'quantidade', v_qtd, 'itens', v_itens));
    end if;
  end if;
  if v_admin or v_conduz or v_uid is not distinct from kontrol_private.responsavel_compras('administrativo') then
    with fila as (
      select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo, p.atualizado_em as desde
        from public.pedidos_internos p
       where p.status in ('aprovado_compra', 'orcamentos', 'orcamentos_recebidos', 'aguardando_aprovacao_final', 'aprovado_para_compra')
    )
    select (select count(*) from fila),
           coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                       from (select id, rotulo from fila order by desde limit 3) s), '[]'::jsonb)
      into v_qtd, v_itens;
    if v_qtd > 0 then
      v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_compras', 'quantidade', v_qtd, 'itens', v_itens));
    end if;
  end if;
  if v_admin or v_conduz or v_uid is not distinct from kontrol_private.responsavel_compras('pagamento') then
    with prontos as (
      select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo, p.atualizado_em as desde
        from public.pedidos_internos p
       where p.status = 'aguardando_pagamento_nf'
          or (p.status in ('compra_fechada', 'encaminhado_instituicao') and kontrol_private.pendencia_pagamento(p.id) is null)
    )
    select (select count(*) from prontos),
           coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                       from (select id, rotulo from prontos order by desde limit 3) s), '[]'::jsonb)
      into v_qtd, v_itens;
    if v_qtd > 0 then
      v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_pagamento', 'quantidade', v_qtd, 'itens', v_itens));
    end if;
  end if;

  if kontrol_private.tem_permissao_efetiva('compras.aprovar') then
    with soltas as (
      select pc.id, 'Compra #' || pc.id || coalesce(' · ' || nullif(pc.projeto, ''), '') as rotulo, pc.criado_em
        from public.pedidos_compra pc
       where pc.status = 'solicitado'
         and coalesce(pc.observacao, '') not like 'Formalizado a partir do pedido interno #%'
         and not exists (select 1 from public.pedidos_internos pi where pi.pedido_compra_id = pc.id)
    )
    select (select count(*) from soltas),
           coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                       from (select id, rotulo from soltas order by criado_em limit 3) s), '[]'::jsonb)
      into v_qtd, v_itens;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'compras_aprovar', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  if kontrol_private.tem_permissao_efetiva('compras.receber') then
    select count(*) into v_qtd from public.pedidos_compra where status in ('aprovado', 'enviado', 'em_transito');
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo)), '[]'::jsonb) into v_itens
    from (
      select id, 'Compra #' || id || coalesce(' · ' || nullif(projeto, ''), '') as rotulo
      from public.pedidos_compra where status in ('aprovado', 'enviado', 'em_transito')
      order by criado_em limit 3
    ) s;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'compras_receber', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  if kontrol_private.tem_permissao_efetiva('orcamentos.emitir') then
    with prontas as (
      select d.id, coalesce(d.titulo, 'Proposta #' || d.id) as rotulo, d.criado_em
      from public.demandas_propostas d
      where d.status in ('nova', 'em_analise')
        and (
          exists (select 1 from public.orcamentos o where o.demanda_id = d.id and o.status_operacional = 'revisado')
          or exists (select 1 from public.orcamento_projetos p where p.demanda_id = d.id and p.status = 'enviado')
        )
        and not exists (
          select 1 from public.orcamento_final_versoes f
          where f.demanda_id = d.id and f.status not in ('cancelado', 'substituido')
        )
    )
    select (select count(*) from prontas),
      coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
        from (select id, rotulo from prontas order by criado_em limit 3) s), '[]'::jsonb)
    into v_qtd, v_itens;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'propostas_emitir', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  if kontrol_private.tem_permissao_efetiva('planejamento.editar') then
    select count(*) into v_qtd from public.planejamento where coalesce(status_operacional, 'rascunho') = 'rascunho';
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo)), '[]'::jsonb) into v_itens
    from (
      select id, coalesce(nome, 'Plano #' || id) as rotulo
      from public.planejamento where coalesce(status_operacional, 'rascunho') = 'rascunho'
      order by coalesce(data_alvo, criado_em::date), id limit 3
    ) s;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'planos_rascunho', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  return v_saida;
end $function$;

revoke all on function public.aguardando_voce() from public, anon;
grant execute on function public.aguardando_voce() to authenticated;

notify pgrst, 'reload schema';

commit;
