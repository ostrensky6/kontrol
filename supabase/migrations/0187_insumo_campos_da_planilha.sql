-- 0187 — Campos da planilha de solicitação de compras no cadastro de insumos.
--
-- Pedido de Antonio em 27/11/2026 (thread "Corrigir bugs e ajustes de 27/11"):
-- o processo de compras deve seguir o que a equipe faz hoje à mão, com a
-- "Planilha Auxiliar Original - SolicitaçãoCompras.xlsx". A aba "Descrição de
-- itens e indicação" tem, por insumo, o que vai na Solicitação de Compras
-- (Ineo) e no Termo de Referência (Funpar). "Sim, você pode trocar o nome"
-- dos campos que já existem; os que faltam são criados aqui.
--
-- Colunas da planilha e onde ficam no Kontrol:
--   Natureza/Rubrica .......................... insumos.nome_item (já existe; o rótulo muda no app)
--   Itens ..................................... insumos.especificacao (já existe; "Item")
--   Descrição detalhada do produto ............ insumos.descricao_detalhada (nova)
--   Marcas/código (preferência) ............... insumos.fabricante e codigo_fabricante (já existem)
--   Sugestão de fornecedores/contato .......... insumos.fornecedores_sugeridos (nova)
--   Observações internas ...................... insumos.observacoes_internas (nova)
--   Justificativa - Termo de Referência ....... insumos.justificativa_tr (nova)
--   Quantitativo / especificações técnicas /
--     valores referenciais de mercado ......... insumos.especificacoes_tr (nova)
--   Critério de aceitabilidade ................ insumos.criterio_aceitabilidade (nova)
--
-- Não destrutiva: só acrescenta colunas de texto que aceitam vazio, com limite
-- de tamanho. RLS (insumos.editar), auditoria (aud_insumos) e leituras seguem
-- as mesmas: a política vale para a linha inteira.
--
-- Rollback (só depois de exportar, se houver texto gravado):
--   alter table public.insumos
--     drop column descricao_detalhada, drop column fornecedores_sugeridos,
--     drop column observacoes_internas, drop column justificativa_tr,
--     drop column especificacoes_tr, drop column criterio_aceitabilidade;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regprocedure('public.excluir_pedido_interno(bigint,text)') is null then
    raise exception '0187: requer a migration 0186';
  end if;
end $$;

alter table public.insumos
  add column if not exists descricao_detalhada text,
  add column if not exists fornecedores_sugeridos text,
  add column if not exists observacoes_internas text,
  add column if not exists justificativa_tr text,
  add column if not exists especificacoes_tr text,
  add column if not exists criterio_aceitabilidade text;

alter table public.insumos drop constraint if exists insumos_textos_planilha_check;
alter table public.insumos add constraint insumos_textos_planilha_check check (
  coalesce(char_length(descricao_detalhada), 0) <= 4000
  and coalesce(char_length(fornecedores_sugeridos), 0) <= 2000
  and coalesce(char_length(observacoes_internas), 0) <= 2000
  and coalesce(char_length(justificativa_tr), 0) <= 4000
  and coalesce(char_length(especificacoes_tr), 0) <= 4000
  and coalesce(char_length(criterio_aceitabilidade), 0) <= 4000
);

comment on column public.insumos.descricao_detalhada is
  '0187: descrição detalhada do produto (planilha de solicitação de compras). Vai na Solicitação de Compras e no termo de referência.';
comment on column public.insumos.fornecedores_sugeridos is
  '0187: fornecedores e contatos sugeridos para pedir orçamento (texto livre; o fornecedor cadastrado continua em fornecedor_id).';
comment on column public.insumos.observacoes_internas is
  '0187: observações internas da equipe (não vão para o fornecedor nem para a instituição).';
comment on column public.insumos.justificativa_tr is
  '0187: justificativa do termo de referência (seção 2 do termo da Funpar).';
comment on column public.insumos.especificacoes_tr is
  '0187: quantitativo, especificações técnicas e valores referenciais de mercado (seção 3 do termo da Funpar).';
comment on column public.insumos.criterio_aceitabilidade is
  '0187: critérios de aceitabilidade do material (seção 7 do termo da Funpar).';

notify pgrst, 'reload schema';

commit;
