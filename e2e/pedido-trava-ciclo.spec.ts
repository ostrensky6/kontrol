import { expect, test, type Page } from "@playwright/test";

/**
 * 0176: pedido aprovado depois do prazo do dia 10 fica no ciclo seguinte e só
 * segue para compras quando o ciclo abrir. A tela trava "Formalizar em
 * compras" com o motivo e a lista mostra quando o ciclo abre.
 * 0184: quem tem "Conduzir a compra inteira" (e o Administrador) não para no
 * ciclo: vê o aviso e o botão fica liberado. O Gestor não tem a caixinha.
 */
async function comoCategoria(page: Page, papel: string) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL ausente na configuração do Playwright");
  await page.context().addCookies([{ name: "kontrol_e2e_papel", value: papel, url: baseURL }]);
}

test.afterEach(async ({ page }) => {
  await page.context().clearCookies();
});

test("pedido do ciclo seguinte trava a formalização com o motivo", async ({ page }) => {
  await comoCategoria(page, "gestor");
  await page.goto("/pedido/501");
  await expect(page.getByRole("heading", { name: "Reagente do ciclo seguinte E2E" })).toBeVisible();
  await expect(page.getByTestId("ciclo-pagamento")).toContainText("Ciclo de compras: dezembro/2099");
  await expect(page.getByTestId("ciclo-pagamento")).toContainText("Segue para compras a partir de 01/12/2099.");
  await expect(page.getByRole("heading", { name: "Aguardar o ciclo de dezembro/2099" })).toBeVisible();

  const formalizar = page.getByRole("button", { name: "Formalizar em compras" }).first();
  await expect(formalizar).toBeDisabled();
  await expect(
    page.getByText('Ele segue para compras a partir de 01/12/2099. Só pedido urgente, com justificativa, ou quem tem "Conduzir a compra inteira" fura o ciclo.').first(),
  ).toBeVisible();

  // quem pede não muda a urgência (contornaria a trava): Editar só mostra e aponta para quem define (0183)
  await page.getByRole("button", { name: "Editar" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("urgencia-fixa")).toContainText("Urgência: Normal. Quem define é o administrativo, pelo botão “Definir urgência” do pedido.");
  await expect(dialog.getByLabel("Urgência")).toHaveCount(0);
});

test("quem conduz a compra inteira vê o aviso e segue antes do ciclo abrir", async ({ page }) => {
  await page.goto("/pedido/501");
  await expect(page.getByRole("heading", { name: "Reagente do ciclo seguinte E2E" })).toBeVisible();
  await expect(page.getByTestId("ciclo-pagamento")).toContainText("Ciclo de compras: dezembro/2099");
  await expect(
    page.getByText("Pelo ciclo do dia 10, este pedido seguiria para compras em 01/12/2099. Como você conduz a compra inteira, pode seguir agora").first(),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aguardar o ciclo de dezembro/2099" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Formalizar em compras" }).first()).toBeEnabled();
});

test("lista de pedidos mostra quando o ciclo abre", async ({ page }) => {
  await page.goto("/pedido");
  // a lista tem páginas: a busca acha o pedido, quantos forem os pedidos que os outros roteiros criaram
  await page.getByRole("searchbox", { name: "Buscar pedido, projeto ou solicitante" }).fill("Reagente do ciclo seguinte E2E");
  const linha = page.getByRole("row", { name: /Reagente do ciclo seguinte E2E/ });
  await expect(linha).toContainText("dezembro/2099 · abre 01/12/2099");
});
