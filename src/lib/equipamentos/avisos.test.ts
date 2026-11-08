import { describe, expect, it } from "vitest";
import { projetarAvisosEquipamento, type LeituraAvisosEquipamento } from "./avisos";

const escopo = { equipamento_unidade_id: 10, tipo: "calibracao" };
const regra = { ...escopo, ocorrencia_id: 30, data_referencia: "2028-03-01", antecedencia_dias: 1 };
const origem = {
  ...escopo, id: 30, status: "concluida", proxima_data: "2028-03-01",
  data_programada: "2028-02-20", data_conclusao: "2028-02-22",
};
const confirmada = <T>(dado: T) => ({ estado: "confirmada", dado } as const);
const indisponivel = { estado: "indisponivel" } as const;
const leitura: LeituraAvisosEquipamento = {
  ...escopo,
  hoje_sp: "2028-02-29",
  regra: confirmada(regra),
  origem: confirmada(origem),
  avisos: confirmada([]),
};
const ler = (delta: Partial<LeituraAvisosEquipamento> = {}) =>
  projetarAvisosEquipamento(escopo, { ...leitura, ...delta });

describe("projeção dos avisos do cadastro após leitura RPC", () => {
  it.each([
    ["2028-02-28", 1, false], ["2028-02-29", 1, true],
    ["2028-02-29", 0, false], ["2028-03-01", 0, true], ["2028-03-02", 0, true],
  ] as const)("usa a data civil do servidor %s, com %i dias", (hoje_sp, dias, na_janela) => {
    expect(ler({ hoje_sp, regra: confirmada({ ...regra, antecedencia_dias: dias }) }).janela).toEqual({
      estado: "janela_confirmada", na_janela, ocorrencia_id: 30,
      data_referencia: "2028-03-01", antecedencia_dias: dias,
    });
  });

  it.each([
    [{ id: 31 }, "referencia_alterada", "origem_divergente"],
    [{ equipamento_unidade_id: 11 }, "referencia_alterada", "origem_divergente"],
    [{ tipo: "preventiva" }, "referencia_alterada", "origem_divergente"],
    [{ status: "cancelada" }, "referencia_alterada", "origem_cancelada"],
    [{ proxima_data: "2028-03-02" }, "referencia_alterada", "proxima_data_alterada"],
    [{ proxima_data: null }, "referencia_alterada", "proxima_data_nao_informada"],
    [{ proxima_data: "2028-02-30" }, "indisponivel", "proxima_data_invalida"],
  ] as const)("confere a origem %j sem substituir por agenda, conclusão ou plano", (delta, estado, motivo) => {
    expect(ler({ origem: confirmada({ ...origem, ...delta }) }).janela).toEqual({ estado, motivo });
  });

  it("distingue ausência confirmada, origem removida e leituras indisponíveis", () => {
    expect(ler({ regra: confirmada(null) }).janela).toEqual({ estado: "nao_configurado" });
    expect(ler({ regra: indisponivel }).janela).toEqual({ estado: "indisponivel", motivo: "regra" });
    expect(ler({ origem: confirmada(null) }).janela).toEqual({ estado: "referencia_alterada", motivo: "origem_ausente" });
    expect(ler({ origem: indisponivel }).janela).toEqual({ estado: "indisponivel", motivo: "origem" });
    expect(ler({ hoje_sp: null }).janela).toEqual({ estado: "indisponivel", motivo: "data_civil" });
    expect(ler({ avisos: indisponivel }).avisos).toBeNull();
    expect(ler().avisos).toEqual([]);
  });

  it.each([undefined, null, -1, 0.5, "0", Infinity])("não presume antecedência a partir de %s", (valor) => {
    const regraRpc = { ...regra, antecedencia_dias: valor as number };
    expect(ler({ regra: confirmada(regraRpc) }).janela).toEqual({ estado: "indisponivel", motivo: "regra" });
  });

  it("preserva o histórico independente da janela e nega ações sem concessão explícita", () => {
    const avisos = (["pendente", "reconhecido", "encaminhado"] as const).map((estado, i) => ({
      id: String(i + 1), ocorrencia_id: 30 + i, regra_id: "versao-anterior",
      data_referencia: "2028-02-10", responsavel_id: "perfil-sintetico",
      aberto_em: "2028-02-08T12:00:00Z", estado,
    }));
    expect(ler({ origem: indisponivel, avisos: confirmada(avisos) })).toEqual({
      janela: { estado: "indisponivel", motivo: "origem" },
      avisos, configuracao: "negada", pode_reconhecer: false, pode_encaminhar: false,
    });
    expect(ler({ permissoes: { configurar: true } }).configuracao).toBe("permitida");
    expect(ler({ equipamento_unidade_id: 11, permissoes: { configurar: true }, avisos: confirmada(avisos) })).toEqual({
      janela: { estado: "indisponivel", motivo: "leitura" },
      avisos: null, configuracao: "negada", pode_reconhecer: false, pode_encaminhar: false,
    });
    expect(projetarAvisosEquipamento(escopo, null)).toEqual(ler({ equipamento_unidade_id: 11 }));
  });
});
