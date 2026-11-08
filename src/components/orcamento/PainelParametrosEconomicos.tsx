import { formatCurrency as brl, formatPercent } from "@/lib/formatters";
import {
  ValorEntrada,
  ValorCalculado,
} from "@/components/common/ValorFinanceiro";
import { HelpExample, HelpFormula, HelpTip } from "@/components/common/HelpTip";

/**
 * Etapa "Parâmetros Econômicos" dentro do fluxo do orçamento (plano §6.5).
 *
 * Ordem de leitura: custos de origem, parâmetros aplicados e resultado do cálculo.
 * Convenção visual §8.2:
 * - percentuais (escolhidos pelo usuário) em AZUL (ValorEntrada);
 * - subtotais, valores em R$ e total (calculados) em NEUTRO (ValorCalculado).
 *
 * Política A (DEC-ORC-001): laboratório entra como CUSTO TÉCNICO, projeto como
 * CUSTO DIRETO, e o gross-up é único sobre o subtotal técnico. O preço
 * laboratorial já formado aparece apenas como REFERÊNCIA.
 *
 * Componente de apresentação puro — recebe os números já consolidados pela
 * engine autoritativa (`consolidarOrcamentoFinal` → `calcularPropostaEconomica`).
 */

export type ParametroAplicadoView = {
  key: string;
  label: string;
  nominalRate: number;
  amount: number;
};

const pct = (v: number) => formatPercent(v, 2);
type ValorOrigem = number | null | "nao_aplicavel";

function ValorDeOrigem({ valor, referencia }: { valor: ValorOrigem; referencia?: boolean }) {
  if (valor === "nao_aplicavel") return <span className="text-muted-foreground">Não se aplica</span>;
  if (valor === null) return <span className="text-warning-strong">Sem custo registrado</span>;
  return <ValorCalculado estado={referencia ? "snapshot" : undefined}>{brl(valor)}</ValorCalculado>;
}

function Linha({
  rotulo,
  children,
  forte,
}: {
  rotulo: string;
  children: React.ReactNode;
  forte?: boolean;
}) {
  return (
    <div className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 ${forte ? "border-t border-border pt-2" : ""}`}>
      <dt className={`text-sm ${forte ? "font-medium text-foreground" : "text-muted-foreground"}`}>
        {rotulo}
      </dt>
      <dd className="ml-auto text-right text-sm tabular-nums">{children}</dd>
    </div>
  );
}

export function PainelParametrosEconomicos({
  custoLaboratorio,
  precoLaboratorio,
  custoProjeto,
  subtotalTecnico,
  totalParametros,
  totalFinal,
  parametros,
  alertas = [],
  pendencias = [],
  economiaValida = true,
  resultadoPronto = true,
  editor,
}: {
  custoLaboratorio: ValorOrigem;
  precoLaboratorio: ValorOrigem;
  custoProjeto: ValorOrigem;
  subtotalTecnico: number;
  totalParametros: number;
  totalFinal: number;
  parametros: ParametroAplicadoView[];
  alertas?: string[];
  pendencias?: string[];
  economiaValida?: boolean;
  resultadoPronto?: boolean;
  editor?: React.ReactNode;
}) {
  const temBase = typeof custoLaboratorio === "number" || typeof custoProjeto === "number";
  const baseParcial = custoLaboratorio === null || custoProjeto === null;
  const temResultado = economiaValida && temBase;
  const subtotalRotulo = baseParcial ? "Subtotal dos custos registrados" : "Subtotal técnico";
  const avisos = [...new Set([...pendencias, ...alertas])];

  return (
    <div className="space-y-4">
      <section className="min-w-0 border-t border-border pt-4">
        <h3 className="text-base font-semibold">Custos de origem</h3>
        <dl className="mt-3 grid gap-x-6 gap-y-2 rounded-md bg-muted/40 p-3 lg:grid-cols-2">
          <Linha rotulo="Custo laboratório (técnico)">
            <ValorDeOrigem valor={custoLaboratorio} />
          </Linha>
          <Linha rotulo="Custo projeto (direto)">
            <ValorDeOrigem valor={custoProjeto} />
          </Linha>
          <Linha rotulo="Preço laboratório (referência)">
            <ValorDeOrigem valor={precoLaboratorio} referencia />
          </Linha>
          <Linha rotulo={subtotalRotulo}>
            <ValorCalculado estado="bloqueado">{temBase ? brl(subtotalTecnico) : "Indisponível"}</ValorCalculado>
          </Linha>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">O preço de referência do laboratório não entra no subtotal.</p>
      </section>

      <section className="min-w-0 border-t border-border pt-4">
        <div className="flex items-center gap-1">
          <h3 className="text-base font-semibold">Parâmetros aplicados</h3>
          <HelpTip title="Gross-up">
            <p>Os percentuais incidem sobre o <b>preço final</b>, e não sobre o custo. O preço de tabela do laboratório é só referência e não entra na conta.</p>
            <HelpFormula>total = subtotal técnico ÷ (1 − soma dos %)</HelpFormula>
            <HelpExample>Custo de R$ 1.000 com 16,33% de impostos e 20% de lucro (soma 36,33%) → R$ 1.000 ÷ 0,6367 = R$ 1.570,60.</HelpExample>
          </HelpTip>
        </div>
        <dl className="mt-3 space-y-2">
          {parametros.length === 0 ? (
            null
          ) : (
            parametros.map((p) => (
              <Linha key={p.key} rotulo={p.label}>
                <ValorEntrada>{pct(p.nominalRate)}</ValorEntrada>{" "}
                <span className="text-muted-foreground/80">·</span>{" "}
                <ValorCalculado>{temResultado ? brl(p.amount) : "Indisponível"}</ValorCalculado>
              </Linha>
            ))
          )}
          {parametros.length > 0 && (
            <Linha rotulo="Total de parâmetros" forte>
              <ValorCalculado estado="bloqueado">{temResultado ? brl(totalParametros) : "Indisponível"}</ValorCalculado>
            </Linha>
          )}
        </dl>
        {parametros.length === 0 && <p className="text-sm text-muted-foreground">Nenhum parâmetro aplicado.</p>}
        {editor}
      </section>

      <section className="min-w-0 border-t border-border pt-4">
        <h3 className="text-base font-semibold">Resultado do cálculo</h3>
        <p className={`mt-1 text-sm ${resultadoPronto && temResultado ? "text-muted-foreground" : "text-warning-strong"}`}>
          {!economiaValida ? "Parâmetros inválidos: ajuste os percentuais para calcular."
            : !temBase ? "Sem base de custo para calcular o resultado."
              : !resultadoPronto ? "Prévia com pendências. Não use como valor da proposta."
                : "Valor calculado nesta etapa; não é uma versão emitida."}
        </p>
        <dl className="mt-3 space-y-2 rounded-md border border-border bg-card p-3">
          <Linha rotulo={subtotalRotulo}>
            <ValorCalculado>{temBase ? brl(subtotalTecnico) : "Indisponível"}</ValorCalculado>
          </Linha>
          <Linha rotulo="Total de parâmetros">
            <ValorCalculado>{temResultado ? brl(totalParametros) : "Indisponível"}</ValorCalculado>
          </Linha>
          <Linha rotulo={resultadoPronto && temResultado ? "Total calculado" : "Total da prévia"} forte>
            <ValorCalculado estado="bloqueado" className="text-base">
              {temResultado ? brl(totalFinal) : "Indisponível"}
            </ValorCalculado>
          </Linha>
        </dl>
        {avisos.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 rounded-md border border-warning-strong/30 bg-warning-soft py-2 pl-7 pr-3 text-sm text-warning-strong">
            {avisos.map((aviso) => <li key={aviso}>{aviso}</li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
