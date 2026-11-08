import { expect, test } from "@playwright/test";

test("estoque: consumo mensal calculado do insumo escolhido", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (erro) => erros.push(erro.message));
  await page.goto("/estoque");
  const secao = page.getByRole("region", { name: "Consumo mensal" }).first();
  await secao.getByLabel("Insumo").selectOption({ label: "Mix PCR · #1" });
  await secao.getByRole("button", { name: "Ver consumo" }).click();
  await expect(page).toHaveURL(/consumo_insumo=1/);
  await expect(page.getByRole("heading", { name: "Consumo mensal · Mix PCR" })).toBeVisible();
  // Outros testes mexem nos movimentos do mock: só a estrutura é fixa.
  await expect(page.getByText(/Confiança (alta|média|baixa)|Sem dados/).first()).toBeVisible();
  await expect(page.getByText("Consumo de referência:")).toBeVisible();
  // O usuário do mock não tem id no formato do Supabase; a estimativa manual
  // tem testes próprios (vitest e banco). Aqui basta não quebrar a página.
  expect(erros).toEqual([]);
});
