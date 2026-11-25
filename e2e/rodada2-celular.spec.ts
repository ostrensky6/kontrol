import { expect, test } from "@playwright/test";

// Rodada 2 de layout e usabilidade (25/11/2026): o celular. Cada teste prova
// uma melhoria para ela não voltar.

test.use({ viewport: { width: 390, height: 844 } });

test("no celular o lugar aberto do módulo aparece inteiro na barra", async ({ page }) => {
  for (const tela of ["/compras", "/recebimento", "/estoque/inventario"]) {
    await page.goto(tela);
    const barra = page.getByTestId("barra-superior").getByRole("navigation");
    const ativo = barra.locator('[aria-current="page"]');
    await expect(ativo).toBeVisible();
    await expect
      .poll(async () => {
        const caixa = await barra.boundingBox();
        const link = await ativo.boundingBox();
        return link!.x >= caixa!.x - 1 && link!.x + link!.width <= caixa!.x + caixa!.width + 1;
      }, { message: `${tela}: lugar aberto à vista` })
      .toBe(true);
  }
});

test("no celular a barra avisa que há mais lugares escondidos", async ({ page }) => {
  await page.goto("/estoque");
  const barra = page.getByTestId("barra-superior").getByRole("navigation");
  await expect(barra).toHaveAttribute("data-mais-a-direita", "true");
});

test("no celular os cartões de filtro do estoque ficam baixos", async ({ page }) => {
  await page.goto("/estoque");
  const cartoes = page.getByRole("group", { name: "Filtrar por situação" }).getByRole("button");
  await expect(cartoes.first()).toBeVisible();
  const alturas = await cartoes.evaluateAll((botoes) => botoes.map((b) => b.getBoundingClientRect().height));
  for (const altura of alturas) expect(altura).toBeLessThanOrEqual(64);
});

test("no celular os números do Início ficam em duas colunas", async ({ page }) => {
  await page.goto("/");
  const cartoes = page.getByRole("region", { name: "Indicadores" }).locator(":scope > *");
  await expect(cartoes.first()).toBeVisible();
  const [primeiro, segundo] = await cartoes.evaluateAll((els) => els.slice(0, 2).map((el) => el.getBoundingClientRect().top));
  expect(Math.abs(primeiro - segundo)).toBeLessThanOrEqual(1);
});

test("no celular a função e as ações do usuário ficam numa linha", async ({ page }) => {
  await page.goto("/usuarios");
  const cartao = page.getByText("coord.e2e@example.com").locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
  const funcao = cartao.getByRole("combobox").first();
  const menu = cartao.getByRole("button", { name: /^Ações de/ });
  await expect(funcao).toBeVisible();
  const caixaFuncao = await funcao.boundingBox();
  const caixaMenu = await menu.boundingBox();
  expect(Math.abs(caixaFuncao!.y + caixaFuncao!.height / 2 - (caixaMenu!.y + caixaMenu!.height / 2))).toBeLessThanOrEqual(4);
});

test("no celular a ficha do insumo mostra a etapa embaixo do pedido, sem espremer a tabela", async ({ page }) => {
  await page.goto("/estoque/insumos/1");
  const bloco = page.getByRole("region", { name: "Pedidos e compras em andamento" });
  await expect(bloco.getByRole("columnheader", { name: "Etapa" })).toBeHidden();
  const caixa = bloco.locator("table").locator("..");
  const sobra = await caixa.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sobra).toBeLessThanOrEqual(1);
});
