import { expect, test, type Locator, type Page } from "@playwright/test";
import { completarParaOrdemNova } from "./ajudas/novo-pedido";

/**
 * Relatório de ajustes de 19/11/2026, ajuste 2: o orçamento prévio e o termo de
 * referência são de quem pede. Entram no "Novo pedido", com o pedido e com os
 * mesmos campos de "Registrar documento" (tipo, título, arquivo, link e
 * observação: é ali que se põem o valor estimado e o link); da Aprovação em
 * diante, saem da lista "Tipo" de "Registrar documento".
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
  await form.getByRole("combobox", { name: "Projeto", exact: true }).selectOption({ label: "Projeto com coordenação E2E · Coordenação E2E" });
  await form.getByRole("radiogroup", { name: "Tipo de material ou despesa" }).getByText("Material de consumo geral (campo, coleta)", { exact: true }).click();
  await form.getByRole("radiogroup", { name: "Objetivo" }).getByText("Projeto", { exact: true }).click();
  await form.getByLabel("Justificativa técnica").fill("Reposição para a campanha de campo de dezembro.");
  const campos = form.getByTestId("novo-pedido-item-campos");
  await campos.getByLabel("Especificação", { exact: true }).fill("Tampão TE 1X");
  await campos.getByLabel("Qtd").fill("2");
  await campos.getByLabel("Unidade").fill("frasco");
  await form.getByRole("button", { name: "Adicionar item" }).click();
}

const pdf = (name: string, tamanho = 2048) => ({ name, mimeType: "application/pdf", buffer: Buffer.alloc(tamanho, 1) });

test("orçamento prévio e termo de referência entram no Novo pedido, com os campos de Registrar documento, e saem da Aprovação", async ({ page }) => {
  const titulo = `Tampão com orçamento prévio ${Date.now()}`;
  const form = await abrirNovoPedido(page);
  await preencher(form, titulo);
  await expect(form.getByRole("heading", { name: "Orçamento prévio e termo de referência" })).toBeVisible();

  // os mesmos campos de "Registrar documento": tipo, título, arquivo, link e observação
  const primeiro = form.getByRole("group", { name: "Documento 1" });
  await expect(primeiro.getByLabel("Tipo")).toHaveValue("orcamento_previo");
  expect(await primeiro.getByLabel("Tipo").locator("option").allTextContents()).toEqual(["Orçamento prévio", "Termo de referência"]);
  // orçamento prévio só com valor estimado e link, sem arquivo
  await primeiro.getByLabel("Título").fill("Cotação do tampão no site");
  await primeiro.getByLabel("Link ou referência externa (opcional)").fill("https://loja.exemplo/tampao-te");
  await primeiro.getByLabel("Observação").fill("Valor estimado: R$ 180,00 o frasco");

  // segundo documento: termo de referência com arquivo
  await form.getByRole("button", { name: "Adicionar outro documento" }).click();
  const segundo = form.getByRole("group", { name: "Documento 2" });
  await segundo.getByLabel("Tipo").selectOption({ label: "Termo de referência" });
  await segundo.getByLabel("Arquivo").setInputFiles(pdf("termo-de-referencia.pdf"));

  // um terceiro, deixado em branco, não vira documento; removido, some da tela
  await form.getByRole("button", { name: "Adicionar outro documento" }).click();
  await expect(form.getByTestId("novo-pedido-documento")).toHaveCount(3);
  await form.getByRole("button", { name: "Remover documento 3" }).click();
  await expect(form.getByTestId("novo-pedido-documento")).toHaveCount(2);
  // o que já estava preenchido continua
  await expect(primeiro.getByLabel("Título")).toHaveValue("Cotação do tampão no site");
  // 0188: laboratório ou campo e os 3 orçamentos vão junto
  await completarParaOrdemNova(form);

  await form.getByRole("button", { name: "Enviar para aprovação" }).click();

  // o pedido seguiu para a Aprovação com os dois documentos, gravados na Solicitação
  await expect(page).toHaveURL(/\/pedido\/\d+$/);
  await expect(page.getByRole("heading", { name: titulo })).toBeVisible();
  await expect(page.getByText("Aguardando laboratório ou campo").first()).toBeVisible();
  await expect(page.getByText("Cotação do tampão no site")).toBeVisible();
  await expect(page.getByText("Valor estimado: R$ 180,00 o frasco")).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir referência" })).toHaveAttribute("href", "https://loja.exemplo/tampao-te");
  await expect(page.getByText("termo-de-referencia.pdf").first()).toBeVisible();
  await expect(page.getByText(/Orçamento prévio · Rascunho/)).toHaveCount(1);
  await expect(page.getByText(/Termo de referência · Rascunho/)).toHaveCount(1);
  // os 2 documentos e o documento de cada um dos 3 orçamentos
  await expect(page.getByText("5 anexos")).toBeVisible();

  // na Aprovação, "Registrar documento" não oferece mais os dois tipos
  await page.getByText("Registrar documento", { exact: true }).first().click();
  const tipo = page.locator("#adicionarAnexoPedidoInterno-tipo");
  await expect(tipo).toBeVisible();
  const opcoes = await tipo.locator("option").allTextContents();
  expect(opcoes).not.toContain("Orçamento prévio");
  expect(opcoes).not.toContain("Termo de referência");
  expect(opcoes).toContain("Cotação do fornecedor");
  await expect(page.getByTestId("documentos-da-solicitacao")).toContainText("entram com o pedido, por quem pede");
});

test("no rascunho, quem pede ainda escolhe orçamento prévio em Registrar documento", async ({ page }) => {
  const titulo = `Rascunho com termo ${Date.now()}`;
  const form = await abrirNovoPedido(page);
  await preencher(form, titulo);
  await form.getByRole("button", { name: "Guardar rascunho" }).click();
  await expect(page).toHaveURL(/\/pedido\/\d+$/);
  await page.getByText("Registrar documento", { exact: true }).first().click();
  const opcoes = await page.locator("#adicionarAnexoPedidoInterno-tipo option").allTextContents();
  expect(opcoes).toContain("Orçamento prévio");
  expect(opcoes).toContain("Termo de referência");
  await expect(page.getByTestId("documentos-da-solicitacao")).toHaveCount(0);
});

test("arquivos acima do limite param o envio antes de gravar o pedido", async ({ page }) => {
  const form = await abrirNovoPedido(page);
  await preencher(form, `Pedido com PDF grande ${Date.now()}`);
  const documento = form.getByRole("group", { name: "Documento 1" });
  await documento.getByLabel("Arquivo").setInputFiles(pdf("cotacao-grande.pdf", 4 * 1024 * 1024));
  await expect(form.getByRole("alert").filter({ hasText: "cabe até 3,5 MB" })).toBeVisible();
  await form.getByRole("button", { name: "Enviar para aprovação" }).click();
  // a conferência do navegador segura o envio: nada foi gravado e o formulário continua aberto
  await expect(page).toHaveURL(/\/pedido$/);
  await expect(form).toBeVisible();
  // trocando por um arquivo menor, o aviso some
  await documento.getByLabel("Arquivo").setInputFiles(pdf("cotacao-pequena.pdf"));
  await expect(form.getByRole("alert").filter({ hasText: "cabe até 3,5 MB" })).toHaveCount(0);
});
