#!/usr/bin/env node
// Cópia dos arquivos do Supabase Storage (anexos, assinaturas...). O pg_dump
// leva só a lista de arquivos (storage.objects), não o conteúdo — sem esta
// cópia, restaurar o banco devolveria anexos quebrados (auditoria de 27/09, item 3).
//
// Uso:
//   node scripts/backup-storage.mjs --env-file G:\Aplicativos\Kontrol\.env.local --destino D:\Dropbox\Aplicativos\Kontrol\ARQUIVOS [--manter 14]
//
// Lê NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (do ambiente ou do
// --env-file). Cada execução vira uma pasta kontrol-arquivos-AAAAMMDD-HHMMSS com
// os arquivos por bucket e um manifesto.json; ficam as N mais recentes. O
// resultado (ok ou falha) é registrado em public.backups_execucoes (0134).
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PREFIXO_PASTA = "kontrol-arquivos-";

export function nomePasta(data = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${PREFIXO_PASTA}${data.getFullYear()}${p(data.getMonth() + 1)}${p(data.getDate())}-${p(data.getHours())}${p(data.getMinutes())}${p(data.getSeconds())}`;
}

/** Caminho local de um objeto; recusa nomes que escapariam da pasta do bucket. */
export function caminhoLocal(raiz, bucket, caminho) {
  const partes = [bucket, ...String(caminho).split("/")];
  if (partes.some((p) => !p || p === "." || p === ".." || /[<>:"|?*\\]/.test(p))) {
    throw new Error(`Nome de arquivo inseguro no Storage: ${bucket}/${caminho}`);
  }
  return join(raiz, ...partes);
}

/** Pastas de cópia antigas a apagar, mantendo as `manter` mais recentes. */
export function pastasParaApagar(nomes, manter) {
  return nomes
    .filter((n) => n.startsWith(PREFIXO_PASTA))
    .sort()
    .reverse()
    .slice(Math.max(0, manter));
}

export function lerEnvFile(caminho) {
  const env = {};
  for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

/** Lista recursiva: pastas no Storage vêm sem id. */
async function listarObjetos(storage, bucket, prefixo = "") {
  const objetos = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await storage.from(bucket).list(prefixo, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`Listar ${bucket}/${prefixo}: ${error.message}`);
    for (const item of data ?? []) {
      const caminho = prefixo ? `${prefixo}/${item.name}` : item.name;
      if (item.id == null) objetos.push(...(await listarObjetos(storage, bucket, caminho)));
      else objetos.push({ caminho, tamanho: Number(item.metadata?.size ?? 0), atualizado: item.updated_at ?? null });
    }
    if (!data || data.length < 1000) break;
  }
  return objetos;
}

function argumentos(argv) {
  const out = { manter: 14 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--env-file") out.envFile = argv[++i];
    else if (a === "--destino") out.destino = argv[++i];
    else if (a === "--manter") out.manter = Number(argv[++i]);
    else throw new Error(`Opção desconhecida: ${a}`);
  }
  if (!out.destino) throw new Error("Informe --destino <pasta>");
  if (!Number.isInteger(out.manter) || out.manter < 1) throw new Error("--manter precisa ser inteiro >= 1");
  return out;
}

async function registrar(cliente, dados) {
  const { error } = await cliente.from("backups_execucoes").insert({ tipo: "arquivos", origem: `${hostname()} backup-storage`, ...dados });
  if (error) console.error(`Aviso: não foi possível registrar a execução (${error.message}).`);
}

async function main() {
  const opts = argumentos(process.argv.slice(2));
  const env = { ...(opts.envFile ? lerEnvFile(opts.envFile) : {}), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const chave = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    // código 2: não deu nem para registrar a falha; quem chamou registra (backup-database-cloud.ps1)
    console.error("Faltam NEXT_PUBLIC_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY: a cópia dos arquivos não rodou.");
    return 2;
  }
  const cliente = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
  const iniciado = new Date();
  const pasta = join(opts.destino, nomePasta(iniciado));

  try {
    const { data: buckets, error } = await cliente.storage.listBuckets();
    if (error) throw new Error(`Listar buckets: ${error.message}`);
    const manifesto = { criado_em: iniciado.toISOString(), origem: new URL(url).host, buckets: {} };
    let arquivos = 0;
    let bytes = 0;
    mkdirSync(pasta, { recursive: true });
    for (const bucket of buckets ?? []) {
      const objetos = await listarObjetos(cliente.storage, bucket.name);
      manifesto.buckets[bucket.name] = objetos;
      for (const obj of objetos) {
        const { data: blob, error: erroDownload } = await cliente.storage.from(bucket.name).download(obj.caminho);
        if (erroDownload || !blob) throw new Error(`Baixar ${bucket.name}/${obj.caminho}: ${erroDownload?.message ?? "vazio"}`);
        const destino = caminhoLocal(pasta, bucket.name, obj.caminho);
        mkdirSync(dirname(destino), { recursive: true });
        const conteudo = Buffer.from(await blob.arrayBuffer());
        writeFileSync(destino, conteudo);
        arquivos += 1;
        bytes += conteudo.length;
      }
    }
    writeFileSync(join(pasta, "manifesto.json"), JSON.stringify(manifesto, null, 2), "utf8");

    for (const antiga of pastasParaApagar(readdirSync(opts.destino), opts.manter)) {
      rmSync(join(opts.destino, antiga), { recursive: true, force: true });
    }
    await registrar(cliente, {
      status: "ok",
      iniciado_em: iniciado.toISOString(),
      concluido_em: new Date().toISOString(),
      tamanho_bytes: bytes,
      arquivos,
    });
    console.log(`Cópia dos arquivos em ${pasta}: ${arquivos} arquivo(s), ${bytes} bytes, ${Object.keys(manifesto.buckets).length} bucket(s).`);
    return 0;
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    // cópia pela metade não serve de backup
    rmSync(pasta, { recursive: true, force: true });
    await registrar(cliente, {
      status: "falha",
      iniciado_em: iniciado.toISOString(),
      concluido_em: new Date().toISOString(),
      detalhe: motivo.slice(0, 1000),
    });
    console.error(`Falha na cópia dos arquivos: ${motivo}`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((codigo) => process.exit(codigo))
    .catch((erro) => {
      console.error(erro instanceof Error ? erro.message : erro);
      process.exit(1);
    });
}

