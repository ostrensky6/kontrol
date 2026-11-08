import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registrarEquivalenciaContextual, revogarEquivalenciaContextual } from "./equivalencia-contextual";

const { createClientUntyped, rpc } = vi.hoisted(() => ({
  createClientUntyped: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped }));

const inicial = { ok: false };
const versao = "equivalencia-contextual-v1";
const flag = "KONTROL_EQUIVALENCIA_ESCRITA";
const ref = "equivalencia:81";
const validada = { decisao_ref: ref, estado: "validada" };
const revogada = { decisao_ref: ref, estado: "revogada" };

function formRegistro() {
  const form = new FormData();
  for (const [campo, valor] of Object.entries({
    versao, codigo_analise: " A1 ", metodo_revisao_ref: "metodo:M1:r2",
    necessidade_id: "11", etapa_id: "", insumo_id: "91", equipamento_id: "",
    apresentacao_ref: "apresentacao:91:r1", unidade_estoque: "frasco", unidade_consumo: "reação",
    fator_conversao: "100,5", evidencia_ref: "laudo:r3", vigente_ate: "", confirmada: "sim",
  })) form.set(campo, valor);
  return form;
}

function formRevogacao() {
  const form = new FormData();
  form.set("versao", versao);
  form.set("decisao_ref", ref);
  form.set("motivo", " Atualização do método. ");
  return form;
}

beforeEach(() => {
  vi.stubEnv(flag, "1");
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-07T12:00:00Z") });
  rpc.mockReset();
  createClientUntyped.mockReset().mockResolvedValue({ rpc });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("actions de validação contextual da ficha", () => {
  it.each([undefined, "", "0", "true"])("sem opt-in literal (%s), não abre sessão nem chama RPC", async (valor) => {
    vi.stubEnv(flag, valor);
    const form = formRegistro();
    form.set(flag, "1");
    await expect(registrarEquivalenciaContextual(inicial, form)).resolves.toMatchObject({ ok: false, motivo: "desabilitada" });
    await expect(revogarEquivalenciaContextual(inicial, formRevogacao())).resolves.toMatchObject({ ok: false, motivo: "desabilitada" });
    expect(createClientUntyped).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("registra pela sessão com a assinatura exata, nulos explícitos e sem papel ou ator enviados", async () => {
    const form = formRegistro();
    form.set("papel", "supervisor");
    form.set("ator_id", "falsificado");
    form.set("$ACTION_ID_mock", "metadado");
    rpc.mockResolvedValue({ data: validada, error: null });

    await expect(registrarEquivalenciaContextual(inicial, form)).resolves.toMatchObject({ ok: true, recibo: validada });
    expect(createClientUntyped).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls).toEqual([["registrar_equivalencia_contextual_v1", {
      p_codigo: "A1", p_metodo_revisao_ref: "metodo:M1:r2",
      p_contexto: {
        necessidade_id: 11, etapa_id: null, insumo_id: 91, equipamento_id: null,
        apresentacao_ref: "apresentacao:91:r1", unidade_estoque: "frasco", unidade_consumo: "reação",
        fator_conversao: 100.5, evidencia_ref: "laudo:r3", vigente_ate: null, confirmada: true,
      },
    }]]);
  });

  it("preserva IDs reais e converte vigência com fuso explícito para ISO UTC", async () => {
    const form = formRegistro();
    form.set("etapa_id", "21");
    form.set("equipamento_id", "31");
    form.set("vigente_ate", "2026-11-08T14:30:00-03:00");
    rpc.mockResolvedValue({ data: validada, error: null });
    await expect(registrarEquivalenciaContextual(inicial, form)).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("registrar_equivalencia_contextual_v1", expect.objectContaining({
      p_contexto: expect.objectContaining({ etapa_id: 21, equipamento_id: 31, vigente_ate: "2026-11-08T17:30:00.000Z" }),
    }));
  });

  it.each([
    ["versao", "equivalencia-contextual-v2"], ["codigo_analise", " "], ["metodo_revisao_ref", ""],
    ["necessidade_id", "9007199254740992"], ["insumo_id", "0"], ["etapa_id", undefined],
    ["equipamento_id", undefined], ["equipamento_id", "-1"], ["apresentacao_ref", ""],
    ["unidade_estoque", ""], ["unidade_consumo", ""], ["fator_conversao", "0"],
    ["fator_conversao", "Infinity"], ["fator_conversao", "NaN"], ["fator_conversao", "1e999"],
    ["evidencia_ref", " "], ["confirmada", undefined], ["confirmada", "true"], ["vigente_ate", undefined],
    ["vigente_ate", "2026-11-07T10:00:00Z"], ["vigente_ate", "2026-11-08T14:30"],
  ])("não chama RPC com registro inválido em %s (%s)", async (campo, valor) => {
    const form = formRegistro();
    if (valor === undefined) form.delete(campo);
    else form.set(campo, valor);
    await expect(registrarEquivalenciaContextual(inicial, form)).resolves.toMatchObject({
      ok: false, motivo: "entrada_invalida", errors: { [campo]: expect.any(String) },
    });
    expect(createClientUntyped).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("não usa um valor arbitrário quando o formulário repete um campo", async () => {
    const form = formRegistro();
    form.append("necessidade_id", "12");
    await expect(registrarEquivalenciaContextual(inicial, form)).resolves.toMatchObject({ ok: false, motivo: "entrada_invalida" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("revoga pela referência selecionada e confirma o recibo da mesma decisão", async () => {
    rpc.mockResolvedValue({ data: revogada, error: null });
    await expect(revogarEquivalenciaContextual(inicial, formRevogacao())).resolves.toMatchObject({ ok: true, recibo: revogada });
    expect(rpc.mock.calls).toEqual([["revogar_equivalencia_contextual_v1", {
      p_decisao_id: 81, p_motivo: "Atualização do método.",
    }]]);
  });

  it.each([["decisao_ref", "equivalencia:0"], ["decisao_ref", "equivalencia:9007199254740992"], ["motivo", " "]])(
    "nega revogação inválida em %s (%s) antes da RPC", async (campo, valor) => {
      const form = formRevogacao();
      form.set(campo, valor);
      await expect(revogarEquivalenciaContextual(inicial, form)).resolves.toMatchObject({ ok: false, motivo: "entrada_invalida" });
      expect(createClientUntyped).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["42501", "negada", "não permite"], ["23505", "conflito", "Já existe"], ["55P03", "conflito", "Outra operação"],
    ["22023", "entrada_invalida", "não confirmou"], ["XX000", "resultado_indeterminado", "Atualize a ficha"],
  ])("mapeia a recusa %s do banco sem sucesso falso nem detalhe técnico", async (code, motivo, trecho) => {
    rpc.mockResolvedValue({ data: validada, error: { code, message: "detalhe privado" } });
    const resultado = await registrarEquivalenciaContextual(inicial, formRegistro());
    expect(resultado).toMatchObject({ ok: false, motivo, message: expect.stringContaining(trecho) });
    expect(resultado.message).not.toContain("detalhe privado");
    expect(resultado).not.toHaveProperty("recibo");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("não anuncia nova revogação quando o banco retorna conflito de estado", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000" } });
    await expect(revogarEquivalenciaContextual(inicial, formRevogacao())).resolves.toMatchObject({ ok: false, motivo: "conflito" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([null, {}, { ...validada, estado: "revogada" }, { ...validada, decisao_ref: "incorreta" }])(
    "não aceita recibo de registro ausente, incompleto ou incoerente (%j)", async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      await expect(registrarEquivalenciaContextual(inicial, formRegistro())).resolves.toMatchObject({
        ok: false, motivo: "resultado_indeterminado",
      });
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  it("não confirma revogação com recibo de outro ID e não repete após falha de transporte", async () => {
    rpc.mockResolvedValueOnce({ data: { ...revogada, decisao_ref: "equivalencia:82" }, error: null });
    await expect(revogarEquivalenciaContextual(inicial, formRevogacao())).resolves.toMatchObject({ ok: false, motivo: "resultado_indeterminado" });
    rpc.mockRejectedValueOnce(new Error("falha de transporte"));
    await expect(revogarEquivalenciaContextual(inicial, formRevogacao())).resolves.toMatchObject({ ok: false, motivo: "resultado_indeterminado" });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
