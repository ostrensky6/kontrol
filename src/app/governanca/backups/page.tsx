import { Clock, DatabaseBackup, FolderArchive, ShieldCheck } from "lucide-react";
import { obterResumoBackups } from "@/lib/actions/backups";
import { BackupAplicativoButton } from "@/components/governanca/BackupAplicativoButton";
import { HelpTip } from "@/components/common/HelpTip";
import { APP_LOCALE, formatDateTime } from "@/lib/formatters";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toLocaleString(APP_LOCALE, {
    maximumFractionDigits: 1,
  })} ${units[index]}`;
}

function formatDate(date: Date) {
  return formatDateTime(date);
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={3} className="px-4 py-6 text-center text-sm text-muted-foreground/80">
        {children}
      </td>
    </tr>
  );
}

export default async function BackupsPage() {
  const resumo = await obterResumoBackups();

  if (!resumo) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 text-center font-sans">
        <p className="text-muted-foreground">
          Acesso restrito: backups locais são uma operação de administrador.
        </p>
      </main>
    );
  }

  const ultimoApp = resumo.appBackups[0];
  const ultimoDb = resumo.dbBackups[0];

  return (
    <main className="mx-auto max-w-[1720px] px-3 py-5 font-sans text-foreground sm:px-4 sm:py-6 lg:px-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Backups</h1>
          <HelpTip title="Backups">
            <p>Cópias locais administradas para aplicativo e banco de dados em nuvem.</p>
          </HelpTip>
        </div>
        <span className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Governança
        </span>
      </div>

      <section className="mt-6 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center gap-1 border-b border-border/70 px-4 py-3">
          <h2 className="text-sm font-semibold">Registro dos backups</h2>
          <HelpTip title="Registro dos backups">
            <p>
              Cada execução do backup do banco e da cópia dos arquivos grava uma linha aqui. Se o
              último backup bom passar de 26 horas ou houver falha, os administradores recebem aviso
              em Notificações.
            </p>
          </HelpTip>
        </div>
        {resumo.registroIndisponivel ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground/80">
            Não foi possível ler o registro dos backups neste banco.
          </p>
        ) : resumo.registro.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground/80">
            Nenhuma execução registrada ainda.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Quando</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Resultado</th>
                  <th className="px-4 py-3 text-right">Tamanho</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {resumo.registro.map((execucao) => (
                  <tr key={execucao.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatDateTime(execucao.concluido_em)}
                    </td>
                    <td className="px-4 py-3">{execucao.tipo === "banco" ? "Banco" : "Arquivos"}</td>
                    <td className="px-4 py-3">
                      {execucao.status === "ok" ? (
                        "Concluído"
                      ) : (
                        <span className="font-semibold text-destructive" title={execucao.detalhe ?? undefined}>
                          Falhou{execucao.detalhe ? `: ${execucao.detalhe}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                      {execucao.tamanho_bytes != null ? formatBytes(execucao.tamanho_bytes) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {resumo.local ? (
        <>
      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <FolderArchive className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <div className="flex items-center gap-1">
              <h2 className="text-lg font-semibold">Aplicativo local</h2>
              <HelpTip title="Aplicativo local">
                <p>
                  Backup manual da versão atual em localhost, salvo em{" "}
                  <b className="break-all">{resumo.appDir}</b>.
                </p>
              </HelpTip>
            </div>
          </div>
          <div className="mt-5">
            <BackupAplicativoButton />
          </div>
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-md border border-border/70 bg-muted/50 p-3">
              <dt className="text-xs font-medium uppercase text-muted-foreground">Retenção</dt>
              <dd className="mt-1 font-semibold">5 últimas versões</dd>
            </div>
            <div className="rounded-md border border-border/70 bg-muted/50 p-3">
              <dt className="text-xs font-medium uppercase text-muted-foreground">Último backup</dt>
              <dd className="mt-1 font-semibold">
                {ultimoApp ? formatDate(ultimoApp.modifiedAt) : "Nenhum"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <DatabaseBackup className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <div className="flex items-center gap-1">
              <h2 className="text-lg font-semibold">Banco da nuvem</h2>
              <HelpTip title="Banco da nuvem">
                <p>
                  Dump automático da nuvem salvo em <b className="break-all">{resumo.dbDir}</b>.
                </p>
              </HelpTip>
            </div>
          </div>
          <div className="mt-5 rounded-md border border-border/70 bg-muted/50 p-4 text-sm">
            <div className="flex items-center gap-2 font-semibold">
              <Clock className="h-4 w-4" aria-hidden="true" />
              Agendamento Windows
              <HelpTip title="Como agendar">
                <p>
                  No computador do administrador, execute uma vez{" "}
                  <b>scripts\install-windows-backup-tasks.ps1</b>. Ele registra as tarefas do Windows
                  que fazem os backups.
                </p>
              </HelpTip>
            </div>
            <p className="mt-2 text-muted-foreground">Backups automáticos às 00:30 e às 12:30.</p>
          </div>
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-md border border-border/70 bg-muted/50 p-3">
              <dt className="flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground">
                Retenção
                <HelpTip title="Retenção dos dumps">
                  <p>
                    Os backups diários ficam guardados por 30 dias. Os dos dias 1 e 15 de cada mês são
                    mantidos <b>sem prazo</b>.
                  </p>
                </HelpTip>
              </dt>
              <dd className="mt-1 font-semibold">30 dias; dias 1 e 15 indefinidos</dd>
            </div>
            <div className="rounded-md border border-border/70 bg-muted/50 p-3">
              <dt className="text-xs font-medium uppercase text-muted-foreground">Último backup</dt>
              <dd className="mt-1 font-semibold">
                {ultimoDb ? formatDate(ultimoDb.modifiedAt) : "Nenhum"}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="border-b border-border/70 px-4 py-3">
            <h2 className="text-sm font-semibold">Versões do aplicativo</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Arquivo</th>
                <th className="px-4 py-3 text-left">Quando</th>
                <th className="px-4 py-3 text-right">Tamanho</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {resumo.appBackups.length ? (
                resumo.appBackups.map((backup) => (
                  <tr key={backup.path}>
                    <td className="max-w-0 truncate px-4 py-3 font-medium" title={backup.name}>
                      {backup.name}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatDate(backup.modifiedAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                      {formatBytes(backup.size)}
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyRow>Nenhuma versão do aplicativo encontrada.</EmptyRow>
              )}
            </tbody>
          </table>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="border-b border-border/70 px-4 py-3">
            <h2 className="text-sm font-semibold">Dumps do banco</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Arquivo</th>
                <th className="px-4 py-3 text-left">Quando</th>
                <th className="px-4 py-3 text-right">Tamanho</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {resumo.dbBackups.length ? (
                resumo.dbBackups.slice(0, 80).map((backup) => (
                  <tr key={backup.path}>
                    <td className="max-w-0 truncate px-4 py-3 font-medium" title={backup.name}>
                      {backup.name}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatDate(backup.modifiedAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                      {formatBytes(backup.size)}
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyRow>Nenhum dump do banco encontrado.</EmptyRow>
              )}
            </tbody>
          </table>
        </div>
      </section>
        </>
      ) : (
        <p className="mt-6 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          As cópias ficam no computador do laboratório. Aqui no site publicado aparece só o
          registro acima; a lista de arquivos e o backup do aplicativo abrem no Kontrol local.
        </p>
      )}
    </main>
  );
}
