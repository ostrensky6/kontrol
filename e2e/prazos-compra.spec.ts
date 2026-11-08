import { expect, test } from "@playwright/test";

test("prazos de compra: página abre a partir de Suprimentos", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (erro) => erros.push(erro.message));
  await page.goto("/suprimentos");
  await page.getByRole("navigation", { name: "Ferramentas de estoque" }).getByRole("link", { name: "Prazos de compra" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Prazos de compra/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Por caminho de compra" })).toBeVisible();
  expect(erros).toEqual([]);
});
