-- Exclusão definitiva por privilégio, não por função (pedido do dono em
-- 2026-11-06: "deletar deveria ser para qualquer um que tenha a função de
-- entrar e realizar aquela função").
--
-- 1. excluir_insumo_em_cascata (0145) exigia a chave interna
--    'insumos.excluir_em_cascata', que não aparece na matriz de Privilégios;
--    na prática só o administrador apagava. Passa a exigir "Editar insumos"
--    (insumos.editar), a mesma caixinha que já libera criar, editar e excluir
--    insumos. A chave antiga continua valendo para quem a recebeu.
-- 2. Nova excluir_lote_estoque: apaga um lote lançado por engano junto com as
--    movimentações, reservas, contagens, conferências e códigos dele. Exige
--    "Corrigir estoque" (estoque.lote.gerir), a mesma caixinha do estorno.
--    Lote que veio de compra ou pedido interno precisa ser estornado antes,
--    para a compra voltar a esperar o material; depois do estorno pode ser
--    apagado. O motivo fica na auditoria (justificativa).
--
-- Sem bypass de RLS fora das próprias funções (security definer com
-- search_path vazio); os gatilhos de auditoria registram cada linha apagada.
-- Rollback: reaplicar a função da 0145 e
--   drop function public.excluir_lote_estoque(bigint, text);
begin;
set local lock_timeout = '10s';

create or replace function public.excluir_insumo_em_cascata(p_insumo_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_nome text;
  v_lotes bigint[];
  v_itens_compra bigint[];
  v_itens_internos bigint[];
  v_resumo jsonb := '{}'::jsonb;
  v_n bigint;
begin
  -- 0147: quem pode editar insumos pode excluí-los com o histórico
  -- (Governança → Privilégios → Editar insumos). Admin sempre.
  if not (kontrol_private.tem_permissao_efetiva('insumos.editar')
          or kontrol_private.tem_permissao_efetiva('insumos.excluir_em_cascata')) then
    raise exception 'Sem permissão para excluir este insumo com o histórico. É preciso ter "Editar insumos" (Governança → Privilégios).'
      using errcode = '42501';
  end if;

  select i.especificacao into v_nome from public.insumos i where i.id = p_insumo_id for update;
  if not found then
    raise exception 'Insumo não encontrado.' using errcode = 'P0002';
  end if;

  v_lotes := array(select l.id from public.lotes_estoque l where l.insumo_id = p_insumo_id);
  v_itens_compra := array(select c.id from public.pedidos_compra_itens c where c.insumo_id = p_insumo_id);
  v_itens_internos := array(select p.id from public.pedidos_internos_itens p where p.insumo_id = p_insumo_id);

  delete from public.planejamento_lote_conferencias
   where insumo_id = p_insumo_id or lote_id = any(v_lotes);
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('planejamento_lote_conferencias', v_n);

  delete from public.inventario_contagens
   where insumo_id = p_insumo_id or lote_id = any(v_lotes);
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('inventario_contagens', v_n);

  delete from public.pedidos_compra_item_recebimentos
   where insumo_id = p_insumo_id or lote_id = any(v_lotes)
      or pedido_compra_item_id = any(v_itens_compra)
      or pedido_interno_item_id = any(v_itens_internos);
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('pedidos_compra_item_recebimentos', v_n);

  delete from public.pedidos_internos_item_recebimentos
   where insumo_id = p_insumo_id or lote_id = any(v_lotes)
      or pedido_compra_item_id = any(v_itens_compra)
      or pedido_interno_item_id = any(v_itens_internos);
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('pedidos_internos_item_recebimentos', v_n);

  -- proteger_item_compra recusa apagar item com recebimento: os recebimentos
  -- já saíram acima; limpa os campos de chegada do próprio item antes.
  update public.pedidos_compra_itens
     set lote_id = null, quantidade_recebida = null
   where id = any(v_itens_compra)
     and (lote_id is not null or quantidade_recebida is not null);
  delete from public.pedidos_compra_itens where id = any(v_itens_compra);
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('pedidos_compra_itens', v_n);

  delete from public.pedidos_internos_itens where id = any(v_itens_internos);
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('pedidos_internos_itens', v_n);

  delete from public.reservas_estoque
   where insumo_id = p_insumo_id or lote_id = any(v_lotes);
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('reservas_estoque', v_n);

  delete from public.estoque_movimentacoes
   where insumo_id = p_insumo_id or lote_id = any(v_lotes);
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('estoque_movimentacoes', v_n);

  delete from public.insumo_analise where insumo_id = p_insumo_id;
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('insumo_analise', v_n);

  delete from public.scan_eventos
   where (entidade_tipo = 'insumo' and entidade_id = p_insumo_id)
      or (entidade_tipo = 'lote' and entidade_id = any(v_lotes));
  delete from public.identificadores
   where (entidade_tipo = 'insumo' and entidade_id = p_insumo_id)
      or (entidade_tipo = 'lote' and entidade_id = any(v_lotes));
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('identificadores', v_n);

  delete from public.lotes_estoque where insumo_id = p_insumo_id;
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('lotes_estoque', v_n);

  delete from public.insumos where id = p_insumo_id;

  return jsonb_build_object('insumo_id', p_insumo_id, 'nome', v_nome, 'removidos', v_resumo);
end $$;


create function public.excluir_lote_estoque(p_lote_id bigint, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_lote record;
  v_resumo jsonb := '{}'::jsonb;
  v_n bigint;
begin
  if not kontrol_private.tem_permissao_efetiva('estoque.lote.gerir') then
    raise exception 'Sem permissão para excluir lotes. É preciso ter "Corrigir estoque" (Governança → Privilégios).'
      using errcode = '42501';
  end if;
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'Informe o motivo da exclusão.' using errcode = '22023';
  end if;

  select l.id, l.insumo_id, l.codigo_lote into v_lote
  from public.lotes_estoque l where l.id = p_lote_id for update;
  if not found then
    raise exception 'Lote não encontrado.' using errcode = 'P0002';
  end if;

  -- Recebimento ainda valendo: estornar primeiro, para a compra ou o pedido
  -- voltar a esperar o material. Depois do estorno o lote pode ser apagado.
  if exists (select 1 from public.pedidos_compra_item_recebimentos r
             where r.lote_id = p_lote_id and r.estornado_em is null)
     or exists (select 1 from public.pedidos_internos_item_recebimentos r
                where r.lote_id = p_lote_id and r.estornado_em is null) then
    raise exception 'Este lote veio do recebimento de uma compra ou pedido interno. Use "Estornar recebimento" primeiro; depois o lote pode ser excluído.'
      using errcode = '22023';
  end if;

  delete from public.planejamento_lote_conferencias where lote_id = p_lote_id;
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('planejamento_lote_conferencias', v_n);

  delete from public.inventario_contagens where lote_id = p_lote_id;
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('inventario_contagens', v_n);

  -- Só recebimentos já estornados chegam aqui (checado acima).
  delete from public.pedidos_compra_item_recebimentos where lote_id = p_lote_id;
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('pedidos_compra_item_recebimentos', v_n);

  delete from public.pedidos_internos_item_recebimentos where lote_id = p_lote_id;
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('pedidos_internos_item_recebimentos', v_n);

  delete from public.reservas_estoque where lote_id = p_lote_id;
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('reservas_estoque', v_n);

  delete from public.estoque_movimentacoes where lote_id = p_lote_id;
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('estoque_movimentacoes', v_n);

  delete from public.scan_eventos where entidade_tipo = 'lote' and entidade_id = p_lote_id;
  delete from public.identificadores where entidade_tipo = 'lote' and entidade_id = p_lote_id;
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object('identificadores', v_n);

  -- Itens de compra/pedido que ainda apontam para o lote ficam sem ele
  -- (ON DELETE SET NULL das FKs).
  delete from public.lotes_estoque where id = p_lote_id;

  update public.auditoria a
     set justificativa = v_motivo
   where a.tabela = 'lotes_estoque' and a.registro_id = p_lote_id::text
     and a.acao = 'delete' and a.criado_em = now();

  return jsonb_build_object('lote_id', p_lote_id, 'insumo_id', v_lote.insumo_id,
    'codigo_lote', v_lote.codigo_lote, 'removidos', v_resumo);
end $$;

revoke all on function public.excluir_lote_estoque(bigint, text) from public, anon;
grant execute on function public.excluir_lote_estoque(bigint, text) to authenticated;

commit;
