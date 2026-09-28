# Reorganização do módulo Orçamentos — 28/09/2026

Branch `claude/budget-module-reorganization-143e54`, versão **1.2.1**, sobre o
PR #49 (1.1.9) e com o PR #50 (onda C, 1.2.0) já juntado. Desenho:
`docs/superpowers/specs/2026-09-28-reorganizacao-modulo-orcamentos-design.md`;
plano: `docs/superpowers/plans/2026-09-28-reorganizacao-modulo-orcamentos.md`.

## O que mudou para quem usa

- **Proposta emitida** (`/orcamento/final/[id]`): abas **Interno** (padrão) e
  **Documento do cliente**.
  - Interno: quadro fixo de custos efetivos × custos operacionais (impostos,
    taxa de incubação, fundos, margem) e total; subabas Resumo, uma por
    rubrica com itens, Impostos/taxas/margem (com a compensação do imposto:
    valor limpo, imposto compensado, parte da nota) e Fundos (previsto; após
    aprovação, liberado/usado/saldo). "Alterar percentuais" gera a versão
    seguinte com os custos congelados. Auditoria recolhida.
  - Documento: folha A4 retrato com dados da empresa emissora e do cliente,
    resumo, seções numeradas (objeto, escopo técnico, serviços e valores,
    prazos, responsabilidades, condições, confidencialidade, aceite) e textos
    editáveis na própria versão enquanto emitida/enviada (auditado). O mesmo
    documento sai no PDF, no DOCX e no link público. Sem menção ao Kontrol; o
    título da aba (e do PDF) é "Proposta nº · empresa".
- **Elaboração** (`/orcamento/demandas/[id]`): cabeçalho de uma linha;
  formulário de dados em grupos lado a lado com campos compactos e e-mail,
  telefone e endereço do cliente (preenchidos pelo cadastro); etapa Proposta
  com as mesmas abas (valores vivos, percentuais e textos editáveis).
- **Lista de orçamentos**: busca e Fase à vista; Modalidade, Completude e
  Projeto em "Mais filtros" (mesmo método do Histórico).
- **Documento da proposta** (`/orcamento/documento-proposta`): dados
  cadastrais de ATGC e GIA e seções padrão do texto (editar, ordenar,
  desativar, criar).
- Nome da ATGC passa a "ATGC Genética Ambiental Ltda.".
- Correções: soma do laboratório na tabela interna usava o preço de tabela;
  emissão passa a guardar descrição/unidade/categoria dos custos do projeto e
  o nome das análises; impressão não leva o logo do Kontrol.

## Auditoria de ocupação das telas (pedido do dono)

Critérios: campos de 32 px aos pares, grupos lado a lado, nada esticado pela
largura, filtros como no Histórico ("Mais filtros"), cartões numa faixa,
detalhe recolhido. Altura da página em 1440 px:

| Tela | Antes | Depois |
|---|---|---|
| Dados do orçamento (etapa 1) | ~1.600 | ~1.050 (formulário cabe numa tela) |
| Novo orçamento | 2.006 | 1.324 |
| Orçamento laboratorial | 2.737 | 1.579 |
| Parâmetros econômicos | 2.482 | 1.133 |
| Modelos e catálogo (aba Todas, 100 itens) | 6.986 | 3.959 (uma rubrica: ~2.200) |
| Regras do orçamento | 3.383 | 1.598 |

Também: etapa Laboratório com resumo numa linha; auditoria por campo sem
"[object Object]" (`src/lib/orcamento/auditoria-resumo.ts`, mostra o
subcampo alterado e agrupa alterações seguidas).

Pendências fora do módulo: a página geral `/auditoria` tem o mesmo defeito
"[object Object]" (pode usar `resumoDiffAuditoria`); o título "Governança e
permissões" difere do menu "Regras do orçamento".

## Regra "título + ?" (pedido do dono, vale para o app todo)

A explicação de uma página ou seção fica dentro do "?" ao lado do título, não
em texto cinza ao lado ou embaixo; obrigatório é um asterisco vermelho, sem
selos de estado nos rótulos; tabela vazia vira uma linha. Aplicada em todo o
módulo Orçamentos (o Novo orçamento cabe numa tela de 1440 px) e nos demais
módulos (início, cadastros, parâmetros, custeio, insumos, análises, estoque,
governança, notificações, projetos, recebimento, usuários, pedidos,
planejamento). Mantidos visíveis de propósito: mensagens de lista vazia,
avisos de consequência junto de botões, números/indicadores, diálogos,
descrições de cartões que são links (um "?" dentro de um link é inválido) e
páginas legais. Arquivos dos PRs #47 e #51 não foram tocados.

## Banco: migration 0135 (aditiva)

`supabase/migrations/0135_proposta_documento_textos.sql` — tabelas
`empresas_emissoras` e `proposta_secoes_padrao` (com textos iniciais para ATGC
e GIA), colunas `demandas_propostas.cliente_email|cliente_telefone|
cliente_endereco|textos_proposta` e `orcamento_final_versoes.textos_proposta`,
RPC `atualizar_textos_versao_final` e `ler_orcamento_publico` devolvendo os
textos. Teste: `supabase/tests/proposta_documento_textos_0135.sql`.

- Numeração combinada com a sessão do PR #50: **0133 e 0134** (PR #50),
  **0135** (esta branch), **0136** (`decisoes_d2_d3_d5_d7`, branch
  `claude/decisoes-d2-d7`). Próximo livre: 0137.
- Aplicada e registrada só no banco local. Em produção: aplicar depois de
  0133/0134, com backup antes, pelo script `npm run db:migration` (que aplica
  e registra junto).
- Rollback: `drop table proposta_secoes_padrao, empresas_emissoras`; `alter
  table ... drop column` das colunas novas (vazias até o uso); `drop function
  atualizar_textos_versao_final`; recriar `ler_orcamento_publico` da 0126.
- Depois do deploy: preencher CNPJ, endereço e contatos em Orçamentos ›
  Documento da proposta e revisar os textos padrão (o prazo de guarda de
  amostras de 90 dias é sugestão).
- Dependência nova: TipTap (`@tiptap/react`, `@tiptap/pm`,
  `@tiptap/starter-kit`) para o editor de texto.

## Verificação

- Unitários: `npx vitest run` — 822 testes passando (após a junção do PR #50
  e a auditoria de telas).
- `tsc` e `eslint` limpos; `next build` sem erros.
- E2E (Supabase simulado): 50 de 50 passando, numa cópia limpa da branch sem
  `.env.local`. O teste da onda C (`e2e/orcamento-onda-c.spec.ts`, vindo do
  PR #50) usava `/d+ orçamentos?/` sem a barra invertida e nunca passava;
  corrigido com autorização do dono, e agora também confere o "Mais filtros".
- Conferência visual no app local e PDF em A4 (2 páginas, rodapé com empresa
  e "Página X de Y").
