import { expect, test } from "@playwright/test";

test("prazos de compra: página abre pela barra de Compras, a partir de Pedidos", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (erro) => erros.push(erro.message));
  await page.goto("/pedido");
  await page.getByRole("navigation", { name: "Navegação de Compras" }).getByRole("link", { name: "Prazos de compra" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Prazos de compra/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Por caminho de compra" })).toBeVisible();
  expect(erros).toEqual([]);
});
