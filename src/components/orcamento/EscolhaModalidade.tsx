"use client";

import { FlaskConical, FolderKanban, Layers, type LucideIcon } from "lucide-react";

import { EscolhaCartoes } from "@/components/common/EscolhaCartoes";

const ICONE_MODALIDADE: Record<string, LucideIcon> = {
  analises: FlaskConical,
  projeto: FolderKanban,
  projeto_com_analises: Layers,
  projeto_analises_custos: Layers,
  analises_projeto: FlaskConical,
};

export const OPCOES_MODALIDADE_ORCAMENTO: [string, string][] = [
  ["analises", "Análises laboratoriais"],
  ["projeto", "Projeto sem análises"],
  ["projeto_com_analises", "Projeto com análises"],
];

export const OPCOES_PRIORIDADE_ORCAMENTO = [
  { valor: "baixa", rotulo: "Baixa" },
  { valor: "normal", rotulo: "Normal" },
  { valor: "alta", rotulo: "Alta" },
  { valor: "urgente", rotulo: "Urgente" },
] as const;

/** Modalidade do orçamento em cartões com ícone (Novo orçamento e edição). */
export function EscolhaModalidade({
  id,
  name = "modalidade",
  opcoes = OPCOES_MODALIDADE_ORCAMENTO,
  valor,
  valorInicial,
  aoMudar,
  obrigatorio,
  className,
  empilhado = true,
  colunas,
}: {
  id: string;
  name?: string;
  empilhado?: boolean;
  colunas?: 2 | 3 | 4;
  opcoes?: [string, string][];
  valor?: string;
  valorInicial?: string;
  aoMudar?: (valor: string) => void;
  obrigatorio?: boolean;
  className?: string;
}) {
  return (
    <EscolhaCartoes
      id={id}
      name={name}
      legenda="Modalidade"
      obrigatorio={obrigatorio}
      variante="cartao"
      empilhado={empilhado}
      colunas={colunas}
      opcoes={opcoes.map(([v, rotulo]) => ({ valor: v, rotulo, icone: ICONE_MODALIDADE[v] }))}
      valor={valor}
      valorInicial={valorInicial}
      aoMudar={aoMudar}
      className={className}
    />
  );
}

/** Prioridade do orçamento em pílulas. */
export function EscolhaPrioridade({
  id,
  name = "prioridade",
  valorInicial,
  className,
}: {
  id: string;
  name?: string;
  valorInicial?: string;
  className?: string;
}) {
  return (
    <EscolhaCartoes
      id={id}
      name={name}
      legenda="Prioridade"
      opcoes={OPCOES_PRIORIDADE_ORCAMENTO}
      compacto
      valorInicial={valorInicial ?? "normal"}
      className={className}
    />
  );
}
