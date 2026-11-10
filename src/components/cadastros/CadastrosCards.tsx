"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { CadastroConfig } from "@/lib/cadastros/config";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const GRUPOS = [
  { value: "todos", label: "Todos", slugs: [] },
  { value: "comercial", label: "Comercial", slugs: ["clientes", "projetos"] },
  { value: "custos", label: "Custos", slugs: ["equipamentos", "tecnicos", "overhead"] },
  { value: "materiais", label: "Materiais", slugs: ["tipo_insumos", "insumos", "fornecedores", "locais"] },
  { value: "compras", label: "Compras", slugs: ["coordenacoes", "responsaveis", "previsao_equipamentos"] },
] as const;

export function CadastrosCards({ cadastros }: { cadastros: CadastroConfig[] }) {
  const cardsPorGrupo = (slugs: readonly string[]) =>
    slugs.length === 0 ? cadastros : cadastros.filter((cadastro) => slugs.includes(cadastro.slug));

  return (
    <Tabs defaultValue="todos" className="mt-6">
      <TabsList className="flex w-full justify-start overflow-x-auto sm:w-auto">
        {GRUPOS.map((grupo) => (
          <TabsTrigger key={grupo.value} value={grupo.value}>
            {grupo.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {GRUPOS.map((grupo) => (
        <TabsContent key={grupo.value} value={grupo.value}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cardsPorGrupo(grupo.slugs).map((cadastro) => (
              <Link
                key={cadastro.slug}
                href={`/cadastros/${cadastro.slug}`}
                className="group block rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Card className="h-full transition-colors group-hover:border-primary/60 group-focus-visible:border-primary/60">
                  <CardHeader className="gap-1 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-base">{cadastro.titulo}</CardTitle>
                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>
                    <CardDescription className="text-xs">{cadastro.resumo}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
