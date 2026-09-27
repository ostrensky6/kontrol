import Link from "next/link";
import { createClient, createClientUntyped } from "@/lib/supabase/server";
import { pode } from "@/lib/auth/permissao-efetiva";
import { GerarPedidoReposicaoButton } from "@/components/pedido/GerarPedidoReposicaoButton";
import { HelpTip } from "@/components/common/HelpTip";
import { hojeIso, loteBaixaDeDb, loteVencido, somarReservasPorLote, type LoteDbBaixa } from "@/lib/estoque/baixa";
import { StockControlHub } from "./StockControlHub";

export const dynamic = "force-dynamic";

type LoteDbRow = LoteDbBaixa & {
  insumo_id: number;
  insumos: { especificacao: string | null; unidade: string | null; categoria_compra: string | null } | null;
};

const LOTE_STATUS: Record<string, string> = {
  quarentena: "Quarentena",
  aceito: "Aceito",
  em_uso: "Em uso",
  bloqueado: "Bloqueado",
  consumido: "Consumido",
  descartado: "Descartado",
};

export default async function EstoqueControlePage() {
  const supabase = await createClient();
  // modelo_quantidade (0109) ainda não está nos tipos gerados.
  const supabaseSemTipos = await createClientUntyped();
  const [
    { data: notificacoesRaw },
    { data: saldoRaw },
    { data: alertasRaw },
    { data: lotesRaw },
    { data: reservasRaw },
    { data: vinculosCompra, error: vinculosCompraError },
    { data: vinculosInternos, error: vinculosInternosError },
  ] = await Promise.all([
    supabase
      .from("notificacoes")
      .select("id, tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, canal, status, criado_em")
      .not("status", "in", "(arquivada)")
      .order("criado_em", { ascending: false }),
    supabase.from("v_estoque_saldo").select("*").order("especificacao"),
    supabase.from("v_alertas_estoque").select("*"),
    supabaseSemTipos
      .from("lotes_estoque")
      .select("id, insumo_id, codigo_lote, validade, validade_apos_abertura, quantidade_atual, status, modelo_quantidade, insumos(especificacao, unidade, categoria_compra)")
      .not("status", "in", "(consumido,descartado)")
      .order("validade", { nullsFirst: false }),
    supabase
      .from("reservas_estoque")
      .select("lote_id, quantidade, quantidade_consumida, status")
      .in("status", ["reservado", "parcial"]),
    supabase.from("pedidos_compra_item_recebimentos").select("lote_id"),
    supabase.from("pedidos_internos_item_recebimentos").select("lote_id"),
  ]);
  const reservadoPorLote = somarReservasPorLote(reservasRaw ?? []);
  // estorno direto só quando é comprovado que o lote não veio de um pedido (mesma regra de /estoque)
  const origemEstornoComprovada = !vinculosCompraError && !vinculosInternosError;
  const lotesVinculados = new Set([
    ...(vinculosCompra ?? []).map((r) => Number(r.lote_id)),
    ...(vinculosInternos ?? []).map((r) => Number(r.lote_id)),
  ]);

  const [podeAceitar, podeGerir, podeCorrigir, podeBaixar, podeCriarPedido] = await Promise.all([
    pode("estoque.lote.aceitar"),
    pode("estoque.descartar_bloquear"),
    pode("estoque.lote.gerir"),
    pode("estoque.movimentar"),
    pode("pedido.criar"),
  ]);

  const notificacoes = notificacoesRaw ?? [];
  const saldo = saldoRaw ?? [];
  const alertas = alertasRaw ?? [];
  const dbLotes = (lotesRaw ?? []) as unknown as LoteDbRow[];

  const hoje = hojeIso();
  const lotesParsed = dbLotes.map((l) => {
    const baixa = loteBaixaDeDb(l, reservadoPorLote);

    return {
      id: l.id,
      insumoId: Number(l.insumo_id),
      estornoDiretoPermitido: origemEstornoComprovada && !lotesVinculados.has(Number(l.id)),
      codigoLote: l.codigo_lote ?? "—",
      validade: baixa.validade ?? "—",
      validadeIso: baixa.validade,
      quantidadeAtual: baixa.quantidadeAtual,
      reservado: baixa.reservado,
      modeloQuantidade: baixa.modeloQuantidade,
      status: l.status,
      statusLabel: LOTE_STATUS[l.status] ?? l.status,
      especificacao: l.insumos?.especificacao ?? "—",
      unidade: baixa.modeloQuantidade === "EMBALAGEM_FECHADA" ? "frasco(s)" : (l.insumos?.unidade ?? ""),
      vencido: loteVencido(baixa.validade, hoje),
      critico: l.insumos?.categoria_compra === "critico",
    };
  });

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Suprimentos · Estoque e equipamentos
            </p>
            <div className="mt-1 flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">Controle de Estoque</h1>
              <HelpTip title="Controle de estoque">
                <p>
                  Painel de acompanhamento: veja o estoque <b>por insumo</b>, <b>por lote</b> ou em
                  gráficos e filtre pelo tipo de alerta.
                </p>
                <p>
                  As ações de cada lote (aceitar, dar baixa, bloquear, descartar) ficam registradas com
                  quem fez e quando.
                </p>
              </HelpTip>
            </div>
            <nav aria-label="Ferramentas de estoque" className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <Link href="/estoque/inventario" className="font-medium text-primary hover:underline">Inventário (contagem)</Link>
              <Link href="/etiquetas?tipo=lotes" className="font-medium text-primary hover:underline">Etiquetas QR</Link>
              <Link href="/scanner/triagem" className="font-medium text-primary hover:underline">Códigos não reconhecidos</Link>
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {podeCriarPedido && <GerarPedidoReposicaoButton />}
            <span className="rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground shadow-sm">
              {saldo.length} insumos monitorados
            </span>
          </div>
        </div>

        <div className="mt-6">
          <StockControlHub
            initialNotifications={notificacoes}
            saldo={saldo}
            alertas={alertas}
            lotes={lotesParsed}
            podeAceitar={podeAceitar}
            podeGerir={podeGerir}
            podeCorrigir={podeCorrigir}
            podeBaixar={podeBaixar}
          />
        </div>
      </main>
    </div>
  );
}
