import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guarda da auditoria de 16/11 (item 7): texto branco fixo sobre cor de tema.
 *
 * As cores `*-strong`, `destructive` e `primary` clareiam no tema escuro
 * (ex.: danger-strong vai de #b91c1c para #f87171). `text-white` sobre elas
 * fica ilegível no escuro. Use o par do tema (`text-primary-foreground`,
 * `text-destructive-foreground`) ou declare a cor do escuro (`dark:text-…`).
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));
const FUNDO_DE_TEMA = /\bbg-(?:(?:danger|success|warning|info)-strong|destructive|primary)(?![\w/-])/;

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.tsx$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

function brancoSobreTema(linha: string) {
  return FUNDO_DE_TEMA.test(linha) && /\btext-white\b/.test(linha) && !/\bdark:text-/.test(linha);
}

describe("guarda: texto branco sobre cor que clareia no escuro", () => {
  it("nenhuma classe junta fundo de tema com text-white sem a cor do escuro", () => {
    const achados = arquivos(SRC).flatMap((caminho) =>
      readFileSync(caminho, "utf8")
        .split("\n")
        .map((linha, i) => (brancoSobreTema(linha) ? `${relative(SRC, caminho)}:${i + 1}` : null))
        .filter((achado): achado is string => achado !== null),
    );
    expect(achados).toEqual([]);
  });

  it("reconhece o par ruim e aceita os pares do tema", () => {
    expect(brancoSobreTema('className="bg-danger-strong text-white"')).toBe(true);
    expect(brancoSobreTema('className="bg-destructive px-4 text-white hover:bg-destructive/90"')).toBe(true);
    expect(brancoSobreTema('className="bg-danger-strong text-white dark:text-neutral-950"')).toBe(false);
    expect(brancoSobreTema('className="bg-destructive text-destructive-foreground"')).toBe(false);
    // cor fixa da marca não muda com o tema; fundo translúcido não conta
    expect(brancoSobreTema('className="bg-brand-600 text-white"')).toBe(false);
    expect(brancoSobreTema('className="bg-primary/10 text-white"')).toBe(false);
  });
});
