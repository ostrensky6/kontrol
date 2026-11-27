import { expect, test, type Locator, type Page } from "@playwright/test";
import { completarParaOrdemNova } from "./ajudas/novo-pedido";

/**
 * Item novo: algo que o laboratório nunca comprou (pergunta do Giorgi, trazida
 * pela Rafaela em 19/11/2026). Decisão de Antonio no mesmo dia: quem pede só
 * descreve o item no "Novo pedido"; quem conduz a compra cadastra o insumo
 * pelo próprio pedido. Na ordem nova (0188, 27/11/2026), antes da aprovação
 * financeira. O banco real prova o caminho em supabase/tests/item_novo_do_pedido.sql
 * e supabase/tests/nova_ordem_aprovacoes_0188.sql.
 */

async function comoCategoria(page: Page, papel: string) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL ausente na configuração do Playwright");
  await page.context().addCookies([{ name: "kontrol_e2e_papel", value: papel, url: baseURL }]);
}

test.afterEach(async ({ page }) => {
  await page.context().clearCookies();
});

async function abrirNovoPedido(page: Page): Promise<Locator> {
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const form = page.getByRole("dialog", { name: "Novo pedido" });
  await expect(form).toBeVisible();
  await expect(form.getByTestId("novo-pedido-item-campos")).toBeVisible();
  return form;
}

async function preencherPedido(form: Locator, titulo: string) {
  await form.getByLabel("Título do pedido").fill(titulo);
  await form.getByRole("combobox", { name: "Projeto", exact: true }).selectOption({ label: "Projeto com coordenação E2E · Coordenação E2E" });
  await form.getByRole("radiogroup", { name: "Tipo de material ou despesa" }).getByText("Material de consumo geral (campo, coleta)", { exact: true }).click();
  await form.getByRole("radiogroup", { name: "Objetivo" }).getByText("Projeto", { exact: true }).click();
  await form.getByLabel("Justificativa técnica").fill("Protocolo novo: o laboratório nunca comprou este tampão.");
}

test("no Novo pedido, item fora da lista entra escrito à mão, marcado como item novo", async ({ page }) => {
  const form = await abrirNovoPedido(page);
  const campos = form.getByTestId("novo-pedido-item-campos");

  // a tela diz o que fazer quando o item não está na lista
  await expect(campos.getByText("Não está na lista? Escreva o item em “Especificação”: ele entra como item novo.")).toBeVisible();
  await expect(campos.getByTestId("item-novo-aviso")).toHaveCount(0);

  await campos.getByLabel("Especificação", { exact: true }).fill("Tampão nunca comprado E2E");
  await expect(campos.getByTestId("item-novo-aviso")).toHaveText("Item novo: quem conduz a compra cadastra o insumo antes da aprovação financeira.");

  // serviço não tem insumo: não é item novo
  await campos.getByLabel("Tipo", { exact: true }).selectOption("servico");
  await expect(campos.getByTestId("item-novo-aviso")).toHaveCount(0);
  await campos.getByLabel("Tipo", { exact: true }).selectOption("material");

  await campos.getByLabel("Qtd").fill("2");
  await campos.getByLabel("Unidade").fill("frasco");
  await form.getByRole("button", { name: "Adicionar item" }).click();
  const lista = form.getByTestId("novo-pedido-itens");
  await expect(lista.getByRole("row", { name: /Tampão nunca comprado E2E/ }).getByTestId("item-novo")).toHaveText("Item novo");

  // item escolhido do cadastro não leva a marca
  await campos.getByLabel("Insumo existente").fill("KX-900");
  await expect(campos.getByTestId("codigo-fabricante-escolhido")).toBeVisible();
  await expect(campos.getByTestId("item-novo-aviso")).toHaveCount(0);
  await campos.getByLabel("Qtd").fill("1");
  await form.getByRole("button", { name: "Adicionar item" }).click();
  await expect(lista.getByTestId("item-novo")).toHaveCount(1);
});

test("quem conduz a compra cadastra o item novo pelo pedido e a aprovação financeira deixa de travar", async ({ page }) => {
  const titulo = `Pedido com item novo ${Date.now()}`;
  const insumo = `Tampão nunca comprado ${Date.now()}`;
  const form = await abrirNovoPedido(page);
  await preencherPedido(form, titulo);
  const campos = form.getByTestId("novo-pedido-item-campos");
  await campos.getByLabel("Especificação", { exact: true }).fill(insumo);
  await campos.getByLabel("Qtd").fill("2");
  await campos.getByLabel("Unidade").fill("frasco");
  await campos.getByLabel("Volume").fill("500 mL");
  await campos.getByLabel("Preço estimado (un.)").fill("180");
  await form.getByRole("button", { name: "Adicionar item" }).click();
  await completarParaOrdemNova(form);
  await form.getByRole("button", { name: "Enviar para aprovação" }).click();

  // na Aprovação, o item aparece como item novo
  await expect(page).toHaveURL(/\/pedido\/\d+$/);
  await expect(page.getByRole("heading", { name: titulo })).toBeVisible();
  const linha = page.getByRole("row", { name: new RegExp(insumo) });
  await expect(linha.getByTestId("item-novo")).toContainText("antes da aprovação financeira.");

  // 0188: a aprovação do laboratório ou campo não depende do cadastro; a financeira depende
  await page.getByRole("button", { name: "Aprovar pelo laboratório ou campo" }).click();
  const aprovarFonte = page.getByRole("button", { name: "Aprovar com esta fonte" });
  await expect(aprovarFonte).toBeDisabled();
  await expect(page.getByText("Há 1 item novo, ainda sem cadastro. Use “Cadastrar insumo” na lista de itens antes de aprovar.")).toBeVisible();

  // quem aprova pedidos mas não edita insumos (função Administrativo) vê a quem pedir
  await comoCategoria(page, "administrativo");
  await page.reload();
  await expect(page.getByRole("button", { name: "Aprovar com esta fonte" })).toBeDisabled();
  await expect(page.getByText(/Há 1 item novo, ainda sem cadastro\. Cadastrar o insumo pede a permissão “Editar insumos”/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Cadastrar insumo/ })).toHaveCount(0);

  // de volta a quem conduz a compra e edita insumos
  await page.context().clearCookies();
  await page.reload();
  await page.getByRole("row", { name: new RegExp(insumo) }).getByRole("button", { name: /Cadastrar insumo/ }).click();
  const dialogo = page.getByRole("dialog", { name: "Cadastrar item novo" });
  await expect(dialogo).toBeVisible();
  // o cadastro vem sugerido pelo que quem pediu escreveu
  await expect(dialogo.getByLabel("Item", { exact: true })).toHaveValue(insumo);
  await expect(dialogo.getByLabel("Quantidade na embalagem")).toHaveValue("500");
  await expect(dialogo.getByLabel("Unidade da embalagem")).toHaveValue("mL");
  await expect(dialogo.getByLabel("Valor da embalagem (R$)")).toHaveValue("180");
  await expect(dialogo.getByTestId("item-novo-quantidade")).toContainText("o item conta 2 embalagens de 500 mL");
  await dialogo.getByLabel("Marca / fabricante").fill("Marca E2E");
  await dialogo.getByRole("button", { name: "Cadastrar e ligar ao item" }).click();

  // o item fica ligado ao insumo e a aprovação financeira deixa de reclamar do cadastro
  await expect(dialogo).toBeHidden();
  const ligado = page.getByRole("row", { name: new RegExp(insumo) });
  await expect(ligado.getByText(`vinculado: ${insumo}`)).toBeVisible();
  await expect(ligado.getByTestId("item-novo")).toHaveCount(0);
  await expect(page.getByText(/Há 1 item novo, ainda sem cadastro/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Cadastrar insumo/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Aprovar com esta fonte" })).toBeEnabled();

  // o insumo novo já está no cadastro, para o próximo pedido escolher na lista
  const novo = await abrirNovoPedido(page);
  await novo.getByTestId("novo-pedido-item-campos").getByLabel("Insumo existente").fill(insumo);
  await expect(novo.getByTestId("novo-pedido-item-campos").getByLabel("Especificação", { exact: true })).toHaveValue(insumo);
  await expect(novo.getByTestId("novo-pedido-item-campos").getByTestId("item-novo-aviso")).toHaveCount(0);
});

test("item parecido com um insumo do cadastro é ligado a ele, sem cadastro repetido", async ({ page }) => {
  const titulo = `Pedido com item parecido ${Date.now()}`;
  const form = await abrirNovoPedido(page);
  await preencherPedido(form, titulo);
  const campos = form.getByTestId("novo-pedido-item-campos");
  // escrito à mão, sem escolher na lista: "Kit extração E2E" já existe no cadastro
  await campos.getByLabel("Especificação", { exact: true }).fill("kit de extracao e2e");
  await campos.getByLabel("Qtd").fill("1");
  await campos.getByLabel("Unidade").fill("kit");
  await form.getByRole("button", { name: "Adicionar item" }).click();
  await completarParaOrdemNova(form);
  await form.getByRole("button", { name: "Enviar para aprovação" }).click();
  await expect(page).toHaveURL(/\/pedido\/\d+$/);

  await page.getByRole("row", { name: /kit de extracao e2e/ }).getByRole("button", { name: /Cadastrar insumo/ }).click();
  const dialogo = page.getByRole("dialog", { name: "Cadastrar item novo" });
  const parecidos = dialogo.getByTestId("insumos-parecidos");
  await expect(parecidos).toContainText("Kit extração E2E");
  await expect(parecidos).toContainText("cód. KX-900");
  await parecidos.getByRole("button", { name: "Ligar a este (Kit extração E2E)" }).click();

  await expect(dialogo).toBeHidden();
  const ligado = page.getByRole("row", { name: /kit de extracao e2e/ });
  await expect(ligado.getByText("vinculado: Kit extração E2E")).toBeVisible();
  await expect(ligado.getByTestId("item-novo")).toHaveCount(0);
});
