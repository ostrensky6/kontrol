import { expect, test } from "@playwright/test";

/**
 * Quadro de aprovações (pedido de Antonio e da Rafaela, 27/11/2026): um pedido
 * por linha, com itens, solicitante, data, termo de referência e as três
 * aprovações (laboratório, financeiro, projeto). Clicando na bolinha aparece
 * quem decidiu; quem coordena aprova ou devolve ali mesmo.
 *
 * Só lê: o pedido 502 continua esperando a aprovação para os outros testes.
 */
test("quadro mostra as três aprovações e a decisão de quem coordena", async ({ page }) => {
  await page.goto("/pedido");
  await page.getByRole("navigation", { name: "Como ver os pedidos" }).getByRole("link", { name: "Quadro de aprovações" }).click();
  await expect(page).toHaveURL(/\/pedido\?ver=aprovacoes$/);

  const tabela = page.getByRole("table");
  for (const coluna of ["Pedido", "Solicitante e data", "Termo", "Laboratório", "Financeiro", "Projeto", "Sua decisão"]) {
    await expect(tabela.getByRole("columnheader", { name: coluna })).toBeVisible();
  }

  // o Administrador do mock decide como substituto: o quadro abre no que espera por ele
  await expect(page.getByRole("button", { name: /Esperando sua decisão/ })).toHaveAttribute("aria-pressed", "true");
  const linha502 = tabela.getByRole("row", { name: /Primers para aprovar E2E/ });
  await expect(linha502.getByRole("button", { name: /Coordenação do projeto do pedido Nº 0502: Aguardando/ })).toBeVisible();
  await expect(linha502.getByRole("button", { name: "Aprovar o pedido Nº 0502 (Coordenação do projeto)" })).toBeVisible();
  await linha502.getByRole("button", { name: "Devolver o pedido Nº 0502 ao solicitante" }).click();
  await expect(page.getByLabel("O que o solicitante precisa corrigir no pedido Nº 0502?")).toBeVisible();
  await page.keyboard.press("Escape");

  // em andamento: o 0501 já passou pelo coordenador do projeto
  await page.getByRole("button", { name: /Em andamento/ }).click();
  const linha501 = tabela.getByRole("row", { name: /Reagente do ciclo seguinte E2E/ });
  await linha501.getByRole("button", { name: /Coordenação do projeto do pedido Nº 0501: Aprovado/ }).click();
  const detalhe = page.getByRole("dialog");
  await expect(detalhe).toContainText("Coordenação do projeto");
  await expect(detalhe).toContainText("Aprovado");
  await expect(detalhe).toContainText("Por");
  await page.keyboard.press("Escape");

  // a lista por etapa continua a mesma
  await page.getByRole("navigation", { name: "Como ver os pedidos" }).getByRole("link", { name: "Por etapa" }).click();
  await expect(page.getByRole("navigation", { name: "Etapas do pedido" })).toBeVisible();
});
