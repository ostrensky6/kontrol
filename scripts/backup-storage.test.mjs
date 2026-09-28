import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { caminhoLocal, nomePasta, pastasParaApagar, PREFIXO_PASTA } from "./backup-storage.mjs";

test("pasta da cópia leva data e hora", () => {
  assert.equal(nomePasta(new Date(2026, 8, 28, 7, 5, 9)), `${PREFIXO_PASTA}20260928-070509`);
});

test("arquivo vai para <raiz>/<bucket>/<caminho>", () => {
  assert.equal(caminhoLocal("R", "orcamento-anexos", "77/abc-laudo.pdf"), join("R", "orcamento-anexos", "77", "abc-laudo.pdf"));
});

test("recusa caminho que escaparia da pasta do bucket", () => {
  for (const ruim of ["../fora.txt", "a/../../b", "a//b", "c:\\x", "a/./b"]) {
    assert.throws(() => caminhoLocal("R", "bucket", ruim), /inseguro/, ruim);
  }
});

test("mantém só as N cópias mais recentes e ignora outras pastas", () => {
  const nomes = [
    `${PREFIXO_PASTA}20260926-003000`,
    `${PREFIXO_PASTA}20260928-003000`,
    `${PREFIXO_PASTA}20260927-123000`,
    "outra-pasta",
  ];
  assert.deepEqual(pastasParaApagar(nomes, 2), [`${PREFIXO_PASTA}20260926-003000`]);
  assert.deepEqual(pastasParaApagar(nomes, 5), []);
});
