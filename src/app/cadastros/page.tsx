import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCadastrosOrdenados } from "@/lib/cadastros/config";
import { CadastrosCards } from "@/components/cadastros/CadastrosCards";
import { CadastrosWorkbookPanel } from "@/components/cadastros/CadastrosWorkbookPanel";
import { PainelInsumos } from "@/components/cadastros/PainelInsumos";
import { HelpTip } from "@/components/common/HelpTip";
import { pode } from "@/lib/auth/permissao-efetiva";
import { createClientUntyped } from "@/lib/supabase/server";
import { hojeIso } from "@/lib/estoque/baixa";
import {
  inicioJanelaMeses,
  montarInsumosPainel,
  type InsumoPainelDb,
  type MovimentoPainelDb,
  type SaldoPainelDb,
} from "@/lib/cadastros/painel-insumos";

export const dynamic = "force-dynamic";

const LOTE = 1000;

/** Lê todas as linhas, de mil em mil (o PostgREST corta cada resposta em mil). */
async function lerTudo<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<{ linhas: T[]; erro: string | null }> {
  const linhas: T[] = [];
  for (let de = 0; ; de += LOTE) {
    const { data, error } = await consulta(de, de + LOTE - 1);
    if (error) return { linhas, erro: error.message };
    const pagina = (data ?? []) as T[];
    linhas.push(...pagina);
    if (pagina.length < LOTE) return { linhas, erro: null };
  }
}

async function carregarPainel(supabase: SupabaseClient, hoje: string) {
  const inicio = inicioJanelaMeses(hoje, 12);
  const [insumos, saldos, movimentos, leiturasDesfeitas] = await Promise.all([
    lerTudo<InsumoPainelDb>((de, ate) =>
      supabase
        .from("insumos")
        .select("id, especificacao, nome_item, categoria_compra, fabricante, codigo_fabricante, unidade, ponto_reposicao")
        .eq("ativo", true)
        .order("id")
        .range(de, ate),
    ),
    lerTudo<SaldoPainelDb>((de, ate) =>
      supabase.from("v_estoque_saldo").select("insumo_id, disponivel, em_maos, unidade_saldo, unidade").order("insumo_id").range(de, ate),
    ),
    lerTudo<MovimentoPainelDb>((de, ate) =>
      supabase
        .from("estoque_movimentacoes")
        .select("insumo_id, tipo, data")
        .in("tipo", ["entrada", "saida"])
        .gte("data", inicio)
        .order("id")
        .range(de, ate),
    ),
    // ajustes: os que desfazem uma leitura anulam a entrada ou a saída no gráfico
    lerTudo<MovimentoPainelDb>((de, ate) =>
      supabase
        .from("estoque_movimentacoes")
        .select("insumo_id, tipo, data, motivo")
        .eq("tipo", "ajuste")
        .gte("data", inicio)
        .order("id")
        .range(de, ate),
    ),
  ]);
  const erros = [insumos.erro, saldos.erro, movimentos.erro, leiturasDesfeitas.erro].filter(Boolean);
  return {
    insumos: montarInsumosPainel(insumos.linhas, saldos.linhas),
    movimentos: [...movimentos.linhas, ...leiturasDesfeitas.linhas],
    erro: erros.length ? `Parte do painel não carregou: ${erros.join("; ")}` : null,
  };
}

export default async function CadastrosIndex() {
  const cadastros = getCadastrosOrdenados();
  const hoje = hojeIso();
  const supabase = await createClientUntyped();
  // a importação grava em vários cadastros; cada linha ainda passa pelo RLS da tabela
  const [painel, ...permissoes] = await Promise.all([
    carregarPainel(supabase, hoje),
    pode("cadastros.editar"),
    pode("insumos.editar"),
    pode("projetos.editar"),
  ]);
  const podeImportar = permissoes.some(Boolean);

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <h1 className="text-xl font-semibold tracking-tight">Cadastros — painel de insumos</h1>
            <HelpTip title="Painel de insumos">
              <p>Visão geral dos insumos ativos do laboratório: quanto há disponível e o que está em falta.</p>
              <p>
                <b>Disponível</b> é o saldo em mãos menos o reservado, em quarentena, bloqueado e vencido (o mesmo do
                Estoque).
              </p>
              <p>
                <b>Mínimo</b> é o ponto de reposição do cadastro do insumo. <b>Nível crítico</b> = disponível abaixo do
                mínimo, incluindo o que está em falta (zerado). Insumo sem ponto de reposição aparece como{" "}
                <b>Sem mínimo definido</b>.
              </p>
              <p>
                O nível crítico não é o <b>Repor</b> do Estoque. O Repor também conta o que já está a caminho e o
                prazo da compra: um insumo crítico com compra a caminho pode não aparecer em Repor, e um insumo
                acima do mínimo pode já pedir compra.
              </p>
              <p>Clique num indicador ou numa categoria da lista para filtrar.</p>
            </HelpTip>
          </div>
          <a href="#todos-os-cadastros" className="text-sm font-medium text-primary hover:underline">
            Ir para todos os cadastros ↓
          </a>
        </div>

        <PainelInsumos insumos={painel.insumos} movimentos={painel.movimentos} hojeIso={hoje} erro={painel.erro} />

        <section id="todos-os-cadastros" aria-labelledby="todos-os-cadastros-titulo" className="mt-10 scroll-mt-20 border-t border-border pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="todos-os-cadastros-titulo" className="text-lg font-semibold tracking-tight">
              Cadastros — dados mestres
            </h2>
            <Link href="/cadastros/qualidade" className="inline-flex rounded-md border border-input bg-card px-3 py-2 text-sm font-medium hover:bg-muted">
              Revisar qualidade dos cadastros
            </Link>
          </div>
          <CadastrosWorkbookPanel podeImportar={podeImportar} />
          <CadastrosCards cadastros={cadastros} />
        </section>
      </main>
    </div>
  );
}
