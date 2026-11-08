import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotificacoesPage from "./page";

const io = vi.hoisted(() => ({
  cliente: vi.fn(), from: vi.fn(), select: vi.fn(), neq: vi.fn(), order: vi.fn(), limit: vi.fn(), rpc: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: io.cliente, createClientUntyped: io.cliente }));
vi.mock("@/lib/actions/notificacoes", () => ({
  marcarNotificacaoLida: vi.fn(), marcarTodasNotificacoesLidas: vi.fn(), arquivarNotificacao: vi.fn(),
}));
vi.mock("@/components/common/HelpTip", () => ({ HelpTip: ({ children }: { children: React.ReactNode }) => children }));

function aviso(id: number, status = "nao_lida") {
  return {
    id, status, tipo: "reposicao", titulo: `Aviso sintético ${id}`, corpo: "Reposição registrada no app.",
    entidade_tipo: "pedido_compra", entidade_id: id, papel_destino: null, permissao_destino: null,
    usuario_destino: "destinatario-app-nao-exposto", criado_em: "2026-11-07T12:00:00Z",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  io.cliente.mockResolvedValue({ from: io.from, rpc: io.rpc });
  io.from.mockReturnValue({ select: io.select });
  io.select.mockReturnValue({ neq: io.neq });
  io.neq.mockReturnValue({ order: io.order });
  io.order.mockReturnValue({ limit: io.limit });
  io.limit.mockResolvedValue({ data: [aviso(1), aviso(2, "lida")], error: null });
  io.rpc.mockResolvedValue({ data: [], error: null });
});

async function render() {
  return renderToStaticMarkup(await NotificacoesPage());
}
function cartoes(html: string) {
  return [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)].map(([cartao]) => cartao);
}

describe("estado de e-mail no consumidor /notificacoes", () => {
  it("consulta um único lote de até 80 IDs visíveis e mantém a consulta da lista", async () => {
    io.limit.mockResolvedValue({ data: Array.from({ length: 81 }, (_, i) => aviso(i + 1)), error: null });
    const html = await render();
    expect(io.cliente).toHaveBeenCalledOnce();
    expect(io.from.mock.calls).toEqual([["v_minhas_notificacoes"]]);
    expect(io.neq).toHaveBeenCalledWith("status", "arquivada");
    expect(io.order).toHaveBeenCalledWith("criado_em", { ascending: false });
    expect(io.limit).toHaveBeenCalledWith(80);
    expect(io.rpc.mock.calls).toEqual([["meus_estados_email_operacional_v1", {
      p_notificacao_ids: Array.from({ length: 80 }, (_, i) => i + 1),
    }]]);
    expect(cartoes(html)).toHaveLength(80);
    expect(html).not.toContain("Aviso sintético 81");
  });

  it("não chama a RPC em lista vazia", async () => {
    io.limit.mockResolvedValue({ data: [], error: null });
    expect(await render()).toContain("Nenhuma notificação para você.");
    expect(io.rpc).not.toHaveBeenCalled();
  });

  it("mostra só a enum autorizada do próprio ID, sem conteúdo ou metadados do e-mail", async () => {
    io.rpc.mockResolvedValue({ data: [
      { notificacao_id: 1, estado: "ACEITE_REGISTRADO", payload: "PAYLOAD-SECRETO", recipient: "privado@example.test", provider_id: "PROVEDOR-SECRETO" },
      { notificacao_id: 2, estado: "ENTREGUE" },
      { notificacao_id: 999, estado: "RECUSA_CONFIRMADA" },
      { notificacao_id: "2", estado: "ACEITE_REGISTRADO" },
      null,
    ], error: null });
    const html = await render();
    const [um, dois] = cartoes(html);
    expect(um).toContain("Aceite registrado");
    expect(um).toContain("não lida");
    expect(dois).toContain("Estado não informado");
    expect(dois).not.toContain("Aceite registrado");
    expect(um).toContain('href="/compras/1"');
    expect(html).toContain("Marcar todas como lidas");
    expect(html).toContain("Marcar como lida: Aviso sintético 1");
    expect(html).toContain("Arquivar: Aviso sintético 2");
    expect(html).toContain("não confirma a entrega");
    expect(html).not.toMatch(/ENTREGUE|Recusa confirmada|PAYLOAD-SECRETO|privado@example\.test|PROVEDOR-SECRETO|destinatario-app-nao-exposto|>Reenviar</i);
  });

  it("distingue os outros estados explícitos de ausência e não infere envio", async () => {
    const estados = [
      ["NAO_CONFIGURADO", "Não configurado"],
      ["ACEITO_MARCADOR_PENDENTE", "Aceite comprovado; registro pendente"],
      ["INCERTO", "Aceite não confirmado"],
      ["REVISAO_NECESSARIA", "Revisão necessária"],
      ["RECUSA_CONFIRMADA", "Recusa confirmada"],
      ["PENDENTE", "Pendente"],
    ];
    io.limit.mockResolvedValue({ data: estados.map((_, index) => aviso(index + 1)), error: null });
    io.rpc.mockResolvedValue({ data: estados.map(([estado], index) => ({ notificacao_id: index + 1, estado })), error: null });
    cartoes(await render()).forEach((cartao, index) => {
      expect(cartao).toContain(estados[index][1]);
      expect(cartao).not.toContain("Estado não informado");
    });
  });

  it("não confirma estado quando a mesma notificação tem estados conflitantes", async () => {
    io.rpc.mockResolvedValue({ data: [
      { notificacao_id: 1, estado: "ACEITE_REGISTRADO" },
      { notificacao_id: 1, estado: "INCERTO" },
      { notificacao_id: 1, estado: "ACEITE_REGISTRADO" },
    ], error: null });
    const [um] = cartoes(await render());
    expect(um).toContain("Estado não informado");
    expect(um).not.toContain("Aceite registrado");
  });

  it.each([
    { data: [{ notificacao_id: 1, estado: "ACEITE_REGISTRADO" }], error: { code: "PGRST202" } },
    { data: null, error: null },
    { data: { notificacao_id: 1, estado: "ACEITE_REGISTRADO" }, error: null },
  ])("preserva alertas quando o lote está indisponível: %j", async (resposta) => {
    io.rpc.mockResolvedValue(resposta);
    const html = await render();
    expect(cartoes(html)).toHaveLength(2);
    expect(html).toContain("Reposição registrada no app.");
    expect(html).toContain("Estado indisponível");
    expect(html).not.toContain("Aceite registrado");
    expect(html).not.toContain("Nenhuma notificação para você.");
  });

  it("falha isolada de transporte não apaga o aviso nem suas ações", async () => {
    io.rpc.mockRejectedValue(new Error("falha sintética de transporte"));
    const html = await render();
    expect(html).toContain("Estado indisponível");
    expect(html).toContain("Aviso sintético 1");
    expect(html).toContain("Arquivar: Aviso sintético 1");
  });
});
