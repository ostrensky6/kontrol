import { expect, test, type Page } from "@playwright/test";
import { ADMIN, clienteDoUsuario, entrarComo } from "./apoio";

/**
 * Roteiro inteiro de Suprimentos contra o Postgres de verdade (auditoria de
 * 16/11, item 11): o pedido nasce na tela, passa por cada aprovação, vira
 * compra, a compra chega e a chegada vira lote no estoque.
 *
 * Cada passo é o botão da própria tela; o banco é consultado só para saber que
 * a etapa gravou antes de seguir (gatilhos, RPCs e RLS de verdade).
 */

type Cliente = Awaited<ReturnType<typeof clienteDoUsuario>>;

async function statusDoPedido(cliente: Cliente, pedidoId: number) {
  const { data } = await cliente.from("pedidos_internos").select("status").eq("id", pedidoId).single();
  return (data as { status: string } | null)?.status ?? null;
}

/** Aperta o botão da etapa e só segue quando o banco mostra o status novo. */
async function avancar(page: Page, cliente: Cliente, pedidoId: number, botao: string, statusEsperado: string) {
  await page.getByRole("button", { name: botao, exact: true }).first().click();
  await expect
    .poll(() => statusDoPedido(cliente, pedidoId), { message: `"${botao}" deveria levar a ${statusEsperado}`, timeout: 30_000 })
    .toBe(statusEsperado);
  // relê do banco: a tela seguinte tem que nascer do que foi gravado
  await page.reload();
}

/**
 * A tela leu tudo do banco. O item da compra aponta para a compra por duas
 * chaves (0130); trazer um junto do outro sem dizer qual fazia o banco recusar
 * a leitura, e só aqui, com o PostgREST de verdade, isso aparece.
 */
async function semLeituraFalha(page: Page) {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.getByText("Parte desta tela não carregou")).toHaveCount(0);
}

test("pedido vira compra, a compra chega e a chegada vira lote no estoque", async ({ page }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(30_000);
  const sufixo = Date.now();
  const insumoNome = `Ponteira roteiro E2E ${sufixo}`;
  const projetoNome = `Projeto roteiro E2E ${sufixo}`;
  const titulo = `Pedido roteiro E2E ${sufixo}`;
  const codigoLote = `LROT-${sufixo}`;

  await entrarComo(page, ADMIN);

  // ---- preparo: insumo pelo cadastro e projeto coordenado pelo próprio administrador
  await page.goto("/cadastros/insumos");
  await page.getByRole("button", { name: "Novo insumo" }).click();
  const cadastro = page.getByRole("dialog");
  await cadastro.locator('[name="especificacao"]').fill(insumoNome);
  await cadastro.locator('[name="custo_total_embalagem"]').fill("80");
  await cadastro.locator('[name="quantidade_embalagem"]').fill("1");
  await cadastro.locator('[name="unidade"]').fill("cx");
  await cadastro.getByRole("button", { name: "Salvar" }).click();
  await expect(cadastro).toBeHidden();

  const cliente = await clienteDoUsuario(ADMIN);
  const { data: sessao } = await cliente.auth.getUser();
  const { data: insumo, error: erroInsumo } = await cliente.from("insumos").select("id").eq("especificacao", insumoNome).single();
  expect(erroInsumo).toBeNull();
  // sem coordenador cadastrado o envio trava (0169): o projeto nasce com quem aprova
  const { data: projeto, error: erroProjeto } = await cliente
    .from("projetos")
    .insert({ nome: projetoNome, coordenador_id: sessao.user!.id })
    .select("id")
    .single();
  expect(erroProjeto).toBeNull();

  // ---- 1. o pedido nasce na tela
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const novo = page.getByRole("dialog");
  await novo.getByLabel("Título do pedido").fill(titulo);
  await novo.getByLabel("Projeto").selectOption(String(projeto!.id));
  await novo.getByLabel("Tipo de material ou despesa").selectOption("material_consumo_geral");
  await novo.getByLabel("Objetivo").selectOption("projeto");
  // urgência fura o ciclo do dia 10 (0172/0176): o roteiro não depende do dia em que roda
  await novo.getByLabel("Urgência").selectOption("alta");
  await novo.getByLabel(/Por que é urgente/).fill("Roteiro automático: precisa seguir no mesmo dia.");
  await novo.getByLabel("Justificativa técnica").fill("Ponteiras para as coletas do roteiro automático.");
  await novo.getByRole("button", { name: "Criar rascunho" }).click();
  await expect(page).toHaveURL(/\/pedido\/\d+$/);
  const pedidoId = Number(page.url().split("/").pop());
  expect(pedidoId).toBeGreaterThan(0);

  // ---- 2. item ligado ao insumo cadastrado
  await page.locator("#pedido-item-insumo-selecao-novo-item").selectOption(String(insumo!.id));
  await page.locator('form:has(#pedido-item-insumo-selecao-novo-item) [name="quantidade"]').fill("5");
  await page.getByRole("button", { name: "Adicionar item", exact: true }).click();
  await expect
    .poll(async () => {
      const { data } = await cliente.from("pedidos_internos_itens").select("id, insumo_id").eq("pedido_interno_id", pedidoId);
      return (data ?? []).map((item) => (item as { insumo_id: number | null }).insumo_id);
    })
    .toEqual([insumo!.id]);
  await page.reload();
  await expect(page.getByRole("cell", { name: new RegExp(insumoNome) }).first()).toBeVisible();

  // ---- 3. coordenação do projeto e formalização (aqui nasce a compra)
  await avancar(page, cliente, pedidoId, "Enviar para aprovação", "em_validacao");
  await avancar(page, cliente, pedidoId, "Aprovar pedido", "validado");
  await avancar(page, cliente, pedidoId, "Formalizar em compras", "formalizado");
  const { data: formalizado } = await cliente.from("pedidos_internos").select("pedido_compra_id").eq("id", pedidoId).single();
  const compraId = Number((formalizado as { pedido_compra_id: number | null } | null)?.pedido_compra_id);
  expect(compraId, "a formalização cria a compra formal").toBeGreaterThan(0);

  // ---- 4. análise administrativa
  await page.locator("#registrarAnaliseAdministrativa-fonte_recurso").fill("Recurso do projeto");
  await page.locator("#registrarAnaliseAdministrativa-rubrica").fill("Material de consumo");
  await page.locator("#registrarAnaliseAdministrativa-conformidade_admin").fill("Conferido para o roteiro automático.");
  await avancar(page, cliente, pedidoId, "Registrar análise administrativa", "analise_administrativa");
  await avancar(page, cliente, pedidoId, "Autorizar compra", "aprovado_compra");

  // ---- 5. três orçamentos de fornecedores diferentes, com a cotação anexada
  await avancar(page, cliente, pedidoId, "Registrar cotações", "orcamentos");
  // o formulário de documento fica recolhido até alguém abrir
  await page.locator("summary", { hasText: "Registrar documento" }).click();
  const documento = page.locator("form:has(#adicionarAnexoPedidoInterno-titulo)");
  await documento.locator("#adicionarAnexoPedidoInterno-titulo").fill("Cotações do roteiro");
  await documento.locator("#adicionarAnexoPedidoInterno-url").fill("https://exemplo.invalid/cotacoes-roteiro");
  await documento.getByRole("button", { name: "Registrar documento", exact: true }).click();
  await expect
    .poll(async () => {
      const { data } = await cliente.from("pedidos_internos_anexos").select("id").eq("pedido_interno_id", pedidoId);
      return (data ?? []).length;
    })
    .toBe(1);
  await page.reload();

  const quadro = page.getByTestId("orcamentos-pedido");
  const cotacoes = [
    { fornecedor: `Fornecedor A ${sufixo}`, valor: "400" },
    { fornecedor: `Fornecedor B ${sufixo}`, valor: "450" },
    { fornecedor: `Fornecedor C ${sufixo}`, valor: "500" },
  ];
  for (const [indice, cotacao] of cotacoes.entries()) {
    await quadro.getByLabel("Ou nome do fornecedor").fill(cotacao.fornecedor);
    await quadro.getByLabel("Valor total (R$)").fill(cotacao.valor);
    await quadro.getByRole("button", { name: "Registrar orçamento", exact: true }).click();
    await expect(quadro.getByRole("listitem").filter({ hasText: cotacao.fornecedor })).toBeVisible();
    await expect(quadro.getByRole("listitem")).toHaveCount(indice + 1);
  }
  await page.reload();
  await avancar(page, cliente, pedidoId, "Marcar cotações recebidas", "orcamentos_recebidos");

  // o de menor valor não pede justificativa
  const menor = page.getByTestId("orcamentos-pedido").getByRole("listitem").filter({ hasText: cotacoes[0].fornecedor });
  await menor.getByRole("button", { name: "Escolher", exact: true }).click();
  await expect(page.getByTestId("orcamentos-pedido")).toContainText(`escolhido: ${cotacoes[0].fornecedor}`);
  await page.reload();
  await avancar(page, cliente, pedidoId, "Enviar para aprovação final", "aguardando_aprovacao_final");
  await avancar(page, cliente, pedidoId, "Aprovar compra final", "aprovado_para_compra");

  // ---- 6. caminho único (0170): a compra é aprovada junto com o pedido e vai ao fornecedor
  const statusDaCompra = async () => {
    const { data } = await cliente.from("pedidos_compra").select("status").eq("id", compraId).single();
    return (data as { status: string } | null)?.status ?? null;
  };
  await expect.poll(statusDaCompra, { message: "a compra é aprovada junto com o pedido", timeout: 30_000 }).toBe("aprovado");
  await page.goto(`/compras/${compraId}`);
  await page.getByRole("button", { name: "Marcar enviado", exact: true }).click();
  await expect.poll(statusDaCompra, { timeout: 30_000 }).toBe("enviado");

  // ---- 7. chegada única (item 10): o pedido oferece "Registrar chegada" na linha do item,
  //         e Chegadas registra pela compra sem ninguém trocar de tela
  await page.goto(`/pedido/${pedidoId}`);
  await semLeituraFalha(page);
  const noPedido = page.getByTestId("chegada-pela-compra");
  await expect(noPedido.getByRole("button", { name: "Registrar chegada" })).toBeVisible();
  await expect(noPedido.getByRole("link", { name: `Compra #${compraId}` })).toHaveAttribute("href", `/compras/${compraId}`);

  await page.goto("/recebimento");
  await semLeituraFalha(page);
  // o bloco das compras sem pedido também lê o item junto da compra
  await expect(page.getByText("sem dado", { exact: true })).toHaveCount(0);
  await page.getByPlaceholder("Buscar item, pedido, projeto ou fornecedor...").fill(insumoNome);
  const linhaDaChegada = page.getByRole("row").filter({ hasText: insumoNome });
  await expect(linhaDaChegada).toHaveCount(1);
  await linhaDaChegada.getByRole("button", { name: "Registrar chegada" }).click();
  const chegada = page.getByRole("dialog", { name: "Registrar chegada do item" });
  await expect(chegada.locator('[name="quantidade_recebida"]')).toHaveValue("5");
  await chegada.getByLabel("Validade", { exact: true }).fill("2031-12-31");
  await chegada.getByLabel("Código do lote", { exact: true }).fill(codigoLote);
  await chegada.getByRole("button", { name: "Confirmar chegada", exact: true }).click();

  const lerLote = async () => {
    const { data } = await cliente
      .from("lotes_estoque")
      .select("id, insumo_id, quantidade_inicial, quantidade_atual, validade")
      .eq("codigo_lote", codigoLote);
    return data ?? [];
  };
  await expect.poll(async () => (await lerLote()).length, { timeout: 30_000 }).toBe(1);
  const [lote] = (await lerLote()) as { id: number; insumo_id: number; quantidade_inicial: number; quantidade_atual: number; validade: string | null }[];
  expect(lote.insumo_id).toBe(insumo!.id);
  expect(Number(lote.quantidade_inicial)).toBe(5);
  expect(Number(lote.quantidade_atual)).toBe(5);
  expect(lote.validade).toBe("2031-12-31");
  await expect.poll(statusDaCompra, { timeout: 30_000 }).toBe("recebido");
  // a chegada pela compra atualiza o item do pedido na mesma gravação (0127)
  const { data: itensDoPedido, error: erroItens } = await cliente
    .from("pedidos_internos_itens")
    .select("quantidade_recebida, recebido_em, lote_id")
    .eq("pedido_interno_id", pedidoId);
  expect(erroItens).toBeNull();
  expect(itensDoPedido).toHaveLength(1);
  const itemRecebido = itensDoPedido![0] as { quantidade_recebida: number | string | null; recebido_em: string | null; lote_id: number | null };
  expect(Number(itemRecebido.quantidade_recebida)).toBe(5);
  expect(itemRecebido.recebido_em).not.toBeNull();
  expect(itemRecebido.lote_id).toBe(lote.id);
  // a linha sai de Chegadas: não sobra nada a registrar para este pedido
  await page.goto("/recebimento");
  await page.getByPlaceholder("Buscar item, pedido, projeto ou fornecedor...").fill(insumoNome);
  await expect(page.getByRole("row").filter({ hasText: insumoNome }).getByRole("button", { name: "Registrar chegada" })).toHaveCount(0);

  // a página do projeto soma as compras com os itens (a mesma ligação, no sentido inverso)
  await page.goto(`/projetos/${projeto!.id}`);
  await semLeituraFalha(page);

  // ---- 8. o que chegou aparece no estoque e na ficha do lote
  await page.goto(`/estoque/lotes/${lote.id}`);
  await expect(page.getByText(codigoLote).first()).toBeVisible();
  await expect(page.getByText(insumoNome).first()).toBeVisible();
  await page.goto("/estoque");
  await page.getByPlaceholder("Buscar insumo...").fill(insumoNome);
  await expect(page.getByText(insumoNome).first()).toBeVisible();
});
