"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { LINHA_EIXO, MARCA_EIXO, tituloEixoX, tituloEixoY } from "@/components/common/eixos-grafico";
import { HelpTip } from "@/components/common/HelpTip";
import { TabelaDoGrafico } from "@/components/common/TabelaDoGrafico";
import type { BarraSituacao, ResumoSinais } from "@/lib/estoque/controle-estoque";
import { formatInteger } from "@/lib/formatters";

const COR_BARRA: Record<BarraSituacao["tom"], string> = { red: "#b91c1c", amber: "#d97706", ok: "#008a00" };

/**
 * Visão em gráfico do controle do estoque: quantos insumos em cada situação,
 * as notas de controle e a saúde do estoque. Era a "Visão gráfica" do
 * Controle de Estoque (voltou na organização de 11/11/2026); a pizza virou
 * um gráfico de barras, com os dois eixos.
 */
export function ResumoGraficoEstoque({ barras, resumo }: { barras: BarraSituacao[]; resumo: ResumoSinais }) {
  const [montado, setMontado] = useState(false);
  useEffect(() => {
    // o recharts mede o contêiner: só desenha no cliente
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMontado(true);
  }, []);
  const altura = Math.max(200, barras.length * 38 + 60);

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <section aria-labelledby="grafico-insumos-situacao" className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-1">
          <h3 id="grafico-insumos-situacao" className="text-sm font-semibold">
            Insumos por situação
          </h3>
          <HelpTip title="Insumos por situação">
            <p>Cada insumo aparece uma vez, na situação mais grave que tem. As barras somam o total de insumos ativos.</p>
          </HelpTip>
        </div>
        <p className="text-xs text-muted-foreground">Todos os insumos ativos, pela situação mais grave de cada um.</p>
        <div className="mt-3 min-w-0" style={{ height: altura }}>
          {barras.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-md bg-muted/50 px-3 text-center text-xs text-muted-foreground">
              Nenhum insumo ativo
            </div>
          ) : montado ? (
            <ResponsiveContainer width="100%" height={altura}>
              <BarChart data={barras} layout="vertical" maxBarSize={22} margin={{ top: 4, left: 8, right: 16, bottom: 22 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} fontSize={12} tickLine={MARCA_EIXO} axisLine={LINHA_EIXO} label={tituloEixoX("Insumos")} />
                <YAxis type="category" dataKey="situacao" width={190} fontSize={11} tickLine={MARCA_EIXO} axisLine={LINHA_EIXO} label={tituloEixoY("Situação")} />
                <Tooltip cursor={{ fill: "rgba(148, 163, 184, 0.12)" }} />
                <Bar dataKey="insumos" name="Insumos" radius={[0, 4, 4, 0]}>
                  {barras.map((barra) => (
                    <Cell key={barra.situacao} fill={COR_BARRA[barra.tom]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : null}
        </div>
        <TabelaDoGrafico
          titulo="Insumos por situação"
          colunas={[
            { rotulo: "Situação", valor: (l) => l.situacao },
            { rotulo: "Insumos", valor: (l) => formatInteger(l.insumos) },
          ]}
          linhas={barras}
          chave={(l) => l.situacao}
        />
      </section>

      <section aria-labelledby="notas-de-controle" className="flex min-w-0 flex-col justify-between rounded-lg border border-border bg-card p-4 shadow-sm">
        <div>
          <h3 id="notas-de-controle" className="text-sm font-semibold">
            Notas de controle
          </h3>
          <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
            <Nota tom="red">
              <b className="text-foreground">{resumo.semEstoque} sem estoque</b>: abra o pedido de reposição.
            </Nota>
            <Nota tom="amber">
              <b className="text-foreground">{resumo.repor} para repor</b>: o disponível mais o que está a caminho não
              cobre o prazo da compra.
            </Nota>
            {resumo.reporAguardandoAprovacao > 0 && (
              <Nota tom="amber">
                <b className="text-foreground">{resumo.reporAguardandoAprovacao} com reposição aguardando aprovação</b>: o
                pedido já existe, mas ainda não foi aprovado.
              </Nota>
            )}
            <Nota tom="red">
              <b className="text-foreground">{resumo.compraAtrasada} com compra atrasada</b>: cobre o fornecedor ou
              encerre a compra.
            </Nota>
            <Nota tom="amber">
              <b className="text-foreground">{resumo.vencidosOuVencendo} com lote vencido ou vencendo</b>: dê baixa no
              vencido e use primeiro o que vence antes.
            </Nota>
            <Nota tom="ok">
              <b className="text-foreground">{resumo.emDia} em dia</b>, sem nenhum sinal.
            </Nota>
          </ul>
        </div>
        <div className="mt-5 border-t border-border pt-3" data-testid="taxa-de-saude">
          <div className="mb-1 flex items-center justify-between text-sm font-semibold">
            <span>Saúde do estoque</span>
            <span className="tabular-nums">{resumo.saudePct}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Saúde do estoque"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={resumo.saudePct}
            className="h-2 w-full rounded-full bg-muted"
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${resumo.saudePct}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {resumo.emDia} de {resumo.total} insumos ativos sem nenhum sinal.
          </p>
        </div>
      </section>
    </div>
  );
}

const PONTO = { red: "bg-danger-strong", amber: "bg-warning-strong", ok: "bg-success-strong" } as const;

function Nota({ tom, children }: { tom: keyof typeof PONTO; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${PONTO[tom]}`} aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}
