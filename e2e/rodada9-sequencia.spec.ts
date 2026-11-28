import { expect, test } from "@playwright/test";

// Rodada 9 de layout e usabilidade (25/11/2026, tarde): telas em sequência,
// primeiro o que você informa (passos numerados) e depois o resultado.

test("Custeio: escolher as análises vem antes do gráfico e o simulador mostra o resultado ao lado", async ({ page }) => {
  await page.goto("/custeio");
  const escolher = page.getByText(/Escolha as análises$/);
  const resultado = page.getByText(/Resultado: custo/);
  await expect(escolher).toBeVisible();
  const yEscolher = (await escolher.boundingBox())!.y;
  const yResultado = (await resultado.boundingBox())!.y;
  expect(yEscolher).toBeLessThan(yResultado);
  const simulado = page.getByTestId("simulador-resultado");
  await expect(simulado).toContainText("Preço simulado");
  await expect(simulado).toContainText("Reagentes");
});

test("Novo pedido numera as partes na ordem de preencher", async ({ page }) => {
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).first().click();
  const dialogo = page.getByRole("dialog", { name: "Novo pedido" });
  for (const titulo of ["Identificação do pedido", "Justificativa", "Materiais, serviços e equipamentos", "Orçamentos", "Orçamento prévio e termo de referência"]) {
    await expect(dialogo.getByRole("heading", { name: titulo, exact: true })).toBeVisible();
  }
});
