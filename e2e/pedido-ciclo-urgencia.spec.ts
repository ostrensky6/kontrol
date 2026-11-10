import { expect, test } from "@playwright/test";

/**
 * 0172: o pedido explica em que ciclo de compras entra (dia 10) e a urgência
 * pede justificativa, que aparece no pedido.
 */
test("pedido urgente pede justificativa e mostra o ciclo de compras", async ({ page }) => {
  const titulo = `Reagente urgente ${Date.now()}`;
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const form = page.getByRole("dialog");
  await expect(form.getByTestId("ciclo-pedido")).toContainText("ciclo");
  await form.getByLabel("Título do pedido").fill(titulo);
  await form.getByLabel("Projeto").selectOption({ label: "Projeto E2E" });
  await form.getByLabel("Tipo de material ou despesa").selectOption("material_consumo_geral");
  await form.getByLabel("Objetivo").selectOption("projeto");
  await form.getByLabel("Justificativa técnica").fill("Coleta de campo da próxima semana.");

  await form.getByLabel("Urgência").selectOption("alta");
  await expect(form.getByTestId("ciclo-pedido")).toContainText("fura o ciclo do dia 10");
  const motivo = form.getByLabel("Por que é urgente? (obrigatório)");
  await expect(motivo).toBeVisible();
  await motivo.fill("Amostras chegam dia 15 e o reagente acabou");
  await form.getByRole("button", { name: "Criar rascunho" }).click();

  await expect(page).toHaveURL(/\/pedido\/\d+$/);
  await expect(page.getByText("Urgente: Amostras chegam dia 15 e o reagente acabou")).toBeVisible();
  await expect(page.getByTestId("ciclo-pagamento")).toContainText("fura o ciclo do dia 10");
});
