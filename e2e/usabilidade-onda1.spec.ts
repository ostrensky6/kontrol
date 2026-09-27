import { expect, test } from "@playwright/test";

// Correções rápidas da auditoria de UI/UX (docs/auditoria-ui-ux-2026-09-25.md, Onda 1).

test("confirmação de emissão fecha com Esc e devolve o foco ao botão", async ({ page }) => {
  await page.goto("/orcamento/demandas/1?etapa=final");
  const emitir = page.getByRole("button", { name: "Emitir versão final" });
  await emitir.click();

  const confirmacao = page.getByRole("dialog", { name: "Emitir versão final?" });
  await expect(confirmacao).toBeVisible();
  await expect(confirmacao).toContainText("não pode ser alterada");

  await page.keyboard.press("Escape");
  await expect(confirmacao).toBeHidden();
  await expect(emitir).toBeFocused();
});

test("etapa de projeto mostra o editor sem ciclo de redirecionamento", async ({ page }) => {
  await page.goto("/orcamento/demandas/1?etapa=projeto");
  await expect(page).toHaveURL(/\/orcamento\/demandas\/1\?etapa=projeto/);
  await expect(page.getByTestId("editor-custos-projeto")).toBeVisible();
  await expect(page.getByText("indisponível nesta versão")).toHaveCount(0);
  await expect(page.locator('a[href^="/orcamento/projetos/"]')).toHaveCount(0);
});

test("barra de Orçamentos marca uma única aba ativa", async ({ page }) => {
  await page.goto("/orcamento/demandas/1");
  const barra = page.getByRole("navigation", { name: "Navegação de Orçamentos" });
  await expect(barra.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(barra.getByRole("link", { name: "Orçamentos", exact: true })).toHaveAttribute("aria-current", "page");
});

test("Operação mostra Custeio e Insumos por análise na barra", async ({ page }) => {
  await page.goto("/custeio");
  const barra = page.getByRole("navigation", { name: "Navegação de Operação" });
  await expect(barra.getByRole("link", { name: "Custeio" })).toHaveAttribute("aria-current", "page");
  await expect(barra.getByRole("link", { name: "Insumos por análise" })).toBeVisible();
});

test("novo orçamento permite remover grupo de amostras sem repetir nomes", async ({ page }) => {
  await page.goto("/orcamento/demandas/nova");
  const adicionar = page.getByRole("button", { name: "Adicionar tipo de amostra" });
  await adicionar.click();

  const identificacoes = page.locator('input[name="grupo_identificacao"]');
  await expect(identificacoes).toHaveCount(2);
  await expect(identificacoes.nth(1)).toHaveValue("Grupo B");

  await page.getByRole("button", { name: "Remover grupo" }).nth(0).click();
  await expect(identificacoes).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Remover grupo" })).toHaveCount(0);

  await adicionar.click();
  await expect(identificacoes).toHaveCount(2);
  const nomes = await identificacoes.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  expect(new Set(nomes).size).toBe(2);
});

test("página inicial não aponta para rotas que só redirecionam", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('a[href="/orcamento/projetos"], a[href="/orcamento/revisao"], a[href="/orcamento"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Ver todos:/ }).first()).toBeVisible();
});
