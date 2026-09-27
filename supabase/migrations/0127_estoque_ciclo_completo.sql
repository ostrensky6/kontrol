-- Ciclo físico do insumo (auditoria de 2026-09-26, onda 2; decisões do dono
-- registradas em docs/auditoria-processos-2026-09-26.md §9 e nos achados da
-- frente de estoque). Depende da 0125 (gatilho de unidade corrigido).
--
-- O que muda e por quê:
--
--  1. EST2-9/EST-1: item de compra deixa de ser editável/excluível depois do
--     recebimento ou fora de "solicitado" (gatilho); o livro de recebimentos
--     (compra e pedido interno) não é mais apagado em cascata: as FKs passam
--     de ON DELETE CASCADE para RESTRICT (nenhum dado é removido); itens de
--     compra ganham o gatilho de auditoria. Compra em andamento não pode ser
--     excluída direto (use Cancelar).
--  2. PER2-6: quem só tem "compras.solicitar" altera a compra apenas enquanto
--     ela está "solicitado" (política de UPDATE).
--  3. EST2-3/EST-5: "+ Entrada" (entrada_inventario) respeita o modelo do
--     insumo (frascos inteiros para insumo contado em frascos), é idempotente
--     por operacao_id e aceita local. Baixa manual por volume também passa a
--     ter operacao_id. "Comprar faltas" do planejamento vira RPC transacional
--     (criar_pedido_faltas_planejamento) que desconta o que já foi pedido.
--  4. EST2-7 (decisão do dono): compra encerrada com pendência conclui o
--     recebimento do pedido interno de origem com a pendência registrada nos
--     itens. Item 13/PER2-12: pedido interno devolvido depois de formalizado
--     retoma a compra formal existente em vez de falhar.
--  5. Recebimento (decisão do dono): o técnico registra a chegada de compra
--     formal (padrão da categoria "tecnico" ganha compras.receber; exceções
--     individuais não são tocadas); quem registrou a chegada não aceita o
--     próprio lote (admin isento; lotes_estoque.recebido_por_id); lote vencido
--     não é aceito. EST2-6/CAD2-8: volume do frasco e local informados na
--     chegada vão só para o lote e o livro, sem alterar o item da compra.
--  6. EST2-4/EST-6/EST-8: reservado conta só lotes utilizáveis; rotina diária
--     (pg_cron) libera reservas de lotes vencidos e marca o plano como reserva
--     desatualizada; baixa por vencimento libera a reserva do lote vencido;
--     alertas trazem o lote (e o lote em quarentena vencido também alerta);
--     baixa manual respeita a validade após abertura.
--  7. EST-2: estorno de recebimento de compra formal, bilateral e com motivo
--     (estornar_recebimento_do_lote, "estoque.lote.gerir"). PER2-7:
--     aplicar_ajuste_inventario_contagem exige "estoque.lote.gerir".
--  8. EST2-5/EST2-8: saldo expõe a unidade ("frasco(s) de 100 mL"); a
--     previsão de compras normaliza saídas de lotes antigos por volume.
--  9. Pedido interno: dados de cada etapa (datas, aprovador, análise
--     administrativa, modalidade) gravados dentro de RPC
--     (registrar_etapa_pedido_interno), sem UPDATE direto do app.
-- 10. EST-4: a retirada do plano (dar_baixa_plano) sai do lote conferido na
--     bancada quando ele pode cobrir a reserva; senão, do lote reservado.
--
-- Não remove tabelas, colunas, dados, RLS nem gatilhos de auditoria.
-- Funções recriadas por inteiro a partir do pg_get_functiondef vigente (0125).
-- Assinaturas: receber_item_pedido_compra(bigint,bigint,uuid,numeric,date,
-- text,text) é substituída pela versão com p_conteudo_embalagem e p_local_id
-- (mesmos nomes, dois parâmetros opcionais no fim); entrada_inventario e
-- baixa_manual_lote ganham versão com operacao_id e as antigas viram
-- invólucros da nova.
--
-- Rollback: reaplicar as definições anteriores (pg_get_functiondef guardado no
-- backup lógico prévio) de: receber_item_pedido_compra (5, 6 e 7 args),
-- bloquear_status_direto_pedido_compra, transicionar_pedido_compra,
-- formalizar_pedido_interno, entrada_inventario, baixa_manual_lote,
-- baixa_manual_embalagens, aceitar_lote, aplicar_ajuste_inventario_contagem,
-- dar_baixa_plano e
-- das views v_estoque_saldo, v_estoque_disponivel_unidade, v_alertas_estoque,
-- v_planejamento_compromissos_estoque e v_previsao_suprimentos; dropar as
-- funções novas, o gatilho kontrol_item_compra_protecao,
-- kontrol_compra_exclusao e aud_pedidos_compra_itens, o job
-- kontrol-reservas-vencidas-diaria; recriar as FKs do livro com ON DELETE
-- CASCADE; restaurar a política perm_update_pedidos_compra da 0124; voltar
-- permissoes_categorias(tecnico).compras.receber para false. As colunas novas
-- (recebido_por_id, conteudo_embalagem e local_id do livro) podem ficar.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $$
begin
  if to_regprocedure('kontrol_private.exigir_permissao(text)') is null
    or to_regprocedure('kontrol_private.lote_do_recebimento(bigint,numeric,text,numeric,numeric)') is null
    or position('new.pedido_interno_item_id' in pg_get_functiondef('kontrol_private.preencher_unidade_item()'::regprocedure)) > 0 then
    raise exception '0127: requer as migrations 0123, 0124 e 0125';
  end if;
end $$;

-- =============================================================================
-- 1. Livro de recebimentos preservado e itens de compra travados
-- =============================================================================

alter table public.pedidos_compra_item_recebimentos
  drop constraint if exists pedidos_compra_item_recebimentos_pedido_compra_id_fkey,
  add constraint pedidos_compra_item_recebimentos_pedido_compra_id_fkey
    foreign key (pedido_compra_id) references public.pedidos_compra(id) on delete restrict,
  drop constraint if exists pedidos_compra_item_recebimentos_pedido_compra_item_id_fkey,
  add constraint pedidos_compra_item_recebimentos_pedido_compra_item_id_fkey
    foreign key (pedido_compra_item_id) references public.pedidos_compra_itens(id) on delete restrict;

alter table public.pedidos_internos_item_recebimentos
  drop constraint if exists pedidos_internos_item_recebimentos_pedido_interno_id_fkey,
  add constraint pedidos_internos_item_recebimentos_pedido_interno_id_fkey
    foreign key (pedido_interno_id) references public.pedidos_internos(id) on delete restrict,
  drop constraint if exists pedidos_internos_item_recebimentos_pedido_interno_item_id_fkey,
  add constraint pedidos_internos_item_recebimentos_pedido_interno_item_id_fkey
    foreign key (pedido_interno_item_id) references public.pedidos_internos_itens(id) on delete restrict;

-- Gatilho SEM security definer: current_user diz se a escrita veio direto da
-- API (authenticated) ou de uma RPC/ação referencial (dono das tabelas).
create or replace function kontrol_private.proteger_item_compra()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_direto boolean := current_user in ('authenticated', 'anon', 'service_role');
  v_status text;
  v_recebido boolean;
begin
  if tg_op = 'INSERT' then
    if v_direto then
      select status into v_status from public.pedidos_compra where id = new.pedido_id;
      if v_status is distinct from 'solicitado' then
        raise exception 'Itens só podem ser incluídos enquanto a compra está como solicitada.'
          using errcode = '22023';
      end if;
      if new.lote_id is not null or new.quantidade_recebida is not null or new.divergencia_recebimento is not null then
        raise exception 'Os dados de recebimento só são gravados pelo registro de chegada.'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  select status into v_status from public.pedidos_compra where id = old.pedido_id;
  v_recebido := old.lote_id is not null
    or coalesce(old.quantidade_recebida, 0) > 0
    or exists (select 1 from public.pedidos_compra_item_recebimentos r where r.pedido_compra_item_id = old.id)
    or exists (select 1 from public.pedidos_internos_item_recebimentos r where r.pedido_compra_item_id = old.id);

  if tg_op = 'DELETE' then
    if v_recebido then
      raise exception 'Este item já teve recebimento registrado e não pode ser excluído. Estorne o recebimento ou encerre a compra com pendência.'
        using errcode = '22023';
    end if;
    -- v_status nulo: a própria compra está sendo excluída (cascata).
    if v_direto and v_status is not null and v_status <> 'solicitado' then
      raise exception 'Itens só podem ser excluídos enquanto a compra está como solicitada. Depois disso, cancele a compra ou encerre com pendência.'
        using errcode = '22023';
    end if;
    return old;
  end if;

  -- UPDATE
  if (new.pedido_id, new.insumo_id, new.quantidade, new.quantidade_em, new.conteudo_embalagem,
      new.custo_unitario_estimado, new.pedido_interno_item_id)
     is distinct from
     (old.pedido_id, old.insumo_id, old.quantidade, old.quantidade_em, old.conteudo_embalagem,
      old.custo_unitario_estimado, old.pedido_interno_item_id) then
    if v_recebido and (new.pedido_id, new.insumo_id, new.quantidade, new.quantidade_em, new.conteudo_embalagem)
       is distinct from (old.pedido_id, old.insumo_id, old.quantidade, old.quantidade_em, old.conteudo_embalagem) then
      raise exception 'Este item já teve recebimento registrado: insumo, quantidade e unidade não podem mudar.'
        using errcode = '22023';
    end if;
    if v_direto and v_status is distinct from 'solicitado' then
      raise exception 'Itens só podem ser alterados enquanto a compra está como solicitada.'
        using errcode = '22023';
    end if;
  end if;
  if v_direto and (new.lote_id, new.quantidade_recebida, new.divergencia_recebimento)
     is distinct from (old.lote_id, old.quantidade_recebida, old.divergencia_recebimento) then
    raise exception 'Os dados de recebimento só mudam pelo registro de chegada ou pelo estorno.'
      using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function kontrol_private.proteger_item_compra() from public, anon, service_role;
grant execute on function kontrol_private.proteger_item_compra() to authenticated;

drop trigger if exists kontrol_item_compra_protecao on public.pedidos_compra_itens;
create trigger kontrol_item_compra_protecao
  before insert or update or delete on public.pedidos_compra_itens
  for each row execute function kontrol_private.proteger_item_compra();

drop trigger if exists aud_pedidos_compra_itens on public.pedidos_compra_itens;
create trigger aud_pedidos_compra_itens
  after insert or update or delete on public.pedidos_compra_itens
  for each row execute function public.fn_auditoria();

create or replace function kontrol_private.proteger_exclusao_compra()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon', 'service_role')
     and old.status not in ('solicitado', 'cancelado') then
    raise exception 'Compra em andamento não pode ser excluída. Cancele a compra ou encerre com pendência.'
      using errcode = '22023';
  end if;
  return old;
end $$;

revoke all on function kontrol_private.proteger_exclusao_compra() from public, anon, service_role;
grant execute on function kontrol_private.proteger_exclusao_compra() to authenticated;

drop trigger if exists kontrol_compra_exclusao on public.pedidos_compra;
create trigger kontrol_compra_exclusao
  before delete on public.pedidos_compra
  for each row execute function kontrol_private.proteger_exclusao_compra();

-- =============================================================================
-- 2. PER2-6: "compras.solicitar" altera a compra só enquanto solicitada
-- =============================================================================

drop policy if exists perm_update_pedidos_compra on public.pedidos_compra;
create policy perm_update_pedidos_compra on public.pedidos_compra
  for update to authenticated
  using (
    kontrol_private.tem_permissao_efetiva('compras.aprovar')
    or (status = 'solicitado' and kontrol_private.tem_permissao_efetiva('compras.solicitar'))
  )
  with check (
    kontrol_private.tem_permissao_efetiva('compras.aprovar')
    or (status = 'solicitado' and kontrol_private.tem_permissao_efetiva('compras.solicitar'))
  );

-- =============================================================================
-- 3. Recebimento: técnico registra a chegada; quem recebeu não aceita
-- =============================================================================

-- Padrão da categoria (não mexe em exceções individuais de perfis.permissoes).
update public.permissoes_categorias
   set permissoes = permissoes || '{"compras.receber": true}'::jsonb,
       atualizado_em = now()
 where papel = 'tecnico'
   and (permissoes -> 'compras.receber') is distinct from 'true'::jsonb;

alter table public.lotes_estoque
  add column if not exists recebido_por_id uuid default auth.uid();
comment on column public.lotes_estoque.recebido_por_id is
  'Usuário que registrou a chegada (preenchido pela sessão). Quem recebeu não aceita o próprio lote (0127).';

alter table public.pedidos_compra_item_recebimentos
  add column if not exists conteudo_embalagem numeric,
  add column if not exists local_id bigint references public.locais(id) on delete set null;
alter table public.pedidos_compra_item_recebimentos
  drop constraint if exists pedidos_compra_item_recebimentos_conteudo_check,
  add constraint pedidos_compra_item_recebimentos_conteudo_check
    check (conteudo_embalagem is null or conteudo_embalagem > 0);
comment on column public.pedidos_compra_item_recebimentos.conteudo_embalagem is
  'Volume de cada frasco nesta entrega (informado na chegada ou do item). 0127.';

create or replace function public.aceitar_lote(p_lote_id bigint, p_responsavel text DEFAULT NULL::text, p_criterio text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := current_setting('request.jwt.claims', true)::jsonb->>'email';
  v_responsavel text := nullif(btrim(coalesce(p_responsavel, v_email)), '');
  v_criterio text := nullif(btrim(p_criterio), '');
  v_lote record;
begin
  perform kontrol_private.exigir_permissao('estoque.lote.aceitar');

  select
    l.id,
    l.status,
    l.validade,
    l.recebido_por_id,
    i.categoria_compra
  into v_lote
  from lotes_estoque l
  join insumos i on i.id = l.insumo_id
  where l.id = p_lote_id
  for update of l;

  if not found then
    raise exception 'Lote nao encontrado.' using errcode = 'P0002';
  end if;
  if v_lote.status <> 'quarentena' then
    raise exception 'Somente lotes em quarentena podem ser aceitos.' using errcode = '22023';
  end if;
  if v_lote.validade is not null and v_lote.validade < current_date then
    raise exception 'Lote vencido não pode ser aceito. Estorne o recebimento ou descarte o lote.'
      using errcode = '22023';
  end if;
  -- Dupla conferência: quem registrou a chegada não libera o próprio lote.
  if v_lote.recebido_por_id is not null
     and v_lote.recebido_por_id = auth.uid()
     and not exists (
       select 1 from perfis p where p.id = auth.uid() and p.papel = 'admin' and not p.suspenso
     ) then
    raise exception 'Quem registrou a chegada deste lote não pode aceitá-lo. Peça a outra pessoa com a permissão de aceitar lotes.'
      using errcode = '42501';
  end if;
  if v_lote.categoria_compra = 'critico' and (v_responsavel is null or v_criterio is null) then
    raise exception 'Lote critico exige responsavel e criterio de aceitacao.' using errcode = '22023';
  end if;

  update lotes_estoque
     set status = 'aceito',
         responsavel_liberacao = v_responsavel,
         criterio_aceitacao = v_criterio
   where id = p_lote_id;
end $function$;

-- ---- Recebimento de compra formal: núcleo privado com volume e local -------
create or replace function kontrol_private.receber_item_compra_formal(
  p_pedido_id bigint,
  p_item_id bigint,
  p_quantidade numeric,
  p_validade date,
  p_codigo text,
  p_responsavel text,
  p_conteudo_embalagem numeric,
  p_local_id bigint
)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item record;
  v_quantidade numeric;
  v_total_recebido numeric;
  v_lote jsonb;
  v_lote_id bigint;
  v_pedido_interno_id bigint;
  v_tudo_recebido boolean;
  v_compra_concluida boolean;
  v_conteudo numeric;
begin
  perform kontrol_private.exigir_permissao('compras.receber');
  if p_conteudo_embalagem is not null and p_conteudo_embalagem <= 0 then
    raise exception 'O volume do frasco deve ser maior que zero.' using errcode = '22023';
  end if;
  if p_local_id is not null and not exists (select 1 from locais where id = p_local_id) then
    raise exception 'Local de armazenamento não encontrado.' using errcode = '22023';
  end if;
  select
    pi.id, pi.pedido_id, pi.insumo_id, pi.quantidade,
    coalesce(pi.quantidade_recebida, case when pi.lote_id is not null then pi.quantidade else 0 end) as quantidade_recebida,
    pi.custo_unitario_estimado, pi.pedido_interno_item_id, pi.quantidade_em, pi.conteudo_embalagem,
    p.status as pedido_status, p.projeto, f.nome as fornecedor, i.categoria_compra
  into v_item
  from pedidos_compra_itens pi
  join pedidos_compra p on p.id = pi.pedido_id
  join insumos i on i.id = pi.insumo_id
  left join fornecedores f on f.id = p.fornecedor_id
  where pi.id = p_item_id and pi.pedido_id = p_pedido_id
  for update of pi, p;
  if not found then
    raise exception 'Item do pedido de compra nao encontrado.' using errcode = 'P0002';
  end if;
  if v_item.quantidade_recebida >= v_item.quantidade then
    raise exception 'Item ja foi recebido integralmente.' using errcode = '22023';
  end if;
  if v_item.pedido_status not in ('aprovado','enviado','em_transito') then
    raise exception 'Status do pedido nao permite recebimento.' using errcode = '22023';
  end if;
  v_quantidade := coalesce(p_quantidade, v_item.quantidade - v_item.quantidade_recebida);
  if v_quantidade <= 0 then
    raise exception 'Quantidade recebida deve ser maior que zero.' using errcode = '22023';
  end if;
  v_total_recebido := v_item.quantidade_recebida + v_quantidade;
  if v_total_recebido > v_item.quantidade then
    raise exception 'Quantidade recebida excede o saldo pendente do item.' using errcode = '22023';
  end if;
  if v_item.categoria_compra = 'critico' and p_validade is null then
    raise exception 'Validade e obrigatoria para receber insumo critico.' using errcode = '22023';
  end if;

  -- Volume diferente na chegada vale só para esta entrega (lote e livro); o
  -- item da compra continua com o volume pedido. O custo segue por frasco.
  v_conteudo := coalesce(p_conteudo_embalagem, v_item.conteudo_embalagem);
  v_lote := kontrol_private.lote_do_recebimento(
    v_item.insumo_id, v_quantidade, v_item.quantidade_em, v_conteudo,
    v_item.custo_unitario_estimado
  );
  v_lote_id := kontrol_private.criar_lote_recebido(
    v_item.insumo_id, v_lote, p_codigo, p_validade, v_item.fornecedor, v_item.projeto, p_responsavel
  );
  if p_local_id is not null then
    update lotes_estoque set local_id = p_local_id where id = v_lote_id;
  end if;
  insert into estoque_movimentacoes(insumo_id, tipo, quantidade, custo_unitario, motivo, referencia, lote_id)
  values (
    v_item.insumo_id, 'entrada', (v_lote->>'quantidade')::numeric, (v_lote->>'custo_unitario')::numeric,
    'compra/recebimento', 'pedido_compra ' || p_pedido_id || '; item ' || p_item_id, v_lote_id
  );
  insert into pedidos_compra_item_recebimentos(
    pedido_compra_id, pedido_compra_item_id, pedido_interno_item_id, lote_id, insumo_id,
    quantidade, custo_unitario, codigo_lote, fornecedor, validade, responsavel,
    conteudo_embalagem, local_id
  ) values (
    p_pedido_id, p_item_id, v_item.pedido_interno_item_id, v_lote_id, v_item.insumo_id,
    v_quantidade, v_item.custo_unitario_estimado, nullif(btrim(p_codigo), ''),
    v_item.fornecedor, p_validade, p_responsavel,
    v_conteudo, p_local_id
  );
  update pedidos_compra_itens
     set lote_id = case when v_total_recebido >= v_item.quantidade then v_lote_id else lote_id end,
         quantidade_recebida = v_total_recebido,
         divergencia_recebimento = case
           when v_total_recebido <> v_item.quantidade
             then 'Pedido: ' || v_item.quantidade || '; recebido acumulado: ' || v_total_recebido
           else null
         end
   where id = p_item_id and pedido_id = p_pedido_id;
  if v_item.pedido_interno_item_id is not null then
    update pedidos_internos_itens
       set insumo_id = v_item.insumo_id,
           lote_id = v_lote_id,
           quantidade_recebida = v_total_recebido,
           divergencia_recebimento = case
             when v_total_recebido <> quantidade
               then 'Pedido: ' || quantidade || '; recebido acumulado: ' || v_total_recebido
             else null
           end,
           recebido_em = case when v_total_recebido >= quantidade then now() else null end,
           recebido_por = case when v_total_recebido >= quantidade then p_responsavel else null end
     where id = v_item.pedido_interno_item_id
     returning pedido_interno_id into v_pedido_interno_id;
    insert into pedidos_internos_item_recebimentos(
      pedido_interno_id, pedido_interno_item_id, pedido_compra_item_id, lote_id, insumo_id,
      quantidade, custo_unitario, codigo_lote, fornecedor, validade, responsavel, observacao
    ) values (
      v_pedido_interno_id, v_item.pedido_interno_item_id, p_item_id, v_lote_id, v_item.insumo_id,
      v_quantidade, v_item.custo_unitario_estimado, nullif(btrim(p_codigo), ''), v_item.fornecedor,
      p_validade, p_responsavel, 'Recebimento pela compra formal #' || p_pedido_id
    );
    select not exists (
      select 1 from pedidos_internos_itens
      where pedido_interno_id = v_pedido_interno_id
        and tipo = 'material' and recebido_em is null
    ) into v_tudo_recebido;
    update pedidos_internos
       set recebido_em = case when v_tudo_recebido then coalesce(recebido_em, now()) else null end,
           recebido_por = case when v_tudo_recebido then p_responsavel else null end
     where id = v_pedido_interno_id;
  end if;
  select not exists (
    select 1 from pedidos_compra_itens
    where pedido_id = p_pedido_id
      and coalesce(quantidade_recebida, case when lote_id is not null then quantidade else 0 end) < quantidade
  ) into v_compra_concluida;
  if v_compra_concluida then
    update pedidos_compra set status = 'recebido' where id = p_pedido_id;
  end if;
  insert into eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
  values (
    'pedido_compra', p_pedido_id, v_item.pedido_status,
    case when v_compra_concluida then 'recebido' else v_item.pedido_status end,
    p_responsavel,
    'Recebimento ' || case when v_compra_concluida then 'concluído' else 'parcial' end ||
      ': item #' || p_item_id || ', quantidade ' || v_quantidade ||
      case when v_item.quantidade_em = 'embalagem' then ' frasco(s)' else '' end ||
      case when p_conteudo_embalagem is not null and p_conteudo_embalagem is distinct from v_item.conteudo_embalagem
        then ' de ' || to_char(p_conteudo_embalagem, 'FM999999990.######') || ' (volume informado na chegada)'
        else '' end ||
      ', acumulado ' || v_total_recebido || ' de ' || v_item.quantidade || '.'
  );
  return v_lote_id;
end $function$;

revoke all on function kontrol_private.receber_item_compra_formal(bigint, bigint, numeric, date, text, text, numeric, bigint)
  from public, anon, authenticated, service_role;

-- Rota privada antiga (6 args, só o dono executa): delega ao núcleo.
create or replace function public.receber_item_pedido_compra(p_pedido_id bigint, p_item_id bigint, p_quantidade numeric DEFAULT NULL::numeric, p_validade date DEFAULT NULL::date, p_codigo text DEFAULT NULL::text, p_responsavel text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return kontrol_private.receber_item_compra_formal(
    p_pedido_id, p_item_id, p_quantidade, p_validade, p_codigo, p_responsavel, null, null
  );
end $function$;

-- Rota pública (idempotente por operacao_id), agora com volume e local.
create or replace function public.receber_item_pedido_compra(
  p_pedido_id bigint,
  p_item_id bigint,
  p_operacao_id uuid,
  p_quantidade numeric DEFAULT NULL::numeric,
  p_validade date DEFAULT NULL::date,
  p_codigo text DEFAULT NULL::text,
  p_responsavel text DEFAULT NULL::text,
  p_conteudo_embalagem numeric DEFAULT NULL::numeric,
  p_local_id bigint DEFAULT NULL::bigint
)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_existente record;
  v_lote_id bigint;
  v_claims jsonb;
  v_ator text;
begin
  perform kontrol_private.exigir_permissao('compras.receber');

  if p_operacao_id is null then
    raise exception 'operacao_id e obrigatorio para receber o item.' using errcode = '22023';
  end if;

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), nullif(v_claims->>'sub', ''));
  if v_ator is null then
    raise exception 'Contexto JWT do ator e obrigatorio para receber o item.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operacao_id::text, 0));

  select r.*
    into v_existente
  from public.pedidos_compra_item_recebimentos r
  where r.operacao_id = p_operacao_id
  for update;

  if found then
    if v_existente.pedido_compra_id = p_pedido_id
       and v_existente.pedido_compra_item_id = p_item_id
       and (p_quantidade is null or v_existente.quantidade = p_quantidade)
       and v_existente.codigo_lote is not distinct from nullif(btrim(p_codigo), '')
       and v_existente.validade is not distinct from p_validade
       and (p_conteudo_embalagem is null or v_existente.conteudo_embalagem = p_conteudo_embalagem)
       and v_existente.local_id is not distinct from p_local_id then
      return v_existente.lote_id;
    end if;
    raise exception 'operacao_id ja utilizado com payload diferente.' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.pedidos_internos_item_recebimentos
    where operacao_id = p_operacao_id
  ) then
    raise exception 'operacao_id ja utilizado em outro recebimento.' using errcode = '23505';
  end if;

  -- insert into lotes_estoque ocorre no nucleo privado somente depois
  -- da verificacao idempotente acima.
  perform set_config('app.pedido_compra_transicao', 'permitida', true);
  v_lote_id := kontrol_private.receber_item_compra_formal(
    p_pedido_id, p_item_id, p_quantidade, p_validade, p_codigo, v_ator,
    p_conteudo_embalagem, p_local_id
  );

  update public.pedidos_compra_item_recebimentos
     set operacao_id = p_operacao_id,
         responsavel = v_ator
   where lote_id = v_lote_id
     and pedido_compra_item_id = p_item_id
     and operacao_id is null;

  if not found then
    raise exception 'Livro do recebimento formal nao foi registrado.' using errcode = 'P0001';
  end if;

  update public.pedidos_internos_item_recebimentos
     set operacao_id = p_operacao_id,
         responsavel = v_ator
   where lote_id = v_lote_id
     and pedido_compra_item_id = p_item_id
     and operacao_id is null;

  return v_lote_id;
end $function$;

revoke all on function public.receber_item_pedido_compra(bigint, bigint, uuid, numeric, date, text, text, numeric, bigint)
  from public, anon;
grant execute on function public.receber_item_pedido_compra(bigint, bigint, uuid, numeric, date, text, text, numeric, bigint)
  to authenticated, service_role;

-- Estorno de recebimento de compra formal (EST-2), declarado antes da trava de
-- status para constar na lista de rotinas autorizadas.
create or replace function public.estornar_recebimento_do_lote(p_lote_id bigint, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_claims jsonb;
  v_ator text;
  v_rec record;
  v_interno record;
  v_compra record;
  v_item record;
  v_total numeric;
  v_ultimo_lote bigint;
  v_estava_completa boolean;
  v_completa boolean;
  v_status_destino text;
begin
  perform kontrol_private.exigir_permissao('estoque.lote.gerir');
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'Informe o motivo do estorno.' using errcode = '22023';
  end if;
  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), nullif(v_claims->>'sub', ''));
  if v_ator is null then
    raise exception 'Contexto JWT do ator e obrigatorio para estornar o recebimento.' using errcode = '42501';
  end if;

  select r.* into v_rec
  from pedidos_compra_item_recebimentos r
  where r.lote_id = p_lote_id
  for update;

  if not found then
    -- Lote de pedido interno sem compra formal: estorno bilateral existente.
    select r.* into v_interno
    from pedidos_internos_item_recebimentos r
    where r.lote_id = p_lote_id
    order by r.estornado_em nulls first, r.id desc
    limit 1;
    if not found then
      raise exception 'Este lote não veio de um recebimento de compra ou de pedido interno. Use o estorno de entrada do lote.'
        using errcode = '22023';
    end if;
    if v_interno.estornado_em is not null then
      return jsonb_build_object('lote_id', p_lote_id, 'repetido', true);
    end if;
    perform estornar_recebimento_item_pedido_interno(
      v_interno.pedido_interno_id, v_interno.pedido_interno_item_id, v_interno.id, v_motivo
    );
    return jsonb_build_object('lote_id', p_lote_id, 'pedido_interno_id', v_interno.pedido_interno_id, 'repetido', false);
  end if;

  if v_rec.estornado_em is not null then
    return jsonb_build_object('lote_id', p_lote_id, 'pedido_compra_id', v_rec.pedido_compra_id, 'repetido', true);
  end if;

  -- Compra formal vinda de pedido interno: o estorno do pedido interno já
  -- reconcilia os dois lados (livro, itens e status da compra).
  if v_rec.pedido_interno_item_id is not null then
    select r.* into v_interno
    from pedidos_internos_item_recebimentos r
    where r.lote_id = p_lote_id and r.estornado_em is null
    order by r.id desc
    limit 1;
    if found then
      perform estornar_recebimento_item_pedido_interno(
        v_interno.pedido_interno_id, v_interno.pedido_interno_item_id, v_interno.id,
        'estorno do recebimento da compra #' || v_rec.pedido_compra_id || ': ' || v_motivo
      );
      return jsonb_build_object('lote_id', p_lote_id, 'pedido_compra_id', v_rec.pedido_compra_id, 'repetido', false);
    end if;
  end if;

  select id, status into v_compra
  from pedidos_compra where id = v_rec.pedido_compra_id
  for update;

  select not exists (
    select 1 from pedidos_compra_itens i
    where i.pedido_id = v_compra.id
      and coalesce(i.quantidade_recebida, case when i.lote_id is not null then i.quantidade else 0 end) < i.quantidade
  ) into v_estava_completa;

  -- Descarta o lote (recusa se já houve consumo) e libera reservas.
  perform estornar_recebimento_lote(
    p_lote_id, 'estorno do recebimento da compra #' || v_compra.id || ': ' || v_motivo
  );

  update pedidos_compra_item_recebimentos
     set estornado_em = now(),
         estornado_por = v_ator,
         observacao = left(coalesce(observacao || ' | ', '') || 'Estornado: ' || v_motivo, 500)
   where id = v_rec.id;

  select i.id, i.quantidade into v_item
  from pedidos_compra_itens i
  where i.id = v_rec.pedido_compra_item_id
  for update;

  select coalesce(sum(r.quantidade), 0) into v_total
  from pedidos_compra_item_recebimentos r
  where r.pedido_compra_item_id = v_item.id and r.estornado_em is null;

  select r.lote_id into v_ultimo_lote
  from pedidos_compra_item_recebimentos r
  where r.pedido_compra_item_id = v_item.id and r.estornado_em is null
  order by r.recebido_em desc, r.id desc
  limit 1;

  update pedidos_compra_itens
     set quantidade_recebida = v_total,
         lote_id = case when v_total >= v_item.quantidade then v_ultimo_lote else null end,
         divergencia_recebimento = case
           when v_total > 0 and v_total <> v_item.quantidade
             then 'Pedido: ' || v_item.quantidade || '; recebido acumulado: ' || v_total
           else null
         end
   where id = v_item.id;

  select not exists (
    select 1 from pedidos_compra_itens i
    where i.pedido_id = v_compra.id
      and coalesce(i.quantidade_recebida, 0) < i.quantidade
  ) into v_completa;

  v_status_destino := v_compra.status;
  -- Só reabre a compra que tinha sido concluída por recebimento integral; a
  -- encerrada com pendência continua encerrada.
  if v_compra.status = 'recebido' and v_estava_completa and not v_completa then
    select e.de_status into v_status_destino
    from eventos_status e
    where e.entidade = 'pedido_compra'
      and e.entidade_id = v_compra.id
      and e.para_status = 'recebido'
      and e.de_status is distinct from 'recebido'
    order by e.criado_em desc, e.id desc
    limit 1;
    v_status_destino := coalesce(nullif(v_status_destino, 'recebido'), 'em_transito');
    perform set_config('app.pedido_compra_transicao', 'permitida', true);
    update pedidos_compra set status = v_status_destino where id = v_compra.id;
  end if;

  insert into eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
  values (
    'pedido_compra', v_compra.id, v_compra.status, v_status_destino, v_ator,
    left('Recebimento estornado: item #' || v_item.id || ', lote #' || p_lote_id
      || ', quantidade ' || v_rec.quantidade || '. Motivo: ' || v_motivo, 1000)
  );

  return jsonb_build_object(
    'lote_id', p_lote_id,
    'pedido_compra_id', v_compra.id,
    'status_compra', v_status_destino,
    'repetido', false
  );
end $function$;

revoke all on function public.estornar_recebimento_do_lote(bigint, text) from public, anon;
grant execute on function public.estornar_recebimento_do_lote(bigint, text) to authenticated, service_role;

-- Trava de status da compra: lista a rota nova de recebimento e o estorno.
create or replace function public.bloquear_status_direto_pedido_compra()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.status is distinct from old.status
     and (
       not public.fn_marcador_transacional_autorizado(array[
         'public.transicionar_pedido_compra(bigint,text,text,date)'::regprocedure,
         'public.cancelar_pedido_interno_operacional(bigint,text,text)'::regprocedure,
         'public.estornar_recebimento_item_pedido_interno(bigint,bigint,bigint,text)'::regprocedure,
         'public.receber_item_pedido_compra(bigint,bigint,uuid,numeric,date,text,text,numeric,bigint)'::regprocedure,
         'public.estornar_recebimento_do_lote(bigint,text)'::regprocedure
       ])
       or current_setting('app.pedido_compra_transicao', true) is distinct from 'permitida'
     ) then
    raise exception 'O status do pedido de compra so pode ser alterado por transicao transacional.'
      using errcode = '42501';
  end if;
  return new;
end
$function$;

-- A assinatura antiga (7 args) é substituída pela de 9 (mesmos nomes; os
-- dois novos são opcionais). Manter as duas deixaria a chamada ambígua.
drop function if exists public.receber_item_pedido_compra(bigint, bigint, uuid, numeric, date, text, text);

-- =============================================================================
-- 4. EST2-7: compra encerrada com pendência conclui o pedido interno
-- =============================================================================

create or replace function public.transicionar_pedido_compra(p_pedido_id bigint, p_status_destino text, p_observacao text DEFAULT NULL::text, p_data_prevista_entrega date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pedido record;
  v_claims jsonb;
  v_ator text;
  v_tem_recebimento boolean;
  v_interno bigint;
  v_internos bigint[];
  v_tudo_recebido boolean;
begin
  perform kontrol_private.exigir_permissao(case when p_status_destino = 'cancelado' then 'compras.cancelar' else 'compras.aprovar' end);

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), nullif(v_claims->>'sub', ''));
  if v_ator is null then
    raise exception 'Contexto JWT do ator e obrigatorio para transicionar a compra.' using errcode = '42501';
  end if;

  select id, status
    into v_pedido
  from public.pedidos_compra
  where id = p_pedido_id
  for update;

  if not found then
    raise exception 'Pedido de compra nao encontrado.' using errcode = 'P0002';
  end if;

  if not (
    (v_pedido.status = 'solicitado' and p_status_destino = 'aprovado') or
    (v_pedido.status = 'aprovado' and p_status_destino = 'enviado') or
    (v_pedido.status = 'enviado' and p_status_destino = 'em_transito') or
    (v_pedido.status in ('solicitado', 'aprovado', 'enviado', 'em_transito') and p_status_destino = 'cancelado') or
    (v_pedido.status in ('aprovado', 'enviado', 'em_transito') and p_status_destino = 'recebido')
  ) then
    raise exception 'Transicao de status nao permitida: % -> %.', v_pedido.status, p_status_destino
      using errcode = '22023';
  end if;

  select exists (
      select 1
      from public.pedidos_compra_item_recebimentos r
      where r.pedido_compra_id = p_pedido_id
        and r.estornado_em is null
        and r.quantidade > 0
    ) or exists (
      select 1
      from public.pedidos_internos_item_recebimentos r
      join public.pedidos_compra_itens i on i.id = r.pedido_compra_item_id
      where i.pedido_id = p_pedido_id
        and r.estornado_em is null
        and r.quantidade > 0
    ) or exists (
      select 1 from public.pedidos_compra_itens
      where pedido_id = p_pedido_id and lote_id is not null
    )
    into v_tem_recebimento;

  if p_status_destino = 'cancelado' and v_tem_recebimento then
    raise exception 'Pedido com recebimento parcial ou total nao pode ser cancelado. Use "Encerrar com pendência".' using errcode = '22023';
  end if;

  if p_status_destino = 'recebido' then
    if not v_tem_recebimento then
      raise exception 'Nada foi recebido nesta compra; para desistir dela, cancele.' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_observacao, '')), '') is null then
      raise exception 'Informe por que a compra será encerrada com itens pendentes.' using errcode = '22023';
    end if;
    update public.pedidos_compra_itens
       set divergencia_recebimento = left(
             'Encerrado com pendência: recebido '
               || coalesce(quantidade_recebida, 0) || ' de ' || quantidade
               || '. Motivo: ' || btrim(p_observacao), 500)
     where pedido_id = p_pedido_id
       and coalesce(quantidade_recebida, case when lote_id is not null then quantidade else 0 end) < quantidade;

    -- Decisão do dono (EST2-7): o pedido interno de origem conclui o
    -- recebimento com a pendência registrada em cada item não recebido.
    with afetados as (
      update public.pedidos_internos_itens pii
         set divergencia_recebimento = left(
               'Compra #' || p_pedido_id || ' encerrada com pendência: recebido '
                 || coalesce(pii.quantidade_recebida, 0) || ' de ' || pii.quantidade
                 || '. Motivo: ' || btrim(p_observacao), 500),
             recebido_em = now(),
             recebido_por = v_ator
        from public.pedidos_compra_itens ci
       where ci.pedido_id = p_pedido_id
         and ci.pedido_interno_item_id = pii.id
         and pii.recebido_em is null
      returning pii.pedido_interno_id
    )
    select coalesce(array_agg(distinct pedido_interno_id), '{}') into v_internos from afetados;

    foreach v_interno in array v_internos
    loop
      select not exists (
        select 1 from public.pedidos_internos_itens
        where pedido_interno_id = v_interno
          and tipo = 'material' and recebido_em is null
      ) into v_tudo_recebido;
      update public.pedidos_internos
         set recebido_em = case when v_tudo_recebido then coalesce(recebido_em, now()) else recebido_em end,
             recebido_por = case when v_tudo_recebido then coalesce(recebido_por, v_ator) else recebido_por end
       where id = v_interno;
      insert into public.eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
      select 'pedido_interno', p.id, p.status, p.status, v_ator,
             left('Recebimento concluído com pendência: a compra #' || p_pedido_id
               || ' foi encerrada. Motivo: ' || btrim(p_observacao), 1000)
      from public.pedidos_internos p where p.id = v_interno;
    end loop;
  end if;

  perform set_config('app.pedido_compra_transicao', 'permitida', true);
  update public.pedidos_compra
     set status = p_status_destino,
         aprovador = case when p_status_destino = 'aprovado' then v_ator else aprovador end,
         data_aprovacao = case when p_status_destino = 'aprovado' then current_date else data_aprovacao end,
         data_prevista_entrega = case
           when p_status_destino = 'aprovado' then p_data_prevista_entrega
           else data_prevista_entrega
         end
   where id = p_pedido_id;

  insert into public.eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
  values (
    'pedido_compra', p_pedido_id, v_pedido.status, p_status_destino, v_ator,
    case when p_status_destino = 'recebido'
      then 'Encerrada com pendência: ' || btrim(p_observacao)
      else p_observacao
    end
  );

  return jsonb_build_object(
    'status_origem', v_pedido.status,
    'status_destino', p_status_destino,
    'data_prevista_entrega', p_data_prevista_entrega
  );
end $function$;

-- =============================================================================
-- 5. Item 13/PER2-12: pedido formalizado e devolvido retoma a compra formal
-- =============================================================================

create or replace function public.formalizar_pedido_interno(p_pedido_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pedido record;
  v_compra record;
  v_compra_id bigint;
  v_email text := current_setting('request.jwt.claims', true)::jsonb->>'email';
  v_itens_compra integer := 0;
  v_linhas integer := 0;
  v_comentario text;
begin
  perform kontrol_private.exigir_permissao('pedido.aprovar');

  select id, titulo, status, solicitante, projeto_id, pedido_compra_id
    into v_pedido
  from pedidos_internos
  where id = p_pedido_id
  for update;

  if not found then
    raise exception 'Pedido interno nao encontrado.' using errcode = 'P0002';
  end if;
  if v_pedido.status <> 'validado' then
    raise exception 'Valide as informacoes antes de formalizar.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pedidos_internos_itens
    where pedido_interno_id = p_pedido_id
      and tipo in ('material', 'equipamento')
      and insumo_id is null
  ) then
    raise exception 'Vincule cada material ou equipamento a um insumo antes de formalizar.' using errcode = '22023';
  end if;

  if v_pedido.pedido_compra_id is not null then
    -- Pedido devolvido depois de formalizado: retoma a compra que já existe.
    select id, status into v_compra
    from pedidos_compra
    where id = v_pedido.pedido_compra_id
    for update;
    if not found or v_compra.status = 'cancelado' then
      raise exception 'A compra formal #% deste pedido foi cancelada. Cancele este pedido interno e registre um novo.',
        v_pedido.pedido_compra_id using errcode = '22023';
    end if;
    v_compra_id := v_compra.id;

    if v_compra.status = 'solicitado' then
      -- Compra ainda não aprovada: acompanha o ajuste feito nos itens.
      update pedidos_compra_itens ci
         set insumo_id = pii.insumo_id,
             quantidade = pii.quantidade,
             custo_unitario_estimado = pii.orcamento_previo,
             quantidade_em = coalesce(pii.quantidade_em, ci.quantidade_em),
             conteudo_embalagem = coalesce(pii.conteudo_embalagem, ci.conteudo_embalagem)
        from pedidos_internos_itens pii
       where ci.pedido_id = v_compra_id
         and ci.pedido_interno_item_id = pii.id
         and pii.pedido_interno_id = p_pedido_id
         and pii.insumo_id is not null
         and (ci.insumo_id, ci.quantidade, ci.custo_unitario_estimado)
             is distinct from (pii.insumo_id, pii.quantidade, pii.orcamento_previo);
      get diagnostics v_linhas = row_count;
      v_itens_compra := v_linhas;

      insert into pedidos_compra_itens(
        pedido_id, insumo_id, pedido_interno_item_id, quantidade, custo_unitario_estimado
      )
      select v_compra_id, pii.insumo_id, pii.id, pii.quantidade, pii.orcamento_previo
      from pedidos_internos_itens pii
      where pii.pedido_interno_id = p_pedido_id
        and pii.insumo_id is not null
        and not exists (
          select 1 from pedidos_compra_itens ci
          where ci.pedido_id = v_compra_id and ci.pedido_interno_item_id = pii.id
        );
      get diagnostics v_linhas = row_count;
      v_itens_compra := v_itens_compra + v_linhas;

      delete from pedidos_compra_itens ci
       where ci.pedido_id = v_compra_id
         and ci.pedido_interno_item_id is not null
         and not exists (
           select 1 from pedidos_internos_itens pii
           where pii.id = ci.pedido_interno_item_id
             and pii.pedido_interno_id = p_pedido_id
             and pii.insumo_id is not null
         );
      get diagnostics v_linhas = row_count;
      v_itens_compra := v_itens_compra + v_linhas;
      v_comentario := 'Compra formal #' || v_compra_id || ' retomada; ' || v_itens_compra
        || ' ajuste(s) de item aplicados à compra.';
    else
      v_comentario := 'Compra formal #' || v_compra_id || ' retomada (situação: ' || v_compra.status
        || '); itens da compra não foram alterados.';
    end if;

    perform set_config('app.pedido_interno_transicao', 'permitida', true);
    update pedidos_internos
       set status = 'formalizado',
           formalizado_em = coalesce(formalizado_em, now())
     where id = p_pedido_id;

    insert into pedidos_internos_aprovacoes(
      pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino
    ) values (
      p_pedido_id, 'Formalização do pedido', 'aprovado', v_email, current_papel(),
      v_comentario, 'validado', 'formalizado'
    );
    insert into eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
    values ('pedido_interno', p_pedido_id, 'validado', 'formalizado', v_email, v_comentario);

    return jsonb_build_object('pedido_compra_id', v_compra_id, 'itens_compra', v_itens_compra, 'retomada', true);
  end if;

  insert into pedidos_compra(projeto_id, solicitante, status, observacao)
  values (
    v_pedido.projeto_id,
    coalesce(v_pedido.solicitante, v_email),
    'solicitado',
    'Formalizado a partir do pedido interno #' || v_pedido.id || ': ' || v_pedido.titulo
  )
  returning id into v_compra_id;

  insert into pedidos_compra_itens(
    pedido_id, insumo_id, pedido_interno_item_id, quantidade, custo_unitario_estimado
  )
  select
    v_compra_id,
    pii.insumo_id,
    pii.id,
    pii.quantidade,
    pii.orcamento_previo
  from pedidos_internos_itens pii
  where pii.pedido_interno_id = p_pedido_id
    and pii.insumo_id is not null;
  get diagnostics v_itens_compra = row_count;

  perform set_config('app.pedido_interno_transicao', 'permitida', true);
  update pedidos_internos
     set pedido_compra_id = v_compra_id,
         status = 'formalizado',
         formalizado_em = now()
   where id = p_pedido_id;

  insert into pedidos_internos_aprovacoes(
    pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino
  ) values (
    p_pedido_id,
    'Formalização do pedido',
    'aprovado',
    v_email,
    current_papel(),
    'Compra formal #' || v_compra_id || ' criada com ' || v_itens_compra || ' item(ns) rastreável(is).',
    'validado',
    'formalizado'
  );

  insert into eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
  values
    ('pedido_interno', p_pedido_id, 'validado', 'formalizado', v_email, 'Compra formal #' || v_compra_id || ' criada.'),
    ('pedido_compra', v_compra_id, null, 'solicitado', v_email, 'Criado pelo pedido interno #' || p_pedido_id || '.');

  return jsonb_build_object('pedido_compra_id', v_compra_id, 'itens_compra', v_itens_compra, 'retomada', false);
end $function$;

-- =============================================================================
-- 6. Dados de cada etapa do pedido interno gravados por RPC
-- =============================================================================

create or replace function public.registrar_etapa_pedido_interno(
  p_pedido_id bigint,
  p_status_destino text,
  p_etapa text,
  p_decisao text,
  p_observacao text default null,
  p_dados jsonb default '{}'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := current_setting('request.jwt.claims', true)::jsonb->>'email';
  v_dados jsonb := coalesce(p_dados, '{}'::jsonb);
  v_obs text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_resultado jsonb;
  v_modalidade text;
begin
  -- Validações da etapa antes da transição (a transição checa a permissão).
  if p_status_destino = 'analise_administrativa'
     and (nullif(btrim(coalesce(v_dados->>'fonte_recurso', '')), '') is null
       or nullif(btrim(coalesce(v_dados->>'rubrica', '')), '') is null
       or nullif(btrim(coalesce(v_dados->>'conformidade_admin', '')), '') is null) then
    raise exception 'Fonte de recurso, rubrica e conformidade administrativa são obrigatórias.'
      using errcode = '22023';
  end if;
  if p_status_destino = 'encaminhado_instituicao' then
    v_modalidade := coalesce(nullif(btrim(coalesce(v_dados->>'modalidade_compra', '')), ''), 'fundacao');
    if v_modalidade not in ('fundacao', 'universidade', 'outra') then
      raise exception 'Selecione Fundação, Universidade ou outra instituição.' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(v_dados->>'instituicao_destino', '')), '') is null then
      raise exception 'Informe a instituição de destino.' using errcode = '22023';
    end if;
  end if;

  v_resultado := public.transicionar_pedido_interno(
    p_pedido_id, p_status_destino, p_etapa, p_decisao, p_observacao
  );

  update pedidos_internos p
     set enviado_validacao_em = case when p_status_destino = 'em_validacao' then now() else p.enviado_validacao_em end,
         validado_em = case when p_status_destino = 'validado' then now() else p.validado_em end,
         aprovado_coordenador_em = case when p_status_destino = 'validado' then now() else p.aprovado_coordenador_em end,
         aprovador_coordenador = case when p_status_destino = 'validado'
           then coalesce(nullif(btrim(coalesce(v_dados->>'aprovador_coordenador', '')), ''), v_email)
           else p.aprovador_coordenador end,
         coordenador_projeto_nome = case when p_status_destino = 'validado' and v_dados ? 'coordenador_projeto_nome'
           then nullif(btrim(coalesce(v_dados->>'coordenador_projeto_nome', '')), '')
           else p.coordenador_projeto_nome end,
         coordenador_projeto_email = case when p_status_destino = 'validado' and v_dados ? 'coordenador_projeto_email'
           then nullif(btrim(coalesce(v_dados->>'coordenador_projeto_email', '')), '')
           else p.coordenador_projeto_email end,
         aprovador_coordenador_diferente = case when p_status_destino = 'validado'
           then coalesce((v_dados->>'aprovador_coordenador_diferente')::boolean, false)
           else p.aprovador_coordenador_diferente end,
         fonte_recurso = case when p_status_destino = 'analise_administrativa'
           then btrim(v_dados->>'fonte_recurso') else p.fonte_recurso end,
         rubrica = case when p_status_destino = 'analise_administrativa'
           then btrim(v_dados->>'rubrica') else p.rubrica end,
         conformidade_admin = case when p_status_destino = 'analise_administrativa'
           then btrim(v_dados->>'conformidade_admin') else p.conformidade_admin end,
         observacao_compras = case when p_status_destino = 'analise_administrativa'
           then v_obs else p.observacao_compras end,
         analisado_em = case when p_status_destino = 'analise_administrativa' then now() else p.analisado_em end,
         orcamentos_em = case when p_status_destino = 'orcamentos' then now() else p.orcamentos_em end,
         aprovacao_final_em = case when p_status_destino = 'aprovado_para_compra' then now() else p.aprovacao_final_em end,
         fechado_em = case when p_status_destino = 'compra_fechada' then now() else p.fechado_em end,
         encaminhado_em = case when p_status_destino = 'encaminhado_instituicao' then now() else p.encaminhado_em end,
         modalidade_compra = case
           when p_status_destino = 'compra_fechada' then 'compra_direta'
           when p_status_destino = 'encaminhado_instituicao' then v_modalidade
           else p.modalidade_compra end,
         modalidade_definida_em = case when p_status_destino in ('compra_fechada', 'encaminhado_instituicao')
           then now() else p.modalidade_definida_em end,
         modalidade_definida_por = case when p_status_destino in ('compra_fechada', 'encaminhado_instituicao')
           then coalesce(nullif(btrim(coalesce(v_dados->>'modalidade_definida_por', '')), ''), v_email)
           else p.modalidade_definida_por end,
         observacao_administrativa = case when p_status_destino in ('compra_fechada', 'encaminhado_instituicao')
           then v_obs else p.observacao_administrativa end,
         instituicao_destino = case when p_status_destino = 'encaminhado_instituicao'
           then btrim(v_dados->>'instituicao_destino') else p.instituicao_destino end,
         protocolo_externo = case when p_status_destino = 'encaminhado_instituicao'
           then nullif(btrim(coalesce(v_dados->>'protocolo_externo', '')), '') else p.protocolo_externo end,
         data_envio_instituicao = case when p_status_destino = 'encaminhado_instituicao'
           then current_date else p.data_envio_instituicao end,
         pagamento_nf_em = case when p_status_destino = 'aguardando_pagamento_nf' then now() else p.pagamento_nf_em end,
         concluido_em = case when p_status_destino = 'compra_concluida' then now() else p.concluido_em end
   where p.id = p_pedido_id;

  return v_resultado;
end $function$;

revoke all on function public.registrar_etapa_pedido_interno(bigint, text, text, text, text, jsonb) from public, anon;
grant execute on function public.registrar_etapa_pedido_interno(bigint, text, text, text, text, jsonb) to authenticated, service_role;

-- =============================================================================
-- 7. EST2-3/EST-5: entrada avulsa no modelo do insumo e idempotente
-- =============================================================================

create or replace function public.entrada_inventario(
  p_insumo_id bigint,
  p_quantidade numeric,
  p_operacao_id uuid,
  p_validade date default null,
  p_custo numeric default null,
  p_codigo text default null,
  p_fornecedor text default null,
  p_motivo text default null,
  p_local_id bigint default null
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_claims jsonb;
  v_ator text;
  v_insumo record;
  v_modelo text;
  v_lote jsonb;
  v_lote_id bigint;
  v_requisicao jsonb;
  v_resultado jsonb;
  v_evento eventos_status%rowtype;
begin
  perform kontrol_private.exigir_permissao('estoque.movimentar');

  if p_insumo_id is null then
    raise exception 'Insumo invalido.' using errcode = '22023';
  end if;
  if p_operacao_id is null then
    raise exception 'Operação inválida; recarregue a página.' using errcode = '22023';
  end if;
  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'Quantidade deve ser maior que zero.' using errcode = '22023';
  end if;
  if p_custo is not null and p_custo < 0 then
    raise exception 'Custo unitario deve ser maior ou igual a zero.' using errcode = '22023';
  end if;
  if p_local_id is not null and not exists (select 1 from locais where id = p_local_id) then
    raise exception 'Local de armazenamento não encontrado.' using errcode = '22023';
  end if;

  v_requisicao := jsonb_build_object(
    'acao', 'entrada_inventario', 'insumo_id', p_insumo_id, 'quantidade', p_quantidade,
    'validade', p_validade, 'custo', p_custo, 'codigo', nullif(btrim(p_codigo), ''),
    'fornecedor', nullif(btrim(p_fornecedor), ''), 'motivo', nullif(btrim(p_motivo), ''),
    'local_id', p_local_id
  );
  perform pg_advisory_xact_lock(hashtextextended(p_operacao_id::text, 0));
  select * into v_evento
  from eventos_status e
  where e.entidade = 'entrada_inventario' and e.operacao_id = p_operacao_id
  for update;
  if found then
    if v_evento.operacao_payload->'requisicao' is distinct from v_requisicao then
      raise exception 'Esta operação já foi registrada com dados diferentes.' using errcode = '23505';
    end if;
    return jsonb_set(v_evento.operacao_payload->'resultado', '{repetido}', 'true'::jsonb, true);
  end if;

  select id, categoria_compra into v_insumo
  from insumos where id = p_insumo_id
  for update;
  if not found then
    raise exception 'Insumo não encontrado.' using errcode = 'P0002';
  end if;
  if v_insumo.categoria_compra = 'critico' and p_validade is null then
    raise exception 'Validade é obrigatória para insumo crítico.' using errcode = '22023';
  end if;

  -- Insumo contado em frascos recebe lote de frascos fechados (número
  -- inteiro, custo por frasco); insumo por volume continua por volume.
  v_modelo := kontrol_private.modelo_quantidade_insumo(p_insumo_id);
  v_lote := kontrol_private.lote_do_recebimento(
    p_insumo_id, p_quantidade,
    case when v_modelo = 'EMBALAGEM_FECHADA' then 'embalagem' else 'unidade' end,
    null, p_custo
  );

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), nullif(v_claims->>'sub', ''), current_user);
  v_lote_id := kontrol_private.criar_lote_recebido(
    p_insumo_id, v_lote, p_codigo, p_validade, p_fornecedor, null, v_ator
  );
  if p_local_id is not null then
    update lotes_estoque set local_id = p_local_id where id = v_lote_id;
  end if;

  insert into estoque_movimentacoes(insumo_id, tipo, quantidade, custo_unitario, motivo, referencia, lote_id)
  values (
    p_insumo_id, 'entrada', (v_lote->>'quantidade')::numeric, (v_lote->>'custo_unitario')::numeric,
    coalesce(nullif(btrim(p_motivo), ''), 'ajuste de inventario'), p_operacao_id::text, v_lote_id
  );

  v_resultado := jsonb_build_object(
    'lote_id', v_lote_id, 'insumo_id', p_insumo_id,
    'quantidade', (v_lote->>'quantidade')::numeric, 'modelo', v_lote->>'modelo',
    'repetido', false
  );
  insert into eventos_status(
    entidade, entidade_id, de_status, para_status, usuario, observacao, operacao_id, operacao_payload
  ) values (
    'entrada_inventario', v_lote_id, null, 'quarentena', v_ator,
    coalesce(nullif(btrim(p_motivo), ''), 'ajuste de inventario'), p_operacao_id,
    jsonb_build_object('requisicao', v_requisicao, 'resultado', v_resultado)
  );
  return v_resultado;
end $function$;

revoke all on function public.entrada_inventario(bigint, numeric, uuid, date, numeric, text, text, text, bigint) from public, anon;
grant execute on function public.entrada_inventario(bigint, numeric, uuid, date, numeric, text, text, text, bigint) to authenticated, service_role;

-- Assinatura antiga: mesma regra, sem idempotência (operação avulsa).
create or replace function public.entrada_inventario(p_insumo_id bigint, p_quantidade numeric, p_validade date DEFAULT NULL::date, p_custo numeric DEFAULT NULL::numeric, p_codigo text DEFAULT NULL::text, p_fornecedor text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return (public.entrada_inventario(
    p_insumo_id, p_quantidade, gen_random_uuid(), p_validade, p_custo, p_codigo, p_fornecedor, p_motivo, null::bigint
  ) ->> 'lote_id')::bigint;
end $function$;

revoke all on function public.entrada_inventario(bigint, numeric, date, numeric, text, text, text) from public, anon;
grant execute on function public.entrada_inventario(bigint, numeric, date, numeric, text, text, text) to authenticated, service_role;

-- =============================================================================
-- 8. Baixa manual: operacao_id, validade após abertura e reserva de vencido
-- =============================================================================

create or replace function public.baixa_manual_lote(p_lote_id bigint, p_quantidade numeric, p_motivo text, p_operacao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lote record;
  v_validade_apos_abertura date;
  v_validade_efetiva date;
  v_reservado numeric;
  v_vencimento boolean := lower(btrim(coalesce(p_motivo, ''))) like 'vencimento%';
  v_perda boolean := lower(btrim(coalesce(p_motivo, ''))) like 'vencimento%'
    or lower(btrim(coalesce(p_motivo, ''))) like 'perda%';
  v_requisicao jsonb;
  v_resultado jsonb;
  v_evento eventos_status%rowtype;
  v_claims jsonb;
  v_ator text;
begin
  perform kontrol_private.exigir_permissao('estoque.movimentar');

  if p_operacao_id is null then
    raise exception 'Operação inválida; recarregue a página.' using errcode = '22023';
  end if;
  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'Quantidade deve ser maior que zero.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Informe o motivo da baixa manual.' using errcode = '22023';
  end if;

  v_requisicao := jsonb_build_object(
    'acao', 'baixa_manual_lote', 'lote_id', p_lote_id,
    'quantidade', p_quantidade, 'motivo', btrim(p_motivo)
  );
  perform pg_advisory_xact_lock(hashtextextended(p_operacao_id::text, 0));
  select * into v_evento
  from eventos_status e
  where e.entidade = 'lote_baixa_manual' and e.operacao_id = p_operacao_id
  for update;
  if found then
    if v_evento.operacao_payload->'requisicao' is distinct from v_requisicao then
      raise exception 'Esta operação já foi registrada com dados diferentes.' using errcode = '23505';
    end if;
    return jsonb_set(v_evento.operacao_payload->'resultado', '{repetido}', 'true'::jsonb, true);
  end if;

  select l.*, i.validade_apos_abertura_dias
    into v_lote
  from lotes_estoque l
  join insumos i on i.id = l.insumo_id
  where l.id = p_lote_id
  for update;

  if not found then
    raise exception 'Lote não encontrado.' using errcode = 'P0002';
  end if;
  -- Guarda 0110: embalagens fechadas tem RPC propria (mantem status
  -- 'aceito', exige inteiro e idempotencia).
  if coalesce(v_lote.modelo_quantidade, 'LEGADO') = 'EMBALAGEM_FECHADA' then
    raise exception 'Lote de embalagens fechadas: use a baixa por embalagens (baixa_manual_embalagens).' using errcode = '22023';
  end if;
  if v_lote.status not in ('aceito','em_uso') then
    raise exception 'Só é possível baixar lote aceito ou em uso.' using errcode = '22023';
  end if;
  -- EST-8: vale a menor entre a validade de fábrica e a validade após abertura.
  v_validade_efetiva := menor_validade(v_lote.validade, v_lote.validade_apos_abertura);
  if v_validade_efetiva is not null and v_validade_efetiva < current_date and not v_vencimento then
    raise exception 'Lote vencido em %: registre a baixa com o motivo Vencimento.',
      to_char(v_validade_efetiva, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if p_quantidade > v_lote.quantidade_atual then
    raise exception 'Quantidade maior que o saldo atual do lote.' using errcode = '22023';
  end if;

  -- Baixa por vencimento de lote vencido: a reserva não vale mais; libera e
  -- marca o plano como reserva desatualizada.
  if v_vencimento and v_validade_efetiva is not null and v_validade_efetiva < current_date then
    perform kontrol_private.liberar_reservas_do_lote(p_lote_id, 'Lote vencido: baixa por vencimento');
  end if;

  -- Guarda 0110: a baixa manual nao pode consumir saldo reservado a planos.
  perform r.id
  from reservas_estoque r
  where r.lote_id = p_lote_id and r.status in ('reservado', 'parcial')
  order by r.id
  for update;
  select coalesce(sum(r.quantidade - coalesce(r.quantidade_consumida, 0)), 0)
    into v_reservado
  from reservas_estoque r
  where r.lote_id = p_lote_id and r.status in ('reservado', 'parcial');
  if v_reservado > v_lote.quantidade_atual - p_quantidade then
    raise exception 'Há reserva ativa neste lote: é possível baixar no máximo % sem afetar planos reservados.',
      greatest(0, v_lote.quantidade_atual - v_reservado)
      using errcode = '55000';
  end if;

  v_validade_apos_abertura :=
    case
      when v_lote.validade_apos_abertura is not null then v_lote.validade_apos_abertura
      when v_lote.validade_apos_abertura_dias is not null and v_lote.validade_apos_abertura_dias > 0
        then current_date + v_lote.validade_apos_abertura_dias
      else null
    end;

  -- perda não abre o frasco: status e datas de abertura só mudam no uso
  update lotes_estoque
     set quantidade_atual = quantidade_atual - p_quantidade,
         status = case
           when quantidade_atual - p_quantidade <= 0 then 'consumido'
           when v_perda then status
           else 'em_uso'
         end,
         data_abertura = case when v_perda then data_abertura else coalesce(data_abertura, current_date) end,
         validade_apos_abertura = case
           when v_perda then validade_apos_abertura
           else coalesce(validade_apos_abertura, v_validade_apos_abertura)
         end
   where id = p_lote_id;

  insert into estoque_movimentacoes(insumo_id, tipo, quantidade, custo_unitario, motivo, referencia, lote_id, categoria_saida)
  values (
    v_lote.insumo_id,
    case when v_perda then 'ajuste' else 'saida' end,
    p_quantidade,
    v_lote.custo_unitario,
    'baixa manual: ' || btrim(p_motivo),
    'lote ' || p_lote_id || '; operação ' || p_operacao_id,
    p_lote_id,
    case when v_vencimento then 'vencido' when v_perda then 'perda' end
  );

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), nullif(v_claims->>'sub', ''), current_user);
  v_resultado := jsonb_build_object(
    'lote_id', p_lote_id, 'insumo_id', v_lote.insumo_id,
    'quantidade_baixada', p_quantidade,
    'quantidade_restante', v_lote.quantidade_atual - p_quantidade,
    'repetido', false
  );
  insert into eventos_status(
    entidade, entidade_id, de_status, para_status, usuario, observacao, operacao_id, operacao_payload
  ) values (
    'lote_baixa_manual', p_lote_id, v_lote.quantidade_atual::text,
    (v_lote.quantidade_atual - p_quantidade)::text, v_ator,
    'baixa manual: ' || btrim(p_motivo), p_operacao_id,
    jsonb_build_object('requisicao', v_requisicao, 'resultado', v_resultado)
  );
  return v_resultado;
end $function$;

revoke all on function public.baixa_manual_lote(bigint, numeric, text, uuid) from public, anon;
grant execute on function public.baixa_manual_lote(bigint, numeric, text, uuid) to authenticated, service_role;

create or replace function public.baixa_manual_lote(p_lote_id bigint, p_quantidade numeric, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.baixa_manual_lote(p_lote_id, p_quantidade, p_motivo, gen_random_uuid());
end $function$;

create or replace function public.baixa_manual_embalagens(p_lote_id bigint, p_quantidade integer, p_quantidade_esperada integer, p_operacao_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ator_id uuid := auth.uid();
  v_claims jsonb;
  v_ator text;
  v_lote public.lotes_estoque%rowtype;
  v_reservado numeric;
  v_restante integer;
  v_requisicao jsonb;
  v_resultado jsonb;
  v_evento public.eventos_status%rowtype;
  v_vencimento boolean := lower(btrim(coalesce(p_motivo, ''))) like 'vencimento%';
  v_perda boolean := lower(btrim(coalesce(p_motivo, ''))) like 'vencimento%'
    or lower(btrim(coalesce(p_motivo, ''))) like 'perda%';
begin
  perform kontrol_private.exigir_permissao('estoque.movimentar');
  if v_ator_id is null then
    raise exception 'Sessão inválida.' using errcode = '28000';
  end if;
  if p_lote_id is null or p_operacao_id is null
    or p_quantidade is null or p_quantidade <= 0
    or p_quantidade_esperada is null or p_quantidade_esperada <= 0 then
    raise exception 'Informe o lote e uma quantidade inteira de embalagens maior que zero.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Informe o motivo da baixa.' using errcode = '22023';
  end if;

  v_requisicao := jsonb_build_object(
    'acao', 'baixa_manual_embalagens', 'lote_id', p_lote_id,
    'quantidade', p_quantidade, 'quantidade_esperada', p_quantidade_esperada,
    'motivo', btrim(p_motivo)
  );
  perform pg_advisory_xact_lock(hashtextextended(p_operacao_id::text, 0));
  select * into v_evento
  from public.eventos_status e
  where e.entidade = 'lote_embalagem_fechada'
    and e.operacao_id = p_operacao_id
  for update;
  if found then
    if v_evento.operacao_payload->'requisicao' is distinct from v_requisicao then
      raise exception 'Esta operação já foi registrada com dados diferentes.' using errcode = '23505';
    end if;
    return jsonb_set(
      v_evento.operacao_payload->'resultado', '{repetido}', 'true'::jsonb, true
    );
  end if;

  select * into v_lote
  from public.lotes_estoque l
  where l.id = p_lote_id
  for update;
  if not found then
    raise exception 'Lote não encontrado.' using errcode = 'P0002';
  end if;
  if v_lote.modelo_quantidade <> 'EMBALAGEM_FECHADA' then
    raise exception 'Este lote é controlado por volume (modelo legado); use a baixa manual do lote.' using errcode = '22023';
  end if;
  if v_lote.status <> 'aceito' then
    raise exception 'Só é possível dar baixa em lote aceito.' using errcode = '55000';
  end if;
  if v_lote.validade is not null and v_lote.validade < current_date and not v_vencimento then
    raise exception 'Lote vencido: registre a baixa com o motivo Vencimento.' using errcode = '22023';
  end if;
  if v_lote.quantidade_atual <> p_quantidade_esperada then
    raise exception 'A quantidade do lote mudou; recarregue e tente novamente.' using errcode = '40001';
  end if;
  if p_quantidade > v_lote.quantidade_atual then
    raise exception 'Quantidade maior que o saldo do lote (% embalagens).', v_lote.quantidade_atual::integer
      using errcode = '22023';
  end if;

  -- Baixa por vencimento de lote vencido libera a reserva (plano fica com
  -- reserva desatualizada).
  if v_vencimento and v_lote.validade is not null and v_lote.validade < current_date then
    perform kontrol_private.liberar_reservas_do_lote(p_lote_id, 'Lote vencido: baixa por vencimento');
  end if;

  perform r.id
  from public.reservas_estoque r
  where r.lote_id = p_lote_id and r.status in ('reservado', 'parcial')
  order by r.id
  for update;
  select coalesce(sum(r.quantidade - coalesce(r.quantidade_consumida, 0)), 0)
    into v_reservado
  from public.reservas_estoque r
  where r.lote_id = p_lote_id and r.status in ('reservado', 'parcial');
  if v_reservado > v_lote.quantidade_atual - p_quantidade then
    raise exception 'Há reserva ativa neste lote: é possível baixar no máximo % embalagem(ns).',
      greatest(0, floor(v_lote.quantidade_atual - v_reservado))::integer
      using errcode = '55000';
  end if;

  v_restante := (v_lote.quantidade_atual - p_quantidade)::integer;
  update public.lotes_estoque
     set quantidade_atual = v_restante,
         status = case when v_restante = 0 then 'consumido' else 'aceito' end
   where id = p_lote_id;

  -- perdas (vencimento, perda/quebra) ficam fora da previsão de consumo, que soma só 'saida'
  insert into public.estoque_movimentacoes (
    insumo_id, tipo, quantidade, custo_unitario, motivo, referencia, lote_id, categoria_saida
  ) values (
    v_lote.insumo_id, case when v_perda then 'ajuste' else 'saida' end, p_quantidade, v_lote.custo_unitario,
    'baixa manual: ' || btrim(p_motivo), p_operacao_id::text, p_lote_id,
    case when v_vencimento then 'vencido' when v_perda then 'perda' end
  );

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), v_ator_id::text);
  v_resultado := jsonb_build_object(
    'lote_id', p_lote_id,
    'insumo_id', v_lote.insumo_id,
    'quantidade_baixada', p_quantidade,
    'quantidade_embalagens', v_restante,
    'repetido', false
  );
  insert into public.eventos_status (
    entidade, entidade_id, de_status, para_status, usuario, observacao,
    operacao_id, operacao_payload
  ) values (
    'lote_embalagem_fechada', p_lote_id,
    v_lote.quantidade_atual::integer::text, v_restante::text,
    v_ator, 'baixa manual: ' || btrim(p_motivo), p_operacao_id,
    jsonb_build_object('requisicao', v_requisicao, 'resultado', v_resultado)
  );
  return v_resultado;
end;
$function$;

-- =============================================================================
-- 9. EST2-4: reservas de lotes vencidos liberadas todo dia
-- =============================================================================

create or replace function kontrol_private.liberar_reservas_de_lotes_vencidos()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lote bigint;
  v_total integer := 0;
begin
  for v_lote in
    select distinct l.id
    from public.lotes_estoque l
    join public.reservas_estoque r on r.lote_id = l.id and r.status in ('reservado', 'parcial')
    where public.menor_validade(l.validade, l.validade_apos_abertura) < current_date
    order by l.id
  loop
    v_total := v_total + coalesce(
      kontrol_private.liberar_reservas_do_lote(v_lote, 'Lote vencido: reserva liberada pela rotina diária'), 0);
  end loop;
  return v_total;
end $$;

revoke all on function kontrol_private.liberar_reservas_de_lotes_vencidos() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'kontrol-reservas-vencidas-diaria';
    perform cron.schedule(
      'kontrol-reservas-vencidas-diaria',
      '5 7 * * *',
      $cron$select kontrol_private.liberar_reservas_de_lotes_vencidos();$cron$
    );
  else
    raise notice '0127: pg_cron ausente; agende kontrol_private.liberar_reservas_de_lotes_vencidos() diariamente.';
  end if;
end $$;

-- =============================================================================
-- 10. PER2-7: ajuste de inventário exige "estoque.lote.gerir"
-- =============================================================================

create or replace function public.aplicar_ajuste_inventario_contagem(p_contagem_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_contagem public.inventario_contagens%rowtype;
  v_ciclo_status text;
  v_responsavel text;
  v_saldo_atual numeric;
begin
  perform kontrol_private.exigir_permissao('estoque.lote.gerir');

  select *
    into v_contagem
    from public.inventario_contagens
   where id = p_contagem_id
   for update;

  if not found then
    raise exception 'Contagem de inventario nao encontrada.' using errcode = '22023';
  end if;

  select status
    into v_ciclo_status
    from public.inventario_ciclos
   where id = v_contagem.ciclo_id
   for update;

  if v_ciclo_status is distinct from 'aberto' then
    raise exception 'Campanha de inventario nao esta aberta.' using errcode = '22023';
  end if;

  if v_contagem.ajuste_aplicado then
    raise exception 'Ajuste ja aplicado para esta contagem.' using errcode = '22023';
  end if;

  if abs(v_contagem.divergencia) <= 0.000001 then
    raise exception 'Contagem sem divergencia nao exige ajuste.' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(v_contagem.justificativa, '')), '') is null then
    raise exception 'Justificativa obrigatoria para ajuste de inventario.' using errcode = '22023';
  end if;

  select quantidade_atual into v_saldo_atual
  from public.lotes_estoque
  where id = v_contagem.lote_id
  for update;
  if v_saldo_atual is distinct from v_contagem.quantidade_sistema then
    raise exception 'O saldo do lote mudou depois da contagem (era %, agora %). Conte de novo antes de ajustar.',
      v_contagem.quantidade_sistema, v_saldo_atual
      using errcode = '40001';
  end if;

  v_responsavel := coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    nullif(auth.uid()::text, ''),
    current_user
  );

  perform public.ajustar_saldo_lote(
    v_contagem.lote_id,
    v_contagem.quantidade_contada,
    'inventario ciclo #' || v_contagem.ciclo_id || ': ' || btrim(v_contagem.justificativa)
      || coalesce(' (ajustado por ' || v_responsavel || ')', '')
  );

  update public.inventario_contagens
     set ajuste_aplicado = true,
         ajustado_em = now(),
         ajustado_por = v_responsavel
   where id = v_contagem.id;

  return jsonb_build_object(
    'contagem_id', v_contagem.id,
    'ciclo_id', v_contagem.ciclo_id,
    'lote_id', v_contagem.lote_id,
    'quantidade_contada', v_contagem.quantidade_contada
  );
end;
$function$;

-- =============================================================================
-- 11. "Comprar faltas" do planejamento: transacional e sem pedido em dobro
-- =============================================================================

create or replace function public.criar_pedido_faltas_planejamento(p_planejamento_id bigint, p_itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := current_setting('request.jwt.claims', true)::jsonb->>'email';
  v_plano record;
  v_item jsonb;
  v_insumo_id bigint;
  v_conteudo numeric;
  v_em text;
  v_pedido_fisico numeric;
  v_ja_pedido numeric;
  v_restante numeric;
  v_quantidade numeric;
  v_pedido_id bigint;
  v_itens integer := 0;
  v_abertos text;
begin
  perform kontrol_private.exigir_permissao('pedido.criar');

  if jsonb_typeof(coalesce(p_itens, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) = 0 then
    raise exception 'Este plano não tem faltas para comprar.' using errcode = '22023';
  end if;

  select p.id, p.nome, p.projeto_id, pr.coordenador
    into v_plano
  from planejamento p
  left join projetos pr on pr.id = p.projeto_id
  where p.id = p_planejamento_id;
  if not found then
    raise exception 'Planejamento não encontrado.' using errcode = 'P0002';
  end if;

  -- Dois cliques (ou duas pessoas) no mesmo plano: um espera o outro e já
  -- enxerga o pedido criado antes.
  perform pg_advisory_xact_lock(8200000000000000 + p_planejamento_id);

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_insumo_id := nullif(v_item->>'insumo_id', '')::bigint;
    v_quantidade := nullif(v_item->>'quantidade', '')::numeric;
    continue when v_insumo_id is null or v_quantidade is null or v_quantidade <= 0;
    v_em := case when v_item->>'quantidade_em' = 'embalagem' then 'embalagem' else 'unidade' end;
    v_conteudo := nullif(nullif(v_item->>'conteudo_embalagem', '')::numeric, 0);
    if v_em = 'embalagem' and v_conteudo is null then
      v_em := 'unidade';
    end if;
    v_pedido_fisico := v_quantidade * case when v_em = 'embalagem' then v_conteudo else 1 end;

    -- O que já está pedido para este plano e ainda não chegou (unidade física).
    select coalesce(sum(
             greatest(pii.quantidade - coalesce(pii.quantidade_recebida, 0), 0)
             * case when pii.quantidade_em = 'embalagem' then coalesce(pii.conteudo_embalagem, 1) else 1 end
           ), 0)
      into v_ja_pedido
    from pedidos_internos_itens pii
    join pedidos_internos pi on pi.id = pii.pedido_interno_id
    where pi.planejamento_id = p_planejamento_id
      and pi.status <> 'cancelado'
      and pii.insumo_id = v_insumo_id
      and pii.recebido_em is null;

    v_restante := v_pedido_fisico - v_ja_pedido;
    continue when v_restante <= 0;
    v_quantidade := case when v_em = 'embalagem' then ceil(v_restante / v_conteudo) else v_restante end;

    if v_pedido_id is null then
      insert into pedidos_internos(
        titulo, status, solicitante, projeto_id, planejamento_id, tipo_demanda, urgencia,
        fonte_recurso, justificativa, coordenador_projeto_nome, coordenador_projeto_email
      ) values (
        'Pedido interno do planejamento #' || p_planejamento_id || coalesce(' · ' || nullif(v_plano.nome, ''), ''),
        'rascunho', v_email, v_plano.projeto_id, p_planejamento_id, 'laboratorio', 'alta',
        'A definir pelo projeto',
        'Pedido interno gerado porque o planejamento #' || p_planejamento_id
          || ' não tinha saldo suficiente para iniciar. A compra formal segue a validação e Compras.',
        v_plano.coordenador,
        case when position('@' in coalesce(v_plano.coordenador, '')) > 0 then v_plano.coordenador end
      )
      returning id into v_pedido_id;
    end if;

    insert into pedidos_internos_itens(
      pedido_interno_id, tipo, insumo_id, especificacao, quantidade, unidade,
      quantidade_em, conteudo_embalagem, orcamento_previo, fornecedor_sugerido, observacao
    ) values (
      v_pedido_id, 'material', v_insumo_id,
      coalesce(nullif(btrim(v_item->>'especificacao'), ''), 'Insumo #' || v_insumo_id),
      v_quantidade,
      nullif(btrim(coalesce(v_item->>'unidade', '')), ''),
      v_em, v_conteudo,
      nullif(v_item->>'orcamento_previo', '')::numeric,
      nullif(btrim(coalesce(v_item->>'fornecedor_sugerido', '')), ''),
      left(coalesce(nullif(btrim(v_item->>'observacao'), ''), 'Falta operacional do planejamento #' || p_planejamento_id)
        || case when v_ja_pedido > 0 then ' Descontado o que já estava pedido para este plano.' else '' end, 1000)
    );
    v_itens := v_itens + 1;
  end loop;

  if v_pedido_id is null then
    select string_agg('#' || id, ', ' order by id) into v_abertos
    from pedidos_internos
    where planejamento_id = p_planejamento_id and status <> 'cancelado';
    raise exception 'As faltas deste planejamento já estão em pedido interno aberto (%). Acompanhe por lá.',
      coalesce(v_abertos, '—') using errcode = '22023';
  end if;

  insert into eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('pedido_interno', v_pedido_id, null, 'rascunho', v_email,
          'Pedido interno gerado pelas faltas do planejamento #' || p_planejamento_id || '.');

  return jsonb_build_object('pedido_id', v_pedido_id, 'itens', v_itens);
end $function$;

revoke all on function public.criar_pedido_faltas_planejamento(bigint, jsonb) from public, anon;
grant execute on function public.criar_pedido_faltas_planejamento(bigint, jsonb) to authenticated, service_role;

-- =============================================================================
-- 12. Views: reservado só em lote utilizável, unidade do saldo, alertas com
--     lote, previsão normalizada
-- =============================================================================

create or replace view public.v_estoque_saldo
with (security_invoker = true) as
 WITH lotes_utilizaveis AS (
         SELECT l.id
           FROM lotes_estoque l
          WHERE l.modelo_quantidade = 'LEGADO'::text AND (l.status = ANY (ARRAY['aceito'::text, 'em_uso'::text])) AND (menor_validade(l.validade, l.validade_apos_abertura) IS NULL OR menor_validade(l.validade, l.validade_apos_abertura) >= CURRENT_DATE)
             OR l.modelo_quantidade = 'EMBALAGEM_FECHADA'::text AND l.status = 'aceito'::text AND (l.validade IS NULL OR l.validade >= CURRENT_DATE)
        ), reservas AS (
         SELECT r.insumo_id,
            COALESCE(sum(r.quantidade - COALESCE(r.quantidade_consumida, 0::numeric)), 0::numeric) AS reservado
           FROM reservas_estoque r
             JOIN lotes_utilizaveis lu ON lu.id = r.lote_id
          WHERE (r.status = ANY (ARRAY['reservado'::text, 'parcial'::text])) AND r.lote_id IS NOT NULL
          GROUP BY r.insumo_id
        ), saldos AS (
         SELECT i.id AS insumo_id,
            i.tipo_insumo_id,
            ti.nome AS tipo_insumo,
            ti.classe AS classe_tipo_insumo,
            i.nome_item,
            i.especificacao,
            i.unidade,
            COALESCE(sum(l.quantidade_atual) FILTER (WHERE l.modelo_quantidade = 'LEGADO'::text AND (l.status = ANY (ARRAY['aceito'::text, 'em_uso'::text])) OR l.modelo_quantidade = 'EMBALAGEM_FECHADA'::text AND l.status = 'aceito'::text), 0::numeric) AS em_maos,
            COALESCE(sum(l.quantidade_atual) FILTER (WHERE l.status = 'quarentena'::text), 0::numeric) AS em_quarentena,
            COALESCE(sum(l.quantidade_atual) FILTER (WHERE l.status = 'bloqueado'::text), 0::numeric) AS bloqueado,
            COALESCE(sum(l.quantidade_atual) FILTER (WHERE l.modelo_quantidade = 'LEGADO'::text AND (l.status = ANY (ARRAY['aceito'::text, 'em_uso'::text])) AND menor_validade(l.validade, l.validade_apos_abertura) < CURRENT_DATE OR l.modelo_quantidade = 'EMBALAGEM_FECHADA'::text AND l.status = 'aceito'::text AND l.validade < CURRENT_DATE), 0::numeric) AS vencido,
            COALESCE(r.reservado, 0::numeric) AS reservado,
            COALESCE(sum(l.quantidade_atual) FILTER (WHERE l.modelo_quantidade = 'LEGADO'::text AND (l.status = ANY (ARRAY['aceito'::text, 'em_uso'::text])) AND (menor_validade(l.validade, l.validade_apos_abertura) IS NULL OR menor_validade(l.validade, l.validade_apos_abertura) >= CURRENT_DATE) OR l.modelo_quantidade = 'EMBALAGEM_FECHADA'::text AND l.status = 'aceito'::text AND (l.validade IS NULL OR l.validade >= CURRENT_DATE)), 0::numeric) AS disponivel_bruto,
            i.ponto_reposicao,
            i.estoque_seguranca,
            i.lead_time_dias,
            i.categoria_compra,
            -- mesmo critério de kontrol_private.modelo_quantidade_insumo
            CASE
                WHEN bool_or(l.modelo_quantidade <> 'EMBALAGEM_FECHADA'::text AND l.quantidade_atual > 0::numeric) THEN 'LEGADO'::text
                WHEN i.quantidade_embalagem > 0::numeric AND NULLIF(btrim(i.unidade), ''::text) IS NOT NULL THEN 'EMBALAGEM_FECHADA'::text
                ELSE 'LEGADO'::text
            END AS modelo_quantidade,
            i.quantidade_embalagem
           FROM insumos i
             LEFT JOIN tipo_insumos ti ON ti.id = i.tipo_insumo_id
             LEFT JOIN lotes_estoque l ON l.insumo_id = i.id
             LEFT JOIN reservas r ON r.insumo_id = i.id
          GROUP BY i.id, ti.id, r.reservado
        )
 SELECT insumo_id,
    tipo_insumo_id,
    tipo_insumo,
    classe_tipo_insumo,
    nome_item,
    especificacao,
    unidade,
    em_maos,
    em_quarentena,
    bloqueado,
    vencido,
    reservado,
    GREATEST(0::numeric, disponivel_bruto - reservado) AS disponivel,
    ponto_reposicao,
    estoque_seguranca,
    lead_time_dias,
    categoria_compra,
    modelo_quantidade,
        CASE
            WHEN modelo_quantidade = 'EMBALAGEM_FECHADA'::text
              THEN 'frasco(s) de ' || to_char(quantidade_embalagem, 'FM999999990.######') || ' ' || btrim(unidade)
            ELSE unidade
        END AS unidade_saldo
   FROM saldos;

create or replace view public.v_estoque_disponivel_unidade
with (security_invoker = true) as
 WITH lotes AS (
         SELECT l.id,
            l.insumo_id,
            l.quantidade_atual,
                CASE
                    WHEN l.modelo_quantidade = 'EMBALAGEM_FECHADA'::text THEN COALESCE(NULLIF(l.conteudo_embalagem_snapshot, 0::numeric), 1::numeric)
                    ELSE 1::numeric
                END AS conteudo,
            l.modelo_quantidade = 'EMBALAGEM_FECHADA'::text AND l.status = 'aceito'::text AND (l.validade IS NULL OR l.validade >= CURRENT_DATE) OR l.modelo_quantidade <> 'EMBALAGEM_FECHADA'::text AND (l.status = ANY (ARRAY['aceito'::text, 'em_uso'::text])) AND (menor_validade(l.validade, l.validade_apos_abertura) IS NULL OR menor_validade(l.validade, l.validade_apos_abertura) >= CURRENT_DATE) AS utilizavel
           FROM lotes_estoque l
          WHERE l.quantidade_atual > 0::numeric
        ), reservas AS (
         SELECT r.lote_id,
            sum(r.quantidade - COALESCE(r.quantidade_consumida, 0::numeric)) AS quantidade
           FROM reservas_estoque r
          WHERE (r.status = ANY (ARRAY['reservado'::text, 'parcial'::text])) AND r.lote_id IS NOT NULL
          GROUP BY r.lote_id
        )
 SELECT lotes.insumo_id,
    sum(
        CASE
            WHEN lotes.utilizavel THEN lotes.quantidade_atual * lotes.conteudo
            ELSE 0::numeric
        END) AS em_maos_unidade,
    sum(
        CASE
            WHEN lotes.utilizavel THEN COALESCE(reservas.quantidade, 0::numeric) * lotes.conteudo
            ELSE 0::numeric
        END) AS reservado_unidade,
    sum(
        CASE
            WHEN lotes.utilizavel THEN GREATEST(0::numeric, lotes.quantidade_atual - COALESCE(reservas.quantidade, 0::numeric)) * lotes.conteudo
            ELSE 0::numeric
        END) AS disponivel_unidade
   FROM lotes
     LEFT JOIN reservas ON reservas.lote_id = lotes.id
  GROUP BY lotes.insumo_id;

-- Alertas: lote_id no fim (null nos alertas por insumo); lote em quarentena
-- vencido também alerta. Sem security_invoker, como antes.
create or replace view public.v_alertas_estoque as
 SELECT 'reposicao'::text AS tipo,
    s.insumo_id,
    s.especificacao,
    NULL::date AS validade,
    s.disponivel AS valor,
    s.ponto_reposicao AS referencia,
    NULL::bigint AS lote_id
   FROM v_estoque_saldo s
  WHERE s.ponto_reposicao > 0::numeric AND s.disponivel <= s.ponto_reposicao
UNION ALL
 SELECT 'quarentena'::text AS tipo,
    s.insumo_id,
    s.especificacao,
    NULL::date AS validade,
    s.em_quarentena AS valor,
    NULL::numeric AS referencia,
    NULL::bigint AS lote_id
   FROM v_estoque_saldo s
  WHERE s.em_quarentena > 0::numeric
UNION ALL
 SELECT 'sem_validade'::text AS tipo,
    l.insumo_id,
    i.especificacao,
    NULL::date AS validade,
    l.quantidade_atual AS valor,
    NULL::numeric AS referencia,
    l.id AS lote_id
   FROM lotes_estoque l
     JOIN insumos i ON i.id = l.insumo_id
  WHERE l.quantidade_atual > 0::numeric AND (l.status = ANY (ARRAY['aceito'::text, 'em_uso'::text])) AND l.validade IS NULL AND i.categoria_compra = 'critico'::text
UNION ALL
 SELECT
        CASE
            WHEN menor_validade(l.validade, l.validade_apos_abertura) < CURRENT_DATE THEN 'vencido'::text
            ELSE 'vencimento'::text
        END AS tipo,
    l.insumo_id,
    i.especificacao,
    menor_validade(l.validade, l.validade_apos_abertura) AS validade,
    l.quantidade_atual AS valor,
    NULL::numeric AS referencia,
    l.id AS lote_id
   FROM lotes_estoque l
     JOIN insumos i ON i.id = l.insumo_id
  WHERE l.quantidade_atual > 0::numeric AND (l.status = ANY (ARRAY['aceito'::text, 'em_uso'::text, 'quarentena'::text])) AND menor_validade(l.validade, l.validade_apos_abertura) IS NOT NULL AND menor_validade(l.validade, l.validade_apos_abertura) <= (CURRENT_DATE + (( SELECT parametros.valor
           FROM parametros
          WHERE parametros.chave = 'janela_vencimento_dias'::text))::integer);

create or replace view public.v_planejamento_compromissos_estoque
with (security_invoker = true) as
 SELECT p.id AS planejamento_id,
    p.nome AS planejamento_nome,
    p.projeto_id,
    pr.nome AS projeto_nome,
    p.data_inicio_prevista,
    p.data_fim_prevista,
    p.data_alvo,
    p.prioridade,
    p.status_operacional,
    r.insumo_id,
    i.especificacao,
    i.unidade,
    r.lote_id,
    sum(r.quantidade - COALESCE(r.quantidade_consumida, 0::numeric)) AS quantidade_comprometida,
        CASE
            WHEN le.modelo_quantidade = 'EMBALAGEM_FECHADA'::text
              THEN 'frasco(s) de ' || to_char(le.conteudo_embalagem_snapshot, 'FM999999990.######') || ' ' || btrim(COALESCE(le.unidade_fisica_snapshot, i.unidade))
            ELSE i.unidade
        END AS unidade_quantidade
   FROM reservas_estoque r
     JOIN planejamento p ON p.id = r.planejamento_id
     LEFT JOIN projetos pr ON pr.id = p.projeto_id
     LEFT JOIN insumos i ON i.id = r.insumo_id
     LEFT JOIN lotes_estoque le ON le.id = r.lote_id
  WHERE r.status = ANY (ARRAY['reservado'::text, 'parcial'::text])
  GROUP BY p.id, p.nome, p.projeto_id, pr.nome, p.data_inicio_prevista, p.data_fim_prevista, p.data_alvo, p.prioridade, p.status_operacional, r.insumo_id, i.especificacao, i.unidade, r.lote_id, le.modelo_quantidade, le.conteudo_embalagem_snapshot, le.unidade_fisica_snapshot;

-- EST2-8: saídas de lote antigo (mL) e de lote de frascos convertidas para a
-- unidade de estoque atual do insumo antes de somar.
create or replace view public.v_previsao_suprimentos
with (security_invoker = true) as
 WITH cfg AS (
         SELECT COALESCE(( SELECT parametros.valor::integer AS valor
                   FROM parametros
                  WHERE parametros.chave = 'janela_consumo_previsao_dias'::text), 90) AS janela
        ), modelo AS (
         SELECT s.insumo_id,
            s.modelo_quantidade,
            NULLIF(i.quantidade_embalagem, 0::numeric) AS conteudo
           FROM v_estoque_saldo s
             JOIN insumos i ON i.id = s.insumo_id
        ), consumo AS (
         SELECT m.insumo_id,
            sum(
                CASE
                    WHEN m.tipo <> 'saida'::text THEN 0::numeric
                    WHEN md.modelo_quantidade = 'EMBALAGEM_FECHADA'::text AND COALESCE(l.modelo_quantidade, 'LEGADO'::text) <> 'EMBALAGEM_FECHADA'::text AND md.conteudo IS NOT NULL
                      THEN m.quantidade / md.conteudo
                    WHEN md.modelo_quantidade <> 'EMBALAGEM_FECHADA'::text AND l.modelo_quantidade = 'EMBALAGEM_FECHADA'::text
                      THEN m.quantidade * COALESCE(NULLIF(l.conteudo_embalagem_snapshot, 0::numeric), 1::numeric)
                    ELSE m.quantidade
                END) AS consumo_janela
           FROM estoque_movimentacoes m
             CROSS JOIN cfg
             LEFT JOIN lotes_estoque l ON l.id = m.lote_id
             LEFT JOIN modelo md ON md.insumo_id = m.insumo_id
          WHERE m.data >= (CURRENT_DATE - cfg.janela)
          GROUP BY m.insumo_id
        ), compras_abertas AS (
         SELECT pi.insumo_id,
            sum(GREATEST(pi.quantidade - COALESCE(pi.quantidade_recebida,
                CASE
                    WHEN pi.lote_id IS NOT NULL THEN pi.quantidade
                    ELSE 0::numeric
                END), 0::numeric)
                * kontrol_private.fator_item_para_estoque(pi.insumo_id, pi.quantidade_em, pi.conteudo_embalagem))
              FILTER (WHERE p.status = ANY (ARRAY['solicitado'::text, 'aprovado'::text, 'enviado'::text, 'em_transito'::text])) AS quantidade
           FROM pedidos_compra_itens pi
             JOIN pedidos_compra p ON p.id = pi.pedido_id
          GROUP BY pi.insumo_id
        ), reposicoes_internas_abertas AS (
         SELECT pii.insumo_id,
            sum(GREATEST(pii.quantidade - COALESCE(pii.quantidade_recebida, 0::numeric), 0::numeric)
                * kontrol_private.fator_item_para_estoque(pii.insumo_id, COALESCE(pii.quantidade_em, 'unidade'), pii.conteudo_embalagem)) AS quantidade
           FROM pedidos_internos_itens pii
             JOIN pedidos_internos p ON p.id = pii.pedido_interno_id
          WHERE p.origem = 'reposicao_estoque'::text AND (p.status = ANY (ARRAY['rascunho'::text, 'em_validacao'::text, 'ajuste_solicitante'::text, 'validado'::text])) AND pii.insumo_id IS NOT NULL
          GROUP BY pii.insumo_id
        ), abertos AS (
         SELECT fontes.insumo_id,
            sum(fontes.quantidade) AS qtd_pedida_aberta
           FROM ( SELECT compras_abertas.insumo_id,
                    compras_abertas.quantidade
                   FROM compras_abertas
                UNION ALL
                 SELECT reposicoes_internas_abertas.insumo_id,
                    reposicoes_internas_abertas.quantidade
                   FROM reposicoes_internas_abertas) fontes
          GROUP BY fontes.insumo_id
        ), base AS (
         SELECT s.insumo_id,
            s.especificacao,
            s.unidade,
            s.disponivel,
            s.em_maos,
            s.reservado,
            s.ponto_reposicao AS ponto_reposicao_configurado,
            s.estoque_seguranca,
            COALESCE(s.lead_time_dias, i.lead_time_dias, f.prazo_medio_dias, i.prazo_entrega_max_dias, 0) AS lead_time_dias,
            cfg.janela AS janela_dias,
            COALESCE(c.consumo_janela, 0::numeric) AS consumo_janela,
                CASE
                    WHEN cfg.janela > 0 THEN COALESCE(c.consumo_janela, 0::numeric) / cfg.janela::numeric
                    ELSE 0::numeric
                END AS consumo_medio_diario,
            COALESCE(a.qtd_pedida_aberta, 0::numeric) AS qtd_pedida_aberta,
            i.fornecedor_id,
            f.nome AS fornecedor_nome,
            i.custo_unitario,
            i.categoria_compra,
            s.modelo_quantidade,
            s.unidade_saldo
           FROM v_estoque_saldo s
             JOIN insumos i ON i.id = s.insumo_id
             LEFT JOIN fornecedores f ON f.id = i.fornecedor_id
             LEFT JOIN consumo c ON c.insumo_id = s.insumo_id
             LEFT JOIN abertos a ON a.insumo_id = s.insumo_id
             CROSS JOIN cfg
        )
 SELECT insumo_id,
    especificacao,
    unidade,
    disponivel,
    em_maos,
    reservado,
    ponto_reposicao_configurado,
    estoque_seguranca,
    lead_time_dias,
    janela_dias,
    consumo_janela,
    consumo_medio_diario,
        CASE
            WHEN consumo_janela > 0::numeric THEN disponivel / consumo_medio_diario
            ELSE NULL::numeric
        END AS dias_cobertura,
    GREATEST(ponto_reposicao_configurado, consumo_medio_diario * lead_time_dias::numeric + estoque_seguranca) AS ponto_reposicao_sugerido,
    -- Insumo contado em frascos só se compra em frascos inteiros (igual à reposição automática, 0125).
    CASE
        WHEN modelo_quantidade = 'EMBALAGEM_FECHADA'::text
          THEN ceil(GREATEST(0::numeric, consumo_medio_diario * lead_time_dias::numeric + estoque_seguranca - disponivel - qtd_pedida_aberta))
        ELSE GREATEST(0::numeric, consumo_medio_diario * lead_time_dias::numeric + estoque_seguranca - disponivel - qtd_pedida_aberta)
    END AS qtd_sugerida_compra,
    qtd_pedida_aberta,
    fornecedor_id,
    fornecedor_nome,
    custo_unitario,
    categoria_compra,
    unidade_saldo
   FROM base;

revoke all on public.v_estoque_saldo, public.v_estoque_disponivel_unidade, public.v_alertas_estoque,
  public.v_planejamento_compromissos_estoque, public.v_previsao_suprimentos from anon;
grant select on public.v_estoque_saldo, public.v_estoque_disponivel_unidade, public.v_alertas_estoque,
  public.v_planejamento_compromissos_estoque, public.v_previsao_suprimentos to authenticated, service_role;

-- =============================================================================
-- 13. EST-4: a retirada do plano usa o lote conferido na bancada
-- =============================================================================

create or replace function public.dar_baixa_plano(p_planejamento_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  l record;
  v_plano record;
  v_short jsonb := '[]'::jsonb;
  v_validade_apos_abertura date;
  v_analises text;
  v_equipamento_id bigint;
  v_claims jsonb;
  v_ator text;
  v_qtd numeric;
  v_conf record;
  v_res record;
  v_ocupado numeric;
  v_modelo_reservado text;
begin
  perform kontrol_private.exigir_permissao('planejamento.executar');

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), nullif(v_claims->>'sub', ''));

  select status_operacional, data_inicio_prevista, data_fim_prevista
    into v_plano
  from public.planejamento
  where id = p_planejamento_id
  for update;

  if not found then
    raise exception 'Planejamento nao encontrado.' using errcode = 'P0002';
  end if;
  if v_plano.status_operacional <> 'reservado' then
    raise exception 'Reserve os insumos antes de iniciar o planejamento.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.reservas_estoque
    where planejamento_id = p_planejamento_id
      and status in ('reservado', 'parcial')
  ) then
    raise exception 'O planejamento nao possui reservas ativas para a baixa.' using errcode = '22023';
  end if;

  perform id
  from public.reservas_estoque
  where planejamento_id = p_planejamento_id
    and status in ('reservado', 'parcial')
  order by id
  for update;

  for r in
    select
      lote_id,
      min(insumo_id) as insumo_id,
      sum(quantidade - coalesce(quantidade_consumida, 0)) as quantidade_pendente
    from public.reservas_estoque
    where planejamento_id = p_planejamento_id
      and status in ('reservado', 'parcial')
    group by lote_id
    order by lote_id nulls first
  loop
    if r.lote_id is null then
      v_short := v_short || jsonb_build_object(
        'insumo_id', r.insumo_id,
        'falta', r.quantidade_pendente
      );
      continue;
    end if;

    select le.*
      into l
    from public.lotes_estoque le
    where le.id = r.lote_id
    for update;

    if not found then
      v_short := v_short || jsonb_build_object(
        'insumo_id', r.insumo_id,
        'lote_id', r.lote_id,
        'falta', r.quantidade_pendente
      );
      continue;
    end if;
    if l.status not in ('aceito', 'em_uso')
       or (l.modelo_quantidade = 'EMBALAGEM_FECHADA' and l.status <> 'aceito')
       or l.quantidade_atual < r.quantidade_pendente
       or (
         public.menor_validade(l.validade, l.validade_apos_abertura) is not null
         and public.menor_validade(l.validade, l.validade_apos_abertura) < current_date
       ) then
      v_short := v_short || jsonb_build_object(
        'insumo_id', r.insumo_id,
        'lote_id', r.lote_id,
        'falta', case
          when l.status not in ('aceito', 'em_uso') then r.quantidade_pendente
          else greatest(0, r.quantidade_pendente - l.quantidade_atual)
        end
      );
    end if;
  end loop;

  if jsonb_array_length(v_short) > 0 then
    raise exception 'Nao e possivel iniciar: existem reservas sem estoque valido suficiente.'
      using errcode = '22023', detail = v_short::text;
  end if;

  for v_equipamento_id in
    select distinct ea.equipamento_id
    from public.planejamento_itens pi
    join public.equipamento_analise ea on ea.codigo_analise = pi.codigo_analise
    where pi.planejamento_id = p_planejamento_id
  loop
    if not exists (
      select 1
      from public.equipamento_reservas er
      join public.equipamento_unidades eu on eu.id = er.equipamento_unidade_id
      where er.planejamento_id = p_planejamento_id
        and er.status in ('reservado', 'em_uso')
        and eu.equipamento_id = v_equipamento_id
        and eu.ativo
        and eu.status_operacional in ('operacional', 'reservado')
        and er.data_inicio::date <= v_plano.data_inicio_prevista
        and er.data_fim::date >= v_plano.data_fim_prevista
    ) then
      raise exception 'Equipamento exigido pela analise nao possui reserva operacional valida.'
        using errcode = '23514';
    end if;
  end loop;

  -- EST-4: a retirada sai do lote conferido na bancada (última conferência
  -- de cada insumo), quando ele é do mesmo modelo, está utilizável e tem
  -- saldo livre para a reserva; senão continua o lote reservado.
  for v_conf in
    select distinct on (c.insumo_id) c.insumo_id, c.lote_id
    from public.planejamento_lote_conferencias c
    where c.planejamento_id = p_planejamento_id
    order by c.insumo_id, c.conferido_em desc, c.id desc
  loop
    for v_res in
      select re.id, re.lote_id, re.quantidade - coalesce(re.quantidade_consumida, 0) as pendente
      from public.reservas_estoque re
      where re.planejamento_id = p_planejamento_id
        and re.insumo_id = v_conf.insumo_id
        and re.status in ('reservado', 'parcial')
        and re.lote_id is not null
        and re.lote_id <> v_conf.lote_id
      order by re.id
    loop
      select le.* into l
      from public.lotes_estoque le
      where le.id = v_conf.lote_id
      for update;
      exit when not found;
      select modelo_quantidade into v_modelo_reservado
      from public.lotes_estoque where id = v_res.lote_id;
      select coalesce(sum(x.quantidade - coalesce(x.quantidade_consumida, 0)), 0) into v_ocupado
      from public.reservas_estoque x
      where x.lote_id = v_conf.lote_id and x.status in ('reservado', 'parcial');
      if l.insumo_id = v_conf.insumo_id
         and l.modelo_quantidade = v_modelo_reservado
         and ((l.modelo_quantidade = 'EMBALAGEM_FECHADA' and l.status = 'aceito')
           or (l.modelo_quantidade <> 'EMBALAGEM_FECHADA' and l.status in ('aceito', 'em_uso')))
         and (public.menor_validade(l.validade, l.validade_apos_abertura) is null
           or public.menor_validade(l.validade, l.validade_apos_abertura) >= current_date)
         and l.quantidade_atual - v_ocupado >= v_res.pendente then
        update public.reservas_estoque
           set lote_id = v_conf.lote_id,
               observacao = left(coalesce(observacao || ' | ', '')
                 || 'Retirada do lote conferido #' || v_conf.lote_id || ' (reservado antes no #' || v_res.lote_id || ')', 500)
         where id = v_res.id;
      end if;
    end loop;
  end loop;

  select string_agg(distinct codigo_analise, ', ' order by codigo_analise)
    into v_analises
  from public.planejamento_itens
  where planejamento_id = p_planejamento_id;

  for r in
    select *
    from public.reservas_estoque
    where planejamento_id = p_planejamento_id
      and status in ('reservado', 'parcial')
      and lote_id is not null
    order by insumo_id, id
  loop
    select le.*, i.validade_apos_abertura_dias
      into l
    from public.lotes_estoque le
    join public.insumos i on i.id = le.insumo_id
    where le.id = r.lote_id;

    v_qtd := r.quantidade - coalesce(r.quantidade_consumida, 0);

    if l.modelo_quantidade = 'EMBALAGEM_FECHADA' then
      -- Embalagens fechadas saem inteiras; as que ficam continuam fechadas.
      update public.lotes_estoque
         set quantidade_atual = quantidade_atual - v_qtd,
             status = case when quantidade_atual - v_qtd <= 0 then 'consumido' else 'aceito' end
       where id = r.lote_id;
    else
      v_validade_apos_abertura := case
        when l.validade_apos_abertura is not null then l.validade_apos_abertura
        when l.validade_apos_abertura_dias is not null and l.validade_apos_abertura_dias > 0
          then current_date + l.validade_apos_abertura_dias
        else null
      end;

      update public.lotes_estoque
         set quantidade_atual = quantidade_atual - v_qtd,
             status = case
               when quantidade_atual - v_qtd <= 0 then 'consumido'
               else 'em_uso'
             end,
             data_abertura = coalesce(data_abertura, current_date),
             validade_apos_abertura = coalesce(validade_apos_abertura, v_validade_apos_abertura)
       where id = r.lote_id;
    end if;

    -- O trigger fn_validar_equipamentos_na_baixa_plano revalida cada saida.
    insert into public.estoque_movimentacoes(
      insumo_id, tipo, quantidade, custo_unitario, motivo, referencia, lote_id
    ) values (
      r.insumo_id,
      'saida',
      v_qtd,
      l.custo_unitario,
      case when l.modelo_quantidade = 'EMBALAGEM_FECHADA'
        then 'baixa analise lote reservado (embalagens fechadas)'
        else 'baixa analise lote reservado'
      end,
      'plano ' || p_planejamento_id || '; analise ' || coalesce(v_analises, '-') ||
        '; reserva ' || r.id,
      r.lote_id
    );

    update public.reservas_estoque
       set quantidade_consumida = quantidade,
           status = 'consumido',
           consumido_em = now(),
           observacao = coalesce(observacao, 'Consumida por inicio do planejamento')
     where id = r.id;
  end loop;

  update public.equipamento_reservas
     set status = 'em_uso'
   where planejamento_id = p_planejamento_id
     and status = 'reservado';

  perform set_config('app.planejamento_transicao', 'permitida', true);
  update public.planejamento
     set status_operacional = 'em_execucao',
         iniciado_em = coalesce(iniciado_em, now()),
         responsavel = coalesce(responsavel, v_ator)
   where id = p_planejamento_id;

  return jsonb_build_object('shortfalls', '[]'::jsonb);
end $function$;

-- ---- Verificação final ------------------------------------------------------
do $$
begin
  if to_regprocedure('public.receber_item_pedido_compra(bigint,bigint,uuid,numeric,date,text,text)') is not null then
    raise exception '0127: assinatura antiga do recebimento ainda existe (chamada ambígua)';
  end if;
  if position('exigir_permissao' in pg_get_functiondef('public.aplicar_ajuste_inventario_contagem(bigint)'::regprocedure)) = 0 then
    raise exception '0127: ajuste de inventário sem checagem de permissão';
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid in ('public.pedidos_compra_item_recebimentos'::regclass, 'public.pedidos_internos_item_recebimentos'::regclass)
      and contype = 'f' and confdeltype = 'c'
  ) then
    raise exception '0127: livro de recebimentos ainda apaga em cascata';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'aud_pedidos_compra_itens' and not tgisinternal) then
    raise exception '0127: itens de compra sem auditoria';
  end if;
end $$;

commit;
