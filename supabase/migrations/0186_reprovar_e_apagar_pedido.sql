-- 0186 — Reprovar encerra o pedido; apagar pedido em qualquer etapa.
--
-- Pedido de Antonio em 27/11/2026 (thread "Corrigir bugs e ajustes de 27/11",
-- 18:05 UTC), depois do quadro de aprovações:
--   * "Reprovar encerra o pedido." Devolver ao solicitante continua existindo
--     (amarelo no quadro: corrige e reenvia, sem recomeçar). Reprovado
--     (vermelho) fecha o pedido e avisa o solicitante.
--   * "Dentro dos pedidos a gente tem que ter um botão de apagar [...] ao longo
--     de todo o processo. Depois nós vamos ver até que ponto não pode mais
--     apagar."
--
-- O que muda:
--   1. public.reprovar_pedido_interno(pedido, motivo): quem decide a etapa em
--      que o pedido está (coordenador do projeto em "em_validacao"; coordenação
--      do laboratório no "validado" que espera o laboratório; administrativo,
--      com "Aprovar pedidos", em "formalizado" e "analise_administrativa")
--      reprova com motivo obrigatório. O pedido vai para "cancelado", a compra
--      ligada (se já existir) é cancelada junto, a decisão fica gravada com o
--      nome da etapa e "reprovado", e o aviso de cancelamento que o solicitante
--      já recebia passa a dizer quem reprovou e o motivo. Como substitutos, o
--      Administrador e quem tem "Conduzir a compra inteira" (0184).
--   2. public.excluir_pedido_interno(pedido, motivo): quem tem "Aprovar
--      pedidos" (a mesma caixinha que já excluía rascunhos) apaga o pedido em
--      qualquer etapa, com a compra ligada, os itens, documentos, orçamentos,
--      aprovações e avisos dele. Fica um registro em eventos_status ("excluido",
--      com título e motivo) e a auditoria (fn_auditoria) guarda as linhas
--      apagadas. Única trava: se já houve chegada de material no estoque, o
--      pedido não é apagado (o histórico do estoque depende dele); para esses,
--      Cancelar continua valendo. A função devolve os arquivos do Storage, que
--      o app remove depois.
--
-- Só acrescenta duas funções. Não apaga coluna, tabela, RLS nem trigger de
-- auditoria; não muda nenhuma função existente nem permissão.
--
-- Rollback:
--   drop function public.reprovar_pedido_interno(bigint, text);
--   drop function public.excluir_pedido_interno(bigint, text);
-- (pedidos apagados só voltam pelo backup feito antes da aplicação ou pelas
-- linhas guardadas na auditoria)

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('kontrol_private.conduz_compra()') is null then
    raise exception '0186: requer a migration 0184';
  end if;
  if to_regprocedure('kontrol_private.aprovadores_pedido(bigint,text,bigint)') is null then
    raise exception '0186: requer a migration 0169';
  end if;
end $$;

-- ---- 1. Reprovar: encerra o pedido na etapa de aprovação em que ele está ----------------
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
         pi.pedido_compra_id, pi.titulo
    into v_p
    from public.pedidos_internos pi
   where pi.id = p_pedido_id
   for update;
  if not found then
    raise exception 'Pedido interno não encontrado.' using errcode = 'P0002';
  end if;

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

comment on function public.reprovar_pedido_interno(bigint, text) is
  '0186: reprova (encerra) o pedido na etapa de aprovação em que ele está, com motivo; cancela a compra ligada e avisa o solicitante.';

revoke all on function public.reprovar_pedido_interno(bigint, text) from public, anon;
grant execute on function public.reprovar_pedido_interno(bigint, text) to authenticated;

-- ---- 2. Apagar: o pedido sai inteiro, com a compra ligada --------------------------------
create or replace function public.excluir_pedido_interno(p_pedido_id bigint, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text;
  v_p record;
  v_arquivos jsonb;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  perform kontrol_private.exigir_permissao('pedido.aprovar');
  begin
    v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_email := null;
  end;
  if auth.uid() is null then
    raise exception 'Entre no Kontrol para apagar o pedido.' using errcode = '42501';
  end if;

  select pi.id, pi.status, pi.titulo, pi.pedido_compra_id, pi.recebido_em
    into v_p
    from public.pedidos_internos pi
   where pi.id = p_pedido_id
   for update;
  if not found then
    raise exception 'Pedido interno não encontrado. Atualize a lista: ele pode já ter sido apagado.' using errcode = 'P0002';
  end if;

  -- a única trava: material que já chegou no estoque (o histórico do estoque depende do pedido)
  if v_p.recebido_em is not null
     or exists (select 1 from public.pedidos_internos_itens i
                 where i.pedido_interno_id = p_pedido_id and i.recebido_em is not null)
     or exists (select 1 from public.pedidos_internos_item_recebimentos r where r.pedido_interno_id = p_pedido_id)
     or (v_p.pedido_compra_id is not null and (
           exists (select 1 from public.pedidos_compra_item_recebimentos r where r.pedido_compra_id = v_p.pedido_compra_id)
           or exists (select 1 from public.pedidos_compra_itens i
                       where i.pedido_id = v_p.pedido_compra_id
                         and (i.lote_id is not null or coalesce(i.quantidade_recebida, 0) > 0)))) then
    raise exception 'Já chegou material deste pedido no estoque, e o histórico do estoque depende dele. Ele não pode ser apagado: use Cancelar.'
      using errcode = '22023';
  end if;

  if v_p.pedido_compra_id is not null and (
       exists (select 1 from public.pedidos_compra pc where pc.compra_origem_id = v_p.pedido_compra_id)
       or exists (select 1 from public.pedidos_compra_itens i where i.compra_pendencia_id = v_p.pedido_compra_id)) then
    raise exception 'A compra deste pedido gerou outra compra de pendência. Apague ou cancele aquela compra antes.'
      using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('bucket', a.storage_bucket, 'path', a.storage_path))
                    filter (where a.storage_bucket is not null and a.storage_path is not null), '[]'::jsonb)
    into v_arquivos
    from public.pedidos_internos_anexos a
   where a.pedido_interno_id = p_pedido_id;

  insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('pedido_interno', p_pedido_id, v_p.status, 'excluido', v_email,
          format('Pedido apagado: %s.%s', coalesce(v_p.titulo, 'sem título'),
                 coalesce(' Motivo: ' || v_motivo, '')));

  -- itens, documentos, orçamentos, aprovações e mensagens saem em cascata
  delete from public.pedidos_internos where id = p_pedido_id;
  if v_p.pedido_compra_id is not null then
    delete from public.pedidos_compra where id = v_p.pedido_compra_id;
  end if;
  -- avisos que apontavam para o pedido levariam a uma página que não existe mais
  delete from public.notificacoes
   where entidade_tipo = 'pedido_interno' and entidade_id = p_pedido_id;

  return jsonb_build_object('pedido_id', p_pedido_id, 'pedido_compra_id', v_p.pedido_compra_id,
                            'status_origem', v_p.status, 'arquivos', v_arquivos);
end $function$;

comment on function public.excluir_pedido_interno(bigint, text) is
  '0186: apaga o pedido em qualquer etapa (com a compra ligada), menos quando já chegou material no estoque; registra em eventos_status.';

revoke all on function public.excluir_pedido_interno(bigint, text) from public, anon;
grant execute on function public.excluir_pedido_interno(bigint, text) to authenticated;

commit;
