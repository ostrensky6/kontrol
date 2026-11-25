import { expect, test } from "@playwright/test";

// Rodada 8 de layout e usabilidade (25/11/2026, tarde): menos texto na tela.
// A explicação continua a um clique, no "?" ao lado do título ou do campo.

test("Novo pedido: explicações no ? e o ciclo numa caixa curta", async ({ page }) => {
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).first().click();
  const dialogo = page.getByRole("dialog", { name: "Novo pedido" });
  await expect(dialogo.getByText("Fonte e rubrica são definidas pelo administrativo.")).toHaveCount(0);
  await expect(dialogo.getByTestId("ciclo-pedido")).toContainText(/Entra no ciclo de compras de \S+\/\d{4}/);
  await dialogo.getByRole("button", { name: "Ajuda: Justificativa" }).click();
  await expect(page.getByRole("dialog", { name: "Justificativa" })).toContainText("Fonte e rubrica");
});

test("pedido: dados do cabeçalho em caixinhas", async ({ page }) => {
  await page.goto("/pedido/502");
  const fatos = page.getByTestId("pedido-fatos");
  await expect(fatos.getByRole("listitem")).not.toHaveCount(0);
  await expect(fatos).toContainText("Solicitante:");
  await expect(fatos).toContainText("Uso: Laboratório");
});
