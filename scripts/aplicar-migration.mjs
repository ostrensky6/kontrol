#!/usr/bin/env node
// Aplica UMA migration e a registra em supabase_migrations.schema_migrations
// na MESMA transação: se algo falhar ou a conexão cair no meio, nada fica
// aplicado e nada fica registrado (auditoria de 27/09, item 4).
//
// Uso:
//   node scripts/aplicar-migration.mjs --arquivo supabase/migrations/0133_nome.sql --env-file G:\Aplicativos\Kontrol\.env.local [--ensaio] [--log pasta]
//   node scripts/aplicar-migration.mjs --arquivo ... --somente-registrar   (migration já aplicada à mão e conferida)
//
// A URL vem de MIGRATION_DATABASE_URL, KONTROL_CLOUD_DATABASE_URL ou DATABASE_URL
// (nessa ordem; do ambiente ou do --env-file). Porta 6543 do pooler (modo
// transação) não serve para migration: vira 5432 (modo sessão) automaticamente.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const RE_ARQUIVO = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const RE_BEGIN = /^\s*begin\s*;\s*$/i;
const RE_COMMIT = /^\s*commit\s*;\s*$/i;

export function versaoDoArquivo(caminho) {
  const nome = basename(caminho);
  const m = RE_ARQUIVO.exec(nome);
  if (!m) throw new Error(`Nome fora do padrão NNNN_nome.sql: ${nome}`);
  return { versao: m[1], nome: m[2] };
}

/**
 * Tira o BEGIN/COMMIT da própria migration e devolve um script que aplica e
 * registra dentro de uma única transação. Recusa arquivos com controle de
 * transação no meio (não daria para garantir a atomicidade).
 */
export function montarSqlAtomico(conteudo, { versao, nome, ensaio = false }) {
  const linhas = conteudo.replace(/\r\n/g, "\n").split("\n");
  const begins = linhas.flatMap((l, i) => (RE_BEGIN.test(l) ? [i] : []));
  const commits = linhas.flatMap((l, i) => (RE_COMMIT.test(l) ? [i] : []));
  if (begins.length > 1 || commits.length > 1 || begins.length !== commits.length) {
    throw new Error("A migration tem controle de transação no meio (BEGIN/COMMIT). Separe-a antes de aplicar.");
  }
  // `end;` fica de fora: fecha blocos PL/pgSQL, não transação.
  if (/^\s*(rollback|savepoint\s+\w+|start\s+transaction)\s*;\s*$/im.test(conteudo)) {
    throw new Error("A migration usa ROLLBACK/SAVEPOINT/START TRANSACTION no nível de topo.");
  }
  if (/\bconcurrently\b/i.test(conteudo)) {
    throw new Error("CREATE INDEX CONCURRENTLY não roda dentro de transação; aplique esta migration à parte.");
  }
  const corpo = linhas.filter((_, i) => i !== begins[0] && i !== commits[0]).join("\n");
  const literal = (texto) => `'${String(texto).replace(/'/g, "''")}'`;
  return [
    "\\set ON_ERROR_STOP on",
    "begin;",
    corpo,
    "-- registro na mesma transação da migration",
    `insert into supabase_migrations.schema_migrations(version, name, statements) values (${literal(versao)}, ${literal(nome)}, array[]::text[]);`,
    ensaio ? "rollback; -- ensaio: nada fica gravado" : "commit;",
    "",
  ].join("\n");
}

export function sqlSomenteRegistrar({ versao, nome }) {
  const literal = (texto) => `'${String(texto).replace(/'/g, "''")}'`;
  return [
    "\\set ON_ERROR_STOP on",
    "begin;",
    `insert into supabase_migrations.schema_migrations(version, name, statements) values (${literal(versao)}, ${literal(nome)}, array[]::text[]);`,
    "commit;",
    "",
  ].join("\n");
}

/** Porta 6543 (pooler em modo transação) → 5432 (modo sessão). */
export function urlParaMigration(url) {
  const u = new URL(url);
  if (u.port === "6543") {
    u.port = "5432";
    return { url: u.toString(), trocouPorta: true };
  }
  return { url: u.toString(), trocouPorta: false };
}

export function lerEnvFile(caminho) {
  const env = {};
  for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

/**
 * Arquivos de migration do repositório que o banco não tem registrados, a
 * partir do último registro numérico (as versões antigas com carimbo de data,
 * como a da 0109, ficam de fora da comparação).
 */
export function migrationsPendentes(arquivos, registradas) {
  const numericas = registradas.filter((v) => /^\d{4}$/.test(v));
  const ultima = numericas.sort().at(-1) ?? "0000";
  const conjunto = new Set(registradas);
  return arquivos
    .filter((a) => RE_ARQUIVO.test(a))
    .map((a) => ({ arquivo: a, ...versaoDoArquivo(a) }))
    .filter((m) => !conjunto.has(m.versao) && m.versao > ultima)
    .sort((x, y) => x.versao.localeCompare(y.versao));
}

/** Só o host, para log e mensagens: nunca a senha. */
export function descreverAlvo(url) {
  const u = new URL(url);
  return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
}

function argumentos(argv) {
  const out = { ensaio: false, somenteRegistrar: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--arquivo") out.arquivo = argv[++i];
    else if (a === "--env-file") out.envFile = argv[++i];
    else if (a === "--log") out.log = argv[++i];
    else if (a === "--psql") out.psql = argv[++i];
    else if (a === "--ensaio") out.ensaio = true;
    else if (a === "--somente-registrar") out.somenteRegistrar = true;
    else if (a === "--situacao") out.situacao = true;
    else throw new Error(`Opção desconhecida: ${a}`);
  }
  if (!out.arquivo && !out.situacao) throw new Error("Informe --arquivo supabase/migrations/NNNN_nome.sql ou --situacao");
  return out;
}

function conexao(opts) {
  const env = { ...(opts.envFile ? lerEnvFile(opts.envFile) : {}), ...process.env };
  const bruta = env.MIGRATION_DATABASE_URL || env.KONTROL_CLOUD_DATABASE_URL || env.DATABASE_URL;
  if (!bruta) throw new Error("Sem URL do banco (MIGRATION_DATABASE_URL, KONTROL_CLOUD_DATABASE_URL ou DATABASE_URL).");
  const { url, trocouPorta } = urlParaMigration(bruta);
  return { url, trocouPorta, bin: opts.psql || "psql", alvo: descreverAlvo(url) };
}

/** --situacao: o que o repositório tem e o banco ainda não registrou. */
function situacao(opts) {
  const { url, bin, alvo } = conexao(opts);
  const r = psql(bin, url, { comando: "select version from supabase_migrations.schema_migrations order by version" });
  if (r.status !== 0) throw new Error(`Não foi possível ler o histórico de migrations:\n${r.stderr}`);
  const registradas = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pasta = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
  const pendentes = migrationsPendentes(readdirSync(pasta), registradas);
  console.log(`Alvo: ${alvo}`);
  console.log(`Última registrada: ${registradas.filter((v) => /^\d{4}$/.test(v)).sort().at(-1) ?? "nenhuma"}`);
  if (pendentes.length === 0) {
    console.log("Nenhuma migration do repositório falta registrar.");
    return 0;
  }
  console.log("Falta registrar (aplique com --arquivo; se já foi aplicada à mão, rode antes com --ensaio):");
  for (const p of pendentes) console.log(`  ${p.arquivo}`);
  return 0;
}

function psql(bin, url, { sql, comando }) {
  const args = [url, "-X", "-q", "-v", "ON_ERROR_STOP=1"];
  if (comando) args.push("-At", "-c", comando);
  const r = spawnSync(bin, args, {
    input: sql,
    encoding: "utf8",
    env: { ...process.env, PGCLIENTENCODING: "UTF8" },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function main() {
  const opts = argumentos(process.argv.slice(2));
  if (opts.situacao) return situacao(opts);
  const { versao, nome } = versaoDoArquivo(opts.arquivo);
  const { url, trocouPorta, bin, alvo } = conexao(opts);
  console.log(`Alvo: ${alvo}${trocouPorta ? " (porta 6543 trocada por 5432, modo sessão)" : ""}`);
  console.log(`Migration: ${versao} (${nome})${opts.ensaio ? " — ENSAIO, nada será gravado" : ""}`);

  const registrada = psql(bin, url, {
    comando: `select count(*) from supabase_migrations.schema_migrations where version = '${versao}'`,
  });
  if (registrada.status !== 0) throw new Error(`Não foi possível ler o histórico de migrations:\n${registrada.stderr}`);
  if (registrada.stdout.trim() !== "0") {
    console.log(`A ${versao} já está registrada neste banco. Nada a fazer.`);
    return 0;
  }

  const sql = opts.somenteRegistrar
    ? sqlSomenteRegistrar({ versao, nome })
    : montarSqlAtomico(readFileSync(opts.arquivo, "utf8"), { versao, nome, ensaio: opts.ensaio });
  const inicio = Date.now();
  const r = psql(bin, url, { sql });
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

  const relato = [
    `alvo: ${alvo}`,
    `migration: ${versao}_${nome}`,
    `modo: ${opts.somenteRegistrar ? "somente registrar" : opts.ensaio ? "ensaio (rollback)" : "aplicar e registrar"}`,
    `quando: ${new Date().toISOString()}`,
    `duração: ${segundos}s`,
    `resultado: ${r.status === 0 ? "ok" : `falhou (código ${r.status})`}`,
    "--- saída ---",
    r.stdout,
    "--- erros/avisos ---",
    r.stderr,
  ].join("\n");
  if (opts.log) {
    if (!existsSync(opts.log)) mkdirSync(opts.log, { recursive: true });
    const arquivoLog = join(opts.log, `migration-${versao}${opts.ensaio ? "-ensaio" : ""}.log`);
    writeFileSync(arquivoLog, relato, "utf8");
    console.log(`Log: ${arquivoLog}`);
  }

  if (r.status !== 0) {
    console.error(r.stderr);
    console.error(`Falhou em ${segundos}s. Nada foi aplicado nem registrado (transação desfeita).`);
    return 1;
  }
  if (opts.ensaio) console.log(`Ensaio ok em ${segundos}s: a migration aplica sem erro. Nada foi gravado.`);
  else if (opts.somenteRegistrar) console.log(`${versao} registrada.`);
  else console.log(`${versao} aplicada e registrada em ${segundos}s, na mesma transação.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(main());
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exit(1);
  }
}
