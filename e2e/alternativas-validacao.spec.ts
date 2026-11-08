import { expect, test } from "@playwright/test";

test("alternativas: a mais cara entra no orçamento e a que não serve sai", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (erro) => erros.push(erro.message));
  await page.goto("/analises/Sanger?view=materiais-insumos");
  const painel = page.getByTestId("alternativas-validacao");
  await expect(painel).toBeVisible();
  await expect(painel.getByText("Grupo kit_sanger")).toBeVisible();
  const cara = painel.locator("li", { hasText: "Insumo mock Sanger" }).filter({ hasNotText: "alternativo" });
  await expect(cara.getByText("Entra no orçamento")).toBeVisible();

  await cara.getByRole("combobox", { name: /Decisão sobre/ }).selectOption("invalida");
  await cara.getByRole("textbox", { name: /Observação sobre/ }).fill("Teste: não serve");
  await cara.getByRole("button", { name: "Registrar" }).click();
  await expect(painel.getByText(/sai do orçamento/)).toBeVisible();

  await page.reload();
  const painel2 = page.getByTestId("alternativas-validacao");
  await expect(painel2.getByText("Não serve (fora do orçamento)")).toBeVisible();
  const alternativa = painel2.locator("li", { hasText: "Insumo mock Sanger alternativo" });
  await expect(alternativa.getByText("Entra no orçamento")).toBeVisible();
  expect(erros).toEqual([]);
});
