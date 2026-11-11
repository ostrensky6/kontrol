import { HelpTip } from "@/components/common/HelpTip";
import { formatNumber } from "@/lib/formatters";
import {
  explicarConsumo,
  ROTULO_CONFIANCA,
  rotuloUnidade,
  sugestaoCobertura,
  type Confianca,
  type LeituraConsumoMensal,
  type PrevisaoInsumo,
  type SugestaoCobertura,
} from "@/lib/estoque/consumo-mensal-dados";

const TOM: Record<Confianca, string> = {
  alta: "bg-success-soft text-success-strong",
  media: "bg-warning-soft text-warning-strong",
  baixa: "bg-warning-soft text-warning-strong",
  sem_dados: "bg-muted text-muted-foreground",
};

const NOME_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function nomeMes(mes: string) {
  const [ano, m] = mes.split("-");
  return `${NOME_MES[Number(m) - 1] ?? m}/${ano.slice(2)}`;
}

function SugestaoCompra({ sugestao, unidade }: { sugestao: SugestaoCobertura | null; unidade: (v: number | null) => string }) {
  if (!sugestao) return null;
  return (
    <p data-testid="sugestao-cobertura" className="rounded-md bg-info-soft px-3 py-2 text-info-strong">
      {sugestao.quantidade > 0
        ? <>Para cobrir o prazo de compra ({sugestao.prazoDias} dias) com este consumo, faltam <strong>{formatNumber(sugestao.quantidade)} {unidade(sugestao.quantidade)}</strong>, já descontando o disponível e o que está em pedido aberto.</>
        : <>O disponível e os pedidos abertos cobrem o prazo de compra ({sugestao.prazoDias} dias) com este consumo.</>}
      {sugestao.quantidade > 0 && sugestao.sugestaoAtual <= 0 && " A reposição automática, que usa só o histórico de saídas, ainda não sugere compra."}
    </p>
  );
}

/**
 * Consumo mensal calculado das saídas do estoque (0157), sem digitação.
 * `naFicha`: bloco da ficha do insumo, com título de seção (h2) e sem repetir o nome.
 */
export function ConsumoMensalPainel({ leitura, especificacao, previsao = null, naFicha = false }: {
  leitura: LeituraConsumoMensal;
  especificacao: string;
  previsao?: PrevisaoInsumo | null;
  naFicha?: boolean;
}) {
  if (!leitura.ok) {
    if (naFicha) {
      return (
        <section aria-labelledby="titulo-consumo-mensal" className="space-y-2 text-sm">
          <h2 id="titulo-consumo-mensal" className="text-base font-semibold">Consumo mensal</h2>
          <p role="status" className="text-muted-foreground">Sem dado. {leitura.message}</p>
        </section>
      );
    }
    return <p role="status" className="mt-4 border-t border-border pt-3 text-sm text-warning-strong">Consumo mensal indisponível. {leitura.message}</p>;
  }
  const c = leitura.dados;
  const unidade = (v: number | null) => rotuloUnidade(c.unidade, v);
  const ref = c.referencia;
  const Titulo = naFicha ? "h2" : "h4";
  return (
    <section
      aria-labelledby="titulo-consumo-mensal"
      className={naFicha ? "space-y-3 text-sm" : "mt-4 space-y-3 border-t border-border pt-3 text-sm"}
    >
      <div className="flex items-center gap-1">
        <Titulo id="titulo-consumo-mensal" className={naFicha ? "text-base font-semibold" : "font-semibold"}>
          {naFicha ? "Consumo mensal" : `Consumo mensal · ${especificacao}`}
        </Titulo>
        <HelpTip title="Como o consumo mensal é calculado">
          <p>O Kontrol soma as saídas registradas em cada mês completo, nos últimos {c.janela_meses} meses. O mês atual só entra quando terminar.</p>
          <p>Ajustes de inventário não contam como consumo.</p>
          <p>A confiança é alta quando há pelo menos 6 meses de histórico, saída em 4 deles e um consumo parecido de um mês para outro.</p>
          <p>O consumo de referência é o calculado quando a confiança é alta. Se não for, vale a estimativa manual, quando houver.</p>
        </HelpTip>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p>
          <span className="text-muted-foreground">Consumo de referência: </span>
          <strong className="text-base">
            {ref.valor === null ? "sem referência" : `${formatNumber(ref.valor)} ${unidade(ref.valor)}/mês`}
          </strong>
          {ref.origem !== "nenhuma" && <span className="text-muted-foreground"> ({ref.origem === "manual" ? "estimativa manual" : "calculado"})</span>}
        </p>
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TOM[c.confianca]}`}>
          {ROTULO_CONFIANCA[c.confianca]}
        </span>
      </div>
      <SugestaoCompra sugestao={sugestaoCobertura(c, previsao)} unidade={unidade} />
      {c.media_mensal !== null && (
        <p>Média calculada: {formatNumber(c.media_mensal)} {unidade(c.media_mensal)}/mês.</p>
      )}
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        {explicarConsumo(c).map((m) => <li key={m}>{m}</li>)}
      </ul>
      {c.meses.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">Saídas por mês</caption>
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="py-1 pr-4 font-medium">Mês</th>
                <th scope="col" className="py-1 pr-4 font-medium">Saídas</th>
                <th scope="col" className="py-1 font-medium">Ajustes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {c.meses.map((m) => (
                <tr key={m.mes}>
                  <th scope="row" className="py-1 pr-4 font-normal">{nomeMes(m.mes)}</th>
                  <td className="py-1 pr-4 tabular-nums">{formatNumber(m.saidas)} {unidade(m.saidas)}</td>
                  <td className="py-1 tabular-nums">{m.ajustes > 0 ? m.ajustes : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
