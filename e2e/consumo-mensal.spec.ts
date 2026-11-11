import { expect, test } from "@playwright/test";

// L10: o consumo mensal se lê na ficha do insumo; a estimativa manual e o
// histórico abrem a partir dela.
test("estoque: consumo mensal na ficha do insumo e estimativa manual a partir dela", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (erro) => erros.push(erro.message));
  await page.goto("/estoque");
  // o consumo não é mais uma das visões da página do Estoque
  await expect(page.getByRole("navigation", { name: "O que mostrar do estoque" }).getByRole("link", { name: "Consumo mensal" })).toHaveCount(0);

  await page.goto("/estoque/insumos/1");
  const ficha = page.getByRole("region", { name: "Consumo mensal" });
  // Outros testes mexem nos movimentos do mock: só a estrutura é fixa.
  await expect(ficha.getByText(/Confiança (alta|média|baixa)|Sem dados/).first()).toBeVisible();
  await expect(ficha.getByText("Consumo de referência:")).toBeVisible();

  await page.getByRole("link", { name: "Estimativa manual e histórico de revisões" }).click();
  await expect(page).toHaveURL(/consumo_insumo=1/);
  await expect(page.getByRole("heading", { name: "Consumo mensal · Mix PCR" })).toBeVisible();
  await page.getByRole("link", { name: "Voltar à ficha do insumo" }).click();
  await expect(page).toHaveURL(/\/estoque\/insumos\/1$/);
  // O usuário do mock não tem id no formato do Supabase; a estimativa manual
  // tem testes próprios (vitest e banco). Aqui basta não quebrar a página.
  expect(erros).toEqual([]);
});
