import Link from "next/link";
import { Plus } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { ComprasTable, type CompraRow } from "@/components/compras/ComprasTable";
import { PrazoReposicao } from "@/components/compras/PrazoReposicao";
import { PageHeader } from "@/components/app/PageHeader";
import { HelpExample, HelpLegend, HelpTip } from "@/components/common/HelpTip";
import { formatDate, formatNumber as fmt } from "@/lib/formatters";
import { AvisoLeitura } from "@/components/common/AvisoLeitura";
import { ListaParcial } from "@/components/common/ListaParcial";
import { novaLeitura } from "@/lib/supabase/leitura";
import { lerAbertosERecentes } from "@/lib/supabase/lista-recente";
import { hrefDoPedidoQueConduz, pedidoQueConduzCompra } from "@/lib/pedido/compra-do-pedido";
import { pedidoInternoNumero } from "@/lib/pedido/status";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  solicitado: { label: "Solicitado", cls: "bg-warning-soft text-warning-strong" },
  aprovado: { label: "Aprovado", cls: "bg-info-soft text-info-strong" },
  enviado: { label: "Enviado", cls: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300" },
  recebido: { label: "Recebido", cls: "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" },
  cancelado: { label: "Cancelado", cls: "bg-muted text-muted-foreground" },
};

// compra recebida ou cancelada não muda mais: dessas a lista traz só as mais recentes
const STATUS_COMPRA_ENCERRADA = ["recebido", "cancelado"];
const SUGESTOES_NA_TELA = 8;
const LOTE_PEDIDOS_DE_ORIGEM = 200;
const COLUNAS_COMPRA = "id, status, projeto, projeto_id, solicitante, data_solicitacao, criado_em, fornecedores(nome)";

type CompraLida = {
  id: number;
  status: string;
  projeto: string | null;
  projeto_id: number | null;
  solicitante: string | null;
  data_solicitacao: string | null;
  criado_em: string | null;
  fornecedores: { nome: string | null } | { nome: string | null }[] | null;
};

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<{ encerradas?: string | string[] }>;
}) {
  const leitura = novaLeitura("/compras");
  const query = await searchParams;
  const todasEncerradas = (Array.isArray(query.encerradas) ? query.encerradas[0] : query.encerradas) === "todas";
  const supabase = await createClient();
  const [comprasLidas, { data: projetos }, previsaoLida] = await Promise.all([
    // em andamento vêm todas, sem corte; a ordem termina em `id` para a leitura em páginas não pular linha
    leitura.de("compras", lerAbertosERecentes<CompraLida>({
      abertos: (de, ate) =>
        supabase
          .from("pedidos_compra")
          .select(COLUNAS_COMPRA)
          .not("status", "in", `(${STATUS_COMPRA_ENCERRADA.join(",")})`)
          .order("criado_em", { ascending: false })
          .order("id", { ascending: false })
          .range(de, ate),
      encerrados: (de, ate, contar) =>
        supabase
          .from("pedidos_compra")
          .select(COLUNAS_COMPRA, contar ? { count: "exact" } : undefined)
          .in("status", STATUS_COMPRA_ENCERRADA)
          .order("criado_em", { ascending: false })
          .order("id", { ascending: false })
          .range(de, ate),
      todos: todasEncerradas,
    })),
    leitura.de("projetos", supabase.from("projetos").select("id, nome").order("nome")),
    // só o que há para repor, já na unidade do saldo: o banco filtra, ordena e conta (antes vinham a previsão e o saldo inteiros)
    leitura.de("previsão de compra", supabase
      .from("v_previsao_suprimentos")
      .select("insumo_id, especificacao, disponivel, qtd_sugerida_compra, unidade, unidade_saldo, categoria_compra", { count: "exact" })
      .gt("qtd_sugerida_compra", 0)
      .order("qtd_sugerida_compra", { ascending: false })
      .order("insumo_id")
      .range(0, SUGESTOES_NA_TELA - 1)),
  ]);
  const pedidos = [...comprasLidas.data].sort(
    (a, b) => String(b.criado_em ?? "").localeCompare(String(a.criado_em ?? "")) || b.id - a.id,
  );
  const projetoNome = new Map((projetos ?? []).map((p) => [p.id, p.nome]));
  // Compra única na tela: a compra que nasceu de pedido abre o pedido, já no
  // quadro "Compra". A leitura vai em lotes para a lista de ids caber no endereço.
  const idsDasCompras = pedidos.map((p) => p.id);
  const lotesDeIds: number[][] = [];
  for (let i = 0; i < idsDasCompras.length; i += LOTE_PEDIDOS_DE_ORIGEM) {
    lotesDeIds.push(idsDasCompras.slice(i, i + LOTE_PEDIDOS_DE_ORIGEM));
  }
  const pedidosLidos = await Promise.all(
    lotesDeIds.map((lote) =>
      leitura.de("pedidos das compras", supabase
        .from("pedidos_internos")
        .select("id, status, pedido_compra_id")
        .in("pedido_compra_id", lote)),
    ),
  );
  const pedidosPorCompra = new Map<number, { id: number; status: string | null }[]>();
  for (const pedido of pedidosLidos.flatMap((lido) => lido.data ?? [])) {
    if (pedido.pedido_compra_id == null) continue;
    const lista = pedidosPorCompra.get(pedido.pedido_compra_id) ?? [];
    lista.push({ id: pedido.id, status: pedido.status });
    pedidosPorCompra.set(pedido.pedido_compra_id, lista);
  }
  const linhas: CompraRow[] = pedidos.map((p) => {
    const st = STATUS[p.status] ?? { label: p.status, cls: "" };
    const fornecedorLido = Array.isArray(p.fornecedores) ? p.fornecedores[0] : p.fornecedores;
    const fornecedor = fornecedorLido?.nome ?? "—";
    const projeto = p.projeto_id != null ? projetoNome.get(p.projeto_id) ?? "—" : p.projeto ?? "—";
    const condutor = pedidoQueConduzCompra(pedidosPorCompra.get(p.id) ?? []);
    return {
      id: p.id as number,
      pedido: `#${p.id} · ${formatDate(p.data_solicitacao)}`,
      href: condutor ? hrefDoPedidoQueConduz(condutor) : `/compras/${p.id}`,
      origem: condutor ? pedidoInternoNumero(condutor.id) : "—",
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
  const sugestoes = (previsaoLida.data ?? [])
    .filter((p) => Number(p.qtd_sugerida_compra ?? 0) > 0)
    .slice(0, SUGESTOES_NA_TELA)
    .map((p) => ({
      especificacao: p.especificacao,
      disponivel: Number(p.disponivel ?? 0),
      sugerido: Number(p.qtd_sugerida_compra ?? 0),
      unidade: p.unidade_saldo ?? p.unidade ?? "",
      categoria: p.categoria_compra,
    }));
  // o total vem do banco: a tela mostra só as primeiras
  const totalSugestoes = Math.max(Number(previsaoLida.count ?? 0), sugestoes.length);


  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <AvisoLeitura falhas={leitura.falhas} />
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
                A linha abre o pedido, já no quadro <b>Compra</b>: é lá que se define o fornecedor, se fecha com ele
                (a compra já fica como enviada) e se encerra com pendência. A compra sem pedido, como a nova compra
                de uma pendência, abre a própria tela.
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
            <Link href="/pedido?novo=1" className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Novo pedido
            </Link>
          }
        />

        {/* sugestões */}
        {totalSugestoes > 0 && (
          <div className="mt-6 rounded-xl border border-warning-strong/30 bg-warning-soft p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1">
                  <h2 className="text-sm font-semibold text-warning-strong">Sugestões de reposição ({totalSugestoes})</h2>
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
              {sugestoes.map((s, i) => (
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

        {/* uma linha: a reposição começa pelo pedido; o botão de gerar fica na Situação do estoque (D6) */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <h2 className="font-medium text-foreground">Repor pelo pedido</h2>
            <HelpTip title="Repor pelo pedido">
              <p>
                A reposição começa como um <b>pedido</b> com os itens em falta. Depois de
                aprovado, ele vira a compra e segue até a chegada.
              </p>
            </HelpTip>
          </span>
          {totalSugestoes === 0 && (
            <Link href="/estoque/situacao" className="font-medium text-primary underline-offset-2 hover:underline">
              Repor pela Situação do estoque
            </Link>
          )}
        </div>

        <div className="mt-6">
          <ComprasTable rows={linhas} />
          <ListaParcial
            className="mt-3"
            mostrados={comprasLidas.encerrados.mostrados}
            total={comprasLidas.encerrados.total}
            oQue="compras recebidas ou canceladas"
            feminino
            hrefTodos="/compras?encerradas=todas"
            hrefRecentes={todasEncerradas ? "/compras" : undefined}
          />
        </div>
      </main>
    </div>
  );
}
