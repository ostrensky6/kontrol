import { describe, expect, it } from "vitest";

import { fimDoDiaIso, inicioDoDiaIso } from "@/lib/formatters";
import { hrefAuditoria, lerFiltroAuditoria, periodoAuditoria } from "./filtro";

const TABELAS = ["", "insumos", "lotes_estoque"];

describe("dia de Brasília em data e hora", () => {
  it("o dia começa às 03h UTC e termina às 03h UTC do dia seguinte", () => {
    expect(inicioDoDiaIso("2026-11-16")).toBe("2026-11-16T03:00:00.000Z");
    expect(fimDoDiaIso("2026-11-16")).toBe("2026-11-17T03:00:00.000Z");
  });

  it("vira o mês e o ano", () => {
    expect(fimDoDiaIso("2026-11-30")).toBe("2026-12-01T03:00:00.000Z");
    expect(fimDoDiaIso("2026-12-31")).toBe("2027-01-01T03:00:00.000Z");
    expect(fimDoDiaIso("2028-02-28")).toBe("2028-02-29T03:00:00.000Z");
  });

  it("acerta o dia em que o horário de verão começava (meia-noite não existia)", () => {
    // 04/11/2018: os relógios de Brasília pularam de 00h para 01h
    expect(inicioDoDiaIso("2018-11-03")).toBe("2018-11-03T03:00:00.000Z");
    expect(inicioDoDiaIso("2018-11-05")).toBe("2018-11-05T02:00:00.000Z");
  });

  it("recusa o que não é um dia de calendário", () => {
    expect(inicioDoDiaIso("2026-02-31")).toBeNull();
    expect(inicioDoDiaIso("16/11/2026")).toBeNull();
    expect(inicioDoDiaIso("")).toBeNull();
    expect(fimDoDiaIso("2026-13-01")).toBeNull();
  });
});

describe("lerFiltroAuditoria", () => {
  it("sem parâmetros não filtra nada", () => {
    expect(lerFiltroAuditoria({}, TABELAS)).toEqual({ tabela: "", de: "", ate: "", antes: null });
  });

  it("lê tabela, período e cursor", () => {
    expect(
      lerFiltroAuditoria({ tabela: "insumos", de: "2026-11-01", ate: "2026-11-16", antes: "950" }, TABELAS),
    ).toEqual({ tabela: "insumos", de: "2026-11-01", ate: "2026-11-16", antes: 950 });
  });

  it("ignora tabela desconhecida, dia inválido e cursor que não é número", () => {
    expect(
      lerFiltroAuditoria({ tabela: "perfis; drop", de: "ontem", ate: "2026-02-31", antes: "-3" }, TABELAS),
    ).toEqual({ tabela: "", de: "", ate: "", antes: null });
    expect(lerFiltroAuditoria({ antes: "12.5" }, TABELAS).antes).toBeNull();
  });

  it("desvira o período invertido", () => {
    const filtro = lerFiltroAuditoria({ de: "2026-11-16", ate: "2026-11-01" }, TABELAS);
    expect([filtro.de, filtro.ate]).toEqual(["2026-11-01", "2026-11-16"]);
  });

  it("fica com o primeiro valor quando o parâmetro vem repetido", () => {
    expect(lerFiltroAuditoria({ tabela: ["insumos", "lotes_estoque"] }, TABELAS).tabela).toBe("insumos");
  });
});

describe("periodoAuditoria", () => {
  it("o último dia entra inteiro", () => {
    expect(periodoAuditoria({ de: "2026-11-16", ate: "2026-11-16" })).toEqual({
      desde: "2026-11-16T03:00:00.000Z",
      antesDe: "2026-11-17T03:00:00.000Z",
    });
  });

  it("lado vazio fica sem limite", () => {
    expect(periodoAuditoria({ de: "", ate: "" })).toEqual({ desde: null, antesDe: null });
  });
});

describe("hrefAuditoria", () => {
  it("monta o endereço só com o que está preenchido", () => {
    expect(hrefAuditoria({})).toBe("/auditoria");
    expect(hrefAuditoria({ tabela: "insumos", de: "", ate: "", antes: null })).toBe("/auditoria?tabela=insumos");
    expect(hrefAuditoria({ tabela: "insumos", de: "2026-11-01", ate: "2026-11-16", antes: 950 })).toBe(
      "/auditoria?tabela=insumos&de=2026-11-01&ate=2026-11-16&antes=950",
    );
  });
});
