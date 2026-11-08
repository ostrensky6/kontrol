#!/usr/bin/env node
// Rastreabilidade da publicação (avaliação externa de 08/11/2026, prioridade 4):
// domínio oficial → deployment → commit → schema compatível, numa conferência só.
//
//   npm run prod:rastreio
//   npm run prod:rastreio -- --env-file G:\Aplicativos\Kontrol\.env.local   (inclui o banco)
//
// Só lê: GET em /api/versao, `git rev-parse origin/main` e um SELECT no
// histórico de migrations. Nunca imprime a URL do banco nem a senha.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { descreverAlvo, lerEnvFile, urlParaMigration } from "./aplicar-migration.mjs";

export const DOMINIO_OFICIAL = "https://kontrol-atgc.vercel.app";

/** Compara o que o domínio serve com o main e com o banco; devolve problemas encontrados. */
export function conferirRastreio({ servido, commitMain, ultimaNoBanco }) {
  const problemas = [];
  if (servido.ambiente !== "production") problemas.push(`ambiente servido é ${servido.ambiente ?? "desconhecido"}, não production`);
  if (!servido.commit) problemas.push("o deployment não informou o commit");
  else if (commitMain && servido.commit !== commitMain) {
    problemas.push(`domínio serve ${servido.commit.slice(0, 7)}, mas origin/main está em ${commitMain.slice(0, 7)}`);
  }
  if (ultimaNoBanco != null && servido.migration_esperada !== ultimaNoBanco) {
    problemas.push(`código espera a migration ${servido.migration_esperada}, banco está na ${ultimaNoBanco}`);
  }
  return problemas;
}

function argumentos(argv) {
  const out = { dominio: DOMINIO_OFICIAL };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--env-file") out.envFile = argv[++i];
    else if (argv[i] === "--dominio") out.dominio = argv[++i];
  }
  return out;
}

function commitDoMain() {
  spawnSync("git", ["fetch", "-q", "origin", "main"], { encoding: "utf8" });
  const r = spawnSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function ultimaMigrationNoBanco(envFile) {
  const env = { ...process.env, ...lerEnvFile(envFile) };
  const bruta = env.MIGRATION_DATABASE_URL || env.KONTROL_CLOUD_DATABASE_URL || env.DATABASE_URL;
  if (!bruta) throw new Error("Nenhuma URL de banco no env-file.");
  const { url } = urlParaMigration(bruta);
  const r = spawnSync(
    "psql",
    [url, "-X", "-At", "-c", "select max(version) from supabase_migrations.schema_migrations where version ~ '^[0-9]{4}$'"],
    { encoding: "utf8", env: { ...process.env, PGCLIENTENCODING: "UTF8" } },
  );
  if (r.status !== 0) throw new Error(`psql falhou: ${(r.stderr ?? "").split("\n")[0]}`);
  return { versao: r.stdout.trim(), alvo: descreverAlvo(url) };
}

async function main() {
  const opts = argumentos(process.argv.slice(2));
  const resposta = await fetch(`${opts.dominio}/api/versao`, { cache: "no-store" });
  if (!resposta.ok) throw new Error(`${opts.dominio}/api/versao respondeu ${resposta.status}`);
  const servido = await resposta.json();
  const commitMain = commitDoMain();

  console.log(`Domínio:     ${opts.dominio}`);
  console.log(`Ambiente:    ${servido.ambiente ?? "?"}`);
  console.log(`Versão:      ${servido.versao}  commit ${servido.commit ?? "?"}`);
  console.log(`origin/main: ${commitMain ?? "não lido"}`);
  console.log(`Migration esperada pelo código: ${servido.migration_esperada}`);

  let ultimaNoBanco = null;
  if (opts.envFile) {
    const banco = ultimaMigrationNoBanco(opts.envFile);
    ultimaNoBanco = banco.versao;
    console.log(`Banco (${banco.alvo}): última migration ${ultimaNoBanco}`);
  } else {
    console.log("Banco: não conferido (passe --env-file para incluir)");
  }

  const problemas = conferirRastreio({ servido, commitMain, ultimaNoBanco });
  if (problemas.length > 0) {
    console.error("\nDivergências:");
    for (const p of problemas) console.error(` - ${p}`);
    process.exit(1);
  }
  console.log("\nRastreio OK: domínio, commit" + (opts.envFile ? " e schema" : "") + " batem.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exit(1);
  });
}
