import Link from "next/link";
import { createClient, createClientUntyped } from "@/lib/supabase/server";
import { pode } from "@/lib/auth/permissao-efetiva";
import { GerarPedidoReposicaoButton } from "@/components/pedido/GerarPedidoReposicaoButton";
import { HelpTip } from "@/components/common/HelpTip";
import { hojeIso, loteBaixaDeDb, loteVencido, somarReservasPorLote, type LoteDbBaixa } from "@/lib/estoque/baixa";
import { janelaVencimentoDias, loteVenceEmBreve } from "@/lib/estoque/situacao-insumo";
import { StockControlHub } from "./StockControlHub";
import { lerTudo } from "@/lib/supabase/ler-tudo";
import type { Tables } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

type LoteDbRow = LoteDbBaixa & {
  insumo_id: number;
  insumos: { especificacao: string | null; unidade: string | null; categoria_compra: string | null } | null;
};

const LOTE_STATUS: Record<string, string> = {
  quarentena: "Quarentena",
  aceito: "Disponível",
  em_uso: "Em uso",
  bloqueado: "Bloqueado",
  // saldo zerado por qualquer motivo (uso, perda, vencimento); no banco segue 'consumido'
  consumido: "Esgotado",
  descartado: "Descartado",
};

export default async function EstoqueControlePage() {
  const supabase = await createClient();
  // modelo_quantidade (0109) ainda não está nos tipos gerados.
  const supabaseSemTipos = await createClientUntyped();
  const [
    { data: notificacoesRaw },
    { data: saldoRaw, error: saldoError },
    { data: alertasRaw },
    { data: lotesRaw, error: lotesError },
    { data: reservasRaw, error: reservasError },
    { data: vinculosCompra, error: vinculosCompraError },
    { data: vinculosInternos, error: vinculosInternosError },
    { data: previsaoRaw },
    { data: parametrosRaw },
    { data: insumosAtivosRaw },
  ] = await Promise.all([
    supabase
      .from("notificacoes")
      .select("id, tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, canal, status, criado_em")
      .not("status", "in", "(arquivada)")
      .order("criado_em", { ascending: false }),
    // listas de estoque lidas de mil em mil (o PostgREST corta em 1.000 linhas)
    lerTudo<Tables<"v_estoque_saldo">>((de, ate) =>
      supabase.from("v_estoque_saldo").select("*").order("especificacao").order("insumo_id").range(de, ate),
    ),
    supabase.from("v_alertas_estoque").select("*"),
    lerTudo<Record<string, unknown>>((de, ate) =>
      supabaseSemTipos
        .from("lotes_estoque")
        .select("id, insumo_id, codigo_lote, validade, validade_apos_abertura, quantidade_atual, status, modelo_quantidade, insumos(especificacao, unidade, categoria_compra)")
        .not("status", "in", "(consumido,descartado)")
        .order("validade", { nullsFirst: false })
        .order("id")
        .range(de, ate),
    ),
    lerTudo<Pick<Tables<"reservas_estoque">, "lote_id" | "quantidade" | "quantidade_consumida" | "status">>((de, ate) =>
      supabase
        .from("reservas_estoque")
        .select("id, lote_id, quantidade, quantidade_consumida, status")
        .in("status", ["reservado", "parcial"])
        .order("id")
        .range(de, ate),
    ),
    lerTudo<{ lote_id: number | null }>((de, ate) => supabase.from("pedidos_compra_item_recebimentos").select("id, lote_id").order("id").range(de, ate)),
    lerTudo<{ lote_id: number | null }>((de, ate) => supabase.from("pedidos_internos_item_recebimentos").select("id, lote_id").order("id").range(de, ate)),
    supabase.from("v_previsao_suprimentos").select("insumo_id, qtd_sugerida_compra, ponto_reposicao_sugerido"),
    // janela do "vence em breve" do lote: a mesma de v_alertas_estoque (padrão 60 dias)
    supabase.from("parametros").select("chave, valor").eq("chave", "janela_vencimento_dias"),
    supabaseSemTipos.from("insumos").select("id").eq("ativo", true),
  ]);
  // reserva não lida não pode virar "nada reservado" (o disponível ficaria maior)
  if (saldoError || lotesError) throw new Error(`Não foi possível ler o saldo do estoque: ${(saldoError ?? lotesError)!.message}`);
  if (reservasError) throw new Error(`Não foi possível ler as reservas do estoque: ${reservasError.message}`);
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
  const insumosAtivos = new Set((insumosAtivosRaw ?? []).map((insumo) => Number(insumo.id)));
  // Uma regra de reposição só (0130): o painel usa a sugestão da previsão.
  const previsaoPorInsumo = new Map(
    (previsaoRaw ?? []).filter((p) => insumosAtivos.has(Number(p.insumo_id))).map((p) => [p.insumo_id, p]),
  );
  const saldo = (saldoRaw ?? []).filter((s) => insumosAtivos.has(Number(s.insumo_id))).map((s) => ({
    ...s,
    qtd_sugerida_compra: Number(previsaoPorInsumo.get(s.insumo_id)?.qtd_sugerida_compra ?? 0),
  }));
  const alertas = (alertasRaw ?? []).filter((alerta) => insumosAtivos.has(Number(alerta.insumo_id)));
  const dbLotes = ((lotesRaw ?? []) as unknown as LoteDbRow[])
    .filter((lote) => insumosAtivos.has(Number(lote.insumo_id)));

  const hoje = hojeIso();
  const janelaVencimento = janelaVencimentoDias(parametrosRaw?.[0]?.valor);
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
      // baixa.validade já é a menor entre a do fabricante e a após abertura
      vencendo: loteVenceEmBreve(baixa.validade, hoje, janelaVencimento),
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
                  As ações de cada lote (dar baixa, bloquear, descartar) ficam registradas com
                  quem fez e quando.
                </p>
              </HelpTip>
            </div>
            <nav aria-label="Ferramentas de estoque" className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <Link href="/estoque/leitura" className="font-medium text-primary hover:underline">Entrada e saída por leitura</Link>
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
            podeCriarPedido={podeCriarPedido}
          />
        </div>
      </main>
    </div>
  );
}
