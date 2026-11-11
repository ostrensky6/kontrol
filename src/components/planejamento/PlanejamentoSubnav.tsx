"use client";

import { usePathname } from "next/navigation";

import { useAvisos } from "@/components/layout/AvisosContexto";
import { SubnavAbas } from "@/components/layout/SubnavAbas";

/**
 * Abas do Planejamento (revisão de 11/11, L12): as disputas de reserva não
 * tinham lugar em barra. O contador mostra as que esperam a decisão de quem
 * está logado (a mesma conta do sino). Na página de um plano as abas não
 * aparecem.
 */
export function PlanejamentoSubnav() {
  const pathname = usePathname() ?? "";
  const { dados } = useAvisos();
  if (pathname !== "/planejamento" && pathname !== "/planejamento/disputas") return null;
  const paraDecidir = dados.pendencias.find((pendencia) => pendencia.chave === "disputas_decidir")?.quantidade ?? 0;
  return (
    <SubnavAbas
      rotulo="Seções do planejamento"
      secoes={[
        { href: "/planejamento", label: "Planos", desc: "planos de execução e reservas de insumo" },
        {
          href: "/planejamento/disputas",
          label: "Disputas de reserva",
          desc: "pedir e decidir reserva de outro plano quando falta insumo",
          contador: paraDecidir,
        },
      ]}
    />
  );
}
