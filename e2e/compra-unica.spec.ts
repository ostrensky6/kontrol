import { expect, test, type Page } from "@playwright/test";

/**
 * Auditoria de 16/11, item 10, proposta 2 (compra única na tela, aprovada em
 * 17/11/2026). A compra que nasceu de um pedido é conduzida no pedido, no
 * quadro "Compra": fornecedor, situação, previsão, chegada, envio pela
 * instituição, pendência e impressão. A tela da compra vira consulta e a
 * lista de compras abre o pedido. A compra sem pedido (pendência de outra
 * compra) continua com os botões dela.
 *
 * O que o banco faz (fechar o pedido marca a compra como enviada, 0182) é
 * provado no teste da migration e no roteiro contra o banco real.
 */

async function comoCategoria(page: Page, papel: string) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL ausente na configuração do Playwright");
  await page.context().addCookies([{ name: "kontrol_e2e_papel", value: papel, url: baseURL }]);
}

test.afterEach(async ({ page }) => {
  await page.context().clearCookies();
});

test("o pedido conduz a compra: o quadro Compra mostra fornecedor, situação, previsão e chegada", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/pedido/504");
  const painel = page.getByTestId("painel-compra");
  await expect(painel.getByRole("heading", { name: "Compra #9401" })).toBeVisible();
  await expect(painel.getByTestId("painel-compra-situacao")).toHaveText("Enviado");
  await expect(painel.getByTestId("painel-compra-fornecedor")).toHaveText("Fornecedor E2E");
  await expect(painel.getByTestId("painel-compra-previsao")).toHaveText("01/12/2099");
  await expect(painel.getByTestId("painel-compra-chegada")).toHaveText("0 de 1 item recebido");
  await expect(painel).toContainText("Registre a chegada na linha do item, na tabela abaixo.");
  // a impressão e a consulta da compra saem daqui
  await expect(painel.getByRole("link", { name: "Imprimir / PDF" })).toHaveAttribute("href", "/compras/9401/imprimir");
  await expect(painel.getByRole("link", { name: "Consultar a compra" })).toHaveAttribute("href", "/compras/9401");
  // já enviada e com fornecedor: nada a registrar; nada chegou, então não há pendência a encerrar
  await expect(painel.getByTestId("painel-compra-envio")).toHaveCount(0);
  await expect(painel.getByTestId("painel-compra-sem-fornecedor")).toHaveCount(0);
  await expect(painel.getByTestId("painel-compra-pendencia")).toHaveCount(0);
  // a chegada continua na linha do item, logo abaixo
  await expect(page.getByTestId("chegada-pela-compra").getByRole("button", { name: "Registrar chegada" })).toBeVisible();
});

test("compra pela Fundação: o quadro pede o fornecedor, registra o envio da instituição e encerra com pendência", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/pedido/505");
  const painel = page.getByTestId("painel-compra");
  await expect(painel.getByRole("heading", { name: "Compra #9403" })).toBeVisible();
  await expect(painel.getByTestId("painel-compra-situacao")).toHaveText("Aprovado");
  await expect(painel.getByTestId("painel-compra-previsao")).toHaveText("sem previsão");
  await expect(painel.getByTestId("painel-compra-chegada")).toHaveText("0 de 1 item recebido");

  // o orçamento escolhido trouxe só o nome digitado: o quadro avisa e já aponta o cadastro de mesmo nome
  await expect(painel.getByTestId("painel-compra-fornecedor")).toHaveText("Falta definir");
  const aviso = painel.getByTestId("painel-compra-sem-fornecedor");
  await expect(aviso).toContainText("O orçamento escolhido traz o nome “fornecedor e2e”, que está no cadastro.");
  await expect(aviso.getByLabel("Fornecedor da compra")).toHaveValue("71");
  await expect(aviso.getByRole("button", { name: "Definir fornecedor" })).toBeVisible();

  // Fundação ou Universidade: o envio ao fornecedor é o segundo momento, registrado aqui
  const envio = painel.getByTestId("painel-compra-envio");
  await expect(envio.getByRole("button", { name: "Instituição enviou ao fornecedor" })).toBeVisible();
  await expect(envio).toContainText("a compra passa a enviada e a previsão de entrega é calculada");

  // chegou 1 de 4: "Encerrar com pendência" fica no pedido, com os três destinos
  const pendencia = painel.getByTestId("painel-compra-pendencia");
  await expect(pendencia.getByRole("heading", { name: "Faltou item?" })).toBeVisible();
  await expect(pendencia.getByRole("radio")).toHaveCount(3);
  await expect(pendencia.getByRole("button", { name: "Encerrar com pendência" })).toBeVisible();
});

test("sem a permissão de aprovar compras, o quadro mostra a compra e diz o que falta", async ({ page }) => {
  await comoCategoria(page, "laboratorio");
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/pedido/505");
  const painel = page.getByTestId("painel-compra");
  await expect(painel.getByRole("heading", { name: "Compra #9403" })).toBeVisible();
  await expect(painel).toContainText("Definir o fornecedor exige a permissão “Aprovar compras”.");
  await expect(painel).toContainText("Registrar o envio exige a permissão “Aprovar compras”.");
  await expect(painel).toContainText("Encerrar com pendência exige a permissão “Aprovar compras”.");
  await expect(painel.getByRole("button", { name: "Definir fornecedor" })).toHaveCount(0);
  await expect(painel.getByRole("button", { name: "Instituição enviou ao fornecedor" })).toHaveCount(0);
  await expect(painel.getByRole("button", { name: "Encerrar com pendência" })).toHaveCount(0);
});

test("a tela da compra que nasceu de pedido vira consulta e aponta para o pedido", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/compras/9401");
  await expect(page.getByRole("heading", { level: 1, name: "Compra #9401" })).toBeVisible();
  const nota = page.getByTestId("compra-conduzida-no-pedido");
  await expect(nota).toContainText("Esta compra nasceu do pedido Nº 0504 e é conduzida lá");
  await expect(nota.getByRole("link", { name: "Abrir o pedido Nº 0504" })).toHaveAttribute("href", "/pedido/504#compra");
  // sem botões de etapa: o envio, o fornecedor e a pendência ficam no pedido
  await expect(page.getByRole("button", { name: "Aprovar", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Marcar enviado" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Encerrar com pendência" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Definir fornecedor" })).toHaveCount(0);
  // consulta: mostra tudo, imprime e continua registrando a chegada; o cancelamento segue aqui
  await expect(page.getByRole("link", { name: "Imprimir / PDF" })).toHaveAttribute("href", "/compras/9401/imprimir");
  await expect(page.getByRole("link", { name: "Pedido #504" })).toHaveAttribute("href", "/pedido/504");
  await expect(page.getByRole("button", { name: "Registrar chegada" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancelar compra" })).toBeVisible();

  await nota.getByRole("link", { name: "Abrir o pedido Nº 0504" }).click();
  await expect(page).toHaveURL(/\/pedido\/504#compra$/);
  await expect(page.getByTestId("painel-compra")).toBeVisible();
});

test("a compra sem fornecedor que nasceu de pedido manda definir o fornecedor no pedido", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/compras/9403");
  await expect(page.getByTestId("compra-conduzida-no-pedido")).toContainText("pedido Nº 0505");
  await expect(page.getByText("Compra sem fornecedor.")).toBeVisible();
  await expect(page.getByRole("link", { name: "pedido Nº 0505", exact: true })).toHaveAttribute("href", "/pedido/505#compra");
  await expect(page.getByRole("button", { name: "Definir fornecedor" })).toHaveCount(0);
  // já chegou parte: não cancela, e a pendência é encerrada no pedido
  await expect(page.getByRole("button", { name: "Cancelar compra" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Encerrar com pendência" })).toHaveCount(0);
});

test("a compra sem pedido continua com os botões dela", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/compras/9402");
  await expect(page.getByRole("heading", { level: 1, name: "Compra #9402" })).toBeVisible();
  await expect(page.getByTestId("compra-conduzida-no-pedido")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Marcar enviado" })).toBeVisible();
  // chegou 1 de 4 frascos: a pendência é encerrada aqui mesmo
  await expect(page.getByRole("button", { name: "Encerrar com pendência" })).toBeVisible();
});

test("a lista de compras abre o pedido, já no quadro Compra", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/compras");
  await expect(page.getByRole("columnheader", { name: "Pedido" })).toBeVisible();

  const doPedido = page.getByRole("row").filter({ hasText: "#9401" });
  await expect(doPedido).toContainText("Nº 0504");
  await expect(doPedido.getByRole("link", { name: /^#9401/ })).toHaveAttribute("href", "/pedido/504#compra");

  // a compra sem pedido abre a própria tela
  const semPedido = page.getByRole("row").filter({ hasText: "#9402" });
  await expect(semPedido.getByRole("link", { name: /^#9402/ })).toHaveAttribute("href", "/compras/9402");

  // a busca acha a compra pelo número do pedido
  await page.getByPlaceholder(/^Buscar compra, pedido/).fill("Nº 0505");
  await expect(page.getByRole("row").filter({ hasText: "#9403" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "#9401" })).toHaveCount(0);
  await page.getByPlaceholder(/^Buscar compra, pedido/).fill("");

  await doPedido.getByRole("link", { name: /^#9401/ }).click();
  await expect(page).toHaveURL(/\/pedido\/504#compra$/);
  await expect(page.getByTestId("painel-compra").getByRole("heading", { name: "Compra #9401" })).toBeVisible();
});

test("no celular, o quadro Compra cabe na tela com os botões", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pedido/505");
  const painel = page.getByTestId("painel-compra");
  await expect(painel.getByRole("button", { name: "Instituição enviou ao fornecedor" })).toBeVisible();
  await expect(painel.getByRole("button", { name: "Encerrar com pendência" })).toBeVisible();
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sobra).toBeLessThanOrEqual(1);
});
