import { expect, test } from "@playwright/test";

// Revisão de usabilidade de 11/11/2026, Onda 0: acertos rápidos de texto,
// data, foco e confirmação. Cada teste cita o achado do documento.

test("planejamento mostra o período como data, não no formato do banco (8.4)", async ({ page }) => {
  await page.goto("/planejamento");
  const tabela = page.getByRole("table").first();
  await expect(tabela).toBeVisible();
  await expect(tabela).toContainText(/\d{2}\/\d{2} a \d{2}\/\d{2}\/\d{4}/);
  await expect(tabela).not.toContainText(/\d{4}-\d{2}-\d{2}/);
  await expect(tabela).not.toContainText("→");
});

test("novo pedido fala em aprovar, como o resto do fluxo (rodada anterior)", async ({ page }) => {
  await page.goto("/pedido?novo=1");
  const formulario = page.getByRole("dialog");
  await expect(formulario).toContainText("O coordenador do projeto aprova o pedido.");
  await expect(formulario.getByRole("option", { name: "Sem projeto (a Supervisão aprova)" })).toBeAttached();
  await expect(formulario).not.toContainText(/\bvalida\b/);
});

test("pedido mostra o uso com rótulo, não o valor do banco (8.5)", async ({ page }) => {
  await page.goto("/pedido/503");
  await expect(page.getByText(/Uso: Lab\.\/campo/)).toBeVisible();
  await expect(page.getByText(/Uso: laboratorio/)).toHaveCount(0);
});

test("estorno de recebimento pede confirmação e nada muda ao voltar (8.6)", async ({ page }) => {
  await page.goto("/pedido/503");
  const recebido = page.getByText(/Recebido \d{2}\/\d{2}\/\d{4}/).first();
  await expect(recebido).toBeVisible();

  await page.getByRole("button", { name: "Estornar", exact: true }).first().click();
  const confirmacao = page.getByRole("dialog", { name: "Estornar recebimento?" });
  await expect(confirmacao).toBeVisible();
  await expect(confirmacao).toContainText("Luva nitrílica M");
  await expect(confirmacao).toContainText("O lote sai do estoque e o item volta a ficar pendente de recebimento.");

  // negativa: sair pela confirmação não estorna
  await confirmacao.getByRole("button", { name: "Voltar" }).click();
  await expect(confirmacao).toBeHidden();
  await expect(recebido).toBeVisible();
});

test("formulário de cadastro abre com o foco no primeiro campo, não no ? (seção 4)", async ({ page }) => {
  await page.goto("/cadastros/insumos");
  await page.getByRole("button", { name: "Novo insumo" }).click();
  const formulario = page.getByRole("dialog");
  await expect(formulario).toBeVisible();
  const primeiroCampo = formulario
    .locator('input:not([type="hidden"]):not([type="file"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')
    .first();
  await expect(primeiroCampo).toBeFocused();
});

test("estoque diz sem dado em vez de texto técnico (8.3)", async ({ page }) => {
  await page.goto("/estoque");
  await expect(page.getByRole("table").first()).toBeVisible();
  await expect(page.getByText("Sem linha nesta consulta.")).toHaveCount(0);
  await expect(page.getByText("Indisponível", { exact: true })).toHaveCount(0);
});

test("rodapé institucional completo só no Início; nas outras telas, uma linha (10.2)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const rodape = page.getByRole("contentinfo", { name: "Informações institucionais" });
  await expect(rodape).toContainText("Uma parceria GIA & ATGC");

  await page.goto("/estoque");
  await expect(rodape).toContainText(/Kontrol · Versão \d+\.\d+\.\d+/);
  await expect(rodape).not.toContainText("Uma parceria GIA & ATGC");
  await expect(rodape.getByRole("link", { name: "Suporte" })).toBeVisible();
  expect((await rodape.boundingBox())!.height).toBeLessThan(60);
});

test("barra de Orçamentos tem lugares, não ações: novo orçamento é botão da lista (D14)", async ({ page }) => {
  await page.goto("/orcamento/demandas");
  const barra = page.getByRole("navigation", { name: "Navegação de Orçamentos" });
  await expect(barra.getByRole("link", { name: "Novo orçamento" })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("link", { name: "Novo orçamento" })).toBeVisible();
});
