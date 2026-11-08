import { beforeEach, describe, expect, it, vi } from "vitest";
import { revisarOrcamentoLaboratorio } from "./orcamentos";

const { rpc, from, update, confirmacao, filtro, permissao, recusa, integridade, revalidatePath, calcularTodas } = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), update: vi.fn(), confirmacao: vi.fn(), filtro: vi.fn(), permissao: vi.fn(),
  recusa: vi.fn(), integridade: vi.fn(), revalidatePath: vi.fn(), calcularTodas: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from, rpc }) }));
vi.mock("@/lib/auth/permissao-efetiva", () => ({ temPermissao: permissao }));
vi.mock("@/lib/orcamento/permissao-acao", () => ({ recusaSemPermissao: recusa }));
vi.mock("@/lib/orcamento/snapshot-equivalencia-transporte", () => ({ validarTransporteCapturaEquivalencia: integridade }));
vi.mock("@/lib/costing/loader", () => ({ calcularTodas }));
vi.mock("next/cache", () => ({ revalidatePath }));
const anterior = { id: 7, status: "rascunho", status_operacional: "preenchido", responsavel: null as string | null, fonte_custo_insumos: "custo_medio_ponderado",
  custo_snapshot: { versao: "equivalencia-economica-v1", operacao_id: "congelada" } };
const itens = [{ id: 3, codigo_analise: "A1", n_amostras: 17, custo_unitario: 2.345 / 17,
  preco_unitario: 4.69 / 17, valor_snapshot: { versao: "equivalencia-economica-v1", metodo_revisao_ref: "M1" } }];
const selectOrcamento = vi.fn(); const selectItens = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); anterior.status = "rascunho"; anterior.status_operacional = "preenchido"; anterior.responsavel = null;
  recusa.mockResolvedValue(null); permissao.mockResolvedValue(true);
  // Integridade matemática já gateada173; aqui prova-se a delegação e seu bloqueio.
  integridade.mockReturnValue({ estado: "equivalencia" });
  rpc.mockResolvedValue({ data: { status_origem: "rascunho", status_destino: "enviado", alterado: true }, error: null });
  confirmacao.mockResolvedValue({ data: [{ id: 7 }], error: null });
  const q = { eq: filtro, select: confirmacao, then: (resolve: (v: unknown) => unknown) => resolve({ error: null }) };
  filtro.mockReturnValue(q); update.mockReturnValue(q);
  selectOrcamento.mockReturnValue({ eq: () => ({ single: async () => ({ data: anterior, error: null }) }) });
  selectItens.mockReturnValue({ eq: async () => ({ data: itens, error: null }) });
  from.mockImplementation((t: string) => {
    if (t === "orcamentos") return { select: selectOrcamento, update };
    if (t === "orcamento_itens") return { select: selectItens };
    throw new Error(`Tabela inesperada: ${t}`);
  });
});
function revisar(responsavel = "Responsável sintético") {
  const f = new FormData(); f.set("orcamento_id", "7"); f.set("responsavel", responsavel);
  return revisarOrcamentoLaboratorio({ ok: false }, f);
}

describe("ORD175 revisão interna canônica capturada — somente mocks", () => {
  it("confere captura, autoriza e confirma somente três metadados após RPC enviado", async () => {
    const antes = structuredClone({ anterior, itens });
    expect(await revisar()).toMatchObject({ ok: true });
    expect(recusa).toHaveBeenCalledWith("revisar_modulo");
    expect(permissao).toHaveBeenCalledWith("orcamentos.criar_editar");
    expect(integridade).toHaveBeenCalledWith({ ...anterior, orcamento_itens: itens });
    expect(selectOrcamento.mock.calls[0][0]).toContain("custo_snapshot");
    expect(selectItens.mock.calls[0][0]).toContain("valor_snapshot");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("transicionar_orcamento", {
      p_orcamento_id: 7, p_status_destino: "enviado", p_observacao: "Revisão do módulo laboratorial.",
    });
    expect(Object.keys(update.mock.calls[0][0]).sort()).toEqual(["responsavel", "status_operacional", "status_operacional_atualizado_em"]);
    expect(update.mock.calls[0][0]).toMatchObject({ responsavel: "Responsável sintético", status_operacional: "revisado" });
    expect(confirmacao).toHaveBeenCalledWith("id");
    expect(filtro).toHaveBeenCalledWith("status", "enviado");
    expect({ anterior, itens }).toEqual(antes); expect(calcularTodas).not.toHaveBeenCalled();
  });
  it.each(["revisar", "editar", "responsavel", "snapshot", "cancelado"])("recusa %s antes de mutar", async (caso) => {
    if (caso === "revisar") recusa.mockResolvedValue({ ok: false, message: "Negado" });
    if (caso === "editar") permissao.mockResolvedValue(false);
    if (caso === "snapshot") integridade.mockReturnValue({ estado: "invalido", message: "Snapshot inválido" });
    if (caso === "cancelado") anterior.status = "cancelado";
    expect(await revisar(caso === "responsavel" ? "" : "Pessoa")).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("falha RPC não grava metadados", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Transição recusada" } });
    expect(await revisar()).toMatchObject({ ok: false }); expect(update).not.toHaveBeenCalled();
  });
  it("resposta RPC indeterminada não presume status confirmado", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await revisar()).toMatchObject({ ok: false }); expect(update).not.toHaveBeenCalled();
  });
  it.each(["erro", "zero", "outra_linha"])("metadados %s: parcial explícito e retry não repete transição", async (caso) => {
    confirmacao.mockResolvedValueOnce({ data: caso === "outra_linha" ? [{ id: 99 }] : [], error: caso === "erro" ? { message: "negado" } : null });
    expect(await revisar()).toMatchObject({ ok: false, message: expect.stringMatching(/metadados.*não confirmados/i) });
    expect(revalidatePath).not.toHaveBeenCalled();
    anterior.status = "enviado";
    expect(await revisar()).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(2);
  });
  it("retomada enviada completa metadados sem novo evento de transição", async () => {
    anterior.status = "enviado";
    expect(await revisar()).toMatchObject({ ok: true, message: expect.not.stringMatching(/já pode ser emitida/) });
    expect(rpc).not.toHaveBeenCalled(); expect(confirmacao).toHaveBeenCalledTimes(1);
  });
  it("legado preserva RPC canônica e confirma a linha, sem nova exigência de captura", async () => {
    integridade.mockReturnValue({ estado: "legado" });
    expect(await revisar()).toMatchObject({ ok: true }); expect(rpc).toHaveBeenCalledTimes(1);
    expect(permissao).not.toHaveBeenCalled(); expect(confirmacao).toHaveBeenCalledTimes(1);
  });
  it("resposta perdida de metadados é parcial explícito, sem refresh de sucesso", async () => {
    confirmacao.mockRejectedValueOnce(new Error("transporte interrompido"));
    expect(await revisar()).toMatchObject({ ok: false, message: expect.stringMatching(/metadados.*não confirmados/i) });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("resposta perdida da RPC não é seguida por update", async () => {
    rpc.mockRejectedValueOnce(new Error("transporte interrompido"));
    expect(await revisar()).toMatchObject({ ok: false, message: expect.stringMatching(/não confirmado/) });
    expect(update).not.toHaveBeenCalled();
  });
  it.each(["Responsável sintético", "Outra pessoa"])("revisão já completa: não duplica gravação para %s", async (responsavel) => {
    anterior.status = "enviado"; anterior.status_operacional = "revisado"; anterior.responsavel = "Responsável sintético";
    expect(await revisar(responsavel)).toMatchObject({ ok: responsavel === anterior.responsavel });
    expect(rpc).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });
});
