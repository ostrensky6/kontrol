import { expect, test, type Page } from "@playwright/test";

/**
 * Catálogo de custos ligado aos cadastros (decisão 5 de 11/11/2026, migration 0179).
 * Mock E2E: MC-12 "Alcool" (L, R$ 380) é ligado ao insumo "Kit extração E2E"
 * (custo unitário R$ 100), aparece com o selo no orçamento da proposta 2 (sem
 * lançar nada) e é desfeito no fim. Nenhum outro teste usa MC-12.
 */
async function comoCategoria(page: Page, papel: string) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL ausente na configuração do Playwright");
  await page.context().addCookies([{ name: "kontrol_e2e_papel", value: papel, url: baseURL }]);
}

test.afterEach(async ({ page }) => {
  await page.context().clearCookies();
});

test("liga item de material ao insumo, o orçamento mostra o selo e dá para desfazer", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/orcamento/modelos?rubrica=MC");
  const linha = page.locator("#catalogo").getByRole("row", { name: /MC-12/ });
  await expect(linha).toContainText("380,00");

  await linha.getByRole("button", { name: "Ligar Alcool ao cadastro de Insumos" }).click();
  const dialogo = page.getByRole("dialog", { name: "Ligar ao cadastro de Insumos" });
  await dialogo.getByLabel("Insumo", { exact: true }).selectOption("insumo:900");
  await dialogo.getByLabel(/Por unidade/).check();
  await dialogo.getByRole("button", { name: "Ligar", exact: true }).click();
  await expect(page.getByText("MC-12 ligado ao cadastro de Insumos. O valor do catálogo passou a ser o do cadastro.")).toBeVisible();
  await expect(linha).toContainText("Do cadastro de Insumos: Insumo Kit extração E2E · por unidade");
  await expect(linha).toContainText("100,00");

  // Item ligado: valor e rubrica seguem o cadastro e não se editam na tela.
  await linha.getByRole("button", { name: "Editar Alcool" }).click();
  const editar = page.getByRole("dialog", { name: "Editar MC-12" });
  await expect(editar.getByLabel("Valor unitário (R$)")).toBeDisabled();
  await expect(editar).toContainText("Valor e rubrica seguem o cadastro de Insumos");
  await editar.getByRole("button", { name: "Cancelar" }).click();

  // No orçamento, o item traz o valor do cadastro com o selo; mudar o valor vale só ali.
  await page.goto("/orcamento/demandas/2?etapa=projeto");
  const editor = page.getByTestId("editor-custos-projeto");
  await page.getByRole("tab", { name: /^MC · / }).click();
  const adicionar = editor.getByRole("form", { name: "Adicionar item em MC" });
  await adicionar.getByRole("combobox", { name: /Descrição/ }).fill("alcool");
  await adicionar.getByRole("option", { name: /Alcool/ }).click();
  await expect(adicionar.getByText("Do cadastro de Insumos", { exact: true })).toBeVisible();
  await expect(adicionar.getByText(/\(\s*MC-12\): R\$\s100,00/)).toBeVisible();
  await adicionar.getByLabel(/Valor unitário/).fill("120");
  await expect(adicionar.getByText("Valor alterado: vale só para este orçamento. O catálogo segue o cadastro de Insumos.")).toBeVisible();

  // Desfazer: o item volta a ser livre com o valor de agora.
  await page.goto("/orcamento/modelos?rubrica=MC");
  await linha.getByRole("button", { name: "Vínculo de Alcool com o cadastro de Insumos" }).click();
  await page.getByRole("dialog", { name: "Ligar ao cadastro de Insumos" }).getByRole("button", { name: "Desfazer vínculo" }).click();
  await expect(page.getByText("MC-12: vínculo desfeito. O item ficou livre com o valor atual.")).toBeVisible();
  await expect(linha).not.toContainText("Do cadastro de Insumos");
  await expect(linha.getByRole("button", { name: "Ligar Alcool ao cadastro de Insumos" })).toBeVisible();
});

test("ligar exige Modelos e catálogos; pessoal exige também Ver salário", async ({ page }) => {
  // Coordenador: sem "Modelos e catálogos", nenhum botão de ligar.
  await comoCategoria(page, "coordenador");
  await page.goto("/orcamento/modelos");
  const catalogo = page.locator("#catalogo");
  await expect(catalogo.getByRole("row", { name: /MC-12/ })).toBeVisible();
  await expect(catalogo.getByRole("button", { name: /ao cadastro de/ })).toHaveCount(0);

  // Gestor: liga material, mas não pessoal (não vê salário).
  await comoCategoria(page, "gestor");
  await page.goto("/orcamento/modelos");
  await expect(catalogo.getByRole("button", { name: "Ligar Alcool ao cadastro de Insumos" })).toBeVisible();
  await expect(catalogo.getByRole("button", { name: /ao cadastro de Técnicos/ })).toHaveCount(0);

  // Administrador: liga pessoal também.
  await page.context().clearCookies();
  await page.goto("/orcamento/modelos");
  await expect(catalogo.getByRole("button", { name: "Ligar Pesquisador sênior ao cadastro de Técnicos" })).toBeVisible();
});
