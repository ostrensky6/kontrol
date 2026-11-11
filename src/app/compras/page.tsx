import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { ComprasTable, type CompraRow } from "@/components/compras/ComprasTable";
import { PrazoReposicao } from "@/components/compras/PrazoReposicao";
import { PageHeader } from "@/components/app/PageHeader";
import { HelpExample, HelpLegend, HelpTip } from "@/components/common/HelpTip";
import { formatDate, formatNumber as fmt } from "@/lib/formatters";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  solicitado: { label: "Solicitado", cls: "bg-warning-soft text-warning-strong" },
  aprovado: { label: "Aprovado", cls: "bg-info-soft text-info-strong" },
  enviado: { label: "Enviado", cls: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300" },
  recebido: { label: "Recebido", cls: "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" },
  cancelado: { label: "Cancelado", cls: "bg-muted text-muted-foreground" },
};

export default async function ComprasPage() {
  const supabase = await createClient();
  const [{ data: pedidos }, { data: saldo }, { data: projetos }, { data: previsao }] = await Promise.all([
    supabase
      .from("pedidos_compra")
      .select("id, status, projeto, projeto_id, solicitante, data_solicitacao, fornecedores(nome)")
      .order("criado_em", { ascending: false }),
    supabase.from("v_estoque_saldo").select("*"),
    supabase.from("projetos").select("id, nome").order("nome"),
    supabase.from("v_previsao_suprimentos").select("*").order("qtd_sugerida_compra", { ascending: false }),
  ]);
  const projetoNome = new Map((projetos ?? []).map((p) => [p.id, p.nome]));
  const linhas: CompraRow[] = (pedidos ?? []).map((p) => {
    const st = STATUS[p.status] ?? { label: p.status, cls: "" };
    const fornecedor = (p.fornecedores as { nome: string | null } | null)?.nome ?? "—";
    const projeto = p.projeto_id != null ? projetoNome.get(p.projeto_id) ?? "—" : p.projeto ?? "—";
    return {
      id: p.id as number,
      pedido: `#${p.id} · ${formatDate(p.data_solicitacao)}`,
      fornecedor,
      projeto,
      solicitante: p.solicitante ?? "—",
      status: p.status,
      statusLabel: st.label,
    };
  });

  // Sugestões de compra: a mesma fórmula da previsão de suprimentos (saídas no
  // prazo total da compra + segurança − disponível − a caminho), na unidade do saldo
  // (frascos para insumo contado em frascos). EST-7.
  const unidadeSaldo = new Map((saldo ?? []).map((s) => [s.insumo_id, s.unidade_saldo ?? s.unidade ?? ""]));
  const sugestoes = (previsao ?? [])
    .filter((p) => Number(p.qtd_sugerida_compra ?? 0) > 0)
    .map((p) => ({
      especificacao: p.especificacao,
      disponivel: Number(p.disponivel ?? 0),
      sugerido: Number(p.qtd_sugerida_compra ?? 0),
      unidade: unidadeSaldo.get(p.insumo_id) ?? p.unidade ?? "",
      categoria: p.categoria_compra,
    }));
  const sugestoesRender = sugestoes.slice(0, 8);


  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        {/* toda compra nasce de um pedido aprovado (decisão de 11/11/2026): não há mais "Nova compra" avulsa */}
        <PageHeader
          title="Compras com fornecedor"
          description="As compras fechadas, cada uma ligada ao pedido de onde nasceu."
          help={
            <HelpTip title="Compras com fornecedor">
              <p>
                Toda compra nasce de um <b>pedido</b>: ela é criada quando o pedido chega a “Aprovado para compra” e
                é aprovada junto com ele. Para pedir algo, use <b>Novo pedido</b> em Compras → Pedidos.
              </p>
              <p>
                Cada compra segue as situações abaixo. Quem registra a chegada cadastra o lote e ele já fica
                <b> disponível no estoque</b>.
              </p>
              <HelpLegend
                items={[
                  { tom: "atencao", rotulo: "Solicitado", texto: "aguardando aprovação" },
                  { tom: "info", rotulo: "Aprovado", texto: "liberado para comprar" },
                  { tom: "info", rotulo: "Enviado", texto: "pedido feito ao fornecedor" },
                  { tom: "info", rotulo: "Recebido", texto: "material entregue e registrado" },
                  { tom: "neutro", rotulo: "Cancelado", texto: "não segue adiante" },
                ]}
              />
            </HelpTip>
          }
          actions={
            <Link href="/pedido?novo=1" className="text-sm font-semibold text-primary underline underline-offset-2">
              Novo pedido
            </Link>
          }
        />

        {/* sugestões */}
        {sugestoes.length > 0 && (
          <div className="mt-6 rounded-xl border border-warning-strong/30 bg-warning-soft p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1">
                  <h2 className="text-sm font-semibold text-warning-strong">Sugestões de reposição ({sugestoes.length})</h2>
                  <HelpTip title="Sugestões de reposição">
                    <p>
                      A <b>quantidade sugerida</b> cobre as saídas previstas durante o prazo total da compra
                      (tramitação na universidade + entrega do fornecedor) mais o estoque de segurança,
                      descontando o disponível e o que já está a caminho. Compra atrasada continua contando como a
                      caminho: cobre o fornecedor em vez de pedir de novo.
                    </p>
                    <HelpExample>“disp. 2 · pedir ~10”: restam 2 e convém pedir cerca de 10.</HelpExample>
                  </HelpTip>
                </div>
              </div>
              {/* D6: o botão de gerar a reposição fica num lugar só, junto dos alertas de repor */}
              <Link href="/estoque/situacao" className="text-sm font-semibold text-warning-strong underline underline-offset-2">
                Repor pela Situação do estoque
              </Link>
            </div>
            <PrazoReposicao className="mt-1" />
            <ul className="mt-2 space-y-1 text-xs text-warning-strong">
              {sugestoesRender.slice(0, 8).map((s, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span className="truncate">
                    {s.categoria === "critico" && "Crítico · "}
                    {s.especificacao}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    disp. {fmt(s.disponivel)} · pedir ~{fmt(s.sugerido)} {s.unidade}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 rounded-xl border border-info-strong/30 bg-info-soft p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1">
                <h2 className="text-sm font-semibold text-info-strong">Repor pelo pedido</h2>
                <HelpTip title="Repor pelo pedido">
                  <p>
                    A reposição começa como um <b>pedido</b> com os itens em falta. Depois de
                    aprovado, ele vira a compra e segue até a chegada.
                  </p>
                </HelpTip>
              </div>
            </div>
            {sugestoes.length === 0 && (
              <Link href="/estoque/situacao" className="text-sm font-semibold text-info-strong underline underline-offset-2">
                Repor pela Situação do estoque
              </Link>
            )}
          </div>
        </div>

        <div className="mt-6">
          <ComprasTable rows={linhas} />
        </div>
      </main>
    </div>
  );
}
