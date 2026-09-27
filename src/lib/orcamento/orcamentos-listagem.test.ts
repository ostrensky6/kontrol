import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { situacaoPorProposta } from "./orcamentos-listagem";

describe("situação comercial pela versão da proposta (ORC2-5)", () => {
  it("aprovada vale mais que qualquer outra versão", () => {
    const situacao = situacaoPorProposta(
      [
        { demanda_id: 1, status: "emitido", valido_ate: "2026-12-31" },
        { demanda_id: 1, status: "aprovado", valido_ate: "2026-01-01" },
      ],
      "2026-09-26",
    );
    expect(situacao.get(1)).toMatchObject({ etapaAtual: "Proposta aprovada", grupo: "decididos" });
  });

  it("emitida fora da validade não conta como viva", () => {
    const situacao = situacaoPorProposta(
      [
        { demanda_id: 2, status: "enviado", valido_ate: "2026-09-01" },
        { demanda_id: 3, status: "enviado", valido_ate: "2026-10-30" },
      ],
      "2026-09-26",
    );
    expect(situacao.has(2)).toBe(false);
    expect(situacao.get(3)).toMatchObject({ etapaAtual: "Proposta emitida", grupo: "emitidos" });
  });
});
