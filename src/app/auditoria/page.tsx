import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { pode, podeVerSalario } from "@/lib/auth/permissao-efetiva";
import { mascararAuditoriaSigilosa } from "@/lib/cadastros/salario";
import { AuditoriaTable, type AuditoriaRow } from "@/components/auditoria/AuditoriaTable";
import { formatDateTime } from "@/lib/formatters";
import { HelpTip } from "@/components/common/HelpTip";
import { resumoDiffAuditoria } from "@/lib/orcamento/auditoria-resumo";
import { AvisoLeitura } from "@/components/common/AvisoLeitura";
import { novaLeitura } from "@/lib/supabase/leitura";
import { LIMITE_AUDITORIA, hrefAuditoria, lerFiltroAuditoria, periodoAuditoria } from "@/lib/auditoria/filtro";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

const TABELAS = [
  "",
  "estoque_movimentacoes",
  "lotes_estoque",
  "insumos",
  "identificadores",
  "reservas_estoque",
  "pedidos_compra",
  "tecnicos",
];
const LABEL: Record<string, string> = {
  // entradas, saídas (abertura de embalagem), baixas e ajustes, inclusive por leitura
  estoque_movimentacoes: "Movimentações de estoque",
  identificadores: "Códigos de barras",
  lotes_estoque: "Lotes",
  insumos: "Insumos",
  reservas_estoque: "Reservas",
  pedidos_compra: "Pedidos",
  tecnicos: "Técnicos",
  tecnicos_remuneracao: "Salário (técnicos)",
};
const ACAO: Record<string, { label: string; cls: string }> = {
  insert: { label: "Criou", cls: "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" },
  update: { label: "Alterou", cls: "bg-info-soft text-info-strong" },
  delete: { label: "Removeu", cls: "bg-danger-soft text-danger-strong" },
};

const IGNORAR = new Set(["criado_em", "atualizado_em"]);

// Mesma regra da auditoria de Orçamentos: objetos mostram o subcampo que mudou,
// nunca "[object Object]" (28/09).
function resumoDiff(acao: string, ant: Record<string, unknown> | null, novo: Record<string, unknown> | null): string {
  return resumoDiffAuditoria(acao, ant, novo, { ignorar: IGNORAR, maximo: 4 });
}

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const leitura = novaLeitura("/auditoria");
  if (!(await pode("auditoria.visualizar"))) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 text-center font-sans">
        <p className="text-muted-foreground">
          Acesso restrito — a trilha de auditoria é visível para papel gestor ou admin.
        </p>
      </main>
    );
  }

  // tabela (os botões), período em dias de Brasília e o cursor que anda para os registros mais antigos
  const filtro = lerFiltroAuditoria(await searchParams, [...TABELAS, ...Object.keys(LABEL)]);
  const { tabela } = filtro;
  const { desde, antesDe } = periodoAuditoria(filtro);
  const supabase = await createClient();
  let q = supabase
    .from("auditoria")
    .select("id, tabela, registro_id, acao, usuario, valor_anterior, valor_novo, criado_em")
    .order("id", { ascending: false })
    .limit(LIMITE_AUDITORIA);
  if (tabela) q = q.eq("tabela", tabela);
  if (desde) q = q.gte("criado_em", desde);
  if (antesDe) q = q.lt("criado_em", antesDe);
  if (filtro.antes) q = q.lt("id", filtro.antes);
  const [{ data: registros }, podeVerSalarios] = await Promise.all([leitura.de("registros de auditoria", q), podeVerSalario()]);

  // insumo de cada registro de estoque (movimento, lote, código de barras), para
  // a trilha dizer "o quê" sem abrir o JSON
  const insumoDoRegistro = (r: { tabela: string; valor_anterior: unknown; valor_novo: unknown }) => {
    const v = (r.valor_novo ?? r.valor_anterior ?? {}) as Record<string, unknown>;
    if (r.tabela === "identificadores") return v.entidade_tipo === "insumo" ? Number(v.entidade_id) : null;
    if (["estoque_movimentacoes", "lotes_estoque", "reservas_estoque"].includes(r.tabela)) return Number(v.insumo_id);
    return null;
  };
  const idsInsumos = [
    ...new Set(
      (registros ?? [])
        .map(insumoDoRegistro)
        .filter((id): id is number => Number.isSafeInteger(id) && Number(id) > 0),
    ),
  ];
  const { data: insumosNomes } = idsInsumos.length
    ? await leitura.de("insumos", supabase.from("insumos").select("id, especificacao").in("id", idsInsumos))
    : { data: [] as { id: number; especificacao: string | null }[] };
  const nomeInsumo = new Map((insumosNomes ?? []).map((i) => [Number(i.id), i.especificacao ?? `Insumo #${i.id}`]));
  // página cheia: pode haver registros mais antigos dentro do mesmo filtro
  const maisAntigoNaTela = (registros ?? []).length >= LIMITE_AUDITORIA ? Number(registros?.at(-1)?.id) : null;
  const linhas: AuditoriaRow[] = (registros ?? []).map((original) => {
    // Defesa em profundidade: a policy da 0112 já esconde o salário; aqui ele
    // nunca é serializado para o cliente sem a permissão.
    const r = mascararAuditoriaSigilosa(
      {
        ...original,
        valor_anterior: original.valor_anterior as Record<string, unknown> | null,
        valor_novo: original.valor_novo as Record<string, unknown> | null,
      },
      podeVerSalarios,
    );
    const a = ACAO[r.acao] ?? { label: r.acao, cls: "" };
    return {
      id: r.id as number,
      quando: formatDateTime(r.criado_em as string),
      usuario: r.usuario ?? "—",
      tabela: r.tabela,
      tabelaLabel: LABEL[r.tabela] ?? r.tabela,
      registro: [`#${r.registro_id}`, nomeInsumo.get(Number(insumoDoRegistro(r)))].filter(Boolean).join(" · "),
      acao: r.acao,
      acaoLabel: a.label,
      alteracao: resumoDiff(r.acao, r.valor_anterior, r.valor_novo),
    };
  });

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <AvisoLeitura falhas={leitura.falhas} />
        <div className="flex items-center gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Auditoria</h1>
          <HelpTip title="Trilha de auditoria">
            <p>Quem alterou o quê, e quando.</p>
            <p>
              Cada alteração é registrada <b>automaticamente</b>, com o valor anterior e o novo.
              Ninguém pode editar nem apagar esses registros.
            </p>
            <p>
              Use os botões para ver só um tipo de cadastro e o <b>período</b> para chegar a qualquer data. A tela traz{" "}
              {LIMITE_AUDITORIA} registros por vez; <b>Ver registros mais antigos</b> segue adiante.
            </p>
          </HelpTip>
        </div>

        <nav className="mt-5 flex flex-wrap gap-2 text-xs">
          {TABELAS.map((t) => (
            <Link
              key={t || "todas"}
              href={hrefAuditoria({ tabela: t, de: filtro.de, ate: filtro.ate })}
              aria-current={tabela === t ? "page" : undefined}
              className={`toque inline-flex items-center rounded-full border px-3 py-1 ${
                tabela === t
                  ? "border-primary bg-primary/10 font-semibold text-primary"
                  : "border-border bg-card font-medium text-foreground hover:border-primary/50 hover:bg-primary/5"
              }`}
            >
              {t ? LABEL[t] : "Todas"}
            </Link>
          ))}
        </nav>

        {/* período: sem ele a trilha só alcançava os 200 registros mais recentes */}
        <form action="/auditoria" method="get" className="mt-4 flex flex-wrap items-end gap-3">
          {tabela && <input type="hidden" name="tabela" value={tabela} />}
          <div>
            <label htmlFor="auditoria-de" className="block text-xs font-medium text-muted-foreground">
              De
            </label>
            <Input id="auditoria-de" type="date" name="de" defaultValue={filtro.de} className="mt-1 w-40" />
          </div>
          <div>
            <label htmlFor="auditoria-ate" className="block text-xs font-medium text-muted-foreground">
              Até
            </label>
            <Input id="auditoria-ate" type="date" name="ate" defaultValue={filtro.ate} className="mt-1 w-40" />
          </div>
          <button type="submit" className="h-9 rounded-md border border-input px-3 text-sm font-medium hover:bg-muted">
            Filtrar período
          </button>
          {(filtro.de || filtro.ate) && (
            <Link href={hrefAuditoria({ tabela })} className="toque-texto pb-2 text-sm font-medium text-primary underline underline-offset-2">
              Limpar período
            </Link>
          )}
        </form>

        <div className="mt-4">
          <AuditoriaTable rows={linhas} />
        </div>

        {(maisAntigoNaTela || filtro.antes) && (
          <nav aria-label="Páginas da auditoria" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <p className="text-muted-foreground">
              {LIMITE_AUDITORIA} registros por página, do mais recente para o mais antigo.
            </p>
            {filtro.antes && (
              <Link href={hrefAuditoria({ ...filtro, antes: null })} className="toque-texto font-medium text-primary underline underline-offset-2">
                Voltar aos mais recentes
              </Link>
            )}
            {maisAntigoNaTela && (
              <Link href={hrefAuditoria({ ...filtro, antes: maisAntigoNaTela })} className="toque-texto font-medium text-primary underline underline-offset-2">
                Ver registros mais antigos
              </Link>
            )}
          </nav>
        )}
      </main>
    </div>
  );
}
