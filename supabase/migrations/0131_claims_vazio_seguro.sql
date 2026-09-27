-- Claims JWT vazios em sessoes reutilizadas (2026-09-27).
--
-- O que muda e por que: depois de SET LOCAL request.jwt.claims e COMMIT, uma
-- sessao reutilizada pode devolver '' em current_setting. O cast direto para
-- jsonb falhava antes de validar a operacao. Dez funcoes passam a tratar ''
-- como ausencia de claims, mantendo o email nulo quando nao foi informado.
--
-- Definicoes completas obtidas por pg_get_functiondef do banco local na 0130
-- e conferidas contra o main. Preserva assinaturas, defaults, SECURITY
-- DEFINER/INVOKER, search_path, checagens de permissao e regras de negocio.
-- Nao altera tabelas, dados, RLS, grants ou gatilhos; nao usa remendo dinamico.
--
-- Rollback: reaplicar as dez definicoes completas exportadas antes da 0131.
-- Fontes equivalentes: aceitar_lote, criar_pedido_faltas_planejamento,
-- formalizar_pedido_interno e registrar_etapa_pedido_interno da 0127;
-- criar_pedido_reposicao_estoque da 0125; preencher_reservado_por_planejamento
-- da 0098; transicionar_orcamento/projeto da 0090 com permissoes da 0121/0124;
-- transicionar_pedido_interno da 0087 e validar_planejamento_executivo da 0082,
-- preservando em ambas as permissoes da 0124. Nenhum dado requer reversao.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.aceitar_lote(p_lote_id bigint, p_responsavel text DEFAULT NULL::text, p_criterio text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
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

CREATE OR REPLACE FUNCTION public.criar_pedido_reposicao_estoque(p_titulo text, p_justificativa text, p_urgencia text, p_data_necessidade date, p_itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
  v_insumo_id bigint;
  v_pedido_id bigint;
  v_quantidade_itens integer;
begin
  perform kontrol_private.exigir_permissao('pedido.criar');

  if nullif(btrim(coalesce(p_titulo, '')), '') is null
     or nullif(btrim(coalesce(p_justificativa, '')), '') is null then
    raise exception 'Título e justificativa são obrigatórios para a reposição.'
      using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_itens, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) = 0 then
    raise exception 'Informe ao menos um insumo para reposição.'
      using errcode = '22023';
  end if;

  -- Serializa pedidos concorrentes dos mesmos insumos. A view é consultada
  -- novamente depois dos locks, impedindo dois rascunhos para a mesma falta.
  for v_insumo_id in
    select distinct (item->>'insumo_id')::bigint
      from jsonb_array_elements(p_itens) item
     where nullif(item->>'insumo_id', '') is not null
     order by 1
  loop
    perform pg_advisory_xact_lock(8100000000000000 + v_insumo_id);
  end loop;

  insert into pedidos_internos(
    titulo,
    status,
    solicitante,
    tipo_demanda,
    origem,
    urgencia,
    data_necessidade,
    fonte_recurso,
    justificativa
  ) values (
    btrim(p_titulo),
    'rascunho',
    v_email,
    'laboratorio',
    'reposicao_estoque',
    case when p_urgencia = 'alta' then 'alta' else 'normal' end,
    p_data_necessidade,
    'A definir pelo projeto',
    btrim(p_justificativa)
  )
  returning id into v_pedido_id;

  insert into pedidos_internos_itens(
    pedido_interno_id,
    tipo,
    insumo_id,
    especificacao,
    quantidade,
    unidade,
    orcamento_previo,
    fornecedor_sugerido,
    observacao
  )
  select
    v_pedido_id,
    'material',
    previsao.insumo_id,
    coalesce(previsao.especificacao, 'Insumo #' || previsao.insumo_id),
    -- Insumo contado em frascos: pedido só em frascos inteiros.
    case
      when kontrol_private.modelo_quantidade_insumo(previsao.insumo_id) = 'EMBALAGEM_FECHADA'
        then ceil(least((item->>'quantidade')::numeric, previsao.qtd_sugerida_compra))
      else least((item->>'quantidade')::numeric, previsao.qtd_sugerida_compra)
    end,
    previsao.unidade,
    previsao.custo_unitario,
    previsao.fornecedor_nome,
    'Reposição sugerida pelo Controle de Estoque. Disponível: '
      || coalesce(previsao.disponivel, 0) || ' ' || coalesce(previsao.unidade, '')
      || '; ponto sugerido: ' || coalesce(previsao.ponto_reposicao_sugerido, 0)
      || ' ' || coalesce(previsao.unidade, '') || '.'
  from jsonb_array_elements(p_itens) item
  join public.v_previsao_suprimentos previsao
    on previsao.insumo_id = (item->>'insumo_id')::bigint
  where (item->>'quantidade')::numeric > 0
    and previsao.qtd_sugerida_compra > 0;
  get diagnostics v_quantidade_itens = row_count;

  if v_quantidade_itens = 0 then
    raise exception 'A necessidade já foi coberta por estoque ou pedido em aberto.'
      using errcode = '22023';
  end if;

  insert into eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
  values (
    'pedido_interno',
    v_pedido_id,
    null,
    'rascunho',
    v_email,
    'Pedido de reposição gerado pelo Controle de Estoque.'
  );

  return jsonb_build_object('pedido_id', v_pedido_id, 'itens', v_quantidade_itens);
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

CREATE OR REPLACE FUNCTION public.preencher_reservado_por_planejamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status_operacional = 'reservado'
     and new.status_operacional is distinct from old.status_operacional then
    new.reservado_por := coalesce(
      new.reservado_por,
      nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email'
    );
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.registrar_etapa_pedido_interno(p_pedido_id bigint, p_status_destino text, p_etapa text, p_decisao text, p_observacao text DEFAULT NULL::text, p_dados jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
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

CREATE OR REPLACE FUNCTION public.transicionar_orcamento(p_orcamento_id bigint, p_status_destino text, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_atual text;
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
begin
  perform kontrol_private.exigir_permissao(case when p_status_destino = 'cancelado' then 'orcamentos.cancelar' else 'orcamentos.emitir' end);

  select status into v_atual from orcamentos where id = p_orcamento_id for update;
  if not found then
    raise exception 'Orçamento não encontrado.' using errcode = 'P0002';
  end if;
  if v_atual = p_status_destino then
    return jsonb_build_object('status_origem', v_atual, 'status_destino', p_status_destino, 'alterado', false);
  end if;
  if not (
    (v_atual = 'rascunho' and p_status_destino in ('enviado', 'cancelado')) or
    (v_atual = 'enviado' and p_status_destino in ('aprovado', 'recusado', 'cancelado')) or
    (v_atual = 'recusado' and p_status_destino in ('rascunho', 'cancelado')) or
    (v_atual = 'aprovado' and p_status_destino = 'cancelado')
  ) then
    raise exception 'Transição de status não permitida: % -> %.', v_atual, p_status_destino
      using errcode = '22023';
  end if;

  perform set_config('app.orcamento_transicao', 'permitida', true);
  update orcamentos set status = p_status_destino where id = p_orcamento_id;
  insert into eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('orcamento', p_orcamento_id, v_atual, p_status_destino, v_email, p_observacao);

  return jsonb_build_object('status_origem', v_atual, 'status_destino', p_status_destino, 'alterado', true);
end $function$;

CREATE OR REPLACE FUNCTION public.transicionar_orcamento_projeto(p_orcamento_projeto_id bigint, p_status_destino text, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_atual text;
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
begin
  perform kontrol_private.exigir_permissao(case when p_status_destino = 'cancelado' then 'orcamentos.cancelar' else 'orcamentos.emitir' end);

  select status into v_atual from orcamento_projetos where id = p_orcamento_projeto_id for update;
  if not found then
    raise exception 'Orçamento de projeto não encontrado.' using errcode = 'P0002';
  end if;
  if v_atual = p_status_destino then
    return jsonb_build_object('status_origem', v_atual, 'status_destino', p_status_destino, 'alterado', false);
  end if;
  if not (
    (v_atual = 'rascunho' and p_status_destino in ('enviado', 'cancelado')) or
    (v_atual = 'enviado' and p_status_destino in ('aprovado', 'recusado', 'cancelado')) or
    (v_atual = 'recusado' and p_status_destino in ('rascunho', 'cancelado')) or
    (v_atual = 'aprovado' and p_status_destino = 'cancelado')
  ) then
    raise exception 'Transição de status não permitida: % -> %.', v_atual, p_status_destino
      using errcode = '22023';
  end if;

  perform set_config('app.orcamento_projeto_transicao', 'permitida', true);
  update orcamento_projetos set status = p_status_destino where id = p_orcamento_projeto_id;
  insert into eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('orcamento_projeto', p_orcamento_projeto_id, v_atual, p_status_destino, v_email, p_observacao);

  return jsonb_build_object('status_origem', v_atual, 'status_destino', p_status_destino, 'alterado', true);
end $function$;

CREATE OR REPLACE FUNCTION public.transicionar_pedido_interno(p_pedido_id bigint, p_status_destino text, p_etapa text, p_decisao text, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status_origem text;
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
begin
  if p_status_destino = 'em_validacao' then
    perform kontrol_private.exigir_permissao('pedido.criar');
  else
    perform kontrol_private.exigir_permissao('pedido.aprovar');
  end if;

  if p_decisao not in ('aprovado', 'reprovado', 'devolvido', 'registrado') then
    raise exception 'Decisao de aprovacao invalida.' using errcode = '22023';
  end if;

  select status
    into v_status_origem
  from pedidos_internos
  where id = p_pedido_id
  for update;

  if not found then
    raise exception 'Pedido interno nao encontrado.' using errcode = 'P0002';
  end if;

  if not (
    (v_status_origem in ('rascunho', 'ajuste_solicitante', 'ajuste_compras') and p_status_destino = 'em_validacao')
    or (v_status_origem = 'em_validacao' and p_status_destino in ('validado', 'ajuste_solicitante'))
    or (v_status_origem = 'validado' and p_status_destino = 'formalizado')
    or (v_status_origem = 'formalizado' and p_status_destino = 'analise_administrativa')
    or (v_status_origem = 'analise_administrativa' and p_status_destino in ('aprovado_compra', 'ajuste_compras'))
    or (v_status_origem = 'aprovado_compra' and p_status_destino = 'orcamentos')
    or (v_status_origem = 'orcamentos' and p_status_destino = 'orcamentos_recebidos')
    or (v_status_origem = 'orcamentos_recebidos' and p_status_destino = 'aguardando_aprovacao_final')
    or (v_status_origem = 'aguardando_aprovacao_final' and p_status_destino = 'aprovado_para_compra')
    or (v_status_origem = 'aprovado_para_compra' and p_status_destino in ('compra_fechada', 'encaminhado_instituicao'))
    or (v_status_origem in ('compra_fechada', 'encaminhado_instituicao') and p_status_destino = 'aguardando_pagamento_nf')
    or (v_status_origem = 'aguardando_pagamento_nf' and p_status_destino = 'compra_concluida')
  ) then
    raise exception 'Transicao de status nao permitida: % -> %.', v_status_origem, p_status_destino
      using errcode = '22023';
  end if;

  perform set_config('app.pedido_interno_transicao', 'permitida', true);

  update pedidos_internos
     set status = p_status_destino
   where id = p_pedido_id;

  insert into pedidos_internos_aprovacoes(
    pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino
  )
  values (
    p_pedido_id,
    coalesce(nullif(btrim(p_etapa), ''), p_status_destino),
    p_decisao,
    v_email,
    current_papel(),
    nullif(btrim(p_observacao), ''),
    v_status_origem,
    p_status_destino
  );

  insert into eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('pedido_interno', p_pedido_id, v_status_origem, p_status_destino, v_email, nullif(btrim(p_observacao), ''));

  return jsonb_build_object('status_origem', v_status_origem, 'status_destino', p_status_destino);
end $function$;

CREATE OR REPLACE FUNCTION public.validar_planejamento_executivo(p_planejamento_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plano record;
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
begin
  perform kontrol_private.exigir_permissao('planejamento.executar');

  select id, projeto_id, data_inicio_prevista, data_fim_prevista, status_operacional
    into v_plano
  from planejamento
  where id = p_planejamento_id
  for update;

  if not found then
    raise exception 'Planejamento nao encontrado.' using errcode = 'P0002';
  end if;
  if v_plano.status_operacional not in ('rascunho','reservado') then
    raise exception 'Status do planejamento nao permite validacao operacional.' using errcode = '22023';
  end if;
  if v_plano.projeto_id is null then
    raise exception 'Informe o projeto do planejamento antes de reservar.' using errcode = '22023';
  end if;
  if v_plano.data_inicio_prevista is null or v_plano.data_fim_prevista is null then
    raise exception 'Informe o periodo previsto de execucao antes de reservar.' using errcode = '22023';
  end if;

  update planejamento
     set validado_em = coalesce(validado_em, now()),
         validado_por = coalesce(validado_por, v_email)
   where id = p_planejamento_id;
end $function$;

commit;
