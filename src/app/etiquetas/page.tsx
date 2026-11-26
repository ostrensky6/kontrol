import Link from "next/link";
import { HelpTip } from "@/components/common/HelpTip";
import { QrCode } from "@/components/common/QrCode";
import { PrintButton } from "@/components/orcamento/PrintButton";
import { origemPublicaKontrol } from "@/lib/scanner/origem";
import { gerarUrlCurtaKontrol } from "@/lib/scanner/urls";
import { createClientUntyped } from "@/lib/supabase/server";
import { formatDate, formatNumber as fmt } from "@/lib/formatters";
import { AvisoLeitura } from "@/components/common/AvisoLeitura";
import { novaLeitura } from "@/lib/supabase/leitura";
import { quantos } from "@/lib/plural";

export const dynamic = "force-dynamic";

type SearchParams = {
  tipo?: string;
  id?: string;
};

type LoteEtiqueta = {
  id: number;
  codigo_lote: string | null;
  validade: string | null;
  quantidade_atual: number | null;
  status: string | null;
  insumos: { especificacao: string | null; unidade: string | null } | { especificacao: string | null; unidade: string | null }[] | null;
};

type EquipamentoUnidadeEtiqueta = {
  id: number;
  codigo_patrimonio: string | null;
  numero_serie: string | null;
  equipamento_id: number;
  equipamentos: { nome: string | null } | { nome: string | null }[] | null;
};

function asOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function idFiltro(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function filtroTipo(value: string | undefined): "todos" | "lotes" | "equipamentos" {
  if (value === "lotes" || value === "equipamentos") return value;
  return "todos";
}

function LabelShell({ children }: { children: React.ReactNode }) {
  return (
    <article className="break-inside-avoid rounded-md border border-input bg-card p-3 text-foreground shadow-sm print:border-border print:shadow-none">
      {children}
    </article>
  );
}

export default async function EtiquetasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const leitura = novaLeitura("/etiquetas");
  const params = await searchParams;
  const tipo = filtroTipo(params.tipo);
  const id = idFiltro(params.id);
  const [supabase, origem] = await Promise.all([createClientUntyped(), origemPublicaKontrol()]);

  const carregarLotes = tipo === "todos" || tipo === "lotes";
  const carregarEquipamentos = tipo === "todos" || tipo === "equipamentos";

  const [{ data: lotesData }, { data: equipamentosData }] = await Promise.all([
    carregarLotes
      ? leitura.de("lotes", supabase
          .from("lotes_estoque")
          .select("id, codigo_lote, validade, quantidade_atual, status, insumos(especificacao, unidade)")
          .not("status", "in", "(consumido,descartado)")
          .order("id", { ascending: true }))
      : Promise.resolve({ data: [] }),
    carregarEquipamentos
      ? leitura.de("unidades de equipamento", supabase
          .from("equipamento_unidades")
          .select("id, codigo_patrimonio, numero_serie, equipamento_id, equipamentos(nome)")
          .order("id", { ascending: true }))
      : Promise.resolve({ data: [] }),
  ]);

  const lotes = ((lotesData ?? []) as unknown as LoteEtiqueta[])
    .filter((lote) => tipo !== "lotes" || id == null || lote.id === id);
  const equipamentos = ((equipamentosData ?? []) as unknown as EquipamentoUnidadeEtiqueta[])
    .filter((unidade) => tipo !== "equipamentos" || id == null || unidade.id === id);
  const total = lotes.length + equipamentos.length;

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .label-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10mm; }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>
      <main className="app-page-container print:max-w-none print:px-0 print:py-0">
        <AvisoLeitura falhas={leitura.falhas} className="no-print" />
        <div className="no-print flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Etiquetas</h1>
              <HelpTip title="Etiquetas">
                <p>
                  Etiquetas com QR para os lotes em estoque e para os aparelhos do laboratório.{" "}
                  <b>Imprima, recorte e cole</b> na embalagem ou no equipamento.
                </p>
                <p>
                  A câmera do celular abre a ficha direto. Lotes consumidos ou descartados não aparecem.
                </p>
              </HelpTip>
            </div>
          </div>
          <PrintButton />
        </div>

        <div className="no-print mt-6 flex flex-wrap gap-2 text-sm">
          <Link href="/etiquetas" className={`rounded-md border px-3 py-1.5 ${tipo === "todos" ? "border-brand-400 bg-brand-50 text-brand-700" : "border-border hover:bg-muted/50"}`}>
            Todas
          </Link>
          <Link href="/etiquetas?tipo=lotes" className={`rounded-md border px-3 py-1.5 ${tipo === "lotes" ? "border-brand-400 bg-brand-50 text-brand-700" : "border-border hover:bg-muted/50"}`}>
            Lotes
          </Link>
          <Link href="/etiquetas?tipo=equipamentos" className={`rounded-md border px-3 py-1.5 ${tipo === "equipamentos" ? "border-brand-400 bg-brand-50 text-brand-700" : "border-border hover:bg-muted/50"}`}>
            Equipamentos
          </Link>
          <span className="rounded-md bg-muted px-3 py-1.5 text-muted-foreground">
            {quantos(total, "etiqueta")}
          </span>
        </div>

        <section className="label-grid mt-6 grid gap-4 md:grid-cols-2 print:mt-0">
          {lotes.map((lote) => {
            const insumo = asOne(lote.insumos);
            const url = gerarUrlCurtaKontrol("lote", lote.id, origem);
            return (
              <LabelShell key={`lote-${lote.id}`}>
                <div className="flex gap-3">
                  <QrCode value={url} label={`QR do lote ${lote.id}`} size={112} className="shrink-0 rounded bg-card" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-muted-foreground">Lote</p>
                    <h2 className="mt-1 truncate text-base font-semibold" title={insumo?.especificacao ?? undefined}>
                      {insumo?.especificacao ?? `Lote #${lote.id}`}
                    </h2>
                    <dl className="mt-2 grid gap-1 text-xs">
                      <div><dt className="inline text-muted-foreground">ID Kontrol: </dt><dd className="inline font-medium">#{lote.id}</dd></div>
                      <div><dt className="inline text-muted-foreground">Lote: </dt><dd className="inline font-mono">{lote.codigo_lote ?? "—"}</dd></div>
                      <div><dt className="inline text-muted-foreground">Validade: </dt><dd className="inline">{formatDate(lote.validade)}</dd></div>
                      <div><dt className="inline text-muted-foreground">Saldo: </dt><dd className="inline">{fmt(lote.quantidade_atual)} {insumo?.unidade ?? ""}</dd></div>
                    </dl>
                    <Link href={`/etiquetas?tipo=lotes&id=${lote.id}`} className="no-print mt-2 inline-block text-xs font-medium text-brand-700 hover:underline">
                      Imprimir somente esta
                    </Link>
                  </div>
                </div>
              </LabelShell>
            );
          })}

          {equipamentos.map((unidade) => {
            const equipamento = asOne(unidade.equipamentos);
            const url = gerarUrlCurtaKontrol("equipamento_unidade", unidade.id, origem);
            return (
              <LabelShell key={`equipamento-${unidade.id}`}>
                <div className="flex gap-3">
                  <QrCode value={url} label={`QR da unidade ${unidade.id}`} size={112} className="shrink-0 rounded bg-card" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-muted-foreground">Equipamento</p>
                    <h2 className="mt-1 truncate text-base font-semibold" title={equipamento?.nome ?? undefined}>
                      {equipamento?.nome ?? `Equipamento #${unidade.equipamento_id}`}
                    </h2>
                    <dl className="mt-2 grid gap-1 text-xs">
                      <div><dt className="inline text-muted-foreground">ID Kontrol: </dt><dd className="inline font-medium">#{unidade.id}</dd></div>
                      <div><dt className="inline text-muted-foreground">Patrimônio: </dt><dd className="inline font-mono">{unidade.codigo_patrimonio ?? "—"}</dd></div>
                      <div><dt className="inline text-muted-foreground">Série: </dt><dd className="inline font-mono">{unidade.numero_serie ?? "—"}</dd></div>
                    </dl>
                    <Link href={`/etiquetas?tipo=equipamentos&id=${unidade.id}`} className="no-print mt-2 inline-block text-xs font-medium text-brand-700 hover:underline">
                      Imprimir somente esta
                    </Link>
                  </div>
                </div>
              </LabelShell>
            );
          })}

          {total === 0 && (
            <div className="rounded-md border border-dashed border-input px-4 py-6 text-center text-sm text-muted-foreground">
              Nenhuma etiqueta encontrada para o filtro atual.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
