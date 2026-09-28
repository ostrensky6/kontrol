import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { createClientUntyped } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ReceitaInsumo = {
  id: number;
  codigo_analise: string;
  especificacao_insumo: string | null;
  quantidade_por_amostra: number | null;
  insumo_id: number | null;
};

type Insumo = {
  id: number;
  especificacao: string;
  unidade: string | null;
  unidade_consumo: string | null;
  fator_conversao: number | null;
  custo_unitario: number | null;
  fornecedor_id: number | null;
};

type Lote = {
  id: number;
  codigo_lote: string | null;
  status: string;
  validade: string | null;
  validade_apos_abertura: string | null;
  insumos: { especificacao: string | null } | { especificacao: string | null }[] | null;
};

type Analise = { codigo: string; ativo: boolean; ofertavel: boolean };
type ItemOrcamento = { codigo_analise: string | null };

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function QualidadeCadastrosPage() {
  const supabase = await createClientUntyped();
  const [
    { data: receitasRaw },
    { data: insumosRaw },
    { data: lotesRaw },
    { data: analisesRaw },
    { data: itensOrcamentoRaw },
  ] = await Promise.all([
    supabase
      .from("insumo_analise")
      .select("id, codigo_analise, especificacao_insumo, quantidade_por_amostra, insumo_id")
      .gt("quantidade_por_amostra", 0),
    supabase
      .from("insumos")
      .select("id, especificacao, unidade, unidade_consumo, fator_conversao, custo_unitario, fornecedor_id")
      .order("especificacao"),
    supabase
      .from("lotes_estoque")
      .select("id, codigo_lote, status, validade, validade_apos_abertura, insumos(especificacao)")
      .not("status", "in", "(consumido,descartado)"),
    supabase.from("analises").select("codigo, ativo, ofertavel").order("codigo"),
    supabase.from("orcamento_itens").select("codigo_analise"),
  ]);

  const receitas = (receitasRaw ?? []) as ReceitaInsumo[];
  const insumos = (insumosRaw ?? []) as Insumo[];
  const lotes = (lotesRaw ?? []) as unknown as Lote[];
  const analises = (analisesRaw ?? []) as Analise[];
  const itensOrcamento = (itensOrcamentoRaw ?? []) as ItemOrcamento[];

  const receitasSemInsumo = receitas.filter((linha) => !linha.insumo_id);
  const insumosSemCusto = insumos.filter((insumo) => !(Number(insumo.custo_unitario) > 0));
  const insumosSemUnidade = insumos.filter((insumo) =>
    !insumo.unidade || !insumo.unidade_consumo || !(Number(insumo.fator_conversao) > 0),
  );
  const insumosSemFornecedor = insumos.filter((insumo) => !insumo.fornecedor_id);
  const lotesSemValidade = lotes.filter((lote) => !lote.validade && !lote.validade_apos_abertura);
  const codigosEmOrcamento = new Set(itensOrcamento.map((item) => item.codigo_analise).filter(Boolean));
  const analisesIndisponiveisEmOrcamento = analises.filter((analise) =>
    codigosEmOrcamento.has(analise.codigo) && (!analise.ativo || !analise.ofertavel),
  );
  const pendencias = [
    receitasSemInsumo.length,
    insumosSemCusto.length,
    insumosSemUnidade.length,
    insumosSemFornecedor.length,
    lotesSemValidade.length,
    analisesIndisponiveisEmOrcamento.length,
  ].reduce((total, quantidade) => total + quantidade, 0);

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <Breadcrumbs items={[{ label: "Cadastros", href: "/cadastros" }, { label: "Qualidade dos dados" }]} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <h1 className="text-xl font-semibold tracking-tight">Qualidade dos cadastros</h1>
            <HelpTip title="Qualidade dos cadastros">
              <p>
                Lista o que falta nos cadastros e pode <b>distorcer</b> custo, planejamento, compra ou
                proposta. Corrija antes que o problema chegue à operação.
              </p>
              <HelpExample>
                Um insumo sem custo entra como R$ 0 no custeio e barateia a análise.
              </HelpExample>
            </HelpTip>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${pendencias > 0 ? "bg-warning-soft text-warning-strong" : "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300"}`}>
            {pendencias} pendência(s)
          </span>
        </div>

        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Resumo titulo="Receitas sem insumo" valor={receitasSemInsumo.length} detalhe="consumo técnico sem item de estoque" href="#receitas" />
          <Resumo titulo="Insumos sem custo" valor={insumosSemCusto.length} detalhe="não entram com valor confiável no custeio" href="#custos" />
          <Resumo titulo="Unidade/fator ausente" valor={insumosSemUnidade.length} detalhe="pode distorcer reserva e conversão" href="#unidades" />
          <Resumo titulo="Fornecedor ausente" valor={insumosSemFornecedor.length} detalhe="enfraquece reposição e cotação" href="#fornecedores" />
          <Resumo titulo="Lotes sem validade" valor={lotesSemValidade.length} detalhe="não podem ser avaliados por FEFO" href="#lotes" />
          <Resumo titulo="Oferta em orçamento" valor={analisesIndisponiveisEmOrcamento.length} detalhe="análise inativa/não ofertável com uso orçado" href="#oferta" />
        </section>

        <Painel id="receitas" titulo="Receitas técnicas sem vínculo com estoque" vazio="Todas as receitas com consumo possuem insumo de estoque vinculado.">
          <Tabela cabecalhos={["Análise", "Insumo técnico", "Qtd./amostra", "Ação"]} linhas={receitasSemInsumo.map((linha) => [
            linha.codigo_analise,
            linha.especificacao_insumo ?? "sem especificação",
            String(linha.quantidade_por_amostra ?? 0),
            <Link key={linha.id} href={`/analises/${encodeURIComponent(linha.codigo_analise)}?view=materiais-insumos`} className="font-medium text-primary hover:underline">Vincular insumo</Link>,
          ])} vazio="Todas as receitas com consumo possuem insumo de estoque vinculado." />
        </Painel>

        <Painel id="custos" titulo="Insumos sem custo unitário" vazio="Todos os insumos possuem custo unitário positivo.">
          <Tabela cabecalhos={["Insumo", "Unidade", "Ação"]} linhas={insumosSemCusto.map((insumo) => [
            insumo.especificacao,
            insumo.unidade ?? "—",
            <Link key={insumo.id} href="/cadastros/insumos" className="font-medium text-primary hover:underline">Corrigir cadastro</Link>,
          ])} vazio="Todos os insumos possuem custo unitário positivo." />
        </Painel>

        <Painel id="unidades" titulo="Conversão de consumo incompleta" vazio="Unidades de estoque, consumo e fatores estão preenchidos.">
          <Tabela cabecalhos={["Insumo", "Estoque", "Consumo", "Fator"]} linhas={insumosSemUnidade.map((insumo) => [
            insumo.especificacao,
            insumo.unidade ?? "—",
            insumo.unidade_consumo ?? "—",
            String(insumo.fator_conversao ?? "—"),
          ])} vazio="Unidades de estoque, consumo e fatores estão preenchidos." />
        </Painel>

        <Painel id="fornecedores" titulo="Insumos sem fornecedor preferencial" vazio="Todos os insumos possuem fornecedor preferencial.">
          <Tabela cabecalhos={["Insumo", "Ação"]} linhas={insumosSemFornecedor.map((insumo) => [
            insumo.especificacao,
            <Link key={insumo.id} href="/cadastros/insumos" className="font-medium text-primary hover:underline">Definir fornecedor</Link>,
          ])} vazio="Todos os insumos possuem fornecedor preferencial." />
        </Painel>

        <Painel id="lotes" titulo="Lotes sem validade" vazio="Todos os lotes ativos têm validade informada.">
          <Tabela cabecalhos={["Lote", "Insumo", "Status", "Ação"]} linhas={lotesSemValidade.map((lote) => [
            lote.codigo_lote ?? `Lote #${lote.id}`,
            one(lote.insumos)?.especificacao ?? "—",
            lote.status,
            <Link key={lote.id} href={`/estoque/lotes/${lote.id}`} className="font-medium text-primary hover:underline">Informar validade</Link>,
          ])} vazio="Todos os lotes ativos têm validade informada." />
        </Painel>

        <Painel id="oferta" titulo="Análises indisponíveis ainda presentes em orçamento" vazio="Nenhum orçamento referencia análise inativa ou fora de oferta.">
          <Tabela cabecalhos={["Análise", "Ativa", "Ofertável", "Ação"]} linhas={analisesIndisponiveisEmOrcamento.map((analise) => [
            analise.codigo,
            analise.ativo ? "sim" : "não",
            analise.ofertavel ? "sim" : "não",
            <Link key={analise.codigo} href={`/analises/${encodeURIComponent(analise.codigo)}`} className="font-medium text-primary hover:underline">Revisar análise</Link>,
          ])} vazio="Nenhum orçamento referencia análise inativa ou fora de oferta." />
        </Painel>
      </main>
    </div>
  );
}

function Resumo({ titulo, valor, detalhe, href }: { titulo: string; valor: number; detalhe: string; href: string }) {
  return (
    <a href={href} className={`rounded-xl border p-4 shadow-sm transition hover:bg-muted/40 ${valor > 0 ? "border-warning-strong/30 bg-warning-soft/40" : "border-border bg-card"}`}>
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{valor}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>
    </a>
  );
}

function Painel({ id, titulo, children }: { id: string; titulo: string; vazio: string; children: ReactNode }) {
  return <section id={id} className="mt-6 scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-sm"><h2 className="text-sm font-semibold">{titulo}</h2>{children}</section>;
}

function Tabela({ cabecalhos, linhas, vazio }: { cabecalhos: string[]; linhas: React.ReactNode[][]; vazio: string }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm"><thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground"><tr>{cabecalhos.map((cabecalho) => <th key={cabecalho} className="px-3 py-2 text-left">{cabecalho}</th>)}</tr></thead><tbody className="divide-y divide-border/70">{linhas.map((linha, index) => <tr key={index}>{linha.map((celula, coluna) => <td key={coluna} className="px-3 py-2">{celula}</td>)}</tr>)}{linhas.length === 0 && <tr><td colSpan={cabecalhos.length} className="px-3 py-6 text-center text-muted-foreground">{vazio}</td></tr>}</tbody></table>
    </div>
  );
}
