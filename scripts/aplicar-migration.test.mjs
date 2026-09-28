import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  descreverAlvo,
  montarSqlAtomico,
  sqlSomenteRegistrar,
  urlParaMigration,
  versaoDoArquivo,
} from "./aplicar-migration.mjs";

const pastaMigrations = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));

test("lê versão e nome do arquivo", () => {
  assert.deepEqual(versaoDoArquivo("supabase/migrations/0133_quantidades_compra.sql"), {
    versao: "0133",
    nome: "quantidades_compra",
  });
  assert.throws(() => versaoDoArquivo("0133-sem-padrao.sql"), /padrão/);
});

test("aplica e registra na mesma transação, sem o BEGIN/COMMIT da própria migration", () => {
  const sql = montarSqlAtomico("-- cabeçalho\nbegin;\ncreate table t(id int);\ncommit;\n", {
    versao: "0133",
    nome: "teste",
  });
  const linhas = sql.split("\n").map((l) => l.trim().toLowerCase());
  assert.equal(linhas.filter((l) => l === "begin;").length, 1);
  assert.equal(linhas.filter((l) => l === "commit;").length, 1);
  const iBegin = linhas.indexOf("begin;");
  const iCreate = linhas.findIndex((l) => l.startsWith("create table t"));
  const iInsert = linhas.findIndex((l) => l.startsWith("insert into supabase_migrations.schema_migrations"));
  const iCommit = linhas.indexOf("commit;");
  assert.ok(iBegin < iCreate && iCreate < iInsert && iInsert < iCommit, "begin → migration → registro → commit");
  assert.match(sql, /values \('0133', 'teste', array\[\]::text\[\]\)/);
  assert.match(sql, /ON_ERROR_STOP on/);
});

test("ensaio termina em rollback e não grava", () => {
  const sql = montarSqlAtomico("begin;\nselect 1;\ncommit;\n", { versao: "0133", nome: "x", ensaio: true });
  assert.match(sql, /^rollback;/m);
  assert.doesNotMatch(sql, /^commit;/m);
});

test("migration sem BEGIN/COMMIT próprio também fica atômica", () => {
  const sql = montarSqlAtomico("create table t(id int);\n", { versao: "0133", nome: "x" });
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
});

test("recusa controle de transação no meio da migration", () => {
  assert.throws(
    () => montarSqlAtomico("begin;\nselect 1;\ncommit;\nbegin;\nselect 2;\ncommit;\n", { versao: "1", nome: "x" }),
    /controle de transação/,
  );
  assert.throws(() => montarSqlAtomico("select 1;\nrollback;\n", { versao: "1", nome: "x" }), /ROLLBACK/);
  assert.throws(() => montarSqlAtomico("create index concurrently i on t(id);\n", { versao: "1", nome: "x" }), /CONCURRENTLY/);
});

test("aceita blocos PL/pgSQL (begin sem ponto e vírgula, end;)", () => {
  const funcao = [
    "begin;",
    "create or replace function f() returns int language plpgsql as $$",
    "begin",
    "  return 1;",
    "end;",
    "$$;",
    "commit;",
  ].join("\n");
  assert.doesNotThrow(() => montarSqlAtomico(funcao, { versao: "1", nome: "x" }));
});

test("todas as migrations recentes do repositório são aceitas", () => {
  const recentes = readdirSync(pastaMigrations).filter((n) => /^01[23]\d_.+\.sql$/.test(n));
  assert.ok(recentes.length > 0);
  for (const arquivo of recentes) {
    const { versao, nome } = versaoDoArquivo(arquivo);
    assert.doesNotThrow(
      () => montarSqlAtomico(readFileSync(new URL(arquivo, `file:///${pastaMigrations.replace(/\\/g, "/")}`), "utf8"), { versao, nome }),
      arquivo,
    );
  }
});

test("somente registrar grava só a linha do histórico", () => {
  const sql = sqlSomenteRegistrar({ versao: "0132", nome: "link" });
  assert.match(sql, /insert into supabase_migrations\.schema_migrations/);
  assert.doesNotMatch(sql, /create|alter|drop/i);
});

test("porta 6543 do pooler vira 5432; as demais ficam", () => {
  assert.deepEqual(urlParaMigration("postgresql://u:p@aws-0.pooler.supabase.com:6543/postgres"), {
    url: "postgresql://u:p@aws-0.pooler.supabase.com:5432/postgres",
    trocouPorta: true,
  });
  assert.equal(urlParaMigration("postgresql://u:p@127.0.0.1:54522/postgres").trocouPorta, false);
});

test("descrição do alvo nunca leva a senha", () => {
  const texto = descreverAlvo("postgresql://postgres:segredo@127.0.0.1:54522/postgres");
  assert.equal(texto, "127.0.0.1:54522/postgres");
  assert.doesNotMatch(texto, /segredo/);
});

test("situação: lista só o que o repositório tem além do último registro", async () => {
  const { migrationsPendentes } = await import("./aplicar-migration.mjs");
  const arquivos = ["0130_a.sql", "0131_b.sql", "0132_c.sql", "0133_d.sql", "leiame.md"];
  const pendentes = migrationsPendentes(arquivos, ["0130", "0131", "20260922185946"]);
  assert.deepEqual(pendentes.map((p) => p.arquivo), ["0132_c.sql", "0133_d.sql"]);
  assert.deepEqual(migrationsPendentes(arquivos, ["0130", "0131", "0132", "0133"]), []);
});
