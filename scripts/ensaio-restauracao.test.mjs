import assert from "node:assert/strict";
import test from "node:test";
import { classificarErros, escolherDump, inventario, montarRelatorio } from "./ensaio-restauracao.mjs";

test("escolhe o backup mais recente e ignora outros arquivos", () => {
  assert.equal(
    escolherDump([
      "kontrol-db-cloud-20260927-003002.dump",
      "kontrol-db-cloud-20260927-123006.dump",
      "antes-0132.dump",
      "leiame.txt",
    ]),
    "kontrol-db-cloud-20260927-123006.dump",
  );
  assert.equal(escolherDump(["nada.txt"]), null);
});

test("inventário conta tabelas do app e tabelas com dados", () => {
  const listagem = [
    ";",
    "; Archive created at 2026-09-27 16:47:00",
    "3401; 1259 16500 TABLE public perfis postgres",
    "3402; 1259 16501 TABLE public orcamentos postgres",
    "3403; 1259 16502 TABLE auth users supabase_auth_admin",
    "5854; 0 16499 TABLE DATA auth users supabase_auth_admin",
    "5855; 0 16500 TABLE DATA public perfis postgres",
    "5870; 0 0 SEQUENCE SET public orcamentos_id_seq postgres",
  ].join("\n");
  const inv = inventario(listagem);
  assert.equal(inv.tabelasPublic, 2);
  assert.equal(inv.tabelasComDados, 2);
});

test("separa os erros esperados do pg_cron dos inesperados", () => {
  const stderr = [
    "pg_restore: error: could not execute query: ERROR:  can only create extension in database postgres",
    "pg_restore: error: could not execute query: ERROR:  schema \"cron\" does not exist",
    "pg_restore: error: could not execute query: ERROR:  relation \"cron.jobid_seq\" does not exist",
    "pg_restore: error: could not execute query: ERROR:  duplicate key value violates unique constraint",
    "pg_restore: warning: errors ignored on restore: 4",
  ].join("\n");
  const r = classificarErros(stderr);
  assert.equal(r.total, 4);
  assert.equal(r.esperados, 3);
  assert.equal(r.inesperados.length, 1);
  assert.match(r.inesperados[0], /duplicate key/);
});

const base = {
  quando: "28/09/2026 08:00",
  dump: "kontrol-db-cloud-20260928-003000.dump",
  tamanho: 1.3 * 1024 * 1024,
  dataDump: "28/09/2026 00:30",
  segundos: 12.3,
  tabelasPublic: 65,
  tabelasRestauradas: 65,
  ultimaMigration: "0134",
  totalErros: 6,
  esperados: 6,
  inesperados: [],
  contagens: [["public.perfis", "3"]],
};

test("relatório OK quando tudo volta e só há erros esperados", () => {
  const r = montarRelatorio(base);
  assert.equal(r.ok, true);
  assert.match(r.texto, /Resultado: OK/);
  assert.match(r.texto, /12\.3 s/);
  assert.match(r.texto, /\| public\.perfis \| 3 \|/);
});

test("relatório FALHOU com erro inesperado ou tabela faltando", () => {
  assert.equal(montarRelatorio({ ...base, inesperados: ["ERROR: x"] }).ok, false);
  assert.equal(montarRelatorio({ ...base, tabelasRestauradas: 64 }).ok, false);
  assert.equal(montarRelatorio({ ...base, ultimaMigration: null }).ok, false);
});
