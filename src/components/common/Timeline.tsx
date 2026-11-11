import { formatDateTime as quando } from "@/lib/formatters";
import { PEDIDO_INTERNO_STATUS } from "@/lib/pedido/status";

type Evento = {
  id: number;
  de_status: string | null;
  para_status: string;
  usuario: string | null;
  observacao: string | null;
  criado_em: string;
};

// Situações de compras e orçamentos. As do pedido vêm da mesma tabela que a
// tela do pedido usa, para a linha do tempo dizer o mesmo nome (glossário 10.5).
const STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado",
  aprovado: "Aprovado",
  recusado: "Recusado",
  solicitado: "Solicitado",
  em_transito: "Em trânsito",
  recebido: "Recebido",
  cancelado: "Cancelado",
  ...Object.fromEntries(Object.entries(PEDIDO_INTERNO_STATUS).map(([chave, info]) => [chave, info.label])),
};

const rotulo = (s: string | null) => (s ? STATUS_LABEL[s] ?? s : null);

/** Linha do tempo de transições de status (Fase 3.4). */
export function Timeline({ eventos }: { eventos: Evento[] }) {
  if (eventos.length === 0) {
    return <p className="text-sm text-muted-foreground/80">Sem eventos registrados ainda.</p>;
  }
  return (
    <ol className="space-y-3">
      {eventos.map((e) => (
        <li key={e.id} className="flex gap-3">
          <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
          <div className="min-w-0">
            <p className="text-sm">
              {rotulo(e.de_status) && (
                <span className="text-muted-foreground">{rotulo(e.de_status)} → </span>
              )}
              <span className="font-medium">{rotulo(e.para_status)}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {quando(e.criado_em)}
              {e.usuario ? ` · ${e.usuario}` : ""}
            </p>
            {e.observacao && (
              <p className="mt-0.5 text-xs text-muted-foreground">{e.observacao}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
