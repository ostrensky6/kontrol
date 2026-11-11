import { expect, test } from "@playwright/test";

/**
 * Decisão de Antonio (11/11/2026): Equipamentos é uma tela só, em Estoque, com
 * três abas: Unidades, Tipos e custo e Previsão de compra. Os endereços antigos
 * em Cadastros continuam abrindo o mesmo cadastro.
 */
test("Equipamentos tem três abas em Estoque e cada uma abre o seu cadastro", async ({ page }) => {
  await page.goto("/estoque/equipamentos");
  const abas = page.getByRole("navigation", { name: "Abas de Equipamentos" });
  await expect(abas.getByRole("link")).toHaveText(["Unidades", "Tipos e custo", "Previsão de compra"]);
  await expect(abas.locator("a[aria-current]")).toHaveText(["Unidades"]);
  await expect(page.getByRole("heading", { level: 1, name: "Equipamentos físicos" })).toBeVisible();

  await abas.getByRole("link", { name: "Tipos e custo" }).click();
  await expect(page).toHaveURL(/\/estoque\/equipamentos\/tipos$/);
  await expect(page.getByRole("heading", { level: 1, name: "Equipamentos" })).toBeVisible();
  await expect(abas.locator("a[aria-current]")).toHaveText(["Tipos e custo"]);
  // a barra lateral continua em Estoque
  const principal = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(principal.getByRole("link", { name: "Estoque" })).toHaveAttribute("aria-current", "location");

  await abas.getByRole("link", { name: "Previsão de compra" }).click();
  await expect(page).toHaveURL(/\/estoque\/equipamentos\/previsao$/);
  await expect(page.getByRole("heading", { level: 1, name: "Previsão de equipamentos" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Termociclador em tempo real/ })).toContainText("1 · Alta");
  await expect(abas.locator("a[aria-current]")).toHaveText(["Previsão de compra"]);

  await abas.getByRole("link", { name: "Unidades" }).click();
  await expect(page).toHaveURL(/\/estoque\/equipamentos$/);
});

test("os endereços antigos de Cadastros levam às abas, com a consulta preservada", async ({ page }) => {
  await page.goto("/cadastros/equipamentos?focus=1");
  await expect(page).toHaveURL(/\/estoque\/equipamentos\/tipos\?focus=1$/);
  await page.goto("/cadastros/previsao_equipamentos");
  await expect(page).toHaveURL(/\/estoque\/equipamentos\/previsao$/);
  // os outros cadastros continuam onde estavam
  await page.goto("/cadastros/locais");
  await expect(page).toHaveURL(/\/cadastros\/locais$/);
});

test("o cadastro de equipamento dentro de Estoque ainda cria, edita e exporta", async ({ page }) => {
  await page.goto("/estoque/equipamentos/tipos");
  await expect(page.getByRole("button", { name: /Novo equipamento|Cadastrar equipamento/ }).first()).toBeVisible();
  await expect(page.getByText("Planilha", { exact: true }).first()).toBeVisible();
});
