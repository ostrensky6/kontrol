import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { MOTIVO_MIN_PADRAO, erroMotivo, normalizarMotivo } from "./motivo";

const fonte = (arquivo: string) =>
  readFileSync(fileURLToPath(new URL(arquivo, import.meta.url)), "utf8");

describe("motivo obrigatório da confirmação", () => {
  it("recusa vazio e só espaços", () => {
    expect(erroMotivo("")).toBe("Informe o motivo.");
    expect(erroMotivo("   \n ")).toBe("Informe o motivo.");
    expect(erroMotivo(null)).toBe("Informe o motivo.");
  });

  it("aplica o mínimo sem contar espaços nas pontas", () => {
    expect(MOTIVO_MIN_PADRAO).toBe(3);
    expect(erroMotivo("  ab  ")).toBe("Escreva ao menos 3 caracteres.");
    expect(erroMotivo("abc")).toBeNull();
    expect(erroMotivo("curto", 10)).toBe("Escreva ao menos 10 caracteres.");
    expect(erroMotivo("fornecedor sem estoque", 10)).toBeNull();
  });

  it("mínimo inválido vira 1", () => {
    expect(erroMotivo("a", 0)).toBeNull();
    expect(erroMotivo("a", -5)).toBeNull();
  });

  it("normaliza o texto enviado", () => {
    expect(normalizarMotivo("  pedido duplicado \n")).toBe("pedido duplicado");
    expect(normalizarMotivo(undefined)).toBe("");
  });
});

describe("diálogos de confirmação", () => {
  for (const arquivo of ["./ConfirmActionButton.tsx", "./ConfirmSubmitButton.tsx"]) {
    it(`${arquivo}: desistir é "Voltar" e o motivo é opcional`, () => {
      const codigo = fonte(arquivo);
      expect(codigo).toMatch(/>\s*Voltar\s*</);
      expect(codigo).not.toMatch(/>\s*Cancelar\s*</);
      expect(codigo).toMatch(/motivo\?: MotivoConfirmacao/);
      expect(codigo).toContain("erroMotivo(");
    });
  }

  it("ConfirmSubmitButton envia o motivo num campo oculto do próprio formulário", () => {
    const codigo = fonte("./ConfirmSubmitButton.tsx");
    expect(codigo).toMatch(/type="hidden"[\s\S]*name=\{motivo\.name\}/);
    // o valor é gravado no campo antes do requestSubmit
    expect(codigo.indexOf("campoMotivo.current.value")).toBeLessThan(
      codigo.indexOf("requestSubmit("),
    );
  });
});
