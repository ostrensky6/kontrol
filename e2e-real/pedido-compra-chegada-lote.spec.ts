import { expect, test, type Page } from "@playwright/test";
import { ADMIN, clienteDoUsuario, entrarComo } from "./apoio";
import { preencherTresOrcamentos } from "../e2e/ajudas/novo-pedido";

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
  // 0188: a primeira aprovação é do laboratório ou campo (as cinco coordenações vêm da migration)
  const { data: area, error: erroArea } = await cliente.from("coordenacoes_area").select("id").eq("nome", "Genética").single();
  expect(erroArea).toBeNull();

  // ---- 1. o pedido nasce na tela já com o item e segue direto para aprovação, sem rascunho
  // (relatório de ajustes de Compras de 17/11/2026, ajuste 4)
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const novo = page.getByRole("dialog");
  await novo.getByLabel("Título do pedido").fill(titulo);
  await novo.getByRole("combobox", { name: "Projeto", exact: true }).selectOption(String(projeto!.id));
  await novo.getByRole("radiogroup", { name: "Tipo de material ou despesa" }).getByText("Material de consumo geral (campo, coleta)", { exact: true }).click();
  await novo.getByRole("radiogroup", { name: "Objetivo" }).getByText("Projeto", { exact: true }).click();
  await novo.getByLabel("Laboratório ou campo").selectOption(String((area as { id: number }).id));
  // quem pede não define a urgência nem sugere a fonte do recurso (ajustes 2 e 3)
  await expect(novo.getByLabel("Urgência")).toHaveCount(0);
  await expect(novo.getByLabel(/Fonte sugerida/)).toHaveCount(0);
  await novo.getByLabel("Justificativa técnica").fill("Ponteiras para as coletas do roteiro automático.");
  // item ligado ao insumo cadastrado: a lista de insumos carrega quando o formulário abre
  const camposItem = novo.getByTestId("novo-pedido-item-campos");
  await expect(camposItem).toBeVisible();
  await novo.locator("#pedido-item-insumo-selecao-novo-pedido-item").selectOption(String(insumo!.id));
  await camposItem.locator('[name="quantidade"]').fill("5");
  await novo.getByRole("button", { name: "Adicionar item", exact: true }).click();
  await expect(novo.getByTestId("novo-pedido-itens")).toContainText(insumoNome);
  // o orçamento prévio entra com o pedido, por quem pede (ajustes de 19/11/2026, ajuste 2)
  const cotacaoDoPedido = novo.getByRole("group", { name: "Documento 1" });
  await cotacaoDoPedido.getByLabel("Título").fill("Orçamento prévio do roteiro");
  await cotacaoDoPedido.getByLabel("Arquivo").setInputFiles({
    name: "cotacao-previa-roteiro.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% roteiro automático\n"),
  });
  await cotacaoDoPedido.getByLabel("Link ou referência externa (opcional)").fill("https://exemplo.invalid/cotacao-previa-roteiro");
  await cotacaoDoPedido.getByLabel("Observação").fill("Valor estimado: R$ 400,00");
  // 0188: os 3 orçamentos vão junto com o pedido, cada um com o documento do fornecedor
  const cotacoes = [
    { fornecedor: `Fornecedor A ${sufixo}`, valor: "400,00" },
    { fornecedor: `Fornecedor B ${sufixo}`, valor: "450,00" },
    { fornecedor: `Fornecedor C ${sufixo}`, valor: "500,00" },
  ];
  await preencherTresOrcamentos(
    novo,
    [cotacoes[0].valor, cotacoes[1].valor, cotacoes[2].valor],
    [cotacoes[0].fornecedor, cotacoes[1].fornecedor, cotacoes[2].fornecedor],
  );
  await novo.getByRole("button", { name: "Enviar para aprovação", exact: true }).click();
  await expect(page).toHaveURL(/\/pedido\/\d+$/);
  const pedidoId = Number(page.url().split("/").pop());
  expect(pedidoId).toBeGreaterThan(0);

  // o banco gravou o pedido, o item e a etapa de uma vez; a urgência nasce Normal e a fonte, vazia
  await expect.poll(() => statusDoPedido(cliente, pedidoId), { timeout: 30_000 }).toBe("aguardando_area");
  const { data: itensGravados } = await cliente.from("pedidos_internos_itens").select("insumo_id, quantidade").eq("pedido_interno_id", pedidoId);
  expect((itensGravados ?? []).map((item) => [(item as { insumo_id: number | null }).insumo_id, Number((item as { quantidade: number }).quantidade)])).toEqual([[insumo!.id, 5]]);
  const { data: nascido } = await cliente.from("pedidos_internos").select("urgencia, urgencia_justificativa, fonte_recurso").eq("id", pedidoId).single();
  expect(nascido).toEqual({ urgencia: "normal", urgencia_justificativa: null, fonte_recurso: null });
  await expect(page.getByRole("cell", { name: new RegExp(insumoNome) }).first()).toBeVisible();
  // o orçamento prévio foi gravado no Storage e registrado na Solicitação
  const { data: cotacaoPrevia } = await cliente
    .from("pedidos_internos_anexos")
    .select("tipo, etapa, titulo, url, observacao, arquivo_nome, storage_bucket, storage_path")
    .eq("pedido_interno_id", pedidoId)
    .eq("tipo", "orcamento_previo");
  expect(cotacaoPrevia).toEqual([
    expect.objectContaining({
      tipo: "orcamento_previo",
      etapa: "rascunho",
      titulo: "Orçamento prévio do roteiro",
      url: "https://exemplo.invalid/cotacao-previa-roteiro",
      observacao: "Valor estimado: R$ 400,00",
      arquivo_nome: "cotacao-previa-roteiro.pdf",
      storage_bucket: "pedidos-internos-anexos",
    }),
  ]);
  expect(String((cotacaoPrevia?.[0] as { storage_path?: string } | undefined)?.storage_path)).toMatch(new RegExp(`^${pedidoId}/`));
  // os 3 orçamentos foram gravados com o documento de cada um; no envio, o de menor valor ficou escolhido
  const { data: orcamentosGravados } = await cliente
    .from("pedidos_internos_cotacoes")
    .select("fornecedor_nome, valor_total, escolhida, anexo_id")
    .eq("pedido_interno_id", pedidoId)
    .order("valor_total");
  expect(
    (orcamentosGravados ?? []).map((linha) => {
      const o = linha as { fornecedor_nome: string; valor_total: number; escolhida: boolean; anexo_id: number | null };
      return [o.fornecedor_nome, Number(o.valor_total), o.escolhida, o.anexo_id != null];
    }),
  ).toEqual([
    [cotacoes[0].fornecedor, 400, true, true],
    [cotacoes[1].fornecedor, 450, false, true],
    [cotacoes[2].fornecedor, 500, false, true],
  ]);

  // ---- 2. a urgência é de quem tem a permissão "Definir urgência do pedido" (0183). Ela fura o ciclo do
  // dia 10 (0172/0176): com isso o roteiro não depende do dia em que roda
  await page.getByRole("button", { name: "Definir urgência" }).click();
  const urgencia = page.getByRole("dialog");
  await urgencia.getByLabel("Urgência").selectOption("alta");
  await urgencia.getByLabel(/Por que é urgente/).fill("Roteiro automático: precisa seguir no mesmo dia.");
  await urgencia.getByRole("button", { name: "Salvar urgência" }).click();
  await expect
    .poll(async () => {
      const { data } = await cliente.from("pedidos_internos").select("urgencia, urgencia_justificativa, urgencia_definida_por").eq("id", pedidoId).single();
      return data;
    }, { message: "Definir urgência deveria gravar a urgência e quem a definiu", timeout: 30_000 })
    .toEqual({ urgencia: "alta", urgencia_justificativa: "Roteiro automático: precisa seguir no mesmo dia.", urgencia_definida_por: ADMIN });
  await page.reload();
  await expect(page.getByText("Urgente: Roteiro automático: precisa seguir no mesmo dia.")).toBeVisible();

  // ---- 3. 0188: laboratório ou campo, financeiro (com a fonte da lista) e, por último, o coordenador
  //         do projeto. A última aprovação cria a compra formal e a aprova junto (0170)
  await expect(page.getByTestId("orcamentos-pedido")).toContainText(`escolhido: ${cotacoes[0].fornecedor}`);
  await avancar(page, cliente, pedidoId, "Aprovar pelo laboratório ou campo", "aguardando_financeiro");
  await page.getByRole("combobox", { name: "Fonte de pagamento" }).selectOption("Funpar");
  await page.getByLabel("Rubrica (opcional)").fill("Material de consumo");
  await avancar(page, cliente, pedidoId, "Aprovar com esta fonte", "aguardando_projeto");
  const { data: comFonte } = await cliente.from("pedidos_internos").select("fonte_recurso, rubrica").eq("id", pedidoId).single();
  expect(comFonte).toEqual({ fonte_recurso: "Funpar", rubrica: "Material de consumo" });
  await avancar(page, cliente, pedidoId, "Aprovar pedido", "aprovado_para_compra");
  const { data: formalizado } = await cliente.from("pedidos_internos").select("pedido_compra_id").eq("id", pedidoId).single();
  const compraId = Number((formalizado as { pedido_compra_id: number | null } | null)?.pedido_compra_id);
  expect(compraId, "a última aprovação cria a compra formal").toBeGreaterThan(0);

  // ---- 4. compra única na tela (0170 e 0182): a compra é aprovada junto com o pedido e é
  //         conduzida no quadro "Compra" do pedido, sem ninguém abrir a tela da compra
  const lerCompra = async () => {
    const { data } = await cliente
      .from("pedidos_compra")
      .select("status, fornecedor_id, data_prevista_entrega")
      .eq("id", compraId)
      .single();
    return data as { status: string; fornecedor_id: number | null; data_prevista_entrega: string | null } | null;
  };
  const statusDaCompra = async () => (await lerCompra())?.status ?? null;
  await expect.poll(statusDaCompra, { message: "a compra é aprovada junto com o pedido", timeout: 30_000 }).toBe("aprovado");

  const painel = page.getByTestId("painel-compra");
  await expect(painel.getByRole("heading", { name: `Compra #${compraId}` })).toBeVisible();
  await expect(painel.getByTestId("painel-compra-situacao")).toHaveText("Aprovado");
  await expect(painel.getByRole("link", { name: "Imprimir / PDF" })).toHaveAttribute("href", `/compras/${compraId}/imprimir`);
  // o orçamento escolhido trouxe só o nome digitado: a compra nasceu sem fornecedor e o quadro avisa
  await expect(painel.getByTestId("painel-compra-fornecedor")).toHaveText("Falta definir");
  await expect(painel.getByTestId("painel-compra-sem-fornecedor")).toContainText(
    `traz só o nome “${cotacoes[0].fornecedor}”, que não está no cadastro de fornecedores.`,
  );
  // antes de fechar não há botão de envio: "Fechar com fornecedor" envia a compra junto
  await expect(painel.getByTestId("painel-compra-envio")).toContainText("já marca esta compra como enviada");
  await expect(painel.getByRole("button", { name: "Marcar compra como enviada" })).toHaveCount(0);

  // o fornecedor entra no cadastro com o mesmo nome e um prazo médio: o quadro já o aponta
  const prazoDoFornecedor = 9;
  const { data: fornecedor, error: erroFornecedor } = await cliente
    .from("fornecedores")
    .insert({ nome: cotacoes[0].fornecedor, prazo_medio_dias: prazoDoFornecedor })
    .select("id")
    .single();
  expect(erroFornecedor).toBeNull();
  const fornecedorId = Number((fornecedor as { id: number } | null)?.id);
  await page.reload();
  const semFornecedor = painel.getByTestId("painel-compra-sem-fornecedor");
  await expect(semFornecedor).toContainText(`traz o nome “${cotacoes[0].fornecedor}”, que está no cadastro.`);
  await expect(semFornecedor.getByLabel("Fornecedor da compra")).toHaveValue(String(fornecedorId));
  await semFornecedor.getByRole("button", { name: "Definir fornecedor", exact: true }).click();
  // a compra já está aprovada: preencher o que ficou em branco vale com "Aprovar compras"
  await expect
    .poll(async () => (await lerCompra())?.fornecedor_id ?? null, { message: "o fornecedor definido no pedido grava na compra", timeout: 30_000 })
    .toBe(fornecedorId);
  await page.reload();
  await expect(painel.getByTestId("painel-compra-fornecedor")).toHaveText(cotacoes[0].fornecedor);
  await expect(painel.getByTestId("painel-compra-sem-fornecedor")).toHaveCount(0);

  // "Fechar com fornecedor" fecha o pedido e, pelo gatilho da 0182, envia a compra na mesma gravação
  const hojeEmBrasilia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const somarDias = (dia: string, dias: number) => {
    const data = new Date(`${dia}T12:00:00Z`);
    data.setUTCDate(data.getUTCDate() + dias);
    return data.toISOString().slice(0, 10);
  };
  const antesDeFechar = hojeEmBrasilia();
  await avancar(page, cliente, pedidoId, "Fechar com fornecedor", "compra_fechada");
  await expect.poll(statusDaCompra, { message: "fechar o pedido envia a compra (0182)", timeout: 30_000 }).toBe("enviado");
  // sem prazo no orçamento nem no insumo, vale o prazo médio do fornecedor da compra
  const previstas = [antesDeFechar, hojeEmBrasilia()].map((dia) => somarDias(dia, prazoDoFornecedor));
  expect(previstas).toContain(String((await lerCompra())?.data_prevista_entrega).slice(0, 10));
  const { data: eventosDoEnvio, error: erroEventos } = await cliente
    .from("eventos_status")
    .select("de_status, para_status, observacao")
    .eq("entidade", "pedido_compra")
    .eq("entidade_id", compraId)
    .eq("para_status", "enviado");
  expect(erroEventos).toBeNull();
  expect(eventosDoEnvio).toHaveLength(1);
  expect((eventosDoEnvio![0] as { observacao: string | null }).observacao).toContain(`fechamento do pedido interno #${pedidoId}`);

  await semLeituraFalha(page);
  await expect(painel.getByTestId("painel-compra-situacao")).toHaveText("Enviado");
  await expect(painel.getByTestId("painel-compra-previsao")).not.toHaveText("sem previsão");
  await expect(painel.getByTestId("painel-compra-envio")).toHaveCount(0);

  // a tela da compra virou consulta: aponta para o pedido e não tem botão de etapa
  await page.goto(`/compras/${compraId}`);
  await semLeituraFalha(page);
  const nota = page.getByTestId("compra-conduzida-no-pedido");
  await expect(nota.getByRole("link", { name: /^Abrir o pedido Nº/ })).toHaveAttribute("href", `/pedido/${pedidoId}#compra`);
  await expect(page.getByRole("button", { name: "Marcar enviado", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Aprovar", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Imprimir / PDF" })).toBeVisible();

  // a lista de compras abre o pedido, já no quadro "Compra"
  await page.goto("/compras");
  await semLeituraFalha(page);
  await page.getByPlaceholder(/^Buscar compra, pedido/).fill(cotacoes[0].fornecedor);
  const linhaDaCompra = page.getByRole("row").filter({ hasText: cotacoes[0].fornecedor });
  await expect(linhaDaCompra).toHaveCount(1);
  await expect(linhaDaCompra.getByRole("link", { name: new RegExp(`^#${compraId}\\b`) })).toHaveAttribute(
    "href",
    `/pedido/${pedidoId}#compra`,
  );

  // ---- 5. chegada única (item 10): o pedido oferece "Registrar chegada" na linha do item,
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
  await page.getByPlaceholder(/^Buscar item, pedido/).fill(insumoNome);
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
  await page.getByPlaceholder(/^Buscar item, pedido/).fill(insumoNome);
  await expect(page.getByRole("row").filter({ hasText: insumoNome }).getByRole("button", { name: "Registrar chegada" })).toHaveCount(0);

  // a página do projeto soma as compras com os itens (a mesma ligação, no sentido inverso)
  await page.goto(`/projetos/${projeto!.id}`);
  await semLeituraFalha(page);

  // ---- 6. o que chegou aparece no estoque e na ficha do lote
  await page.goto(`/estoque/lotes/${lote.id}`);
  await expect(page.getByText(codigoLote).first()).toBeVisible();
  await expect(page.getByText(insumoNome).first()).toBeVisible();
  await page.goto("/estoque");
  await page.getByPlaceholder("Buscar insumo...").fill(insumoNome);
  await expect(page.getByText(insumoNome).first()).toBeVisible();
});
