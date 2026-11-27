import { expect, test, type Page } from "@playwright/test";
import { ADMIN, clienteDoUsuario, entrarComo } from "./apoio";
import { preencherTresOrcamentos } from "../e2e/ajudas/novo-pedido";

/**
 * Item novo contra o Postgres de verdade: algo que o laboratório nunca comprou
 * (pergunta do Giorgi, trazida pela Rafaela em 19/11/2026; decisão de Antonio
 * no mesmo dia). Quem pede escreve o item à mão; quem conduz a compra cadastra
 * o insumo pelo próprio pedido, o item fica ligado e a aprovação financeira
 * passa (ordem nova das aprovações, 0188).
 *
 * Aqui valem a função de cadastro, o gatilho que conta o item em embalagens e
 * o RLS de verdade; o banco é consultado só para saber o que foi gravado.
 */

type Cliente = Awaited<ReturnType<typeof clienteDoUsuario>>;

async function statusDoPedido(cliente: Cliente, pedidoId: number) {
  const { data } = await cliente.from("pedidos_internos").select("status").eq("id", pedidoId).single();
  return (data as { status: string } | null)?.status ?? null;
}

async function avancar(page: Page, cliente: Cliente, pedidoId: number, botao: string, statusEsperado: string) {
  await page.getByRole("button", { name: botao, exact: true }).first().click();
  await expect
    .poll(() => statusDoPedido(cliente, pedidoId), { message: `"${botao}" deveria levar a ${statusEsperado}`, timeout: 30_000 })
    .toBe(statusEsperado);
  await page.reload();
}

type ItemGravado = { id: number; insumo_id: number | null; quantidade: number; quantidade_em: string | null; conteudo_embalagem: number | null };

async function itemDoPedido(cliente: Cliente, pedidoId: number) {
  const { data } = await cliente
    .from("pedidos_internos_itens")
    .select("id, insumo_id, quantidade, quantidade_em, conteudo_embalagem")
    .eq("pedido_interno_id", pedidoId)
    .single();
  return data as ItemGravado | null;
}

test("item nunca comprado: quem pede descreve, a compra cadastra o insumo pelo pedido e a aprovação segue", async ({ page }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(30_000);
  const sufixo = Date.now();
  const insumoNome = `Tampão nunca comprado E2E ${sufixo}`;
  const projetoNome = `Projeto item novo E2E ${sufixo}`;
  const titulo = `Pedido item novo E2E ${sufixo}`;

  await entrarComo(page, ADMIN);
  const cliente = await clienteDoUsuario(ADMIN);
  const { data: sessao } = await cliente.auth.getUser();
  const { data: projeto, error: erroProjeto } = await cliente
    .from("projetos")
    .insert({ nome: projetoNome, coordenador_id: sessao.user!.id })
    .select("id")
    .single();
  expect(erroProjeto).toBeNull();
  // 0188: a primeira aprovação é do laboratório ou campo (as cinco coordenações vêm da migration)
  const { data: area, error: erroArea } = await cliente.from("coordenacoes_area").select("id").eq("nome", "Campo").single();
  expect(erroArea).toBeNull();

  // ---- 1. quem pede escreve o item à mão: não há insumo para escolher
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const novo = page.getByRole("dialog");
  await novo.getByLabel("Título do pedido").fill(titulo);
  await novo.getByRole("combobox", { name: "Projeto", exact: true }).selectOption(String(projeto!.id));
  await novo.getByRole("radiogroup", { name: "Tipo de material ou despesa" }).getByText("Material de consumo geral (campo, coleta)", { exact: true }).click();
  await novo.getByRole("radiogroup", { name: "Objetivo" }).getByText("Projeto", { exact: true }).click();
  await novo.getByLabel("Laboratório ou campo").selectOption(String((area as { id: number }).id));
  await novo.getByLabel("Justificativa técnica").fill("Protocolo novo: o laboratório nunca comprou este tampão.");
  const camposItem = novo.getByTestId("novo-pedido-item-campos");
  await expect(camposItem).toBeVisible();
  await camposItem.locator('[name="especificacao"]').fill(insumoNome);
  await expect(camposItem.getByTestId("item-novo-aviso")).toBeVisible();
  await camposItem.locator('[name="quantidade"]').fill("2");
  await camposItem.locator('[name="unidade"]').fill("frasco");
  await camposItem.locator('[name="volume"]').fill("500 mL");
  await camposItem.locator('[name="orcamento_previo"]').fill("180");
  await novo.getByRole("button", { name: "Adicionar item", exact: true }).click();
  await expect(novo.getByTestId("novo-pedido-itens").getByTestId("item-novo")).toHaveText("Item novo");
  await preencherTresOrcamentos(novo, ["360,00", "390,00", "420,00"], [`Loja A item novo ${sufixo}`, `Loja B item novo ${sufixo}`, `Loja C item novo ${sufixo}`]);
  await novo.getByRole("button", { name: "Enviar para aprovação", exact: true }).click();
  await expect(page).toHaveURL(/\/pedido\/\d+$/);
  const pedidoId = Number(page.url().split("/").pop());
  expect(pedidoId).toBeGreaterThan(0);
  await expect.poll(() => statusDoPedido(cliente, pedidoId), { timeout: 30_000 }).toBe("aguardando_area");
  expect((await itemDoPedido(cliente, pedidoId))?.insumo_id, "o item novo nasce sem insumo").toBeNull();

  // a urgência fura o ciclo do dia 10: o roteiro não depende do dia em que roda
  await page.getByRole("button", { name: "Definir urgência" }).click();
  const urgencia = page.getByRole("dialog");
  await urgencia.getByLabel("Urgência").selectOption("alta");
  await urgencia.getByLabel(/Por que é urgente/).fill("Roteiro automático do item novo.");
  await urgencia.getByRole("button", { name: "Salvar urgência" }).click();
  await expect
    .poll(async () => {
      const { data } = await cliente.from("pedidos_internos").select("urgencia").eq("id", pedidoId).single();
      return (data as { urgencia: string } | null)?.urgencia;
    }, { timeout: 30_000 })
    .toBe("alta");
  await page.reload();

  // ---- 2. o laboratório ou campo aprova com o item novo; a aprovação financeira espera o cadastro
  await avancar(page, cliente, pedidoId, "Aprovar pelo laboratório ou campo", "aguardando_financeiro");
  await expect(page.getByRole("button", { name: "Aprovar com esta fonte", exact: true })).toBeDisabled();
  await expect(page.getByText("Há 1 item novo, ainda sem cadastro. Use “Cadastrar insumo” na lista de itens antes de aprovar.")).toBeVisible();

  // ---- 3. quem conduz a compra cadastra o insumo pelo pedido
  await page.getByRole("button", { name: /Cadastrar insumo/ }).click();
  const cadastro = page.getByRole("dialog", { name: "Cadastrar item novo" });
  await expect(cadastro.getByLabel("Item", { exact: true })).toHaveValue(insumoNome);
  await expect(cadastro.getByLabel("Quantidade na embalagem")).toHaveValue("500");
  await expect(cadastro.getByLabel("Unidade da embalagem")).toHaveValue("mL");
  await cadastro.getByLabel("Marca / fabricante").fill("Marca E2E");
  await cadastro.getByRole("button", { name: "Cadastrar e ligar ao item" }).click();
  await expect
    .poll(async () => (await itemDoPedido(cliente, pedidoId))?.insumo_id ?? null, {
      message: "o item deveria ficar ligado ao insumo cadastrado",
      timeout: 30_000,
    })
    .not.toBeNull();

  // o banco gravou o insumo sem lote, e o item passou a contar em embalagens dele
  const item = (await itemDoPedido(cliente, pedidoId))!;
  expect({ quantidade: Number(item.quantidade), em: item.quantidade_em, conteudo: Number(item.conteudo_embalagem) }).toEqual({
    quantidade: 2,
    em: "embalagem",
    conteudo: 500,
  });
  const { data: insumo } = await cliente
    .from("insumos")
    .select("especificacao, fabricante, unidade, quantidade_embalagem, custo_total_embalagem, ativo")
    .eq("id", item.insumo_id!)
    .single();
  expect(insumo).toEqual({
    especificacao: insumoNome,
    fabricante: "Marca E2E",
    unidade: "mL",
    quantidade_embalagem: 500,
    custo_total_embalagem: 180,
    ativo: true,
  });
  const { data: lotes } = await cliente.from("lotes_estoque").select("id").eq("insumo_id", item.insumo_id!);
  expect(lotes ?? [], "insumo nunca recebido não tem lote").toEqual([]);

  // no Estoque, o insumo recém-cadastrado é "Nunca recebido", não "Sem estoque" (a lista tem páginas: a busca acha)
  await page.goto("/estoque?situacao=nunca_recebido");
  await page.getByRole("searchbox", { name: "Buscar insumo" }).fill(insumoNome);
  await expect(page.getByRole("row", { name: new RegExp(insumoNome) })).toContainText("Nunca recebido");
  await page.goto("/estoque?situacao=sem_disponivel");
  await page.getByRole("searchbox", { name: "Buscar insumo" }).fill(insumoNome);
  // a contagem da tabela confirma que a busca rodou e não achou nada entre os "Sem estoque"
  await expect(page.getByRole("status").filter({ hasText: /^0 de \d+$/ })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(insumoNome) })).toHaveCount(0);

  // ---- 4. com o item ligado, o financeiro aprova com a fonte, o coordenador do projeto dá a
  //         última aprovação e a compra formal leva o insumo
  await page.goto(`/pedido/${pedidoId}`);
  await expect(page.getByText("Parte desta tela não carregou")).toHaveCount(0);
  await expect(page.getByText(`vinculado: ${insumoNome}`)).toBeVisible();
  await expect(page.getByText(/Há 1 item novo, ainda sem cadastro/)).toHaveCount(0);
  await page.getByRole("combobox", { name: "Fonte de pagamento" }).selectOption("Ineo");
  await avancar(page, cliente, pedidoId, "Aprovar com esta fonte", "aguardando_projeto");
  await avancar(page, cliente, pedidoId, "Aprovar pedido", "aprovado_para_compra");
  const { data: formalizado } = await cliente.from("pedidos_internos").select("pedido_compra_id").eq("id", pedidoId).single();
  const compraId = Number((formalizado as { pedido_compra_id: number | null } | null)?.pedido_compra_id);
  expect(compraId, "a última aprovação cria a compra formal").toBeGreaterThan(0);
  const { data: itensDaCompra } = await cliente.from("pedidos_compra_itens").select("insumo_id, quantidade, quantidade_em").eq("pedido_id", compraId);
  expect(
    (itensDaCompra ?? []).map((linha) => {
      const l = linha as { insumo_id: number; quantidade: number; quantidade_em: string };
      return [l.insumo_id, Number(l.quantidade), l.quantidade_em];
    }),
  ).toEqual([[item.insumo_id, 2, "embalagem"]]);
});
