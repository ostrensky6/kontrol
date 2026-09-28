#!/usr/bin/env node
// Ensaio de restauração: prova que um backup do banco volta inteiro, mede o
// tempo e deixa um relatório (auditoria de 27/09, item 3). Restaura num banco
// DESCARTÁVEL do Supabase local (Docker) e o apaga no fim; não toca produção.
//
// Uso:
//   node scripts/ensaio-restauracao.mjs [--dump arquivo.dump] [--pasta D:\Dropbox\Aplicativos\Kontrol\BD]
//        [--relatorio D:\Dropbox\Aplicativos\Kontrol\HISTORICO\ensaios] [--container supabase_db_Estoque]
//
// Sem --dump, usa o backup kontrol-db-cloud-*.dump mais recente da pasta. O
// relatório traz só contagens e nomes de tabela, nunca o conteúdo.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Erros esperados ao restaurar fora do banco `postgres`: pg_cron só existe nele. */
const ERROS_ESPERADOS = [
  /can only create extension in database postgres/i,
  /extension "pg_cron" does not exist/i,
  /schema "cron" does not exist/i,
  /relation "cron\.[a-z_]+" does not exist/i,
];

/** Tabelas cujo total entra no relatório (só contagem). */
export const TABELAS_CONFERIDAS = [
  "public.perfis",
  "public.demandas_propostas",
  "public.orcamentos",
  "public.orcamento_final_versoes",
  "public.clientes",
  "public.analises",
  "public.insumos",
  "public.lotes_estoque",
  "public.pedidos_compra",
  "public.pedidos_internos",
  "public.planejamento",
  "auth.users",
];

export function escolherDump(nomes) {
  return nomes.filter((n) => /^kontrol-db-cloud-\d{8}-\d{6}\.dump$/.test(n)).sort().at(-1) ?? null;
}

/** Inventário do backup pela listagem do pg_restore -l. */
export function inventario(listagem) {
  const tabelas = new Set();
  const dados = new Set();
  for (const linha of listagem.split(/\r?\n/)) {
    // "TABLE DATA" antes de "TABLE": senão a linha de dados vira tabela "DATA"
    const m = /^\d+;\s+\d+\s+\d+\s+(TABLE DATA|TABLE)\s+(\S+)\s+(\S+)\s/.exec(linha);
    if (!m) continue;
    const nome = `${m[2]}.${m[3]}`;
    if (m[1] === "TABLE") tabelas.add(nome);
    else dados.add(nome);
  }
  const doApp = [...tabelas].filter((t) => t.startsWith("public."));
  return { tabelasPublic: doApp.length, tabelasComDados: dados.size, tabelas: [...tabelas].sort() };
}

export function classificarErros(stderr) {
  const erros = stderr.split(/\r?\n/).filter((l) => /error:/i.test(l));
  const inesperados = erros.filter((l) => !ERROS_ESPERADOS.some((re) => re.test(l)));
  return { total: erros.length, esperados: erros.length - inesperados.length, inesperados };
}

export function montarRelatorio(d) {
  const ok = d.inesperados.length === 0 && d.tabelasRestauradas === d.tabelasPublic && d.ultimaMigration;
  const linhas = [
    `# Ensaio de restauração — ${d.quando}`,
    "",
    `**Resultado: ${ok ? "OK — o backup restaura inteiro" : "FALHOU — ver detalhes"}**`,
    "",
    "| Item | Valor |",
    "|---|---|",
    `| Backup | \`${d.dump}\` (${(d.tamanho / 1024 / 1024).toFixed(1)} MB, de ${d.dataDump}) |`,
    `| Tempo de restauração | ${d.segundos.toFixed(1)} s |`,
    `| Tabelas do app (public) no backup | ${d.tabelasPublic} |`,
    `| Tabelas do app restauradas | ${d.tabelasRestauradas} |`,
    `| Última migration registrada | ${d.ultimaMigration ?? "nenhuma"} |`,
    `| Erros do pg_restore | ${d.totalErros} (${d.esperados} esperados: pg_cron fora do banco postgres) |`,
    "",
    "## Contagens",
    "",
    "| Tabela | Registros |",
    "|---|---|",
    ...d.contagens.map(([t, n]) => `| ${t} | ${n} |`),
  ];
  if (d.inesperados.length) {
    linhas.push("", "## Erros inesperados", "", ...d.inesperados.map((e) => `- \`${e.slice(0, 300)}\``));
  }
  linhas.push(
    "",
    "Restaurado num banco descartável do Supabase local e apagado no fim. Produção não foi tocada.",
    "Para restaurar de verdade, seguir docs/operacao-producao.md (Recuperação).",
    "",
  );
  return { ok: Boolean(ok), texto: linhas.join("\n") };
}

function docker(container, args, { input, senha } = {}) {
  const env = senha ? ["-e", `PGPASSWORD=${senha}`] : [];
  const r = spawnSync("docker", ["exec", ...(input ? ["-i"] : []), ...env, container, ...args], {
    input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function argumentos(argv) {
  const out = {
    pasta: "D:\\Dropbox\\Aplicativos\\Kontrol\\BD",
    relatorio: "D:\\Dropbox\\Aplicativos\\Kontrol\\HISTORICO\\ensaios",
    container: "supabase_db_Estoque",
    senha: process.env.ENSAIO_PGPASSWORD || "postgres",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dump") out.dump = argv[++i];
    else if (a === "--pasta") out.pasta = argv[++i];
    else if (a === "--relatorio") out.relatorio = argv[++i];
    else if (a === "--container") out.container = argv[++i];
    else throw new Error(`Opção desconhecida: ${a}`);
  }
  return out;
}

function main() {
  const opts = argumentos(process.argv.slice(2));
  const arquivo = opts.dump ?? (() => {
    const nome = escolherDump(readdirSync(opts.pasta));
    if (!nome) throw new Error(`Nenhum kontrol-db-cloud-*.dump em ${opts.pasta}`);
    return join(opts.pasta, nome);
  })();
  const info = statSync(arquivo);
  const agora = new Date();
  const banco = `kontrol_ensaio_${agora.toISOString().replace(/\D/g, "").slice(0, 14)}`;
  const noContainer = `/tmp/${banco}.dump`;
  const psqlAdmin = ["psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-X", "-At"];
  console.log(`Backup: ${basename(arquivo)} (${(info.size / 1024 / 1024).toFixed(1)} MB)`);

  const cp = spawnSync("docker", ["cp", arquivo, `${opts.container}:${noContainer}`], { encoding: "utf8" });
  if (cp.status !== 0) throw new Error(`docker cp falhou: ${cp.stderr}`);
  try {
    const lista = docker(opts.container, ["pg_restore", "-l", noContainer]);
    if (lista.status !== 0) throw new Error(`O arquivo não é um backup válido do pg_restore:\n${lista.stderr}`);
    const inv = inventario(lista.stdout);

    const criar = docker(opts.container, [...psqlAdmin, "-d", "postgres", "-c", `create database ${banco}`], { senha: opts.senha });
    if (criar.status !== 0) throw new Error(`Não foi possível criar o banco de ensaio: ${criar.stderr}`);
    try {
      const inicio = Date.now();
      const rest = docker(
        opts.container,
        ["pg_restore", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", banco, "--no-owner", "--no-privileges", noContainer],
        { senha: opts.senha },
      );
      const segundos = (Date.now() - inicio) / 1000;
      const erros = classificarErros(rest.stderr);

      const q = (sql) => {
        const r = docker(opts.container, [...psqlAdmin, "-d", banco, "-c", sql], { senha: opts.senha });
        return r.status === 0 ? r.stdout.trim() : null;
      };
      const tabelasRestauradas = Number(
        q("select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'") ?? 0,
      );
      const ultimaMigration =
        q("select max(version) from supabase_migrations.schema_migrations where version ~ '^[0-9]{4}$'") || null;
      const contagens = TABELAS_CONFERIDAS.map((t) => [t, q(`select count(*) from ${t}`) ?? "ausente"]);

      const { ok, texto } = montarRelatorio({
        quando: agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        dump: basename(arquivo),
        tamanho: info.size,
        dataDump: info.mtime.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        segundos,
        tabelasPublic: inv.tabelasPublic,
        tabelasRestauradas,
        ultimaMigration,
        totalErros: erros.total,
        esperados: erros.esperados,
        inesperados: erros.inesperados,
        contagens,
      });
      if (!existsSync(opts.relatorio)) mkdirSync(opts.relatorio, { recursive: true });
      const destino = join(opts.relatorio, `ensaio-restauracao-${agora.toISOString().slice(0, 10)}.md`);
      writeFileSync(destino, texto, "utf8");
      console.log(texto);
      console.log(`Relatório: ${destino}`);
      return ok ? 0 : 1;
    } finally {
      docker(opts.container, [...psqlAdmin, "-d", "postgres", "-c", `drop database if exists ${banco}`], { senha: opts.senha });
    }
  } finally {
    docker(opts.container, ["rm", "-f", noContainer]);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(main());
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exit(1);
  }
}
