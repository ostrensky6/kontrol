import Link from "next/link";
import { calcularTodas, carregarSimuladorCusteio } from "@/lib/costing/loader";
import { CusteioAmostrasChart } from "@/components/custeio/CusteioAmostrasChart";
import { CusteioTable, type CusteioRow } from "@/components/custeio/CusteioTable";
import { CusteioSimulator } from "@/components/custeio/CusteioSimulator";
import { HelpExample, HelpFormula, HelpTip } from "@/components/common/HelpTip";
import { podeVerSalario, pode } from "@/lib/auth/permissao-efetiva";
import { formatCurrency as brl } from "@/lib/formatters";

export const dynamic = "force-dynamic";

export default async function CusteioPage() {
  const { breakdowns, params, valorHoraPessoal, custoHoraOverhead } =
    await calcularTodas();
  const simulador = await carregarSimuladorCusteio();
  const [verRemuneracao, podeAjustarFatores] = await Promise.all([
    podeVerSalario(),
    pode("orcamento.parametros.editar"),
  ]);
  const codigosAtivos = new Set(simulador.analises.map((analise) => analise.codigo));

  const fatoresPct = (
    params.margem_lucro +
    params.impostos +
    params.taxas +
    params.fundo_reserva +
    params.fundo_investimento
  ).toFixed(1);
  const linhas: CusteioRow[] = breakdowns
    .filter((b) => codigosAtivos.has(b.codigo))
    .map((b) => ({
      codigo: b.codigo,
      lote: b.lote,
      reagentes: b.reagentes,
      equipamento: b.equipamento,
      pessoal: b.pessoal,
      custoAnalitico: b.custoAnalitico,
      overhead: b.overhead,
      custoTotal: b.custoTotal,
      preco: b.preco,
    }));

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <h1 className="text-xl font-semibold tracking-tight">Custeio por análise</h1>
            <HelpTip title="Como o custo é calculado">
              <p>Custo e preço por amostra de cada análise.</p>
              <p>
                O <b>custo analítico</b> de uma amostra soma reagentes, equipamento e pessoal. Com o{" "}
                <b>overhead</b> (custos fixos do laboratório por hora de bancada), forma o custo total.
              </p>
              <p>
                O preço de tabela aplica os fatores de preço, que hoje somam {fatoresPct}%
                {verRemuneracao ? <>; hora de pessoal {brl(valorHoraPessoal)}</> : null}; hora de
                overhead {brl(custoHoraOverhead)}.
              </p>
              <HelpFormula>preço = custo total × (1 + fatores)</HelpFormula>
            </HelpTip>
          </div>
          {podeAjustarFatores && (
            <Link href="/parametros" className="text-sm font-medium text-primary hover:underline">
              Ajustar fatores
            </Link>
          )}
        </div>

        <div className="mt-8">
          <CusteioTable rows={linhas} />
        </div>

        <CusteioAmostrasChart
          analises={simulador.analises}
          params={simulador.params}
          valorHoraPessoal={simulador.valorHoraPessoal}
          custoHoraOverhead={simulador.custoHoraOverhead}
        />

        <CusteioSimulator
          analises={simulador.analises}
          params={simulador.params}
          valorHoraPessoal={simulador.valorHoraPessoal}
          custoHoraOverhead={simulador.custoHoraOverhead}
        />

        <p className="mt-4 flex items-center gap-1 text-xs text-muted-foreground/80">
          Premissas do cálculo em revisão.
          <HelpTip title="Premissas do cálculo">
            <p>
              O <b>lote</b> é o número de amostras que cabem na etapa mais lenta da análise. Itens
              cobrados por corrida, como controles e calibrações, são divididos entre as amostras do
              lote.
            </p>
            <p>
              Quando a análise aceita reagentes alternativos, entra por enquanto o{" "}
              <b>mais barato</b>.
            </p>
            <HelpExample>
              Controle de R$ 60 por corrida e lote de 12 amostras: R$ 5 por amostra.
            </HelpExample>
          </HelpTip>
        </p>
      </main>
    </div>
  );
}
