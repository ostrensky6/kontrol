"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { formatCurrency as brl } from "@/lib/formatters";
import { NOTA_VALOR_MASCARADO, VALOR_MASCARADO } from "@/lib/cadastros/mascara";
import {
  ROTULO_TIPO_OPERACIONAL,
  formatarQuantidade,
  type GrupoInterno,
  type LinhaFundo,
  type VisaoInterna,
} from "@/lib/orcamento/visao-interna";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

const th = "text-right";
const td = "text-right tabular-nums";

/** Valor de pessoal sem a permissão (DC8). */
function valor(numero: number, mascarado?: boolean) {
  return mascarado ? <span title={NOTA_VALOR_MASCARADO}>{VALOR_MASCARADO}</span> : brl(numero);
}

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
  // Com pessoal mascarado, a soma das linhas não fecha: o rodapé também fica oculto.
  const rodapeMascarado = grupos.some((g) => g.mascarado);

  return (
    <Moldura>
      <Table densidade="compacta" className="min-w-[620px]">
        <colgroup>
          <col />
          <col className="w-[13%]" />
          <col className="w-[14%]" />
          <col className="w-[15%]" />
          <col className="w-[16%]" />
        </colgroup>
        <TableHeader className="bg-muted/60">
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col">Item</TableHead>
            <TableHead scope="col" className={th}>Qtd.</TableHead>
            <TableHead scope="col" className={th}>Custo unit.</TableHead>
            <TableHead scope="col" className={th}>Custo total</TableHead>
            <TableHead scope="col" className={th}>Na proposta</TableHead>
          </TableRow>
        </TableHeader>
        {grupos.map((grupo) => {
          const recolhido = recolhidos.has(grupo.id);
          return (
            <TableBody key={grupo.id} className="border-b border-border last:border-b-0">
              {agrupar && (
                <TableRow className="bg-muted/30">
                  <TableCell>
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
                  </TableCell>
                  <TableCell className={td} />
                  <TableCell className={td} />
                  <TableCell className={`${td} font-medium`}>{valor(grupo.custoTotal, grupo.mascarado)}</TableCell>
                  <TableCell className={`${td} font-medium`}>{valor(grupo.naProposta, grupo.mascarado)}</TableCell>
                </TableRow>
              )}
              {!recolhido &&
                grupo.itens.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className={agrupar ? "first:pl-7" : undefined}>
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
                    </TableCell>
                    <TableCell className={td}>{formatarQuantidade(item.quantidade, item.unidade)}</TableCell>
                    <TableCell className={td}>{valor(item.custoUnitario, item.mascarado)}</TableCell>
                    <TableCell className={td}>{valor(item.custoTotal, item.mascarado)}</TableCell>
                    <TableCell className={td}>{valor(item.naProposta, item.mascarado)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          );
        })}
        <TableFooter className="border-t-2 border-border font-medium">
          <TableRow>
            <TableCell>{grupos.length > 1 ? "Custos efetivos" : "Subtotal"}</TableCell>
            <TableCell className={td} />
            <TableCell className={td} />
            <TableCell className={td}>{valor(custo, rodapeMascarado)}</TableCell>
            <TableCell className={td}>{valor(naProposta, rodapeMascarado)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
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
        <Table densidade="compacta" className="min-w-[560px]">
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col">Item</TableHead>
              <TableHead scope="col">Tipo</TableHead>
              <TableHead scope="col" className={th}>% informado</TableHead>
              <TableHead scope="col" className={th}>% sobre o preço</TableHead>
              <TableHead scope="col" className={th}>Valor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((o) => (
              <TableRow key={o.chave} className={o.percentualInformado === 0 ? "text-muted-foreground" : ""}>
                <TableCell>{o.rotulo}</TableCell>
                <TableCell>{ROTULO_TIPO_OPERACIONAL[o.tipo]}</TableCell>
                <TableCell className={td}>{pct(o.percentualInformado)}</TableCell>
                <TableCell className={td}>{pct(o.percentualSobrePreco)}</TableCell>
                <TableCell className={td}>{brl(o.valorLimpo)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="border-t-2 border-border font-medium">
            <TableRow>
              <TableCell colSpan={3}>Subtotal (sem fundos)</TableCell>
              <TableCell className={td}>{pct(linhas.reduce((acc, o) => acc + o.percentualSobrePreco, 0))}</TableCell>
              <TableCell className={td}>{brl(subtotal)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Moldura>

      {visao.efetivosCompensacao && (
        <div>
          <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
            Compensação do imposto: cada valor sai limpo
          </h4>
          <Moldura>
            <Table densidade="compacta" className="min-w-[520px]">
              <TableHeader className="bg-muted/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">Linha</TableHead>
                  <TableHead scope="col" className={th}>Valor limpo</TableHead>
                  <TableHead scope="col" className={th}>Imposto compensado</TableHead>
                  <TableHead scope="col" className={th}>Parte da nota</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Custos efetivos</TableCell>
                  <TableCell className={td}>{brl(visao.custosEfetivos)}</TableCell>
                  <TableCell className={td}>{brl(visao.efetivosCompensacao.impostoCompensado)}</TableCell>
                  <TableCell className={td}>{brl(visao.efetivosCompensacao.parteNota)}</TableCell>
                </TableRow>
                {compensaveis.map((o) => (
                  <TableRow key={o.chave}>
                    <TableCell>
                      {o.rotulo} <span className="text-muted-foreground">{pct(o.percentualSobrePreco)}</span>
                    </TableCell>
                    <TableCell className={td}>{brl(o.valorLimpo)}</TableCell>
                    <TableCell className={td}>{brl(o.impostoCompensado ?? 0)}</TableCell>
                    <TableCell className={td}>{brl(o.parteNota ?? 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter className="border-t-2 border-border font-medium">
                <TableRow>
                  <TableCell>Total</TableCell>
                  <TableCell className={td}>{brl(visao.total - (impostos?.valorLimpo ?? 0))}</TableCell>
                  <TableCell className={td}>{brl(impostos?.valorLimpo ?? 0)}</TableCell>
                  <TableCell className={td}>{brl(visao.total)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
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
        <Table densidade="compacta" className="min-w-[520px]">
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col">Fundo</TableHead>
              <TableHead scope="col" className={th}>%</TableHead>
              <TableHead scope="col" className={th}>Previsto</TableHead>
              <TableHead scope="col" className={th}>Imposto compensado</TableHead>
              {acompanhado && (
                <>
                  <TableHead scope="col" className={th}>Liberado</TableHead>
                  <TableHead scope="col" className={th}>Usado</TableHead>
                  <TableHead scope="col" className={th}>Saldo</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.chave} className={l.previsto === 0 ? "text-muted-foreground" : ""}>
                <TableCell>{l.rotulo}</TableCell>
                <TableCell className={td}>{pct(l.percentual)}</TableCell>
                <TableCell className={td}>{brl(l.previsto)}</TableCell>
                <TableCell className={td}>{l.impostoCompensado == null ? "—" : brl(l.impostoCompensado)}</TableCell>
                {acompanhado && (
                  <>
                    <TableCell className={td}>{brl(l.liberado)}</TableCell>
                    <TableCell className={td}>{brl(l.usado)}</TableCell>
                    <TableCell className={td}>{brl(l.saldo)}</TableCell>
                  </>
                )}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="border-t-2 border-border font-medium">
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className={td}>{pct(linhas.reduce((acc, l) => acc + l.percentual, 0))}</TableCell>
              <TableCell className={td}>{brl(soma((l) => l.previsto))}</TableCell>
              <TableCell className={td}>{brl(soma((l) => l.impostoCompensado))}</TableCell>
              {acompanhado && (
                <>
                  <TableCell className={td}>{brl(soma((l) => l.liberado))}</TableCell>
                  <TableCell className={td}>{brl(soma((l) => l.usado))}</TableCell>
                  <TableCell className={td}>{brl(soma((l) => l.saldo))}</TableCell>
                </>
              )}
            </TableRow>
          </TableFooter>
        </Table>
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
