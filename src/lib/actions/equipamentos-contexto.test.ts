import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consultarContextoConfiguracaoAvisoEquipamento as consultarContexto,
  consultarDireitoAvisoEquipamento as consultarDireito,
  type ConsultaContextoAvisoEquipamento,
} from "./equipamentos-contexto";

const io = vi.hoisted(() => ({ cliente: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped: io.cliente }));
const ator = "00000000-0000-4000-8000-000000000001";
const segundo = "00000000-0000-4000-8000-000000000002";
const entrada: ConsultaContextoAvisoEquipamento = {
  p_unidade_id: 12, p_tipo: "calibracao", p_origem_apos: null, p_responsavel_apos: null, p_limite: 2,
};
const gov = { p_papel: "laboratorio", p_operacao: "configurar" } as const;
const permissoes = { configurar: true, avaliar: false, reconhecer: false, encaminhar: false, governar: false };
const origem = { id: 30, tipo: "calibracao", status: "agendada", proxima_data: "2028-02-29" };
const vazio = () => ({
  estado: "confirmado", equipamento_unidade_id: 12, tipo: "calibracao", permissoes,
  regra: { estado: "confirmada", dado: null }, versao_esperada: 0,
  origens: { itens: [], proximo_apos: null }, responsaveis: { itens: [], proximo_apos: null },
});
const direito = (concedido = false) => ({
  estado: "confirmado", papel: "laboratorio", operacao: "configurar",
  pode_governar: true, concessao_esperada: concedido,
});
const resposta = (data: unknown) => ({ data, error: null });
beforeEach(() => {
  vi.resetAllMocks();
  io.cliente.mockResolvedValue({ auth: { getUser: io.getUser }, rpc: io.rpc, from: io.from });
  io.getUser.mockResolvedValue(resposta({ user: { id: ator, is_anonymous: false } }));
  io.rpc.mockResolvedValue(resposta(vazio()));
});

describe("ORD140 — leitura tipada de contexto 0158", () => {
  it("consulta exclusivamente a RPC com a sessão e cursores explícitos", async () => {
    expect(await consultarContexto(entrada)).toEqual({ ok: true, dados: vazio() });
    expect(io.getUser).toHaveBeenCalledOnce();
    expect(io.rpc.mock.calls).toEqual([["contexto_configuracao_aviso_equipamento", entrada]]);
    expect(io.from).not.toHaveBeenCalled();
  });

  it.each([
    null, {}, { ...entrada, p_limite: undefined }, { ...entrada, p_origem_apos: undefined },
    { ...entrada, p_responsavel_apos: undefined }, { ...entrada, p_unidade_id: "12" },
    { ...entrada, p_unidade_id: 0 }, { ...entrada, p_unidade_id: Number.MAX_SAFE_INTEGER + 1 },
    { ...entrada, p_tipo: "inventado" }, { ...entrada, p_limite: 0 }, { ...entrada, p_limite: 101 },
    { ...entrada, p_limite: 1.5 }, { ...entrada, p_origem_apos: 0 },
    { ...entrada, p_responsavel_apos: "inválido" }, { ...entrada, pode_configurar: true },
  ])("rejeita entrada não canônica antes de criar cliente: %j", async (value) => {
    expect(await consultarContexto(value as ConsultaContextoAvisoEquipamento))
      .toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(io.cliente).not.toHaveBeenCalled();
  });

  it.each([null, { id: "inválido" }, { id: ator, is_anonymous: true }])("não consulta com usuário inválido: %j", async (user) => {
    io.getUser.mockResolvedValue(resposta({ user }));
    expect(await consultarContexto(entrada)).toMatchObject({ ok: false, codigo: "SESSAO_INVALIDA" });
    expect(await consultarDireito(gov)).toMatchObject({ ok: false, codigo: "SESSAO_INVALIDA" });
    expect(io.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ name: "AuthRetryableFetchError", status: 0 }, "INDISPONIVEL"],
    [{ status: 500 }, "INDISPONIVEL"], [{ status: 429 }, "INDISPONIVEL"], [{ status: 401 }, "SESSAO_INVALIDA"],
  ])("diferencia Auth indisponível de sessão recusada: %j", async (error, codigo) => {
    io.getUser.mockResolvedValue({ data: { user: { id: ator } }, error });
    expect(await consultarContexto(entrada)).toMatchObject({ ok: false, codigo });
    expect(io.rpc).not.toHaveBeenCalled();
  });

  it.each([["42501", "SEM_ACESSO"], ["22023", "ENTRADA_INVALIDA"], ["PGRST202", "INDISPONIVEL"]])(
    "não converte erro %s em vazio ou concessão false", async (code, codigo) => {
      io.rpc.mockResolvedValue({ data: direito(false), error: { code, message: "SEGREDO", details: "SEGREDO" } });
      for (const result of [await consultarContexto(entrada), await consultarDireito(gov)]) {
        expect(result).toMatchObject({ ok: false, codigo });
        expect(result).not.toHaveProperty("dados");
        expect(JSON.stringify(result)).not.toContain("SEGREDO");
      }
      expect(io.rpc).toHaveBeenCalledTimes(2);
    },
  );

  it("não faz retry/fallback depois de falha de transporte", async () => {
    io.rpc.mockRejectedValue(new Error("SEGREDO"));
    expect(await consultarContexto(entrada)).toMatchObject({ ok: false, codigo: "INDISPONIVEL" });
    expect(io.rpc).toHaveBeenCalledOnce();
    expect(io.from).not.toHaveBeenCalled();
  });

  it.each([
    { regra: { estado: "indisponivel" }, versao_esperada: null },
    { regra: { estado: "confirmada", dado: { id: ator, versao: 7 } }, versao_esperada: 7 },
  ])("página vazia preserva CAS e estado real: %j", async (delta) => {
    const data = { ...vazio(), ...delta };
    io.rpc.mockResolvedValue(resposta(data));
    expect(await consultarContexto({ ...entrada, p_origem_apos: 99 })).toEqual({ ok: true, dados: data });
  });

  it.each([
    null, [], {}, { ...vazio(), versao_esperada: null },
    { ...vazio(), regra: { estado: "indisponivel" }, versao_esperada: 0 },
    { ...vazio(), regra: { estado: "confirmada", dado: { id: ator, versao: 7 } }, versao_esperada: 6 },
    { ...vazio(), regra: { estado: "confirmada", dado: { id: ator, versao: 0 } } },
    { ...vazio(), regra: { estado: "indisponivel", dado: null }, versao_esperada: null },
    { ...vazio(), equipamento_unidade_id: 13 }, { ...vazio(), tipo: "preventiva" },
    { ...vazio(), permissoes: { ...permissoes, configurar: false } },
    { ...vazio(), permissoes: { ...permissoes, governar: "false" } },
    { ...vazio(), segredo: "não projetar" },
  ])("não confirma DTO ausente, divergente ou ampliado: %j", async (data) => {
    io.rpc.mockResolvedValue(resposta(data));
    expect(await consultarContexto(entrada)).toMatchObject({ ok: false, codigo: "RESPOSTA_INVALIDA" });
  });

  it("preserva candidatos, nomes nulos e paginação, sem criar rótulos", async () => {
    const data = {
      ...vazio(),
      origens: { itens: [origem, { ...origem, id: 31 }], proximo_apos: 31 },
      responsaveis: { itens: [{ id: ator, nome: null }, { id: segundo, nome: "Mesmo nome" }], proximo_apos: segundo },
    };
    io.rpc.mockResolvedValue(resposta(data));
    expect(await consultarContexto(entrada)).toEqual({ ok: true, dados: data });
    io.rpc.mockResolvedValue(resposta(vazio()));
    const next = { ...entrada, p_origem_apos: 31, p_responsavel_apos: segundo };
    expect(await consultarContexto(next)).toEqual({ ok: true, dados: vazio() });
    expect(io.rpc).toHaveBeenLastCalledWith("contexto_configuracao_aviso_equipamento", next);
  });

  it.each([
    { itens: [origem, origem], proximo_apos: null },
    { itens: [{ ...origem, id: 31 }, origem], proximo_apos: null },
    { itens: [origem, { ...origem, id: 31 }, { ...origem, id: 32 }], proximo_apos: null },
    { itens: [], proximo_apos: 30 }, { itens: [origem], proximo_apos: 30 },
    { itens: [origem, { ...origem, id: 31 }], proximo_apos: 32 },
    { itens: [{ ...origem, tipo: "preventiva" }], proximo_apos: null },
    { itens: [{ ...origem, status: "cancelada" }], proximo_apos: null },
    { itens: [{ ...origem, proxima_data: null }], proximo_apos: null },
    { itens: [{ ...origem, proxima_data: "2027-02-29" }], proximo_apos: null },
    { itens: [{ ...origem, proxima_data: "0000-01-01" }], proximo_apos: null },
  ])("rejeita página de origens incoerente: %j", async (origens) => {
    io.rpc.mockResolvedValue(resposta({ ...vazio(), origens }));
    expect(await consultarContexto(entrada)).toMatchObject({ ok: false, codigo: "RESPOSTA_INVALIDA" });
  });

  it("rejeita IDs fora do cursor e informação privada no responsável", async () => {
    for (const data of [
      { ...vazio(), origens: { itens: [origem], proximo_apos: null } },
      { ...vazio(), responsaveis: { itens: [{ id: ator, nome: null }], proximo_apos: null } },
      { ...vazio(), responsaveis: { itens: [{ id: segundo, nome: null, email: "privado" }], proximo_apos: null } },
    ]) {
      io.rpc.mockResolvedValue(resposta(data));
      expect(await consultarContexto({ ...entrada, p_origem_apos: 30, p_responsavel_apos: ator }))
        .toMatchObject({ ok: false, codigo: "RESPOSTA_INVALIDA" });
    }
  });

  it.each([false, true])("confirma concessão atual %s sem inferir hierarquia", async (concedido) => {
    io.rpc.mockResolvedValue(resposta(direito(concedido)));
    expect(await consultarDireito(gov)).toEqual({ ok: true, dados: direito(concedido) });
    expect(io.rpc.mock.calls).toEqual([["consultar_direito_aviso_equipamento", gov]]);
    expect(io.from).not.toHaveBeenCalled();
  });

  it.each([
    null, {}, { ...gov, p_papel: "inventado" }, { ...gov, p_operacao: "governar" }, { ...gov, autorizado: true },
  ])("rejeita entrada de governança não canônica: %j", async (value) => {
    expect(await consultarDireito(value as typeof gov)).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(io.cliente).not.toHaveBeenCalled();
  });

  it.each([
    null, { ...direito(), concessao_esperada: null }, { ...direito(), concessao_esperada: "false" },
    { ...direito(), pode_governar: false }, { ...direito(), papel: "admin" },
    { ...direito(), operacao: "avaliar" }, { ...direito(), segredo: "privado" },
  ])("não trata concessão inválida como ausência confirmada: %j", async (data) => {
    io.rpc.mockResolvedValue(resposta(data));
    expect(await consultarDireito(gov)).toMatchObject({ ok: false, codigo: "RESPOSTA_INVALIDA" });
  });
});
