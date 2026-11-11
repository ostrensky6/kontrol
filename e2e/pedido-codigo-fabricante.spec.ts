import { expect, test } from "@playwright/test";

/**
 * Código do fabricante identifica o produto exato: digitar o código no campo
 * "Insumo existente" escolhe o insumo, mostra o código e leva marca e código
 * para o item, para quem cota e quem recebe conferirem o produto certo.
 */
test("escolhe o insumo do pedido pelo código do fabricante", async ({ page }) => {
  await page.goto("/pedido/501");
  const linha = page.getByRole("row", { name: /Etanol absoluto 1 L/ });
  await expect(linha.getByTestId("item-codigo-fabricante")).toHaveText("Código do fabricante: KX-900");

  await linha.getByRole("button", { name: "Editar" }).click();
  const dialog = page.getByRole("dialog");
  const busca = dialog.getByLabel("Insumo existente");
  await expect(busca).toHaveAttribute("placeholder", "Código do fabricante, produto ou categoria");
  await expect(busca).toHaveValue(/Kit extração E2E · cód\. KX-900|Kit extração E2E \| cód\. KX-900/);

  await busca.fill("kx 900");
  await expect(dialog.getByTestId("codigo-fabricante-escolhido")).toHaveText("Código do fabricante: KX-900 (Fabricante E2E)");
  await expect(dialog.getByLabel("Especificação", { exact: true })).toHaveValue("Kit extração E2E");
  await expect(dialog.getByLabel("Marca/modelo")).toHaveValue("Fabricante E2E · cód. KX-900");
  await expect(dialog.getByLabel("Selecionar insumo na lista filtrada")).toContainText("Kit extração E2E · cód. KX-900");
});
