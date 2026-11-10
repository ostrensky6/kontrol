import { expect, test } from "@playwright/test";

// Relatório do Codex de 08/11, prioridade 5: busca identificada, tópico
// selecionado anunciado e foco levado ao conteúdo e de volta à lista.

test("ajuda: busca com nome, tópico atual marcado e foco no conteúdo", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/ajuda");
  const busca = page.getByRole("searchbox", { name: "Buscar na ajuda" });
  await expect(busca).toBeVisible();
  const lista = page.getByRole("navigation", { name: "Tópicos da ajuda" });

  await lista.getByRole("button", { name: "Custeio", exact: true }).click();
  await expect(lista.getByRole("button", { name: "Custeio", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("heading", { level: 2, name: "Custeio" })).toBeFocused();

  await busca.fill("estoque");
  await expect(page.getByText(/tópico\(s\) encontrado\(s\)/)).toBeAttached();
});

test("ajuda no celular: voltar à lista devolve o foco ao tópico escolhido", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/ajuda");
  const lista = page.getByRole("navigation", { name: "Tópicos da ajuda" });
  await lista.getByRole("button", { name: "Custeio", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Custeio" })).toBeFocused();
  await page.getByRole("button", { name: "Voltar à lista" }).click();
  await expect(lista.getByRole("button", { name: "Custeio", exact: true })).toBeFocused();
});

// Lapidação de 10/11: a Ajuda abre direto no tópico da tela, com as seções em
// cartões, o índice "Nesta página" e o passo a passo numerado.
test("ajuda: link direto abre o tópico, com índice e regras em destaque", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/ajuda?topico=pedido");
  await expect(page.getByRole("heading", { level: 2, name: "Pedidos" })).toBeVisible();
  const lista = page.getByRole("navigation", { name: "Tópicos da ajuda" });
  await expect(lista.getByRole("button", { name: "Pedidos", exact: true })).toHaveAttribute("aria-current", "true");

  const indice = page.getByRole("navigation", { name: "Nesta página" });
  await indice.getByRole("link", { name: "Regras e exceções em resumo" }).click();
  const regras = page.getByRole("region", { name: "Regras e exceções em resumo" });
  await expect(regras).toBeInViewport();
  await expect(regras.getByText(/3 orçamentos de fornecedores diferentes/)).toBeVisible();

  // escolher outro tópico guarda o link na URL
  await lista.getByRole("button", { name: "Compras", exact: true }).click();
  await expect(page).toHaveURL(/topico=compras/);
  const passos = page.getByRole("region", { name: "Passo a passo" });
  await expect(passos.locator("ol > li")).toHaveCount(4);

  // o que não é passo nem cuidado começa fechado e abre com um clique
  const praticas = page.getByRole("button", { name: "Boas práticas" });
  await expect(praticas).toHaveAttribute("aria-expanded", "false");
  await praticas.click();
  await expect(praticas).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("region", { name: "Boas práticas" }).getByText(/Receba sempre pelo pedido/)).toBeVisible();
});

test("ajuda da tela leva ao tópico certo da Central", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Ajuda contextual" }).click();
  const link = page.getByRole("link", { name: "Ver tudo sobre esta tela na Ajuda" });
  await expect(link).toHaveAttribute("href", "/ajuda?topico=pedido");
  await link.click();
  await expect(page.getByRole("heading", { level: 2, name: "Pedidos" })).toBeVisible();
});

test("ajuda no celular: link direto já mostra o tópico", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/ajuda?topico=estoque");
  await expect(page.getByRole("heading", { level: 2, name: "Estoque" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Voltar à lista" })).toBeVisible();
});
