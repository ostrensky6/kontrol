"use client";

import * as React from "react";

/**
 * Acompanha a rolagem lateral de uma caixa larga (tabela, barra de lugares):
 * diz se já rolou (sombra da primeira coluna fixa) e se ainda há conteúdo
 * escondido à direita (sombra da coluna de ações fixa). Recalcula quando a
 * caixa ou o conteúdo muda de tamanho. O `ref` é de callback: vale também
 * para caixa que aparece depois (barra do topo ao trocar de módulo).
 */
export function useRolagemLateral<T extends HTMLElement>() {
  const [caixa, setCaixa] = React.useState<T | null>(null);
  const [estado, setEstado] = React.useState({ rolado: false, maisADireita: false });

  const medir = React.useCallback(() => {
    if (!caixa) return;
    const rolado = caixa.scrollLeft > 0;
    const maisADireita = caixa.scrollWidth - caixa.clientWidth - caixa.scrollLeft > 1;
    setEstado((atual) =>
      atual.rolado === rolado && atual.maisADireita === maisADireita ? atual : { rolado, maisADireita },
    );
  }, [caixa]);

  React.useEffect(() => {
    if (!caixa || typeof ResizeObserver === "undefined") return;
    // o observador avisa uma vez logo ao começar: serve de primeira medida
    const observador = new ResizeObserver(medir);
    observador.observe(caixa);
    for (const filho of Array.from(caixa.children)) observador.observe(filho);
    return () => observador.disconnect();
  }, [caixa, medir]);

  return {
    caixa,
    /** espalhar na caixa que rola: `<div {...props}>` */
    props: {
      ref: setCaixa,
      onScroll: medir,
      "data-rolado": estado.rolado ? "true" : undefined,
      "data-mais-a-direita": estado.maisADireita ? "true" : undefined,
    },
  } as const;
}
