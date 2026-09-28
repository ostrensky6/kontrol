import { expect, test, type Page } from "@playwright/test";

/**
 * Salário dos técnicos (migration 0112). No mock E2E o cookie
 * `kontrol_e2e_papel` simula outra categoria só na avaliação de permissões
 * granulares; sem ele, a sessão é admin (vê o salário por padrão).
 * Fixtures: Técnica E2E (R$ 8.123,45) e item PE-E2E do catálogo (R$ 7.654,32).
 */
async function comoCategoria(page: Page, papel: string) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL ausente na configuração do Playwright");
  await page.context().addCookies([{ name: "kontrol_e2e_papel", value: papel, url: baseURL }]);
}

test.afterEach(async ({ page }) => {
  await page.context().clearCookies();
});

test("admin vê o salário dos técnicos e o valor de PE do catálogo", async ({ page }) => {
  await page.goto("/cadastros/tecnicos");
  const tabela = page.getByRole("table");
  await expect(tabela).toContainText("Técnica E2E");
  await expect(tabela).toContainText("8.123,45");
  await expect(tabela).not.toContainText("XXX");

  await page.goto("/orcamento/modelos");
  await expect(page.locator("#catalogo")).toContainText("7.654,32");
});

test("sem a permissão, salário e derivados aparecem como XXX e não chegam ao navegador", async ({ page }) => {
  await comoCategoria(page, "gestor");
  const resposta = await page.goto("/cadastros/tecnicos");
  const html = (await resposta?.text()) ?? "";
  expect(html).not.toContain("8123.45");
  expect(html).not.toContain("8.123,45");

  const linha = page.getByRole("row", { name: /Técnica E2E/ });
  await expect(linha).toContainText("XXX");
  // Valor/mês, Custo/hora e Valor HH mascarados
  await expect(linha.getByText("XXX", { exact: true })).toHaveCount(3);

  await page.getByRole("button", { name: "Abrir ações do registro" }).first().click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const salario = page.getByLabel("Valor mensal (R$)");
  await expect(salario).toHaveValue("XXX");
  await expect(salario).toBeDisabled();
  await expect(salario).toHaveAccessibleDescription("Visível só para quem tem permissão");
});

test("sem a permissão de pessoal, o catálogo mostra XXX só nos valores de PE", async ({ page }) => {
  // 0137: técnico não faz orçamento e não tem "Valores de pessoal no orçamento".
  await comoCategoria(page, "tecnico");
  await page.goto("/orcamento/modelos");
  const catalogo = page.locator("#catalogo");
  await expect(catalogo.getByRole("row", { name: /PE-E2E/ })).toContainText("XXX");
  await expect(catalogo).not.toContainText("7.654,32");
  await expect(catalogo.getByRole("row", { name: /MC-E2E/ })).toContainText("12,50");
});

test("coordenador vê os valores de pessoal do catálogo (Valores de pessoal no orçamento)", async ({ page }) => {
  await comoCategoria(page, "coordenador");
  await page.goto("/orcamento/modelos");
  await expect(page.locator("#catalogo").getByRole("row", { name: /PE-E2E/ })).toContainText("7.654,32");
});
