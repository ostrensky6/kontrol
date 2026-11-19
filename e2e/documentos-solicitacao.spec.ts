import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Relatório de ajustes de 19/11/2026, ajuste 2: a cotação prévia e o termo de
 * referência são de quem pede. Entram no "Novo pedido", com o pedido; da
 * Aprovação em diante, saem da lista "Tipo" de "Registrar documento".
 */

async function abrirNovoPedido(page: Page): Promise<Locator> {
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const form = page.getByRole("dialog", { name: "Novo pedido" });
  await expect(form).toBeVisible();
  await expect(form.getByTestId("novo-pedido-item-campos")).toBeVisible();
  return form;
}

async function preencher(form: Locator, titulo: string) {
  await form.getByLabel("Título do pedido").fill(titulo);
  await form.getByLabel("Projeto").selectOption({ label: "Projeto com coordenação E2E · Coordenação E2E" });
  await form.getByLabel("Tipo de material ou despesa").selectOption("material_consumo_geral");
  await form.getByLabel("Objetivo").selectOption("projeto");
  await form.getByLabel("Justificativa técnica").fill("Reposição para a campanha de campo de dezembro.");
  const campos = form.getByTestId("novo-pedido-item-campos");
  await campos.getByLabel("Especificação", { exact: true }).fill("Tampão TE 1X");
  await campos.getByLabel("Qtd").fill("2");
  await campos.getByLabel("Unidade").fill("frasco");
  await form.getByRole("button", { name: "Adicionar item" }).click();
}

const pdf = (name: string, tamanho = 2048) => ({ name, mimeType: "application/pdf", buffer: Buffer.alloc(tamanho, 1) });

test("cotação prévia e termo de referência entram no Novo pedido e saem da Aprovação", async ({ page }) => {
  const titulo = `Tampão com cotação prévia ${Date.now()}`;
  const form = await abrirNovoPedido(page);
  await preencher(form, titulo);
  await expect(form.getByRole("heading", { name: "Cotação prévia e termo de referência" })).toBeVisible();
  await form.getByLabel("Cotação prévia", { exact: true }).setInputFiles([pdf("cotacao-fornecedor-a.pdf"), pdf("cotacao-fornecedor-b.pdf")]);
  await form.getByLabel("Termo de referência", { exact: true }).setInputFiles(pdf("termo-de-referencia.pdf"));
  await form.getByRole("button", { name: "Enviar para aprovação" }).click();

  // o pedido seguiu para a Aprovação com os três documentos, gravados na Solicitação
  await expect(page).toHaveURL(/\/pedido\/\d+$/);
  await expect(page.getByRole("heading", { name: titulo })).toBeVisible();
  await expect(page.getByText("Aguardando coordenador").first()).toBeVisible();
  for (const nome of ["cotacao-fornecedor-a.pdf", "cotacao-fornecedor-b.pdf"]) {
    await expect(page.getByText(nome).first()).toBeVisible();
  }
  await expect(page.getByText(/Cotação prévia · Rascunho/)).toHaveCount(2);
  await expect(page.getByText(/Termo de referência · Rascunho/)).toHaveCount(1);

  // na Aprovação, "Registrar documento" não oferece mais os dois tipos
  await page.getByText("Registrar documento", { exact: true }).first().click();
  const tipo = page.locator("#adicionarAnexoPedidoInterno-tipo");
  await expect(tipo).toBeVisible();
  const opcoes = await tipo.locator("option").allTextContents();
  expect(opcoes).not.toContain("Cotação prévia");
  expect(opcoes).not.toContain("Termo de referência");
  expect(opcoes).toContain("Cotação do fornecedor");
  await expect(page.getByTestId("documentos-da-solicitacao")).toContainText("entram com o pedido, por quem pede");
});

test("no rascunho, quem pede ainda escolhe cotação prévia em Registrar documento", async ({ page }) => {
  const titulo = `Rascunho com termo ${Date.now()}`;
  const form = await abrirNovoPedido(page);
  await preencher(form, titulo);
  await form.getByRole("button", { name: "Guardar rascunho" }).click();
  await expect(page).toHaveURL(/\/pedido\/\d+$/);
  await page.getByText("Registrar documento", { exact: true }).first().click();
  const opcoes = await page.locator("#adicionarAnexoPedidoInterno-tipo option").allTextContents();
  expect(opcoes).toContain("Cotação prévia");
  expect(opcoes).toContain("Termo de referência");
  await expect(page.getByTestId("documentos-da-solicitacao")).toHaveCount(0);
});

test("arquivos acima do limite param o envio antes de gravar o pedido", async ({ page }) => {
  const form = await abrirNovoPedido(page);
  await preencher(form, `Pedido com PDF grande ${Date.now()}`);
  await form.getByLabel("Cotação prévia", { exact: true }).setInputFiles(pdf("cotacao-grande.pdf", 4 * 1024 * 1024));
  await expect(form.getByRole("alert").filter({ hasText: "cabe até 3,5 MB" })).toBeVisible();
  await form.getByRole("button", { name: "Enviar para aprovação" }).click();
  // a conferência do navegador segura o envio: nada foi gravado e o formulário continua aberto
  await expect(page).toHaveURL(/\/pedido$/);
  await expect(form).toBeVisible();
  // trocando por um arquivo menor, o aviso some
  await form.getByLabel("Cotação prévia", { exact: true }).setInputFiles(pdf("cotacao-pequena.pdf"));
  await expect(form.getByRole("alert").filter({ hasText: "cabe até 3,5 MB" })).toHaveCount(0);
});
