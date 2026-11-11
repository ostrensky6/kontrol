"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { AVISOS_VAZIOS, type AvisosDoSino } from "@/lib/pendencias/tipos";

const Contexto = createContext<{ dados: AvisosDoSino; atualizar: () => void }>({
  dados: AVISOS_VAZIOS,
  atualizar: () => {},
});

function ehAvisos(valor: unknown): valor is AvisosDoSino {
  if (!valor || typeof valor !== "object") return false;
  const v = valor as Partial<AvisosDoSino>;
  return Array.isArray(v.pendencias) && Array.isArray(v.avisos) && typeof v.naoLidos === "number";
}

/** Intervalo mínimo entre releituras ao voltar para a aba. */
const ESPERA_AO_VOLTAR_MS = 30_000;

/**
 * Guarda o que o sino mostra. O layout não é refeito quando a pessoa troca de
 * tela, então os dados são relidos a cada navegação, ao voltar para a aba e
 * ao abrir o sino. Falha de leitura mantém o último valor bom.
 */
export function AvisosProvider({ iniciais, children }: { iniciais: AvisosDoSino; children: React.ReactNode }) {
  const pathname = usePathname();
  const [dados, setDados] = useState(iniciais);
  const ultimaLeitura = useRef(0);
  const primeiraTela = useRef(true);

  const atualizar = useCallback(() => {
    ultimaLeitura.current = Date.now();
    fetch("/api/avisos", { cache: "no-store", headers: { accept: "application/json" } })
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((json: unknown) => {
        if (ehAvisos(json)) setDados(json);
      })
      .catch(() => {});
  }, []);

  // o layout mandou dados novos (ação no servidor refez a árvore)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDados(iniciais);
  }, [iniciais]);

  useEffect(() => {
    if (primeiraTela.current) {
      primeiraTela.current = false;
      return;
    }
    atualizar();
  }, [pathname, atualizar]);

  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - ultimaLeitura.current < ESPERA_AO_VOLTAR_MS) return;
      atualizar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [atualizar]);

  const valor = useMemo(() => ({ dados, atualizar }), [dados, atualizar]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useAvisos() {
  return useContext(Contexto);
}
