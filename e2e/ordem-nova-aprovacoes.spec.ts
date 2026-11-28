import { expect, test, type Page } from "@playwright/test";
import { completarParaOrdemNova, registrarTresOrcamentos } from "./ajudas/novo-pedido";

/**
 * Ordem nova das aprovações (Antonio, 27/11/2026; banco em 0188 e 0189): o
 * pedido vai com o orçamento prévio e passa pelo laboratório ou campo e pelo
 * financeiro (que escolhe a fonte de pagamento); depois quem pediu faz a
 * cotação (3 orçamentos de fornecedores diferentes, com documento) e, por
 * último, o coordenador do projeto aprova vendo os 3. Devolver (amarelo) deixa
 * corrigir sem perder as aprovações já dadas. As regras completas (quem decide
 * cada vez, o que trava) estão no teste SQL da 0188 e 0189.
 *
 * Cada roteiro cria o próprio pedido: os do seed seguem a ordem antiga.
 */
async function novoPedidoEnviado(page: Page, titulo: string) {
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const form = page.getByRole("dialog", { name: "Novo pedido" });
  const campos = form.getByTestId("novo-pedido-item-campos");
  await expect(campos).toBeVisible();
  await form.getByLabel("Título do pedido").fill(titulo);
  await form.getByRole("combobox", { name: "Projeto", exact: true }).selectOption({ label: "Projeto com coordenação E2E · Coordenação E2E" });
  await form.getByRole("radiogroup", { name: "Tipo de material ou despesa" }).getByText("Material de consumo de laboratório", { exact: true }).click();
  await form.getByRole("radiogroup", { name: "Objetivo" }).getByText("Projeto", { exact: true }).click();
  await form.getByLabel("Justificativa técnica").fill("Extração de DNA das amostras da campanha de dezembro.");
  // item do cadastro: a aprovação financeira não trava por item novo
  await campos.getByLabel("Insumo existente").fill("KX-900");
  await expect(campos.getByTestId("codigo-fabricante-escolhido")).toBeVisible();
  await campos.getByLabel("Qtd").fill("2");
  await form.getByRole("button", { name: "Adicionar item" }).click();
  await completarParaOrdemNova(form);
  await form.getByRole("button", { name: "Enviar para aprovação" }).click();
  await expect(page).toHaveURL(/\/pedido\/\d+$/);
  await expect(page.getByRole("heading", { name: titulo })).toBeVisible();
  return page.url();
}

const status = (page: Page, rotulo: string) => page.getByText(rotulo, { exact: true }).first();

/** Laboratório ou campo e financeiro (com a fonte): o pedido chega à cotação. */
async function ateACotacao(page: Page, fonte = "Ineo") {
  await page.getByRole("button", { name: "Aprovar pelo laboratório ou campo" }).click();
  await expect(status(page, "Aguardando financeiro")).toBeVisible();
  await page.getByRole("combobox", { name: "Fonte de pagamento" }).selectOption(fonte);
  await page.getByRole("button", { name: "Aprovar com esta fonte" }).click();
  await expect(status(page, "Cotação com o solicitante")).toBeVisible();
}

/** Quem pediu registra os 3 orçamentos e envia a cotação ao coordenador do projeto. */
async function fazerCotacao(page: Page) {
  await registrarTresOrcamentos(page);
  await page.getByRole("button", { name: "Enviar cotação ao coordenador do projeto" }).click();
  await expect(status(page, "Aguardando coordenador do projeto")).toBeVisible();
}

test("pedido novo passa pelo laboratório ou campo, pelo financeiro com a fonte, pela cotação e pelo coordenador do projeto", async ({ page }) => {
  const titulo = `Kit para a ordem nova ${Date.now()}`;
  await novoPedidoEnviado(page, titulo);

  // primeira vez: laboratório ou campo; os 3 orçamentos ainda não existem (vêm na cotação)
  await expect(status(page, "Aguardando laboratório ou campo")).toBeVisible();
  await expect(page.getByTestId("vez")).toHaveText("Sua vez");
  await expect(page.getByTestId("orcamentos-pedido")).toHaveCount(0);
  await page.getByRole("button", { name: "Aprovar pelo laboratório ou campo" }).click();

  // segunda: o financeiro escolhe a fonte de pagamento da lista
  await expect(status(page, "Aguardando financeiro")).toBeVisible();
  const fonte = page.getByRole("combobox", { name: "Fonte de pagamento" });
  await expect(fonte.getByRole("option")).toHaveText(["Escolha a fonte…", "Ineo", "Funpar", "ATGC", "CNPq"]);
  await fonte.selectOption("Ineo");
  await page.getByRole("button", { name: "Aprovar com esta fonte" }).click();

  // terceira: quem pediu faz a cotação; sem os 3 orçamentos com documento, o envio fica travado
  await expect(status(page, "Cotação com o solicitante")).toBeVisible();
  await expect(page.getByTestId("vez")).toHaveText("Sua vez");
  const enviar = page.getByRole("button", { name: "Enviar cotação ao coordenador do projeto" });
  await expect(enviar).toBeDisabled();
  await expect(page.getByText("A cotação precisa de 3 orçamentos de fornecedores diferentes. Faltam 3.").first()).toBeVisible();
  await registrarTresOrcamentos(page);
  await expect(enviar).toBeEnabled();
  await enviar.click();

  // quarta e última: o coordenador do projeto vê os 3 orçamentos (o de menor valor ficou escolhido)
  await expect(status(page, "Aguardando coordenador do projeto")).toBeVisible();
  await expect(page.getByTestId("orcamentos-pedido")).toContainText("3 de 3, escolhido: Loja Alfa E2E");
  await page.getByRole("button", { name: "Aprovar pedido" }).click();
  await expect(status(page, "Aprovado para compra")).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprovar pedido" })).toHaveCount(0);
});

test("devolver no financeiro deixa corrigir e o reenvio volta ao financeiro, sem repetir o laboratório", async ({ page }) => {
  const titulo = `Kit para devolver ${Date.now()}`;
  await novoPedidoEnviado(page, titulo);
  await page.getByRole("button", { name: "Aprovar pelo laboratório ou campo" }).click();
  await expect(status(page, "Aguardando financeiro")).toBeVisible();

  await page.getByLabel("O que corrigir (obrigatório)").fill("Falta o CNPJ do fornecedor no orçamento.");
  await page.getByRole("button", { name: "Devolver ao solicitante" }).click();
  await expect(status(page, "Devolvido ao solicitante")).toBeVisible();

  await page.getByRole("button", { name: "Reenviar" }).click();
  await expect(status(page, "Aguardando financeiro")).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprovar pelo laboratório ou campo" })).toHaveCount(0);
});

test("quadro de aprovações decide a vez de cada coordenação, com a fonte no financeiro", async ({ page }) => {
  const titulo = `Kit no quadro ${Date.now()}`;
  await novoPedidoEnviado(page, titulo);

  await page.goto("/pedido?ver=aprovacoes");
  const busca = page.getByRole("searchbox", { name: "Buscar pedido, item, projeto ou solicitante" });
  await busca.fill(titulo);
  const linha = page.getByRole("table").getByRole("row", { name: new RegExp(titulo) });
  await expect(linha.getByRole("button", { name: /Coordenação do laboratório ou campo do pedido Nº \d+: Aguardando/ })).toBeVisible();
  await linha.getByRole("button", { name: /^Aprovar o pedido Nº \d+ \(Coordenação do laboratório ou campo\)$/ }).click();

  // agora é a vez do financeiro: a fonte vem da lista, no próprio quadro
  await expect(linha.getByRole("button", { name: /Coordenação do laboratório ou campo do pedido Nº \d+: Aprovado/ })).toBeVisible();
  await linha.getByRole("combobox", { name: /^Fonte de pagamento do pedido Nº \d+$/ }).selectOption("Funpar");
  await linha.getByRole("button", { name: /^Aprovar o pedido Nº \d+ \(Coordenação financeira\)$/ }).click();
  await expect(linha.getByRole("button", { name: /Coordenação financeira do pedido Nº \d+: Aprovado/ })).toBeVisible();
  // 0189: o coordenador do projeto vem depois da cotação, que quem pediu faz no pedido
  await expect(linha.getByRole("button", { name: /Coordenação do projeto do pedido Nº \d+: Depois da cotação/ })).toBeVisible();
  await expect(linha.getByRole("link", { name: "Fazer a cotação (3 orçamentos)" })).toHaveAttribute("href", /\/pedido\/\d+$/);
});

test("cadastro de fontes de pagamento: a fonte nova aparece para o financeiro escolher", async ({ page }) => {
  const nome = `Fapesc E2E ${Date.now()}`;
  await page.goto("/cadastros/fontes_pagamento");
  await expect(page.getByRole("heading", { name: "Fontes de pagamento" })).toBeVisible();
  for (const fonte of ["Ineo", "Funpar", "ATGC", "CNPq"]) {
    await expect(page.getByRole("row", { name: new RegExp(`^${fonte}\\b`) }).first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Nova fonte de pagamento" }).click();
  const gaveta = page.getByRole("dialog", { name: "Nova fonte de pagamento" });
  await gaveta.getByLabel("Nome da fonte").fill(nome);
  await gaveta.getByLabel("Descrição").fill("Fundação de amparo à pesquisa de SC.");
  await gaveta.getByRole("button", { name: "Salvar" }).click();
  await expect(gaveta).toHaveCount(0);
  await expect(page.getByRole("row", { name: new RegExp(nome) })).toBeVisible();

  const titulo = `Kit com fonte nova ${Date.now()}`;
  await novoPedidoEnviado(page, titulo);
  await page.getByRole("button", { name: "Aprovar pelo laboratório ou campo" }).click();
  await expect(page.getByRole("combobox", { name: "Fonte de pagamento" }).getByRole("option", { name: nome })).toBeAttached();
});

test("documento para a fonte de pagamento: Termo de Referência da Funpar e Solicitação de Compras da Ineo", async ({ page }) => {
  const titulo = `Kit para o documento ${Date.now()}`;
  const endereco = await novoPedidoEnviado(page, titulo);
  await ateACotacao(page, "Funpar");
  await fazerCotacao(page);

  // com a fonte escolhida, o pedido oferece o documento no modelo dela
  await page.getByRole("link", { name: "Documento para a fonte de pagamento (Funpar): abrir para imprimir" }).click();
  await expect(page).toHaveURL(`${endereco}/documento`);
  const termo = page.getByTestId("documento-termo-referencia");
  await expect(termo.getByRole("heading", { name: "Termo de referência", level: 1 })).toBeVisible();
  await expect(termo).toContainText(titulo);
  await expect(termo).toContainText("Extração de DNA das amostras da campanha de dezembro.");
  // o mapa de pesquisa de preços: os 3 orçamentos e a média
  const mapa = termo.getByRole("region", { name: "Planilha de custo / mapa de pesquisa de preços" });
  await expect(mapa.getByRole("row")).toHaveCount(5);
  await expect(mapa).toContainText("Loja Alfa E2E (escolhido)");
  await expect(mapa.getByRole("row", { name: /Média dos orçamentos/ })).toContainText("R$ 150,00");
  // o que o Kontrol não guarda se escreve na tela, antes de imprimir
  await termo.getByRole("textbox", { name: "Matrícula UFPR do coordenador" }).fill("147672");
  await expect(termo.getByRole("textbox", { name: "Matrícula UFPR do coordenador" })).toHaveText("147672");
  await expect(page.getByRole("button", { name: "Imprimir / PDF" })).toBeVisible();

  await page.getByRole("link", { name: "Abrir como Solicitação de Compras (Ineo)" }).click();
  const solicitacao = page.getByTestId("documento-solicitacao-compras");
  await expect(solicitacao.getByRole("heading", { name: "Solicitação de compras", level: 1 })).toBeVisible();
  await expect(solicitacao.getByRole("row", { name: /4\. Material de Consumo/ })).toContainText("x");
  await expect(solicitacao.getByRole("row", { name: /^Fornecedor/ })).toContainText("Loja Alfa E2E");
  await expect(solicitacao.getByRole("row", { name: /^Total/ })).toContainText("R$ 120,00");
});
