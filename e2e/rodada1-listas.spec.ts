import { expect, test } from "@playwright/test";

// Rodada 1 de layout e usabilidade (25/11/2026): listas e tabelas com tudo à
// vista e tudo ligado. Cada teste prova uma melhoria para ela não voltar.

test("lista de pedidos cabe no notebook sem rolar para o lado", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/pedido");
  const caixa = page.locator("table").first().locator("..");
  await expect(caixa).toBeVisible();
  const sobra = await caixa.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sobra).toBeLessThanOrEqual(1);
});

test("etapa do pedido não invade a coluna vizinha", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/pedido");
  const invasoes = await page.locator("tbody tr").evaluateAll((linhas) =>
    linhas.flatMap((linha) => {
      const celula = linha.children[2] as HTMLElement;
      const limite = celula.getBoundingClientRect().right;
      return [...celula.querySelectorAll("span")]
        .filter((span) => span.getBoundingClientRect().right > limite + 1)
        .map((span) => span.textContent);
    }),
  );
  expect(invasoes).toEqual([]);
});

test("tabela larga de cadastro mantém a coluna Ações à vista", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/cadastros/insumos");
  const caixa = page.locator("table").first().locator("..");
  const larga = await caixa.evaluate((el) => el.scrollWidth - el.clientWidth);
  test.skip(larga <= 1, "a tabela coube inteira");
  const acoes = page.getByRole("columnheader", { name: "Ações" });
  const borda = await caixa.boundingBox();
  const cabecalho = await acoes.boundingBox();
  expect(cabecalho!.x + cabecalho!.width).toBeLessThanOrEqual(borda!.x + borda!.width + 1);
  await expect(caixa).toHaveAttribute("data-mais-a-direita", "true");
});

test("número do pedido na lista de compras abre o pedido", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/compras");
  const link = page.locator("tbody").getByRole("link", { name: /^Nº \d+/ }).first();
  await expect(link).toHaveAttribute("href", /^\/pedido\/\d+/);
});

test("orçamento sem data e prioridade não mostra linha vazia", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/orcamento");
  await expect(page.getByText("Solicitada em —")).toHaveCount(0);
  await expect(page.getByText("prioridade —")).toHaveCount(0);
});
