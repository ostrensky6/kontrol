"use client";

import { useMemo, useState } from "react";

import { calcularAnalise, type Parametros } from "@/lib/costing/engine";
import type { SimuladorAnalise } from "@/lib/costing/loader";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { formatCurrency } from "@/lib/formatters";
import { TOM_ENTRADA } from "@/lib/orcamento/tom-valor";

export function CusteioSimulator({
  analises,
  params,
  valorHoraPessoal,
  custoHoraOverhead,
}: {
  analises: SimuladorAnalise[];
  params: Parametros;
  valorHoraPessoal: number;
  custoHoraOverhead: number;
}) {
  const [codigo, setCodigo] = useState(analises[0]?.codigo ?? "");
  const analise = analises.find((a) => a.codigo === codigo) ?? analises[0];
  const [lote, setLote] = useState(analise?.lotePadrao ?? 1);
  const [fator, setFator] = useState(0);
  const [escolhasGrupo, setEscolhasGrupo] = useState<Record<string, string>>({});

  const resultado = useMemo(() => {
    if (!analise) return null;
    return calcularAnalise({
      codigo: analise.codigo,
      etapas: analise.etapas,
      equip: analise.equip,
      insumos: analise.insumos,
      valorHoraPessoal,
      custoHoraOverhead,
      params: {
        ...params,
        margem_lucro: params.margem_lucro + fator,
      },
      cenario: { loteAmostras: lote, escolhasGrupo },
    });
  }, [analise, escolhasGrupo, custoHoraOverhead, fator, lote, params, valorHoraPessoal]);

  if (!analise || !resultado) return null;

  return (
    <section className="mt-8 rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1">
            <h2 className="text-lg font-semibold text-foreground dark:text-white">Simulador de cenário</h2>
            <HelpTip title="Simulador de cenário">
              <p>
                Teste outro tamanho de lote, a escolha de reagente e uma <b>margem adicional</b> e veja
                o preço recalcular ao vivo. Nada é gravado: os parâmetros do laboratório não mudam.
              </p>
              <p>A margem adicional soma pontos percentuais (p.p.) à margem de lucro atual.</p>
              <HelpExample>Margem de 20% com +10 p.p. → preço simulado com 30% de margem.</HelpExample>
            </HelpTip>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase text-muted-foreground">Preço simulado</div>
          <div className="text-2xl font-semibold text-brand-700 dark:text-brand-300">{formatCurrency(resultado.preco)}</div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Análise</span>
          <select
            value={analise.codigo}
            suppressHydrationWarning
            onChange={(event) => {
              const next = analises.find((a) => a.codigo === event.target.value);
              setCodigo(event.target.value);
              setLote(next?.lotePadrao ?? 1);
              setEscolhasGrupo({});
            }}
            className={`mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-medium ${TOM_ENTRADA}`}
          >
            {analises.map((a) => (
              <option key={a.codigo} value={a.codigo}>
                {a.codigo}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="flex justify-between text-xs font-medium text-muted-foreground">
            <span>Tamanho do lote</span>
            <span>{lote} amostras</span>
          </span>
          <input
            type="range"
            suppressHydrationWarning
            min={1}
            max={Math.max(192, analise.lotePadrao * 4)}
            step={1}
            value={lote}
            onChange={(event) => setLote(Number(event.target.value))}
            className="mt-3 w-full accent-brand-600"
          />
        </label>

        <label className="block">
          <span className="flex justify-between text-xs font-medium text-muted-foreground">
            <span>Margem adicional</span>
            <span>{fator.toFixed(0)} p.p.</span>
          </span>
          <input
            type="range"
            suppressHydrationWarning
            min={-30}
            max={60}
            step={1}
            value={fator}
            onChange={(event) => setFator(Number(event.target.value))}
            className="mt-3 w-full accent-primary"
          />
        </label>
      </div>

      {analise.grupos.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {analise.grupos.map((grupo) => (
            <label key={grupo.nome} className="block">
              <span className="text-xs font-medium text-muted-foreground">{grupo.nome}</span>
              <select
                value={escolhasGrupo[grupo.nome] ?? ""}
                suppressHydrationWarning
                onChange={(event) =>
                  setEscolhasGrupo((atual) => ({ ...atual, [grupo.nome]: event.target.value }))
                }
                className={`mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-medium ${TOM_ENTRADA}`}
              >
                <option value="">opção mais barata</option>
                {grupo.opcoes.map((opcao) => (
                  <option key={opcao} value={opcao}>
                    {opcao}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        {[
          ["Reagentes", resultado.reagentes],
          ["Equipamento", resultado.equipamento],
          ["Pessoal", resultado.pessoal],
          ["Overhead", resultado.overhead],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border border-border/70 bg-muted/50 p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 font-semibold tabular-nums">{formatCurrency(Number(value))}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
