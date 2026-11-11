import { expect, test } from "@playwright/test";

/**
 * Decisão de Antonio (11/11/2026): toda compra nasce de um pedido aprovado.
 * "Compras com fornecedor" deixa de ter "Nova compra" (compra sem pedido) e
 * aponta para o Novo pedido.
 */
test("Compras com fornecedor não cria compra avulsa: o caminho é o Novo pedido", async ({ page }) => {
  await page.goto("/compras");
  await expect(page.getByRole("heading", { level: 1, name: "Compras com fornecedor" })).toBeVisible();
  // a compra sem pedido e o campo dela não existem mais
  await expect(page.getByRole("button", { name: "Nova compra" })).toHaveCount(0);
  await expect(page.getByLabel("Projeto ou campanha (texto livre)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Criar compra" })).toHaveCount(0);

  // o caminho para pedir algo está na própria tela e abre o formulário do pedido
  await page.getByRole("link", { name: "Novo pedido", exact: true }).click();
  await expect(page).toHaveURL(/\/pedido\?novo=1/);
  await expect(page.getByRole("dialog", { name: "Novo pedido" })).toBeVisible();
});

test("a lista de compras continua com busca e sem campo de fornecedor para criar compra", async ({ page }) => {
  await page.goto("/compras");
  await expect(page.getByLabel("Fornecedor", { exact: true })).toHaveCount(0);
  await expect(page.locator('input[name="projeto"], select[name="fornecedor_id"], select[name="projeto_id"]')).toHaveCount(0);
});
