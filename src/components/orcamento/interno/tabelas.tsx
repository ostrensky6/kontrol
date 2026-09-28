"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { formatCurrency as brl } from "@/lib/formatters";
import {
  ROTULO_TIPO_OPERACIONAL,
  formatarQuantidade,
  type GrupoInterno,
  type LinhaFundo,
  type VisaoInterna,
} from "@/lib/orcamento/visao-interna";

export const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

const thBase = "px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const th = `${thBase} text-right`;
const thEsq = `${thBase} text-left`;
const td = "px-2 py-1.5 text-right tabular-nums";

function Moldura({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-md border border-border">{children}</div>;
}

/** Itens de custo efetivo; no Resumo, agrupados por rubrica e recolhíveis. */
export function TabelaItens({ grupos, agrupar }: { grupos: GrupoInterno[]; agrupar: boolean }) {
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());
  const alternar = (id: string) =>
    setRecolhidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  const custo = grupos.reduce((acc, g) => acc + g.custoTotal, 0);
  const naProposta = grupos.reduce((acc, g) => acc + g.naProposta, 0);

  return (
    <Moldura>
      <table className="w-full min-w-[620px] text-sm">
        <colgroup>
          <col />
          <col className="w-[13%]" />
          <col className="w-[14%]" />
          <col className="w-[15%]" />
          <col className="w-[16%]" />
        </colgroup>
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <th scope="col" className={thEsq}>Item</th>
            <th scope="col" className={th}>Qtd.</th>
            <th scope="col" className={th}>Custo unit.</th>
            <th scope="col" className={th}>Custo total</th>
            <th scope="col" className={th}>Na proposta</th>
          </tr>
        </thead>
        {grupos.map((grupo) => {
          const recolhido = recolhidos.has(grupo.id);
          return (
            <tbody key={grupo.id} className="divide-y divide-border/70 border-b border-border last:border-b-0">
              {agrupar && (
                <tr className="bg-muted/30">
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => alternar(grupo.id)}
                      aria-expanded={!recolhido}
                      className="inline-flex items-center gap-1 font-medium hover:underline"
                    >
                      {recolhido ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {grupo.rotulo}
                      <span className="font-normal text-muted-foreground">
                        · {grupo.itens.length} {grupo.itens.length === 1 ? "item" : "itens"}
                      </span>
                    </button>
                  </td>
                  <td className={td} />
                  <td className={td} />
                  <td className={`${td} font-medium`}>{brl(grupo.custoTotal)}</td>
                  <td className={`${td} font-medium`}>{brl(grupo.naProposta)}</td>
                </tr>
              )}
              {!recolhido &&
                grupo.itens.map((item) => (
                  <tr key={item.id}>
                    <td className={`px-2 py-1.5 ${agrupar ? "pl-7" : ""}`}>
                      <span className={item.descricaoAusente ? "italic text-muted-foreground" : ""}>
                        {item.codigo && item.descricao !== item.codigo ? (
                          <>
                            <span className="font-medium">{item.codigo}</span> · {item.descricao}
                          </>
                        ) : (
                          item.descricao
                        )}
                      </span>
                      {(item.detalhe || item.precoReferencia != null) && (
                        <span className="block text-xs text-muted-foreground">
                          {[item.detalhe, item.precoReferencia != null ? `tabela ${brl(item.precoReferencia)}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                    </td>
                    <td className={td}>{formatarQuantidade(item.quantidade, item.unidade)}</td>
                    <td className={td}>{brl(item.custoUnitario)}</td>
                    <td className={td}>{brl(item.custoTotal)}</td>
                    <td className={td}>{brl(item.naProposta)}</td>
                  </tr>
                ))}
            </tbody>
          );
        })}
        <tfoot className="border-t-2 border-border font-medium">
          <tr>
            <td className="px-2 py-1.5">{grupos.length > 1 ? "Custos efetivos" : "Subtotal"}</td>
            <td className={td} />
            <td className={td} />
            <td className={td}>{brl(custo)}</td>
            <td className={td}>{brl(naProposta)}</td>
          </tr>
        </tfoot>
      </table>
    </Moldura>
  );
}

/** Impostos, taxas e margem + compensação do imposto (gross-up). */
export function TabelaOperacionais({ visao }: { visao: VisaoInterna }) {
  const linhas = visao.operacionais.filter((o) => o.tipo !== "fundo");
  const subtotal = linhas.reduce((acc, o) => acc + o.valorLimpo, 0);
  const impostos = visao.operacionais.find((o) => o.tipo === "imposto");
  const incubacao = visao.operacionais.find((o) => o.chave === "incubacao" && o.percentualInformado > 0);
  const compensaveis = visao.operacionais.filter((o) => o.tipo !== "imposto" && o.valorLimpo > 0);
  const divisor = 1 - visao.somaPercentual / 100;

  return (
    <div className="space-y-3">
      <Moldura>
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th scope="col" className={thEsq}>Item</th>
              <th scope="col" className={thEsq}>Tipo</th>
              <th scope="col" className={th}>% informado</th>
              <th scope="col" className={th}>% sobre o preço</th>
              <th scope="col" className={th}>Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {linhas.map((o) => (
              <tr key={o.chave} className={o.percentualInformado === 0 ? "text-muted-foreground" : ""}>
                <td className="px-2 py-1.5">{o.rotulo}</td>
                <td className="px-2 py-1.5">{ROTULO_TIPO_OPERACIONAL[o.tipo]}</td>
                <td className={td}>{pct(o.percentualInformado)}</td>
                <td className={td}>{pct(o.percentualSobrePreco)}</td>
                <td className={td}>{brl(o.valorLimpo)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-border font-medium">
            <tr>
              <td className="px-2 py-1.5" colSpan={3}>Subtotal (sem fundos)</td>
              <td className={td}>{pct(linhas.reduce((acc, o) => acc + o.percentualSobrePreco, 0))}</td>
              <td className={td}>{brl(subtotal)}</td>
            </tr>
          </tfoot>
        </table>
      </Moldura>

      {visao.efetivosCompensacao && (
        <div>
          <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
            Compensação do imposto: cada valor sai limpo
          </h4>
          <Moldura>
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th scope="col" className={thEsq}>Linha</th>
                  <th scope="col" className={th}>Valor limpo</th>
                  <th scope="col" className={th}>Imposto compensado</th>
                  <th scope="col" className={th}>Parte da nota</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                <tr>
                  <td className="px-2 py-1.5">Custos efetivos</td>
                  <td className={td}>{brl(visao.custosEfetivos)}</td>
                  <td className={td}>{brl(visao.efetivosCompensacao.impostoCompensado)}</td>
                  <td className={td}>{brl(visao.efetivosCompensacao.parteNota)}</td>
                </tr>
                {compensaveis.map((o) => (
                  <tr key={o.chave}>
                    <td className="px-2 py-1.5">
                      {o.rotulo} <span className="text-muted-foreground">{pct(o.percentualSobrePreco)}</span>
                    </td>
                    <td className={td}>{brl(o.valorLimpo)}</td>
                    <td className={td}>{brl(o.impostoCompensado ?? 0)}</td>
                    <td className={td}>{brl(o.parteNota ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border font-medium">
                <tr>
                  <td className="px-2 py-1.5">Total</td>
                  <td className={td}>{brl(visao.total - (impostos?.valorLimpo ?? 0))}</td>
                  <td className={td}>{brl(impostos?.valorLimpo ?? 0)}</td>
                  <td className={td}>{brl(visao.total)}</td>
                </tr>
              </tfoot>
            </table>
          </Moldura>
        </div>
      )}

      <div className="space-y-0.5 text-xs text-muted-foreground">
        {visao.legado ? (
          <p>Versão emitida com a regra econômica anterior: valores exibidos como foram gravados.</p>
        ) : (
          <>
            <p className="tabular-nums">
              Preço final = custos efetivos ÷ (1 − {pct(visao.somaPercentual)}) = {brl(visao.custosEfetivos)} ÷{" "}
              {divisor.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} = {brl(visao.total)}
            </p>
            {incubacao && impostos && (
              <p>
                A incubação incide sobre o preço sem impostos: {pct(incubacao.percentualInformado)} × (1 −{" "}
                {pct(impostos.percentualInformado)}) = {pct(incubacao.percentualSobrePreco)} do preço.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function TabelaFundos({
  linhas,
  percentualRecebido,
  hrefFundos,
}: {
  linhas: LinhaFundo[];
  percentualRecebido: number | null;
  hrefFundos: string;
}) {
  const acompanhado = percentualRecebido != null;
  const soma = (f: (l: LinhaFundo) => number | null) => linhas.reduce((acc, l) => acc + (f(l) ?? 0), 0);
  return (
    <div className="space-y-2">
      <Moldura>
        <table className="w-full min-w-[520px] text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th scope="col" className={thEsq}>Fundo</th>
              <th scope="col" className={th}>%</th>
              <th scope="col" className={th}>Previsto</th>
              <th scope="col" className={th}>Imposto compensado</th>
              {acompanhado && (
                <>
                  <th scope="col" className={th}>Liberado</th>
                  <th scope="col" className={th}>Usado</th>
                  <th scope="col" className={th}>Saldo</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {linhas.map((l) => (
              <tr key={l.chave} className={l.previsto === 0 ? "text-muted-foreground" : ""}>
                <td className="px-2 py-1.5">{l.rotulo}</td>
                <td className={td}>{pct(l.percentual)}</td>
                <td className={td}>{brl(l.previsto)}</td>
                <td className={td}>{l.impostoCompensado == null ? "—" : brl(l.impostoCompensado)}</td>
                {acompanhado && (
                  <>
                    <td className={td}>{brl(l.liberado)}</td>
                    <td className={td}>{brl(l.usado)}</td>
                    <td className={td}>{brl(l.saldo)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-border font-medium">
            <tr>
              <td className="px-2 py-1.5">Total</td>
              <td className={td}>{pct(linhas.reduce((acc, l) => acc + l.percentual, 0))}</td>
              <td className={td}>{brl(soma((l) => l.previsto))}</td>
              <td className={td}>{brl(soma((l) => l.impostoCompensado))}</td>
              {acompanhado && (
                <>
                  <td className={td}>{brl(soma((l) => l.liberado))}</td>
                  <td className={td}>{brl(soma((l) => l.usado))}</td>
                  <td className={td}>{brl(soma((l) => l.saldo))}</td>
                </>
              )}
            </tr>
          </tfoot>
        </table>
      </Moldura>
      <p className="text-xs text-muted-foreground">
        {acompanhado
          ? `Cliente pagou ${pct(Math.round((percentualRecebido ?? 0) * 1000) / 10)} do total: o liberado acompanha o pagamento. `
          : "Liberado, usado e saldo aparecem depois da aprovação, conforme os pagamentos lançados. "}
        <Link href={hrefFundos} className="font-medium text-primary hover:underline">
          Lançar pagamentos e usos em Fundos e taxas
        </Link>
      </p>
    </div>
  );
}
