import Link from "next/link";
import { statusInfo } from "@/components/app/status";
import { formatCurrency as brl } from "@/lib/formatters";
import type { PedidoInternoItem, PedidoDetalhe } from "@/lib/pedido/detalhe";
import { Referencia } from "@/components/pedido/detalhe/Referencia";

type Props = {
  linhas: PedidoInternoItem[];
  itensFisicos: PedidoInternoItem[];
  itensRecebidos: number;
  total: number;
  compraFormal: { id: number; status: string; } | null;
  pedido: PedidoDetalhe;
  modalidadeLabel: Record<string, string>;
  temDocumentoCotacao: boolean;
  temDocumentoFiscal: boolean;
};

/** Resumo do pedido: contagens e referências. */
export function PedidoResumo({
  linhas,
  itensFisicos,
  itensRecebidos,
  total,
  compraFormal,
  pedido,
  modalidadeLabel,
  temDocumentoCotacao,
  temDocumentoFiscal,
}: Props) {
  return (
    <aside className="rounded-lg border border-border bg-card p-3 text-sm shadow-sm">
      <h2 className="text-sm font-semibold">Resumo do pedido</h2>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-md border border-border bg-muted/30 px-2 py-2">
          <p className="text-muted-foreground">Itens</p>
          <p className="text-base font-semibold tabular-nums">{linhas.length}</p>
        </div>
        <div className="rounded-md border border-border bg-muted/30 px-2 py-2">
          <p className="text-muted-foreground">Recebidos</p>
          <p className="text-base font-semibold tabular-nums">{itensFisicos.length ? `${itensRecebidos}/${itensFisicos.length}` : "—"}</p>
        </div>
        <div className="rounded-md border border-border bg-muted/30 px-2 py-2">
          <p className="text-muted-foreground">Valor prévio</p>
          <p className="text-base font-semibold tabular-nums">{brl(total)}</p>
        </div>
      </div>
      <dl className="mt-3 grid gap-x-5 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Referencia label="Compra">
          {compraFormal ? (
            <Link href={`/compras/${compraFormal.id}`} className="text-primary hover:underline">
              #{compraFormal.id} · {statusInfo(compraFormal.status).label}
            </Link>
          ) : "—"}
        </Referencia>
        <Referencia label="Modalidade">{pedido.modalidade_compra ? modalidadeLabel[pedido.modalidade_compra] ?? pedido.modalidade_compra : "—"}</Referencia>
        <Referencia label="Instituição">{pedido.instituicao_destino ?? "—"}</Referencia>
        <Referencia label="Protocolo">{pedido.protocolo_externo ?? "—"}</Referencia>
        <Referencia label="Fonte">{pedido.fonte_recurso ?? "—"}</Referencia>
        <Referencia label="Rubrica">{pedido.rubrica ?? "—"}</Referencia>
        <Referencia label="Doc. cotação">{temDocumentoCotacao ? "registrado" : "pendente"}</Referencia>
        <Referencia label="Doc. fiscal">{temDocumentoFiscal ? "registrado" : "pendente"}</Referencia>
      </dl>
    </aside>
  );
}
