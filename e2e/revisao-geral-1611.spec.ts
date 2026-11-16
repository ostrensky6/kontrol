import { expect, test } from "@playwright/test";

// Revisão geral de 16/11/2026 (usabilidade, layout e design). Cada teste prova
// um defeito de aparência que a revisão corrigiu, para ele não voltar.

const TELAS = [
  "/",
  "/cadastros",
  "/usuarios",
  "/scanner/triagem",
  "/orcamento/modelos",
  "/orcamento/historico",
  "/pedido",
  "/estoque",
  "/analises",
];

for (const largura of [390, 768, 1280]) {
  test(`nenhuma tela rola para o lado a ${largura} px`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: 850 });
    for (const tela of TELAS) {
      await page.goto(tela);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      const sobra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(sobra, `${tela} a ${largura} px`).toBeLessThanOrEqual(1);
    }
  });
}

test("barra do topo cabe numa linha no notebook, com todos os lugares do módulo", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const [tela, lugares] of [
    ["/estoque", 7],
    ["/auditoria", 7],
    ["/suprimentos", 5],
  ] as const) {
    await page.goto(tela);
    const barra = page.getByTestId("barra-superior");
    await expect(barra.getByRole("navigation").getByRole("link")).toHaveCount(lugares);
    const tops = await barra
      .getByRole("navigation")
      .getByRole("link")
      .evaluateAll((links) => [...new Set(links.map((link) => Math.round(link.getBoundingClientRect().top)))]);
    expect(tops, `${tela}: os lugares ficam numa linha só`).toHaveLength(1);
  }
});

test("catálogo de análises mostra a ação da linha inteira no notebook", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/analises");
  const acao = page.getByRole("link", { name: "Abrir ficha" }).first();
  await expect(acao).toBeVisible();
  const caixa = await acao.boundingBox();
  expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(1280);
  // a tabela não rola para o lado: nada fica escondido atrás da borda
  const rola = await page
    .locator("table")
    .first()
    .evaluate((tabela) => tabela.parentElement!.scrollWidth - tabela.parentElement!.clientWidth);
  expect(rola).toBeLessThanOrEqual(1);
  // o nome da análise também abre a ficha
  await page.getByRole("link", { name: "Eletroforese hemolinfa" }).click();
  await expect(page).toHaveURL(/\/analises\/Eletrof_vir_hem$/);
});

test("Novo pedido é o mesmo botão nas três telas de Compras", async ({ page }) => {
  const classes: string[] = [];
  for (const tela of ["/suprimentos", "/compras"]) {
    await page.goto(tela);
    const botao = page.getByRole("link", { name: "Novo pedido", exact: true });
    await expect(botao).toBeVisible();
    classes.push((await botao.getAttribute("class")) ?? "");
  }
  expect(classes[0]).toBe(classes[1]);
  expect(classes[0]).toContain("bg-primary");
  await page.goto("/pedido");
  await expect(page.getByRole("button", { name: "Novo pedido" })).toBeVisible();
});

test("títulos das telas do Estoque iguais aos do menu", async ({ page }) => {
  await page.goto("/estoque/inventario");
  await expect(page.getByRole("heading", { level: 1, name: "Inventário", exact: true })).toBeVisible();
  await page.goto("/etiquetas");
  await expect(page.getByRole("heading", { level: 1, name: "Etiquetas", exact: true })).toBeVisible();
});
