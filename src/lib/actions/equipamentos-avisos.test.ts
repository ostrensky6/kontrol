import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  avaliarAvisoEquipamento, configurarAvisoEquipamento, encaminharAvisoEquipamento,
  governarDireitoAvisoEquipamento, reconhecerAvisoEquipamento,
} from "./equipamentos-avisos";

const io = vi.hoisted(() => ({ cliente: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped: io.cliente }));

const flag = "KONTROL_EQUIPAMENTOS_AVISOS_ESCRITA_HABILITADA";
const ator = "00000000-0000-4000-8000-000000000001";
const op = "00000000-0000-4000-8000-000000000002";
const regra = "00000000-0000-4000-8000-000000000003";
const aviso = "00000000-0000-4000-8000-000000000004";
const escopo = { p_unidade_id: "12", p_tipo: "calibracao", p_operacao_id: op };
const versao = { ...escopo, p_versao_esperada: "1" };
const config = {
  ...escopo, p_versao_esperada: "0", p_ocorrencia_id: "30", p_data_referencia: "2028-02-29",
  p_antecedencia_dias: "0", p_responsavel_id: ator, p_motivo: " Motivo explícito ",
};
const estado = { ...escopo, p_aviso_id: aviso, p_estado_esperado: "pendente", p_motivo: "motivo" };
const gov = {
  p_operacao_id: op, p_papel: "laboratorio", p_operacao: "avaliar",
  p_concessao_esperada: "false", p_concedido: "true", p_motivo: "governança",
};
const reciboConfig = {
  estado: "configurada", regra_id: regra, versao: 1, ocorrencia_id: 30,
  data_referencia: "2028-02-29", antecedencia_dias: 0,
};
const reciboReconhecido = {
  estado: "reconhecido", estado_anterior: "pendente", estado_novo: "reconhecido", aviso_id: aviso, regra_id: regra,
};
const reciboGovernanca = {
  estado: "direito_registrado", papel: "laboratorio", operacao: "avaliar", concessao_anterior: false, concedido: true,
};
const resposta = (data: unknown) => ({ data, error: null });
function form(campos: Record<string, string | undefined>) {
  const data = new FormData();
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor !== undefined) data.set(chave, valor);
  }
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv(flag, "1");
  io.cliente.mockResolvedValue({ auth: { getUser: io.getUser }, rpc: io.rpc, from: io.from });
  io.getUser.mockResolvedValue(resposta({ user: { id: ator, is_anonymous: false } }));
});
afterEach(() => vi.unstubAllEnvs());

describe("operações de avisos — fronteira da 0153", () => {
  it.each([undefined, "true", "0"])("bloqueia as cinco ações com flag %s", async (valor) => {
    vi.stubEnv(flag, valor);
    for (const acao of [
      configurarAvisoEquipamento, avaliarAvisoEquipamento, reconhecerAvisoEquipamento,
      encaminharAvisoEquipamento, governarDireitoAvisoEquipamento,
    ]) expect(await acao(null, form(config))).toMatchObject({ ok: false, codigo: "ESCRITA_DESABILITADA" });
    expect(io.cliente).not.toHaveBeenCalled();
    expect(io.rpc).not.toHaveBeenCalled();
  });

  it.each([null, { id: "inválido" }, { id: ator, is_anonymous: true }])("não escreve sem sessão legítima: %j", async (user) => {
    io.getUser.mockResolvedValue(resposta({ user }));
    expect(await configurarAvisoEquipamento(null, form(config))).toMatchObject({ ok: false, codigo: "SESSAO_INVALIDA" });
    expect(io.rpc).not.toHaveBeenCalled();
  });

  it("distingue indisponibilidade do Auth sem enviar a mutação", async () => {
    io.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0 } });
    expect(await avaliarAvisoEquipamento(null, form(versao))).toMatchObject({ ok: false, codigo: "INDISPONIVEL" });
    expect(io.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { p_unidade_id: "0" }, { p_unidade_id: "9007199254740992" }, { p_tipo: "tolerancia" },
    { p_versao_esperada: "2147483647" }, { p_versao_esperada: "" }, { p_ocorrencia_id: "3.5" },
    { p_data_referencia: "2027-02-29" }, { p_data_referencia: "0000-01-01" },
    { p_antecedencia_dias: undefined }, { p_antecedencia_dias: "-1" }, { p_antecedencia_dias: "1e2" },
    { p_responsavel_id: "inválido" }, { p_operacao_id: "" }, { p_motivo: " " },
  ] as Array<Record<string, string | undefined>>)("valida dados antes da sessão: %j", async (delta) => {
    expect(await configurarAvisoEquipamento(null, form({ ...config, ...delta })))
      .toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(io.cliente).not.toHaveBeenCalled();
  });

  it("recusa campos duplicados, transição inválida, destino vazio e checkbox implícito", async () => {
    const duplicado = form(config);
    duplicado.append("p_antecedencia_dias", "1");
    for (const result of [
      await configurarAvisoEquipamento(null, duplicado),
      await configurarAvisoEquipamento(null, {} as FormData),
      await reconhecerAvisoEquipamento(null, form({ ...estado, p_estado_esperado: "reconhecido" })),
      await encaminharAvisoEquipamento(null, form({ ...estado, p_destino: " " })),
      await governarDireitoAvisoEquipamento(null, form({ ...gov, p_concedido: "on" })),
      await governarDireitoAvisoEquipamento(null, form({ ...gov, p_papel: ator })),
    ]) expect(result).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(io.cliente).not.toHaveBeenCalled();
  });

  it("envia zero e origem explícitos para a RPC de sessão, sem ler papel ou aceitar autoridade do formulário", async () => {
    io.rpc.mockResolvedValue(resposta({ ...reciboConfig, segredo: "não devolvido" }));
    const dado = form({ ...config, ator_id: "forjado", pode_configurar: "true", hoje_sp: "1900-01-01" });
    expect(await configurarAvisoEquipamento(null, dado)).toEqual({ ok: true, recibo: reciboConfig });
    expect(io.getUser).toHaveBeenCalledOnce();
    expect(io.rpc.mock.calls).toEqual([["configurar_aviso_equipamento", {
      ...escopo, p_unidade_id: 12, p_versao_esperada: 0, p_ocorrencia_id: 30,
      p_data_referencia: "2028-02-29", p_antecedencia_dias: 0, p_responsavel_id: ator, p_motivo: "Motivo explícito",
    }]]);
    expect(io.from).not.toHaveBeenCalled();
  });

  it.each([
    [0, { estado: "nao_configurado" }],
    [1, { estado: "referencia_alterada", motivo: "origem_cancelada" }],
    [1, { estado: "indisponivel", motivo: "proxima_data_invalida" }],
    [1, { estado: "fora_janela", data_referencia: "2028-02-29" }],
    [1, { estado: "aberto", aviso_id: aviso, regra_id: regra, estado_anterior: null, estado_novo: "pendente" }],
    [1, { estado: "ja_existente", aviso_id: aviso, regra_id: regra, estado_atual: "encaminhado" }],
  ] as const)("preserva o resultado da avaliação na versão %i: %j", async (v, recibo) => {
    io.rpc.mockResolvedValue(resposta(recibo));
    expect(await avaliarAvisoEquipamento(null, form({ ...versao, p_versao_esperada: String(v) })))
      .toEqual({ ok: true, recibo });
    expect(io.rpc.mock.calls).toEqual([["avaliar_aviso_equipamento", { ...escopo, p_unidade_id: 12, p_versao_esperada: v }]]);
  });

  it("liga reconhecer, encaminhar e governar às suas RPCs e pré-imagens exatas", async () => {
    const destino = "Arquivo sintético";
    const encaminhado = { ...reciboReconhecido, estado: "encaminhado", estado_anterior: "reconhecido", estado_novo: "encaminhado" };
    io.rpc.mockResolvedValueOnce(resposta(reciboReconhecido)).mockResolvedValueOnce(resposta(encaminhado))
      .mockResolvedValueOnce(resposta(reciboGovernanca));
    expect(await reconhecerAvisoEquipamento(null, form(estado))).toEqual({ ok: true, recibo: reciboReconhecido });
    expect(await encaminharAvisoEquipamento(null, form({ ...estado, p_estado_esperado: "reconhecido", p_destino: destino })))
      .toEqual({ ok: true, recibo: encaminhado });
    expect(await governarDireitoAvisoEquipamento(null, form(gov))).toEqual({ ok: true, recibo: reciboGovernanca });
    expect(io.rpc.mock.calls).toEqual([
      ["reconhecer_aviso_equipamento", { ...estado, p_unidade_id: 12 }],
      ["encaminhar_aviso_equipamento", { ...estado, p_unidade_id: 12, p_estado_esperado: "reconhecido", p_destino: destino }],
      ["governar_direito_aviso_equipamento", { ...gov, p_concessao_esperada: false, p_concedido: true }],
    ]);
  });

  it.each([
    ["42501", "SEM_ACESSO"], ["P0002", "AVISO_AUSENTE"], ["40001", "CONFLITO"],
    ["22023", "ENTRADA_INVALIDA"], ["PGRST202", "INDISPONIVEL"],
  ])("traduz %s sem retry nem detalhe bruto", async (code, codigo) => {
    io.rpc.mockResolvedValue({ data: reciboReconhecido, error: { code, message: "privado", details: "privado" } });
    const result = await reconhecerAvisoEquipamento(null, form(estado));
    expect(result).toMatchObject({ ok: false, codigo });
    expect(JSON.stringify(result)).not.toContain("privado");
    expect(io.rpc).toHaveBeenCalledOnce();
  });

  it("não repete envio quando o transporte falha", async () => {
    io.rpc.mockRejectedValue(new Error("detalhe privado"));
    expect(await avaliarAvisoEquipamento(null, form(versao))).toMatchObject({ ok: false, codigo: "INDISPONIVEL" });
    expect(io.rpc).toHaveBeenCalledOnce();
  });

  it("não confirma recibo ausente, divergente ou de outra operação", async () => {
    const casos = [
      [configurarAvisoEquipamento, config, null],
      [configurarAvisoEquipamento, config, { ...reciboConfig, ocorrencia_id: 31 }],
      [configurarAvisoEquipamento, config, { ...reciboConfig, antecedencia_dias: "0" }],
      [avaliarAvisoEquipamento, versao, { estado: "nao_configurado" }],
      [reconhecerAvisoEquipamento, estado, { ...reciboReconhecido, aviso_id: regra }],
      [reconhecerAvisoEquipamento, estado, { ...reciboReconhecido, estado_novo: "encaminhado" }],
      [governarDireitoAvisoEquipamento, gov, { ...reciboGovernanca, concessao_anterior: true }],
    ] as const;
    for (const [acao, campos, recibo] of casos) {
      io.rpc.mockResolvedValueOnce(resposta(recibo));
      expect(await acao(null, form(campos))).toMatchObject({ ok: false, codigo: "RESPOSTA_INVALIDA" });
    }
    expect(io.rpc).toHaveBeenCalledTimes(casos.length);
  });
});
