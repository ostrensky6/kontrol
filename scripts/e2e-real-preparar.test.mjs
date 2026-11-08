import { test } from "node:test";
import assert from "node:assert/strict";
import { urlLocalOuErro, USUARIOS_E2E } from "./e2e-real-preparar.mjs";

test("aceita só Supabase local", () => {
  assert.equal(urlLocalOuErro("http://127.0.0.1:54521"), "http://127.0.0.1:54521");
  assert.equal(urlLocalOuErro("http://localhost:54521"), "http://localhost:54521");
});

test("recusa produção e URL inválida", () => {
  assert.throws(() => urlLocalOuErro("https://gkcjzwfsnoknxgpsumxi.supabase.co"), /não é um Supabase local/);
  assert.throws(() => urlLocalOuErro(undefined), /ausente ou inválida/);
});

test("usuários de teste usam domínio local e funções válidas", () => {
  for (const u of USUARIOS_E2E) {
    assert.match(u.email, /@kontrol\.local$/);
    assert.ok(["laboratorio", "compra", "cadastro", "coordenador", "gestor", "admin"].includes(u.papel));
  }
});
