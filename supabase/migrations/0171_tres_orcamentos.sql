-- 0171 — três orçamentos em toda compra.
--
-- Etapa 5 do plano de adaptação do fluxo de compras (decisão D2 de Antonio em
-- 09/11/2026: "tudo tem 3 orçamentos", inclusive Petrobras e FUNPAR).
--
-- Até aqui as cotações eram só anexos soltos e bastava um para seguir. Agora:
--   * cada orçamento é registrado no pedido (pedidos_internos_cotacoes) com
--     fornecedor, valor, prazo, validade e o documento anexado;
--   * o pedido só passa de "Cotações solicitadas" para "Cotações recebidas"
--     com 3 orçamentos de fornecedores diferentes;
--   * só vai para a aprovação final com um orçamento escolhido; escolher um
--     que não seja o mais barato exige justificativa por escrito;
--   * a escolha fica registrada (quem, quando, justificativa) nas aprovações
--     do pedido e, quando o fornecedor é cadastrado, passa para a compra
--     formal ligada ainda não enviada (um caminho só).
--
-- As regras valem no banco (gatilho na troca de status), venham da tela, da API
-- ou de outra RPC. Operações do dono do banco (migrations) seguem livres.
--
-- Não destrutiva: cria uma tabela, funções e gatilhos. Nada é apagado; RLS e
-- auditoria (fn_auditoria) na tabela nova.
--
-- Rollback:
--   drop trigger pedidos_internos_exigir_orcamentos on public.pedidos_internos;
--   drop function kontrol_private.exigir_tres_orcamentos();
--   drop function public.escolher_orcamento_pedido_interno(bigint, text);
--   drop function public.resumo_orcamentos_pedido_interno(bigint);
--   drop function kontrol_private.resumo_orcamentos(bigint);
--   drop trigger pedidos_internos_cotacoes_proteger on public.pedidos_internos_cotacoes;
--   drop function kontrol_private.proteger_cotacao();
--   (só depois de exportar, se houver dados) drop table public.pedidos_internos_cotacoes.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $$
begin
  if to_regprocedure('kontrol_private.pendencia_pagamento(bigint)') is null then
    raise exception '0171: requer a migration 0170';
  end if;
end $$;

-- ---- 1. Orçamentos do pedido ---------------------------------------------------------
create table if not exists public.pedidos_internos_cotacoes (
  id bigint generated always as identity primary key,
  pedido_interno_id bigint not null references public.pedidos_internos(id) on delete cascade,
  fornecedor_id bigint references public.fornecedores(id) on delete set null,
  fornecedor_nome text not null,
  valor_total numeric(14, 2) not null,
  prazo_entrega_dias integer,
  validade date,
  condicoes text,
  anexo_id bigint references public.pedidos_internos_anexos(id) on delete set null,
  escolhida boolean not null default false,
  escolhida_por text,
  escolhida_em timestamptz,
  justificativa_escolha text,
  registrada_por text,
  registrada_em timestamptz not null default now(),
  constraint pedidos_internos_cotacoes_fornecedor_check check (char_length(btrim(fornecedor_nome)) between 1 and 200),
  constraint pedidos_internos_cotacoes_valor_check check (valor_total > 0),
  constraint pedidos_internos_cotacoes_prazo_check check (prazo_entrega_dias is null or prazo_entrega_dias between 0 and 3650),
  constraint pedidos_internos_cotacoes_textos_check check (
    coalesce(char_length(condicoes), 0) <= 1000 and coalesce(char_length(justificativa_escolha), 0) <= 1000)
);

create index if not exists pedidos_internos_cotacoes_pedido_idx
  on public.pedidos_internos_cotacoes (pedido_interno_id);
-- um orçamento por fornecedor em cada pedido (3 orçamentos = 3 fornecedores)
create unique index if not exists pedidos_internos_cotacoes_fornecedor_unico
  on public.pedidos_internos_cotacoes (pedido_interno_id, lower(btrim(fornecedor_nome)));
-- no máximo um escolhido por pedido
create unique index if not exists pedidos_internos_cotacoes_escolhida_unica
  on public.pedidos_internos_cotacoes (pedido_interno_id) where escolhida;

comment on table public.pedidos_internos_cotacoes is
  '0171 (D2): orçamentos do pedido interno. Toda compra precisa de 3 de fornecedores diferentes e de um escolhido antes da aprovação final.';

alter table public.pedidos_internos_cotacoes enable row level security;

drop policy if exists pedidos_internos_cotacoes_ler on public.pedidos_internos_cotacoes;
create policy pedidos_internos_cotacoes_ler on public.pedidos_internos_cotacoes
  for select to authenticated
  using (exists (select 1 from public.pedidos_internos pi where pi.id = pedido_interno_id));

-- quem conduz as etapas de compra registra os orçamentos
drop policy if exists pedidos_internos_cotacoes_incluir on public.pedidos_internos_cotacoes;
create policy pedidos_internos_cotacoes_incluir on public.pedidos_internos_cotacoes
  for insert to authenticated
  with check (kontrol_private.tem_permissao_efetiva('pedido.aprovar'));
drop policy if exists pedidos_internos_cotacoes_alterar on public.pedidos_internos_cotacoes;
create policy pedidos_internos_cotacoes_alterar on public.pedidos_internos_cotacoes
  for update to authenticated
  using (kontrol_private.tem_permissao_efetiva('pedido.aprovar'))
  with check (kontrol_private.tem_permissao_efetiva('pedido.aprovar'));
drop policy if exists pedidos_internos_cotacoes_excluir on public.pedidos_internos_cotacoes;
create policy pedidos_internos_cotacoes_excluir on public.pedidos_internos_cotacoes
  for delete to authenticated
  using (kontrol_private.tem_permissao_efetiva('pedido.aprovar'));

grant select, insert, update, delete on public.pedidos_internos_cotacoes to authenticated;

drop trigger if exists aud_pedidos_internos_cotacoes on public.pedidos_internos_cotacoes;
create trigger aud_pedidos_internos_cotacoes
  after insert or update or delete on public.pedidos_internos_cotacoes
  for each row execute function public.fn_auditoria('id');

-- Orçamento só entra, muda ou sai enquanto as cotações estão abertas; a escolha
-- só pelo botão (RPC). Quem registra e quando vêm do banco.
create or replace function kontrol_private.proteger_cotacao()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_pedido_id bigint;
  v_status text;
  v_mexeu_escolha boolean := false;
begin
  if tg_op = 'DELETE' then
    v_pedido_id := old.pedido_interno_id;
  else
    v_pedido_id := new.pedido_interno_id;
  end if;
  select pi.status into v_status from public.pedidos_internos pi where pi.id = v_pedido_id;

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
    if coalesce(v_status, '') not in ('orcamentos', 'orcamentos_recebidos') then
      raise exception 'Orçamentos só entram ou mudam com o pedido em "Cotações solicitadas" ou "Cotações recebidas".'
        using errcode = '22023';
    end if;
    if tg_op = 'DELETE' then
      if old.escolhida then
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

revoke all on function kontrol_private.proteger_cotacao() from public, anon;

drop trigger if exists pedidos_internos_cotacoes_proteger on public.pedidos_internos_cotacoes;
create trigger pedidos_internos_cotacoes_proteger
  before insert or update or delete on public.pedidos_internos_cotacoes
  for each row execute function kontrol_private.proteger_cotacao();

-- ---- 2. Resumo: quantos orçamentos, qual o menor, qual o escolhido ---------------------
create or replace function kontrol_private.resumo_orcamentos(p_pedido_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'exigidos', 3,
    'registrados', count(*),
    'fornecedores', count(distinct lower(btrim(c.fornecedor_nome))),
    'menor_valor', min(c.valor_total),
    'escolhida_id', max(c.id) filter (where c.escolhida),
    'escolhida_valor', max(c.valor_total) filter (where c.escolhida),
    'escolhida_fornecedor', max(c.fornecedor_nome) filter (where c.escolhida),
    'justificativa', max(c.justificativa_escolha) filter (where c.escolhida)
  )
  from public.pedidos_internos_cotacoes c
  where c.pedido_interno_id = p_pedido_id
$function$;

revoke all on function kontrol_private.resumo_orcamentos(bigint) from public, anon;
grant execute on function kontrol_private.resumo_orcamentos(bigint) to authenticated, service_role;

-- leitura para a tela: só de pedido que o usuário enxerga (RLS)
create or replace function public.resumo_orcamentos_pedido_interno(p_pedido_id bigint)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
begin
  if not exists (select 1 from public.pedidos_internos pi where pi.id = p_pedido_id) then
    return null;
  end if;
  return kontrol_private.resumo_orcamentos(p_pedido_id);
end $function$;

revoke all on function public.resumo_orcamentos_pedido_interno(bigint) from public, anon;
grant execute on function public.resumo_orcamentos_pedido_interno(bigint) to authenticated, service_role;

-- ---- 3. Trava das etapas -------------------------------------------------------------
create or replace function kontrol_private.exigir_tres_orcamentos()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_resumo jsonb;
  v_fornecedores integer;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status = 'orcamentos' and new.status = 'orcamentos_recebidos' then
    v_resumo := kontrol_private.resumo_orcamentos(new.id);
    v_fornecedores := coalesce((v_resumo ->> 'fornecedores')::integer, 0);
    if v_fornecedores < 3 then
      raise exception 'Toda compra precisa de 3 orçamentos de fornecedores diferentes. Este pedido tem %. Registre os orçamentos no pedido.',
        v_fornecedores using errcode = '22023';
    end if;
  end if;

  if old.status = 'orcamentos_recebidos' and new.status = 'aguardando_aprovacao_final' then
    v_resumo := kontrol_private.resumo_orcamentos(new.id);
    if coalesce((v_resumo ->> 'fornecedores')::integer, 0) < 3 then
      raise exception 'Toda compra precisa de 3 orçamentos de fornecedores diferentes antes da aprovação final.'
        using errcode = '22023';
    end if;
    if v_resumo ->> 'escolhida_id' is null then
      raise exception 'Escolha um dos orçamentos antes de enviar para a aprovação final.' using errcode = '22023';
    end if;
  end if;

  return new;
end $function$;

revoke all on function kontrol_private.exigir_tres_orcamentos() from public, anon;

drop trigger if exists pedidos_internos_exigir_orcamentos on public.pedidos_internos;
create trigger pedidos_internos_exigir_orcamentos
  before update of status on public.pedidos_internos
  for each row execute function kontrol_private.exigir_tres_orcamentos();

-- ---- 4. Escolha do orçamento -----------------------------------------------------------
create or replace function public.escolher_orcamento_pedido_interno(
  p_cotacao_id bigint,
  p_justificativa text default null
)
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
  if v_pedido.status <> 'orcamentos_recebidos' then
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

revoke all on function public.escolher_orcamento_pedido_interno(bigint, text) from public, anon;
grant execute on function public.escolher_orcamento_pedido_interno(bigint, text) to authenticated, service_role;

commit;
