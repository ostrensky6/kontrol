import { describe, expect, it } from "vitest";

import { formatDate, formatPeriodo } from "./formatters";

describe("formatDate", () => {
  it("mostra datas de calendário sem voltar um dia no fuso de São Paulo", () => {
    expect(formatDate("2026-10-25")).toBe("25/10/2026");
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
  });

  it("converte instantes para o fuso de São Paulo", () => {
    expect(formatDate("2026-10-25T02:00:00Z")).toBe("24/10/2026");
    expect(formatDate("2026-10-25T15:00:00Z")).toBe("25/10/2026");
  });

  it("trata vazios e inválidos", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatDate("não é data")).toBe("—");
  });
});

describe("formatPeriodo", () => {
  it("abrevia o início quando o período cabe no mesmo ano", () => {
    expect(formatPeriodo("2026-06-22", "2026-06-30")).toBe("22/06 a 30/06/2026");
  });

  it("mostra o ano nas duas pontas quando o período vira o ano", () => {
    expect(formatPeriodo("2026-12-22", "2027-01-05")).toBe("22/12/2026 a 05/01/2027");
  });

  it("mostra só a data que existe e nunca o formato do banco", () => {
    expect(formatPeriodo("2026-06-22", null)).toBe("22/06/2026");
    expect(formatPeriodo(null, "2026-06-30")).toBe("30/06/2026");
    expect(formatPeriodo(null, null)).toBe("—");
    expect(formatPeriodo("2026-06-22", "2026-06-22")).toBe("22/06/2026");
  });
});
