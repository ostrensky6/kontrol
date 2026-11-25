import { expect, test, type Locator } from "@playwright/test";

// Rodada 6 de layout e usabilidade (25/11/2026): telas que rolavam para o
// lado cabem em 1280 px, botões dizem o que fazem e campos obrigatórios têm *.

async function rolaParaOLado(caixa: Locator) {
  return caixa.evaluate((el) => el.scrollWidth - el.clientWidth);
}

test.describe("em 1280 px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Fundos e taxas não tem mais a tabela de 1.480 px", async ({ page }) => {
    await page.goto("/orcamento/fundos");
    await expect(page.getByRole("heading", { level: 1, name: "Fundos e taxas" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    await expect(page.locator("main table")).toHaveCount(0);
    // sem proposta aprovada, o aviso leva ao Histórico
    await expect(page.getByText(/Nenhuma proposta aprovada/).getByRole("link", { name: "Histórico de orçamentos" })).toHaveAttribute(
      "href",
      "/orcamento/historico",
    );
    // os painéis dizem uma vez o que é cada coluna
    // o último é o painel; o primeiro é a seção que reúne os dois painéis
    const painel = page.locator("section", { has: page.getByRole("heading", { name: "Fundos", exact: true }) }).last();
    await expect(painel.getByText("Liberado", { exact: true })).toBeVisible();
    await expect(painel.getByText("Saldo", { exact: true })).toBeVisible();
  });

  test("Parâmetros: a lista de orçamentos considerados cabe no quadro", async ({ page }) => {
    await page.goto("/orcamento/parametros");
    const quadro = page.getByRole("region", { name: "Orçamentos de projeto considerados" });
    await expect(quadro).toBeVisible();
    expect(await rolaParaOLado(quadro)).toBeLessThanOrEqual(1);
    await expect(quadro.getByRole("columnheader", { name: "Total e validação" })).toBeVisible();
  });

  test("Privilégios: a coluna Administrador aparece sem rolar", async ({ page }) => {
    await page.goto("/governanca/privilegios");
    const cabecalho = page.getByRole("columnheader", { name: "Administrador", exact: true });
    await expect(cabecalho).toBeVisible();
    const caixa = page.locator("form table").first().locator("xpath=..");
    expect(await rolaParaOLado(caixa)).toBeLessThanOrEqual(1);
  });
});

test("notificação: o botão diz a ação e não parece já marcado", async ({ page }) => {
  await page.goto("/notificacoes");
  await expect(page.getByRole("heading", { level: 1, name: "Notificações" })).toBeVisible();
  // nenhum botão só "Lida" (verde, parecia um selo de já lida)
  await expect(page.locator("main").getByRole("button").filter({ hasText: /^Lida$/ })).toHaveCount(0);
  // o mock guarda estado entre testes: outro teste pode já ter marcado a notificação como lida
  const botoes = page.getByRole("button", { name: /^Marcar como lida:/ });
  if ((await botoes.count()) > 0) {
    await expect(botoes.first()).toHaveText("Marcar como lida");
    await expect(botoes.first()).not.toHaveClass(/bg-success-soft/);
  }
});

test("cabeçalho do orçamento não mostra pílula vazia quando não há situação", async ({ page }) => {
  await page.goto("/orcamento/demandas/1");
  const pilulas = page.getByText(/^Prioridade /).locator("..");
  await expect(pilulas).toBeVisible();
  await expect(pilulas.getByText("—", { exact: true })).toHaveCount(0);
});

test("Dar baixa marca quantidade e motivo como obrigatórios", async ({ page }) => {
  await page.goto("/estoque/lotes/1");
  await page.getByRole("button", { name: "Dar baixa" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByText(/são obrigatórios/)).toBeVisible();
  await expect(dialogo.locator("label", { hasText: "Frascos a baixar" })).toContainText("*");
  await expect(dialogo.locator("label", { hasText: "Motivo" }).first()).toContainText("*");
});
