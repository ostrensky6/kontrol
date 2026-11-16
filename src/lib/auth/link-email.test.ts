import { describe, expect, it } from "vitest";
import {
  DESTINO_RECUPERACAO,
  destinoAposLink,
  destinoSeguro,
  mensagemErroLink,
  tipoLinkEmail,
  urlRetornoRecuperacao,
} from "./link-email";

describe("links de e-mail do Supabase Auth", () => {
  it("o retorno da recuperação passa por /auth/confirmar na origem do app, nunca no /login", () => {
    expect(urlRetornoRecuperacao("https://kontrol-atgc.vercel.app")).toBe(
      "https://kontrol-atgc.vercel.app/auth/confirmar?type=recovery",
    );
  });

  it("recuperação e convite abrem a troca de senha", () => {
    expect(destinoAposLink("recovery", "/qualquer")).toBe(DESTINO_RECUPERACAO);
    expect(destinoAposLink("invite", null)).toBe(DESTINO_RECUPERACAO);
    expect(destinoAposLink(null, "/suprimentos")).toBe("/suprimentos");
  });

  it("destino só aceita caminho interno", () => {
    expect(destinoSeguro("//evil.example")).toBe("/");
    expect(destinoSeguro("https://evil.example")).toBe("/");
    expect(destinoSeguro("/\\evil")).toBe("/");
    expect(destinoSeguro(undefined)).toBe("/");
  });

  it("tipo desconhecido é recusado", () => {
    expect(tipoLinkEmail("recovery")).toBe("recovery");
    expect(tipoLinkEmail("x")).toBeNull();
  });

  it("link vencido explica o que fazer", () => {
    expect(mensagemErroLink({ error_code: "otp_expired" })).toMatch(/venceu/);
    expect(mensagemErroLink({ erro: "link" })).toMatch(/venceu/);
    expect(mensagemErroLink({ error: "access_denied" })).toMatch(/Recuperar acesso/);
    expect(mensagemErroLink({})).toBeNull();
  });
});
