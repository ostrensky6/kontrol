"use client";

import { useEffect, useState } from "react";
import { LifeBuoy } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Evento para abrir a ajuda a partir de outro botão (ex.: barra superior no celular). */
export const EVENTO_ABRIR_AJUDA = "kontrol:open-context-help";

export function abrirAjudaContextual() {
  window.dispatchEvent(new Event(EVENTO_ABRIR_AJUDA));
}

export type HelpContent = {
  title: string;
  description: string;
  checks: string[];
};

/** Ordem importa: a primeira regra que casar com a rota vence. */
export const HELP: Array<{ match: (path: string) => boolean; content: HelpContent }> = [
  {
    match: (path) => path.startsWith("/orcamento"),
    content: {
      title: "Orçamento",
      description: "Do pedido do cliente à proposta emitida. O preço fica registrado na proposta.",
      checks: [
        "Comece em Novo orçamento: cliente, análises e número de amostras.",
        "Confira os parâmetros econômicos (impostos, taxas, fundos) antes de emitir.",
        "Proposta aprovada pode virar planejamento de execução.",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/estoque/inventario"),
    content: {
      title: "Inventário",
      description: "Contagem física por local e lote, com ajuste das diferenças.",
      checks: [
        "Abra uma campanha de contagem e escaneie o local e o lote.",
        "Informe a quantidade contada; a diferença aparece na hora.",
        "Ajustes precisam de justificativa e ficam na auditoria.",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/estoque"),
    content: {
      title: "Estoque",
      description: "Saldo, lotes, validade e reposição de cada insumo.",
      checks: [
        "+ Entrada registra um lote recebido, com o número do lote do fabricante e a validade.",
        "Dar baixa retira material com motivo (consumo, perda ou quebra, vencimento). Sai pelo lote que vence antes.",
        "Lote novo entra em quarentena: aceite-o antes de usar.",
        "Planilha de insumos baixa a lista completa (também em Cadastros → Insumos → Planilha).",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/compras") || path.startsWith("/recebimento") || path.startsWith("/pedido"),
    content: {
      title: "Compras",
      description: "Do pedido interno ao recebimento no estoque.",
      checks: [
        "Faltas de estoque viram pedido interno, que segue para aprovação e compra.",
        "Receba os itens pelo próprio pedido de compra.",
        "Após o recebimento, aceite o lote que entrou em quarentena.",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/planejamento"),
    content: {
      title: "Planejamento",
      description: "Organiza a execução: análises, datas, lotes reservados e faltas.",
      checks: [
        "Informe projeto e período antes de reservar insumos.",
        "Reservar separa os lotes; a baixa só acontece em Iniciar.",
        "Faltas geram pedido interno de compra.",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/custeio") || path.startsWith("/parametros"),
    content: {
      title: "Custeio",
      description: "Custo por amostra de cada análise e o preço que sai dele.",
      checks: [
        "Mude o número de amostras no simulador para ver o custo cair com lotes maiores.",
        "Compare análises no gráfico de custo por número de amostras.",
        "Fatores de preço (margem, impostos, taxas, fundos) ficam em Parâmetros de custeio.",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/analises") || path.startsWith("/insumos"),
    content: {
      title: "Análises",
      description: "Catálogo técnico: etapas, tempos, equipamentos e insumos de cada análise.",
      checks: [
        "Nova análise cria em branco ou copiando outra; ⋯ na linha duplica ou exclui.",
        "Análise usada não pode ser excluída: inative-a na ficha (e reative quando quiser).",
        "Alterar insumos ou tempos muda o custo das próximas propostas.",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/cadastros"),
    content: {
      title: "Cadastros",
      description: "Dados básicos do laboratório: insumos, equipamentos, técnicos, fornecedores e clientes.",
      checks: [
        "Planilha baixa o cadastro; a mesma planilha preenchida pode ser importada.",
        "Salário dos técnicos só aparece para quem tem a permissão Ver salário dos técnicos.",
        "Qualidade dos cadastros lista o que falta e pode distorcer custos.",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/usuarios") || path.startsWith("/governanca") || path.startsWith("/auditoria"),
    content: {
      title: "Governança",
      description: "Usuários, permissões, auditoria e backups.",
      checks: [
        "Privilégios define o padrão de cada papel; ajustes individuais ficam em Usuários.",
        "Ver salário dos técnicos vem ligada só para administrador.",
        "Auditoria mostra quem alterou o quê, e quando.",
      ],
    },
  },
  {
    match: () => true,
    content: {
      title: "Kontrol",
      description: "Painel do laboratório: orçamento, estoque, compras e execução.",
      checks: [
        "Ctrl K (ou a lupa no celular) busca telas e ações.",
        "O ? ao lado de um título explica aquela parte da tela.",
        "Revise os alertas de estoque antes de abrir compras.",
      ],
    },
  },
];

export function ajudaParaRota(pathname: string): HelpContent {
  return HELP.find((item) => item.match(pathname))?.content ?? HELP[HELP.length - 1].content;
}

export function ContextHelp() {
  const pathname = usePathname();
  const content = ajudaParaRota(pathname);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const abrir = () => setOpen(true);
    window.addEventListener(EVENTO_ABRIR_AJUDA, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_AJUDA, abrir);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {/* No celular o botão flutuante cobriria ações e avisos no rodapé: lá a
            ajuda abre pelo ícone da barra superior (Sidebar). */}
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="fixed bottom-4 right-4 z-40 hidden h-10 w-10 rounded-full shadow-lg md:inline-flex print:hidden"
          aria-label="Ajuda contextual"
        >
          <LifeBuoy aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{content.title}</DialogTitle>
          <DialogDescription>{content.description}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm text-foreground">
          {content.checks.map((check) => (
            <li key={check} className="rounded-md border border-border bg-muted/50 px-3 py-2">
              {check}
            </li>
          ))}
        </ul>
        <Link
          href="/ajuda"
          onClick={() => setOpen(false)}
          className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 dark:border-brand-900/50 dark:text-brand-300 dark:hover:bg-brand-950/30"
        >
          <LifeBuoy className="h-4 w-4" />
          Abrir Central de Ajuda
        </Link>
      </DialogContent>
    </Dialog>
  );
}
