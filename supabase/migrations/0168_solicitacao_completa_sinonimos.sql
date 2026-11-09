-- 0168 — solicitação de compra completa e sinônimos no catálogo.
--
-- Etapa 2 do plano de adaptação do fluxo de compras (thread de 09/11/2026,
-- pedido de Antonio). Os campos seguem a planilha atual de compras da equipe:
--
--   pedidos_internos.natureza  — material de consumo de laboratório,
--     material de consumo geral (campo, coleta), equipamento, serviço,
--     diária, combustível, seguro, locação etc. (decisão de Antonio em
--     09/11: o tipo é escolhido no pedido; as abas Solicitação, Compras e
--     Diárias da planilha viram um só fluxo com este campo). Material de
--     consumo de laboratório é o que vai precisar também da coordenação do
--     laboratório (etapa seguinte). Vazio nos pedidos antigos.
--   pedidos_internos.objetivo  — Tese, Projeto, Manutenção de laboratório,
--     Uso geral, Campo (coluna "Objetivo" da planilha). Vazio nos antigos.
--   pedidos_internos_itens.caracteristicas — características indispensáveis
--     (baixa retenção/low binding, livre de DNA e RNA, estéril, apresentação).
--   pedidos_internos_itens.exigencia_tecnica — marca ou especificação exigida
--     por protocolo, com a justificativa. NÃO é exclusividade.
--   pedidos_internos_itens.exclusividade — justificativa de fornecedor ou
--     produto exclusivo (precisa de comprovação à parte; o Kontrol não trata
--     a exigência técnica como prova de exclusividade).
--   pedidos_internos_itens.outros_fornecedores — "Indicação de outros
--     fornecedores" da planilha.
--   insumos.sinonimos — nomes equivalentes para a busca do catálogo
--     (ex.: "low binding; baixa retenção").
--   equipamento_unidades.patrimonio_de — titular do patrimônio da unidade.
--
-- Não destrutiva: só acrescenta colunas que aceitam vazio, com limite de
-- tamanho. Nenhum dado existente muda; pedidos e gatilhos de auditoria
-- (aud_pedidos_internos, aud_pedidos_internos_itens, aud_insumos) passam a
-- registrar os campos novos sozinhos, porque gravam a linha inteira.
-- As colunas novas não entram na lista protegida de
-- kontrol_private.proteger_pedido_interno_direto: o solicitante as edita em
-- rascunho ou ajuste, como título e justificativa.
--
-- Reversão (só se nada tiver sido preenchido, ou depois de exportar os
-- valores): alter table ... drop column de cada coluna abaixo.

begin;

alter table public.pedidos_internos
  add column if not exists natureza text,
  add column if not exists objetivo text;

alter table public.pedidos_internos
  drop constraint if exists pedidos_internos_natureza_check,
  add constraint pedidos_internos_natureza_check check (
    natureza is null or natureza in (
      'material_consumo_lab', 'material_consumo_geral', 'equipamento', 'servico',
      'manutencao', 'diaria', 'combustivel', 'seguro', 'passagem', 'locacao', 'outro'
    )
  ),
  drop constraint if exists pedidos_internos_objetivo_check,
  add constraint pedidos_internos_objetivo_check check (
    objetivo is null or objetivo in (
      'tese', 'projeto', 'manutencao_lab', 'uso_geral', 'campo', 'outro'
    )
  );

comment on column public.pedidos_internos.natureza is
  '0168: natureza da despesa (material de consumo de laboratório ou geral, equipamento, serviço, diária, combustível, seguro, locação...). Vazio em pedidos anteriores à 0168.';
comment on column public.pedidos_internos.objetivo is
  '0168: objetivo do pedido (tese, projeto, manutenção de laboratório, uso geral, campo). Vazio em pedidos anteriores à 0168.';

alter table public.pedidos_internos_itens
  add column if not exists caracteristicas text,
  add column if not exists exigencia_tecnica text,
  add column if not exists exclusividade text,
  add column if not exists outros_fornecedores text;

alter table public.pedidos_internos_itens
  drop constraint if exists pedidos_internos_itens_textos_0168_check,
  add constraint pedidos_internos_itens_textos_0168_check check (
    coalesce(char_length(caracteristicas), 0) <= 2000
    and coalesce(char_length(exigencia_tecnica), 0) <= 2000
    and coalesce(char_length(exclusividade), 0) <= 2000
    and coalesce(char_length(outros_fornecedores), 0) <= 1000
  );

comment on column public.pedidos_internos_itens.caracteristicas is
  '0168: características indispensáveis do item (baixa retenção, livre de DNA/RNA, estéril, apresentação).';
comment on column public.pedidos_internos_itens.exigencia_tecnica is
  '0168: marca ou especificação exigida por protocolo e a justificativa. Não comprova exclusividade.';
comment on column public.pedidos_internos_itens.exclusividade is
  '0168: justificativa de fornecedor ou produto exclusivo; a comprovação vai anexada ao pedido.';
comment on column public.pedidos_internos_itens.outros_fornecedores is
  '0168: outros fornecedores indicados pelo solicitante.';

alter table public.insumos
  add column if not exists sinonimos text;

alter table public.insumos
  drop constraint if exists insumos_sinonimos_0168_check,
  add constraint insumos_sinonimos_0168_check check (coalesce(char_length(sinonimos), 0) <= 1000);

comment on column public.insumos.sinonimos is
  '0168: nomes equivalentes para a busca do catálogo, separados por ponto e vírgula (ex.: low binding; baixa retenção).';

-- Patrimônio de quem (pedido de Antonio e Nathieli em 09/11): titular do
-- patrimônio de cada unidade física de equipamento (hoje Biratã, Antonio,
-- Márcio ou ATGC). Texto livre com sugestões na tela, para não fixar nomes no
-- banco. Vazio nas unidades já cadastradas.
alter table public.equipamento_unidades
  add column if not exists patrimonio_de text;

alter table public.equipamento_unidades
  drop constraint if exists equipamento_unidades_patrimonio_de_0168_check,
  add constraint equipamento_unidades_patrimonio_de_0168_check check (coalesce(char_length(patrimonio_de), 0) <= 120);

comment on column public.equipamento_unidades.patrimonio_de is
  '0168: titular do patrimônio da unidade (pessoa ou ATGC).';

notify pgrst, 'reload schema';

commit;
