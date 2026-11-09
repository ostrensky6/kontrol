import { expect, test } from "@playwright/test";

/**
 * 0176: pedido aprovado depois do prazo do dia 10 fica no ciclo seguinte e só
 * segue para compras quando o ciclo abrir. A tela trava "Formalizar em
 * compras" com o motivo e a lista mostra quando o ciclo abre.
 */
test("pedido do ciclo seguinte trava a formalização com o motivo", async ({ page }) => {
  await page.goto("/pedido/501");
  await expect(page.getByRole("heading", { name: "Reagente do ciclo seguinte E2E" })).toBeVisible();
  await expect(page.getByTestId("ciclo-pagamento")).toContainText("Ciclo de pagamento: dezembro/2099");
  await expect(page.getByTestId("ciclo-pagamento")).toContainText("Segue para compras a partir de 01/12/2099.");
  await expect(page.getByRole("heading", { name: "Aguardar o ciclo de dezembro/2099" })).toBeVisible();

  const formalizar = page.getByRole("button", { name: "Formalizar em compras" }).first();
  await expect(formalizar).toBeDisabled();
  await expect(
    page.getByText("Ele segue para compras a partir de 01/12/2099. Só pedido urgente, com justificativa, fura o ciclo.").first(),
  ).toBeVisible();

  // a urgência não muda num pedido validado (contornaria a trava)
  await page.getByRole("button", { name: "Editar" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("urgencia-fixa")).toContainText("Urgência: Normal. Ela só muda com o pedido em rascunho ou devolvido para ajuste.");
  await expect(dialog.getByLabel("Urgência")).toHaveCount(0);
});

test("lista de pedidos mostra quando o ciclo abre", async ({ page }) => {
  await page.goto("/pedido");
  const linha = page.getByRole("row", { name: /Reagente do ciclo seguinte E2E/ });
  await expect(linha).toContainText("dezembro/2099 · abre 01/12/2099");
});
