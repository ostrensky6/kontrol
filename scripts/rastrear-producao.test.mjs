import assert from "node:assert/strict";
import { test } from "node:test";

import { conferirRastreio } from "./rastrear-producao.mjs";

const servido = { ambiente: "production", commit: "a".repeat(40), migration_esperada: "0167" };

test("tudo batendo não aponta divergência", () => {
  assert.deepEqual(conferirRastreio({ servido, commitMain: "a".repeat(40), ultimaNoBanco: "0167" }), []);
});

test("commit servido diferente do main é divergência", () => {
  const p = conferirRastreio({ servido, commitMain: "b".repeat(40), ultimaNoBanco: null });
  assert.match(p[0], /origin\/main/);
});

test("schema atrás do código é divergência", () => {
  const p = conferirRastreio({ servido, commitMain: null, ultimaNoBanco: "0166" });
  assert.match(p[0], /espera a migration 0167, banco está na 0166/);
});

test("ambiente que não é production é divergência", () => {
  const p = conferirRastreio({ servido: { ...servido, ambiente: "preview" }, commitMain: null, ultimaNoBanco: null });
  assert.match(p[0], /preview/);
});
