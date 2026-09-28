"use server";

import { execFile } from "node:child_process";
import { access, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { revalidatePath } from "next/cache";
import { temPapel } from "@/lib/auth/roles";
import { createClientUntyped } from "@/lib/supabase/server";

const execFileAsync = promisify(execFile);

// Pastas do computador do laboratório (as mesmas dos scripts em scripts/*.ps1).
// Podem ser trocadas por variável de ambiente sem mexer no código.
const APP_BACKUP_DIR = process.env.KONTROL_BACKUP_APP_DIR || "D:\\Dropbox\\Aplicativos\\Kontrol\\APP";
const DB_BACKUP_DIR = process.env.KONTROL_BACKUP_DB_DIR || "D:\\Dropbox\\Aplicativos\\Kontrol\\BD";

/**
 * Na Vercel não existe o disco do laboratório: a tela mostra só o registro dos
 * backups no banco (0134) e o botão de backup local some.
 */
function pastasLocaisDisponiveis() {
  return !process.env.VERCEL;
}

export type ExecucaoBackup = {
  id: number;
  tipo: "banco" | "arquivos";
  status: "ok" | "falha";
  concluido_em: string;
  tamanho_bytes: number | null;
  arquivos: number | null;
  detalhe: string | null;
};

async function lerRegistroBackups(): Promise<{ execucoes: ExecucaoBackup[]; erro: boolean }> {
  try {
    const supabase = await createClientUntyped();
    const { data, error } = await supabase
      .from("backups_execucoes")
      .select("id, tipo, status, concluido_em, tamanho_bytes, arquivos, detalhe")
      .order("concluido_em", { ascending: false })
      .limit(30);
    if (error) return { execucoes: [], erro: true };
    return { execucoes: (data ?? []) as ExecucaoBackup[], erro: false };
  } catch {
    return { execucoes: [], erro: true };
  }
}

export type BackupActionState = {
  ok: boolean;
  message: string;
};

type BackupFile = {
  name: string;
  path: string;
  size: number;
  modifiedAt: Date;
};

async function listarBackups(dir: string, prefix: string): Promise<BackupFile[]> {
  try {
    await access(dir);
  } catch {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
      .map(async (entry) => {
        const filePath = path.join(dir, entry.name);
        const info = await stat(filePath);
        return {
          name: entry.name,
          path: filePath,
          size: info.size,
          modifiedAt: info.mtime,
        };
      }),
  );

  return files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}

export async function obterResumoBackups() {
  if (!(await temPapel("admin"))) {
    return null;
  }

  const local = pastasLocaisDisponiveis();
  const [appBackups, dbBackups, registro] = await Promise.all([
    local ? listarBackups(APP_BACKUP_DIR, "kontrol-app-") : Promise.resolve([]),
    local ? listarBackups(DB_BACKUP_DIR, "kontrol-db-cloud-") : Promise.resolve([]),
    lerRegistroBackups(),
  ]);

  return {
    local,
    appDir: APP_BACKUP_DIR,
    dbDir: DB_BACKUP_DIR,
    appBackups,
    dbBackups,
    registro: registro.execucoes,
    registroIndisponivel: registro.erro,
  };
}

export async function executarBackupAplicativo(
  prevState: BackupActionState,
): Promise<BackupActionState> {
  void prevState;

  if (!(await temPapel("admin"))) {
    return { ok: false, message: "Acesso restrito ao administrador." };
  }
  if (!pastasLocaisDisponiveis()) {
    return {
      ok: false,
      message: "O backup do aplicativo roda só no computador do laboratório (localhost), não no site publicado.",
    };
  }

  const scriptPath = path.join(process.cwd(), "scripts", "backup-app-local.ps1");

  try {
    await mkdir(APP_BACKUP_DIR, { recursive: true });
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-SourcePath",
        process.cwd(),
        "-DestinationPath",
        APP_BACKUP_DIR,
      ],
      {
        cwd: process.cwd(),
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 4,
      },
    );

    revalidatePath("/governanca/backups");
    return {
      ok: true,
      message: "Backup do aplicativo criado. A retenção manteve no máximo 5 versões.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida.";
    return {
      ok: false,
      message: `Não foi possível criar o backup do aplicativo: ${message}`,
    };
  }
}
