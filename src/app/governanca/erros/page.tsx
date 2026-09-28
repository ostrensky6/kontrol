import { Bug } from "lucide-react";

import { HelpTip } from "@/components/common/HelpTip";
import { temPapel } from "@/lib/auth/roles";
import { formatDateTime } from "@/lib/formatters";
import { createClientUntyped } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ErroApp = {
  id: number;
  ocorrido_em: string;
  origem: "servidor" | "navegador" | "banco";
  rota: string | null;
  mensagem: string;
  codigo: string | null;
  digest: string | null;
  detalhe: string | null;
};

const ORIGEM: Record<ErroApp["origem"], string> = {
  servidor: "Servidor",
  navegador: "Tela",
  banco: "Banco",
};

export default async function ErrosAppPage() {
  if (!(await temPapel("admin"))) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 text-center font-sans sm:px-6 sm:py-8">
        <p className="text-muted-foreground">Acesso restrito ao administrador.</p>
      </main>
    );
  }

  const supabase = await createClientUntyped();
  const { data, error } = await supabase
    .from("erros_app")
    .select("id, ocorrido_em, origem, rota, mensagem, codigo, digest, detalhe")
    .order("ocorrido_em", { ascending: false })
    .limit(100);
  const erros = (data ?? []) as ErroApp[];

  return (
    <main className="mx-auto max-w-[1720px] px-3 py-5 font-sans text-foreground sm:px-4 sm:py-6 lg:px-5">
      <div className="flex items-center gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Erros do app</h1>
        <HelpTip title="Erros do app">
          <p>
            Os últimos 100 erros registrados: falhas de tela, do servidor e recusas técnicas do banco
            que o usuário viu como &quot;Não foi possível concluir&quot;. Quando há erro, os
            administradores recebem um aviso em Notificações, no máximo um por hora. Registros com
            mais de 90 dias são apagados.
          </p>
        </HelpTip>
      </div>

      {error ? (
        <p role="alert" className="mt-6 rounded-md border border-border bg-card p-4 text-sm">
          Não foi possível ler o registro de erros. Se a migration 0141 ainda não foi aplicada
          neste banco, aplique-a com <b>npm run db:migration</b>.
        </p>
      ) : erros.length === 0 ? (
        <p className="mt-6 rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          <Bug className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
          Nenhum erro registrado nos últimos 90 dias.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          {erros.map((erro) => (
            <li key={erro.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(erro.ocorrido_em)}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{ORIGEM[erro.origem]}</span>
                {erro.rota && <span className="break-all font-mono text-xs">{erro.rota}</span>}
                {erro.codigo && <span className="font-mono text-xs text-muted-foreground">código {erro.codigo}</span>}
              </div>
              <p className="mt-1 break-words font-medium">{erro.mensagem}</p>
              {(erro.detalhe || erro.digest) && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Detalhes</summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs">
                    {[erro.digest && `digest ${erro.digest}`, erro.detalhe].filter(Boolean).join("\n")}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
