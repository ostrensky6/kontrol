import { createClient } from "@/lib/supabase/server";
import { criarPedido } from "@/lib/actions/compras";
import { ComprasTable, type CompraRow } from "@/components/compras/ComprasTable";
import { GerarPedidoReposicaoButton } from "@/components/pedido/GerarPedidoReposicaoButton";
import { FormComMensagem } from "@/components/pedido/FormComMensagem";
import { SubmitButton } from "@/components/common/SubmitButton";
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
  const [{ data: pedidos }, { data: fornecedores }, { data: saldo }, { data: projetos }, { data: previsao }] = await Promise.all([
    supabase
      .from("pedidos_compra")
      .select("id, status, projeto, projeto_id, solicitante, data_solicitacao, fornecedores(nome)")
      .order("criado_em", { ascending: false }),
    supabase.from("fornecedores").select("id, nome").eq("ativo", true).order("nome"),
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

  // Sugestões de compra: a mesma fórmula da previsão de suprimentos (consumo no
  // prazo de entrega + segurança − disponível − já pedido), na unidade do saldo
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

  const inp = "rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-brand-700 dark:text-brand-300"; // §8.2: entrada em azul

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex items-center gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Compras</h1>
          <HelpTip title="Compras">
            <p>
              Cada compra segue os status abaixo. O material recebido entra em <b>quarentena</b> até
              alguém conferir e aceitar o lote.
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
        </div>

        {/* sugestões */}
        {sugestoes.length > 0 && (
          <div className="mt-6 rounded-xl border border-warning-strong/30 bg-warning-soft p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1">
                  <h2 className="text-sm font-semibold text-warning-strong">Sugestões de reposição ({sugestoes.length})</h2>
                  <HelpTip title="Sugestões de reposição">
                    <p>
                      Itens que chegaram ao ponto de reposição. A <b>quantidade sugerida</b> cobre o
                      consumo durante o prazo de entrega mais a margem de segurança, descontando o saldo e o que já
                      está pedido.
                    </p>
                    <HelpExample>“disp. 2 · pedir ~10”: restam 2 e convém pedir cerca de 10.</HelpExample>
                  </HelpTip>
                </div>
              </div>
              <GerarPedidoReposicaoButton />
            </div>
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
                <h2 className="text-sm font-semibold text-info-strong">Reposição via pedido interno</h2>
                <HelpTip title="Reposição via pedido interno">
                  <p>
                    A reposição começa como um <b>pedido interno</b> com os itens em falta. Depois de
                    validado, ele vira a compra formal e segue para o recebimento.
                  </p>
                </HelpTip>
              </div>
            </div>
            {sugestoes.length === 0 && <GerarPedidoReposicaoButton />}
          </div>
        </div>

        {/* nova compra */}
        <FormComMensagem action={criarPedido} className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div>
            <label className="block text-xs font-medium text-muted-foreground">Fornecedor</label>
            <select aria-label="Fornecedor" name="fornecedor_id" className={`${inp} mt-1`} defaultValue="">
              <option value="">—</option>
              {(fornecedores ?? []).map((f) => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground">Projeto</label>
            <select aria-label="Projeto" name="projeto_id" className={`${inp} mt-1`} defaultValue="">
              <option value="">—</option>
              {(projetos ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-40">
            <label className="block text-xs font-medium text-muted-foreground">Campanha (texto livre)</label>
            <input aria-label="Campanha (texto livre)" name="projeto" className={`${inp} mt-1 w-full`} />
          </div>
          <SubmitButton pendingLabel="Criando…" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500">
            + Nova compra
          </SubmitButton>
        </FormComMensagem>

        <div className="mt-6">
          <ComprasTable rows={linhas} />
        </div>
      </main>
    </div>
  );
}
