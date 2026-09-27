import Link from "next/link";
import { PageShell } from "@/components/app/PageShell";
import {
  arquivarNotificacao,
  marcarNotificacaoLida,
  marcarTodasNotificacoesLidas,
} from "@/lib/actions/notificacoes";
import { caminhoNotificacao, destinoNotificacao, rotuloTipoNotificacao } from "@/lib/notifications/links";
import { createClient } from "@/lib/supabase/server";

type Notificacao = {
  id: number;
  tipo: string;
  titulo: string;
  corpo: string | null;
  entidade_tipo: string | null;
  entidade_id: number | null;
  papel_destino: string | null;
  permissao_destino: string | null;
  usuario_destino: string | null;
  status: string;
  criado_em: string;
};

function formatarData(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function badgeClass(status: string) {
  if (status === "nao_lida") {
    return "border-danger-strong/30 bg-danger-soft text-danger-strong";
  }
  if (status === "arquivada") {
    return "border-border bg-muted/50 text-muted-foreground";
  }
  return "border-success-strong/30 bg-success-soft text-success-strong";
}

export default async function NotificacoesPage() {
  const supabase = await createClient();
  // Só os avisos destinados a este usuário (por pessoa, papel ou permissão),
  // com o estado de leitura dele (0128).
  const { data } = await supabase
    .from("v_minhas_notificacoes")
    .select(
      "id,tipo,titulo,corpo,entidade_tipo,entidade_id,papel_destino,permissao_destino,usuario_destino,status,criado_em",
    )
    .neq("status", "arquivada")
    .order("criado_em", { ascending: false })
    .limit(80);

  const notificacoes = (data ?? []) as Notificacao[];
  const naoLidas = notificacoes.filter((item) => item.status === "nao_lida").length;
  const aguardandoAcao = notificacoes.filter(
    (item) => item.tipo === "aprovacao_pendente" && item.status === "nao_lida",
  ).length;
  const estoque = notificacoes.filter(
    (item) => ["reposicao", "falta_plano", "vencimento"].includes(item.tipo) && item.status === "nao_lida",
  ).length;

  return (
    <PageShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Suprimentos
          </p>
          <h1 className="text-2xl font-bold text-foreground">Notificações</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Avisos para você: etapas que esperam sua ação, faltas, reposições e vencimentos.
          </p>
        </div>
        {naoLidas > 0 && (
          <form action={marcarTodasNotificacoesLidas}>
            <button
              type="submit"
              className="rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground shadow-sm hover:bg-muted/50"
            >
              Marcar todas como lidas
            </button>
          </form>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 2xl:grid-cols-4">
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Não lidas
          </p>
          <p className="mt-2 text-2xl font-bold text-foreground">{naoLidas}</p>
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Aguardando sua ação
          </p>
          <p className="mt-2 text-2xl font-bold text-foreground">{aguardandoAcao}</p>
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Estoque e reposição
          </p>
          <p className="mt-2 text-2xl font-bold text-foreground">{estoque}</p>
        </div>
      </div>

      {notificacoes.length === 0 ? (
        <div className="rounded-md border border-dashed border-input bg-card p-5 text-sm text-muted-foreground">
          Nenhuma notificação para você.
        </div>
      ) : (
        <div className="space-y-2">
          {notificacoes.map((item) => {
            const href = caminhoNotificacao(item.entidade_tipo, item.entidade_id);
            return (
              <article
                key={item.id}
                className="rounded-md border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeClass(
                          item.status,
                        )}`}
                      >
                        {item.status === "nao_lida" ? "não lida" : item.status}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">
                        {rotuloTipoNotificacao(item.tipo)} • {formatarData(item.criado_em)}
                      </span>
                    </div>
                    <h2 className="mt-2 text-base font-semibold text-foreground">
                      {item.titulo}
                    </h2>
                    {item.corpo && (
                      <p className="mt-1 text-sm text-muted-foreground">{item.corpo}</p>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Para: {destinoNotificacao(item)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {href && (
                      <Link
                        href={href}
                        className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/50"
                      >
                        Abrir
                      </Link>
                    )}
                    {item.status === "nao_lida" && (
                      <form action={marcarNotificacaoLida}>
                        <input type="hidden" name="notificacao_id" value={item.id} />
                        <button
                          type="submit"
                          aria-label={`Marcar como lida: ${item.titulo}`}
                          className="rounded-md border border-success-strong/30 bg-success-soft px-3 py-1.5 text-xs font-semibold text-success-strong hover:bg-success-soft"
                        >
                          Lida
                        </button>
                      </form>
                    )}
                    <form action={arquivarNotificacao}>
                      <input type="hidden" name="notificacao_id" value={item.id} />
                      <button
                        type="submit"
                        aria-label={`Arquivar: ${item.titulo}`}
                        className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/50"
                      >
                        Arquivar
                      </button>
                    </form>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
