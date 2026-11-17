import { formatDateTime } from "@/lib/formatters";
import { DECISAO_LABEL, type PedidoInternoAprovacao, rotuloEtapa } from "@/lib/pedido/detalhe";

type Props = {
  aprovacaoRows: PedidoInternoAprovacao[];
};

/** Aprovações e decisões registradas no pedido. */
export function PedidoAprovacoes({
  aprovacaoRows,
}: Props) {
  return (
    <section className="mt-8 rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold">Aprovações e decisões</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {aprovacaoRows.map((aprovacao) => (
          <div key={aprovacao.id} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{rotuloEtapa(aprovacao.etapa) ?? "—"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {aprovacao.responsavel ?? "—"} · {aprovacao.papel ?? "—"} · {formatDateTime(aprovacao.criado_em)}
                </p>
              </div>
              <span className="rounded-md bg-muted px-2 py-1 text-xs">{DECISAO_LABEL[aprovacao.decisao] ?? aprovacao.decisao}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {rotuloEtapa(aprovacao.status_origem) ?? "início"} → {rotuloEtapa(aprovacao.status_destino) ?? "—"}
            </p>
            {aprovacao.comentario && (
              <p className="mt-2 text-xs leading-5 text-foreground">{aprovacao.comentario}</p>
            )}
          </div>
        ))}
        {aprovacaoRows.length === 0 && (
          <p className="text-sm text-muted-foreground/80">Nenhuma aprovação formal registrada ainda.</p>
        )}
      </div>
    </section>
  );
}
