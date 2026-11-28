import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
const redirect = vi.fn();
const registrarEvento = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const inseridos: Record<string, unknown[]> = {};
let statusDoPedido = "rascunho";

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/roles", () => ({
  temPapel: vi.fn(async () => true),
  usuarioAtual: vi.fn(async () => ({ nome: "Solicitante", email: "solicitante@example.com", papel: "laboratorio" })),
}));
vi.mock("@/lib/auth/permissao-efetiva", () => ({
  pode: vi.fn(async () => true),
  temPermissao: vi.fn(async () => true),
}));
vi.mock("./eventos", () => ({ registrarEvento }));

function from(tabela: string) {
  return {
    insert: (linha: unknown) => {
      (inseridos[tabela] ??= []).push(linha);
      const resposta = { data: tabela === "pedidos_internos" ? { id: 77 } : [{ id: 1 }], error: null };
      return Object.assign(Promise.resolve(resposta), {
        select: () => Object.assign(Promise.resolve(resposta), { single: async () => resposta }),
      });
    },
    select: () => ({
      eq: () => ({ single: async () => ({ data: { status: statusDoPedido }, error: null }) }),
    }),
  };
}

const cliente = { from, rpc: vi.fn(), storage: { from: () => ({ upload, remove }) } };
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => cliente),
  createClientUntyped: vi.fn(async () => cliente),
}));

function pdf(nome: string, bytes = 10) {
  return new File([new Uint8Array(bytes)], nome, { type: "application/pdf" });
}

beforeEach(() => {
  for (const chave of Object.keys(inseridos)) delete inseridos[chave];
  revalidatePath.mockReset();
  redirect.mockReset();
  registrarEvento.mockReset();
  upload.mockReset().mockResolvedValue({ data: { path: "x" }, error: null });
  remove.mockReset().mockResolvedValue({ data: [], error: null });
  statusDoPedido = "rascunho";
});

/** Relatório de ajustes de 19/11/2026, ajuste 2. */
describe("orçamento prévio e termo de referência entram com o pedido", () => {
  it("o Novo pedido grava cada documento com tipo, título, arquivo, link e observação", async () => {
    const { criarPedidoInterno } = await import("./pedidos-internos");
    const dados = new FormData();
    dados.set("titulo", "Reagentes");
    dados.set("acao", "rascunho");
    dados.set("itens_json", "[]");
    dados.set("documentos_indices", "0,1,2");
    // orçamento prévio só com link e valor estimado, sem arquivo
    dados.set("documento_0_tipo", "orcamento_previo");
    dados.set("documento_0_titulo", "Cotação do kit");
    dados.set("documento_0_arquivo", new File([], ""));
    dados.set("documento_0_url", "https://loja.exemplo/kit");
    dados.set("documento_0_observacao", "Valor estimado: R$ 1.200,00");
    // termo de referência com arquivo e sem título: vale o nome do arquivo
    dados.set("documento_1_tipo", "termo_referencia");
    dados.set("documento_1_arquivo", pdf("termo.pdf"));
    // conjunto em branco não conta
    dados.set("documento_2_tipo", "orcamento_previo");
    dados.set("documento_2_arquivo", new File([], ""));

    await criarPedidoInterno({ ok: false }, dados);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(inseridos.pedidos_internos_anexos).toEqual([
      expect.objectContaining({
        pedido_interno_id: 77,
        etapa: "rascunho",
        tipo: "orcamento_previo",
        titulo: "Cotação do kit",
        url: "https://loja.exemplo/kit",
        observacao: "Valor estimado: R$ 1.200,00",
        storage_path: null,
      }),
      expect.objectContaining({ pedido_interno_id: 77, etapa: "rascunho", tipo: "termo_referencia", titulo: "termo.pdf", url: null }),
    ]);
    expect(redirect).toHaveBeenCalledWith("/pedido/77");
  });

  it("arquivo grande demais é recusado antes de criar o pedido", async () => {
    const { criarPedidoInterno } = await import("./pedidos-internos");
    const dados = new FormData();
    dados.set("titulo", "Reagentes");
    dados.set("acao", "rascunho");
    dados.set("itens_json", "[]");
    dados.set("documentos_indices", "0");
    dados.set("documento_0_arquivo", pdf("grande.pdf", 4 * 1024 * 1024));

    const resultado = await criarPedidoInterno({ ok: false }, dados);

    expect(resultado).toEqual({ ok: false, message: "O arquivo tem 4 MB; cabe até 3,5 MB. Reduza o PDF ou registre um link." });
    expect(inseridos.pedidos_internos).toBeUndefined();
    expect(upload).not.toHaveBeenCalled();
  });

  it("documento que não grava deixa o pedido como rascunho, com o aviso", async () => {
    upload.mockResolvedValueOnce({ data: null, error: { message: "falhou" } });
    const { criarPedidoInterno } = await import("./pedidos-internos");
    const dados = new FormData();
    dados.set("titulo", "Reagentes");
    dados.set("acao", "rascunho");
    dados.set("itens_json", "[]");
    dados.set("documentos_indices", "0");
    dados.set("documento_0_arquivo", pdf("cotacao.pdf"));

    await criarPedidoInterno({ ok: false }, dados);

    expect(redirect).toHaveBeenCalledWith("/pedido/77?aviso=documentos");
  });

  it("na Aprovação, Registrar documento recusa orçamento prévio e termo de referência", async () => {
    statusDoPedido = "em_validacao";
    const { adicionarAnexoPedidoInterno } = await import("./pedidos-internos");
    for (const tipo of ["orcamento_previo", "termo_referencia"]) {
      const dados = new FormData();
      dados.set("pedido_interno_id", "77");
      dados.set("tipo", tipo);
      dados.set("arquivo", pdf("doc.pdf"));
      const resultado = await adicionarAnexoPedidoInterno({ ok: false }, dados);
      expect(resultado.ok, tipo).toBe(false);
      expect(resultado.message, tipo).toContain("entram com o pedido");
    }
    expect(upload).not.toHaveBeenCalled();
    expect(inseridos.pedidos_internos_anexos).toBeUndefined();
  });

  it("na Aprovação, os outros documentos continuam entrando", async () => {
    statusDoPedido = "em_validacao";
    const { adicionarAnexoPedidoInterno } = await import("./pedidos-internos");
    const dados = new FormData();
    dados.set("pedido_interno_id", "77");
    dados.set("tipo", "oficio");
    dados.set("arquivo", pdf("oficio.pdf"));

    expect(await adicionarAnexoPedidoInterno({ ok: false }, dados)).toEqual({ ok: true, message: "Documento registrado." });
    expect(inseridos.pedidos_internos_anexos).toEqual([
      expect.objectContaining({ pedido_interno_id: 77, etapa: "em_validacao", tipo: "oficio", titulo: "oficio.pdf" }),
    ]);
  });

  it("devolvido para ajuste, quem pede ainda registra o orçamento prévio", async () => {
    statusDoPedido = "ajuste_solicitante";
    const { adicionarAnexoPedidoInterno } = await import("./pedidos-internos");
    const dados = new FormData();
    dados.set("pedido_interno_id", "77");
    dados.set("tipo", "orcamento_previo");
    dados.set("arquivo", pdf("cotacao-nova.pdf"));

    expect(await adicionarAnexoPedidoInterno({ ok: false }, dados)).toEqual({ ok: true, message: "Documento registrado." });
  });
});

/** Relatório de bugs de 27/11/2026, bugs 1 e 3. */
describe("nota fiscal e documento de cada orçamento", () => {
  it("a nota fiscal entra em PDF e XML no mesmo envio, um documento por arquivo", async () => {
    statusDoPedido = "aguardando_pagamento_nf";
    const { registrarNotaFiscal } = await import("./pedidos-internos");
    const dados = new FormData();
    dados.set("pedido_interno_id", "77");
    dados.set("tipo", "nota_fiscal");
    dados.set("numero", "4521");
    dados.append("arquivo", pdf("nf-4521.pdf"));
    dados.append("arquivo", new File(["<nfe/>"], "nf-4521.xml", { type: "" }));

    expect(await registrarNotaFiscal({ ok: false }, dados)).toEqual({ ok: true, message: "2 arquivos registrados." });
    expect(inseridos.pedidos_internos_anexos).toEqual([
      expect.objectContaining({ tipo: "nota_fiscal", titulo: "NF 4521 (PDF)", etapa: "aguardando_pagamento_nf", mime_type: "application/pdf" }),
      expect.objectContaining({ tipo: "nota_fiscal", titulo: "NF 4521 (XML)", mime_type: "application/xml" }),
    ]);
  });

  it("sem arquivo, a nota fiscal não entra", async () => {
    const { registrarNotaFiscal } = await import("./pedidos-internos");
    const dados = new FormData();
    dados.set("pedido_interno_id", "77");
    const resultado = await registrarNotaFiscal({ ok: false }, dados);
    expect(resultado.ok).toBe(false);
    expect(inseridos.pedidos_internos_anexos).toBeUndefined();
  });

  it("o orçamento registrado com arquivo grava o documento e liga ao orçamento", async () => {
    statusDoPedido = "orcamentos";
    const { registrarOrcamento } = await import("./pedidos-internos");
    const dados = new FormData();
    dados.set("pedido_interno_id", "77");
    dados.set("fornecedor_nome", "Forlab");
    dados.set("valor_total", "6505.60");
    dados.set("arquivo", pdf("orcamento-65780.pdf"));

    expect(await registrarOrcamento({ ok: false }, dados)).toEqual({
      ok: true,
      message: "Orçamento de Forlab registrado, com o documento.",
    });
    expect(inseridos.pedidos_internos_anexos).toEqual([
      expect.objectContaining({ tipo: "proposta", titulo: "Orçamento: Forlab", etapa: "orcamentos" }),
    ]);
    expect(inseridos.pedidos_internos_cotacoes).toEqual([expect.objectContaining({ fornecedor_nome: "Forlab", anexo_id: 1 })]);
  });
});
