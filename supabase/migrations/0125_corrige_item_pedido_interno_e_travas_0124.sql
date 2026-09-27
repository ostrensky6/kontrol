-- Correção urgente (auditoria de 2026-09-26, terceira rodada; autorizada pelo dono).
--
-- 1. EST2-1 (P0): o gatilho kontrol_private.preencher_unidade_item (0123) lê
--    new.pedido_interno_item_id também na tabela pedidos_internos_itens, que não
--    tem essa coluna. Todo INSERT de item de pedido interno com insumo (e todo
--    UPDATE de insumo_id) falhava com 'record "new" has no field ...'. Isso
--    travava: vincular insumo, "Comprar faltas", reposição pelo Controle de
--    Estoque, formalização e recebimento de itens vindos de pedido interno.
--    Corrigido lendo a coluna só na tabela de itens de compra, via jsonb.
--
-- 2. PER2-1 (P1): a 0124 tentou inserir a checagem de permissão em
--    gerar_reposicao_automatica e resolver_triagem_criando_insumo trocando o
--    texto '\nbegin\n'. Os arquivos foram aplicados com quebra de linha CRLF,
--    o texto não casou e as duas funções ficaram sem checagem (confirmado no
--    banco local e na produção). Agora as funções são recriadas por inteiro,
--    e um bloco final recusa a migration se a checagem não estiver presente.
--    A reposição automática também deixa de ser executável por anon/public
--    (o cron usa service_role ou o dono do banco).
--
-- 3. EST2-2 (P1): a sugestão de compra para insumo contado em frascos saía
--    fracionária (ex.: 1,56 frasco), e o recebimento só aceita frascos
--    inteiros, deixando um resto impossível de receber. A quantidade passa a
--    ser arredondada para cima em frascos inteiros.
--
-- Não remove tabelas, colunas, dados, RLS nem gatilhos de auditoria.
-- Rollback: reaplicar as definições destas quatro funções da 0123/0098/0031/0063
-- (pg_get_functiondef guardado no backup lógico prévio). Nenhum dado é alterado.

begin;

-- ---- 1. Gatilho de unidade do item -----------------------------------------
create or replace function kontrol_private.preencher_unidade_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origem record;
  v_item_origem bigint;
begin
  if new.insumo_id is null then
    return new;
  end if;
  if new.quantidade_em is null and tg_table_name = 'pedidos_compra_itens' then
    -- Lido via jsonb: pedidos_internos_itens não tem esta coluna, e o PL/pgSQL
    -- resolve new.<campo> antes de avaliar o restante da condição.
    v_item_origem := nullif(to_jsonb(new) ->> 'pedido_interno_item_id', '')::bigint;
    if v_item_origem is not null then
      select quantidade_em, conteudo_embalagem into v_origem
      from public.pedidos_internos_itens where id = v_item_origem;
      new.quantidade_em := v_origem.quantidade_em;
      new.conteudo_embalagem := coalesce(new.conteudo_embalagem, v_origem.conteudo_embalagem);
    end if;
  end if;
  if new.quantidade_em is null then
    new.quantidade_em := case
      when kontrol_private.modelo_quantidade_insumo(new.insumo_id) = 'EMBALAGEM_FECHADA' then 'embalagem'
      else 'unidade'
    end;
  end if;
  if new.conteudo_embalagem is null then
    select nullif(quantidade_embalagem, 0) into new.conteudo_embalagem
    from public.insumos where id = new.insumo_id;
  end if;
  return new;
end $$;

revoke all on function kontrol_private.preencher_unidade_item() from public, anon, authenticated, service_role;

-- ---- 2 e 3. Reposição automática -------------------------------------------
create or replace function public.gerar_reposicao_automatica()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_pedido_id bigint;
  v_criados int := 0;
  v_itens int := 0;
  v_notificacoes int := 0;
  v_linhas int := 0;
begin
  -- Usuário logado precisa da permissão; o cron roda sem sessão de usuário.
  if auth.uid() is not null then
    perform kontrol_private.exigir_permissao('compras.solicitar');
  end if;

  for r in
    select *
    from v_previsao_suprimentos
    where qtd_sugerida_compra > 0
      and qtd_pedida_aberta <= 0
      and disponivel <= ponto_reposicao_sugerido
    order by fornecedor_id nulls last, categoria_compra, especificacao
  loop
    select p.id into v_pedido_id
    from pedidos_compra p
    where p.status = 'solicitado'
      and p.fornecedor_id is not distinct from r.fornecedor_id
      and p.observacao = 'Rascunho automatico de reposicao'
    order by p.id desc
    limit 1;

    if v_pedido_id is null then
      insert into pedidos_compra(fornecedor_id, status, solicitante, observacao)
      values (r.fornecedor_id, 'solicitado', 'automacao', 'Rascunho automatico de reposicao')
      returning id into v_pedido_id;
      v_criados := v_criados + 1;
    end if;

    -- Insumo contado em frascos: compra só em frascos inteiros.
    insert into pedidos_compra_itens(pedido_id, insumo_id, quantidade, custo_unitario_estimado)
    values (
      v_pedido_id,
      r.insumo_id,
      case
        when kontrol_private.modelo_quantidade_insumo(r.insumo_id) = 'EMBALAGEM_FECHADA'
          then ceil(r.qtd_sugerida_compra)
        else r.qtd_sugerida_compra
      end,
      r.custo_unitario
    );
    v_itens := v_itens + 1;

    insert into notificacoes(tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, dedupe_key)
    select
      'reposicao',
      'Reposicao sugerida',
      r.especificacao || ' esta abaixo do ponto sugerido. Rascunho de compra #' || v_pedido_id || ' criado.',
      'pedido_compra',
      v_pedido_id,
      'coordenador',
      'reposicao:' || r.insumo_id || ':' || current_date
    where not exists (
      select 1 from notificacoes n
      where n.dedupe_key = 'reposicao:' || r.insumo_id || ':' || current_date
    );
    get diagnostics v_linhas = row_count;
    v_notificacoes := v_notificacoes + v_linhas;

    v_pedido_id := null;
  end loop;

  insert into notificacoes(tipo, titulo, corpo, papel_destino, dedupe_key)
  select
    'vencimento',
    'Lotes vencendo',
    count(*) || ' lote(s) aceitos entram no horizonte de vencimento ou ja venceram.',
    'gestor',
    'vencimentos:' || current_date
  from v_alertas_estoque
  where tipo in ('vencimento','vencido')
  having count(*) > 0
     and not exists (
       select 1 from notificacoes n
       where n.dedupe_key = 'vencimentos:' || current_date
     );
  get diagnostics v_linhas = row_count;
  v_notificacoes := v_notificacoes + v_linhas;

  insert into notificacoes(tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, dedupe_key)
  select
    'vencimento',
    'Insumo critico sem validade',
    a.especificacao || ' possui lote aceito/em uso sem validade cadastrada. Saldo afetado: ' || a.valor || '.',
    'insumo',
    a.insumo_id,
    'coordenador',
    'sem_validade:' || a.insumo_id || ':' || current_date
  from v_alertas_estoque a
  where a.tipo = 'sem_validade'
    and not exists (
      select 1 from notificacoes n
      where n.dedupe_key = 'sem_validade:' || a.insumo_id || ':' || current_date
    );
  get diagnostics v_linhas = row_count;
  v_notificacoes := v_notificacoes + v_linhas;

  insert into notificacoes(tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, dedupe_key)
  select
    'sistema',
    'Quarentena pendente',
    a.especificacao || ' tem ' || a.valor || ' unidade(s) aguardando aceite no estoque.',
    'insumo',
    a.insumo_id,
    'coordenador',
    'quarentena:' || a.insumo_id || ':' || current_date
  from v_alertas_estoque a
  where a.tipo = 'quarentena'
    and not exists (
      select 1 from notificacoes n
      where n.dedupe_key = 'quarentena:' || a.insumo_id || ':' || current_date
    );
  get diagnostics v_linhas = row_count;
  v_notificacoes := v_notificacoes + v_linhas;

  return jsonb_build_object(
    'pedidos_criados', v_criados,
    'itens_criados', v_itens,
    'notificacoes_criadas', v_notificacoes
  );
end $function$;

revoke all on function public.gerar_reposicao_automatica() from public, anon;
grant execute on function public.gerar_reposicao_automatica() to authenticated, service_role;

-- ---- 3. Pedido de reposição pelo Controle de Estoque -----------------------
create or replace function public.criar_pedido_reposicao_estoque(
  p_titulo text,
  p_justificativa text,
  p_urgencia text,
  p_data_necessidade date,
  p_itens jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := current_setting('request.jwt.claims', true)::jsonb->>'email';
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

-- ---- 2. Criar insumo pela triagem exige "Insumos: editar" ------------------
create or replace function public.resolver_triagem_criando_insumo(
  p_triagem_id bigint,
  p_especificacao text,
  p_unidade text,
  p_unidade_consumo text,
  p_fator_conversao numeric,
  p_quantidade_embalagem numeric,
  p_custo_total_embalagem numeric default null::numeric,
  p_criado_por text default null::text
)
returns table(triagem_id bigint, insumo_id bigint, identificador_id bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_triagem public.cadastros_triagem%rowtype;
  v_codigo text;
  v_codigo_normalizado text;
  v_insumo_id bigint;
  v_identificador_id bigint;
begin
  perform kontrol_private.exigir_permissao('insumos.editar');

  select *
    into v_triagem
    from public.cadastros_triagem
   where id = p_triagem_id
   for update;

  if not found then
    raise exception 'Triagem não encontrada.';
  end if;

  if v_triagem.status not in ('pendente', 'em_analise') then
    raise exception 'Triagem já resolvida ou descartada.';
  end if;

  v_codigo := nullif(btrim(v_triagem.codigo), '');
  v_codigo_normalizado := nullif(btrim(v_triagem.codigo_normalizado), '');

  if v_codigo is null then
    raise exception 'Código da triagem inválido.';
  end if;

  if v_codigo_normalizado is null then
    v_codigo_normalizado := upper(regexp_replace(v_codigo, '\s+', ' ', 'g'));
  end if;

  if nullif(btrim(p_especificacao), '') is null then
    raise exception 'Informe a especificação.';
  end if;

  if nullif(btrim(p_unidade), '') is null then
    raise exception 'Informe a unidade de estoque.';
  end if;

  if nullif(btrim(p_unidade_consumo), '') is null then
    raise exception 'Informe a unidade de consumo.';
  end if;

  if p_fator_conversao is null or p_fator_conversao <= 0 then
    raise exception 'O fator de conversão deve ser maior que zero.';
  end if;

  if p_quantidade_embalagem is null or p_quantidade_embalagem <= 0 then
    raise exception 'A quantidade da embalagem deve ser maior que zero.';
  end if;

  if p_custo_total_embalagem is not null and p_custo_total_embalagem < 0 then
    raise exception 'O custo da embalagem não pode ser negativo.';
  end if;

  if exists (
    select 1
      from public.identificadores
     where codigo_normalizado = v_codigo_normalizado
       and ativo = true
  ) then
    raise exception 'Este código já está vinculado a outro cadastro ativo.';
  end if;

  insert into public.insumos (
    especificacao,
    unidade,
    unidade_consumo,
    fator_conversao,
    quantidade_embalagem,
    custo_total_embalagem,
    custo_unitario,
    ponto_reposicao,
    estoque_seguranca,
    codigo_interno
  )
  values (
    btrim(p_especificacao),
    btrim(p_unidade),
    btrim(p_unidade_consumo),
    p_fator_conversao,
    p_quantidade_embalagem,
    p_custo_total_embalagem,
    case
      when p_custo_total_embalagem is null then null
      else p_custo_total_embalagem / p_quantidade_embalagem
    end,
    0,
    0,
    v_codigo
  )
  returning id into v_insumo_id;

  insert into public.identificadores (
    tipo,
    valor,
    codigo,
    codigo_normalizado,
    formato,
    entidade_tipo,
    entidade_id,
    origem,
    metadata,
    ativo,
    criado_por
  )
  values (
    'manual',
    v_codigo,
    v_codigo,
    v_codigo_normalizado,
    coalesce(v_triagem.formato, 'manual'),
    'insumo',
    v_insumo_id,
    'manual',
    jsonb_build_object('triagem_id', v_triagem.id),
    true,
    p_criado_por
  )
  returning id into v_identificador_id;

  update public.cadastros_triagem
     set status = 'resolvido',
         entidade_tipo = 'insumo',
         entidade_id = v_insumo_id,
         resolvido_em = now()
   where id = v_triagem.id
     and status in ('pendente', 'em_analise');

  if not found then
    raise exception 'Esta triagem não pode mais ser resolvida.';
  end if;

  triagem_id := v_triagem.id;
  insumo_id := v_insumo_id;
  identificador_id := v_identificador_id;
  return next;
end;
$function$;

-- ---- Verificação: a migration falha se alguma trava não entrou -------------
do $$
begin
  if position('exigir_permissao' in pg_get_functiondef('public.gerar_reposicao_automatica()'::regprocedure)) = 0
     or position('exigir_permissao' in pg_get_functiondef(
       'public.resolver_triagem_criando_insumo(bigint,text,text,text,numeric,numeric,numeric,text)'::regprocedure)) = 0 then
    raise exception '0125: checagem de permissão ausente depois da recriação';
  end if;
  if position('new.pedido_interno_item_id' in pg_get_functiondef('kontrol_private.preencher_unidade_item()'::regprocedure)) > 0 then
    raise exception '0125: gatilho de unidade ainda lê a coluna inexistente';
  end if;
  if has_function_privilege('anon', 'public.gerar_reposicao_automatica()', 'execute') then
    raise exception '0125: anon ainda executa a reposição automática';
  end if;
end $$;

commit;
