import { expect, test, type Page } from "@playwright/test";

/**
 * Antonio, 27/11/2026: "Reprovar encerra o pedido" (vermelho, avisa o
 * solicitante) e devolver (amarelo) deixa corrigir sem recomeçar; e "um botão
 * de apagar ao longo de todo o processo". As regras completas (quem reprova
 * em cada etapa, o aviso, o que trava o apagar) estão no teste SQL da 0186.
 *
 * Cria o próprio pedido: os pedidos do seed seguem intactos para os outros roteiros.
 */
async function novoPedidoEnviado(page: Page, titulo: string) {
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const form = page.getByRole("dialog", { name: "Novo pedido" });
  await expect(form.getByTestId("novo-pedido-item-campos")).toBeVisible();
  await form.getByLabel("Título do pedido").fill(titulo);
  await form.getByRole("combobox", { name: "Projeto", exact: true }).selectOption({ label: "Projeto com coordenação E2E · Coordenação E2E" });
  await form.getByRole("radiogroup", { name: "Tipo de material ou despesa" }).getByText("Material de consumo geral (campo, coleta)", { exact: true }).click();
  await form.getByRole("radiogroup", { name: "Objetivo" }).getByText("Projeto", { exact: true }).click();
  await form.getByLabel("Justificativa técnica").fill("Reposição para a campanha de campo de dezembro.");
  const campos = form.getByTestId("novo-pedido-item-campos");
  await campos.getByLabel("Especificação", { exact: true }).fill("Frasco âmbar 1 L");
  await campos.getByLabel("Qtd").fill("4");
  await campos.getByLabel("Unidade").fill("un");
  await form.getByRole("button", { name: "Enviar para aprovação" }).click();
  await expect(page).toHaveURL(/\/pedido\/\d+$/);
  await expect(page.getByRole("heading", { name: titulo })).toBeVisible();
  return page.url();
}

test("reprovar no quadro encerra o pedido, com a bolinha vermelha e o motivo", async ({ page }) => {
  const titulo = `Frascos para reprovar ${Date.now()}`;
  await novoPedidoEnviado(page, titulo);

  await page.goto("/pedido?ver=aprovacoes");
  const busca = page.getByRole("searchbox", { name: "Buscar pedido, item, projeto ou solicitante" });
  await busca.fill(titulo);
  const linha = page.getByRole("table").getByRole("row", { name: new RegExp(titulo) });
  // devolver (amarelo) e reprovar (vermelho) ficam lado a lado
  await expect(linha.getByRole("button", { name: /^Devolver o pedido Nº \d+ ao solicitante$/ })).toBeVisible();
  await linha.getByRole("button", { name: /^Reprovar o pedido Nº \d+$/ }).click();
  const motivo = page.getByLabel(/^Por que o pedido Nº \d+ foi reprovado\?$/);
  await motivo.fill("Já há frascos sobrando no almoxarifado.");
  await page.getByRole("button", { name: "Reprovar e encerrar" }).click();

  // sai do que espera decisão; em "Todos" aparece reprovado, com o motivo na bolinha
  await page.getByRole("button", { name: /^Todos/ }).click();
  await busca.fill(titulo);
  await linha.getByRole("button", { name: /Coordenação do projeto do pedido Nº \d+: Reprovado/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Já há frascos sobrando no almoxarifado.");
});

test("apagar vale para pedido em andamento e volta para a lista", async ({ page }) => {
  const titulo = `Frascos para apagar ${Date.now()}`;
  const endereco = await novoPedidoEnviado(page, titulo);
  // está na lista antes de apagar (a lista tem páginas: a busca acha o pedido)
  await page.goto("/pedido");
  const busca = page.getByRole("searchbox", { name: "Buscar pedido, projeto ou solicitante" });
  await busca.fill(titulo);
  await expect(page.getByRole("row", { name: new RegExp(titulo) })).toBeVisible();

  await page.goto(endereco);
  await page.getByRole("button", { name: /^Apagar Nº \d+$/ }).first().click();
  const dialogo = page.getByRole("dialog", { name: /^Apagar o pedido Nº \d+\?$/ });
  await expect(dialogo).toContainText("Não dá para desfazer.");
  await expect(dialogo).toContainText("use Reprovar ou Cancelar");
  // voltar não apaga nada
  await dialogo.getByRole("button", { name: "Voltar" }).click();
  await expect(page.getByRole("heading", { name: titulo })).toBeVisible();

  await page.getByRole("button", { name: /^Apagar Nº \d+$/ }).first().click();
  await page.getByLabel("Motivo (opcional)").fill("Pedido de teste");
  await page.getByRole("button", { name: "Apagar pedido" }).click();
  await expect(page).toHaveURL(/\/pedido$/);
  await busca.fill(titulo);
  await expect(page.getByRole("row", { name: new RegExp(titulo) })).toHaveCount(0);
  await page.goto(endereco);
  await expect(page.getByRole("heading", { name: titulo })).toHaveCount(0);
});
