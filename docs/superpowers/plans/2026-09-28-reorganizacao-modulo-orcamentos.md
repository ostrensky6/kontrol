# Reorganização do módulo Orçamentos — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** proposta emitida com abas Interno (quadro efetivos × operacionais, subabas por rubrica, impostos/taxas/margem, fundos, percentuais que geram v2) e Documento do cliente (A4 diagramado com dados cadastrais e seções de texto editáveis), e elaboração com cabeçalho e formulário compactos usando os mesmos componentes.

**Architecture:** três funções puras novas (`visao-interna`, `texto-rico`, `documento-proposta`) alimentam componentes de apresentação reaproveitados na proposta emitida, na etapa Proposta da elaboração, no link público e no DOCX. Dados novos entram por uma migration aditiva (0135) e pelo snapshot da emissão; nada existente é recalculado.

**Tech Stack:** Next.js (App Router, server actions), React 19, Tailwind, Supabase (Postgres/RLS/RPC), zod, vitest, Playwright (Supabase simulado), `docx`, TipTap (novo).

Spec: `docs/superpowers/specs/2026-09-28-reorganizacao-modulo-orcamentos-design.md`.

## Global Constraints

- Português do Brasil em toda a interface; glossário: Orçamento = processo, Proposta = documento emitido; ajuda contextual = `HelpTip` ("?").
- Cálculo econômico inalterado: gross-up único (DEC-ORC-001 Alt. A), `calcularPropostaEconomica`.
- Versão emitida: snapshot e totais imutáveis; textos editáveis só pela RPC nova; percentuais só geram nova versão.
- Migration nova = `0135` (0133/0134 reservadas por outra sessão); só aditiva; sem `DROP`/`TRUNCATE`; RLS em tabelas novas; auditoria com `fn_auditoria`.
- Documento do cliente nunca mostra custo, percentual, parâmetro ou código de rubrica.
- Links com borda+fundo usam `buttonVariants({ variant: "outline" })` (faixa azul global em `globals.css`).
- Versão do app: `1.2.0` (`src/config/app.ts`).
- Não usar `git stash` sem tag; commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0135_proposta_documento_textos.sql` | tabelas `empresas_emissoras`, `proposta_secoes_padrao`; colunas novas; RPC `atualizar_textos_versao_final`; `ler_orcamento_publico` com textos |
| `supabase/tests/proposta_documento_textos_0135.sql` | teste SQL da 0135 |
| `src/lib/orcamento/texto-rico.ts` (+ `.test.ts`) | tipo/schema do texto formatado, normalização, vazio, plano |
| `src/lib/orcamento/textos-proposta.ts` (+ `.test.ts`) | `TextosProposta`, resolver textos da demanda/versão, legado |
| `src/lib/orcamento/visao-interna.ts` (+ `.test.ts`) | grupos de custos efetivos, operacionais com compensação, rateio, fundos |
| `src/lib/orcamento/documento-proposta.ts` (+ `.test.ts`) | modelo do documento A4 |
| `src/lib/orcamento/empresas-emissoras.ts` | tipo `EmpresaEmissora`, leitura e fallback da identidade |
| `src/components/orcamento/texto/TextoRico.tsx` | render do texto formatado |
| `src/components/orcamento/texto/EditorTextoRico.tsx` | editor TipTap (cliente) |
| `src/components/orcamento/texto/EditarSecaoTexto.tsx` | ver/editar uma seção e salvar via server action |
| `src/components/orcamento/interno/PainelInterno.tsx` | quadro de totais + subabas (cliente) |
| `src/components/orcamento/interno/TabelaItens.tsx`, `TabelaOperacionais.tsx`, `TabelaFundos.tsx` | tabelas das subabas |
| `src/components/orcamento/interno/EditorPercentuais.tsx` | inputs com prévia do novo total |
| `src/components/orcamento/documento/DocumentoProposta.tsx` | folha A4 |
| `src/components/orcamento/elaboracao/CabecalhoOrcamento.tsx` | cabeçalho compacto |
| `src/components/orcamento/elaboracao/ClienteCadastradoSelect.tsx` | escolha do cliente com preenchimento |
| `src/lib/actions/orcamento-textos.ts` | salvar textos (demanda/versão) e seções padrão |
| `src/lib/actions/orcamento-historico.ts` | + `reemitirComPercentuais` |
| `src/lib/actions/demandas.ts` | snapshot enriquecido; campos novos do cliente; retorno dos parâmetros |
| `src/lib/orcamento/final-exporters.ts` | DOCX a partir do modelo do documento |
| `src/app/orcamento/final/[id]/page.tsx` | página com abas |
| `src/app/orcamento/demandas/[id]/page.tsx` | cabeçalho, formulário, etapa Proposta |
| `src/app/aprovar/[token]/page.tsx` | documento no link público |
| `src/app/orcamento/parametros/page.tsx` | textos padrão por empresa |
| `src/lib/cadastros/config.ts` | cadastro "Empresas emissoras" |
| `src/lib/testing/mock-supabase.ts` | tabelas novas no simulado |

---

### Task 1: Migration 0135 e tipos

**Files:** Create `supabase/migrations/0135_proposta_documento_textos.sql`, `supabase/tests/proposta_documento_textos_0135.sql`; Modify `src/lib/supabase/database.types.ts`.

**Produces:** tabelas `empresas_emissoras(id bigint, codigo text unique, nome_legal, cnpj, endereco, telefone, email, site, atualizado_em)`, `proposta_secoes_padrao(id, empresa_codigo, chave, titulo, texto jsonb, ordem int, ativo bool)`; colunas `demandas_propostas.cliente_email|cliente_telefone|cliente_endereco text`, `demandas_propostas.textos_proposta jsonb`, `orcamento_final_versoes.textos_proposta jsonb`; RPC `atualizar_textos_versao_final(p_versao_id bigint, p_textos jsonb) returns jsonb` ({id, status}); `ler_orcamento_publico` devolve `versao.textos_proposta`.

- [ ] Migration em `begin/commit`, `lock_timeout 5s`; seeds ATGC/GIA (nomes da `identidade-institucional.ts`) e 4 seções por empresa (chaves `prazos`, `responsabilidades`, `condicoes`, `confidencialidade`, ordens 10/20/30/40) com textos em JSON de texto formatado.
- [ ] RLS: select `authenticated using (true)`; insert/update/delete `kontrol_private.tem_permissao_efetiva('cadastros.editar')` (empresas) e `('orcamentos.emitir')` (seções); triggers `fn_auditoria`.
- [ ] RPC: `security definer`, `kontrol_private.exigir_permissao('orcamentos.emitir')`, `jsonb_typeof(p_textos)='object'`, status em (`emitido`,`enviado`,`alterado_reenviado`) e `valido_ate >= current_date`, senão exceção `22023` com mensagem em português; `update ... set textos_proposta = p_textos`.
- [ ] `ler_orcamento_publico`: `create or replace` copiando a definição vigente (0132) e acrescentando `textos_proposta` ao objeto `versao`.
- [ ] Teste SQL (`begin ... rollback`): seeds existem; RPC recusa status `aprovado`; aceita `emitido` e grava.
- [ ] Aplicar no banco local (Docker `supabase_db_Estoque`, porta 54522) e rodar o teste; atualizar `database.types.ts` à mão (tabelas, colunas, função).
- [ ] Commit `feat(db): 0135 textos da proposta e empresas emissoras`.

### Task 2: Texto formatado (`texto-rico.ts`)

**Produces:**
```ts
export type MarcaTexto = { type: "bold" };
export type NoInline = { type: "text"; text: string; marks?: MarcaTexto[] } | { type: "hardBreak" };
export type NoParagrafo = { type: "paragraph"; content?: NoInline[] };
export type NoTitulo = { type: "heading"; attrs: { level: 3 }; content?: NoInline[] };
export type NoItemLista = { type: "listItem"; content: NoParagrafo[] };
export type NoLista = { type: "bulletList" | "orderedList"; content: NoItemLista[] };
export type NoBloco = NoParagrafo | NoTitulo | NoLista;
export type DocTexto = { type: "doc"; content: NoBloco[] };
export function normalizarTexto(valor: unknown): DocTexto | null; // string → parágrafos; doc → saneado; outro → null
export function docDeTextoPlano(texto: string | null | undefined): DocTexto | null;
export function textoVazio(doc: DocTexto | null | undefined): boolean;
export function textoParaPlano(doc: DocTexto | null | undefined): string;
export const LIMITE_TEXTO_CARACTERES = 20000;
```
- [ ] Testes: string com `\n\n` vira 2 parágrafos e `\n` vira `hardBreak`; nó desconhecido (`blockquote`, `image`) é descartado mantendo o texto; marca `italic` descartada, `bold` mantida; heading nível 1 vira 3; doc só com parágrafos vazios → `textoVazio` true; texto acima do limite → `null`; `textoParaPlano` junta listas com "• ".
- [ ] Implementar; `npx vitest run src/lib/orcamento/texto-rico.test.ts` verde; commit.

### Task 3: Textos da proposta (`textos-proposta.ts`)

**Consumes:** Task 2. **Produces:**
```ts
export type SecaoTexto = { chave: string; titulo: string; texto: DocTexto | null };
export type TextosProposta = { descricao: DocTexto | null; secoes: SecaoTexto[] };
export type SecaoPadrao = { chave: string; titulo: string; texto: unknown; ordem: number; ativo: boolean };
export function normalizarTextosProposta(valor: unknown): TextosProposta | null;
export function resolverTextosDemanda(args: { salvos: unknown; padroes: SecaoPadrao[]; escopoLegado: string | null }): TextosProposta;
export function textosDaVersao(args: { coluna: unknown; snapshot: unknown; escopoLegado: string | null; validadeTexto: string }): TextosProposta;
export const SECAO_CONDICOES_LEGADO: (validadeTexto: string) => SecaoTexto;
```
- [ ] Testes: padrão ativo entra na ordem; salvo sobrescreve pela chave; salvo com texto vazio mantém a seção vazia (não sai no documento); seção salva sem padrão continua; descrição cai no escopo legado; versão sem coluna usa snapshot; versão sem nada usa escopo + seção "Condições comerciais" legada.
- [ ] Implementar; testes verdes; commit.

### Task 4: Visão interna (`visao-interna.ts`)

**Consumes:** `reconciliarComposicao`/`ComponenteTecnico` (`proposta-final.ts`), `itemProjetoTotal`, `roundMoney`, `calcularFundos`. **Produces:**
```ts
export type GrupoCustoId = "laboratorio" | "PE" | "MC" | "MP" | "ST" | "VD" | "OU" | "analises_projeto";
export type ItemInterno = { id: string; grupo: GrupoCustoId; codigo: string | null; descricao: string; detalhe: string | null; quantidade: number; unidade: string | null; custoUnitario: number; custoTotal: number; precoReferencia: number | null; naProposta: number; descricaoAusente: boolean };
export type GrupoInterno = { id: GrupoCustoId; rotulo: string; rotuloCliente: string; itens: ItemInterno[]; custoTotal: number; naProposta: number; percentualDoTotal: number };
export type TipoOperacional = "imposto" | "taxa" | "fundo" | "margem";
export type LinhaOperacional = { chave: string; rotulo: string; tipo: TipoOperacional; percentualInformado: number; percentualSobrePreco: number; valorLimpo: number; impostoCompensado: number | null; parteNota: number | null };
export type VisaoInterna = { legado: boolean; grupos: GrupoInterno[]; custosEfetivos: number; efetivosCompensacao: { impostoCompensado: number; parteNota: number } | null; operacionais: LinhaOperacional[]; custosOperacionais: number; total: number; somaPercentual: number; fatorGrossUp: number };
export type EntradaVisaoInterna = { itensLaboratorio: ItemLabEntrada[]; custosProjeto: ItemProjetoEntrada[]; analisesProjeto: ItemLabEntrada[]; parametros: Array<{ chave: string; label: string; percentual: number; valorNominal: number }>; total: number; legado: boolean; nomesAnalises?: Record<string, string> };
export function montarVisaoInterna(e: EntradaVisaoInterna): VisaoInterna;
export function entradaDoSnapshot(snapshot: unknown, total: number, nomesAnalises?: Record<string, string>): EntradaVisaoInterna;
export type LinhaFundo = { chave: "reserva" | "investimentos"; rotulo: string; percentual: number; previsto: number; impostoCompensado: number | null; liberado: number | null; usado: number | null; saldo: number | null };
export function montarFundos(v: VisaoInterna, acompanhamento: FundosLancamentos | null): { linhas: LinhaFundo[]; percentualRecebido: number | null };
```
- [ ] Testes com o cenário da maquete (custos 1.260 lab em 2 análises, PE 4.800 = 4 meses × 1.200, MC 600 + 340; impostos 10, incubação 5, reserva 2,5, investimentos 1, lucro 2): total 8.750,00; grupos só com itens (sem ST/VD); `naProposta` soma 8.750,00; incubação `percentualSobrePreco` 4,5 e valor 393,75; Σ impostoCompensado das linhas não tributárias + efetivos = 875,00 e Σ parteNota = 8.750,00; percentualDoTotal lab 14,4; PE usa meses; item sem descrição → `descricaoAusente` e rótulo "Descrição não registrada na emissão"; legado → compensação `null`; fundos com recebido 4.375 e reserva usada 50 → liberado 109,38, saldo 59,38.
- [ ] Implementar; testes verdes; commit.

### Task 5: Snapshot da emissão enriquecido

**Files:** Modify `src/lib/actions/demandas.ts` (select dos custos com `descricao, unidade, categoria`; `nomes_analises`; `empresa_emissora`; `textos_proposta` resolvido), `src/lib/orcamento/empresas-emissoras.ts` (novo).
- [ ] `empresas-emissoras.ts`: `type EmpresaEmissora = { codigo: "ATGC" | "GIA"; nomeLegal: string; cnpj: string | null; endereco: string | null; telefone: string | null; email: string | null; site: string | null }`; `empresaDeLinha(row)`, `empresaPadrao(identidade)`.
- [ ] Ajustar o teste existente de emissão (`demandas-emissao-transacional.test.ts`) para verificar as chaves novas do snapshot; verde; commit.

### Task 6: Modelo do documento e DOCX

**Consumes:** Tasks 3–5. **Produces:** `montarDocumentoProposta(args: { versao: VersaoDoc; snapshot: unknown; demanda: DemandaDoc | null; textos: TextosProposta; empresa: EmpresaEmissora | null; nomesAnalises?: Record<string,string> }): ModeloDocumentoProposta` (campos: identidade, empresa, numero, versao, status, emitidoEm, validoAte, validadeDias, cliente{nome, documento, endereco, contato, email, telefone}, resumo{total, prazoDias, amostras}, objeto{titulo, modalidade, descricao}, escopo|null, servicos{grupos[{titulo, itens[{descricao, quantidade, valorUnitario, valorTotal}], subtotal}], total}, secoes[{numero, chave, titulo, linhasAutomaticas, texto}], avisos).
- [ ] Testes: grupos com nomes do cliente (sem "PE"/"MC"); soma dos itens = total; seções vazias fora e numeração contínua a partir de 4; "prazos" recebe a linha automática da validade; cliente sem cadastro mostra só o que existe.
- [ ] `final-exporters.ts`: DOCX a partir do modelo (cabeçalho com dados da empresa, cliente, seções com texto formatado → parágrafos/listas/negrito); atualizar `final-exporters.test.ts`; commit.

### Task 7: Componentes de texto e documento

- [ ] `npm install @tiptap/react @tiptap/pm @tiptap/starter-kit`.
- [ ] `TextoRico` (render), `EditorTextoRico` (StarterKit só com parágrafo, heading 3, listas, negrito, hardBreak; `immediatelyRender: false`), `EditarSecaoTexto` (ver/editar; envia `textos` JSON completo com a seção trocada para a action recebida).
- [ ] `DocumentoProposta` (servidor) renderiza o modelo em A4 (`.folha-documento`), aceitando `edicao?: { destino: "versao" | "demanda"; id: number; textos: TextosProposta }`.
- [ ] CSS de impressão A4 retrato em `globals.css` (quebras, rodapé "Página X de Y" já existente).
- [ ] Actions em `orcamento-textos.ts`: `salvarTextosVersao(estado, formData)` (RPC) e `salvarTextosDemanda(estado, formData)` (update com `.select("id")`), ambos validando com `normalizarTextosProposta`; commit.

### Task 8: Proposta emitida com abas

- [ ] `page.tsx`: cabeçalho de uma linha, abas por `?aba=` (Interno padrão), documento `hidden print:block` quando a aba é Interno; Interno = `PainelInterno` + linha do link + auditoria recolhida; busca `nomes` das análises (snapshot ou catálogo), `empresas_emissoras`, `orcamento_fundos_acompanhamento`.
- [ ] `PainelInterno` (cliente) com quadro fixo e subabas (Resumo, grupos com itens, operacionais, fundos), sincronizando `?sub=`.
- [ ] `EditorPercentuais` + `reemitirComPercentuais` (permissões `emitir_final` e `editar_parametros`; custos do snapshot; `emitir_orcamento_final_transacional` com `p_operacao_id`; atualiza percentuais da demanda; redireciona para a nova versão). Bloqueado para legado, aprovada ou com outra aprovada.
- [ ] Commit.

### Task 9: Link público, cadastro de empresas, textos padrão

- [ ] `/aprovar/[token]`: usa `DocumentoProposta` (sem edição) + bloco de aprovação existente.
- [ ] `cadastros/config.ts`: "Empresas emissoras" (sem criar/excluir; código só leitura).
- [ ] `/orcamento/parametros`: "Textos padrão da proposta" por empresa (editar título/texto/ordem/ativo, criar seção); actions em `orcamento-textos.ts`; commit.

### Task 10: Elaboração

- [ ] `CabecalhoOrcamento` substitui o bloco de 8 caixas + 3 textos; faixa de etapas estreita.
- [ ] Formulário em 4 grupos (grade 12 colunas) com e-mail, telefone, endereço; `ClienteCadastradoSelect` preenche pelo cadastro; `salvarDemanda` grava os 3 campos novos (update complementar com confirmação).
- [ ] Etapa Proposta: abas Interno (visão viva + `EditorPercentuais` com `salvarParametrosEconomicosDaDemanda`, retorno `?etapa=final`) e Documento (prévia com edição de textos da demanda); remove Resumo executivo/econômico/composição/detalhamento duplicados; commit.

### Task 11: Simulado, E2E e verificação

- [ ] `mock-supabase.ts`: tabelas novas, RPC `atualizar_textos_versao_final`.
- [ ] Atualizar `e2e/orcamento-emissao.spec.ts`, `orcamento-pdf.spec.ts`, `usabilidade-onda1.spec.ts` para as abas; `npm run verify` verde.
- [ ] Conferência visual no app local (proposta emitida, A4 impresso em PDF, elaboração); versão 1.2.0; relatório curto em `docs/`; commit e PR.
