import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Barcode39 } from "@/components/common/Barcode39";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { QrCode } from "@/components/common/QrCode";
import { formatNumber as fmt, formatDate as fdata, formatCurrency } from "@/lib/formatters";
import { LoteAcoes } from "@/components/estoque/LoteAcoes";
import { pode } from "@/lib/auth/permissao-efetiva";
import { usuarioAtual } from "@/lib/auth/roles";
import { origemPublicaKontrol } from "@/lib/scanner/origem";
import { gerarUrlCurtaKontrol } from "@/lib/scanner/urls";
import { loteBaixaDeDb, loteVencido, somarReservasPorLote, type LoteDbBaixa } from "@/lib/estoque/baixa";

export const dynamic = "force-dynamic";

const LOTE_STATUS: Record<string, { label: string; cls: string }> = {
  quarentena: { label: "Quarentena", cls: "bg-warning-soft text-warning-strong" },
  aceito: { label: "Aceito", cls: "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" },
  em_uso: { label: "Em uso", cls: "bg-info-soft text-info-strong" },
  consumido: { label: "Consumido", cls: "bg-muted text-muted-foreground" },
  bloqueado: { label: "Bloqueado", cls: "bg-danger-soft text-danger-strong" },
  descartado: { label: "Descartado", cls: "bg-muted text-muted-foreground" },
};

const TIPO_MOV: Record<string, { label: string; cls: string }> = {
  entrada: { label: "Entrada", cls: "text-brand-700 dark:text-brand-400" },
  saida: { label: "Saída", cls: "text-danger-strong" },
  ajuste: { label: "Ajuste", cls: "text-warning-strong" },
};

const SO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Baixas e entradas por operação gravam o id da operação (UUID) como
 * referência: não diz nada a quem lê. O motivo já descreve a operação; o id
 * completo fica no title da célula para rastreio.
 */
function referenciaLegivel(referencia: string | null): string {
  const texto = referencia?.trim() ?? "";
  if (!texto) return "—";
  return SO_UUID.test(texto) ? "—" : texto;
}

function Campo({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground/80">{rotulo}</dt>
      <dd className="text-sm text-foreground">{valor}</dd>
    </div>
  );
}

export default async function LoteDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) notFound();
  const supabase = await createClient();

  const { data: lote } = await supabase
    .from("lotes_estoque")
    .select("*, insumos(especificacao, nome_item, unidade, categoria_compra)")
    .eq("id", id)
    .single();
  if (!lote) notFound();

  const [
    { data: movs },
    { data: local },
    { data: reservas },
    podeAceitar,
    podeGerir,
    podeCorrigir,
    podeBaixar,
    origem,
    vinculoCompra,
    vinculoInterno,
    usuario,
  ] = await Promise.all([
    supabase
      .from("estoque_movimentacoes")
      .select("id, tipo, quantidade, custo_unitario, data, motivo, referencia, usuario")
      .eq("lote_id", id)
      .order("data", { ascending: false })
      .order("id", { ascending: false }),
    lote.local_id != null
      ? supabase.from("locais").select("nome").eq("id", lote.local_id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from("reservas_estoque")
      .select("lote_id, quantidade, quantidade_consumida, status")
      .eq("lote_id", id)
      .in("status", ["reservado", "parcial"]),
    pode("estoque.lote.aceitar"),
    pode("estoque.descartar_bloquear"),
    pode("estoque.lote.gerir"),
    pode("estoque.movimentar"),
    origemPublicaKontrol(),
    supabase.from("pedidos_compra_item_recebimentos").select("lote_id").eq("lote_id", id).limit(1),
    supabase.from("pedidos_internos_item_recebimentos").select("lote_id").eq("lote_id", id).limit(1),
    usuarioAtual(),
  ]);

  const ins = lote.insumos as {
    especificacao: string | null;
    nome_item: string | null;
    unidade: string | null;
    categoria_compra: string | null;
  } | null;
  // estorno direto só quando é comprovado que o lote não veio de um pedido (mesma regra de /estoque)
  const estornoDiretoPermitido =
    !vinculoCompra.error &&
    !vinculoInterno.error &&
    (vinculoCompra.data ?? []).length === 0 &&
    (vinculoInterno.data ?? []).length === 0;
  // Lote de compra/pedido interno ainda sem consumo: estorno bilateral (EST-2).
  const estornoRecebimento =
    !estornoDiretoPermitido &&
    Number(lote.quantidade_atual ?? 0) === Number(lote.quantidade_inicial ?? 0) &&
    Number(lote.quantidade_atual ?? 0) > 0;
  // Dupla conferência: quem registrou a chegada não aceita o próprio lote (admin isento).
  const recebidoPorId = (lote as unknown as { recebido_por_id?: string | null }).recebido_por_id ?? null;
  const aceiteBloqueadoMotivo =
    usuario && recebidoPorId && recebidoPorId === usuario.id && usuario.papel !== "admin"
      ? "Você registrou a chegada deste lote; o aceite fica com outra pessoa."
      : null;
  // Lote de embalagens fechadas conta frascos, não a unidade física (0109/0123).
  const loteModelo = lote as unknown as {
    modelo_quantidade?: string | null;
    conteudo_embalagem_snapshot?: number | null;
  };
  const unidade =
    loteModelo.modelo_quantidade === "EMBALAGEM_FECHADA"
      ? `frasco(s)${loteModelo.conteudo_embalagem_snapshot ? ` de ${fmt(loteModelo.conteudo_embalagem_snapshot)} ${ins?.unidade ?? ""}` : ""}`.trim()
      : ins?.unidade ?? "";
  const s = LOTE_STATUS[lote.status] ?? { label: lote.status, cls: "bg-muted text-muted-foreground" };
  // modelo_quantidade (0109) ainda não está nos tipos gerados.
  const loteBaixa = loteBaixaDeDb(
    lote as unknown as LoteDbBaixa,
    somarReservasPorLote(reservas ?? []),
  );
  const vencido = loteVencido(loteBaixa.validade);

  // Rastreabilidade reversa: planos que consumiram este lote (referencia 'plano N')
  const planosConsumo = Array.from(
    new Set(
      (movs ?? [])
        .filter((m) => m.tipo === "saida" && /plano\s+\d+/i.test(m.referencia ?? ""))
        .map((m) => (m.referencia ?? "").match(/plano\s+(\d+)/i)?.[1])
        .filter((x): x is string => Boolean(x)),
    ),
  );

  const codigoEtiqueta = lote.codigo_lote || `LOTE-${lote.id}`;
  const qrUrl = gerarUrlCurtaKontrol("lote", lote.id as number, origem);
  const nomeCurto = ins?.especificacao ?? ins?.nome_item ?? "Lote sem descrição";

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <Breadcrumbs items={[{ label: "Estoque", href: "/estoque" }, { label: `Lote ${codigoEtiqueta}` }]} />

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">Lote {codigoEtiqueta}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>
              {vencido && (
                <span className="rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-semibold text-danger-strong">
                  Vencido
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{ins?.especificacao ?? ins?.nome_item ?? "—"}</p>
          </div>
          <LoteAcoes
            loteId={lote.id as number}
            codigoLote={lote.codigo_lote ?? undefined}
            status={lote.status}
            quantidadeAtual={Number(lote.quantidade_atual ?? 0)}
            unidade={unidade}
            critico={ins?.categoria_compra === "critico"}
            validade={loteBaixa.validade}
            vencido={vencido}
            rotuloBaixa="Dar baixa"
            reservado={loteBaixa.reservado}
            modeloQuantidade={loteBaixa.modeloQuantidade}
            estornoDiretoPermitido={estornoDiretoPermitido}
            estornoRecebimento={estornoRecebimento}
            origemRecebimento={(vinculoCompra.data ?? []).length > 0 ? "compra" : "pedido_interno"}
            responsavelPadrao={usuario?.nome || usuario?.email || ""}
            aceiteBloqueadoMotivo={aceiteBloqueadoMotivo}
            podeAceitar={podeAceitar}
            podeGerir={podeGerir}
            podeCorrigir={podeCorrigir}
            podeBaixar={podeBaixar}
          />
        </div>

        {/* Etiqueta imprimível com código de barras */}
        <section className="mt-6 rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-56">
              <p className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground/80">
                Etiqueta do lote
                <HelpTip title="Etiqueta do lote">
                  <p>
                    Cole a etiqueta na embalagem. Lendo o <b>QR</b> com a câmera do celular, esta página
                    abre direto, com as ações do lote.
                  </p>
                  <p>O código de barras serve para leitores de mão.</p>
                </HelpTip>
              </p>
              <p className="mt-1 text-sm font-medium">{nomeCurto}</p>
              <p className="text-xs text-muted-foreground">
                Validade: {fdata(lote.validade)} · Saldo: {fmt(lote.quantidade_atual)} {unidade}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="uppercase tracking-wide text-muted-foreground/80">Tipo</dt>
                  <dd className="font-medium text-foreground">Lote</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide text-muted-foreground/80">ID Kontrol</dt>
                  <dd className="font-mono text-foreground">{lote.id}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide text-muted-foreground/80">Código do lote</dt>
                  <dd className="font-mono text-foreground">{codigoEtiqueta}</dd>
                </div>
              </dl>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="text-center">
                <QrCode value={qrUrl} label={`QR do lote ${codigoEtiqueta}`} />
                <p className="mt-1 text-xs text-muted-foreground">Leia com a câmera</p>
              </div>
              <div className="text-center">
                <Barcode39 value={codigoEtiqueta} height={52} />
                <p className="mt-0.5 font-mono text-xs tracking-widest text-foreground">{codigoEtiqueta}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Dados do lote (inclui validade dupla) */}
        <div className="mt-8 flex items-center gap-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Dados do lote</h2>
          <HelpTip title="Validade do lote">
            <p>
              Depois de aberto, o lote passa a ter duas datas. Vale a <b>mais próxima</b> entre a
              validade do fabricante e a validade após abertura.
            </p>
            <HelpExample>
              Fabricante 30/12, aberto em 01/10 com 30 dias de uso → vale 31/10.
            </HelpExample>
          </HelpTip>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-4 shadow-sm sm:grid-cols-3">
          <Campo rotulo="Validade (fabricante)" valor={<span className={vencido ? "font-medium text-danger-strong" : ""}>{fdata(lote.validade)}</span>} />
          <Campo rotulo="Data de abertura" valor={fdata(lote.data_abertura)} />
          <Campo rotulo="Validade após abertura" valor={fdata(lote.validade_apos_abertura)} />
          <Campo rotulo="Entrada" valor={fdata(lote.data_entrada)} />
          <Campo rotulo="Fornecedor" valor={lote.fornecedor ?? "—"} />
          <Campo rotulo="Nota fiscal" valor={lote.nota_fiscal ?? "—"} />
          <Campo rotulo="Local" valor={local?.nome ?? "—"} />
          <Campo rotulo="Qtd. inicial" valor={`${fmt(lote.quantidade_inicial)} ${unidade}`} />
          <Campo rotulo="Saldo atual" valor={`${fmt(lote.quantidade_atual)} ${unidade}`} />
          <Campo rotulo="Custo unitário" valor={lote.custo_unitario != null ? formatCurrency(lote.custo_unitario) : "—"} />
          <Campo rotulo="Resp. recebimento" valor={lote.responsavel_recebimento ?? "—"} />
          <Campo rotulo="Resp. liberação" valor={lote.responsavel_liberacao ?? "—"} />
          {lote.criterio_aceitacao && <Campo rotulo="Critério de aceitação" valor={lote.criterio_aceitacao} />}
          {lote.motivo_bloqueio && <Campo rotulo="Motivo do bloqueio" valor={lote.motivo_bloqueio} />}
        </dl>

        {/* Rastreabilidade reversa */}
        <div className="mt-8 flex items-center gap-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Rastreabilidade reversa
          </h2>
          <HelpTip title="Rastreabilidade reversa">
            <p>
              Planos de análise que <b>usaram este lote</b>. Se o lote tiver problema (recall, não
              conformidade), estes são os resultados a revisar.
            </p>
          </HelpTip>
        </div>
        <div className="mt-3 rounded-lg border border-border bg-card p-4 text-sm shadow-sm">
          {planosConsumo.length === 0 ? (
            <p className="text-muted-foreground/80">Este lote ainda não foi consumido por nenhum plano.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Consumido pelos planos:</span>
              {planosConsumo.map((p) => (
                <Link
                  key={p}
                  href={`/planejamento/${p}`}
                  className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 hover:underline dark:bg-brand-950/30 dark:text-brand-300"
                >
                  Plano {p}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Histórico de movimentações */}
        <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Histórico</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="border-b border-border/70">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tipo</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Qtd.</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Motivo</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Referência</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por</th>
              </tr>
            </thead>
            <tbody>
              {(movs ?? []).map((m) => {
                const t = TIPO_MOV[m.tipo] ?? { label: m.tipo, cls: "" };
                return (
                  <tr key={m.id} className="border-b border-border/50 last:border-b-0">
                    <td className="px-3 py-2 text-muted-foreground">{fdata(m.data)}</td>
                    <td className={`px-3 py-2 font-medium ${t.cls}`}>{t.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(m.quantidade)} {unidade}</td>
                    <td className="px-3 py-2 text-muted-foreground">{m.motivo ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground" title={m.referencia ?? undefined}>
                      {referenciaLegivel(m.referencia)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{m.usuario ?? "—"}</td>
                  </tr>
                );
              })}
              {(movs ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground/80">Sem movimentações.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
