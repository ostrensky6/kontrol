import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { createClientUntyped } from "@/lib/supabase/server";
import { lerQualidadeDosCadastros } from "@/lib/cadastros/qualidade";

export const dynamic = "force-dynamic";

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function QualidadeCadastrosPage() {
  const supabase = await createClientUntyped();
  const {
    receitasSemInsumo,
    insumosSemCusto,
    insumosSemUnidade,
    insumosSemFornecedor,
    lotesSemValidade,
    analisesIndisponiveisEmOrcamento,
    pendencias,
    incompleto,
  } = await lerQualidadeDosCadastros(supabase);

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <Breadcrumbs items={[{ label: "Cadastros", href: "/cadastros" }, { label: "Qualidade dos cadastros" }]} />
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

        {incompleto && (
          <p role="alert" className="mt-4 rounded-md border border-warning-strong/30 bg-warning-soft px-3 py-2 text-sm text-warning-strong">
            Parte dos dados não carregou. Os números abaixo podem estar incompletos; recarregue a página.
          </p>
        )}

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
