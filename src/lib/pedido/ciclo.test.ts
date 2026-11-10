import { describe, expect, it } from "vitest";

import {
  datasDoCiclo,
  cicloLiberaEm,
  cicloPara,
  dataEmBrasilia,
  explicarCicloHoje,
  faltaJustificativaUrgencia,
  motivoCicloTravado,
  prazoDoCiclo,
  rotuloCiclo,
  rotuloData,
  rotuloPrazo,
} from "./ciclo";

describe("ciclo do dia 10 (0172)", () => {
  it("prazo no dia 10; sábado e domingo vão para a segunda (mesma regra do banco)", () => {
    expect(prazoDoCiclo("2026-11-01")).toBe("2026-11-10");
    expect(prazoDoCiclo("2026-10-20")).toBe("2026-10-12");
    expect(prazoDoCiclo("2027-01-01")).toBe("2027-01-11");
    expect(rotuloPrazo("2026-10-12")).toBe("seg. 12/10");
  });

  it("aprovação depois do prazo passa ao ciclo seguinte; urgência fica no mês", () => {
    expect(cicloPara("2026-10-12", false)).toBe("2026-10-01");
    expect(cicloPara("2026-10-13", false)).toBe("2026-11-01");
    expect(cicloPara("2026-12-31", false)).toBe("2027-01-01");
    expect(cicloPara("2026-11-20", true)).toBe("2026-11-01");
    expect(rotuloCiclo("2027-01-01")).toBe("janeiro/2027");
    expect(rotuloCiclo(null)).toBeNull();
  });

  it("usa o horário de Brasília", () => {
    expect(dataEmBrasilia(new Date("2026-11-11T01:00:00Z"))).toBe("2026-11-10");
  });

  it("explica o ciclo para quem pede", () => {
    expect(explicarCicloHoje("2026-11-09", false)).toBe(
      "Aprovado pela coordenação até ter. 10/11, entra no ciclo de compras de novembro/2026. Depois disso, passa ao ciclo seguinte.",
    );
    expect(explicarCicloHoje("2026-11-12", false)).toContain("já passou: o pedido entra no ciclo de dezembro/2026");
    expect(explicarCicloHoje("2026-11-12", true)).toContain("fura o ciclo do dia 10 e entra no ciclo de novembro/2026");
  });

  it("urgência sem justificativa trava; normal não pede nada", () => {
    expect(faltaJustificativaUrgencia("alta", "")).toContain("precisa de justificativa");
    expect(faltaJustificativaUrgencia("critica", "curto")).not.toBeNull();
    expect(faltaJustificativaUrgencia("alta", "Amostras chegam dia 15 e o reagente acabou")).toBeNull();
    expect(faltaJustificativaUrgencia("normal", null)).toBeNull();
  });
});

describe("trava do ciclo seguinte (0176)", () => {
  const justificativa = "Coleta marcada para a semana que vem.";

  it("pedido do ciclo seguinte só libera no dia 1 do mês do ciclo", () => {
    expect(cicloLiberaEm("2026-12-01", "normal", null, "2026-11-20")).toBe("2026-12-01");
    expect(cicloLiberaEm("2026-12-01", "normal", null, "2026-11-30")).toBe("2026-12-01");
    expect(cicloLiberaEm("2026-12-01", "normal", null, "2026-12-01")).toBeNull();
    expect(cicloLiberaEm("2026-11-01", "normal", null, "2026-11-20")).toBeNull();
    expect(cicloLiberaEm(null, "normal", null, "2026-11-20")).toBeNull();
  });

  it("urgência justificada fura a trava; sem justificativa, não", () => {
    expect(cicloLiberaEm("2026-12-01", "alta", justificativa, "2026-11-20")).toBeNull();
    expect(cicloLiberaEm("2026-12-01", "critica", justificativa, "2026-11-20")).toBeNull();
    expect(cicloLiberaEm("2026-12-01", "alta", "curta", "2026-11-20")).toBe("2026-12-01");
  });

  it("explica com o mesmo texto do banco", () => {
    expect(rotuloData("2026-12-01")).toBe("01/12/2026");
    expect(motivoCicloTravado("2026-12-01", "normal", null, "2026-11-20")).toBe(
      "Este pedido entrou no ciclo de compras de dezembro/2026 porque foi aprovado depois do prazo do dia 10. Ele segue para compras a partir de 01/12/2026. Só pedido urgente, com justificativa, fura o ciclo.",
    );
    expect(motivoCicloTravado("2026-12-01", "normal", null, "2026-12-01")).toBeNull();
  });

  it("guarda as duas datas do ciclo: a solicitação e a aprovação da coordenação que o define", () => {
    const aprovacoes = [
      { status_origem: "em_validacao", status_destino: "validado", criado_em: "2026-11-09T15:00:00Z" },
      { status_origem: "ajuste_solicitante", status_destino: "em_validacao", criado_em: "2026-11-08T12:00:00Z" },
      { status_origem: "em_validacao", status_destino: "ajuste_solicitante", criado_em: "2026-11-06T12:00:00Z" },
      { status_origem: "rascunho", status_destino: "em_validacao", criado_em: "2026-11-05T12:00:00Z" },
    ];
    // sem laboratório: vale a validação do coordenador; a solicitação é o primeiro envio
    expect(datasDoCiclo(aprovacoes)).toEqual({ solicitadoEm: "2026-11-05T12:00:00Z", aprovadoEm: "2026-11-09T15:00:00Z" });
    // material de laboratório: vale a aprovação do laboratório, que vem depois
    expect(datasDoCiclo(aprovacoes, "2026-11-11T13:00:00+00:00").aprovadoEm).toBe("2026-11-11T13:00:00+00:00");
    // ainda sem aprovação do coordenador: nada define o ciclo
    expect(datasDoCiclo(aprovacoes.slice(1))).toEqual({ solicitadoEm: "2026-11-05T12:00:00Z", aprovadoEm: null });
  });
});
