import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Editor da etapa "Custos do projeto" (Etapa A da migração do app antigo de orçamento de projetos).
 * Mock E2E (PLAYWRIGHT_MOCK_SUPABASE=1):
 *  - proposta 1: projeto já revisado ("enviado") → editor em leitura, emissão liberada;
 *  - proposta 2: projeto em edição ("rascunho"), 18 meses, um PE manual de R$ 3.000/mês.
 * O fluxo de edição roda uma vez por servidor novo: ao final a revisão é concluída
 * e reaberta (DC4), e a proposta 2 volta para edição com os itens lançados.
 */

async function totalRubrica(editor: Locator, rubrica: string) {
  return (await editor.getByTestId(`total-rubrica-${rubrica}`).textContent())?.replace(/\s/g, " ").trim();
}

async function abrirRubrica(page: Page, nome: RegExp) {
  await page.getByRole("tab", { name: nome }).click();
}

/** Mesmo gate do e2e/a11y.spec.ts: nenhuma violação crítica WCAG A/AA. */
async function semViolacoesCriticas(page: Page) {
  const resultado = await new AxeBuilder({ page })
    .include('[data-testid="editor-custos-projeto"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(resultado.violations.filter((v) => v.impact === "critical")).toEqual([]);
}

test("proposta com custos revisados mostra o editor travado e explica o motivo", async ({ page }) => {
  await page.goto("/orcamento/demandas/1?etapa=projeto");
  const editor = page.getByTestId("editor-custos-projeto");
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("note")).toContainText("Edição bloqueada.");
  await expect(editor.getByText("Revisado").first()).toBeVisible();
  await expect(editor.getByRole("button", { name: "Concluir revisão dos custos" })).toHaveCount(0);
  await expect(editor.getByRole("button", { name: /^Editar / })).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "XLSX" })).toBeVisible();
  await expect(editor.getByRole("button", { name: "DOCX" })).toBeVisible();
  expect(await totalRubrica(editor, "MC")).toBe("R$ 500,00");
  await semViolacoesCriticas(page);
});

test("edita custos do projeto e conclui a revisão", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/orcamento/demandas/2?etapa=projeto");
  const editor = page.getByTestId("editor-custos-projeto");
  await expect(editor).toBeVisible();
  await expect(editor.getByText("Em edição").first()).toBeVisible();
  // Sem meses marcados, a linha PE conta a quantidade (1 × R$ 3.000).
  await expect(editor.getByTestId("total-custo-projeto")).toHaveText(/R\$\s3\.000,00/);
  await semViolacoesCriticas(page);

  // PE: marca o ano 1 inteiro e mais um mês do ano 2 (projeto de 18 meses).
  const salvarMeses = editor.getByRole("button", { name: "Salvar meses" });
  await expect(salvarMeses).toBeDisabled();
  await editor.getByRole("button", { name: "Marcar meses do ano 1 de Pesquisador bolsista" }).click();
  await editor.getByRole("button", { name: /Ano 2 \(M13–M18\)/ }).click();
  await editor.getByRole("checkbox", { name: "Pesquisador bolsista, mês 13" }).check();
  await expect(editor.getByText("Há marcações não salvas.")).toBeVisible();
  await salvarMeses.click();
  await expect(editor.getByText("Há marcações não salvas.")).toHaveCount(0);
  await expect.poll(() => totalRubrica(editor, "PE")).toBe("R$ 39.000,00");

  // MC: campo único — digitar busca no catálogo; escolher preenche unidade e valor.
  await abrirRubrica(page, /^MC · /);
  const adicionar = editor.getByRole("form", { name: "Adicionar item em MC" });
  await adicionar.getByRole("combobox", { name: /Descrição/ }).fill("luva");
  await adicionar.getByRole("option", { name: /Luvas nitrílicas/ }).click();
  await expect(adicionar.getByText(/Do catálogo \(MC-30\)/)).toBeVisible();
  await adicionar.getByLabel("Quantidade").fill("4");
  await adicionar.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(editor.getByRole("rowheader", { name: "Luvas nitrílicas" })).toBeVisible();
  await expect.poll(() => totalRubrica(editor, "MC")).toBe("R$ 180,00");

  // MC: item novo (não está no catálogo) no mesmo campo.
  await adicionar.getByRole("combobox", { name: /Descrição/ }).fill("Frascos de coleta");
  await expect(adicionar.getByText("Item novo: entra no catálogo ao concluir a revisão.")).toBeVisible();
  await adicionar.getByLabel("Unidade").fill("un");
  await adicionar.getByLabel("Quantidade").fill("10");
  await adicionar.getByLabel(/Valor unitário/).fill("12.5");
  await adicionar.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(editor.getByRole("rowheader", { name: "Frascos de coleta" })).toBeVisible();
  await expect.poll(() => totalRubrica(editor, "MC")).toBe("R$ 305,00");

  // Edição de linha em diálogo.
  await editor.getByRole("button", { name: "Editar Frascos de coleta" }).click();
  const dialogo = page.getByRole("dialog", { name: "Editar item" });
  await dialogo.getByLabel("Quantidade").fill("20");
  await dialogo.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(dialogo).toBeHidden();
  await expect.poll(() => totalRubrica(editor, "MC")).toBe("R$ 430,00");

  // Remoção com confirmação.
  await editor.getByRole("button", { name: "Remover Luvas nitrílicas" }).click();
  const confirmar = page.getByRole("dialog", { name: "Remover item?" });
  await confirmar.getByRole("button", { name: "Remover" }).click();
  await expect(editor.getByRole("rowheader", { name: "Luvas nitrílicas" })).toHaveCount(0);
  await expect.poll(() => totalRubrica(editor, "MC")).toBe("R$ 250,00");

  // VD: entradas de viagem criam as linhas padrão com quantidade calculada.
  await abrirRubrica(page, /^VD · /);
  const viagem = editor.getByRole("form", { name: "Entradas de viagem" });
  await viagem.getByLabel("Pessoas").fill("2");
  await viagem.getByLabel("Dias de campo").fill("3");
  await viagem.getByLabel("Quartos").fill("1");
  await viagem.getByLabel("Diárias de hotel").fill("2");
  await viagem.getByRole("button", { name: "Salvar e recalcular" }).click();
  const alimentacao = editor.getByRole("row", { name: /Alimentação/ });
  await expect(alimentacao).toContainText("Calculado");
  await expect(alimentacao).toContainText("6");
  // Alimentação 6 × 130 + hospedagem 2 × 250 + seguro 6 × 15 = 1.370,00
  await expect.poll(() => totalRubrica(editor, "VD")).toBe("R$ 1.370,00");

  // Total do projeto = 39.000 + 250 + 1.370.
  await expect(editor.getByTestId("total-custo-projeto")).toHaveText(/40\.620,00/);

  // Concluir a revisão (gestor no mock) trava os custos.
  await editor.getByRole("button", { name: "Concluir revisão dos custos" }).click();
  const revisao = page.getByRole("dialog", { name: "Concluir revisão dos custos?" });
  await expect(revisao).toContainText("travados");
  await revisao.getByRole("button", { name: "Concluir revisão" }).click();
  await expect(editor.getByRole("note")).toContainText("Edição bloqueada.");
  await expect(editor.getByText("Revisado").first()).toBeVisible();
  await expect(editor.getByRole("button", { name: /^Editar / })).toHaveCount(0);
  await expect(page.locator('a[href^="/orcamento/projetos/"]')).toHaveCount(0);

  // Tudo editável (DC4): reabrir a revisão devolve os custos para edição.
  await editor.getByRole("button", { name: "Reabrir revisão" }).click();
  const reabrir = page.getByRole("dialog", { name: "Reabrir a revisão dos custos" });
  await reabrir.getByRole("button", { name: "Reabrir revisão" }).click();
  await expect(reabrir).toBeHidden();
  await expect(editor.getByText("Em edição").first()).toBeVisible();
  await expect(editor.getByRole("button", { name: "Editar Frascos de coleta" })).toBeVisible();
});
