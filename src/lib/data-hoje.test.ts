import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { dataIsoEmDias, hojeIso } from "./formatters";

// Auditoria de 16/11, item 5: "hoje" é o dia do laboratório (Brasília), não o do UTC.

describe("hojeIso", () => {
  it("às 22h de Brasília ainda é o mesmo dia, embora o UTC já tenha virado", () => {
    // 16/11 22:30 em Brasília (UTC-3) = 17/11 01:30 UTC
    const agora = new Date("2026-11-17T01:30:00Z");
    expect(agora.toISOString().slice(0, 10)).toBe("2026-11-17");
    expect(hojeIso(agora)).toBe("2026-11-16");
  });

  it("de manhã coincide com o UTC", () => {
    expect(hojeIso(new Date("2026-11-16T12:00:00Z"))).toBe("2026-11-16");
  });

  it("vira o dia à meia-noite de Brasília", () => {
    expect(hojeIso(new Date("2026-11-17T02:59:59Z"))).toBe("2026-11-16");
    expect(hojeIso(new Date("2026-11-17T03:00:00Z"))).toBe("2026-11-17");
  });
});

describe("dataIsoEmDias", () => {
  it("conta os dias a partir do dia do laboratório", () => {
    const noite = new Date("2026-11-17T01:30:00Z"); // 16/11 à noite em Brasília
    expect(dataIsoEmDias(7, noite)).toBe("2026-11-23");
    expect(dataIsoEmDias(0, noite)).toBe("2026-11-16");
  });

  it("atravessa mês e ano", () => {
    expect(dataIsoEmDias(30, new Date("2026-12-15T15:00:00Z"))).toBe("2027-01-14");
  });
});

describe("guarda: 'hoje' tirado do UTC", () => {
  const SRC = fileURLToPath(new URL("..", import.meta.url));
  function arquivos(dir: string): string[] {
    return readdirSync(dir).flatMap((nome) => {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) return arquivos(caminho);
      return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
    });
  }
  // new Date().toISOString().slice(0, 10) e new Date(Date.now() + ...).toISOString().slice(0, 10)
  const HOJE_UTC = /new Date\(\s*(?:Date\.now\(\)[^;\n]*?)?\)\s*\.toISOString\(\)\s*\.(?:slice|substring)\(0,\s*10\)/;

  it("nenhum arquivo do aplicativo calcula a data de hoje pelo UTC", () => {
    const achados = arquivos(SRC)
      .filter((caminho) => !caminho.includes(join("lib", "testing")))
      .flatMap((caminho) =>
        readFileSync(caminho, "utf8")
          .split("\n")
          .map((linha, i) => (HOJE_UTC.test(linha) ? `${relative(SRC, caminho)}:${i + 1}  ${linha.trim().slice(0, 90)}` : null))
          .filter((achado): achado is string => achado !== null),
      );
    expect(achados).toEqual([]);
  });

  it("a guarda reconhece as duas formas", () => {
    expect(HOJE_UTC.test("const hoje = new Date().toISOString().slice(0, 10);")).toBe(true);
    expect(HOJE_UTC.test("return new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);")).toBe(true);
    // conta de calendário sobre uma data já conhecida não é "hoje"
    expect(HOJE_UTC.test("return new Date(Date.UTC(ano, mes - 1, dia)).toISOString().slice(0, 10);")).toBe(false);
  });
});
