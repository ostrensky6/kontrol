import { expect, test, type Page } from "@playwright/test";
import { completarParaOrdemNova } from "./ajudas/novo-pedido";

/**
 * Insumo nunca recebido (decisão de Antonio em 19/11/2026, a partir da pergunta
 * do Giorgi trazida pela Rafaela): o item novo cadastrado pelo pedido nasce sem
 * lote. No Estoque ele aparece como "Nunca recebido", não como "Sem estoque":
 * não entra em "Precisa de atenção", não muda a saúde e continua achável pelo
 * filtro e pelo quadro cinza.
 *
 * Outros roteiros do mesmo servidor mexem no saldo do mock: os números são
 * comparados com o que havia antes, nunca com um valor fixo.
 */

async function cadastrarItemNovoPeloPedido(page: Page, insumo: string) {
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const form = page.getByRole("dialog", { name: "Novo pedido" });
  const campos = form.getByTestId("novo-pedido-item-campos");
  await expect(campos).toBeVisible();
  await form.getByLabel("Título do pedido").fill(`Pedido do ${insumo}`);
  await form.getByRole("combobox", { name: "Projeto", exact: true }).selectOption({ label: "Projeto com coordenação E2E · Coordenação E2E" });
  await form.getByRole("radiogroup", { name: "Tipo de material ou despesa" }).getByText("Material de consumo geral (campo, coleta)", { exact: true }).click();
  await form.getByRole("radiogroup", { name: "Objetivo" }).getByText("Projeto", { exact: true }).click();
  await form.getByLabel("Justificativa técnica").fill("Protocolo novo: o laboratório nunca comprou este tampão.");
  await campos.getByLabel("Especificação", { exact: true }).fill(insumo);
  await campos.getByLabel("Qtd").fill("2");
  await campos.getByLabel("Unidade").fill("frasco");
  await campos.getByLabel("Volume").fill("500 mL");
  await form.getByRole("button", { name: "Adicionar item" }).click();
  await completarParaOrdemNova(form);
  await form.getByRole("button", { name: "Enviar para aprovação" }).click();
  await expect(page).toHaveURL(/\/pedido\/\d+$/);

  await page.getByRole("row", { name: new RegExp(insumo) }).getByRole("button", { name: /Cadastrar insumo/ }).click();
  const dialogo = page.getByRole("dialog", { name: "Cadastrar item novo" });
  // quem pediu não informou preço: o cadastro aceita zero e a cotação corrige depois
  await dialogo.getByLabel("Valor da embalagem (R$)").fill("0");
  await dialogo.getByRole("button", { name: "Cadastrar e ligar ao item" }).click();
  await expect(dialogo).toBeHidden();
  await expect(page.getByText(`vinculado: ${insumo}`)).toBeVisible();
}

/** Os números do topo da Situação: "Sem estoque" e a conta da saúde ("N de M insumos em dia"). */
async function numerosDaSituacao(page: Page) {
  await page.goto("/estoque/situacao");
  await expect(page.getByRole("heading", { name: "Situação do estoque", level: 1 })).toBeVisible();
  const cartao = await page.getByRole("link", { name: /^Sem estoque: \d+\./ }).getAttribute("aria-label");
  const saude = await page.getByTestId("saude-do-estoque").innerText();
  return {
    semEstoque: Number(/Sem estoque: (\d+)/.exec(cartao ?? "")?.[1]),
    saude: /\d+ de \d+ insumos em dia/.exec(saude)?.[0] ?? "",
  };
}

test("insumo cadastrado pelo pedido aparece no Estoque como Nunca recebido, não como Sem estoque", async ({ page }) => {
  const insumo = `Tampão nunca recebido ${Date.now()}`;
  const antes = await numerosDaSituacao(page);
  expect(antes.saude).not.toBe("");

  await cadastrarItemNovoPeloPedido(page, insumo);

  // ---- Situação: o número de "Sem estoque" e a saúde não mudam com o cadastro
  expect(await numerosDaSituacao(page)).toEqual(antes);

  // o insumo está no quadro cinza "Nunca recebidos", e só nele
  const painel = page.getByRole("region", { name: "Alertas do estoque" });
  const quadro = painel.getByRole("region", { name: "Nunca recebidos" });
  await expect(quadro).toContainText("Cadastrados, ainda sem nenhuma chegada. Não contam como sem estoque.");
  const verTodos = quadro.getByRole("button", { name: /Ver todos/ });
  if (await verTodos.count()) await verTodos.click();
  await expect(quadro.getByRole("link", { name: insumo })).toBeVisible();
  for (const outro of ["Sem estoque", "Sem mínimo definido", "Saldo não conferido"]) {
    const regiao = painel.getByRole("region", { name: outro, exact: true });
    if (await regiao.count()) await expect(regiao.getByRole("link", { name: insumo })).toHaveCount(0);
  }

  // ---- lista por insumo: fora de "Precisa de atenção" e de "Sem estoque"; dentro de "Nunca recebido"
  const lista = page.getByRole("region", { name: "Tratar por insumo" });
  await lista.getByPlaceholder("Nome ou número").fill(insumo);
  await expect(lista.getByRole("article", { name: insumo })).toHaveCount(0);
  await lista.getByLabel("Situação").selectOption("sem_disponivel");
  await expect(lista.getByRole("article", { name: insumo })).toHaveCount(0);
  await lista.getByLabel("Situação").selectOption("ok");
  await expect(lista.getByRole("article", { name: insumo })).toHaveCount(0);
  await lista.getByLabel("Situação").selectOption({ label: "Nunca recebido" });
  const cartao = lista.getByRole("article", { name: insumo });
  await expect(cartao).toContainText("Nunca recebido");
  await expect(cartao).not.toContainText("Sem estoque");

  // ---- Saldo e lotes: filtro próprio, com o selo neutro
  await page.goto("/estoque?situacao=nunca_recebido");
  const linha = page.getByRole("row", { name: new RegExp(insumo) });
  await expect(linha).toContainText("Nunca recebido");
  await page.goto("/estoque?situacao=sem_disponivel");
  await page.getByRole("searchbox", { name: "Buscar insumo" }).fill(insumo);
  // a contagem da tabela confirma que a busca rodou e não achou nada entre os "Sem estoque"
  await expect(page.getByRole("status").filter({ hasText: /^0 de \d+$/ })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(insumo) })).toHaveCount(0);
  await page.goto("/estoque?situacao=atencao");
  await expect(page.getByRole("heading", { name: "Saldo e lotes", level: 1 })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(insumo) })).toHaveCount(0);

  // ---- ficha do insumo: a mesma palavra
  await page.goto("/estoque?situacao=nunca_recebido");
  await page.getByRole("row", { name: new RegExp(insumo) }).getByRole("link", { name: insumo }).click();
  await expect(page).toHaveURL(/\/estoque\/insumos\/\d+$/);
  await expect(page.getByTestId("ficha-situacao")).toHaveText("Nunca recebido");
});

test("insumo que já foi recebido e zerou continua como Sem estoque", async ({ page }) => {
  // o Mix PCR do banco de teste tem um lote só, já consumido
  await page.goto("/estoque?situacao=nunca_recebido");
  await expect(page.getByRole("heading", { name: "Saldo e lotes", level: 1 })).toBeVisible();
  await expect(page.getByRole("row", { name: /Mix PCR/ })).toHaveCount(0);
  await page.goto("/estoque/insumos/1");
  await expect(page.getByTestId("ficha-situacao")).not.toContainText("Nunca recebido");
});
