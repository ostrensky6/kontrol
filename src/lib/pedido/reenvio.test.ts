import { describe, expect, it } from "vitest";
import { situacaoReenvio, textoReenvio } from "./reenvio";

describe("reenvio depois do ajuste (0175, D5)", () => {
  it("sem validação anterior, vai ao coordenador", () => {
    const s = situacaoReenvio({ mantem: false, mudou: [], motivo: "sem_validacao", valor_atual: 300 });
    expect(textoReenvio(s)).toBe("Ao reenviar, o pedido vai para a validação do coordenador.");
  });

  it("sem mudança, mantém as aprovações e diz para onde volta", () => {
    expect(textoReenvio(situacaoReenvio({ mantem: true, mudou: [], motivo: "igual", aguarda_laboratorio: false })))
      .toContain("as aprovações continuam valendo e o pedido volta direto para o administrativo formalizar");
    expect(textoReenvio(situacaoReenvio({ mantem: true, mudou: [], motivo: "igual", aguarda_laboratorio: true })))
      .toContain("volta direto para a coordenação do laboratório");
  });

  it("com mudança, lista o que mudou e mostra os valores", () => {
    const texto = textoReenvio(
      situacaoReenvio({ mantem: false, mudou: ["valor", "projeto"], motivo: "mudou", valor_atual: "450", valor_validado: 300 }),
    );
    expect(texto).toMatch(/^Mudou o valor \(R\$\s?300,00 na validação, R\$\s?450,00 agora\) e o projeto: ao reenviar, o pedido passa de novo pelo coordenador\.$/);
  });

  it("retorno ilegível não vira texto", () => {
    expect(situacaoReenvio(null)).toBeNull();
    expect(textoReenvio(null)).toBeNull();
  });
});
