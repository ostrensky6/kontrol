import { expect, test } from "@playwright/test";

/**
 * 0174: previsão de equipamentos (aba EQ) com prioridade de 1 a 3 e situação
 * que acompanha o pedido; insumo com marca de controlado (só pela FUNPAR) e
 * laboratório dono.
 */
test("previsão de equipamentos lista prioridade, laboratório e situação", async ({ page }) => {
  await page.goto("/cadastros/previsao_equipamentos");
  await expect(page.getByRole("heading", { name: "Previsão de equipamentos" })).toBeVisible();
  const linha = page.getByRole("row", { name: /Termociclador em tempo real/ });
  await expect(linha).toContainText("1 · Alta");
  await expect(linha).toContainText("Genética");
  await expect(linha).toContainText("Previsto");

  await page.getByRole("button", { name: /Novo equipamento previsto/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: /^Prioridade/ })).toHaveValue("2");
  await expect(dialog.getByLabel("Patrimônio de", { exact: true })).toBeVisible();
});

test("insumo tem marca de controlado e laboratório dono", async ({ page }) => {
  await page.goto("/cadastros/insumos");
  await page.getByRole("button", { name: /Cadastrar insumo|Novo insumo/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: "Produto controlado (só pela FUNPAR)" })).toBeVisible();
  await expect(dialog.getByLabel("Laboratório dono", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Laboratório dono", { exact: true }).locator("option", { hasText: "Genética" })).toHaveCount(1);
});
