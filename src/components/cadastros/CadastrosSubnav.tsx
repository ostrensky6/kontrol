"use client";

import { usePathname } from "next/navigation";

import { SubnavAbas } from "@/components/layout/SubnavAbas";
import { grupoDoCadastro, slugDaRotaDeCadastro } from "@/lib/cadastros/grupos";

/**
 * Abas do grupo de cadastros aberto (ex.: em Materiais: Insumos, Tipos
 * técnicos, Equipamentos…). Grupo com um cadastro só não precisa de abas.
 */
export function CadastrosSubnav({ titulos }: { titulos: Record<string, string> }) {
  const pathname = usePathname() ?? "";
  const slug = slugDaRotaDeCadastro(pathname);
  const grupo = slug ? grupoDoCadastro(slug) : null;
  if (!grupo || grupo.slugs.length < 2) return null;
  return (
    <SubnavAbas
      rotulo={`Cadastros de ${grupo.label}`}
      secoes={grupo.slugs.map((item) => ({ href: `/cadastros/${item}`, label: titulos[item] ?? item }))}
    />
  );
}
