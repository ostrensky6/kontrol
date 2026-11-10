import { describe, expect, it } from "vitest";

import { filtroEstoqueValido, linhaAtendeFiltro, montarEstoqueDisponivel } from "./estoque-disponivel";

const base = {
  previsao: [],
  alertas: [],
  lotes: [],
  hoje: "2026-11-09",
  janelaVencimento: 60,
};

const saldo = (id: number, especificacao: string, disponivel: number, extra: Record<string, unknown> = {}) => ({
  insumo_id: id,
  especificacao,
  unidade: "mL",
  em_maos: disponivel,
  reservado: 0,
  disponivel,
  ponto_reposicao: 10,
  ...extra,
});

describe("estoque disponível da visão geral", () => {
  it("uma linha por insumo ativo, em ordem alfabética", () => {
    const linhas = montarEstoqueDisponivel({
      ...base,
      saldo: [saldo(2, "Etanol", 5), saldo(1, "Acetona", 3), saldo(3, "Inativo", 9, { ativo: false })],
    });
    expect(linhas.map((l) => l.especificacao)).toEqual(["Acetona", "Etanol"]);
  });

  it("mostra a caminho, sugestão de compra e a mesma situação do Controle de Estoque", () => {
    const [linha] = montarEstoqueDisponivel({
      ...base,
      saldo: [saldo(1, "Acetona", 0, { unidade_saldo: "frasco(s) de 1 L" })],
      previsao: [{ insumo_id: 1, qtd_sugerida_compra: 4, qtd_pedida_aberta: 2 }],
    });
    expect(linha.aCaminho).toBe(2);
    expect(linha.sugerido).toBe(4);
    expect(linha.unidade).toBe("frasco(s) de 1 L");
    expect(linha.sinais).toEqual(["sem_disponivel", "reposicao"]);
    expect(linha.situacao).toBe("Sem estoque");
    expect(linha.tom).toBe("red");
    expect(linhaAtendeFiltro(linha, "reposicao")).toBe(true);
    expect(linhaAtendeFiltro(linha, "sem_disponivel")).toBe(true);
    expect(linhaAtendeFiltro(linha, "ok")).toBe(false);
  });

  it("validade mais próxima entre os lotes com saldo, considerando a validade após abertura", () => {
    const [linha] = montarEstoqueDisponivel({
      ...base,
      saldo: [saldo(1, "Acetona", 5)],
      lotes: [
        { insumo_id: 1, validade: "2027-05-01", validade_apos_abertura: "2026-12-01", quantidade_atual: 1 },
        { insumo_id: 1, validade: "2026-11-20", quantidade_atual: 0 },
        { insumo_id: 1, validade: "2026-10-01", quantidade_atual: 2, status: "descartado" },
      ],
    });
    expect(linha.validade).toBe("2026-12-01");
    expect(linha.validadeEstado).toBe("vencendo");
  });

  it("a caminho é só o comprado ou autorizado; o que espera aprovação fica à parte", () => {
    const [linha, semPrevisao] = montarEstoqueDisponivel({
      ...base,
      saldo: [saldo(1, "Acetona", 5), saldo(2, "Brometo", 5)],
      previsao: [{ insumo_id: 1, qtd_pedida_aberta: 10, qtd_pedida_pendente: 4 }],
    });
    expect(linha.aCaminho).toBe(6);
    expect(linha.aguardandoAprovacao).toBe(4);
    // sem leitura da previsão: informação ausente, não zero
    expect(semPrevisao.aCaminho).toBeNull();
    expect(semPrevisao.aguardandoAprovacao).toBeNull();
  });

  it("insumo sem sinal está em dia", () => {
    const [linha] = montarEstoqueDisponivel({ ...base, saldo: [saldo(1, "Acetona", 50)] });
    expect(linha.sinais).toEqual([]);
    expect(linhaAtendeFiltro(linha, "ok")).toBe(true);
    expect(linha.validadeEstado).toBeNull();
  });

  it("sem filtro na URL (ou com filtro desconhecido) abre em Precisa de atenção", () => {
    expect(filtroEstoqueValido("reposicao")).toBe("reposicao");
    expect(filtroEstoqueValido("todos")).toBe("todos");
    expect(filtroEstoqueValido("x")).toBe("atencao");
    expect(filtroEstoqueValido(undefined)).toBe("atencao");
  });

  it("Precisa de atenção mostra quem tem qualquer aviso e esconde quem está em dia", () => {
    const [emDia, zerado] = montarEstoqueDisponivel({ ...base, saldo: [saldo(1, "Acetona", 50), saldo(2, "Brometo", 0)] });
    expect(linhaAtendeFiltro(emDia, "atencao")).toBe(false);
    expect(linhaAtendeFiltro(zerado, "atencao")).toBe(true);
    expect(linhaAtendeFiltro(zerado, "ok")).toBe(false);
  });
});
