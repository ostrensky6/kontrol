"use client";

import { useEffect, useState } from "react";
import { LifeBuoy } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { hrefAjuda, topicoParaRota } from "@/lib/ajuda/secao";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Evento para abrir a ajuda: o "?" da barra do topo e, no celular, o da barra do logotipo. */
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
    match: (path) => path.startsWith("/estoque/leitura"),
    content: {
      title: "Entrada e saída por leitura",
      description: "Leia o código de barras do fabricante com o leitor USB ou a câmera do celular.",
      checks: [
        "Entrada: confira as embalagens (1 por padrão) e a validade; o lote é criado sozinho.",
        "Saída: cada leitura abre 1 embalagem do lote que vence primeiro.",
        "Código novo: vincule a um insumo ou cadastre; errou, use Desfazer a última.",
        "Códigos não reconhecidos, ao lado do título, mostra quantos códigos esperam cadastro.",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/estoque/inventario"),
    content: {
      title: "Inventário",
      description: "Contagem física por insumo (sem lote) ou por lote, com ajuste das diferenças.",
      checks: [
        "Abra uma contagem em Nova contagem e leia o código de barras do insumo, ou o local e o lote.",
        "Informe a quantidade contada; a diferença aparece na hora.",
        "Ajustes precisam de justificativa e ficam na auditoria.",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/estoque/situacao"),
    content: {
      title: "Situação do estoque",
      description: "O painel único de alertas: saldo, compra, validade e lotes.",
      checks: [
        "Urgente pede ação agora; Atenção pede acompanhamento de perto.",
        "Clique no nome para abrir a ficha do insumo ou a página do lote.",
        "Gerar pedidos de reposição cria um rascunho com os insumos que precisam de compra. O botão fica só aqui.",
        "A caminho, no fim, mostra o que já foi comprado e ainda não chegou.",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/estoque/insumos/"),
    content: {
      title: "Ficha do insumo",
      description: "Tudo sobre um insumo numa página: saldo, lotes, pedidos, reservas, consumo e análises.",
      checks: [
        "Disponível é o que pode ser usado agora; reservado já tem plano.",
        "A caminho conta só o que foi comprado ou autorizado e ainda não chegou.",
        "Os lotes aparecem na ordem em que vencem. Clique no lote para dar baixa ou ver o histórico.",
        "Número que não pôde ser lido aparece como “sem dado”, nunca como zero.",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/estoque"),
    content: {
      title: "Estoque",
      description: "Saldo, lotes, validade e reposição de cada insumo.",
      checks: [
        "Registrar chegada cria o lote, com o número do lote do fabricante e a validade.",
        "Dar baixa retira material com motivo (consumo, perda ou quebra, vencimento). Sai pelo lote que vence antes.",
        "Quem registra a chegada cadastra o lote e ele já fica disponível. A entrega ao laboratório é a baixa.",
        "Planilha de insumos baixa a lista completa (também em Cadastros → Insumos → Planilha).",
      ],
    },
  },
  {
    match: (path) => path === "/suprimentos",
    content: {
      title: "Compras: visão geral",
      description: "O que espera você e o andamento dos pedidos, do pedido ao recebimento.",
      checks: [
        "O quadro Aguardando você mostra o que depende de você em Compras. Clique no nome para abrir o registro.",
        "O quadro Andamento dos pedidos tem uma caixa por etapa; cada caixa abre os pedidos daquela etapa.",
        "A barra de cima segue a ordem do trabalho: Pedidos, Compras com fornecedor, Recebimento e Prazos de compra. O que chega pelo Recebimento entra no Estoque.",
      ],
    },
  },
  {
    match: (path) => path === "/pedido",
    content: {
      title: "Pedidos",
      description: "O que foi pedido e em que etapa cada pedido está, da solicitação ao pagamento.",
      checks: [
        "A linha Sua vez mostra os pedidos que dependem de você, como os que o coordenador precisa aprovar. Clique para abrir.",
        "Clique numa etapa para ver só os pedidos dela; Em andamento, Concluídos, Cancelados e Todos trocam o conjunto.",
        "Próximo passo diz o que falta e com quem está. Os botões de cada etapa ficam no topo do pedido, no quadro O que falta agora.",
      ],
    },
  },
  {
    match: (path) => /^\/pedido\/\d+/.test(path),
    content: {
      title: "Pedido",
      description: "Em que etapa o pedido está, o que falta agora e com quem.",
      checks: [
        "A trilha no topo mostra as seis etapas: as cumpridas levam um visto e a atual fica em destaque.",
        "O quadro O que falta agora diz o próximo passo, com quem está e o que vem depois. Com Sua vez, os botões ficam ali: aprovar ou devolver.",
        "Os itens ficam logo abaixo; documentos, aprovações e a linha do tempo, no fim da página.",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/compras") || path.startsWith("/recebimento") || path.startsWith("/pedido"),
    content: {
      title: "Compras",
      description: "Do pedido à chegada no estoque.",
      checks: [
        "Faltas de estoque viram pedido, que segue para aprovação e compra.",
        "Pedidos, Compras com fornecedor, Recebimento e Prazos de compra ficam na barra de cima, na ordem do trabalho.",
        "Registre a chegada dos itens pela própria compra.",
        "Ao registrar a chegada, o lote já fica disponível no estoque; a compra de um pedido é aprovada junto com ele, em “Aprovado para compra”.",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/planejamento"),
    content: {
      title: "Planejamento",
      description: "Organiza a execução: análises, datas, lotes reservados e faltas.",
      checks: [
        "Novo plano abre o formulário; informe projeto e período antes de reservar insumos.",
        "A aba Disputas de reserva mostra o que espera decisão.",
        "Reservar separa os lotes; a baixa só acontece em Iniciar.",
        "Faltas geram um pedido.",
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
        "A barra tem 4 grupos (Materiais, Pessoas e áreas, Comercial, Custos); as abas levam a cada cadastro.",
        "Qualidade dos cadastros, no topo, mostra quantas pendências existem e lista o que falta.",
        "Os alertas de estoque ficam em Estoque → Situação; o cartão Situação do estoque leva até lá.",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/governanca/incidentes"),
    content: {
      title: "Incidentes",
      description: "O que atrapalhou o trabalho, quem foi afetado e o que fazer enquanto isso.",
      checks: [
        "Coordenador ou acima registra: o que aconteceu, quem é afetado e a orientação.",
        "Causa não confirmada fica em branco; a tela mostra 'Causa ainda desconhecida'.",
        "Cada passo (em andamento, resolvido, reaberto) avisa as mesmas pessoas.",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/notificacoes"),
    content: {
      title: "Notificações",
      description: "Avisos para você: decisões pendentes, faltas, reposições, vencimentos e incidentes.",
      checks: [
        "Aprovações pendentes aparecem primeiro.",
        "O link de cada aviso abre o registro de origem.",
        "Os mesmos avisos chegam por e-mail; às segundas sai o resumo semanal para Coordenador ou acima.",
      ],
    },
  },
  {
    match: (path) => path === "/projetos" || path.startsWith("/projetos/"),
    content: {
      title: "Projetos",
      description: "Orçamentos, planejamentos e compras de cada projeto num só lugar.",
      checks: [
        "Abra o projeto para comparar o que foi orçado com o que já foi comprometido em compras.",
        "O coordenador do projeto é quem aprova os pedidos dele.",
        "Projeto sem coordenador não envia pedido para aprovação: indique um em Cadastros.",
      ],
    },
  },
  {
    match: (path) => path.startsWith("/usuarios") || path.startsWith("/governanca") || path.startsWith("/auditoria"),
    content: {
      title: "Governança",
      description: "Usuários, privilégios, auditoria, regras do orçamento e backups.",
      checks: [
        "Privilégios define, por caixinha, o que cada uma das seis funções pode fazer; ajustes de uma pessoa ficam em Usuários.",
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
        "Ctrl K (ou a lupa) busca telas e ações; o sino mostra o que espera você.",
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
    // Sem botão flutuante (cobria ações e a barra de salvar): a ajuda abre pelo
    // "?" da barra do topo e, no celular, pelo da barra do logotipo.
    <Dialog open={open} onOpenChange={setOpen}>
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
          href={hrefAjuda(topicoParaRota(pathname))}
          onClick={() => setOpen(false)}
          className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 dark:border-brand-900/50 dark:text-brand-300 dark:hover:bg-brand-950/30"
        >
          <LifeBuoy className="h-4 w-4" />
          Ver tudo sobre esta tela na Ajuda
        </Link>
      </DialogContent>
    </Dialog>
  );
}
