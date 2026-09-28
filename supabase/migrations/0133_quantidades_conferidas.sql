-- 0133 — quantidades conferidas no banco (auditoria de 27/09/2026, item 5).
--
-- 1. criar_pedido_faltas_planejamento: a lista de faltas vem do app, que a
--    calcula no servidor, mas a função também é chamável direto. Agora ela
--    recusa insumo que não pertence às análises do planejamento e quantidade
--    acima de um teto folgado da demanda do plano (o cálculo exato continua no
--    motor de custeio do app; o teto só barra o que é impossível).
-- 2. formalizar_pedido_interno: com a compra ainda "solicitada", um ajuste só
--    de embalagem no item (frascos x unidade, ou volume do frasco) não chegava
--    à compra, porque a comparação olhava só insumo, quantidade e custo.
--
-- Só recria as duas funções (mesma assinatura; permissões preservadas).
-- Rollback: recriar as duas funções como estão na 0131.

begin;

CREATE OR REPLACE FUNCTION public.criar_pedido_faltas_planejamento(p_planejamento_id bigint, p_itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
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
  v_teto numeric;
  v_no_plano boolean;
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

    -- 0133: a quantidade enviada não é aceita às cegas. O insumo precisa estar
    -- nas análises do plano, e o pedido não passa de um teto folgado da
    -- demanda: todas as opções de grupo somadas, cada amostra contando como
    -- uma execução, em unidade de estoque, mais uma compra mínima e uma
    -- embalagem de arredondamento. Pedido legítimo nunca chega ao teto.
    select coalesce(sum(coalesce(ia.quantidade_por_amostra, 0)
                        * ceil((coalesce(pi.n_amostras, 0) + coalesce(pi.n_controles, 0))
                               * greatest(coalesce(nullif(pi.repeticoes, 0), 1), 1)
                               * (1 + coalesce(pi.perda_percentual, 0) / 100.0))), 0),
           count(*) > 0
      into v_teto, v_no_plano
      from planejamento_itens pi
      join insumo_analise ia on ia.codigo_analise = pi.codigo_analise and ia.insumo_id = v_insumo_id
     where pi.planejamento_id = p_planejamento_id;
    if not v_no_plano then
      raise exception 'O insumo #% não faz parte das análises do planejamento #%.', v_insumo_id, p_planejamento_id
        using errcode = '22023';
    end if;
    select v_teto / coalesce(nullif(i.fator_conversao, 0), 1)
           + coalesce(i.quantidade_minima_compra, 0)
           + greatest(coalesce(i.quantidade_embalagem, 0), coalesce(v_conteudo, 0))
      into v_teto
      from insumos i
     where i.id = v_insumo_id;
    if v_pedido_fisico > coalesce(v_teto, 0) * 1.000001 + 0.000001 then
      raise exception 'A quantidade pedida do insumo #% (%) passa da necessidade do planejamento #% (até %).',
        v_insumo_id, round(v_pedido_fisico, 4), p_planejamento_id, round(coalesce(v_teto, 0), 4)
        using errcode = '22023';
    end if;

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

CREATE OR REPLACE FUNCTION public.formalizar_pedido_interno(p_pedido_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pedido record;
  v_compra record;
  v_compra_id bigint;
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
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
         -- 0133: mudança só de embalagem (tipo ou conteúdo) também acompanha
         and (ci.insumo_id, ci.quantidade, ci.custo_unitario_estimado, ci.quantidade_em, ci.conteudo_embalagem)
             is distinct from (pii.insumo_id, pii.quantidade, pii.orcamento_previo,
                               coalesce(pii.quantidade_em, ci.quantidade_em),
                               coalesce(pii.conteudo_embalagem, ci.conteudo_embalagem));
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

commit;
