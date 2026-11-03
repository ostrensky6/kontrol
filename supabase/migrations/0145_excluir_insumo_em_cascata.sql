-- Exclusão definitiva de insumo com todo o histórico ligado a ele (pedido do
-- dono em 03/11/2026). A exclusão simples continua protegida pela 0144; esta
-- RPC é o caminho explícito, confirmado na tela, para apagar em cascata.
-- Sem bypass: apaga os filhos na ordem que satisfaz as FKs e as guardas
-- existentes; o gatilho da 0144 então encontra zero vínculos. Os gatilhos de
-- auditoria (fn_auditoria) continuam registrando cada linha removida.
begin;
set local lock_timeout = '10s';

create function public.excluir_insumo_em_cascata(p_insumo_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_nome text;
  v_lotes bigint[];
  v_itens_compra bigint[];
  v_itens_internos bigint[];
  v_resumo jsonb := '{}'::jsonb;
  v_n bigint;
begin
  -- Admin sempre; outros papéis só com a chave concedida explicitamente.
  if not kontrol_private.tem_permissao_efetiva('insumos.excluir_em_cascata') then
    raise exception 'Somente administradores podem excluir um insumo junto com o histórico.'
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

revoke all on function public.excluir_insumo_em_cascata(bigint) from public, anon;
grant execute on function public.excluir_insumo_em_cascata(bigint) to authenticated;

commit;
