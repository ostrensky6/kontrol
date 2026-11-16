import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AvisoLeitura } from "./AvisoLeitura";

describe("AvisoLeitura", () => {
  it("não aparece quando todas as leituras responderam", () => {
    expect(renderToStaticMarkup(createElement(AvisoLeitura, { falhas: [] }))).toBe("");
  });

  it("diz o que ficou sem dado, como alerta", () => {
    const html = renderToStaticMarkup(
      createElement(AvisoLeitura, { falhas: ["compras", "projetos", "saldo do estoque"] }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Parte desta tela não carregou");
    expect(html).toContain("Sem dado de compras, projetos e saldo do estoque.");
    expect(html).toContain("recarregue a página");
  });
});
