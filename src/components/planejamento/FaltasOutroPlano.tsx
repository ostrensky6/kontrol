import Link from "next/link";
import { createClientUntyped } from "@/lib/supabase/server";
import { formatNumber as fmt } from "@/lib/formatters";
import { PedirReservaForm } from "./DisputaReservaForms";

const SITUACAO: Record<string, string> = { pendente: "Aguardando decisão", transferida: "Transferida", negada: "Negada" };

type Falta = { insumo_id: number; quantidade: number; quantidade_consumida: number | null };
type Disputa = { id: number; insumo_id: number; status: string; quantidade: number; quantidade_transferida: number | null; decisao_observacao: string | null };

/**
 * Faltas registradas na reserva do plano e pedidos de reserva de outro plano
 * (0163). Só aparece com o plano reservado e com falta ou pedido.
 */
export async function FaltasOutroPlano({ planId, reservado, podeExecutar }: { planId: number; reservado: boolean; podeExecutar: boolean }) {
  const supabase = await createClientUntyped();
  const [{ data: faltas }, { data: disputas }] = await Promise.all([
    supabase.from("reservas_estoque").select("insumo_id, quantidade, quantidade_consumida")
      .eq("planejamento_id", planId).is("lote_id", null).eq("status", "parcial"),
    supabase.from("reservas_disputas").select("id, insumo_id, status, quantidade, quantidade_transferida, decisao_observacao")
      .eq("planejamento_destino_id", planId).order("solicitado_em", { ascending: false }),
  ]);
  const linhas = (faltas ?? []) as Falta[];
  const ids = [...new Set(linhas.map((f) => Number(f.insumo_id)))];
  const { data: insumos } = ids.length > 0
    ? await supabase.from("insumos").select("id, especificacao").in("id", ids)
    : { data: [] };
  const nomes = new Map((insumos ?? []).map((i: { id: number; especificacao: string | null }) => [Number(i.id), i.especificacao]));
  const porInsumo = new Map<number, { nome: string; falta: number }>();
  for (const f of linhas) {
    const atual = porInsumo.get(Number(f.insumo_id)) ?? { nome: nomes.get(Number(f.insumo_id)) ?? `Insumo #${f.insumo_id}`, falta: 0 };
    atual.falta += Number(f.quantidade) - Number(f.quantidade_consumida ?? 0);
    porInsumo.set(Number(f.insumo_id), atual);
  }
  const lista = (disputas ?? []) as Disputa[];
  if (porInsumo.size === 0 && lista.length === 0) return null;
  const pendente = new Set(lista.filter((d) => d.status === "pendente").map((d) => Number(d.insumo_id)));
  return (
    <section id="faltas-outro-plano" className="mt-8 scroll-mt-24 rounded-lg border border-border bg-card p-4 shadow-sm" aria-labelledby="faltas-outro-plano-titulo">
      <h2 id="faltas-outro-plano-titulo" className="text-base font-semibold">Falta na reserva: pedir de outro plano</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Se outro plano reservado segura o insumo que falta aqui, peça a reserva dele. Coordenador ou acima decide em{" "}
        <Link href="/planejamento/disputas" className="text-primary hover:underline">Disputas de reserva</Link>; o outro plano fica com a falta.
      </p>
      {porInsumo.size > 0 && (
        <ul className="mt-3 space-y-3">
          {[...porInsumo].map(([insumoId, f]) => (
            <li key={insumoId} className="space-y-1 border-t border-border/60 pt-2 first:border-t-0 first:pt-0" data-testid="falta-reserva">
              <p className="text-sm"><span className="font-medium">{f.nome}</span> · falta {fmt(f.falta)}</p>
              {pendente.has(insumoId) ? (
                <p className="text-xs text-muted-foreground">Pedido aguardando decisão.</p>
              ) : reservado && podeExecutar ? (
                <PedirReservaForm planId={planId} insumoId={insumoId} insumo={f.nome} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {lista.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs" aria-label="Pedidos deste plano">
          {lista.map((d) => (
            <li key={d.id}>
              <Link href={`/planejamento/disputas#disputa-${d.id}`} className="text-primary hover:underline">Pedido #{d.id}</Link>{" "}
              · {SITUACAO[d.status] ?? d.status}
              {d.quantidade_transferida != null && ` · ${fmt(d.quantidade_transferida)} recebido`}
              {d.decisao_observacao && ` · “${d.decisao_observacao}”`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
