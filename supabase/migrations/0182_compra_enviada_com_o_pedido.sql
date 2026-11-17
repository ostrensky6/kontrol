-- 0182 — Compra única: fechar o pedido com o fornecedor já marca a compra como enviada
-- (auditoria de 16/11/2026, item 10, proposta 2, aprovada por Antonio em 17/11/2026).
--
-- O pedido e a compra seguiam em duas telas. "Fechar com fornecedor" ficava no
-- pedido e "Marcar enviado" na compra: quem fazia só o primeiro deixava a compra
-- como aprovada, sem registro de envio e sem previsão de entrega. Agora, no mesmo
-- molde da 0170 (a compra é aprovada junto com o pedido), fechar o pedido com o
-- fornecedor marca a compra ligada como enviada, na mesma transação, com o evento
-- na linha do tempo.
--
-- Previsão de entrega: hoje (em Brasília) mais o prazo. O prazo é o do orçamento
-- escolhido no pedido, quando ele foi informado. Sem ele vale a mesma conta do
-- "Marcar enviado" da tela: o maior prazo entre os itens (prazo do insumo; sem
-- ele, o prazo médio do fornecedor do insumo) e, sem prazo nos itens, o prazo
-- médio do fornecedor da compra. Sem prazo nenhum, a previsão fica como estava e
-- "A caminho" segue estimando.
--
-- O desenho previa dois gatilhos. O primeiro (levar o fornecedor do orçamento
-- escolhido para a compra) já existe desde a 0171, dentro de
-- escolher_orcamento_pedido_interno, então aqui entra só o do envio.
--
-- Só acrescenta uma função e um gatilho. Não mexe em tabela, coluna, dado, RLS
-- nem em função existente, e não acerta compras antigas: a que já estava com o
-- pedido fechado e segue "aprovada" ganha o botão de envio dentro do pedido.
-- Na compra pela instituição (encaminhado_instituicao) nada muda no banco: o
-- envio ao fornecedor é outro momento e continua registrado pelo botão.
--
-- Rollback:
--   drop trigger pedidos_internos_enviar_compra_ligada on public.pedidos_internos;
--   drop function kontrol_private.enviar_compra_ligada();
--   As compras marcadas pelo gatilho ficam com o evento "Enviada ao fornecedor
--   junto com o fechamento do pedido interno" na linha do tempo; voltar a
--   "aprovado" exige decisão.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regprocedure('kontrol_private.aprovar_compra_ligada()') is null then
    raise exception '0182: requer a migration 0170';
  end if;
  if to_regclass('public.pedidos_internos_cotacoes') is null then
    raise exception '0182: requer a migration 0171';
  end if;
  if to_regprocedure('kontrol_private.hoje_brasilia()') is null then
    raise exception '0182: requer a migration 0176';
  end if;
end $$;

create or replace function kontrol_private.enviar_compra_ligada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ator text;
  v_compra record;
  v_prazo_orcamento integer;
  v_prazo integer;
  v_prevista date;
begin
  if new.status is not distinct from old.status or new.status <> 'compra_fechada' then
    return null;
  end if;
  begin
    v_ator := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_ator := null;
  end;
  v_ator := coalesce(v_ator, 'pedido interno #' || new.id);

  -- prazo combinado no orçamento escolhido (0171); zero conta como não informado
  select nullif(c.prazo_entrega_dias, 0)
    into v_prazo_orcamento
    from public.pedidos_internos_cotacoes c
   where c.pedido_interno_id = new.id and c.escolhida
   limit 1;

  for v_compra in
    select pc.id, pc.fornecedor_id, pc.data_prevista_entrega
      from public.pedidos_compra pc
     where pc.status = 'aprovado'
       and (pc.id = new.pedido_compra_id
            or exists (select 1
                         from public.pedidos_compra_itens ci
                         join public.pedidos_internos_itens pii on pii.id = ci.pedido_interno_item_id
                        where ci.pedido_id = pc.id and pii.pedido_interno_id = new.id))
       -- compra que atende mais de um pedido só segue quando todos já foram fechados
       and not exists (
         select 1 from public.pedidos_internos pi
          where pi.status <> 'cancelado'
            and pi.id <> new.id
            and pi.status not in ('compra_fechada', 'aguardando_pagamento_nf', 'compra_concluida')
            and (pi.pedido_compra_id = pc.id
                 or exists (select 1
                              from public.pedidos_compra_itens ci
                              join public.pedidos_internos_itens pii on pii.id = ci.pedido_interno_item_id
                             where ci.pedido_id = pc.id and pii.pedido_interno_id = pi.id)))
     for update of pc
  loop
    v_prazo := v_prazo_orcamento;
    if v_prazo is null then
      -- a conta do "Marcar enviado": maior prazo entre os itens
      select max(coalesce(nullif(i.lead_time_dias, 0), nullif(f.prazo_medio_dias, 0)))
        into v_prazo
        from public.pedidos_compra_itens ci
        join public.insumos i on i.id = ci.insumo_id
        left join public.fornecedores f on f.id = i.fornecedor_id
       where ci.pedido_id = v_compra.id;
    end if;
    if v_prazo is null and v_compra.fornecedor_id is not null then
      select nullif(f.prazo_medio_dias, 0) into v_prazo
        from public.fornecedores f
       where f.id = v_compra.fornecedor_id;
    end if;
    v_prevista := v_compra.data_prevista_entrega;
    if v_prazo is not null and v_prazo > 0 then
      v_prevista := kontrol_private.hoje_brasilia() + v_prazo;
    end if;

    perform set_config('app.pedido_compra_transicao', 'permitida', true);
    update public.pedidos_compra
       set status = 'enviado',
           data_prevista_entrega = v_prevista
     where id = v_compra.id;
    perform set_config('app.pedido_compra_transicao', '', true);
    insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
    values ('pedido_compra', v_compra.id, 'aprovado', 'enviado', v_ator,
            format('Enviada ao fornecedor junto com o fechamento do pedido interno #%s (caminho único: o envio é registrado no pedido).', new.id));
  end loop;
  return null;
end $function$;

revoke all on function kontrol_private.enviar_compra_ligada() from public, anon, authenticated;

comment on function kontrol_private.enviar_compra_ligada() is
  '0182: pedido interno fechado com o fornecedor (compra_fechada) marca a compra ligada como enviada e calcula a previsão de entrega.';

drop trigger if exists pedidos_internos_enviar_compra_ligada on public.pedidos_internos;
create trigger pedidos_internos_enviar_compra_ligada
  after update of status on public.pedidos_internos
  for each row execute function kontrol_private.enviar_compra_ligada();

commit;
