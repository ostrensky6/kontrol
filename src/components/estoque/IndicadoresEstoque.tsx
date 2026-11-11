import Link from "next/link";

import { StatCard } from "@/components/app/StatCard";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import {
  DETALHE_SEM_DADO_ESTOQUE,
  hrefListaPorInsumo,
  numerosDoEstoque,
  type ResumoSinais,
} from "@/lib/estoque/controle-estoque";

/**
 * Os cinco números do estoque, no topo da Situação do estoque: sem estoque,
 * repor, vencidos ou vencendo, compra atrasada e saúde. Eram os cartões do
 * Controle de Estoque (voltaram na organização de 11/11/2026). Cada número
 * abre a lista por insumo já filtrada; um insumo com dois sinais conta nos dois.
 * Sem resumo (parte da leitura falhou), os números mostram "sem dado".
 */
export function IndicadoresEstoque({ resumo }: { resumo: ResumoSinais | null }) {
  return (
    <section aria-label="Números do estoque" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {numerosDoEstoque(resumo).map((cartao) => (
        <Link
          key={cartao.filtro}
          href={hrefListaPorInsumo(cartao.filtro)}
          aria-label={`${cartao.label}: ${cartao.value}. ${cartao.detail}. Abre a lista`}
          className="block rounded-lg transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <StatCard label={cartao.label} value={cartao.value} detail={cartao.detail} tone={cartao.tone} className="h-full" />
        </Link>
      ))}
      <div className="relative" data-testid="saude-do-estoque">
        <StatCard
          label="Saúde do estoque"
          value={resumo ? `${resumo.saudePct}%` : "sem dado"}
          detail={resumo ? `${resumo.emDia} de ${resumo.total} insumos em dia` : DETALHE_SEM_DADO_ESTOQUE}
          tone={!resumo ? "neutral" : resumo.saudePct >= 80 ? "success" : resumo.saudePct >= 50 ? "warning" : "danger"}
          className="h-full"
        />
        <span className="absolute right-9 top-3">
          <HelpTip title="Saúde do estoque">
            <p>
              Percentual de insumos <b>em dia</b>: sem lote vencido, sem falta, sem compra atrasada e sem
              reposição a pedir.
            </p>
            <p>Nos outros números, um insumo com dois sinais conta nos dois.</p>
            <p>
              <b>Sem estoque</b> conta todo insumo com o disponível zerado, no número e nos quadros de alerta. O
              zerado que ainda não tem mínimo traz a observação <b>sem mínimo definido</b> na linha.
            </p>
            <HelpExample>40 insumos, 30 em dia → saúde de 75%.</HelpExample>
          </HelpTip>
        </span>
      </div>
    </section>
  );
}
