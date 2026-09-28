# Orçamento de projeto: catálogo vivo, plano de implementação (fases A e B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fazer com que o tipo do orçamento decida o que entra na conta (Fase A) e que a conclusão da revisão dos custos de projeto alimente um catálogo único de valores de referência (Fase B). O catálogo recebe itens novos e sobrepõe os valores alterados; vale a última revisão concluída; linha não alterada nunca desfaz um valor mais novo; valores de pessoal aparecem e são gravados só por quem tem a permissão "Valores de pessoal no orçamento".

**Architecture:**
- **Fase A** mexe só em funções puras (`consolidarOrcamentoFinal`, `montarEtapasProposta`, `planejarModulosProposta`) e nos seus chamadores.
- **Fase B** põe a regra inteira no banco (migration 0137):
  - funções imutáveis de normalização e colunas geradas definem a identidade do item;
  - uma função interna (`kontrol_private.plano_catalogo_revisao`) decide linha a linha;
  - duas RPCs usam essa função: a prévia (somente leitura) e a conclusão (grava sob trava exclusiva).
  - O TypeScript apenas lê a prévia para mostrar selos e o resumo, sem repetir a regra.

**Tech Stack:** Next.js (App Router, server actions), React 19, Tailwind, Supabase (Postgres/RLS/RPC), vitest, Playwright (Supabase simulado), psql no contêiner `supabase_db_Estoque`.

Spec: `docs/superpowers/specs/2026-09-28-orcamento-projeto-catalogo-vivo-design.md` (decisões DC1–DC7).

## Global Constraints

- **Base:** branch `claude/budget-module-reorganization-143e54` (1.2.1), **depois** do commit das mudanças abertas nessa worktree (`modelos/page.tsx`, `governanca/page.tsx`, `parametros/page.tsx`, `DemandaForm.tsx`, `ParametrosEconomicosForm.tsx`, `demandas/nova/page.tsx`). Trabalhar numa worktree nova; não tocar nesses arquivos.
- Português do Brasil em toda a interface. Glossário: Orçamento = processo, Proposta = documento emitido. Ajuda contextual = `HelpTip` ("?"). Telas compactas.
- **Migration nova = `0137`** (0135 e 0136 já usadas). Só aditiva: sem `DROP TABLE`, `TRUNCATE`, remoção de coluna, RLS ou gatilho de auditoria; `begin;`…`commit;` uma vez cada, sozinhos na linha; sem `CONCURRENTLY`.
- Protocolo `docs/migracao-orcamento-projetos-protocolo.md` vale para o catálogo (herdado do app antigo): nada é apagado, repetidos viram `ativo = false` + `substituido_por`.
- Cálculo econômico inalterado: gross-up único (`calcularPropostaEconomica`). Propostas emitidas não são tocadas.
- **Nunca aplicar migration em produção nem fazer deploy** (ordem do dono de 28/09). Banco de teste = Docker local `supabase_db_Estoque`.
- Versão do app: `1.2.2` em `src/config/app.ts` (Task B6). Reajustar ao integrar com o PR #51.
- Não rodar `npm run build`/E2E na worktree que o dono usa com `npm run dev`; deixar o E2E para o CI.
- Não usar `git stash` sem tag. Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/orcamento/orcamento-final.ts` (+ `.test.ts`) | consolidação ignora módulo fora do tipo e gera pendência |
| `src/components/common/IconeAcao.tsx` (+ `.test.ts`) | ações de lista por ícone (Task A3); usado em `modelos/page.tsx` e `historico/page.tsx` |
| `src/lib/orcamento/etapas-proposta.ts` (+ `.test.ts`) | etapa de projeto só pelo tipo (DC6) |
| `src/lib/orcamento/garantir-modulos.ts` (+ `.test.ts`) | criação de módulo só pelo tipo (DC6) |
| `src/app/orcamento/demandas/[id]/page.tsx`, `src/lib/actions/demandas.ts` | chamadores sem `projetoAssociado` |
| `src/lib/auth/permissions.ts` (+ `.test.ts`) | permissão "Orçamentos: valores de pessoal" (`orcamentos.pessoal`, DC8) |
| `supabase/migrations/0137_catalogo_vivo_projeto.sql` | regra do pessoal, identidade do item, unificação, histórico, prévia, conclusão, listagem com origem |
| `supabase/tests/catalogo_vivo_projeto_0137.sql` | teste SQL da 0137 |
| `.github/workflows/ci.yml` | passo do teste 0137 |
| `src/lib/supabase/database.types.ts` | tipos das colunas, tabela e RPCs novas |
| `src/lib/project-budget/catalogo-vivo.ts` (+ `.test.ts`) | leitura da prévia, selos, resumo e mensagens |
| `src/lib/actions/orcamento-projetos.ts` (+ `.test.ts`) | conclusão pela RPC nova; `catalogo_valor_base` nas linhas vindas do catálogo |
| `src/lib/testing/mock-supabase.ts` | RPCs novas no Supabase simulado (E2E) |
| `src/components/orcamento/projeto/FormAcao.tsx` | mostra a mensagem devolvida pela ação |
| `src/components/orcamento/projeto/EditorCustosProjeto.tsx` | selos por linha e resumo do catálogo na confirmação |
| `src/components/orcamento/projeto/AdicionarDoCatalogo.tsx` | data e proposta de origem do valor escolhido |
| `src/config/app.ts` | versão 1.2.2 |

---

## FASE A — O tipo do orçamento decide o que entra

### Task A1: Consolidação ignora módulo fora do tipo

**Files:**
- Modify: `src/lib/orcamento/orcamento-final.ts` (início de `consolidarOrcamentoFinal`)
- Test: `src/lib/orcamento/orcamento-final.test.ts`

**Interfaces:**
- Produces: `PENDENCIA_LABORATORIO_FORA_DO_TIPO: string`, `PENDENCIA_PROJETO_FORA_DO_TIPO: string` (exportadas de `orcamento-final.ts`). `consolidarOrcamentoFinal` mantém a assinatura.

- [ ] **Step 1: Write the failing test** — acrescentar ao fim de `src/lib/orcamento/orcamento-final.test.ts` e trocar o import da linha 2 por `import { consolidarOrcamentoFinal, explicarOrigem, PENDENCIA_LABORATORIO_FORA_DO_TIPO, PENDENCIA_PROJETO_FORA_DO_TIPO } from "./orcamento-final";`

```ts
describe("consolidarOrcamentoFinal — o tipo do orçamento decide o que entra", () => {
  const lab = [{ n_amostras: 2, custo_unitario: 10, preco_unitario: 15 }];
  const proj = [{ rubrica: "MC", quantidade: 1, custo_unitario: 70 }];
  const revisados = { laboratorioRevisado: true, projetoRevisado: true };

  it("apenas projeto: análises esquecidas no laboratório não somam e bloqueiam a emissão", () => {
    const r = consolidarOrcamentoFinal({
      ...revisados,
      laboratorioExigido: false,
      projetoExigido: true,
      itensLaboratorio: lab,
      itensProjeto: proj,
      parametrosProjeto: {},
    });
    expect(r.totalLaboratorioCusto).toBe(0);
    expect(r.totalLaboratorioPreco).toBe(0);
    expect(r.totalProjetoCusto).toBe(70);
    expect(r.totalFinal).toBe(70);
    expect(r.pronto).toBe(false);
    expect(r.pendencias).toEqual([PENDENCIA_LABORATORIO_FORA_DO_TIPO]);
  });

  it("apenas análises: custos de projeto lançados não somam e bloqueiam a emissão", () => {
    const r = consolidarOrcamentoFinal({
      ...revisados,
      laboratorioExigido: true,
      projetoExigido: false,
      itensLaboratorio: lab,
      itensProjeto: proj,
      parametrosProjeto: {},
    });
    expect(r.totalProjetoCusto).toBe(0);
    expect(r.totalFinal).toBe(20);
    expect(r.pronto).toBe(false);
    expect(r.pendencias).toEqual([PENDENCIA_PROJETO_FORA_DO_TIPO]);
  });

  it("misto: soma os dois e aplica os parâmetros uma única vez", () => {
    const r = consolidarOrcamentoFinal({
      ...revisados,
      laboratorioExigido: true,
      projetoExigido: true,
      itensLaboratorio: lab,
      itensProjeto: proj,
      parametrosProjeto: { lucro: 30 },
    });
    expect(r.subtotalTecnico).toBe(90);
    expect(r.totalFinal).toBe(128.57);
    expect(r.pronto).toBe(true);
    expect(r.pendencias).toEqual([]);
  });

  it("módulo fora do tipo e vazio não gera pendência", () => {
    const r = consolidarOrcamentoFinal({
      ...revisados,
      laboratorioExigido: false,
      projetoExigido: true,
      itensLaboratorio: [],
      itensProjeto: proj,
      parametrosProjeto: {},
    });
    expect(r.pronto).toBe(true);
    expect(r.pendencias).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/orcamento/orcamento-final.test.ts`
Expected: FAIL. As constantes não existem (`undefined`) e o primeiro caso soma o laboratório (`totalLaboratorioCusto` 20).

- [ ] **Step 3: Write minimal implementation** — em `src/lib/orcamento/orcamento-final.ts`, antes de `export function consolidarOrcamentoFinal`, acrescentar:

```ts
// Regra do dono (28/09): o tipo do orçamento decide o que entra na conta.
// Módulo fora do tipo não soma; se tiver itens, a emissão fica pendente até o
// usuário mudar o tipo ou retirar os itens. Nada é descartado em silêncio.
export const PENDENCIA_LABORATORIO_FORA_DO_TIPO =
  'há análises no orçamento laboratorial, mas o tipo do orçamento não inclui laboratório: mude o tipo para "Projeto com análises laboratoriais" ou retire as análises';
export const PENDENCIA_PROJETO_FORA_DO_TIPO =
  'há custos de projeto lançados, mas o tipo do orçamento não inclui projeto: mude o tipo para "Projeto com análises laboratoriais" ou retire esses custos';
```

e trocar o começo do corpo da função, até a linha `const custoDiretoProjeto = ...`, por:

```ts
  const itensLaboratorio = args.laboratorioExigido ? args.itensLaboratorio : [];
  const itensProjeto = args.projetoExigido ? args.itensProjeto : [];
  const pendencias = [
    args.laboratorioExigido && !args.laboratorioRevisado ? "revisar custos laboratoriais" : null,
    args.projetoExigido && !args.projetoRevisado ? "revisar custos de projeto" : null,
    !args.laboratorioExigido && args.itensLaboratorio.length > 0 ? PENDENCIA_LABORATORIO_FORA_DO_TIPO : null,
    !args.projetoExigido && args.itensProjeto.length > 0 ? PENDENCIA_PROJETO_FORA_DO_TIPO : null,
  ].filter(Boolean) as string[];

  const custoLaboratorioTecnico = calcularTotalLaboratorioCusto(itensLaboratorio);
  const totalLaboratorioPreco = calcularTotalLaboratorioPreco(itensLaboratorio); // referência
  const custoDiretoProjeto = calcularTotalProjetoCusto(itensProjeto);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/orcamento src/lib/project-budget`
Expected: PASS (inclusive `valores-modulos.test.ts`, `proposta-final.test.ts` e `orcamento-projeto.test.ts`, que usam módulo fora do tipo sempre vazio).

- [ ] **Step 5: Commit**

```bash
git add src/lib/orcamento/orcamento-final.ts src/lib/orcamento/orcamento-final.test.ts
git commit -m "fix(orçamentos): o tipo do orçamento decide o que entra na conta

Módulo fora do tipo (ex.: análises esquecidas num orçamento 'Apenas projeto')
não soma e bloqueia a emissão com pendência explicando o que fazer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A2: Ligação com projeto não cria etapa de custos (DC6)

> DC6 confirmada pelo dono em 28/09: orçamento "Apenas análises" não mostra a etapa de projeto. A2 e A1 vão
> juntas; sem a A2, a tela contaria o módulo de projeto e a emissão o bloquearia.

**Files:**
- Modify: `src/lib/orcamento/etapas-proposta.ts:28-34,58`, `src/lib/orcamento/garantir-modulos.ts:50-55`, `src/app/orcamento/demandas/[id]/page.tsx:176,251,322`, `src/lib/actions/demandas.ts:68,80`
- Test: `src/lib/orcamento/etapas-proposta.test.ts:101-103`, `src/lib/orcamento/garantir-modulos.test.ts:39-42`

**Interfaces:**
- Produces: `EntradaEtapasProposta` e `planejarModulosProposta` **sem** o campo `projetoAssociado`.

- [ ] **Step 1: Write the failing tests** — em `etapas-proposta.test.ts`, trocar o caso "projeto associado força a etapa…" por:

```ts
  it("o tipo decide: orçamento só de análises não ganha etapa de projeto por estar ligado a um projeto", () => {
    expect(etapa("analises", "projeto")).toMatchObject({ aplicavel: false });
    expect(etapa("projeto_com_analises", "projeto")).toMatchObject({ aplicavel: true });
  });
```

e em `garantir-modulos.test.ts` trocar o caso equivalente por:

```ts
  it("o tipo decide: orçamento só de análises não cria módulo de projeto", () => {
    const p = planejarModulosProposta({ ...base, modalidade: "analises" });
    expect(p.projeto.acao).toBe("nao_aplicavel");
  });
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/lib/orcamento/etapas-proposta.test.ts src/lib/orcamento/garantir-modulos.test.ts`
Expected: PASS. O comportamento sem `projetoAssociado` já é esse, e os testes novos travam a regra. A falha aparece no Step 4 (typecheck), quando o campo for removido.

- [ ] **Step 3: Remove o campo e as leituras**
  - `src/lib/orcamento/etapas-proposta.ts`: apagar as duas linhas do tipo (`/** Projeto vinculado força a etapa… */` e `projetoAssociado?: boolean;`). Trocar a linha 58 por `const exigeProjeto = modalidadeExigeProjeto(args.modalidade);`.
  - `src/lib/orcamento/garantir-modulos.ts`: apagar `projetoAssociado?: boolean;` do parâmetro. Trocar `const exigeProj = modalidadeExigeProjeto(args.modalidade) || Boolean(args.projetoAssociado);` por `const exigeProj = modalidadeExigeProjeto(args.modalidade);`.
  - `src/app/orcamento/demandas/[id]/page.tsx`:
    - linha 176 vira `const exigeProjeto = modalidadeExigeProjeto(demanda.modalidade);`;
    - apagar `projetoAssociado: Boolean(demanda.projeto_id),` nas chamadas de `montarEtapasProposta` (≈251) e de `planejarModulosProposta` (≈322).
  - `src/lib/actions/demandas.ts`: apagar `projetoAssociado: Boolean(demanda.projeto_id),` (≈80) e trocar o tipo do parâmetro (≈68) por `demanda: { id: number; modalidade?: string | null },`.

- [ ] **Step 4: Typecheck e testes**

Run: `npm run typecheck && npx vitest run src/lib/orcamento src/lib/actions`
Expected: sem erros de tipo e todos os testes PASS. Se o typecheck apontar outro chamador com `projetoAssociado`, apagar a propriedade ali também.

- [ ] **Step 5: Commit**

```bash
git add src/lib/orcamento/etapas-proposta.ts src/lib/orcamento/etapas-proposta.test.ts src/lib/orcamento/garantir-modulos.ts src/lib/orcamento/garantir-modulos.test.ts "src/app/orcamento/demandas/[id]/page.tsx" src/lib/actions/demandas.ts
git commit -m "fix(orçamentos): ligação com projeto não cria etapa de custos (DC6)

O tipo do orçamento decide as etapas e os módulos. Para ter custos de
projeto, o tipo deve incluir projeto.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A3: Ações das listas por ícone (pedido do dono, 28/09)

Regra para todo o módulo Orçamentos: nas listas e tabelas, as ações aparecem só como ícone, com o nome ao passar
o mouse e para o leitor de tela.
- Ícones: editar = `Pencil`, arquivar = `Archive`, excluir ou remover = `Trash2`, duplicar = `Copy`,
  cancelar = `Ban`, reativar = `ArchiveRestore`.
- Links de navegação ("Abrir / PDF", "Comparar") e os botões grandes do topo continuam com texto.
- O editor de custos já segue a regra (`Pencil`, `Trash2`). As fases C, D e E usam este componente em toda ação
  nova.

> Coordenação: `modelos/page.tsx` e `historico/page.tsx` foram mexidos pela sessão da reorganização. Rodar esta
> task numa base que já tenha os commits dela e conferir com `git log -3 -- <arquivo>` que ninguém está com
> alteração aberta nesses arquivos.

**Files:**
- Create: `src/components/common/IconeAcao.tsx`
- Test: `src/components/common/IconeAcao.test.ts`
- Modify: `src/app/orcamento/modelos/page.tsx` (ações dos modelos e do catálogo), `src/app/orcamento/historico/page.tsx` (Duplicar e Cancelar da versão)

**Interfaces:**
- Produces: `IconeAcao({ icone: LucideIcon; rotulo: string })`, `CLASSE_BOTAO_ICONE: string`, `CLASSE_BOTAO_ICONE_PERIGO: string`.

- [ ] **Step 1: Write the failing test** — criar `src/components/common/IconeAcao.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Archive } from "lucide-react";
import { IconeAcao } from "./IconeAcao";

describe("IconeAcao", () => {
  it("mostra só o ícone, com o nome na dica e para o leitor de tela", () => {
    const html = renderToStaticMarkup(createElement(IconeAcao, { icone: Archive, rotulo: "Arquivar item" }));
    expect(html).toContain('title="Arquivar item"');
    expect(html).toContain('<span class="sr-only">Arquivar item</span>');
    expect(html).toContain("<svg");
    expect(html).toContain('aria-hidden="true"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/common/IconeAcao.test.ts`
Expected: FAIL, "Failed to resolve import ./IconeAcao".

- [ ] **Step 3: Write the component** — criar `src/components/common/IconeAcao.tsx`:

```tsx
import type { LucideIcon } from "lucide-react";

/**
 * Conteúdo de um botão de ação em lista (pedido do dono, 28/09): só o ícone na tela,
 * o nome ao passar o mouse (title) e para o leitor de tela (sr-only). Usar como
 * `trigger` de ConfirmActionButton/CancelarComMotivo ou `children` de SubmitButton,
 * com CLASSE_BOTAO_ICONE (ou _PERIGO para arquivar, excluir e cancelar).
 */
export function IconeAcao({ icone: Icone, rotulo }: { icone: LucideIcon; rotulo: string }) {
  return (
    <span className="inline-flex" title={rotulo}>
      <Icone className="size-4" aria-hidden />
      <span className="sr-only">{rotulo}</span>
    </span>
  );
}

export const CLASSE_BOTAO_ICONE =
  "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";

export const CLASSE_BOTAO_ICONE_PERIGO =
  "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger-strong disabled:cursor-not-allowed disabled:opacity-50";
```

- [ ] **Step 4: Run test**

Run: `npx vitest run src/components/common/IconeAcao.test.ts`
Expected: PASS.

- [ ] **Step 5: Usar nos Modelos e no catálogo** — em `src/app/orcamento/modelos/page.tsx`:
  - Trocar `import { Search, SlidersHorizontal } from "lucide-react";` por `import { Archive, Copy, Search, SlidersHorizontal } from "lucide-react";` e acrescentar `import { CLASSE_BOTAO_ICONE, CLASSE_BOTAO_ICONE_PERIGO, IconeAcao } from "@/components/common/IconeAcao";`.
  - Trocar o botão "Duplicar" do modelo:

```tsx
                            <SubmitButton variant="link" size="sm" className="h-auto p-0 text-xs font-medium text-brand-700 dark:text-brand-300" pendingLabel="Duplicando…">Duplicar</SubmitButton>
```

por

```tsx
                            <SubmitButton variant="ghost" size="icon" className={CLASSE_BOTAO_ICONE} pendingLabel="…">
                              <IconeAcao icone={Copy} rotulo="Duplicar modelo" />
                            </SubmitButton>
```

  - No `ConfirmActionButton` do modelo (`action={excluirTemplate}`), trocar `trigger="Arquivar"` por `trigger={<IconeAcao icone={Archive} rotulo="Arquivar modelo" />}` e `triggerClassName="text-xs font-medium text-danger-strong hover:underline"` por `triggerClassName={CLASSE_BOTAO_ICONE_PERIGO}`.
  - No `ConfirmActionButton` do catálogo (`action={arquivarCatalogoProjetoItem}`), trocar `trigger="Arquivar"` por `trigger={<IconeAcao icone={Archive} rotulo={`Arquivar ${item.descricao}`} />}` e o `triggerClassName` pelo mesmo `{CLASSE_BOTAO_ICONE_PERIGO}`.
  - No `<div className="flex justify-end gap-2">` das ações do modelo, trocar `gap-2` por `gap-1`.

- [ ] **Step 6: Usar no Histórico** — em `src/app/orcamento/historico/page.tsx`:
  - Trocar o import do lucide por `import { Ban, Copy, Search, SlidersHorizontal } from "lucide-react";` e acrescentar `import { CLASSE_BOTAO_ICONE, CLASSE_BOTAO_ICONE_PERIGO, IconeAcao } from "@/components/common/IconeAcao";`.
  - Trocar o `SubmitButton` "Duplicar" da versão por:

```tsx
                                <SubmitButton variant="ghost" size="icon" className={CLASSE_BOTAO_ICONE} pendingLabel="…">
                                  <IconeAcao icone={Copy} rotulo={`Duplicar a versão ${item.numero}`} />
                                </SubmitButton>
```

  - No `CancelarComMotivo` da versão, trocar `trigger="Cancelar"` por `trigger={<IconeAcao icone={Ban} rotulo={`Cancelar a versão ${item.numero}`} />}` e acrescentar `triggerClassName={CLASSE_BOTAO_ICONE_PERIGO}`.

- [ ] **Step 7: Verificar**

Run: `npm run typecheck && npm run lint && npx vitest run src/components src/app`
Expected: sem erros. Procurar nos E2E seletores por texto dessas ações (`rg -n "Duplicar|Arquivar|\"Cancelar\"" e2e`). Hoje só `baixa-estoque.spec.ts` usa "Cancelar", e é outro diálogo. Se aparecer algum de orçamento, trocar por `getByRole("button", { name: /Duplicar/ })`, que continua achando o botão pelo nome acessível.
Conferência visual no servidor de desenvolvimento desta worktree:
1. Em `/orcamento/modelos?rubrica=MP` e no Histórico, as ações aparecem só como ícone e o nome surge ao passar o mouse.
2. O diálogo de confirmação abre igual a antes.
3. Capturar a tela.

- [ ] **Step 8: Commit**

```bash
git add src/components/common/IconeAcao.tsx src/components/common/IconeAcao.test.ts src/app/orcamento/modelos/page.tsx src/app/orcamento/historico/page.tsx
git commit -m "feat(orçamentos): ações das listas por ícone, com nome na dica

Pedido do dono: arquivar, duplicar e cancelar viram ícones (nome ao passar o
mouse e para leitor de tela). Componente IconeAcao para as próximas telas.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## FASE B — Catálogo vivo: memória de valores

### Task B0: Permissão "Orçamentos: valores de pessoal" (DC8)

Decisão do dono (28/09): o valor de pessoal aparece para quem faz orçamento (coordenador e diretoria) e fica
oculto para os demais. Técnico não faz orçamento. Como todo técnico tem "Criar e editar orçamentos", a regra
usa uma permissão própria: por padrão coordenador, gestor e admin a têm; técnico não.

**Files:**
- Modify: `src/lib/auth/permissions.ts` (tipo `PermissaoUsuario`, lista `PERMISSOES`, descrição de `tecnicos.salario.ver`)
- Modify: `src/lib/actions/orcamento-projetos.ts` (mensagem de recusa em `adicionarCustoCatalogoProjetoInterno`)
- Test: `src/lib/auth/permissions.test.ts`

**Interfaces:**
- Produces: chave `"orcamentos.pessoal"` em `PermissaoUsuario`. O banco usa a mesma chave na Task B1.

- [ ] **Step 1: Write the failing test** — em `src/lib/auth/permissions.test.ts`, depois do caso "salario dos tecnicos…", acrescentar:

```ts
  it("valores de pessoal no orçamento: coordenador, gestor e admin por padrão; técnico não", () => {
    const pessoal = PERMISSOES.find((permissao) => permissao.key === "orcamentos.pessoal");
    expect(pessoal).toMatchObject({ label: "Valores de pessoal no orçamento", modulo: "Orçamentos" });

    for (const papel of ["coordenador", "gestor", "admin"]) {
      expect(normalizePermissions(papel, {})["orcamentos.pessoal"]).toBe(true);
    }
    expect(defaultPermissionsForRole("tecnico")).not.toContain("orcamentos.pessoal");
    expect(normalizePermissions("tecnico", {})["orcamentos.pessoal"]).toBe(false);
    // o administrador pode tirar de um coordenador específico
    expect(normalizePermissions("coordenador", { "orcamentos.pessoal": false })["orcamentos.pessoal"]).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/permissions.test.ts`
Expected: FAIL, porque `pessoal` é `undefined`.

- [ ] **Step 3: Implement**
  - Em `PermissaoUsuario`, depois de `| "orcamentos.modelos"`, acrescentar `| "orcamentos.pessoal"` (o `;` passa para a nova última linha).
  - Em `PERMISSOES`, depois da entrada `orcamentos.modelos`, acrescentar:

```ts
  {
    // Padrão: coordenador, gestor e admin (quem faz orçamento); técnico não (decisão do dono, 28/09).
    // O banco aplica a mesma regra (kontrol_private.pode_ver_pessoal_orcamento, migration 0137).
    key: "orcamentos.pessoal",
    modulo: "Orçamentos",
    label: "Valores de pessoal no orçamento",
    descricao:
      "Ver e lançar os valores de pessoal (PE) no orçamento de projeto e no catálogo de custos. Sem ela, o valor aparece como XXX.",
  },
```

  - Na lista `COORDENADOR`, depois de `"orcamentos.cancelar",`, acrescentar `"orcamentos.pessoal",`. O gestor herda, porque a lista dele começa com `...COORDENADOR`.
  - Na entrada `tecnicos.salario.ver`, trocar a `descricao` por `"Ver e alterar o salário dos técnicos. Também mostra os valores de pessoal (PE) do catálogo de custos. Sem ela, o salário aparece como XXX."`.
  - Em `src/lib/actions/orcamento-projetos.ts`, em `adicionarCustoCatalogoProjetoInterno`, trocar a mensagem do `throw` do preço mascarado por:
    `"Valores de pessoal (PE) do catálogo exigem a permissão “Valores de pessoal no orçamento”. Peça ao administrador em Usuários."`

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/auth src/lib/actions src/components && npm run typecheck`
Expected: PASS. Se algum teste contar as permissões ou comparar a matriz de privilégios (`PrivilegiosMatriz`, `PermissoesCategoriasTable`), atualizar a contagem ou a lista esperada com a chave nova.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/permissions.ts src/lib/auth/permissions.test.ts src/lib/actions/orcamento-projetos.ts
git commit -m "feat(permissões): Valores de pessoal no orçamento (coordenador e gestor)

Decisão do dono: quem faz orçamento (coordenador e diretoria) vê e lança os
valores de pessoal; quem não tem a permissão vê XXX. Separada de 'Criar e
editar orçamentos', que todo técnico tem.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B1: Migration 0137 e teste SQL

**Files:**
- Create: `supabase/migrations/0137_catalogo_vivo_projeto.sql`
- Create: `supabase/tests/catalogo_vivo_projeto_0137.sql`
- Modify: `.github/workflows/ci.yml` (novo passo depois do último `Validar …` de SQL)

**Interfaces:**
- Produces (banco):
  - `public.previa_catalogo_revisao_projeto(p_orcamento_projeto_id bigint)` → `table(linha_id bigint, rubrica text, descricao text, unidade text, valor numeric, catalogo_item_id text, acao text, valor_catalogo numeric, valor_catalogo_em timestamptz)`, onde `acao ∈ {novo, atualizar, vincular, inalterado, repetido, pendente_permissao}`.
  - `public.concluir_revisao_custos_projeto(p_orcamento_projeto_id bigint, p_observacao text default null)` → `jsonb {novos, atualizados, pendentes, repetidos}`.
  - Coluna `orcamento_projeto_custos.catalogo_valor_base numeric`.
  - `orcamento_projeto_catalogo_listar()` passa a devolver também `substituido_por`, `valor_atualizado_em`, `valor_atualizado_por`, `valor_origem_demanda_id` e `valor_origem_demanda_titulo`.

- [ ] **Step 1: Write the failing test** — criar `supabase/tests/catalogo_vivo_projeto_0137.sql`:

```sql
-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1
-- e PGCLIENTENCODING=UTF8. Os valores de referencia (MC-6, MC-14, MC-30, MC-36) sao os da
-- carga da 0012 (banco novo do CI).
-- Valida a 0137: identidade do item, unificacao dos repetidos, historico, previa e
-- conclusao (item novo, valor alterado, vinculo, repetido no orcamento, vale o ultimo a
-- concluir, linha nao alterada nao desfaz valor mais novo, pessoal sem permissao pendente)
-- e permissoes. Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0137-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0137-' || p_rotulo)::uuid,
                      'email', 'ts-0137-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated',
                      'app_metadata', json_build_object('senha_provisoria', false))::text, true);
end $$;

create function pg_temp.linha(p_orc text, p_rubrica text, p_descricao text, p_unidade text,
                              p_valor numeric, p_item text default null, p_base numeric default null)
returns bigint language plpgsql as $$
declare
  v_id bigint;
begin
  insert into public.orcamento_projeto_custos
    (orcamento_projeto_id, categoria, rubrica, descricao, quantidade, unidade, custo_unitario,
     preco_unitario, catalogo_item_id, catalogo_valor_base, origem)
  values (current_setting('ts0137.' || p_orc)::bigint,
          case p_rubrica when 'PE' then 'mao_obra' when 'ST' then 'terceiros' else 'materiais' end,
          p_rubrica, p_descricao, 1, p_unidade, p_valor, p_valor, p_item, p_base,
          case when p_item is null then 'manual' else 'catalogo' end)
  returning id into v_id;
  return v_id;
end $$;

create function pg_temp.acao(p_orc text, p_linha text) returns text language sql as $$
  select acao from public.previa_catalogo_revisao_projeto(current_setting('ts0137.' || p_orc)::bigint)
   where linha_id = current_setting('ts0137.' || p_linha)::bigint
$$;

-- ---------------------------------------------------------------------------
-- 1. Estrutura, grants e normalizacao
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.previa_catalogo_revisao_projeto(bigint)',
    'public.concluir_revisao_custos_projeto(bigint,text)',
    'public.orcamento_projeto_catalogo_listar()'
  ] loop
    if to_regprocedure(f) is null then
      raise exception '0137: funcao ausente: %', f;
    end if;
    if has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '0137: anon executa %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0137: authenticated sem EXECUTE em %', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'kontrol_private.plano_catalogo_revisao(bigint)', 'EXECUTE') then
    raise exception '0137: plano interno exposto a authenticated';
  end if;
  if to_regprocedure('kontrol_private.pode_ver_pessoal_orcamento()') is null then
    raise exception '0137: regra de pessoal no orcamento ausente';
  end if;
  if (select permissoes -> 'orcamentos.pessoal' from public.permissoes_categorias where papel = 'coordenador') is distinct from 'true'::jsonb
     or (select permissoes -> 'orcamentos.pessoal' from public.permissoes_categorias where papel = 'gestor') is distinct from 'true'::jsonb
     or (select permissoes -> 'orcamentos.pessoal' from public.permissoes_categorias where papel = 'tecnico') = 'true'::jsonb then
    raise exception '0137: padrao das categorias para valores de pessoal (coordenador e gestor sim, tecnico nao)';
  end if;
  if has_table_privilege('authenticated', 'public.orcamento_projeto_catalogo_valores', 'SELECT')
     or has_table_privilege('authenticated', 'public.orcamento_projeto_catalogo_valores', 'INSERT') then
    raise exception '0137: historico de valores com acesso direto';
  end if;
  if has_column_privilege('authenticated', 'public.orcamento_projeto_catalogo', 'preco_unitario', 'SELECT') then
    raise exception '0137: preco do catalogo voltou a ser legivel direto (0112)';
  end if;
  if not has_column_privilege('authenticated', 'public.orcamento_projeto_catalogo', 'valor_atualizado_em', 'SELECT') then
    raise exception '0137: origem do valor ilegivel';
  end if;
  if to_regclass('public.orcamento_projeto_catalogo_item_unico_uidx') is null then
    raise exception '0137: indice unico do item ausente';
  end if;

  if kontrol_private.normalizar_texto_catalogo('  Álcool   ETÍLICO ') <> 'alcool etilico'
     or kontrol_private.normalizar_texto_catalogo('   ') is not null then
    raise exception '0137: normalizacao da descricao';
  end if;
  if kontrol_private.normalizar_unidade_catalogo('Litro') <> 'l'
     or kontrol_private.normalizar_unidade_catalogo('unid.') <> 'un'
     or kontrol_private.normalizar_unidade_catalogo(null) <> 'un'
     or kontrol_private.normalizar_unidade_catalogo('Meses') <> 'mes'
     or kontrol_private.normalizar_unidade_catalogo('pct c/ 500') <> 'pct c/ 500' then
    raise exception '0137: normalizacao da unidade';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Unificacao dos repetidos e carga inicial do historico
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from public.orcamento_projeto_catalogo
     where substituido_por is null and chave_descricao is not null
     group by rubrica, chave_descricao, chave_unidade
    having count(*) > 1
  ) then
    raise exception '0137: item repetido sem unificar';
  end if;
  if exists (
    select 1
      from public.orcamento_projeto_catalogo u
      join public.orcamento_projeto_catalogo k on k.id = u.substituido_por
     where u.ativo
        or k.substituido_por is not null
        or (k.rubrica, k.chave_descricao, k.chave_unidade)
           is distinct from (u.rubrica, u.chave_descricao, u.chave_unidade)
  ) then
    raise exception '0137: unificacao fora da regra (mesmo item, destino vigente, unificado inativo)';
  end if;
  if exists (select 1 from public.orcamento_projeto_catalogo where id = 'MC-14' and preco_unitario = 150)
     and exists (select 1 from public.orcamento_projeto_catalogo where id = 'MC-30' and preco_unitario = 80)
     and (select substituido_por from public.orcamento_projeto_catalogo where id = 'MC-30') is distinct from 'MC-14' then
    raise exception '0137: Caixa termica repetida nao ficou com o maior valor (DC1)';
  end if;
  if exists (
    select 1 from public.orcamento_projeto_catalogo c
     where not exists (select 1 from public.orcamento_projeto_catalogo_valores v where v.catalogo_item_id = c.id)
  ) then
    raise exception '0137: item sem historico de valor';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures (como owner; nao dependem de seed alem da carga da 0012)
-- ---------------------------------------------------------------------------
do $$
declare
  v_rotulo text;
  v_nome text;
  v_demanda bigint;
  v_projeto bigint;
begin
  foreach v_rotulo in array array['coord_pessoal', 'coord_sem', 'tecnico'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0137-' || v_rotulo)::uuid,
            'authenticated', 'authenticated', 'ts-0137-' || v_rotulo || '@example.invalid', now(), now());
  end loop;
  update public.perfis set papel = 'coordenador', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": true, "orcamentos.emitir": true, "orcamentos.pessoal": true, "tecnicos.salario.ver": false}'::jsonb
   where id = md5('kontrol-0137-coord_pessoal')::uuid;
  update public.perfis set papel = 'coordenador', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": true, "orcamentos.emitir": true, "orcamentos.pessoal": false, "tecnicos.salario.ver": false}'::jsonb
   where id = md5('kontrol-0137-coord_sem')::uuid;
  update public.perfis set papel = 'tecnico', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": true, "orcamentos.emitir": false}'::jsonb
   where id = md5('kontrol-0137-tecnico')::uuid;

  -- Um orcamento de projeto por proposta (indice de modulo ativo da 0126).
  foreach v_nome in array array['a', 'b', 'c', 'd', 'e', 'f'] loop
    insert into public.demandas_propostas (titulo, cliente_nome, status, modalidade)
    values ('TS-0137 proposta ' || v_nome, 'Cliente TS-0137', 'orcada', 'projeto')
    returning id into v_demanda;
    insert into public.orcamento_projetos (demanda_id, titulo)
    values (v_demanda, 'TS-0137 projeto ' || v_nome)
    returning id into v_projeto;
    perform set_config('ts0137.' || v_nome, v_projeto::text, true);
    perform set_config('ts0137.demanda_' || v_nome, v_demanda::text, true);
  end loop;

  -- A (coord_pessoal): novo, inalterado, atualizar, vincular, pessoal novo
  perform set_config('ts0137.a1', pg_temp.linha('a', 'MC', 'TS-0137 Reagente Alfa', 'un', 100)::text, true);
  perform set_config('ts0137.a2', pg_temp.linha('a', 'MC', 'Álcool etílico', 'litro', 130, 'MC-36', 130)::text, true);
  perform set_config('ts0137.a3', pg_temp.linha('a', 'MC', 'Papel toalha', 'fardo', 55, 'MC-6', 50)::text, true);
  perform set_config('ts0137.a4', pg_temp.linha('a', 'MC', 'alcool ETILICO', 'Litro', 130)::text, true);
  perform set_config('ts0137.a5', pg_temp.linha('a', 'PE', 'TS-0137 Pesquisador', 'mês', 9000)::text, true);
  -- B (coord_sem): pessoal sem permissao fica pendente; material novo entra
  perform set_config('ts0137.b1', pg_temp.linha('b', 'PE', 'TS-0137 Bolsista', 'mês', 4000)::text, true);
  perform set_config('ts0137.b2', pg_temp.linha('b', 'MC', 'TS-0137 Reagente Beta', 'un', 200)::text, true);
  -- C e D: mesmo item novo com valores diferentes; D conclui antes, C depois
  perform set_config('ts0137.c1', pg_temp.linha('c', 'MC', 'TS-0137 Reagente Gama', 'un', 100)::text, true);
  perform set_config('ts0137.d1', pg_temp.linha('d', 'MC', 'ts-0137 reagente  GAMA', 'UN', 120)::text, true);
  -- E: linha antiga do catalogo, sem alteracao (Papel toalha a 50)
  perform set_config('ts0137.e1', pg_temp.linha('e', 'MC', 'Papel toalha', 'fardo', 50, 'MC-6', 50)::text, true);
  -- F: o mesmo item duas vezes no mesmo orcamento; vale a ultima linha
  perform set_config('ts0137.f1', pg_temp.linha('f', 'ST', 'TS-0137 Frete', 'un', 300)::text, true);
  perform set_config('ts0137.f2', pg_temp.linha('f', 'ST', 'TS-0137 frete', 'unid', 350)::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Tecnico sem orcamentos.emitir nao conclui
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.como('tecnico');

do $$
begin
  begin
    perform public.concluir_revisao_custos_projeto(current_setting('ts0137.a')::bigint, null);
    raise exception '0137: tecnico sem orcamentos.emitir concluiu a revisao';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Coordenador com "Valores de pessoal no orcamento" (sem salario dos tecnicos):
--    previa e conclusao de A, D, C, E, F
-- ---------------------------------------------------------------------------
select pg_temp.como('coord_pessoal');

do $$
declare
  v_catalogo numeric;
  v_resultado jsonb;
begin
  if pg_temp.acao('a', 'a1') <> 'novo' then raise exception '0137: a1 deveria ser novo'; end if;
  if pg_temp.acao('a', 'a2') <> 'inalterado' then raise exception '0137: a2 deveria ser inalterado'; end if;
  if pg_temp.acao('a', 'a3') <> 'atualizar' then raise exception '0137: a3 deveria atualizar'; end if;
  if pg_temp.acao('a', 'a4') <> 'vincular' then raise exception '0137: a4 deveria vincular ao MC-36'; end if;
  if pg_temp.acao('a', 'a5') <> 'novo' then raise exception '0137: a5 (pessoal, com permissao) deveria ser novo'; end if;
  select valor_catalogo into v_catalogo
    from public.previa_catalogo_revisao_projeto(current_setting('ts0137.a')::bigint)
   where linha_id = current_setting('ts0137.a3')::bigint;
  if v_catalogo is distinct from 50 then raise exception '0137: previa sem o valor atual do catalogo (50): %', v_catalogo; end if;

  v_resultado := public.concluir_revisao_custos_projeto(current_setting('ts0137.a')::bigint, null);
  if v_resultado <> '{"novos": 2, "atualizados": 1, "pendentes": 0, "repetidos": 0}'::jsonb then
    raise exception '0137: resumo da conclusao de A: %', v_resultado;
  end if;

  begin
    perform public.concluir_revisao_custos_projeto(current_setting('ts0137.a')::bigint, null);
    raise exception '0137: concluiu de novo uma revisao ja concluida';
  exception when invalid_parameter_value then null;
  end;

  -- vale o ultimo a concluir: D (120) antes, C (100) depois
  perform public.concluir_revisao_custos_projeto(current_setting('ts0137.d')::bigint, null);
  perform public.concluir_revisao_custos_projeto(current_setting('ts0137.c')::bigint, null);

  -- linha antiga nao desfaz: E mantem 50, o catalogo ja tem 55 (de A)
  if pg_temp.acao('e', 'e1') <> 'inalterado' then raise exception '0137: e1 deveria ser inalterado'; end if;
  select valor_catalogo into v_catalogo
    from public.previa_catalogo_revisao_projeto(current_setting('ts0137.e')::bigint)
   where linha_id = current_setting('ts0137.e1')::bigint;
  if v_catalogo is distinct from 55 then raise exception '0137: e1 deveria mostrar o valor mais novo (55): %', v_catalogo; end if;
  perform public.concluir_revisao_custos_projeto(current_setting('ts0137.e')::bigint, null);

  -- repetido no mesmo orcamento
  if pg_temp.acao('f', 'f1') <> 'repetido' or pg_temp.acao('f', 'f2') <> 'novo' then
    raise exception '0137: F deveria ter f1 repetido e f2 novo';
  end if;
  v_resultado := public.concluir_revisao_custos_projeto(current_setting('ts0137.f')::bigint, null);
  if v_resultado <> '{"novos": 1, "atualizados": 0, "pendentes": 0, "repetidos": 1}'::jsonb then
    raise exception '0137: resumo da conclusao de F: %', v_resultado;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Coordenador sem "Valores de pessoal no orcamento": pessoal mascarado e pendente
-- ---------------------------------------------------------------------------
select pg_temp.como('coord_sem');

do $$
declare
  v_catalogo numeric;
  v_resultado jsonb;
begin
  if pg_temp.acao('b', 'b1') <> 'pendente_permissao' then raise exception '0137: b1 deveria ficar pendente'; end if;
  if pg_temp.acao('b', 'b2') <> 'novo' then raise exception '0137: b2 deveria ser novo'; end if;
  select valor_catalogo into v_catalogo
    from public.previa_catalogo_revisao_projeto(current_setting('ts0137.a')::bigint)
   where linha_id = current_setting('ts0137.a5')::bigint;
  if v_catalogo is not null then raise exception '0137: valor de pessoal exposto sem permissao'; end if;
  v_resultado := public.concluir_revisao_custos_projeto(current_setting('ts0137.b')::bigint, null);
  if v_resultado <> '{"novos": 1, "atualizados": 0, "pendentes": 1, "repetidos": 0}'::jsonb then
    raise exception '0137: resumo da conclusao de B: %', v_resultado;
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- 6. Estado final do catalogo, do historico e das linhas
-- ---------------------------------------------------------------------------
do $$
declare
  v_alfa text;
  v_gama text;
  v_frete text;
begin
  select id into v_alfa from public.orcamento_projeto_catalogo
   where rubrica = 'MC' and chave_descricao = 'ts-0137 reagente alfa' and substituido_por is null;
  if v_alfa is null
     or v_alfa !~ '^MC-[0-9]+$' or substring(v_alfa from 4)::int < 101
     or not exists (
       select 1 from public.orcamento_projeto_catalogo
        where id = v_alfa and preco_unitario = 100 and origem = 'revisao_custos' and ativo
          and valor_atualizado_por = 'ts-0137-coord_pessoal@example.invalid'
          and valor_origem_demanda_id = current_setting('ts0137.demanda_a')::bigint
          and valor_origem_orcamento_projeto_id = current_setting('ts0137.a')::bigint) then
    raise exception '0137: item novo de A gravado errado (%)', v_alfa;
  end if;
  if (select catalogo_item_id from public.orcamento_projeto_custos where id = current_setting('ts0137.a1')::bigint) is distinct from v_alfa
     or (select catalogo_valor_base from public.orcamento_projeto_custos where id = current_setting('ts0137.a1')::bigint) is distinct from 100 then
    raise exception '0137: linha a1 nao ficou ligada ao item novo';
  end if;
  if (select catalogo_item_id from public.orcamento_projeto_custos where id = current_setting('ts0137.a4')::bigint) is distinct from 'MC-36'
     or (select preco_unitario from public.orcamento_projeto_catalogo where id = 'MC-36') <> 130 then
    raise exception '0137: vinculo de a4 ao MC-36 errado';
  end if;
  if (select preco_unitario from public.orcamento_projeto_catalogo where id = 'MC-6') <> 55 then
    raise exception '0137: Papel toalha deveria ficar em 55 (A alterou; E, sem alteracao, nao desfaz)';
  end if;
  if not exists (
    select 1 from public.orcamento_projeto_catalogo_valores
     where catalogo_item_id = 'MC-6' and evento = 'valor_alterado' and preco_unitario = 55 and preco_anterior = 50
       and orcamento_projeto_id = current_setting('ts0137.a')::bigint and aplicado
  ) then
    raise exception '0137: historico da alteracao do MC-6 ausente';
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo
                  where rubrica = 'PE' and chave_descricao = 'ts-0137 pesquisador' and preco_unitario = 9000) then
    raise exception '0137: pessoal concluido com permissao nao entrou no catalogo';
  end if;
  if (select status from public.orcamento_projetos where id = current_setting('ts0137.a')::bigint) <> 'enviado'
     or not exists (select 1 from public.eventos_status
                     where entidade = 'orcamento_projeto' and entidade_id = current_setting('ts0137.a')::bigint
                       and para_status = 'enviado') then
    raise exception '0137: conclusao nao passou pela transicao de status';
  end if;

  -- B: pessoal pendente, sem item no catalogo
  if exists (select 1 from public.orcamento_projeto_catalogo where chave_descricao = 'ts-0137 bolsista') then
    raise exception '0137: pessoal sem permissao entrou no catalogo';
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo_valores
                  where evento = 'pendente_permissao' and not aplicado and preco_unitario = 4000
                    and descricao = 'TS-0137 Bolsista'
                    and demanda_id = current_setting('ts0137.demanda_b')::bigint) then
    raise exception '0137: pendencia de pessoal nao registrada';
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo
                  where rubrica = 'MC' and chave_descricao = 'ts-0137 reagente beta' and preco_unitario = 200) then
    raise exception '0137: material novo de B nao entrou';
  end if;

  -- C e D: vale o ultimo a concluir
  select id into v_gama from public.orcamento_projeto_catalogo
   where rubrica = 'MC' and chave_descricao = 'ts-0137 reagente gama' and substituido_por is null;
  if (select preco_unitario from public.orcamento_projeto_catalogo where id = v_gama) <> 100 then
    raise exception '0137: vale o ultimo a concluir (C = 100)';
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo_valores where catalogo_item_id = v_gama
                  and evento = 'item_novo' and preco_unitario = 120
                  and orcamento_projeto_id = current_setting('ts0137.d')::bigint)
     or not exists (select 1 from public.orcamento_projeto_catalogo_valores where catalogo_item_id = v_gama
                     and evento = 'valor_alterado' and preco_unitario = 100 and preco_anterior = 120
                     and orcamento_projeto_id = current_setting('ts0137.c')::bigint) then
    raise exception '0137: historico de C e D incompleto';
  end if;
  if (select count(*) from public.orcamento_projeto_custos
       where id in (current_setting('ts0137.c1')::bigint, current_setting('ts0137.d1')::bigint)
         and catalogo_item_id = v_gama) <> 2 then
    raise exception '0137: linhas de C e D nao ficaram no mesmo item';
  end if;

  -- F: um item so, com o valor da ultima linha; as duas linhas ligadas
  select id into v_frete from public.orcamento_projeto_catalogo
   where rubrica = 'ST' and chave_descricao = 'ts-0137 frete' and chave_unidade = 'un' and substituido_por is null;
  if (select preco_unitario from public.orcamento_projeto_catalogo where id = v_frete) <> 350 then
    raise exception '0137: repetido no orcamento deveria ficar com a ultima linha (350)';
  end if;
  if (select count(*) from public.orcamento_projeto_custos
       where id in (current_setting('ts0137.f1')::bigint, current_setting('ts0137.f2')::bigint)
         and catalogo_item_id = v_frete) <> 2
     or (select catalogo_valor_base from public.orcamento_projeto_custos
          where id = current_setting('ts0137.f1')::bigint) <> 300 then
    raise exception '0137: linhas repetidas de F nao ficaram ligadas ao item (base = valor da linha)';
  end if;

  -- listagem mostra a origem do valor
  if (select valor_origem_demanda_titulo from public.orcamento_projeto_catalogo_listar() where id = v_alfa)
     is distinct from 'TS-0137 proposta a' then
    raise exception '0137: listagem sem a proposta de origem do valor';
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run (Git Bash, banco local Docker; **nunca** produção):
`docker exec -i -e PGCLIENTENCODING=UTF8 supabase_db_Estoque psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/catalogo_vivo_projeto_0137.sql`
Expected: FAIL, porque `public.previa_catalogo_revisao_projeto(bigint)` ainda não existe. O erro aparece já na criação de `pg_temp.acao`, já que o corpo da função SQL é validado na criação.

- [ ] **Step 3: Write the migration** — criar `supabase/migrations/0137_catalogo_vivo_projeto.sql`:

```sql
-- =====================================================================
-- 0137 — Catálogo vivo de custos de projeto (Fase B do desenho
-- docs/superpowers/specs/2026-09-28-orcamento-projeto-catalogo-vivo-design.md)
--
-- O que muda:
--   1. Identidade do item = rubrica + descrição + unidade normalizadas
--      (colunas geradas chave_descricao/chave_unidade) e índice único parcial.
--   2. Itens repetidos (mesma identidade) são unificados: fica o de maior
--      valor (DC1); o outro vira ativo = false com substituido_por.
--   3. Histórico de valores por item (orcamento_projeto_catalogo_valores),
--      com carga inicial dos valores atuais.
--   4. Linhas de custo guardam catalogo_valor_base (valor do catálogo quando
--      entraram), para a conclusão saber o que foi digitado.
--   5. RPCs previa_catalogo_revisao_projeto e concluir_revisao_custos_projeto:
--      a conclusão grava no catálogo (vale a última a concluir; linha não
--      alterada não grava; pessoal só com "Valores de pessoal no orçamento").
--   7. kontrol_private.pode_ver_pessoal_orcamento(): quem vê e grava pessoal
--      (orcamentos.pessoal ou tecnicos.salario.ver). Decisão do dono, 28/09.
--   6. orcamento_projeto_catalogo_listar() devolve também a origem do valor.
--
-- Impacto: aditiva. Não remove tabelas, colunas, RLS nem gatilhos de
-- auditoria; nenhum item do catálogo é apagado; propostas emitidas não são
-- tocadas. Pré-requisito: backup lógico de orcamento_projeto_catalogo,
-- orcamento_projeto_custos e orcamento_projetos antes de aplicar em produção.
--
-- Rollback (objetos criados por esta migration; exige o backup acima):
--   update public.orcamento_projeto_catalogo set ativo = true, substituido_por = null
--    where substituido_por is not null;
--   drop function if exists public.concluir_revisao_custos_projeto(bigint, text);
--   drop function if exists public.previa_catalogo_revisao_projeto(bigint);
--   drop function if exists kontrol_private.plano_catalogo_revisao(bigint);
--   drop function if exists kontrol_private.item_catalogo_vigente(text);
--   drop function if exists kontrol_private.pode_ver_pessoal_orcamento();  (depois de recriar a listagem da 0112)
--   drop index if exists public.orcamento_projeto_catalogo_item_unico_uidx;
--   drop table if exists public.orcamento_projeto_catalogo_valores;
--   drop sequence if exists public.orcamento_projeto_catalogo_id_seq;
--   recriar public.orcamento_projeto_catalogo_listar() como na 0112 (mesmos grants).
--   As colunas novas podem ficar: são aditivas e ignoradas pelo código antigo.
-- =====================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regprocedure('kontrol_private.exigir_permissao(text)') is null
    or to_regprocedure('kontrol_private.pode_ver_salario()') is null
    or to_regprocedure('kontrol_private.tem_permissao_efetiva(text)') is null
    or to_regprocedure('public.transicionar_orcamento_projeto(bigint,text,text)') is null
    or to_regprocedure('public.orcamento_projeto_catalogo_listar()') is null then
    raise exception '0137: requer as migrations 0112, 0124 e 0131';
  end if;
end $$;

-- ---- 1. Normalização: fonte única da identidade do item ----------------------
create or replace function kontrol_private.normalizar_texto_catalogo(p_texto text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select nullif(btrim(regexp_replace(
    lower(translate(coalesce(p_texto, ''),
      'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')),
    '\s+', ' ', 'g')), '')
$$;

create or replace function kontrol_private.normalizar_unidade_catalogo(p_unidade text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case u.v
    when '' then 'un'
    when 'und' then 'un' when 'unid' then 'un' when 'unidade' then 'un' when 'unidades' then 'un'
    when 'lt' then 'l' when 'litro' then 'l' when 'litros' then 'l'
    when 'mililitro' then 'ml' when 'mililitros' then 'ml'
    when 'quilo' then 'kg' when 'quilos' then 'kg' when 'quilograma' then 'kg' when 'quilogramas' then 'kg'
    when 'grama' then 'g' when 'gramas' then 'g'
    when 'meses' then 'mes'
    when 'diarias' then 'diaria'
    when 'caixa' then 'cx' when 'caixas' then 'cx'
    when 'pacote' then 'pct' when 'pacotes' then 'pct'
    when 'conjunto' then 'conj' when 'conjuntos' then 'conj'
    else u.v
  end
  from (select regexp_replace(coalesce(kontrol_private.normalizar_texto_catalogo(p_unidade), ''), '\.$', '') as v) u
$$;

revoke all on function kontrol_private.normalizar_texto_catalogo(text) from public, anon;
revoke all on function kontrol_private.normalizar_unidade_catalogo(text) from public, anon;
grant execute on function kontrol_private.normalizar_texto_catalogo(text) to authenticated, service_role;
grant execute on function kontrol_private.normalizar_unidade_catalogo(text) to authenticated, service_role;

-- ---- 1b. Quem vê e grava valores de pessoal no orçamento (dono, 28/09) --------
-- Quem faz orçamento de projeto recebe "Valores de pessoal no orçamento"
-- (orcamentos.pessoal; padrão só admin). Quem já via salário continua vendo.
create or replace function kontrol_private.pode_ver_pessoal_orcamento()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select kontrol_private.tem_permissao_efetiva('orcamentos.pessoal')
      or kontrol_private.pode_ver_salario()
$$;

revoke all on function kontrol_private.pode_ver_pessoal_orcamento() from public, anon, authenticated, service_role;
grant execute on function kontrol_private.pode_ver_pessoal_orcamento() to authenticated, service_role;

-- Padrão das categorias (mesmo padrão de src/lib/auth/permissions.ts): coordenador e gestor
-- fazem orçamento; técnico não. Não sobrescreve escolha já feita pelo administrador.
update public.permissoes_categorias
   set permissoes = permissoes || '{"orcamentos.pessoal": true}'::jsonb,
       atualizado_em = now()
 where papel in ('coordenador', 'gestor')
   and not (permissoes ? 'orcamentos.pessoal');

-- ---- 2. Colunas novas do catálogo --------------------------------------------
alter table public.orcamento_projeto_catalogo
  add column if not exists chave_descricao text
    generated always as (kontrol_private.normalizar_texto_catalogo(descricao)) stored,
  add column if not exists chave_unidade text
    generated always as (kontrol_private.normalizar_unidade_catalogo(unidade)) stored,
  add column if not exists substituido_por text
    references public.orcamento_projeto_catalogo(id) on delete restrict,
  add column if not exists valor_atualizado_em timestamptz,
  add column if not exists valor_atualizado_por text,
  add column if not exists valor_origem_orcamento_projeto_id bigint
    references public.orcamento_projetos(id) on delete set null,
  add column if not exists valor_origem_demanda_id bigint
    references public.demandas_propostas(id) on delete set null;

alter table public.orcamento_projeto_catalogo
  drop constraint if exists orcamento_projeto_catalogo_substituido_check,
  add constraint orcamento_projeto_catalogo_substituido_check
    check (substituido_por is null or (substituido_por <> id and not ativo));

-- Origem: amplia os valores aceitos (o check da 0012 tem nome gerado; é trocado pelo conteúdo).
do $$
declare
  v_nome text;
begin
  for v_nome in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.orcamento_projeto_catalogo'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%origem%'
  loop
    execute format('alter table public.orcamento_projeto_catalogo drop constraint %I', v_nome);
  end loop;
end $$;
alter table public.orcamento_projeto_catalogo
  add constraint orcamento_projeto_catalogo_origem_check
    check (origem in ('kontrol', 'orcamento_projetos_antigo', 'revisao_custos', 'cadastro_catalogo', 'importacao_planilha'));

update public.orcamento_projeto_catalogo
   set valor_atualizado_em = coalesce(valid_from, criado_em)
 where valor_atualizado_em is null;

grant select (chave_descricao, chave_unidade, substituido_por, valor_atualizado_em,
              valor_atualizado_por, valor_origem_orcamento_projeto_id, valor_origem_demanda_id)
  on public.orcamento_projeto_catalogo to authenticated;

comment on column public.orcamento_projeto_catalogo.substituido_por is
  'Item que ficou quando este foi unificado (mesma rubrica, descrição e unidade). Unificado = inativo.';

-- ---- 3. Histórico de valores -------------------------------------------------
create table if not exists public.orcamento_projeto_catalogo_valores (
  id                   bigint generated always as identity primary key,
  catalogo_item_id     text references public.orcamento_projeto_catalogo(id) on delete restrict,
  rubrica              text not null check (rubrica in ('PE','MC','MP','ST','VD','OU')),
  descricao            text not null,
  unidade              text,
  evento               text not null check (evento in ('carga_inicial', 'item_novo', 'valor_alterado',
                                                       'edicao_catalogo', 'unificacao', 'pendente_permissao')),
  preco_unitario       numeric not null check (preco_unitario >= 0),
  preco_anterior       numeric,
  aplicado             boolean not null default true,
  orcamento_projeto_id bigint references public.orcamento_projetos(id) on delete set null,
  demanda_id           bigint references public.demandas_propostas(id) on delete set null,
  usuario              text,
  observacao           text,
  registrado_em        timestamptz not null default now(),
  constraint orcamento_projeto_catalogo_valores_pendente_check
    check (aplicado or evento = 'pendente_permissao'),
  constraint orcamento_projeto_catalogo_valores_item_check
    check (catalogo_item_id is not null or evento = 'pendente_permissao')
);
create index if not exists orcamento_projeto_catalogo_valores_item_idx
  on public.orcamento_projeto_catalogo_valores (catalogo_item_id, registrado_em desc);
create index if not exists orcamento_projeto_catalogo_valores_pendentes_idx
  on public.orcamento_projeto_catalogo_valores (registrado_em desc) where not aplicado;

alter table public.orcamento_projeto_catalogo_valores enable row level security;
revoke all on table public.orcamento_projeto_catalogo_valores from public, anon, authenticated;
grant all on table public.orcamento_projeto_catalogo_valores to service_role;
comment on table public.orcamento_projeto_catalogo_valores is
  'Histórico de valores do catálogo de custos de projeto. Sem acesso direto: grava só pelas funções do catálogo; leitura por RPC com pessoal mascarado.';

insert into public.orcamento_projeto_catalogo_valores
  (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, observacao, registrado_em)
select c.id, c.rubrica, c.descricao, c.unidade, 'carga_inicial', c.preco_unitario,
       case c.origem when 'orcamento_projetos_antigo' then 'Valor importado do app antigo.'
                     else 'Valor existente na criação do histórico.' end,
       coalesce(c.valor_atualizado_em, c.criado_em)
  from public.orcamento_projeto_catalogo c
 where not exists (select 1 from public.orcamento_projeto_catalogo_valores v where v.catalogo_item_id = c.id);

-- ---- 4. Unificação dos repetidos (DC1: fica o maior valor, ativos primeiro) ---
with grupos as (
  select c.id,
         first_value(c.id) over (
           partition by c.rubrica, c.chave_descricao, c.chave_unidade
           order by c.ativo desc, c.preco_unitario desc, c.id
         ) as manter,
         count(*) over (partition by c.rubrica, c.chave_descricao, c.chave_unidade) as quantidade
    from public.orcamento_projeto_catalogo c
   where c.substituido_por is null and c.chave_descricao is not null
), unificados as (
  update public.orcamento_projeto_catalogo c
     set substituido_por = g.manter, ativo = false, atualizado_em = now()
    from grupos g
   where c.id = g.id and g.quantidade > 1 and g.id <> g.manter
  returning c.id, c.rubrica, c.descricao, c.unidade, c.preco_unitario, c.substituido_por
)
insert into public.orcamento_projeto_catalogo_valores
  (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, observacao)
select u.id, u.rubrica, u.descricao, u.unidade, 'unificacao', u.preco_unitario,
       format('Unificado em %s (mesma rubrica, descrição e unidade); ficou o maior valor.', u.substituido_por)
  from unificados u;

create unique index if not exists orcamento_projeto_catalogo_item_unico_uidx
  on public.orcamento_projeto_catalogo (rubrica, chave_descricao, chave_unidade)
  where substituido_por is null;

-- Códigos dos itens novos: <RUBRICA>-<n>, a partir de 101 (o app antigo foi até 48).
create sequence if not exists public.orcamento_projeto_catalogo_id_seq start with 101;
revoke all on sequence public.orcamento_projeto_catalogo_id_seq from public, anon, authenticated;
grant usage on sequence public.orcamento_projeto_catalogo_id_seq to service_role;

-- ---- 5. Linhas de custo: valor do catálogo quando a linha entrou -------------
alter table public.orcamento_projeto_custos
  add column if not exists catalogo_valor_base numeric;
comment on column public.orcamento_projeto_custos.catalogo_valor_base is
  'Valor do catálogo quando a linha entrou ou foi sincronizada. A conclusão só grava no catálogo se custo_unitario for diferente.';
-- Linhas antigas ligadas ao catálogo contam como não alteradas: nunca desfazem valor mais novo.
update public.orcamento_projeto_custos
   set catalogo_valor_base = custo_unitario
 where catalogo_item_id is not null and catalogo_valor_base is null;

-- ---- 6. Decisão linha a linha (usada pela prévia e pela conclusão) -----------
create or replace function kontrol_private.item_catalogo_vigente(p_id text)
returns text
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_id text := p_id;
  v_proximo text;
  v_saltos integer := 0;
begin
  if p_id is null then
    return null;
  end if;
  loop
    select k.substituido_por into v_proximo from public.orcamento_projeto_catalogo k where k.id = v_id;
    if not found then
      return null;
    end if;
    exit when v_proximo is null;
    v_id := v_proximo;
    v_saltos := v_saltos + 1;
    if v_saltos > 20 then
      raise exception 'Unificação do catálogo em ciclo a partir de %.', p_id using errcode = '22023';
    end if;
  end loop;
  return v_id;
end $$;

create or replace function kontrol_private.plano_catalogo_revisao(p_orcamento_projeto_id bigint)
returns table (
  linha_id bigint,
  rubrica text,
  descricao text,
  unidade text,
  valor numeric,
  catalogo_item_id text,
  acao text,
  valor_catalogo numeric,
  valor_catalogo_em timestamptz
)
language sql
stable
set search_path = pg_catalog, public
as $$
  with acesso as (
    select kontrol_private.pode_ver_pessoal_orcamento() as pode
  ),
  linhas as (
    select c.id,
           coalesce(c.rubrica, 'OU') as rubrica,
           c.descricao,
           c.unidade,
           c.custo_unitario as valor,
           c.catalogo_item_id,
           kontrol_private.normalizar_texto_catalogo(c.descricao) as chave_descricao,
           kontrol_private.normalizar_unidade_catalogo(c.unidade) as chave_unidade,
           -- ligada ao catálogo e com o valor de quando entrou = não foi digitada
           (c.catalogo_item_id is not null
             and c.custo_unitario = coalesce(c.catalogo_valor_base, c.custo_unitario)) as sem_edicao
      from public.orcamento_projeto_custos c
     where c.orcamento_projeto_id = p_orcamento_projeto_id
  ),
  alvos as (
    select l.*,
           case
             when l.sem_edicao then coalesce(kontrol_private.item_catalogo_vigente(l.catalogo_item_id), k.id)
             else k.id
           end as item_id
      from linhas l
      left join public.orcamento_projeto_catalogo k
        on k.substituido_por is null
       and k.rubrica = l.rubrica
       and k.chave_descricao = l.chave_descricao
       and k.chave_unidade = l.chave_unidade
  ),
  decididas as (
    select a.*,
           k.preco_unitario as preco_catalogo,
           k.valor_atualizado_em as preco_em,
           case
             when a.sem_edicao then 'inalterado'
             when a.item_id is null then 'novo'
             when a.valor = k.preco_unitario then
               case when a.catalogo_item_id is distinct from a.item_id then 'vincular' else 'inalterado' end
             else 'atualizar'
           end as acao_base
      from alvos a
      left join public.orcamento_projeto_catalogo k on k.id = a.item_id
  ),
  ordenadas as (
    select d.*,
           row_number() over (
             partition by d.rubrica, d.chave_descricao, d.chave_unidade, d.acao_base in ('novo', 'atualizar')
             order by d.id desc
           ) as ordem
      from decididas d
  )
  select o.id,
         o.rubrica,
         o.descricao,
         o.unidade,
         o.valor,
         o.item_id,
         case
           when o.acao_base in ('novo', 'atualizar') and o.ordem > 1 then 'repetido'
           -- sem "Valores de pessoal no orçamento", pessoal nunca grava nem revela se o valor bate com o catálogo
           when o.rubrica = 'PE' and not a.pode and o.acao_base in ('novo', 'atualizar', 'vincular')
             then 'pendente_permissao'
           else o.acao_base
         end,
         case when o.rubrica = 'PE' and not a.pode then null else o.preco_catalogo end,
         o.preco_em
    from ordenadas o
    cross join acesso a
   order by o.rubrica, o.id
$$;

revoke all on function kontrol_private.item_catalogo_vigente(text) from public, anon, authenticated;
revoke all on function kontrol_private.plano_catalogo_revisao(bigint) from public, anon, authenticated;

-- ---- 7. Prévia (somente leitura) ---------------------------------------------
create or replace function public.previa_catalogo_revisao_projeto(p_orcamento_projeto_id bigint)
returns table (
  linha_id bigint,
  rubrica text,
  descricao text,
  unidade text,
  valor numeric,
  catalogo_item_id text,
  acao text,
  valor_catalogo numeric,
  valor_catalogo_em timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  perform kontrol_private.exigir_permissao('orcamentos.visualizar');
  return query select * from kontrol_private.plano_catalogo_revisao(p_orcamento_projeto_id);
end $$;

comment on function public.previa_catalogo_revisao_projeto(bigint) is
  'O que a conclusão da revisão faria no catálogo, linha a linha (novo, atualizar, vincular, inalterado, repetido, pendente_permissao). Pessoal mascarado sem "Valores de pessoal no orçamento".';

-- ---- 8. Conclusão: grava no catálogo e muda o status numa transação só ------
create or replace function public.concluir_revisao_custos_projeto(
  p_orcamento_projeto_id bigint,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
  v_demanda bigint;
  v_justificativa text;
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
  v_linha record;
  v_item text;
  v_anterior numeric;
  v_novos integer := 0;
  v_atualizados integer := 0;
  v_pendentes integer := 0;
  v_repetidos integer := 0;
begin
  perform kontrol_private.exigir_permissao('orcamentos.emitir');

  select p.status, p.demanda_id, p.projeto_sem_custo_justificativa
    into v_status, v_demanda, v_justificativa
    from public.orcamento_projetos p
   where p.id = p_orcamento_projeto_id
   for update;
  if not found then
    raise exception 'Orçamento de projeto não encontrado.' using errcode = 'P0002';
  end if;
  if v_status is distinct from 'rascunho' then
    raise exception 'Só é possível concluir a revisão de custos que estão em edição.' using errcode = '22023';
  end if;
  if v_justificativa is null
     and not exists (select 1 from public.orcamento_projeto_custos c where c.orcamento_projeto_id = p_orcamento_projeto_id)
     and not exists (select 1 from public.orcamento_projeto_analises a where a.orcamento_projeto_id = p_orcamento_projeto_id) then
    raise exception 'Adicione ao menos um custo ou análise antes de concluir a revisão.' using errcode = '22023';
  end if;

  -- Uma conclusão por vez grava no catálogo: a segunda espera e vale a última.
  perform pg_advisory_xact_lock(hashtext('kontrol.orcamento_projeto_catalogo'));

  for v_linha in
    select * from kontrol_private.plano_catalogo_revisao(p_orcamento_projeto_id)
  loop
    if v_linha.acao = 'novo' then
      v_item := v_linha.rubrica || '-' || nextval('public.orcamento_projeto_catalogo_id_seq');
      insert into public.orcamento_projeto_catalogo
        (id, rubrica, descricao, unidade, preco_unitario, ativo, origem,
         valor_atualizado_em, valor_atualizado_por, valor_origem_orcamento_projeto_id, valor_origem_demanda_id)
      values
        (v_item, v_linha.rubrica, btrim(v_linha.descricao), nullif(btrim(coalesce(v_linha.unidade, '')), ''),
         v_linha.valor, true, 'revisao_custos', now(), v_email, p_orcamento_projeto_id, v_demanda);
      insert into public.orcamento_projeto_catalogo_valores
        (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario,
         orcamento_projeto_id, demanda_id, usuario)
      values
        (v_item, v_linha.rubrica, v_linha.descricao, v_linha.unidade, 'item_novo', v_linha.valor,
         p_orcamento_projeto_id, v_demanda, v_email);
      update public.orcamento_projeto_custos
         set catalogo_item_id = v_item, catalogo_valor_base = v_linha.valor
       where id = v_linha.linha_id;
      v_novos := v_novos + 1;

    elsif v_linha.acao = 'atualizar' then
      select k.preco_unitario into v_anterior
        from public.orcamento_projeto_catalogo k
       where k.id = v_linha.catalogo_item_id
       for update;
      update public.orcamento_projeto_catalogo
         set preco_unitario = v_linha.valor,
             ativo = true,
             atualizado_em = now(),
             valor_atualizado_em = now(),
             valor_atualizado_por = v_email,
             valor_origem_orcamento_projeto_id = p_orcamento_projeto_id,
             valor_origem_demanda_id = v_demanda
       where id = v_linha.catalogo_item_id;
      insert into public.orcamento_projeto_catalogo_valores
        (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, preco_anterior,
         orcamento_projeto_id, demanda_id, usuario)
      values
        (v_linha.catalogo_item_id, v_linha.rubrica, v_linha.descricao, v_linha.unidade, 'valor_alterado',
         v_linha.valor, v_anterior, p_orcamento_projeto_id, v_demanda, v_email);
      update public.orcamento_projeto_custos
         set catalogo_item_id = v_linha.catalogo_item_id, catalogo_valor_base = v_linha.valor
       where id = v_linha.linha_id;
      v_atualizados := v_atualizados + 1;

    elsif v_linha.acao = 'vincular' then
      update public.orcamento_projeto_custos
         set catalogo_item_id = v_linha.catalogo_item_id, catalogo_valor_base = v_linha.valor
       where id = v_linha.linha_id;

    elsif v_linha.acao = 'pendente_permissao' then
      insert into public.orcamento_projeto_catalogo_valores
        (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, aplicado,
         orcamento_projeto_id, demanda_id, usuario, observacao)
      values
        (v_linha.catalogo_item_id, v_linha.rubrica, v_linha.descricao, v_linha.unidade, 'pendente_permissao',
         v_linha.valor, false, p_orcamento_projeto_id, v_demanda, v_email,
         'Valor de pessoal concluído sem a permissão "Valores de pessoal no orçamento".');
      v_pendentes := v_pendentes + 1;

    elsif v_linha.acao = 'repetido' then
      v_repetidos := v_repetidos + 1;
    end if;
  end loop;

  -- Linhas repetidas (e as ligadas a item unificado) passam a apontar para o item
  -- vigente; a base é o valor da própria linha, para ela não gravar de novo.
  update public.orcamento_projeto_custos c
     set catalogo_item_id = k.id, catalogo_valor_base = c.custo_unitario
    from public.orcamento_projeto_catalogo k
   where c.orcamento_projeto_id = p_orcamento_projeto_id
     and c.catalogo_item_id is distinct from k.id
     and k.substituido_por is null
     and k.rubrica = coalesce(c.rubrica, 'OU')
     and k.chave_descricao = kontrol_private.normalizar_texto_catalogo(c.descricao)
     and k.chave_unidade = kontrol_private.normalizar_unidade_catalogo(c.unidade)
     and (coalesce(c.rubrica, 'OU') <> 'PE' or kontrol_private.pode_ver_pessoal_orcamento());

  perform public.transicionar_orcamento_projeto(
    p_orcamento_projeto_id,
    'enviado',
    coalesce(nullif(btrim(p_observacao), ''), 'Revisão dos custos de projeto concluída.')
  );

  return jsonb_build_object(
    'novos', v_novos,
    'atualizados', v_atualizados,
    'pendentes', v_pendentes,
    'repetidos', v_repetidos
  );
end $$;

comment on function public.concluir_revisao_custos_projeto(bigint, text) is
  'Conclui a revisão dos custos de projeto e alimenta o catálogo: item novo entra, valor digitado sobrepõe (vale a última conclusão), linha não alterada não grava, pessoal só com "Valores de pessoal no orçamento" (senão fica pendente).';

revoke all on function public.previa_catalogo_revisao_projeto(bigint) from public, anon;
revoke all on function public.concluir_revisao_custos_projeto(bigint, text) from public, anon;
grant execute on function public.previa_catalogo_revisao_projeto(bigint) to authenticated, service_role;
grant execute on function public.concluir_revisao_custos_projeto(bigint, text) to authenticated, service_role;

-- ---- 9. Listagem com a origem do valor (mesma máscara e grants da 0112) ------
drop function if exists public.orcamento_projeto_catalogo_listar();
create function public.orcamento_projeto_catalogo_listar()
returns table (
  id text,
  rubrica text,
  descricao text,
  unidade text,
  preco_unitario numeric,
  preco_mascarado boolean,
  categoria text,
  ativo boolean,
  valid_from timestamptz,
  origem text,
  criado_em timestamptz,
  atualizado_em timestamptz,
  substituido_por text,
  valor_atualizado_em timestamptz,
  valor_atualizado_por text,
  valor_origem_demanda_id bigint,
  valor_origem_demanda_titulo text
)
language sql stable security definer
set search_path = pg_catalog
as $$
  with acesso as (select kontrol_private.pode_ver_pessoal_orcamento() as pode)
  select c.id, c.rubrica, c.descricao, c.unidade,
    case when c.rubrica = 'PE' and not a.pode then null else c.preco_unitario end,
    (c.rubrica = 'PE' and not a.pode),
    c.categoria, c.ativo, c.valid_from, c.origem, c.criado_em, c.atualizado_em,
    c.substituido_por, c.valor_atualizado_em, c.valor_atualizado_por,
    c.valor_origem_demanda_id, d.titulo
  from public.orcamento_projeto_catalogo c
  cross join acesso a
  left join public.demandas_propostas d on d.id = c.valor_origem_demanda_id
  order by c.rubrica, c.descricao, c.id
$$;

revoke all on function public.orcamento_projeto_catalogo_listar() from public, anon, authenticated, service_role;
grant execute on function public.orcamento_projeto_catalogo_listar() to authenticated, service_role;

commit;
```

- [ ] **Step 4: Aplicar no banco local e rodar os testes SQL**

Run (Git Bash; banco local Docker, nunca produção):
```bash
docker exec -i -e PGCLIENTENCODING=UTF8 supabase_db_Estoque psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/0137_catalogo_vivo_projeto.sql
docker exec -i -e PGCLIENTENCODING=UTF8 supabase_db_Estoque psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/catalogo_vivo_projeto_0137.sql
docker exec -i -e PGCLIENTENCODING=UTF8 supabase_db_Estoque psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/salario_tecnicos_0112.sql
```
Expected: os três terminam sem `ERROR`; o teste 0137 termina em `ROLLBACK`. O teste 0112 continua verde com a listagem recriada.
- Se o banco local tiver o catálogo alterado à mão (valores diferentes da 0012), o bloco 4 pode falhar só pelos valores de referência. Nesse caso, repetir num banco novo: `npx supabase db reset --no-seed` apaga o banco local e precisa de autorização do dono.

- [ ] **Step 4b: Manter o teste 0112 medindo só o salário** — como coordenador e gestor agora veem o pessoal do
catálogo pela categoria, o teste antigo (que espera o preço PE mascarado para `coordenador_sem` e `gestor_sem`)
precisa neutralizar a permissão nova nos perfis de teste. Em `supabase/tests/salario_tecnicos_0112.sql`, no
`update public.perfis … permissoes = case rotulo … end`, trocar a última linha do `case`

```sql
        else '{"cadastros.editar": true}'::jsonb end
```

por

```sql
        else '{"cadastros.editar": true}'::jsonb end
        -- 0137: valores de pessoal no orçamento têm permissão própria; aqui só o salário conta.
        || '{"orcamentos.pessoal": false}'::jsonb
```

e rodar de novo os três comandos do Step 4. Expected: todos sem `ERROR`.

- [ ] **Step 5: Registrar no CI** — em `.github/workflows/ci.yml`, depois do último passo `Validar …` de SQL, acrescentar:

```yaml
      - name: Validar catálogo vivo de custos de projeto (item novo, último vence, pessoal pendente)
        run: docker exec -i -e PGCLIENTENCODING=UTF8 supabase_db_Estoque psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/catalogo_vivo_projeto_0137.sql
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0137_catalogo_vivo_projeto.sql supabase/tests/catalogo_vivo_projeto_0137.sql supabase/tests/salario_tecnicos_0112.sql .github/workflows/ci.yml
git commit -m "feat(orçamentos): catálogo vivo de custos de projeto no banco (0137)

Identidade do item (rubrica + descrição + unidade), unificação dos repetidos
(fica o maior valor), histórico de valores, prévia e conclusão que grava no
catálogo: vale a última revisão, linha não alterada não grava, pessoal só com
'Valores de pessoal no orçamento'. Teste SQL no CI.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B2: Tipos do banco e leitura da prévia no TypeScript

**Files:**
- Modify: `src/lib/supabase/database.types.ts` (blocos `orcamento_projeto_catalogo`, `orcamento_projeto_custos`, `Functions`)
- Create: `src/lib/project-budget/catalogo-vivo.ts`
- Test: `src/lib/project-budget/catalogo-vivo.test.ts`

**Interfaces:**
- Consumes: formato de linha de `previa_catalogo_revisao_projeto` (Task B1).
- Produces:
  - `type AcaoCatalogo = "novo" | "atualizar" | "vincular" | "inalterado" | "repetido" | "pendente_permissao"`
  - `type LinhaPlanoCatalogo = { linhaId: number; rubrica: string; descricao: string; unidade: string | null; valor: number; catalogoItemId: string | null; acao: AcaoCatalogo; valorCatalogo: number | null; valorCatalogoEm: string | null }`
  - `lerPlanoCatalogo(dados: unknown): LinhaPlanoCatalogo[]`
  - `type SeloCatalogo = { rotulo: string; tom: "novo" | "atualiza" | "aviso"; detalhe: string }`
  - `seloLinhaCatalogo(linha: LinhaPlanoCatalogo): SeloCatalogo | null`
  - `resumirPlanoCatalogo(linhas: LinhaPlanoCatalogo[]): ResumoPlanoCatalogo`
  - `frasesPreviaCatalogo(resumo: ResumoPlanoCatalogo): string[]`
  - `mensagemConclusaoCatalogo(retorno: unknown): string`

- [ ] **Step 1: Write the failing test** — criar `src/lib/project-budget/catalogo-vivo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatCurrency as brl } from "@/lib/formatters";
import {
  frasesPreviaCatalogo,
  lerPlanoCatalogo,
  mensagemConclusaoCatalogo,
  resumirPlanoCatalogo,
  seloLinhaCatalogo,
  type LinhaPlanoCatalogo,
} from "./catalogo-vivo";

const linha = (extra: Partial<LinhaPlanoCatalogo>): LinhaPlanoCatalogo => ({
  linhaId: 1,
  rubrica: "MC",
  descricao: "Papel toalha",
  unidade: "fardo",
  valor: 55,
  catalogoItemId: "MC-6",
  acao: "inalterado",
  valorCatalogo: 55,
  valorCatalogoEm: "2026-09-12T10:00:00Z",
  ...extra,
});

describe("lerPlanoCatalogo", () => {
  it("converte números vindos como texto e descarta ação desconhecida", () => {
    const plano = lerPlanoCatalogo([
      { linha_id: "7", rubrica: "MC", descricao: "Álcool", unidade: null, valor: "130", catalogo_item_id: "MC-36", acao: "atualizar", valor_catalogo: "120", valor_catalogo_em: null },
      { linha_id: 8, rubrica: "MC", descricao: "X", unidade: "un", valor: 1, catalogo_item_id: null, acao: "apagar", valor_catalogo: null, valor_catalogo_em: null },
    ]);
    expect(plano).toEqual([
      { linhaId: 7, rubrica: "MC", descricao: "Álcool", unidade: null, valor: 130, catalogoItemId: "MC-36", acao: "atualizar", valorCatalogo: 120, valorCatalogoEm: null },
    ]);
  });

  it("resposta vazia ou com erro vira lista vazia", () => {
    expect(lerPlanoCatalogo(null)).toEqual([]);
    expect(lerPlanoCatalogo({ message: "erro" })).toEqual([]);
  });
});

describe("seloLinhaCatalogo", () => {
  it("item novo, atualização, repetido e pessoal pendente têm selo", () => {
    expect(seloLinhaCatalogo(linha({ acao: "novo", catalogoItemId: null, valorCatalogo: null }))).toMatchObject({ rotulo: "Novo no catálogo", tom: "novo" });
    expect(seloLinhaCatalogo(linha({ acao: "atualizar", valorCatalogo: 50 }))).toEqual({
      rotulo: "Atualiza o catálogo",
      tom: "atualiza",
      detalhe: `Catálogo: ${brl(50)} → ${brl(55)} ao concluir.`,
    });
    expect(seloLinhaCatalogo(linha({ acao: "repetido" }))).toMatchObject({ rotulo: "Repetido neste orçamento", tom: "aviso" });
    expect(seloLinhaCatalogo(linha({ acao: "pendente_permissao", rubrica: "PE", valorCatalogo: null }))).toMatchObject({ rotulo: "Pessoal: aguarda permissão", tom: "aviso" });
  });

  it("linha igual ao catálogo não tem selo; linha com catálogo mais novo só informa (DC5)", () => {
    expect(seloLinhaCatalogo(linha({}))).toBeNull();
    expect(seloLinhaCatalogo(linha({ acao: "vincular" }))).toBeNull();
    expect(seloLinhaCatalogo(linha({ valor: 50, valorCatalogo: 55 }))).toMatchObject({ rotulo: `Catálogo hoje: ${brl(55)}`, tom: "aviso" });
  });
});

describe("resumo e mensagens", () => {
  const plano = [
    linha({ linhaId: 1, acao: "novo", descricao: "Reagente Alfa", catalogoItemId: null, valorCatalogo: null, valor: 100 }),
    linha({ linhaId: 2, acao: "atualizar", valorCatalogo: 50, valor: 55 }),
    linha({ linhaId: 3, acao: "pendente_permissao", rubrica: "PE", descricao: "Bolsista", valorCatalogo: null }),
    linha({ linhaId: 4, acao: "inalterado", descricao: "Álcool etílico", valor: 120, valorCatalogo: 130 }),
    linha({ linhaId: 5, acao: "inalterado" }),
  ];

  it("agrupa o que a conclusão faria", () => {
    const resumo = resumirPlanoCatalogo(plano);
    expect(resumo.novos.map((l) => l.linhaId)).toEqual([1]);
    expect(resumo.atualizados.map((l) => l.linhaId)).toEqual([2]);
    expect(resumo.pendentes.map((l) => l.linhaId)).toEqual([3]);
    expect(resumo.desatualizados.map((l) => l.linhaId)).toEqual([4]);
    expect(resumo.repetidos).toEqual([]);
  });

  it("frases da confirmação", () => {
    expect(frasesPreviaCatalogo(resumirPlanoCatalogo(plano))).toEqual([
      "1 item novo entra no catálogo: Reagente Alfa.",
      `1 valor é atualizado: Papel toalha ${brl(50)} → ${brl(55)}.`,
      "1 valor de pessoal fica pendente para quem tem a permissão de valores de pessoal.",
      "1 linha está com valor diferente do catálogo atual e não muda o catálogo: Álcool etílico.",
    ]);
    expect(frasesPreviaCatalogo(resumirPlanoCatalogo([linha({})]))).toEqual([]);
  });

  it("mensagem depois de concluir", () => {
    expect(mensagemConclusaoCatalogo({ novos: 2, atualizados: 1, pendentes: 0, repetidos: 0 })).toBe(
      "Revisão dos custos concluída. Catálogo: 2 itens novos, 1 valor atualizado.",
    );
    expect(mensagemConclusaoCatalogo({ novos: 0, atualizados: 0, pendentes: 1, repetidos: 0 })).toBe(
      "Revisão dos custos concluída. Catálogo: 1 valor de pessoal pendente de permissão.",
    );
    expect(mensagemConclusaoCatalogo(null)).toBe("Revisão dos custos concluída. O catálogo não mudou.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/project-budget/catalogo-vivo.test.ts`
Expected: FAIL, "Failed to resolve import ./catalogo-vivo".

- [ ] **Step 3: Write the implementation** — criar `src/lib/project-budget/catalogo-vivo.ts`:

```ts
/**
 * Catálogo vivo de custos de projeto (Fase B): leitura da prévia devolvida por
 * `previa_catalogo_revisao_projeto` e textos da tela. A regra (identidade do
 * item, vale a última conclusão, só o que foi digitado grava, pessoal com
 * permissão) mora só no banco (migration 0137); aqui nada é recalculado.
 */
import { formatCurrency as brl } from "@/lib/formatters";

export const ACOES_CATALOGO = ["novo", "atualizar", "vincular", "inalterado", "repetido", "pendente_permissao"] as const;
export type AcaoCatalogo = (typeof ACOES_CATALOGO)[number];

export type LinhaPlanoCatalogo = {
  linhaId: number;
  rubrica: string;
  descricao: string;
  unidade: string | null;
  valor: number;
  catalogoItemId: string | null;
  acao: AcaoCatalogo;
  valorCatalogo: number | null;
  valorCatalogoEm: string | null;
};

function numeroOuNull(valor: unknown) {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function ehAcao(valor: string): valor is AcaoCatalogo {
  return (ACOES_CATALOGO as readonly string[]).includes(valor);
}

/** Converte as linhas cruas da RPC. Linha com ação desconhecida é descartada. */
export function lerPlanoCatalogo(dados: unknown): LinhaPlanoCatalogo[] {
  if (!Array.isArray(dados)) return [];
  return dados.flatMap((bruto) => {
    const linha = (bruto ?? {}) as Record<string, unknown>;
    const acao = String(linha.acao ?? "");
    const linhaId = Number(linha.linha_id);
    if (!ehAcao(acao) || !Number.isInteger(linhaId)) return [];
    return [
      {
        linhaId,
        rubrica: String(linha.rubrica ?? "OU"),
        descricao: String(linha.descricao ?? ""),
        unidade: linha.unidade == null ? null : String(linha.unidade),
        valor: Number(linha.valor ?? 0),
        catalogoItemId: linha.catalogo_item_id == null ? null : String(linha.catalogo_item_id),
        acao,
        valorCatalogo: numeroOuNull(linha.valor_catalogo),
        valorCatalogoEm: linha.valor_catalogo_em == null ? null : String(linha.valor_catalogo_em),
      },
    ];
  });
}

const diferente = (a: number, b: number) => Math.abs(a - b) >= 0.005;

/** Linha que não grava, mas cujo catálogo já tem valor diferente (outra proposta atualizou). */
function desatualizada(linha: LinhaPlanoCatalogo) {
  return (linha.acao === "inalterado" || linha.acao === "vincular")
    && linha.valorCatalogo != null
    && diferente(linha.valorCatalogo, linha.valor);
}

export type SeloCatalogo = { rotulo: string; tom: "novo" | "atualiza" | "aviso"; detalhe: string };

/** Selo da linha no editor. `null` = linha igual ao catálogo. */
export function seloLinhaCatalogo(linha: LinhaPlanoCatalogo): SeloCatalogo | null {
  switch (linha.acao) {
    case "novo":
      return { rotulo: "Novo no catálogo", tom: "novo", detalhe: "Entra no catálogo ao concluir a revisão dos custos." };
    case "atualizar":
      return {
        rotulo: "Atualiza o catálogo",
        tom: "atualiza",
        detalhe:
          linha.valorCatalogo == null
            ? "Ao concluir, este valor passa a ser o do catálogo."
            : `Catálogo: ${brl(linha.valorCatalogo)} → ${brl(linha.valor)} ao concluir.`,
      };
    case "repetido":
      return {
        rotulo: "Repetido neste orçamento",
        tom: "aviso",
        detalhe: "Outra linha com o mesmo item e unidade define o valor do catálogo (vale a última lançada).",
      };
    case "pendente_permissao":
      return {
        rotulo: "Pessoal: aguarda permissão",
        tom: "aviso",
        detalhe: "Sem a permissão “Valores de pessoal no orçamento”, este valor fica pendente para quem a tem confirmar.",
      };
    default:
      return desatualizada(linha) && linha.valorCatalogo != null
        ? {
            // DC5: só informa; cada orçamento vale o valor que foi colocado nele.
            rotulo: `Catálogo hoje: ${brl(linha.valorCatalogo)}`,
            tom: "aviso",
            detalhe: "Outra proposta atualizou este item no catálogo. Este orçamento mantém o valor que foi colocado nele; mude aqui só se quiser.",
          }
        : null;
  }
}

export type ResumoPlanoCatalogo = {
  novos: LinhaPlanoCatalogo[];
  atualizados: LinhaPlanoCatalogo[];
  pendentes: LinhaPlanoCatalogo[];
  repetidos: LinhaPlanoCatalogo[];
  desatualizados: LinhaPlanoCatalogo[];
};

export function resumirPlanoCatalogo(linhas: LinhaPlanoCatalogo[]): ResumoPlanoCatalogo {
  return {
    novos: linhas.filter((l) => l.acao === "novo"),
    atualizados: linhas.filter((l) => l.acao === "atualizar"),
    pendentes: linhas.filter((l) => l.acao === "pendente_permissao"),
    repetidos: linhas.filter((l) => l.acao === "repetido"),
    desatualizados: linhas.filter(desatualizada),
  };
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Frases da confirmação de "Concluir revisão". Lista vazia = o catálogo não muda. */
export function frasesPreviaCatalogo(resumo: ResumoPlanoCatalogo): string[] {
  const frases: string[] = [];
  if (resumo.novos.length) {
    frases.push(
      `${plural(resumo.novos.length, "item novo entra", "itens novos entram")} no catálogo: ${resumo.novos.map((l) => l.descricao).join(", ")}.`,
    );
  }
  if (resumo.atualizados.length) {
    const itens = resumo.atualizados
      .map((l) => (l.valorCatalogo == null ? l.descricao : `${l.descricao} ${brl(l.valorCatalogo)} → ${brl(l.valor)}`))
      .join("; ");
    frases.push(`${plural(resumo.atualizados.length, "valor é atualizado", "valores são atualizados")}: ${itens}.`);
  }
  if (resumo.pendentes.length) {
    frases.push(
      `${plural(resumo.pendentes.length, "valor de pessoal fica pendente", "valores de pessoal ficam pendentes")} para quem tem a permissão de valores de pessoal.`,
    );
  }
  if (resumo.desatualizados.length) {
    frases.push(
      `${plural(resumo.desatualizados.length, "linha está", "linhas estão")} com valor diferente do catálogo atual e não ${resumo.desatualizados.length === 1 ? "muda" : "mudam"} o catálogo: ${resumo.desatualizados.map((l) => l.descricao).join(", ")}.`,
    );
  }
  return frases;
}

/** Mensagem depois de concluir, a partir do retorno de `concluir_revisao_custos_projeto`. */
export function mensagemConclusaoCatalogo(retorno: unknown): string {
  const r = (retorno ?? {}) as Record<string, unknown>;
  const novos = Number(r.novos ?? 0) || 0;
  const atualizados = Number(r.atualizados ?? 0) || 0;
  const pendentes = Number(r.pendentes ?? 0) || 0;
  const partes = [
    novos ? plural(novos, "item novo", "itens novos") : null,
    atualizados ? plural(atualizados, "valor atualizado", "valores atualizados") : null,
    pendentes ? `${plural(pendentes, "valor de pessoal pendente", "valores de pessoal pendentes")} de permissão` : null,
  ].filter(Boolean);
  return partes.length
    ? `Revisão dos custos concluída. Catálogo: ${partes.join(", ")}.`
    : "Revisão dos custos concluída. O catálogo não mudou.";
}
```

- [ ] **Step 4: Tipos do banco** — em `src/lib/supabase/database.types.ts`:
  - No bloco `orcamento_projeto_catalogo`, `Row` (em ordem alfabética entre as chaves existentes), acrescentar:
    ```ts
          chave_descricao: string | null
          chave_unidade: string | null
          substituido_por: string | null
          valor_atualizado_em: string | null
          valor_atualizado_por: string | null
          valor_origem_demanda_id: number | null
          valor_origem_orcamento_projeto_id: number | null
    ```
  - Em `Insert` e `Update` do mesmo bloco, acrescentar as mesmas chaves **menos** `chave_descricao`/`chave_unidade` (colunas geradas), todas opcionais (`substituido_por?: string | null`, etc.).
  - No bloco `orcamento_projeto_custos`, acrescentar `catalogo_valor_base: number | null` em `Row` e `catalogo_valor_base?: number | null` em `Insert` e `Update`.
  - Em `Tables`, depois de `orcamento_projeto_catalogo`, acrescentar:
    ```ts
      orcamento_projeto_catalogo_valores: {
        Row: {
          aplicado: boolean
          catalogo_item_id: string | null
          demanda_id: number | null
          descricao: string
          evento: string
          id: number
          observacao: string | null
          orcamento_projeto_id: number | null
          preco_anterior: number | null
          preco_unitario: number
          registrado_em: string
          rubrica: string
          unidade: string | null
          usuario: string | null
        }
        Insert: {
          aplicado?: boolean
          catalogo_item_id?: string | null
          demanda_id?: number | null
          descricao: string
          evento: string
          observacao?: string | null
          orcamento_projeto_id?: number | null
          preco_anterior?: number | null
          preco_unitario: number
          registrado_em?: string
          rubrica: string
          unidade?: string | null
          usuario?: string | null
        }
        Update: {
          aplicado?: boolean
          catalogo_item_id?: string | null
          demanda_id?: number | null
          descricao?: string
          evento?: string
          observacao?: string | null
          orcamento_projeto_id?: number | null
          preco_anterior?: number | null
          preco_unitario?: number
          registrado_em?: string
          rubrica?: string
          unidade?: string | null
          usuario?: string | null
        }
        Relationships: []
      }
    ```
  - Em `Functions`, no `Returns` de `orcamento_projeto_catalogo_listar`, acrescentar `substituido_por: string | null`, `valor_atualizado_em: string | null`, `valor_atualizado_por: string | null`, `valor_origem_demanda_id: number | null` e `valor_origem_demanda_titulo: string | null`. Em ordem alfabética, acrescentar:
    ```ts
      concluir_revisao_custos_projeto: {
        Args: { p_observacao?: string; p_orcamento_projeto_id: number }
        Returns: Json
      }
      previa_catalogo_revisao_projeto: {
        Args: { p_orcamento_projeto_id: number }
        Returns: {
          acao: string
          catalogo_item_id: string | null
          descricao: string
          linha_id: number
          rubrica: string
          unidade: string | null
          valor: number
          valor_catalogo: number | null
          valor_catalogo_em: string | null
        }[]
      }
    ```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/lib/project-budget/catalogo-vivo.test.ts && npm run typecheck`
Expected: PASS e typecheck sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/project-budget/catalogo-vivo.ts src/lib/project-budget/catalogo-vivo.test.ts src/lib/supabase/database.types.ts
git commit -m "feat(orçamentos): leitura da prévia do catálogo vivo e tipos da 0137

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B3: Conclusão da revisão pela RPC nova

**Files:**
- Modify: `src/lib/actions/orcamento-projetos.ts` (`concluirRevisaoCustosProjetoInterno` e `concluirRevisaoCustosProjeto`)
- Modify: `src/components/orcamento/projeto/FormAcao.tsx`
- Modify: `src/lib/testing/mock-supabase.ts` (ramos de RPC, ao lado de `transicionar_orcamento_projeto`)
- Test: `src/lib/actions/orcamento-projetos.test.ts` (caso "conclui a revisão dos custos de projeto pelo RPC transacional")

**Interfaces:**
- Consumes: `concluir_revisao_custos_projeto` (B1) e `mensagemConclusaoCatalogo` (B2).
- Produces: `concluirRevisaoCustosProjeto(formData)`, que devolve `{ ok: true, message }` com o resumo do catálogo, ou `{ ok: false, message }`.

- [ ] **Step 1: Write the failing test** — substituir o caso "conclui a revisão dos custos de projeto pelo RPC transacional" por:

```ts
  it("conclui a revisão pela RPC que alimenta o catálogo e devolve o resumo", async () => {
    const { concluirRevisaoCustosProjeto } = await import("./orcamento-projetos");
    single.mockResolvedValue({
      data: { status: "rascunho", demanda_id: 5, orcamento_projeto_custos: [{ id: 1 }], orcamento_projeto_analises: [] },
      error: null,
    });
    rpc.mockResolvedValue({ data: { novos: 2, atualizados: 1, pendentes: 0, repetidos: 0 }, error: null });
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");

    const resultado = await concluirRevisaoCustosProjeto(formData);

    expect(exigirPapelOrcamento).toHaveBeenCalledWith("revisar_modulo");
    expect(rpc).toHaveBeenCalledWith("concluir_revisao_custos_projeto", {
      p_orcamento_projeto_id: 77,
      p_observacao: "Revisão dos custos de projeto concluída.",
    });
    expect(rpc).not.toHaveBeenCalledWith("transicionar_orcamento_projeto", expect.anything());
    expect(resultado).toEqual({
      ok: true,
      message: "Revisão dos custos concluída. Catálogo: 2 itens novos, 1 valor atualizado.",
    });
    expect(update).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/demandas/5");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/actions/orcamento-projetos.test.ts -t "alimenta o catálogo"`
Expected: FAIL. A action ainda chama `transicionar_orcamento_projeto` e devolve `undefined`.

- [ ] **Step 3: Implement** — em `src/lib/actions/orcamento-projetos.ts`:
  - Acrescentar aos imports: `import { mensagemConclusaoCatalogo } from "@/lib/project-budget/catalogo-vivo";`
  - Trocar a função inteira `concluirRevisaoCustosProjetoInterno` por:

```ts
/**
 * Conclui a revisão dos custos de projeto (rascunho → enviado) pela RPC que também
 * alimenta o catálogo vivo (0137): item novo entra, valor digitado sobrepõe, vale a
 * última conclusão. Devolve o resumo para a tela.
 */
async function concluirRevisaoCustosProjetoInterno(formData: FormData): Promise<string> {
  await exigirPapelOrcamento("revisar_modulo");
  const id = numero(formData, "orcamento_projeto_id");
  if (!id) throw new Error("Orçamento de projeto não informado.");

  const supabase = await createClient();
  const { data: projeto } = await supabase
    .from("orcamento_projetos")
    .select("status, demanda_id, projeto_sem_custo_justificativa, orcamento_projeto_custos(id), orcamento_projeto_analises(id)")
    .eq("id", id)
    .single();
  const atual = projeto as (ProjetoCarregado & {
    projeto_sem_custo_justificativa?: string | null;
    orcamento_projeto_custos?: unknown[] | null;
    orcamento_projeto_analises?: unknown[] | null;
  }) | null;
  if (!atual) throw new Error("Orçamento de projeto não encontrado.");
  if (atual.status !== "rascunho") {
    throw new Error("Só é possível concluir a revisão de custos que estão em edição.");
  }
  const itens = (atual.orcamento_projeto_custos?.length ?? 0) + (atual.orcamento_projeto_analises?.length ?? 0);
  if (itens === 0 && !atual.projeto_sem_custo_justificativa) {
    throw new Error("Adicione ao menos um custo ou análise antes de concluir a revisão.");
  }

  const { data, error } = await supabase.rpc("concluir_revisao_custos_projeto", {
    p_orcamento_projeto_id: id,
    p_observacao: texto(formData, "observacao") ?? "Revisão dos custos de projeto concluída.",
  });
  if (error) throw new Error(error.message);
  revalidarEtapaProjeto(demandaDe(atual, formData));
  revalidatePath("/orcamento/modelos");
  return mensagemConclusaoCatalogo(data);
}
```

  - Trocar o wrapper exportado por:

```ts
export async function concluirRevisaoCustosProjeto(formData: FormData): Promise<EstadoAcao | void> {
  try {
    return sucesso(await concluirRevisaoCustosProjetoInterno(formData));
  } catch (erro) {
    unstable_rethrow(erro);
    return falha(mensagemDoBanco(erro instanceof Error ? erro.message : erro));
  }
}
```

  - Em `src/components/orcamento/projeto/FormAcao.tsx`, trocar a função `enviar` por:

```ts
  async function enviar(formData: FormData) {
    let mensagem = sucesso;
    try {
      const resultado = await action(formData);
      if (resultado && !resultado.ok) {
        toast.error(resultado.message ?? "Não foi possível salvar. Tente novamente.");
        return;
      }
      // A ação pode devolver um texto de sucesso mais preciso (ex.: resumo do catálogo).
      if (resultado?.ok && resultado.message) mensagem = resultado.message;
    } catch (erro) {
      const texto = erro instanceof Error && erro.message ? erro.message : "Tente novamente.";
      toast.error(`Não foi possível salvar. ${texto}`);
      return;
    }
    if (mensagem) toast.success(mensagem);
    aoConcluir?.();
  }
```

  - Em `src/lib/testing/mock-supabase.ts`, logo antes de `if (fn === "transicionar_orcamento_projeto") {`, acrescentar:

```ts
      // 0137: o simulado não reproduz o catálogo vivo (coberto pelo teste SQL);
      // conclui pela mesma transição e devolve o resumo vazio.
      if (fn === "previa_catalogo_revisao_projeto") {
        return { data: [], error: null };
      }
      if (fn === "concluir_revisao_custos_projeto") {
        try {
          transicionarOrcamentoProjeto({
            p_orcamento_projeto_id: args.p_orcamento_projeto_id,
            p_status_destino: "enviado",
            p_observacao: args.p_observacao ?? null,
          });
          return { data: { novos: 0, atualizados: 0, pendentes: 0, repetidos: 0 }, error: null };
        } catch (error) {
          return { data: null, error: { message: error instanceof Error ? error.message : "Erro na RPC" } };
        }
      }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/actions/orcamento-projetos.test.ts src/lib/testing && npm run typecheck`
Expected: PASS. O caso "não conclui revisão sem itens nem fora do rascunho" continua verde (a RPC não é chamada).

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/orcamento-projetos.ts src/lib/actions/orcamento-projetos.test.ts src/components/orcamento/projeto/FormAcao.tsx src/lib/testing/mock-supabase.ts
git commit -m "feat(orçamentos): concluir a revisão alimenta o catálogo e mostra o resumo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B4: Linhas vindas do catálogo guardam o valor de referência

**Files:**
- Modify: `src/lib/actions/orcamento-projetos.ts` (insert de `adicionarCustoCatalogoProjetoInterno` e insert das linhas padrão em `salvarViagensProjetoInterno`)
- Test: `src/lib/actions/orcamento-projetos.test.ts`

**Interfaces:**
- Consumes: coluna `catalogo_valor_base` (B1).

- [ ] **Step 1: Write the failing tests** — acrescentar dentro do `describe` principal:

```ts
  it("item do catálogo guarda o valor de referência para a conclusão saber se foi alterado", async () => {
    const { adicionarCustoCatalogoProjeto } = await import("./orcamento-projetos");
    rpc.mockResolvedValue({
      data: [{ id: "MC-6", rubrica: "MC", descricao: "Papel toalha", unidade: "fardo", preco_unitario: 50, preco_mascarado: false, categoria: "Geral", ativo: true }],
      error: null,
    });
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");
    formData.set("catalogo_item_id", "MC-6");
    formData.set("quantidade", "3");

    await expect(adicionarCustoCatalogoProjeto(formData)).resolves.toBeUndefined();

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      catalogo_item_id: "MC-6",
      custo_unitario: 50,
      catalogo_valor_base: 50,
      quantidade: 3,
      origem: "catalogo",
    }));
  });

  it("linhas de viagem criadas do catálogo guardam o valor de referência", async () => {
    const { salvarViagensProjeto } = await import("./orcamento-projetos");
    lista = [];
    rpc.mockResolvedValue({
      data: [{ id: "VD-2", rubrica: "VD", descricao: "Hospedagem", unidade: "diárias de hotel", preco_unitario: 250, categoria: "Hospedagem", ativo: true }],
      error: null,
    });
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");
    formData.set("diarias_hospedagem", "4");
    formData.set("quartos", "1");
    formData.set("criar_linhas_padrao", "1");

    await salvarViagensProjeto(formData);

    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({ catalogo_item_id: "VD-2", custo_unitario: 250, catalogo_valor_base: 250, quantidade: 4 }),
    ]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/actions/orcamento-projetos.test.ts -t "valor de referência"`
Expected: FAIL, porque `catalogo_valor_base` está ausente do objeto inserido.

- [ ] **Step 3: Implement**
  - Em `adicionarCustoCatalogoProjetoInterno`, no objeto do `insert`, logo depois de `preco_unitario: Number(item.preco_unitario ?? 0),`, acrescentar `catalogo_valor_base: Number(item.preco_unitario ?? 0),`.
  - Em `salvarViagensProjetoInterno`, no `faltantes.map(...)`, logo depois de `preco_unitario: Number(item.preco_unitario ?? 0),`, acrescentar `catalogo_valor_base: Number(item.preco_unitario ?? 0),`.
  - Linhas manuais e de modelo **não** recebem base: ficam sem vínculo e a conclusão as compara pelo item.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/actions/orcamento-projetos.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/orcamento-projetos.ts src/lib/actions/orcamento-projetos.test.ts
git commit -m "feat(orçamentos): linhas do catálogo guardam o valor de referência

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B5: Editor mostra selos, resumo na conclusão e origem do valor

**Files:**
- Modify: `src/components/orcamento/projeto/EditorCustosProjeto.tsx` (imports, carga de dados depois de `estado`, célula "Origem" em `tabelaItens`, mensagem do `ConfirmSubmitButton` de conclusão)
- Modify: `src/components/orcamento/projeto/AdicionarDoCatalogo.tsx` (tipo `ItemCatalogo` e linha de origem do item escolhido)

**Interfaces:**
- Consumes: `lerPlanoCatalogo`, `seloLinhaCatalogo`, `resumirPlanoCatalogo`, `frasesPreviaCatalogo`, `LinhaPlanoCatalogo`, `SeloCatalogo` (B2); RPC `previa_catalogo_revisao_projeto` (B1).

- [ ] **Step 1: Imports e carga da prévia** — em `EditorCustosProjeto.tsx`:
  - Acrescentar aos imports:

```ts
import {
  frasesPreviaCatalogo,
  lerPlanoCatalogo,
  resumirPlanoCatalogo,
  seloLinhaCatalogo,
  type LinhaPlanoCatalogo,
  type SeloCatalogo,
} from "@/lib/project-budget/catalogo-vivo";
```

  - Logo depois de `const editavel = estado.editavel;`, acrescentar:

```ts
  // Catálogo vivo (0137): o que a conclusão faria com cada linha. Só interessa em edição.
  const { data: previaData } = editavel
    ? await supabase.rpc("previa_catalogo_revisao_projeto", { p_orcamento_projeto_id: orcamentoProjetoId })
    : { data: null };
  const planoCatalogo = lerPlanoCatalogo(previaData);
  const planoPorLinha = new Map(planoCatalogo.map((linha) => [linha.linhaId, linha]));
  const frasesCatalogo = frasesPreviaCatalogo(resumirPlanoCatalogo(planoCatalogo));
```

  - Antes de `export async function EditorCustosProjeto`, acrescentar:

```tsx
const TOM_SELO: Record<SeloCatalogo["tom"], string> = {
  novo: "bg-info-soft text-info-strong",
  atualiza: "bg-success-soft text-success-strong",
  aviso: "bg-warning-soft text-warning-strong",
};

/** Selo do catálogo vivo na linha (novo, atualiza, catálogo hoje, repetido, pessoal pendente). */
function SeloCatalogoLinha({ linha }: { linha?: LinhaPlanoCatalogo }) {
  const selo = linha ? seloLinhaCatalogo(linha) : null;
  if (!selo) return null;
  return (
    <span
      className={`mt-1 block w-fit rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TOM_SELO[selo.tom]}`}
      title={selo.detalhe}
    >
      {selo.rotulo}
    </span>
  );
}
```

- [ ] **Step 2: Selo na célula "Origem"** — em `tabelaItens`, trocar

```tsx
                  <td className="px-3 py-2 text-xs text-muted-foreground">{ORIGEM[item.origem ?? "manual"] ?? item.origem}</td>
```

por

```tsx
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {ORIGEM[item.origem ?? "manual"] ?? item.origem}
                    <SeloCatalogoLinha linha={planoPorLinha.get(item.id)} />
                  </td>
```

- [ ] **Step 3: Resumo do catálogo na confirmação** — no `ConfirmSubmitButton` de "Concluir revisão dos custos?", dentro do fragmento `mensagem`, logo depois do segundo `<p className="mt-2">…</p>`, acrescentar:

```tsx
                    {frasesCatalogo.length > 0 ? (
                      <div className="mt-2">
                        <p className="font-medium">No catálogo de custos:</p>
                        <ul className="mt-1 list-disc space-y-1 pl-5">
                          {frasesCatalogo.map((frase) => (
                            <li key={frase}>{frase}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="mt-2">O catálogo de custos não muda.</p>
                    )}
```

- [ ] **Step 4: Origem do valor no seletor do catálogo** — em `AdicionarDoCatalogo.tsx`:
  - No tipo `ItemCatalogo`, acrescentar:

```ts
  /** Quando e de qual proposta veio o valor atual (catálogo vivo, 0137). */
  valor_atualizado_em?: string | null;
  valor_origem_demanda_titulo?: string | null;
```

  - Acrescentar o import `import { formatDate } from "@/lib/formatters";`.
  - Depois de `const escolhaValida = …`, acrescentar `const escolhido = filtrados.find((item) => item.id === selecionado);`.
  - Logo depois de `<Enviar desabilitado={!escolhaValida} />`, acrescentar:

```tsx
      {escolhaValida && escolhido && !escolhido.preco_mascarado && escolhido.valor_atualizado_em && (
        <p className="text-xs text-muted-foreground md:col-span-4">
          Valor de referência de {formatDate(escolhido.valor_atualizado_em)}
          {escolhido.valor_origem_demanda_titulo ? `, proposta “${escolhido.valor_origem_demanda_titulo}”` : ", carga inicial do catálogo"}.
        </p>
      )}
```

  - O editor já repassa cada linha de `orcamento_projeto_catalogo_listar` com `...item`, então os campos novos chegam sem outra mudança.

- [ ] **Step 5: Verificar**

Run: `npm run typecheck && npm run lint && npx vitest run src/components src/lib/project-budget src/lib/actions`
Expected: sem erros.

Depois, prévia manual no servidor de desenvolvimento **desta** worktree (não na do dono), com o banco local já na 0137:
1. Abrir uma proposta "Apenas projeto" em rascunho.
2. Lançar um item manual novo e mudar o valor de uma linha que veio do catálogo.
3. Conferir os selos "Novo no catálogo" e "Atualiza o catálogo".
4. Clicar em "Concluir revisão dos custos" e conferir o resumo na confirmação e o aviso depois de concluir.
5. Abrir outra proposta, escolher o item no catálogo e conferir o valor novo com data e proposta de origem.
   Numa terceira proposta ainda aberta com o valor antigo, conferir a etiqueta "Catálogo hoje: R$ X" e que o
   valor da linha **não** mudou.
6. Capturar a tela para o relatório.

- [ ] **Step 6: Commit**

```bash
git add src/components/orcamento/projeto/EditorCustosProjeto.tsx src/components/orcamento/projeto/AdicionarDoCatalogo.tsx
git commit -m "feat(orçamentos): selos do catálogo vivo no editor, resumo na conclusão e origem do valor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B6: Versão, verificação completa e relatório

**Files:**
- Modify: `src/config/app.ts` (`APP_VERSION = "1.2.2"`)
- Create: `docs/catalogo-vivo-projeto-fase-b-2026-09-28.md`

- [ ] **Step 1: Versão** — trocar a linha de `src/config/app.ts` por `export const APP_VERSION = "1.2.2";` e rodar `npm run version:check -- claude/budget-module-reorganization-143e54`.
Expected: `ok` (1.2.1 → 1.2.2).

- [ ] **Step 2: Verificação sem build**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: tudo verde. O `build` e o E2E ficam para o CI, porque o dono usa `npm run dev` em outra worktree.

- [ ] **Step 3: Relatório** — criar `docs/catalogo-vivo-projeto-fase-b-2026-09-28.md` com:
  - o que foi feito (fases A e B);
  - as decisões aplicadas (DC1 maior valor agora; DC2/DC8 permissão "Valores de pessoal no orçamento"; DC6 o tipo decide);
  - lembrete ao dono: dar a permissão "Valores de pessoal no orçamento" em Usuários a quem faz orçamento de projeto;
  - a lista de itens unificados pela 0137 no banco local (`select id, substituido_por, preco_unitario from orcamento_projeto_catalogo where substituido_por is not null`);
  - como aplicar em produção quando o dono pedir: backup lógico das três tabelas, `npm run db:migration -- --arquivo supabase/migrations/0137_catalogo_vivo_projeto.sql --env-file <arquivo de produção> --ensaio`, depois sem `--ensaio`;
  - rollback (cabeçalho da 0137);
  - o que fica para as fases C, D e E.

- [ ] **Step 4: Commit**

```bash
git add src/config/app.ts docs/catalogo-vivo-projeto-fase-b-2026-09-28.md
git commit -m "chore: versão 1.2.2 e relatório do catálogo vivo (fases A e B)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Depois das fases A e B

Ordem decidida: **D → C → E**.
- **D (primeiro, porque o dono precisa editar o catálogo):** tela `/orcamento/catalogo`, migration 0138. Criar
  e editar item, arquivar, reativar, unificar, histórico, pendências de pessoal, exportar e importar planilha,
  ações por ícone (`IconeAcao`).
- **C:** editor que conversa com o catálogo. Etiqueta "catálogo hoje" sem troca automática (DC5), caixa
  "Análises dentro do projeto" retirada para lançamentos novos (DC3), alerta amarelo de 8 meses (DC7).
- **E:** reabrir revisão em qualquer situação, inclusive aprovada, como reformulação (DC4), e modelos (migration
  0139).

Cada fase ganha plano próprio neste formato, escrito sobre o código já alterado, com os critérios de aceite da
seção 5 do desenho.
