-- 0189 — Cotação depois do financeiro, pelo solicitante.
--
-- Relatório de ajuste da Rafaela (27/11/2026), mandado por Antonio em
-- 28/11/2026, e decisão dele no cartão de 28/11 10:43 UTC ("Depois do
-- financeiro"):
--   * o Novo pedido leva só o orçamento prévio (e o termo de referência);
--   * a cotação (3 orçamentos de fornecedores diferentes, cada um com o
--     documento) é uma etapa própria, feita por quem pediu, depois da
--     aprovação financeira;
--   * a ordem fica: laboratório ou campo → financeiro (fonte de pagamento) →
--     cotação do solicitante → coordenador do projeto, que aprova por último
--     vendo os 3 orçamentos (e assina o Termo de Referência com o mapa de
--     preços).
--
-- O que muda no banco (sobre a 0188):
--   1. Status novo aguardando_cotacao (só na ordem nova).
--   2. enviar_pedido_interno não exige mais os 3 orçamentos no envio. O
--      reenvio que volta direto ao coordenador do projeto confere a cotação.
--   3. decidir_aprovacao_pedido: a aprovação financeira leva à cotação; a do
--      projeto exige a cotação completa e um orçamento escolhido.
--   4. RPC nova enviar_cotacao_pedido: quem pediu (ou quem conduz a compra
--      inteira) manda a cotação ao coordenador do projeto; sem escolha, vale o
--      de menor valor.
--   5. Orçamentos entram na cotação e no ajuste (não mais no rascunho);
--      trocar o escolhido vale na cotação e na aprovação do projeto.
--   6. Reprovar, Funpar para produto controlado, avisos e "Aguardando você"
--      conhecem a etapa nova.
--
-- Não destrutiva: acrescenta um status e uma função e troca o corpo de funções
-- existentes (a definição anterior de cada uma está na 0188).
--
-- Rollback (só se nenhum pedido estiver em aguardando_cotacao; conferir antes com
--   select id, status from public.pedidos_internos where status = 'aguardando_cotacao';):
--   recriar as funções a partir da 0188 (o backup do deploy guarda as
--   definições atuais), drop function public.enviar_cotacao_pedido(bigint, text),
--   recriar as três políticas dos orçamentos do solicitante como na 0188 e o
--   check de status sem aguardando_cotacao.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pedidos_internos'
                    and column_name = 'devolvido_na_etapa') then
    raise exception '0189: requer a migration 0188';
  end if;
end $$;

-- ---- 1. Status novo -----------------------------------------------------------------------
alter table public.pedidos_internos drop constraint if exists pedidos_internos_status_check;
alter table public.pedidos_internos add constraint pedidos_internos_status_check check (status = any (array[
  'rascunho', 'em_validacao', 'ajuste_solicitante', 'validado', 'formalizado', 'analise_administrativa',
  'ajuste_compras', 'aprovado_compra', 'orcamentos', 'orcamentos_recebidos', 'aguardando_aprovacao_final',
  'aprovado_para_compra', 'compra_fechada', 'encaminhado_instituicao', 'aguardando_pagamento_nf',
  'compra_concluida', 'cancelado',
  'aguardando_area', 'aguardando_financeiro', 'aguardando_projeto', 'aguardando_cotacao'
]::text[])) not valid;

-- ---- 2. Orçamentos: o solicitante registra na cotação e no ajuste ---------------------------
drop policy if exists pedidos_internos_cotacoes_solicitante_incluir on public.pedidos_internos_cotacoes;
create policy pedidos_internos_cotacoes_solicitante_incluir on public.pedidos_internos_cotacoes
  for insert to authenticated
  with check (
    kontrol_private.tem_permissao_efetiva('pedido.criar')
    and exists (select 1 from public.pedidos_internos pi
                 where pi.id = pedidos_internos_cotacoes.pedido_interno_id
                   and pi.fluxo = 2
                   and pi.status in ('ajuste_solicitante', 'aguardando_cotacao')
                   and lower(btrim(coalesce(pi.solicitante, ''))) = lower(coalesce(auth.jwt() ->> 'email', '-'))));
drop policy if exists pedidos_internos_cotacoes_solicitante_alterar on public.pedidos_internos_cotacoes;
create policy pedidos_internos_cotacoes_solicitante_alterar on public.pedidos_internos_cotacoes
  for update to authenticated
  using (
    kontrol_private.tem_permissao_efetiva('pedido.criar')
    and exists (select 1 from public.pedidos_internos pi
                 where pi.id = pedidos_internos_cotacoes.pedido_interno_id
                   and pi.fluxo = 2
                   and pi.status in ('ajuste_solicitante', 'aguardando_cotacao')
                   and lower(btrim(coalesce(pi.solicitante, ''))) = lower(coalesce(auth.jwt() ->> 'email', '-'))))
  with check (
    kontrol_private.tem_permissao_efetiva('pedido.criar')
    and exists (select 1 from public.pedidos_internos pi
                 where pi.id = pedidos_internos_cotacoes.pedido_interno_id
                   and pi.fluxo = 2
                   and pi.status in ('ajuste_solicitante', 'aguardando_cotacao')
                   and lower(btrim(coalesce(pi.solicitante, ''))) = lower(coalesce(auth.jwt() ->> 'email', '-'))));
drop policy if exists pedidos_internos_cotacoes_solicitante_excluir on public.pedidos_internos_cotacoes;
create policy pedidos_internos_cotacoes_solicitante_excluir on public.pedidos_internos_cotacoes
  for delete to authenticated
  using (
    kontrol_private.tem_permissao_efetiva('pedido.criar')
    and exists (select 1 from public.pedidos_internos pi
                 where pi.id = pedidos_internos_cotacoes.pedido_interno_id
                   and pi.fluxo = 2
                   and pi.status in ('ajuste_solicitante', 'aguardando_cotacao')
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
    -- 0189: na ordem nova, os orçamentos entram na cotação (depois do
    -- financeiro) e quando o pedido volta para ajuste
    v_aberto := case when coalesce(v_fluxo, 1) = 2
                     then coalesce(v_status, '') in ('aguardando_cotacao', 'ajuste_solicitante')
                     else coalesce(v_status, '') in ('orcamentos', 'orcamentos_recebidos') end;
    if not v_aberto then
      if coalesce(v_fluxo, 1) = 2 then
        raise exception 'Os orçamentos entram na cotação, depois da aprovação financeira, ou quando o pedido volta para ajuste. No pedido vai só o orçamento prévio.'
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

-- Escolher outro orçamento. Ordem nova (0189): quem pediu, na cotação e no
-- ajuste; quem aprova, também na aprovação do projeto.
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
  v_aprova boolean := kontrol_private.tem_permissao_efetiva('pedido.aprovar');
begin
  select * into v_cot from public.pedidos_internos_cotacoes where id = p_cotacao_id;
  if not found then
    raise exception 'Orçamento não encontrado.' using errcode = 'P0002';
  end if;
  select * into v_pedido from public.pedidos_internos where id = v_cot.pedido_interno_id for update;
  if v_pedido.fluxo = 2 then
    if v_pedido.status not in ('aguardando_cotacao', 'ajuste_solicitante', 'aguardando_projeto') then
      raise exception 'O orçamento é escolhido na cotação e pode ser trocado até a aprovação do coordenador do projeto.'
        using errcode = '22023';
    end if;
    -- 0189: quem pediu faz a cotação e escolhe; na aprovação do projeto, só quem aprova
    if not v_aprova and not (v_pedido.status in ('aguardando_cotacao', 'ajuste_solicitante')
                             and lower(btrim(coalesce(v_pedido.solicitante, ''))) = lower(v_email)) then
      raise exception 'Escolher o orçamento é de quem pediu, na cotação, ou de quem tem "Aprovar pedidos internos".' using errcode = '42501';
    end if;
  elsif not v_aprova then
    raise exception 'Escolher o orçamento exige a permissão "Aprovar pedidos internos".' using errcode = '42501';
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

-- ---- 3. Nome da etapa e recusa ------------------------------------------------------------
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
           when 'aguardando_cotacao' then 'Cotação do solicitante'
           when 'aguardando_projeto' then 'Aprovação do coordenador do projeto'
         end
$function$;

revoke all on function kontrol_private.etapa_fluxo2(text) from public, anon;
grant execute on function kontrol_private.etapa_fluxo2(text) to authenticated, service_role;

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
    when 'aguardando_cotacao' then
      'O pedido está na cotação, com quem pediu. Nesta etapa, só o Administrador ou quem tem "Conduzir a compra inteira" reprova.'
    else 'Este pedido não está esperando uma das três aprovações.'
  end
$function$;

revoke all on function kontrol_private.recusa_fluxo2(text, jsonb) from public, anon;
grant execute on function kontrol_private.recusa_fluxo2(text, jsonb) to authenticated, service_role;

-- ---- 4. Envio e reenvio: sem os orçamentos ---------------------------------------------------
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

  -- 0189: os 3 orçamentos não vão mais no envio; vêm na cotação, depois do financeiro

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

  -- 0189: o reenvio que volta direto ao coordenador do projeto leva a cotação completa
  if v_destino = 'aguardando_projeto' then
    select count(distinct lower(btrim(c.fornecedor_nome))),
           count(distinct lower(btrim(c.fornecedor_nome))) filter (where c.anexo_id is not null)
      into v_fornecedores, v_com_documento
      from public.pedidos_internos_cotacoes c
     where c.pedido_interno_id = p_pedido_id;
    if v_fornecedores < 3 then
      raise exception 'A cotação precisa de 3 orçamentos de fornecedores diferentes. Este pedido tem %. Registre os orçamentos (com o documento de cada um) e reenvie.',
        v_fornecedores using errcode = '22023';
    end if;
    if v_com_documento < 3 then
      raise exception 'Anexe o documento de cada orçamento (PDF, foto ou planilha do fornecedor). Há % com documento; são precisos 3.',
        v_com_documento using errcode = '22023';
    end if;
    if not exists (select 1 from public.pedidos_internos_cotacoes c
                    where c.pedido_interno_id = p_pedido_id and c.escolhida) then
      update public.pedidos_internos_cotacoes
         set escolhida = true, escolhida_por = 'menor valor, no reenvio', escolhida_em = now(), justificativa_escolha = null
       where id = (select c.id from public.pedidos_internos_cotacoes c
                    where c.pedido_interno_id = p_pedido_id
                    order by c.valor_total, c.id limit 1);
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
  '0189: envia (ou reenvia, depois do ajuste) o pedido da ordem nova: exige item, justificativa, laboratório ou campo e quem aprove. Os 3 orçamentos vêm depois, na cotação; o reenvio que volta direto ao coordenador do projeto confere a cotação.';

revoke all on function public.enviar_pedido_interno(bigint, text) from public, anon;
grant execute on function public.enviar_pedido_interno(bigint, text) to authenticated;

-- ---- 5. Aprovar ou devolver: o financeiro leva à cotação -----------------------------------
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
    -- 0189: aprovado pelo financeiro, o pedido vai para a cotação de quem pediu
    v_destino := 'aguardando_cotacao';
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
    -- é aprovada junto (aprovar_compra_ligada, 0170). 0189: com a cotação completa.
    if coalesce((kontrol_private.resumo_orcamentos(p_pedido_id) ->> 'fornecedores')::integer, 0) < 3
       or (select count(distinct lower(btrim(c.fornecedor_nome))) from public.pedidos_internos_cotacoes c
            where c.pedido_interno_id = p_pedido_id and c.anexo_id is not null) < 3 then
      raise exception 'A cotação está incompleta: são precisos 3 orçamentos de fornecedores diferentes, cada um com o documento. Devolva ao solicitante para completar.'
        using errcode = '22023';
    end if;
    if not exists (select 1 from public.pedidos_internos_cotacoes c
                    where c.pedido_interno_id = p_pedido_id and c.escolhida) then
      raise exception 'Escolha um dos orçamentos antes de aprovar.' using errcode = '22023';
    end if;
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
  '0189: aprova ou devolve o pedido na vez em que ele está (laboratório ou campo, financeiro com a fonte de pagamento, coordenador do projeto). O financeiro leva à cotação do solicitante; a aprovação do projeto exige a cotação completa, cria a compra formal e libera a compra.';

revoke all on function public.decidir_aprovacao_pedido(bigint, text, text, jsonb) from public, anon;
grant execute on function public.decidir_aprovacao_pedido(bigint, text, text, jsonb) to authenticated;

-- ---- 6. A cotação do solicitante ----------------------------------------------------------
-- Quem pediu (ou quem conduz a compra inteira) manda os 3 orçamentos ao
-- coordenador do projeto. Sem escolha, vale o de menor valor; quem aprova pode
-- trocar, com justificativa.
create or replace function public.enviar_cotacao_pedido(p_pedido_id bigint, p_observacao text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text;
  v_p record;
  v_obs text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_fornecedores integer;
  v_com_documento integer;
  v_escolhido record;
  v_comentario text;
begin
  if auth.uid() is null then
    raise exception 'Entre no Kontrol para enviar a cotação.' using errcode = '42501';
  end if;
  begin
    v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_email := null;
  end;

  select pi.* into v_p from public.pedidos_internos pi where pi.id = p_pedido_id for update;
  if not found then
    raise exception 'Pedido interno não encontrado.' using errcode = 'P0002';
  end if;
  if v_p.fluxo <> 2 or v_p.status <> 'aguardando_cotacao' then
    raise exception 'Este pedido não está na cotação. A tela foi atualizada.' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(v_p.solicitante, ''))) <> lower(coalesce(v_email, '-'))
     and not coalesce(kontrol_private.conduz_compra(), false) then
    raise exception 'A cotação é de quem pediu (%). Na ausência, o Administrador ou quem tem "Conduzir a compra inteira" envia.',
      coalesce(v_p.solicitante, 'solicitante') using errcode = '42501';
  end if;

  select count(distinct lower(btrim(c.fornecedor_nome))),
         count(distinct lower(btrim(c.fornecedor_nome))) filter (where c.anexo_id is not null)
    into v_fornecedores, v_com_documento
    from public.pedidos_internos_cotacoes c
   where c.pedido_interno_id = p_pedido_id;
  if v_fornecedores < 3 then
    raise exception 'A cotação precisa de 3 orçamentos de fornecedores diferentes. Este pedido tem %. Registre os que faltam, com o documento de cada um.',
      v_fornecedores using errcode = '22023';
  end if;
  if v_com_documento < 3 then
    raise exception 'Anexe o documento de cada orçamento (PDF, foto ou planilha do fornecedor). Há % com documento; são precisos 3.',
      v_com_documento using errcode = '22023';
  end if;
  -- sem escolha, vale o de menor valor
  if not exists (select 1 from public.pedidos_internos_cotacoes c
                  where c.pedido_interno_id = p_pedido_id and c.escolhida) then
    update public.pedidos_internos_cotacoes
       set escolhida = true, escolhida_por = 'menor valor, no envio da cotação', escolhida_em = now(), justificativa_escolha = null
     where id = (select c.id from public.pedidos_internos_cotacoes c
                  where c.pedido_interno_id = p_pedido_id
                  order by c.valor_total, c.id limit 1);
  end if;
  select c.fornecedor_nome, c.valor_total into v_escolhido
    from public.pedidos_internos_cotacoes c
   where c.pedido_interno_id = p_pedido_id and c.escolhida
   limit 1;

  perform set_config('app.pedido_interno_transicao', 'permitida', true);
  update public.pedidos_internos
     set status = 'aguardando_projeto', orcamentos_em = now()
   where id = p_pedido_id;
  perform set_config('app.pedido_interno_transicao', '', true);

  v_comentario := concat_ws(' ',
    format('%s orçamentos; escolhido: %s, R$ %s.', v_fornecedores, v_escolhido.fornecedor_nome,
           replace(to_char(v_escolhido.valor_total, 'FM999999999990.00'), '.', ',')),
    v_obs);
  insert into public.pedidos_internos_aprovacoes (
    pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino)
  values (p_pedido_id, 'Cotação do solicitante', 'registrado', v_email, public.current_papel(), v_comentario,
          'aguardando_cotacao', 'aguardando_projeto');
  insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('pedido_interno', p_pedido_id, 'aguardando_cotacao', 'aguardando_projeto', v_email,
          'Cotação enviada ao coordenador do projeto: ' || v_comentario);

  return jsonb_build_object('pedido_id', p_pedido_id, 'status_origem', 'aguardando_cotacao',
                            'status_destino', 'aguardando_projeto', 'orcamentos', v_fornecedores);
end $function$;

comment on function public.enviar_cotacao_pedido(bigint, text) is
  '0189: quem pediu (ou quem conduz a compra inteira) envia a cotação (3 orçamentos de fornecedores diferentes, cada um com o documento) ao coordenador do projeto; sem escolha, vale o de menor valor.';

revoke all on function public.enviar_cotacao_pedido(bigint, text) from public, anon;
grant execute on function public.enviar_cotacao_pedido(bigint, text) to authenticated;

-- ---- 7. Reprovar também na cotação --------------------------------------------------------
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

  if v_p.fluxo = 2 and v_p.status in ('aguardando_area', 'aguardando_financeiro', 'aguardando_cotacao', 'aguardando_projeto') then
    -- 0188: a vez em que o pedido está (0189: na cotação, só quem conduz a compra inteira)
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

-- ---- 8. Gatilhos que dependem do status ----------------------------------------------------
-- 8a. Competência e as duas ordens sem mistura (0169/0184/0188)
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
  if new.fluxo = 1 and new.status in ('aguardando_area', 'aguardando_financeiro', 'aguardando_cotacao', 'aguardando_projeto') then
    raise exception 'Este pedido segue a ordem antiga de aprovações e termina nela.' using errcode = '22023';
  end if;
  if new.fluxo = 2 then
    -- as passagens da ordem nova são validadas pelas RPCs enviar_pedido_interno,
    -- decidir_aprovacao_pedido e enviar_cotacao_pedido (0189)
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

-- 8b. Produto controlado só pela Funpar (0174/0188)
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
     or new.status not in ('em_validacao', 'aguardando_area', 'aprovado_compra', 'aguardando_cotacao',
                           'aguardando_projeto', 'compra_fechada', 'encaminhado_instituicao') then
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
  -- 0189: a aprovação financeira leva à cotação; a fonte é conferida ali e de novo no projeto
  if new.status in ('aguardando_cotacao', 'aguardando_projeto') and coalesce(new.fonte_recurso, '') !~* 'funpar' then
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

-- 8c. Avisos de cada passagem (0173/0176/0188): 0189 avisa quem pediu da cotação
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

    -- 0189: aprovado pelo financeiro, a cotação é de quem pediu
    elsif v_novo = 'aguardando_cotacao' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Faça a cotação do seu pedido: 3 orçamentos',
        format('%s O laboratório ou campo e o financeiro (fonte: %s) aprovaram. Registre 3 orçamentos de fornecedores diferentes, com o documento de cada um, e envie a cotação ao coordenador do projeto.',
               v_pedido, coalesce(v_novo_reg ->> 'fonte_recurso', '—')),
        v_id, v_solicitante, null, v_chave);

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
        format('%s Laboratório ou campo e financeiro (fonte: %s) já aprovaram, e a cotação com os 3 orçamentos foi feita. Falta a sua, a última.%s', v_pedido,
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

-- "Aguardando você" (0173/0176/0185/0188): 0189 acrescenta a cotação de quem pediu
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

  -- 0189: a cotação é de quem pediu
  with minhas as (
    select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo, p.atualizado_em as desde
      from public.pedidos_internos p
     where p.status = 'aguardando_cotacao'
       and lower(btrim(coalesce(p.solicitante, ''))) = lower(coalesce(auth.jwt() ->> 'email', '-'))
  )
  select (select count(*) from minhas),
         coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                     from (select id, rotulo from minhas order by desde limit 3) s), '[]'::jsonb)
    into v_qtd, v_itens;
  if v_qtd > 0 then
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_cotacao', 'quantidade', v_qtd, 'itens', v_itens));
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
