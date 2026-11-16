import { beforeEach, describe, expect, it, vi } from "vitest";

// Auditoria de 16/11, item 2: remover e salvar no pedido só dizem "feito"
// quando o banco devolve a linha gravada. Com RLS, zero linha volta sem erro.

const revalidatePath = vi.fn();
const pode = vi.fn();
let linhasGravadas: { id: number }[] | null;
let erroGravacao: { message: string } | null;
let pedidoLido: Record<string, unknown> | null;
const filtros: Array<[string, unknown]> = [];
const tabelasGravadas: string[] = [];

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/roles", () => ({
  temPapel: vi.fn(async () => true),
  usuarioAtual: vi.fn(async () => ({ id: "u1", nome: "Coordenador", email: "coord@example.com", papel: "coordenador" })),
}));
vi.mock("@/lib/auth/permissao-efetiva", () => ({ pode, temPermissao: vi.fn(async () => true) }));
vi.mock("./eventos", () => ({ registrarEvento: vi.fn() }));

function cliente() {
  const leitura = {
    eq: () => leitura,
    single: async () => ({ data: pedidoLido, error: null }),
    maybeSingle: async () => ({ data: pedidoLido, error: null }),
  };
  const gravacao = (tabela: string) => {
    tabelasGravadas.push(tabela);
    const cadeia = {
      eq: (coluna: string, valor: unknown) => {
        filtros.push([coluna, valor]);
        return cadeia;
      },
      select: async () => ({ data: erroGravacao ? null : linhasGravadas, error: erroGravacao }),
    };
    return cadeia;
  };
  return {
    from: (tabela: string) => ({
      select: () => leitura,
      update: () => gravacao(tabela),
      delete: () => gravacao(tabela),
    }),
    storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => cliente()),
  createClientUntyped: vi.fn(async () => cliente()),
}));

function form(campos: Record<string, string>) {
  const formData = new FormData();
  for (const [chave, valor] of Object.entries(campos)) formData.set(chave, valor);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  pode.mockResolvedValue(true);
  linhasGravadas = [{ id: 1 }];
  erroGravacao = null;
  pedidoLido = { status: "rascunho" };
  filtros.length = 0;
  tabelasGravadas.length = 0;
});

describe("remover item do pedido", () => {
  const campos = { item_id: "5", pedido_interno_id: "10" };

  it("diz que removeu quando o banco devolve a linha apagada", async () => {
    const { removerItemPedidoInterno } = await import("./pedidos-internos");
    const resultado = await removerItemPedidoInterno({ ok: false }, form(campos));
    expect(resultado).toEqual({ ok: true, message: "Item removido." });
    expect(filtros).toEqual([
      ["id", 5],
      ["pedido_interno_id", 10],
    ]);
  });

  it("não diz que removeu quando nenhuma linha saiu, e atualiza a tela", async () => {
    linhasGravadas = [];
    const { removerItemPedidoInterno } = await import("./pedidos-internos");
    const resultado = await removerItemPedidoInterno({ ok: false }, form(campos));
    expect(resultado.ok).toBe(false);
    expect(resultado.message).toContain("Nada foi removido");
    expect(revalidatePath).toHaveBeenCalledWith("/pedido/10");
  });
});

describe("remover documento do pedido", () => {
  const campos = { anexo_id: "8", pedido_interno_id: "10" };

  it("apaga só o documento do próprio pedido", async () => {
    pedidoLido = { storage_bucket: null, storage_path: null };
    const { removerAnexoPedidoInterno } = await import("./pedidos-internos");
    const resultado = await removerAnexoPedidoInterno({ ok: false }, form(campos));
    expect(resultado).toEqual({ ok: true, message: "Documento removido." });
    expect(tabelasGravadas).toEqual(["pedidos_internos_anexos"]);
    expect(filtros).toEqual([
      ["id", 8],
      ["pedido_interno_id", 10],
    ]);
  });

  it("não diz que removeu quando nenhuma linha saiu", async () => {
    pedidoLido = null;
    linhasGravadas = [];
    const { removerAnexoPedidoInterno } = await import("./pedidos-internos");
    const resultado = await removerAnexoPedidoInterno({ ok: false }, form(campos));
    expect(resultado.ok).toBe(false);
    expect(resultado.message).toContain("Nada foi removido");
  });
});

describe("remover orçamento do pedido", () => {
  const campos = { orcamento_id: "3", pedido_interno_id: "10" };

  it("diz que removeu quando o banco devolve a linha apagada", async () => {
    const { removerOrcamento } = await import("./pedidos-internos");
    expect(await removerOrcamento({ ok: false }, form(campos))).toEqual({ ok: true, message: "Orçamento removido." });
  });

  it("não diz que removeu o orçamento escolhido (o banco não apaga nenhuma linha)", async () => {
    linhasGravadas = [];
    const { removerOrcamento } = await import("./pedidos-internos");
    const resultado = await removerOrcamento({ ok: false }, form(campos));
    expect(resultado.ok).toBe(false);
    expect(resultado.message).toContain("Nada foi removido");
    expect(revalidatePath).toHaveBeenCalledWith("/pedido/10");
  });

  it("repassa o erro do banco", async () => {
    erroGravacao = { message: "permission denied for table pedidos_internos_cotacoes" };
    const { removerOrcamento } = await import("./pedidos-internos");
    const resultado = await removerOrcamento({ ok: false }, form(campos));
    expect(resultado.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
