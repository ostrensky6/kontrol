import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Archive } from "lucide-react";
import { IconeAcao } from "./IconeAcao";

describe("IconeAcao", () => {
  it("mostra só o ícone, com o nome na dica e para o leitor de tela", () => {
    const html = renderToStaticMarkup(createElement(IconeAcao, { icone: Archive, rotulo: "Arquivar item" }));
    expect(html).toContain('title="Arquivar item"');
    expect(html).toContain('<span class="sr-only">Arquivar item</span>');
    expect(html).toContain("<svg");
    expect(html).toContain('aria-hidden="true"');
  });
});
