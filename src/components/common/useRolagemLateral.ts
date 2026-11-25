"use client";

import * as React from "react";

/**
 * Acompanha a rolagem lateral de uma caixa com tabela larga: diz se já rolou
 * (sombra da primeira coluna fixa) e se ainda há colunas escondidas à direita
 * (sombra da coluna de ações fixa). Recalcula quando a caixa muda de tamanho.
 */
export function useRolagemLateral<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [estado, setEstado] = React.useState({ rolado: false, maisADireita: false });

  const medir = React.useCallback(() => {
    const caixa = ref.current;
    if (!caixa) return;
    const rolado = caixa.scrollLeft > 0;
    const maisADireita = caixa.scrollWidth - caixa.clientWidth - caixa.scrollLeft > 1;
    setEstado((atual) =>
      atual.rolado === rolado && atual.maisADireita === maisADireita ? atual : { rolado, maisADireita },
    );
  }, []);

  React.useEffect(() => {
    const caixa = ref.current;
    if (!caixa) return;
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(medir);
    observador.observe(caixa);
    const tabela = caixa.firstElementChild;
    if (tabela) observador.observe(tabela);
    return () => observador.disconnect();
  }, [medir]);

  return {
    ref,
    onScroll: medir,
    "data-rolado": estado.rolado ? "true" : undefined,
    "data-mais-a-direita": estado.maisADireita ? "true" : undefined,
  } as const;
}
