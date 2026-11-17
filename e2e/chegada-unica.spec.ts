import { expect, test, type Page } from "@playwright/test";

/**
 * Auditoria de 16/11, item 10 (chegada única). O item de pedido que virou
 * compra só tinha um link para a tela da compra; agora o mesmo "Registrar
 * chegada" da compra aparece na própria linha, em Chegadas e no pedido.
 * Nenhum processo muda: é o mesmo diálogo, a mesma permissão e a mesma
 * gravação da compra. O roteiro contra o banco real prova a gravação.
 */

async function comoCategoria(page: Page, papel: string) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL ausente na configuração do Playwright");
  await page.context().addCookies([{ name: "kontrol_e2e_papel", value: papel, url: baseURL }]);
}

test.afterEach(async ({ page }) => {
  await page.context().clearCookies();
});

async function conferirDialogoDaCompra(page: Page) {
  const chegada = page.getByRole("dialog", { name: "Registrar chegada do item" });
  await expect(chegada).toBeVisible();
  await expect(chegada).toContainText("Mix PCR");
  // é o item da compra 9401 que recebe: a quantidade pendente já vem preenchida
  await expect(chegada.locator('[name="quantidade_recebida"]')).toHaveValue("3");
  await expect(chegada.locator('[name="item_id"]')).toHaveValue("94011");
  await expect(chegada.locator('[name="pedido_id"]')).toHaveValue("9401");
  await expect(chegada.getByRole("button", { name: "Confirmar chegada" })).toBeVisible();
  await chegada.getByRole("button", { name: "Cancelar" }).click();
  await expect(chegada).toBeHidden();
}

test("Chegadas registra na própria linha a chegada do item que virou compra", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/recebimento");
  const linha = page.getByRole("row").filter({ hasText: "Mix PCR da compra E2E" });
  await expect(linha).toBeVisible();
  // antes: só o link "Registrar chegada em Compras"
  await expect(linha.getByRole("link", { name: "Registrar chegada em Compras" })).toHaveCount(0);
  await expect(linha.getByRole("link", { name: "Compra #9401" })).toHaveAttribute("href", "/compras/9401");

  await linha.getByRole("button", { name: "Registrar chegada" }).click();
  await conferirDialogoDaCompra(page);
});

test("o pedido que virou compra registra a chegada na linha do item", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/pedido/504");
  const celula = page.getByTestId("chegada-pela-compra");
  await expect(celula).toBeVisible();
  await expect(celula.getByRole("link", { name: "Compra #9401" })).toHaveAttribute("href", "/compras/9401");
  // um caminho só na linha: o aviso "Registrar a chegada pela compra" dá lugar ao botão
  await expect(page.getByText("Registrar a chegada pela")).toHaveCount(0);

  await celula.getByRole("button", { name: "Registrar chegada" }).click();
  await conferirDialogoDaCompra(page);
});

test("no celular, o cartão do item em Chegadas também registra a chegada", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/recebimento");
  const botao = page.getByTestId("chegada-pela-compra").getByRole("button", { name: "Registrar chegada" }).first();
  await expect(botao).toBeVisible();
  await botao.click();
  await conferirDialogoDaCompra(page);
  // nada de rolagem lateral com o botão novo
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sobra).toBeLessThanOrEqual(1);
});

test("sem a permissão de registrar chegada de compras, a linha continua apontando para a compra", async ({ page }) => {
  await comoCategoria(page, "laboratorio");
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/pedido/504");
  await expect(page.getByTestId("chegada-pela-compra")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Registrar chegada em Compras" })).toHaveAttribute("href", "/compras/9401");
});

test("Recebimento tem uma lista só: a compra sem pedido fica na mesma tabela, com a origem escrita", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/recebimento");
  // um título, uma tabela: o bloco separado "Compras sem pedido" deixou de existir
  await expect(page.getByRole("heading", { name: "Compras sem pedido" })).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(1);
  await expect(page.getByRole("columnheader", { name: "Origem" })).toBeVisible();

  const doPedido = page.getByRole("row").filter({ hasText: "Mix PCR da compra E2E" });
  await expect(doPedido.getByRole("link", { name: "Nº 0504" })).toHaveAttribute("href", "/pedido/504");

  const daCompra = page.getByRole("row").filter({ hasText: "Pendência da compra #9400" });
  await expect(daCompra.getByRole("link", { name: "Compra #9402" })).toHaveAttribute("href", "/compras/9402");
  await expect(daCompra).toContainText("4 frascos de 500 uL");
  await expect(daCompra).toContainText("recebido 1");
  await expect(daCompra).toContainText("Fornecedor da pendência E2E");

  await daCompra.getByRole("button", { name: "Registrar chegada" }).click();
  const chegada = page.getByRole("dialog", { name: "Registrar chegada do item" });
  await expect(chegada.locator('[name="item_id"]')).toHaveValue("94021");
  await expect(chegada.locator('[name="pedido_id"]')).toHaveValue("9402");
  // faltam 3 dos 4 frascos
  await expect(chegada.locator('[name="quantidade_recebida"]')).toHaveValue("3");
  await chegada.getByRole("button", { name: "Cancelar" }).click();
});

test("a busca de Recebimento acha a compra sem pedido pelo número e pelo fornecedor", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/recebimento");
  const busca = page.getByPlaceholder(/^Buscar item, pedido/);
  await busca.fill("Compra #9402");
  await expect(page.getByRole("row").filter({ hasText: "Pendência da compra #9400" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "Mix PCR da compra E2E" })).toHaveCount(0);
  await busca.fill("Fornecedor da pendência");
  await expect(page.getByRole("row").filter({ hasText: "Pendência da compra #9400" })).toHaveCount(1);
});

test("sem a permissão, a compra sem pedido aparece na lista e diz o que falta", async ({ page }) => {
  await comoCategoria(page, "laboratorio");
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/recebimento");
  const daCompra = page.getByRole("row").filter({ hasText: "Pendência da compra #9400" });
  await expect(daCompra).toContainText("Requer a permissão “Registrar chegada de compras”");
  await expect(daCompra.getByRole("button", { name: "Registrar chegada" })).toHaveCount(0);
});
