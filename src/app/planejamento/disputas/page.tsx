import Link from "next/link";
import { PageHeader } from "@/components/app/PageHeader";
import { HelpTip } from "@/components/common/HelpTip";
import { DecidirDisputaForm, type PlanoCandidato } from "@/components/planejamento/DisputaReservaForms";
import { pode } from "@/lib/auth/permissao-efetiva";
import { decideDisputaReserva } from "@/lib/auth/permissions";
import { usuarioAtual } from "@/lib/auth/roles";
import { formatDateTime, formatNumber as fmt } from "@/lib/formatters";
import { createClientUntyped } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Disputa = {
  id: number;
  planejamento_destino_id: number;
  planejamento_origem_id: number | null;
  insumo_id: number;
  quantidade: number;
  motivo: string;
  status: "pendente" | "transferida" | "negada";
  solicitado_em: string;
  quantidade_transferida: number | null;
  decidido_em: string | null;
  decisao_observacao: string | null;
};

const SITUACAO: Record<Disputa["status"], string> = { pendente: "Aguardando decisão", transferida: "Transferida", negada: "Negada" };

export default async function DisputasReservaPage() {
  const podeVer = (await pode("planejamento.ver")) || (await pode("planejamento.executar"));
  if (!podeVer) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-6">
        <p className="text-sm">Sua função não permite ver as disputas de reserva.</p>
      </main>
    );
  }
  // 0178: o Gestor identifica a falta e pede; decidem Coordenador, Supervisor e Administrador.
  const usuario = await usuarioAtual();
  const podeDecidir = usuario != null && !usuario.suspenso && decideDisputaReserva(usuario.papel);
  const supabase = await createClientUntyped();
  const { data, error } = await supabase
    .from("reservas_disputas")
    .select("id, planejamento_destino_id, planejamento_origem_id, insumo_id, quantidade, motivo, status, solicitado_em, quantidade_transferida, decidido_em, decisao_observacao")
    .order("solicitado_em", { ascending: false })
    .limit(200);
  const disputas = ((data ?? []) as Disputa[]).sort((a, b) => Number(b.status === "pendente") - Number(a.status === "pendente"));
  const planoIds = [...new Set(disputas.flatMap((d) => [d.planejamento_destino_id, d.planejamento_origem_id]).filter((id): id is number => id != null))];
  const insumoIds = [...new Set(disputas.map((d) => d.insumo_id))];
  const [{ data: planos }, { data: insumos }] = await Promise.all([
    planoIds.length > 0 ? supabase.from("planejamento").select("id, nome").in("id", planoIds) : Promise.resolve({ data: [] }),
    insumoIds.length > 0 ? supabase.from("insumos").select("id, especificacao").in("id", insumoIds) : Promise.resolve({ data: [] }),
  ]);
  const nomePlano = new Map((planos ?? []).map((p: { id: number; nome: string | null }) => [Number(p.id), p.nome ?? `Plano #${p.id}`]));
  const nomeInsumo = new Map((insumos ?? []).map((i: { id: number; especificacao: string | null }) => [Number(i.id), i.especificacao ?? `Insumo #${i.id}`]));
  const candidatos = new Map<number, PlanoCandidato[]>();
  if (podeDecidir) {
    await Promise.all(disputas.filter((d) => d.status === "pendente").map(async (d) => {
      const { data: lista } = await supabase.rpc("planos_com_reserva", { p_insumo_id: d.insumo_id, p_excluir_planejamento_id: d.planejamento_destino_id });
      candidatos.set(d.id, ((lista ?? []) as PlanoCandidato[]).map((c) => ({ ...c, reservado: Number(c.reservado) })));
    }));
  }
  const pendentes = disputas.filter((d) => d.status === "pendente").length;

  return (
    <main className="app-page-container">
      <PageHeader
        breadcrumbs={[{ label: "Planejamento", href: "/planejamento" }, { label: "Disputas de reserva" }]}
        title="Disputas de reserva"
        help={
          <HelpTip title="Como funciona">
            <p>Quando um plano reservado fica com falta de um insumo que outro plano reservado segura, quem executa pode pedir a reserva do outro plano.</p>
            <p>O Gestor identifica a falta e pede, mas não decide.</p>
            <p>Coordenador, Supervisor ou Administrador decide: <b>transferir</b> (a reserva passa de um plano para o outro, lote por lote, validade mais curta primeiro) ou <b>negar</b>.</p>
            <p>O plano que cede fica com a falta e precisa repor ou reservar de novo antes de iniciar. Se duas pessoas decidirem ao mesmo tempo, só a primeira vale.</p>
          </HelpTip>
        }
        description={
          <>
            {pendentes === 0
              ? "Nenhum pedido aguardando decisão."
              : `${pendentes} ${pendentes === 1 ? "pedido aguardando" : "pedidos aguardando"} decisão${podeDecidir ? "" : " de Coordenador, Supervisor ou Administrador"}.`}
          </>
        }
      />
      {error && <p className="mt-3 text-sm text-danger-strong">Não foi possível ler os pedidos agora. Recarregue a página.</p>}
      <section className="mt-6 max-w-4xl space-y-3" aria-label="Pedidos de reserva">
        {disputas.length === 0 && !error && (
          <p className="rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">Nenhum pedido registrado.</p>
        )}
        {disputas.map((d) => {
          const destino = nomePlano.get(d.planejamento_destino_id) ?? `Plano #${d.planejamento_destino_id}`;
          const insumo = nomeInsumo.get(d.insumo_id) ?? `Insumo #${d.insumo_id}`;
          return (
            <article key={d.id} id={`disputa-${d.id}`} className="rounded-lg border border-border bg-card p-4 shadow-sm" data-testid="disputa-reserva">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">{insumo}</h2>
                <span className="rounded border border-border px-1.5 py-0.5 text-xs font-medium">{SITUACAO[d.status]}</span>
              </div>
              <p className="mt-1 text-sm">
                <Link href={`/planejamento/${d.planejamento_destino_id}`} className="text-primary hover:underline">{destino}</Link>{" "}
                pediu {fmt(d.quantidade)} em {formatDateTime(d.solicitado_em)}: “{d.motivo}”
              </p>
              {d.status !== "pendente" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {d.status === "transferida" && d.planejamento_origem_id != null
                    ? <>Transferido {fmt(d.quantidade_transferida ?? 0)} de <Link href={`/planejamento/${d.planejamento_origem_id}`} className="text-primary hover:underline">{nomePlano.get(d.planejamento_origem_id) ?? `Plano #${d.planejamento_origem_id}`}</Link></>
                    : "Negado"}
                  {d.decidido_em && ` em ${formatDateTime(d.decidido_em)}`}
                  {d.decisao_observacao && `: “${d.decisao_observacao}”`}
                </p>
              )}
              {d.status === "pendente" && podeDecidir && (
                <DecidirDisputaForm disputaId={d.id} candidatos={candidatos.get(d.id) ?? []} rotulo={`${insumo} para ${destino}`} />
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
