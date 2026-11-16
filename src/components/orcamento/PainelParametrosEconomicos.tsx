import { formatCurrency as brl, formatPercent } from "@/lib/formatters";
import {
  ValorEntrada,
  ValorCalculado,
} from "@/components/common/ValorFinanceiro";
import { HelpExample, HelpFormula, HelpTip } from "@/components/common/HelpTip";

/**
 * Etapa "Parâmetros Econômicos" dentro do fluxo do orçamento (plano §6.5).
 *
 * Layout denso de 3 blocos (§8.1): base técnica → parâmetros aplicados →
 * resultado final, na mesma tela. Convenção visual §8.2:
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

function Bloco({ titulo, ajuda, children }: { titulo: string; ajuda?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">{titulo}{ajuda}</p>
      <div className="mt-2 space-y-1.5">{children}</div>
    </div>
  );
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
    <div className={`flex items-baseline justify-between gap-3 ${forte ? "border-t border-border pt-2" : ""}`}>
      <span className={`text-xs ${forte ? "font-medium text-foreground" : "text-muted-foreground"}`}>
        {rotulo}
      </span>
      <span className="tabular-nums text-sm">{children}</span>
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
}: {
  custoLaboratorio: number;
  precoLaboratorio: number;
  custoProjeto: number;
  subtotalTecnico: number;
  totalParametros: number;
  totalFinal: number;
  parametros: ParametroAplicadoView[];
  alertas?: string[];
}) {
  return (
    <div className="mt-4">
      <div className="grid gap-3 lg:grid-cols-3">
        {/* Bloco 1 — base técnica (Política A: custo técnico + custo direto) */}
        <Bloco titulo="Base de cálculo">
          <Linha rotulo="Custo laboratório (técnico)">
            <ValorCalculado>{brl(custoLaboratorio)}</ValorCalculado>
          </Linha>
          <Linha rotulo="Custo projeto (direto)">
            <ValorCalculado>{brl(custoProjeto)}</ValorCalculado>
          </Linha>
          <Linha rotulo="Subtotal técnico" forte>
            <ValorCalculado estado="bloqueado">{brl(subtotalTecnico)}</ValorCalculado>
          </Linha>
          <Linha rotulo="Preço laboratório (referência)">
            <ValorCalculado estado="snapshot">{brl(precoLaboratorio)}</ValorCalculado>
          </Linha>
        </Bloco>

        {/* Bloco 2 — parâmetros aplicados (percentual = entrada/azul, R$ = calculado) */}
        <Bloco
          titulo="Parâmetros aplicados · gross-up"
          ajuda={
            <HelpTip title="Gross-up">
              <p>Os percentuais incidem sobre o <b>preço final</b>, e não sobre o custo. O preço de tabela do laboratório é só referência e não entra na conta.</p>
              <HelpFormula>total = subtotal técnico ÷ (1 − soma dos %)</HelpFormula>
              <HelpExample>Custo de R$ 1.000 com 16,33% de impostos e 20% de lucro (soma 36,33%) → R$ 1.000 ÷ 0,6367 = R$ 1.570,60.</HelpExample>
            </HelpTip>
          }
        >
          {parametros.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum parâmetro aplicado.</p>
          ) : (
            parametros.map((p) => (
              <Linha key={p.key} rotulo={p.label}>
                <ValorEntrada>{pct(p.nominalRate)}</ValorEntrada>{" "}
                <span className="text-muted-foreground/80">·</span>{" "}
                <ValorCalculado>{brl(p.amount)}</ValorCalculado>
              </Linha>
            ))
          )}
          {parametros.length > 0 && (
            <Linha rotulo="Total de parâmetros" forte>
              <ValorCalculado estado="bloqueado">{brl(totalParametros)}</ValorCalculado>
            </Linha>
          )}
        </Bloco>

        {/* Bloco 3 — resultado final (calculado → neutro, total em destaque) */}
        <Bloco titulo="Resultado final">
          <Linha rotulo="Subtotal técnico">
            <ValorCalculado>{brl(subtotalTecnico)}</ValorCalculado>
          </Linha>
          <Linha rotulo="Total de parâmetros">
            <ValorCalculado>{brl(totalParametros)}</ValorCalculado>
          </Linha>
          <Linha rotulo="Total final" forte>
            <ValorCalculado estado="bloqueado" className="text-base">
              {brl(totalFinal)}
            </ValorCalculado>
          </Linha>
        </Bloco>
      </div>

      {alertas.length > 0 && (
        <div className="mt-3 rounded-md border border-warning-strong/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning-strong">
          {alertas.map((a, i) => (
            <p key={i}>{a}</p>
          ))}
        </div>
      )}
    </div>
  );
}
