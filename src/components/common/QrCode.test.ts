import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { QrCode } from "./QrCode";

describe("QrCode", () => {
  it("renderiza um SVG com conteudo escaneavel", () => {
    const html = renderToStaticMarkup(
      createElement(QrCode, { value: "/s/lote/123", label: "QR lote" }),
    );
    expect(html).toContain("<svg");
    expect(html).toContain("aria-label=\"QR lote\"");
    expect(html).toContain("<rect");
  });

  it("limita o QR minimo a URLs internas curtas", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(QrCode, { value: `/s/lote/${"1".repeat(60)}` }),
      ),
    ).toThrow("até 53 bytes");
  });
});
