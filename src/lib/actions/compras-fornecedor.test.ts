import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Compra única na tela (auditoria de 16/11, item 10, proposta 2): o fornecedor
 * que o orçamento trouxe só pelo nome é definido no quadro "Compra" do pedido,
 * quando a compra já foi aprovada junto com o pedido (0170). A regra: enquanto
 * a compra está solicitada o fornecedor muda; depois disso só se preenche o que
 * ficou em branco, e só com a permissão "Aprovar compras".
 */

const revalidatePath = vi.fn();
const pode = vi.fn();
const from = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/roles", () => ({
  temPapel: vi.fn(async () => true),
  usuarioAtual: vi.fn(async () => ({ nome: "Compras", email: "compras@example.com", papel: "compra" })),
}));
vi.mock("@/lib/auth/permissao-efetiva", () => ({ pode, temPermissao: vi.fn(async () => true) }));
vi.mock("./eventos", () => ({ registrarEvento: vi.fn() }));
vi.mock("@/lib/costing/demanda", () => ({ computarDemandaPlano: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from })),
  createClientUntyped: vi.fn(async () => ({ from })),
}));

type Resposta = { data: { id: number }[] | null; error: { message: string; code?: string } | null };
type Gravacao = { valores: Record<string, unknown>; filtros: string[] };

let gravacoes: Gravacao[] = [];
let respostas: Resposta[] = [];

function permissoes(concedidas: string[]) {
  pode.mockImplementation(async (permissao: string) => concedidas.includes(permissao));
}

function formulario(campos: Record<string, string> = {}) {
  const formData = new FormData();
  for (const [chave, valor] of Object.entries({ pedido_id: "20", fornecedor_id: "7", ...campos })) formData.set(chave, valor);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  gravacoes = [];
  respostas = [];
  from.mockImplementation((tabela: string) => {
    if (tabela !== "pedidos_compra") throw new Error(`tabela inesperada: ${tabela}`);
    return {
      update: (valores: Record<string, unknown>) => {
        const gravacao: Gravacao = { valores, filtros: [] };
        gravacoes.push(gravacao);
        const cadeia = {
          eq: (coluna: string, valor: unknown) => {
            gravacao.filtros.push(`${coluna}=${String(valor)}`);
            return cadeia;
          },
          is: (coluna: string, valor: unknown) => {
            gravacao.filtros.push(`${coluna} is ${String(valor)}`);
            return cadeia;
          },
          in: (coluna: string, valores: unknown[]) => {
            gravacao.filtros.push(`${coluna} in ${valores.join(",")}`);
            return cadeia;
          },
          select: async () => respostas.shift() ?? { data: [], error: null },
        };
        return cadeia;
      },
    };
  });
});

describe("definirFornecedorCompra", () => {
  it("compra solicitada: grava o fornecedor e atualiza a tela do pedido que mandou o formulário", async () => {
    permissoes(["compras.solicitar"]);
    respostas = [{ data: [{ id: 20 }], error: null }];
    const { definirFornecedorCompra } = await import("./compras");
    const resultado = await definirFornecedorCompra({ ok: false, message: "" }, formulario({ pedido_interno_id: "504" }));
    expect(resultado).toEqual({ ok: true, message: "Fornecedor definido." });
    expect(gravacoes).toEqual([{ valores: { fornecedor_id: 7 }, filtros: ["id=20", "status=solicitado"] }]);
    expect(revalidatePath).toHaveBeenCalledWith("/pedido/504");
    expect(revalidatePath).toHaveBeenCalledWith("/compras/20");
    expect(revalidatePath).toHaveBeenCalledWith("/compras/20/imprimir");
  });

  it("compra já aprovada e sem fornecedor: quem aprova compras preenche o que ficou em branco", async () => {
    permissoes(["compras.aprovar"]);
    respostas = [
      { data: [], error: null },
      { data: [{ id: 20 }], error: null },
    ];
    const { definirFornecedorCompra } = await import("./compras");
    const resultado = await definirFornecedorCompra({ ok: false, message: "" }, formulario());
    expect(resultado.ok).toBe(true);
    expect(gravacoes).toHaveLength(2);
    // a segunda gravação nunca troca um fornecedor que já existe nem mexe em compra encerrada
    expect(gravacoes[1]).toEqual({
      valores: { fornecedor_id: 7 },
      filtros: ["id=20", "fornecedor_id is null", "status in aprovado,enviado,em_transito"],
    });
    // sem o pedido no formulário (tela da compra sem pedido), só as telas da compra são atualizadas
    expect(revalidatePath).not.toHaveBeenCalledWith(expect.stringMatching(/^\/pedido\//));
  });

  it("compra já aprovada e com fornecedor: não troca e diz por quê", async () => {
    permissoes(["compras.solicitar", "compras.aprovar"]);
    const { definirFornecedorCompra } = await import("./compras");
    const resultado = await definirFornecedorCompra({ ok: false, message: "" }, formulario());
    expect(resultado).toEqual({
      ok: false,
      message: "O fornecedor só muda enquanto a compra está solicitada. Depois disso só é possível preencher o que ficou em branco.",
    });
    expect(gravacoes).toHaveLength(2);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sem a permissão de aprovar compras: não tenta preencher a compra já aprovada", async () => {
    permissoes(["compras.solicitar"]);
    const { definirFornecedorCompra } = await import("./compras");
    const resultado = await definirFornecedorCompra({ ok: false, message: "" }, formulario());
    expect(resultado).toEqual({ ok: false, message: "Só é possível definir o fornecedor enquanto a compra está solicitada." });
    expect(gravacoes).toHaveLength(1);
  });

  it("sem permissão nenhuma, ou sem compra e fornecedor, nem chega ao banco", async () => {
    const { definirFornecedorCompra } = await import("./compras");
    permissoes([]);
    expect((await definirFornecedorCompra({ ok: false, message: "" }, formulario())).ok).toBe(false);
    permissoes(["compras.aprovar"]);
    expect(await definirFornecedorCompra({ ok: false, message: "" }, formulario({ fornecedor_id: "" }))).toEqual({
      ok: false,
      message: "Escolha o fornecedor.",
    });
    expect(await definirFornecedorCompra({ ok: false, message: "" }, formulario({ pedido_id: "" }))).toEqual({
      ok: false,
      message: "Compra não informada.",
    });
    expect(gravacoes).toHaveLength(0);
  });

  it("a recusa do banco volta como mensagem, sem dar a gravação por feita", async () => {
    permissoes(["compras.aprovar"]);
    respostas = [{ data: null, error: { message: "new row violates row-level security policy", code: "42501" } }];
    const { definirFornecedorCompra } = await import("./compras");
    const resultado = await definirFornecedorCompra({ ok: false, message: "" }, formulario());
    expect(resultado.ok).toBe(false);
    expect(resultado.message).toBeTruthy();
    expect(gravacoes).toHaveLength(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
