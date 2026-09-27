import { describe, expect, it } from "vitest";

import {
  SENHA_PROVISORIA_LEGADA,
  appMetadataSenhaProvisoria,
  gerarSenhaProvisoria,
  senhaProvisoriaVencida,
} from "./senha-provisoria";

describe("gerarSenhaProvisoria", () => {
  it("gera 12 caracteres em três grupos, sem caracteres ambíguos", () => {
    for (let i = 0; i < 200; i += 1) {
      const senha = gerarSenhaProvisoria();
      expect(senha).toMatch(/^[A-HJKMNP-Za-hjkmnp-z2-9]{4}-[A-HJKMNP-Za-hjkmnp-z2-9]{4}-[A-HJKMNP-Za-hjkmnp-z2-9]{4}$/);
      expect(senha).toMatch(/[A-Z]/);
      expect(senha).toMatch(/[a-z]/);
      expect(senha).toMatch(/[2-9]/);
    }
  });

  it("não repete a senha nem usa a senha fixa antiga", () => {
    const senhas = new Set(Array.from({ length: 500 }, () => gerarSenhaProvisoria()));
    expect(senhas.size).toBe(500);
    expect(senhas.has(SENHA_PROVISORIA_LEGADA)).toBe(false);
  });
});

describe("validade da senha provisória", () => {
  const agora = new Date("2026-09-27T12:00:00Z");

  it("vence em 7 dias", () => {
    const meta = appMetadataSenhaProvisoria(agora);
    expect(meta.senha_provisoria_expira_em).toBe("2026-10-04T12:00:00.000Z");
    expect(senhaProvisoriaVencida(meta, new Date("2026-10-04T11:59:00Z"))).toBe(false);
    expect(senhaProvisoriaVencida(meta, new Date("2026-10-04T12:01:00Z"))).toBe(true);
  });

  it("não considera vencida quem já trocou a senha ou foi cadastrado antes do prazo existir", () => {
    const passado = "2026-01-01T00:00:00.000Z";
    expect(senhaProvisoriaVencida({ senha_provisoria: false, senha_provisoria_expira_em: passado }, agora)).toBe(false);
    expect(senhaProvisoriaVencida({ senha_provisoria: true }, agora)).toBe(false);
    expect(senhaProvisoriaVencida(undefined, agora)).toBe(false);
  });
});
