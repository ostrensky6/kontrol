"use client";

import { usePathname } from "next/navigation";

import { SubnavAbas } from "@/components/layout/SubnavAbas";
import { rotaDeConfiguracaoDoOrcamento } from "@/lib/orcamento/secoes-configuracao";

/**
 * Abas de Configurações dos orçamentos: aparecem só nas três telas de
 * configuração, logo abaixo da barra de Orçamentos, e mostram só as telas
 * que a pessoa pode abrir.
 */
export function ConfiguracoesSubnav({
  secoes,
}: {
  secoes: Array<{ href: string; label: string; desc: string }>;
}) {
  const pathname = usePathname() ?? "";
  if (!rotaDeConfiguracaoDoOrcamento(pathname) || secoes.length < 2) return null;
  return <SubnavAbas rotulo="Configurações dos orçamentos" secoes={secoes} />;
}
