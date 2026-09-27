-- Rodada de aperfeiçoamento de 27/09/2026 (avaliação externa da auditoria
-- onda 2 + decisões do dono na mesma data).
--
-- O que muda e por quê:
--
--  1. Entrada direta no estoque (decisão do dono, 27/09, substitui a de
--     26/09): quem registra a chegada cadastra o material e ele fica
--     disponível na hora. Não há quarentena nem aceite por segunda pessoa, em
--     nenhuma porta de entrada (recebimento de compra, recebimento de pedido
--     interno, "+ Entrada", estoque inicial). Lotes que ainda estivessem em
--     quarentena passam a aceitos. O bloqueio manual de lote continua
--     existindo como ação opcional. aceitar_lote permanece (sem uso) para não
--     quebrar chamadas antigas.
--  2. Reposição antecipada com uma regra só: prazo = tramitação interna da
--     universidade (parâmetro novo prazo_tramitacao_compra_dias) + prazo de
--     entrega do fornecedor (prazo do insumo; zero ou vazio cai para o prazo
--     médio do fornecedor). A quantidade sugerida passa a considerar também o
--     ponto de reposição cadastrado, e o alerta "Repor" usa a mesma conta da
--     sugestão (antes ignorava compras em aberto). Compra em aberto com a
--     entrega prevista vencida continua contando como "a caminho", mas gera o
--     alerta "compra atrasada" e aviso semanal a quem aprova compras.
--  3. D1: compra formal que nasceu de pedido interno só é aprovada ou enviada
--     depois que o pedido chega a "Aprovado para compra". Compra sem pedido
--     interno segue a regra própria (permissão de aprovar compras).
--  4. Destino explícito do que faltou: encerrar compra com pendência exige
--     escolher nova compra (criada na hora, ligada à original), desistência ou
--     atendido de outra forma; a quantidade não atendida fica gravada no item.
--  5. Margem do plano: a receita passa a ser o valor da parte laboratorial da
--     proposta aprovada (total final menos a parte de projeto, já com impostos,
--     taxas e lucro), e não mais o preço de tabela das análises.
--
-- Não remove tabelas, colunas, dados, RLS nem gatilhos de auditoria. As
-- funções recriadas partem do pg_get_functiondef vigente (0129).
--
-- Rollback: reaplicar as definições anteriores (0127/0125/0123/0120) de
-- criar_lote_recebido, receber_lote, entrada_inventario, desbloquear_lote,
-- aguardando_voce, gerar_reposicao_automatica, transicionar_pedido_compra,
-- proteger_item_compra e das views v_previsao_suprimentos, v_alertas_estoque
-- e v_margem_real_planejamento; remover o gatilho trg_lote_entra_disponivel,
-- a função encerrar_compra_com_pendencia e a view v_compras_prazo. As colunas
-- novas podem ficar (nulas).

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- 1. Entrada direta ---------------------------------------------------------

alter table public.lotes_estoque alter column status set default 'aceito';

-- Rede de segurança: qualquer caminho que ainda tente pôr lote em quarentena
-- (função antiga, importação) grava o lote como disponível.
create or replace function kontrol_private.lote_entra_disponivel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'quarentena' then
    new.status := 'aceito';
  end if;
  return new;
end $$;

drop trigger if exists trg_lote_entra_disponivel on public.lotes_estoque;
create trigger trg_lote_entra_disponivel
  before insert or update of status on public.lotes_estoque
  for each row execute function kontrol_private.lote_entra_disponivel();

-- Lotes que ficaram em quarentena antes desta regra (produção: nenhum em
-- 26/09). O gatilho de auditoria registra cada mudança.
update public.lotes_estoque set status = 'aceito' where status = 'quarentena';

CREATE OR REPLACE FUNCTION kontrol_private.criar_lote_recebido(p_insumo_id bigint, p_lote jsonb, p_codigo text, p_validade date, p_fornecedor text, p_projeto text, p_responsavel text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id bigint;
begin
  -- 0130: o lote entra disponível na hora, então material vencido não entra
  -- (antes era barrado no aceite).
  if p_validade is not null and p_validade < current_date then
    raise exception 'A validade informada (%) já passou: material vencido não entra no estoque. Confira a data ou devolva ao fornecedor.',
      to_char(p_validade, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if p_lote->>'modelo' = 'EMBALAGEM_FECHADA' then
    insert into public.lotes_estoque (
      insumo_id, codigo_lote, validade, quantidade_inicial, quantidade_atual,
      custo_unitario, fornecedor, projeto, status, responsavel_recebimento,
      modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot,
      unidade_consumo_snapshot, fator_conversao_snapshot
    ) values (
      p_insumo_id, nullif(btrim(p_codigo), ''), p_validade,
      (p_lote->>'quantidade')::numeric, (p_lote->>'quantidade')::numeric,
      (p_lote->>'custo_unitario')::numeric, nullif(btrim(p_fornecedor), ''),
      nullif(btrim(p_projeto), ''), 'aceito', p_responsavel,
      'EMBALAGEM_FECHADA', p_lote->>'unidade_fisica', (p_lote->>'conteudo')::numeric,
      p_lote->>'unidade_consumo', (p_lote->>'fator')::numeric
    ) returning id into v_id;
  else
    insert into public.lotes_estoque (
      insumo_id, codigo_lote, validade, quantidade_inicial, quantidade_atual,
      custo_unitario, fornecedor, projeto, status, responsavel_recebimento
    ) values (
      p_insumo_id, nullif(btrim(p_codigo), ''), p_validade,
      (p_lote->>'quantidade')::numeric, (p_lote->>'quantidade')::numeric,
      (p_lote->>'custo_unitario')::numeric, nullif(btrim(p_fornecedor), ''),
      nullif(btrim(p_projeto), ''), 'aceito', p_responsavel
    ) returning id into v_id;
  end if;
  return v_id;
end $function$

;

CREATE OR REPLACE FUNCTION public.receber_lote(p_insumo_id bigint, p_quantidade numeric, p_validade date DEFAULT NULL::date, p_custo numeric DEFAULT NULL::numeric, p_codigo text DEFAULT NULL::text, p_fornecedor text DEFAULT NULL::text, p_local_id bigint DEFAULT NULL::bigint, p_nota_fiscal text DEFAULT NULL::text, p_projeto text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lote bigint;
begin
  perform kontrol_private.exigir_permissao('estoque.movimentar');

  if p_insumo_id is null then
    raise exception 'Insumo invalido.' using errcode = '22023';
  end if;
  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'Quantidade deve ser maior que zero.' using errcode = '22023';
  end if;
  if p_custo is not null and p_custo < 0 then
    raise exception 'Custo unitario deve ser maior ou igual a zero.' using errcode = '22023';
  end if;

  insert into lotes_estoque(insumo_id, codigo_lote, validade, quantidade_inicial,
                            quantidade_atual, custo_unitario, fornecedor, status,
                            local_id, nota_fiscal, projeto)
  values (p_insumo_id, nullif(btrim(p_codigo), ''), p_validade, p_quantidade, p_quantidade,
          p_custo, nullif(btrim(p_fornecedor), ''), 'aceito',
          p_local_id, nullif(btrim(p_nota_fiscal), ''), nullif(btrim(p_projeto), ''))
  returning id into v_lote;

  insert into estoque_movimentacoes(insumo_id, tipo, quantidade, custo_unitario, motivo, lote_id)
  values (p_insumo_id, 'entrada', p_quantidade, p_custo, 'recebimento', v_lote);

  return v_lote;
end $function$

;

CREATE OR REPLACE FUNCTION public.entrada_inventario(p_insumo_id bigint, p_quantidade numeric, p_operacao_id uuid, p_validade date DEFAULT NULL::date, p_custo numeric DEFAULT NULL::numeric, p_codigo text DEFAULT NULL::text, p_fornecedor text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text, p_local_id bigint DEFAULT NULL::bigint)
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
    'entrada_inventario', v_lote_id, null, 'aceito', v_ator,
    coalesce(nullif(btrim(p_motivo), ''), 'ajuste de inventario'), p_operacao_id,
    jsonb_build_object('requisicao', v_requisicao, 'resultado', v_resultado)
  );
  return v_resultado;
end $function$

;

CREATE OR REPLACE FUNCTION public.desbloquear_lote(p_lote_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lote public.lotes_estoque%rowtype;
  v_anterior text;
begin
  perform kontrol_private.exigir_permissao('estoque.descartar_bloquear');

  select * into v_lote
  from public.lotes_estoque
  where id = p_lote_id
  for update;
  if not found then
    raise exception 'Lote não encontrado.' using errcode = 'P0002';
  end if;
  if v_lote.status <> 'bloqueado' then
    return;
  end if;

  -- Volta ao status anterior ao bloqueio (trilha da auditoria). Sem trilha,
  -- ou se ele estava em quarentena, volta disponível (0130: sem quarentena).
  select a.valor_anterior->>'status'
    into v_anterior
  from public.auditoria a
  where a.tabela = 'lotes_estoque'
    and a.registro_id = p_lote_id::text
    and a.acao = 'update'
    and a.valor_novo->>'status' = 'bloqueado'
    and a.valor_anterior->>'status' is distinct from 'bloqueado'
  order by a.id desc
  limit 1;

  if v_anterior is null or v_anterior not in ('aceito', 'em_uso') then
    v_anterior := 'aceito';
  end if;
  if v_lote.modelo_quantidade = 'EMBALAGEM_FECHADA' and v_anterior = 'em_uso' then
    v_anterior := 'aceito';
  end if;

  update public.lotes_estoque
     set status = v_anterior, motivo_bloqueio = null
   where id = p_lote_id;
end $function$

;

CREATE OR REPLACE FUNCTION public.aguardando_voce()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_saida jsonb := '[]'::jsonb;
  v_qtd bigint;
  v_itens jsonb;
begin
  if auth.uid() is null then
    return v_saida;
  end if;

  if kontrol_private.tem_permissao_efetiva('pedido.aprovar') then
    select count(*) into v_qtd from public.pedidos_internos where status = 'em_validacao';
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo)), '[]'::jsonb) into v_itens
    from (
      select id, '#' || id || ' · ' || coalesce(titulo, 'sem título') as rotulo
      from public.pedidos_internos where status = 'em_validacao'
      order by coalesce(enviado_validacao_em, atualizado_em, criado_em) limit 3
    ) s;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_validacao', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  if kontrol_private.tem_permissao_efetiva('compras.aprovar') then
    select count(*) into v_qtd from public.pedidos_compra where status = 'solicitado';
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo)), '[]'::jsonb) into v_itens
    from (
      select id, 'Compra #' || id || coalesce(' · ' || nullif(projeto, ''), '') as rotulo
      from public.pedidos_compra where status = 'solicitado'
      order by criado_em limit 3
    ) s;
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
end $function$

;

-- 2. Reposição antecipada -----------------------------------------------------

-- Valor inicial 0 até o dono informar o prazo típico; a tela de reposição
-- avisa enquanto ele estiver zerado.
insert into public.parametros (chave, valor, unidade, descricao) values
  ('prazo_tramitacao_compra_dias', 0, 'dias',
   'Tramitação interna da compra na universidade (requisição, cotação, empenho) até o pedido chegar ao fornecedor. Somado ao prazo de entrega do fornecedor na previsão de reposição.')
on conflict (chave) do nothing;

-- Prazo de cada item de compra em aberto. Sem data prevista (compra ainda não
-- aprovada), a previsão é a data do pedido + tramitação + prazo do fornecedor.
create or replace view public.v_compras_prazo
with (security_invoker = on) as
with cfg as (
  select coalesce((select p.valor from public.parametros p
                   where p.chave = 'prazo_tramitacao_compra_dias'), 0)::integer as tramitacao
)
select
  p.id as pedido_id,
  pi.id as item_id,
  pi.insumo_id,
  p.status,
  greatest(pi.quantidade - coalesce(pi.quantidade_recebida,
             case when pi.lote_id is not null then pi.quantidade else 0::numeric end), 0::numeric)
    * kontrol_private.fator_item_para_estoque(pi.insumo_id, pi.quantidade_em, pi.conteudo_embalagem)
    as qtd_restante,
  coalesce(
    p.data_prevista_entrega,
    p.data_solicitacao + cfg.tramitacao
      + coalesce(nullif(i.lead_time_dias, 0), nullif(f.prazo_medio_dias, 0), nullif(i.prazo_entrega_max_dias, 0), 0)
  ) as prevista
from public.pedidos_compra p
join public.pedidos_compra_itens pi on pi.pedido_id = p.id
left join public.insumos i on i.id = pi.insumo_id
left join public.fornecedores f on f.id = coalesce(p.fornecedor_id, i.fornecedor_id)
cross join cfg
where p.status = any (array['solicitado', 'aprovado', 'enviado', 'em_transito']);

comment on view public.v_compras_prazo is
  'Itens de compra em aberto com a quantidade que falta (unidade de estoque) e a data prevista de chegada (0130).';

-- Uma linha por compra atrasada (entrega prevista vencida com algo por chegar).
create or replace view kontrol_private.v_compras_atrasadas as
select c.pedido_id, min(c.prevista) as prevista, current_date - min(c.prevista) as dias_atraso
from public.v_compras_prazo c
where c.qtd_restante > 0 and c.prevista < current_date
group by c.pedido_id;

create or replace view public.v_previsao_suprimentos
with (security_invoker = true) as
 WITH cfg AS (
         SELECT COALESCE(( SELECT parametros.valor::integer AS valor
                   FROM parametros
                  WHERE parametros.chave = 'janela_consumo_previsao_dias'::text), 90) AS janela,
                COALESCE(( SELECT parametros.valor::integer AS valor
                   FROM parametros
                  WHERE parametros.chave = 'prazo_tramitacao_compra_dias'::text), 0) AS tramitacao
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
         SELECT c.insumo_id,
            sum(c.qtd_restante) AS quantidade,
            sum(c.qtd_restante) FILTER (WHERE c.prevista < CURRENT_DATE) AS atrasada,
            min(c.prevista) FILTER (WHERE c.prevista < CURRENT_DATE AND c.qtd_restante > 0::numeric) AS atrasada_desde
           FROM v_compras_prazo c
          GROUP BY c.insumo_id
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
            COALESCE(s.estoque_seguranca, 0::numeric) AS estoque_seguranca,
            -- Zero ou vazio no insumo cai para o prazo médio do fornecedor.
            COALESCE(NULLIF(i.lead_time_dias, 0), NULLIF(f.prazo_medio_dias, 0), NULLIF(i.prazo_entrega_max_dias, 0), 0) AS prazo_fornecedor_dias,
            cfg.tramitacao AS prazo_tramitacao_dias,
            cfg.janela AS janela_dias,
            COALESCE(c.consumo_janela, 0::numeric) AS consumo_janela,
                CASE
                    WHEN cfg.janela > 0 THEN COALESCE(c.consumo_janela, 0::numeric) / cfg.janela::numeric
                    ELSE 0::numeric
                END AS consumo_medio_diario,
            COALESCE(a.qtd_pedida_aberta, 0::numeric) AS qtd_pedida_aberta,
            COALESCE(ca.atrasada, 0::numeric) AS qtd_compra_atrasada,
            ca.atrasada_desde AS compra_atrasada_desde,
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
             LEFT JOIN compras_abertas ca ON ca.insumo_id = s.insumo_id
             CROSS JOIN cfg
        ), calc AS (
         SELECT base.*,
            base.prazo_tramitacao_dias + base.prazo_fornecedor_dias AS lead_time_dias,
            -- Uma regra só: o maior entre o ponto cadastrado e o consumo durante
            -- o prazo total mais o estoque de segurança.
            GREATEST(COALESCE(base.ponto_reposicao_configurado, 0::numeric),
                     base.consumo_medio_diario * (base.prazo_tramitacao_dias + base.prazo_fornecedor_dias)::numeric
                       + base.estoque_seguranca) AS necessidade
           FROM base
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
    necessidade AS ponto_reposicao_sugerido,
    -- Insumo contado em frascos só se compra em frascos inteiros.
        CASE
            WHEN modelo_quantidade = 'EMBALAGEM_FECHADA'::text
              THEN ceil(GREATEST(0::numeric, necessidade - disponivel - qtd_pedida_aberta))
            ELSE GREATEST(0::numeric, necessidade - disponivel - qtd_pedida_aberta)
        END AS qtd_sugerida_compra,
    qtd_pedida_aberta,
    fornecedor_id,
    fornecedor_nome,
    custo_unitario,
    categoria_compra,
    unidade_saldo,
    prazo_fornecedor_dias,
    prazo_tramitacao_dias,
    qtd_compra_atrasada,
    compra_atrasada_desde
   FROM calc;

-- Alertas: "reposicao" usa a mesma conta da sugestão; "compra_atrasada" avisa
-- quando o estoque já está no ponto e a compra que viria está atrasada. Sem o
-- ramo de quarentena (0130).
create or replace view public.v_alertas_estoque
with (security_invoker = on) as
 SELECT 'reposicao'::text AS tipo,
    p.insumo_id,
    p.especificacao,
    NULL::date AS validade,
    p.disponivel AS valor,
    p.ponto_reposicao_sugerido AS referencia,
    NULL::bigint AS lote_id
   FROM v_previsao_suprimentos p
  WHERE p.qtd_sugerida_compra > 0::numeric
UNION ALL
 SELECT 'compra_atrasada'::text AS tipo,
    p.insumo_id,
    p.especificacao,
    p.compra_atrasada_desde AS validade,
    p.disponivel AS valor,
    p.ponto_reposicao_sugerido AS referencia,
    NULL::bigint AS lote_id
   FROM v_previsao_suprimentos p
  WHERE p.qtd_compra_atrasada > 0::numeric AND p.disponivel <= p.ponto_reposicao_sugerido
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
  WHERE l.quantidade_atual > 0::numeric AND (l.status = ANY (ARRAY['aceito'::text, 'em_uso'::text])) AND menor_validade(l.validade, l.validade_apos_abertura) IS NOT NULL AND menor_validade(l.validade, l.validade_apos_abertura) <= (CURRENT_DATE + COALESCE((( SELECT parametros.valor
           FROM parametros
          WHERE parametros.chave = 'janela_vencimento_dias'::text))::integer, 60));

revoke all on public.v_compras_prazo, public.v_previsao_suprimentos, public.v_alertas_estoque from anon;
grant select on public.v_compras_prazo, public.v_previsao_suprimentos, public.v_alertas_estoque to authenticated, service_role;
revoke all on kontrol_private.v_compras_atrasadas from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.gerar_reposicao_automatica()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- 0130: a sugestão já desconta o que está a caminho; uma compra pequena em
    -- aberto não suprime mais o restante da necessidade.
    where qtd_sugerida_compra > 0
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

  -- 0130: compra em aberto com a entrega prevista vencida. Continua contando
  -- como "a caminho" (para não comprar em dobro), mas quem aprova compras é
  -- avisado uma vez por semana para cobrar o fornecedor ou decidir outra saída.
  insert into notificacoes(tipo, titulo, corpo, entidade_tipo, entidade_id, permissao_destino, dedupe_key)
  select
    'reposicao',
    'Compra atrasada',
    'Compra #' || c.pedido_id || ' devia ter chegado em ' || to_char(c.prevista, 'DD/MM/YYYY')
      || '. Cobre o fornecedor ou encerre a compra e dê outro destino ao que falta.',
    'pedido_compra',
    c.pedido_id,
    'compras.aprovar',
    'compra_atrasada:' || c.pedido_id || ':' || to_char(current_date, 'IYYY-IW')
  from kontrol_private.v_compras_atrasadas c
  where not exists (
    select 1 from notificacoes n
    where n.dedupe_key = 'compra_atrasada:' || c.pedido_id || ':' || to_char(current_date, 'IYYY-IW')
  );
  get diagnostics v_linhas = row_count;
  v_notificacoes := v_notificacoes + v_linhas;

  return jsonb_build_object(
    'pedidos_criados', v_criados,
    'itens_criados', v_itens,
    'notificacoes_criadas', v_notificacoes
  );
end $function$

;

-- 3 e 4. Compra: pedido interno governa a compra; destino do que faltou ------

create or replace function kontrol_private.rotulo_status_pedido_interno(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'rascunho' then 'Rascunho'
    when 'em_validacao' then 'Aguardando coordenador'
    when 'ajuste_solicitante' then 'Devolvido ao solicitante'
    when 'validado' then 'Aprovado pelo coordenador'
    when 'formalizado' then 'Aguardando administrativo'
    when 'analise_administrativa' then 'Em análise administrativa'
    when 'ajuste_compras' then 'Devolvido a Compras'
    when 'aprovado_compra' then 'Aguardando cotação'
    when 'orcamentos' then 'Em cotação'
    when 'orcamentos_recebidos' then 'Cotações recebidas'
    when 'aguardando_aprovacao_final' then 'Aguardando aprovação final'
    when 'aprovado_para_compra' then 'Aprovado para compra'
    else p_status
  end
$$;

alter table public.pedidos_compra
  add column if not exists compra_origem_id bigint references public.pedidos_compra(id) on delete restrict;
comment on column public.pedidos_compra.compra_origem_id is
  'Compra encerrada com pendência cujo restante esta compra repõe (0130).';
create index if not exists pedidos_compra_compra_origem_idx on public.pedidos_compra(compra_origem_id)
  where compra_origem_id is not null;

alter table public.pedidos_compra_itens
  add column if not exists quantidade_nao_atendida numeric,
  add column if not exists destino_pendencia text,
  add column if not exists compra_pendencia_id bigint references public.pedidos_compra(id) on delete restrict;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pedidos_compra_itens_nao_atendida_check') then
    alter table public.pedidos_compra_itens add constraint pedidos_compra_itens_nao_atendida_check
      check (quantidade_nao_atendida is null or quantidade_nao_atendida >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pedidos_compra_itens_destino_pendencia_check') then
    alter table public.pedidos_compra_itens add constraint pedidos_compra_itens_destino_pendencia_check
      check (destino_pendencia is null or destino_pendencia in ('nova_compra', 'desistencia', 'atendido_outra_forma'));
  end if;
end $$;

comment on column public.pedidos_compra_itens.quantidade_nao_atendida is
  'Quantidade (na unidade do item) que não chegou quando a compra foi encerrada com pendência (0130).';
comment on column public.pedidos_compra_itens.destino_pendencia is
  'Destino do que faltou: nova_compra, desistencia ou atendido_outra_forma (0130).';
comment on column public.pedidos_compra_itens.compra_pendencia_id is
  'Compra criada para repor o que faltou, quando o destino é nova_compra (0130).';

-- Os campos da pendência só mudam pela RPC, como os de recebimento.
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
      if new.lote_id is not null or new.quantidade_recebida is not null or new.divergencia_recebimento is not null
         or new.quantidade_nao_atendida is not null or new.destino_pendencia is not null
         or new.compra_pendencia_id is not null then
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
  if v_direto and (new.lote_id, new.quantidade_recebida, new.divergencia_recebimento,
                   new.quantidade_nao_atendida, new.destino_pendencia, new.compra_pendencia_id)
     is distinct from (old.lote_id, old.quantidade_recebida, old.divergencia_recebimento,
                       old.quantidade_nao_atendida, old.destino_pendencia, old.compra_pendencia_id) then
    raise exception 'Os dados de recebimento só mudam pelo registro de chegada ou pelo estorno.'
      using errcode = '42501';
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.transicionar_pedido_compra(p_pedido_id bigint, p_status_destino text, p_observacao text DEFAULT NULL::text, p_data_prevista_entrega date DEFAULT NULL::date)
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
  v_bloqueio record;
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

  -- 0130 (D1): compra que nasceu de pedido interno só anda depois que o pedido
  -- chega a "Aprovado para compra". Compra sem pedido interno (rascunho de
  -- reposição, compra criada em Compras, pendência de outra compra) segue a
  -- regra própria: basta a permissão de aprovar compras.
  if p_status_destino in ('aprovado', 'enviado', 'em_transito') then
    select pi.id, pi.status into v_bloqueio
    from public.pedidos_internos pi
    where pi.status <> 'cancelado'
      and (pi.pedido_compra_id = p_pedido_id
           or exists (
             select 1
             from public.pedidos_compra_itens ci
             join public.pedidos_internos_itens pii on pii.id = ci.pedido_interno_item_id
             where ci.pedido_id = p_pedido_id and pii.pedido_interno_id = pi.id))
      and pi.status not in ('aprovado_para_compra', 'compra_fechada', 'encaminhado_instituicao',
                            'aguardando_pagamento_nf', 'compra_concluida')
    order by pi.id
    limit 1;
    if found then
      raise exception 'Esta compra vem do pedido interno #%, que está em "%". Ela só pode ser aprovada ou enviada depois que o pedido chegar a "Aprovado para compra".',
        v_bloqueio.id, kontrol_private.rotulo_status_pedido_interno(v_bloqueio.status)
        using errcode = '22023';
    end if;
  end if;

  -- 0130: encerrar com pendência exige destino para o que faltou; só a RPC
  -- encerrar_compra_com_pendencia chega aqui com essa marca.
  if p_status_destino = 'recebido'
     and coalesce(current_setting('app.encerramento_com_destino', true), '') <> 'sim' then
    raise exception 'Para encerrar a compra com pendência, use "Encerrar com pendência" e escolha o destino do que faltou.'
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
end $function$

;

-- Encerrar compra com pendência dando destino ao que faltou (0130).
create or replace function public.encerrar_compra_com_pendencia(
  p_pedido_id bigint,
  p_destino text,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_claims jsonb;
  v_ator text;
  v_compra record;
  v_nova bigint;
  v_itens int := 0;
  v_rotulo text;
begin
  perform kontrol_private.exigir_permissao('compras.aprovar');

  if p_destino is null or p_destino not in ('nova_compra', 'desistencia', 'atendido_outra_forma') then
    raise exception 'Escolha o destino do que faltou: nova compra, desistência ou atendido de outra forma.'
      using errcode = '22023';
  end if;
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'Explique o motivo (pelo menos 3 letras).' using errcode = '22023';
  end if;

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), nullif(v_claims->>'sub', ''));
  if v_ator is null then
    raise exception 'Contexto JWT do ator e obrigatorio para encerrar a compra.' using errcode = '42501';
  end if;

  select id, status, fornecedor_id, projeto, projeto_id into v_compra
  from pedidos_compra where id = p_pedido_id
  for update;
  if not found then
    raise exception 'Pedido de compra nao encontrado.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from pedidos_compra_itens i
    where i.pedido_id = p_pedido_id
      and i.quantidade - coalesce(i.quantidade_recebida, case when i.lote_id is not null then i.quantidade else 0 end) > 0
  ) then
    raise exception 'Nada ficou pendente nesta compra.' using errcode = '22023';
  end if;

  v_rotulo := case p_destino
    when 'nova_compra' then 'Nova compra'
    when 'desistencia' then 'Desistência'
    else 'Atendido de outra forma'
  end;

  if p_destino = 'nova_compra' then
    insert into pedidos_compra(fornecedor_id, projeto, projeto_id, status, solicitante, observacao, compra_origem_id)
    values (v_compra.fornecedor_id, v_compra.projeto, v_compra.projeto_id, 'solicitado', v_ator,
            left('Pendência da compra #' || p_pedido_id || ': ' || v_motivo, 500), p_pedido_id)
    returning id into v_nova;

    insert into pedidos_compra_itens(pedido_id, insumo_id, quantidade, quantidade_em, conteudo_embalagem, custo_unitario_estimado)
    select v_nova, i.insumo_id,
           i.quantidade - coalesce(i.quantidade_recebida, case when i.lote_id is not null then i.quantidade else 0 end),
           i.quantidade_em, i.conteudo_embalagem, i.custo_unitario_estimado
    from pedidos_compra_itens i
    where i.pedido_id = p_pedido_id
      and i.quantidade - coalesce(i.quantidade_recebida, case when i.lote_id is not null then i.quantidade else 0 end) > 0
    order by i.id;
    get diagnostics v_itens = row_count;
  end if;

  update pedidos_compra_itens i
     set quantidade_nao_atendida = i.quantidade - coalesce(i.quantidade_recebida, case when i.lote_id is not null then i.quantidade else 0 end),
         destino_pendencia = p_destino,
         compra_pendencia_id = v_nova
   where i.pedido_id = p_pedido_id
     and i.quantidade - coalesce(i.quantidade_recebida, case when i.lote_id is not null then i.quantidade else 0 end) > 0;

  perform set_config('app.encerramento_com_destino', 'sim', true);
  perform transicionar_pedido_compra(
    p_pedido_id, 'recebido',
    v_rotulo || case when v_nova is not null then ' (compra #' || v_nova || ')' else '' end || ': ' || v_motivo
  );
  perform set_config('app.encerramento_com_destino', '', true);

  if v_nova is not null then
    insert into eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
    values ('pedido_compra', v_nova, null, 'solicitado', v_ator,
            left('Criada para repor o que faltou na compra #' || p_pedido_id || ': ' || v_motivo, 1000));
  end if;

  return jsonb_build_object(
    'pedido_compra_id', p_pedido_id,
    'destino', p_destino,
    'nova_compra_id', v_nova,
    'itens_nova_compra', v_itens
  );
end $function$;

revoke all on function public.encerrar_compra_com_pendencia(bigint, text, text) from public, anon;
grant execute on function public.encerrar_compra_com_pendencia(bigint, text, text) to authenticated, service_role;

-- 5. Margem do plano pela proposta aprovada ------------------------------------

-- Receita = parte laboratorial do que o cliente paga na versão da proposta
-- ligada ao plano (total final − parte de projeto, já com impostos, taxas e
-- lucro). Custo orçado = custo técnico do laboratório da mesma versão. Plano
-- sem versão de proposta fica com receita_origem = 'sem_proposta'.
create or replace view public.v_margem_real_planejamento
with (security_invoker = on) as
 SELECT p.id AS planejamento_id,
    p.orcamento_id,
    COALESCE(orc.custo_orcado, 0::numeric) AS custo_orcado,
    COALESCE(orc.receita_orcada, 0::numeric) AS receita_orcada,
    COALESCE(consumo.custo_real_insumos, 0::numeric) AS custo_real_insumos,
    COALESCE(consumo.quantidade_movimentacoes, 0::bigint) AS quantidade_movimentacoes,
    COALESCE(orc.receita_orcada, 0::numeric) - COALESCE(orc.custo_orcado, 0::numeric) AS margem_prevista,
    COALESCE(orc.receita_orcada, 0::numeric) - COALESCE(consumo.custo_real_insumos, 0::numeric) AS margem_real_parcial,
        CASE
            WHEN COALESCE(orc.receita_orcada, 0::numeric) > 0::numeric THEN (COALESCE(orc.receita_orcada, 0::numeric) - COALESCE(consumo.custo_real_insumos, 0::numeric)) / orc.receita_orcada * 100::numeric
            ELSE NULL::numeric
        END AS margem_real_parcial_percentual,
        CASE WHEN orc.versao_id IS NOT NULL THEN 'proposta'::text ELSE 'sem_proposta'::text END AS receita_origem,
    orc.versao_numero
   FROM planejamento p
     LEFT JOIN LATERAL ( SELECT v.id AS versao_id,
            v.numero AS versao_numero,
            v.total_laboratorio_custo AS custo_orcado,
            v.total_final - COALESCE(v.total_projeto_final, 0::numeric) AS receita_orcada
           FROM orcamento_final_versoes v
          WHERE v.id = p.orcamento_final_versao_id) orc ON true
     LEFT JOIN LATERAL ( SELECT sum(m.quantidade * COALESCE(m.custo_unitario, 0::numeric)) AS custo_real_insumos,
            count(*) AS quantidade_movimentacoes
           FROM estoque_movimentacoes m
          WHERE m.tipo = 'saida'::text AND (m.referencia = ('plano '::text || p.id::text) OR m.referencia ~~ (('plano '::text || p.id::text) || ';%'::text))) consumo ON true
  WHERE p.orcamento_id IS NOT NULL OR p.orcamento_final_versao_id IS NOT NULL;

revoke all on public.v_margem_real_planejamento from anon;
grant select on public.v_margem_real_planejamento to authenticated, service_role;

commit;
