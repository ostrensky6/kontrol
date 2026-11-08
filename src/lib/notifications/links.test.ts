import { expect, it } from "vitest";

import { caminhoNotificacao } from "./links";

it("aviso de proposta aprovada abre a proposta, onde fica o botão do planejamento (0165)", () => {
  expect(caminhoNotificacao("proposta_final", 42)).toBe("/orcamento/final/42");
  expect(caminhoNotificacao("proposta_final", null)).toBe("/orcamento/historico");
});
