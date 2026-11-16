-- 0181 — Repor desconta a leitura desfeita, como a ficha do insumo
-- (auditoria de 16/11/2026, item 4).
--
-- O consumo da previsão de suprimentos (v_previsao_suprimentos: Situação do
-- estoque / Repor, sugestões de compra e alertas) somava toda saída da janela.
-- Desfazer uma saída por leitura (0143) devolve o frasco com um 'ajuste' de
-- motivo 'leitura desfeita: abertura de embalagem'; a saída continuava
-- contando e o consumo ficava inflado, com ponto de reposição e quantidade
-- sugerida acima do real. O consumo mensal da ficha do insumo já descontava
-- (0167). Agora a previsão desconta do mesmo jeito: a devolução abate a saída
-- na janela, na mesma unidade, e o consumo nunca fica negativo.
--
-- Só muda a conta do consumo dentro da view. Colunas, ordem, tipos,
-- security_invoker, permissões e o filtro de insumo ativo (0144) ficam como
-- estão; v_alertas_estoque lê esta view e passa a refletir a conta nova sem
-- ser recriada. Não mexe em tabela, dado, RLS, gatilho nem função.
--
-- Rollback: recriar a view com este mesmo texto trocando o bloco "consumo"
-- pelo da 0132 (sum(CASE WHEN m.tipo <> 'saida' THEN 0 ... END)).

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regclass('public.v_previsao_suprimentos') is null then
    raise exception '0181: requer a view v_previsao_suprimentos (0132)';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'insumos' and column_name = 'ativo'
  ) then
    raise exception '0181: requer a migration 0144 (insumos.ativo)';
  end if;
end $$;

-- A definição é a da 0132 com o filtro de insumo ativo da 0144; a única
-- diferença é o bloco "consumo".
create or replace view public.v_previsao_suprimentos
with (security_invoker = true) as
select anterior.*
from (
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
            -- 0181: a devolução da leitura desfeita (0143) abate a saída que ela desfez,
            -- na mesma unidade; o consumo da janela nunca fica negativo. Mesma regra
            -- do consumo mensal da ficha do insumo (0167).
            GREATEST(sum(
                CASE
                    WHEN m.tipo = 'saida'::text THEN 1::numeric
                    WHEN m.tipo = 'ajuste'::text AND m.motivo = 'leitura desfeita: abertura de embalagem'::text THEN '-1'::numeric
                    ELSE 0::numeric
                END *
                CASE
                    WHEN md.modelo_quantidade = 'EMBALAGEM_FECHADA'::text AND COALESCE(l.modelo_quantidade, 'LEGADO'::text) <> 'EMBALAGEM_FECHADA'::text AND md.conteudo IS NOT NULL
                      THEN m.quantidade / md.conteudo
                    WHEN md.modelo_quantidade <> 'EMBALAGEM_FECHADA'::text AND l.modelo_quantidade = 'EMBALAGEM_FECHADA'::text
                      THEN m.quantidade * COALESCE(NULLIF(l.conteudo_embalagem_snapshot, 0::numeric), 1::numeric)
                    ELSE m.quantidade
                END), 0::numeric) AS consumo_janela
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
            min(c.prevista) FILTER (WHERE c.prevista < CURRENT_DATE AND c.qtd_restante > 0::numeric) AS atrasada_desde,
            -- 0132: compra ainda solicitada (sem aprovação), inclusive o rascunho automático.
            sum(c.qtd_restante) FILTER (WHERE c.status = 'solicitado'::text) AS pendente
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
            sum(fontes.quantidade) AS qtd_pedida_aberta,
            sum(fontes.pendente) AS qtd_pedida_pendente
           FROM ( SELECT compras_abertas.insumo_id,
                    compras_abertas.quantidade,
                    COALESCE(compras_abertas.pendente, 0::numeric) AS pendente
                   FROM compras_abertas
                UNION ALL
                 -- 0132: pedido interno de reposição aberto ainda não foi aprovado para compra.
                 SELECT reposicoes_internas_abertas.insumo_id,
                    reposicoes_internas_abertas.quantidade,
                    reposicoes_internas_abertas.quantidade AS pendente
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
            COALESCE(a.qtd_pedida_pendente, 0::numeric) AS qtd_pedida_pendente,
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
    compra_atrasada_desde,
    -- 0132: parte do que está a caminho que ainda aguarda aprovação.
    qtd_pedida_pendente,
    -- 0132: parte da necessidade coberta só por pedidos ainda sem aprovação.
    LEAST(qtd_pedida_pendente,
          GREATEST(0::numeric, necessidade - disponivel - (qtd_pedida_aberta - qtd_pedida_pendente))) AS qtd_reposicao_pendente
   FROM calc
) anterior
join public.insumos i on i.id = anterior.insumo_id
where i.ativo;

commit;
