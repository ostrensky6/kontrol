"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { FILTROS_URL } from "@/lib/cadastros/painel-insumos";
import { HREF_SITUACAO, VISOES_SITUACAO, type VisaoSituacao } from "@/lib/estoque/controle-estoque";
import { cn } from "@/lib/utils";

/** Os filtros de categoria valem nos quadros e nos gráficos: trocar de visão não os apaga. */
const FILTROS_QUE_SEGUEM = [FILTROS_URL.categoriaCompra, FILTROS_URL.categoriaCurta];

/**
 * As três visões da Situação do estoque (por insumo, por lote e gráficos),
 * como eram no Controle de Estoque. A visão vai na URL (?ver=) para o link
 * abrir no mesmo lugar.
 */
export function VisoesSituacao({ visao, contagens }: { visao: VisaoSituacao; contagens: Partial<Record<VisaoSituacao, number>> }) {
  const atuais = useSearchParams();
  function href(id: VisaoSituacao) {
    const params = new URLSearchParams();
    if (id !== "insumo") params.set("ver", id);
    for (const chave of FILTROS_QUE_SEGUEM) {
      const valor = atuais?.get(chave);
      if (valor) params.set(chave, valor);
    }
    const consulta = params.toString();
    return consulta ? `${HREF_SITUACAO}?${consulta}` : HREF_SITUACAO;
  }
  return (
    <nav aria-label="Como ver a situação do estoque" className="flex flex-wrap gap-2 border-b border-border pb-3">
      {VISOES_SITUACAO.map((v) => {
        const ativa = v.id === visao;
        const contagem = contagens[v.id];
        return (
          <Link
            key={v.id}
            href={href(v.id)}
            aria-current={ativa ? "page" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors",
              ativa
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-primary/5",
            )}
          >
            {v.rotulo}
            {contagem != null && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs tabular-nums",
                  ativa ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                )}
              >
                {contagem}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
