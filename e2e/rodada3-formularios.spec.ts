import { expect, test } from "@playwright/test";

// Rodada 3 de layout e usabilidade (25/11/2026): formulários e a tela do
// pedido. Cada teste prova uma melhoria para ela não voltar.

test("Novo pedido marca os campos obrigatórios e mantém os botões de enviar à vista", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).first().click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByText(/são obrigatórios/)).toBeVisible();
  await expect(dialogo.locator("label", { hasText: "Título do pedido" }).first()).toContainText("*");
  for (const rotulo of ["Tipo de material ou despesa", "Objetivo"]) {
    await expect(dialogo.locator("[data-escolha-cartoes]", { hasText: rotulo }).first()).toContainText("*");
  }
  // o nome acessível continua sem o *
  await expect(dialogo.getByRole("textbox", { name: "Título do pedido", exact: true })).toBeVisible();
  const enviar = dialogo.getByRole("button", { name: "Enviar para aprovação" });
  await expect(enviar).toBeInViewport();
});

test("Novo usuário marca o e-mail como obrigatório", async ({ page }) => {
  await page.goto("/usuarios");
  await page.getByRole("button", { name: "Novo usuário" }).first().click();
  await expect(page.locator("label", { hasText: "E-mail" }).first()).toContainText("*");
  await expect(page.getByRole("textbox", { name: "E-mail", exact: true })).toBeVisible();
});

test("cabeçalho do pedido mostra o número legível e 'Sem projeto' em vez de traço", async ({ page }) => {
  await page.goto("/pedido/502");
  const numero = page.getByText(/^Nº 0502$/).first();
  await expect(numero).toBeVisible();
  const fonte = await numero.evaluate((el) => getComputedStyle(el).fontFamily);
  expect(fonte.toLowerCase()).not.toContain("mono");
  await expect(page.getByText("Projeto: —")).toHaveCount(0);
  await expect(page.getByTestId("pedido-fatos").getByText("Sem projeto", { exact: true })).toBeVisible();
});

test("quantidade do item do pedido não quebra o número da unidade", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.goto("/pedido/502");
  const celula = page.getByRole("cell", { name: /^4 un$/ }).first();
  await expect(celula).toBeVisible();
  const altura = await celula.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getClientRects().length;
  });
  expect(altura).toBe(1);
});
