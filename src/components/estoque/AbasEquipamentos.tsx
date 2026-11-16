import Link from "next/link";

import { cn } from "@/lib/utils";

export const ABAS_EQUIPAMENTOS = [
  { id: "unidades", rotulo: "Unidades", href: "/estoque/equipamentos", descricao: "cada aparelho, manutenção e avisos" },
  { id: "tipos", rotulo: "Tipos e custo", href: "/estoque/equipamentos/tipos", descricao: "o cadastro de equipamentos e o custo por dia" },
  { id: "previsao", rotulo: "Previsão de compra", href: "/estoque/equipamentos/previsao", descricao: "o que a equipe vai precisar comprar" },
] as const;

export type AbaEquipamentos = (typeof ABAS_EQUIPAMENTOS)[number]["id"];

/**
 * Equipamentos é uma tela só, em Estoque, com três abas: as unidades e a
 * manutenção, o cadastro de tipos com o custo e a previsão de compra. Cada
 * aba tem o seu endereço, para o link abrir no mesmo lugar.
 */
export function AbasEquipamentos({ ativa }: { ativa: AbaEquipamentos }) {
  return (
    // mesma aparência das outras abas de segundo nível (SubnavAbas): linha embaixo da aba aberta
    <nav aria-label="Abas de Equipamentos" className="flex gap-1 overflow-x-auto border-b border-border">
      {ABAS_EQUIPAMENTOS.map((aba) => {
        const atual = aba.id === ativa;
        return (
          <Link
            key={aba.id}
            href={aba.href}
            aria-current={atual ? "page" : undefined}
            title={aba.descricao}
            className={cn(
              "-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium transition-colors",
              atual
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            {aba.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
