import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createSignedUrl = vi.fn();
let anexo: unknown = null;
const filtros: Record<string, unknown> = {};
const cliente = {
  from: () => ({
    select: () => {
      const f = {
        eq: (coluna: string, valor: unknown) => {
          filtros[coluna] = valor;
          return f;
        },
        maybeSingle: async () => ({ data: anexo, error: null }),
      };
      return f;
    },
  }),
  storage: { from: () => ({ createSignedUrl }) },
};
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped: vi.fn(async () => cliente) }));

import { GET } from "./route";

function chamar(id: string, anexoId: string, busca = "") {
  return GET(new NextRequest(`https://kontrol.test/pedido/${id}/anexo/${anexoId}${busca}`), {
    params: Promise.resolve({ id, anexoId }),
  });
}

/** Relatório de 27/11/2026, bug 2: o link do arquivo nasce no clique. */
describe("abrir arquivo do pedido", () => {
  beforeEach(() => {
    createSignedUrl.mockReset().mockResolvedValue({ data: { signedUrl: "https://x.supabase.co/storage/v1/object/sign/a?token=t" }, error: null });
    anexo = { storage_bucket: "pedidos-internos-anexos", storage_path: "37/proposta.pdf", arquivo_nome: "proposta.pdf" };
    for (const chave of Object.keys(filtros)) delete filtros[chave];
  });

  it("gera um link novo, curto, a cada clique e redireciona", async () => {
    const resposta = await chamar("37", "2");
    expect(resposta.status).toBe(303);
    expect(resposta.headers.get("location")).toBe("https://x.supabase.co/storage/v1/object/sign/a?token=t");
    expect(resposta.headers.get("cache-control")).toBe("no-store");
    expect(createSignedUrl).toHaveBeenCalledWith("37/proposta.pdf", 120, undefined);
    expect(filtros).toEqual({ id: 2, pedido_interno_id: 37 });
  });

  it("documento de outro pedido, ou sem permissão, não abre", async () => {
    anexo = null;
    const resposta = await chamar("37", "9");
    expect(resposta.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("endereço inválido não consulta o banco", async () => {
    const resposta = await chamar("abc", "2");
    expect(resposta.status).toBe(404);
  });
});
