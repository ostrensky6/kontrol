import { rotuloCiclo, rotuloData } from "@/lib/pedido/ciclo";
import { emAprovacaoFluxoNovo } from "@/lib/pedido/status";

/**
 * Próximo passo do pedido, dito do mesmo jeito na lista e na página do pedido:
 * o que falta fazer agora, com quem está e o que vem depois. As regras de quem
 * pode agir moram no banco; aqui só se escreve o texto.
 */

export type ProximoPasso = {
  /** o que falta fazer agora, no imperativo (igual ao rótulo do botão quando há um só) */
  acao: string;
  /** com quem está */
  responsavel: string;
  /** o que acontece depois que este passo for feito; null no fim do processo */
  depois: string | null;
};

const PASSOS: Record<string, ProximoPasso> = {
  rascunho: {
    acao: "Enviar para aprovação",
    responsavel: "Solicitante",
    depois: "o coordenador do projeto aprova ou devolve o pedido.",
  },
  ajuste_solicitante: {
    acao: "Corrigir e reenviar",
    responsavel: "Solicitante",
    depois: "o pedido volta para quem devolveu.",
  },
  ajuste_compras: {
    acao: "Corrigir e reenviar",
    responsavel: "Solicitante, com Compras",
    depois: "o pedido volta para a análise administrativa.",
  },
  // 0188: ordem nova (laboratório ou campo → financeiro → coordenador do projeto)
  aguardando_area: {
    acao: "Aprovar pelo laboratório ou campo",
    responsavel: "Coordenação do laboratório ou do campo",
    depois: "o financeiro escolhe a fonte de pagamento e aprova.",
  },
  aguardando_financeiro: {
    acao: "Escolher a fonte de pagamento e aprovar",
    responsavel: "Financeiro (função Administrativo)",
    depois: "o coordenador do projeto dá a última aprovação.",
  },
  aguardando_projeto: {
    acao: "Aprovar pedido",
    responsavel: "Coordenador do projeto (sem projeto: Supervisão)",
    depois: "a compra fica liberada para Compras fechar.",
  },
  em_validacao: {
    acao: "Aprovar pedido",
    responsavel: "Coordenador do projeto (sem projeto: Supervisão)",
    depois: "o Administrativo formaliza a compra.",
  },
  validado: {
    acao: "Formalizar em compras",
    responsavel: "Compras/Administrativo",
    depois: "o Administrativo confere fonte do recurso e rubrica.",
  },
  formalizado: {
    acao: "Registrar análise administrativa",
    responsavel: "Administrativo",
    depois: "o Administrativo autoriza a compra.",
  },
  analise_administrativa: {
    acao: "Autorizar compra",
    responsavel: "Administrativo",
    depois: "Compras levanta os três orçamentos.",
  },
  aprovado_compra: {
    acao: "Registrar cotações",
    responsavel: "Compras",
    depois: "Compras anexa três orçamentos de fornecedores diferentes.",
  },
  orcamentos: {
    acao: "Anexar os três orçamentos",
    responsavel: "Compras",
    depois: "Compras escolhe um orçamento e envia para a aprovação final.",
  },
  orcamentos_recebidos: {
    acao: "Enviar para aprovação final",
    responsavel: "Compras",
    depois: "o coordenador aprova a compra final.",
  },
  aguardando_aprovacao_final: {
    acao: "Aprovar compra final",
    responsavel: "Coordenador",
    depois: "Compras fecha com o fornecedor ou encaminha à instituição.",
  },
  aprovado_para_compra: {
    acao: "Fechar a compra (direta ou pela instituição)",
    responsavel: "Compras",
    depois: "o Recebimento registra a chegada dos itens.",
  },
  compra_fechada: {
    acao: "Registrar a chegada dos itens (ou confirmar o serviço)",
    responsavel: "Recebimento",
    depois: "com tudo entregue, o pedido segue para o pagamento.",
  },
  encaminhado_instituicao: {
    acao: "Acompanhar a instituição e registrar a chegada dos itens",
    responsavel: "Administrativo e Recebimento",
    depois: "com tudo entregue, o pedido segue para o pagamento.",
  },
  aguardando_pagamento_nf: {
    acao: "Pagar e anexar a nota fiscal",
    responsavel: "Administrativo",
    depois: "a compra é concluída.",
  },
  compra_concluida: { acao: "Processo concluído", responsavel: "—", depois: null },
  cancelado: { acao: "Processo encerrado", responsavel: "—", depois: null },
};

export type ContextoProximoPasso = {
  /** quem aprova pelo projeto (nome vindo do banco ou do cadastro do projeto) */
  coordenador?: string | null;
  /** papel de quem aprova, ex.: "Coordenador do projeto" ou "Supervisão" */
  coordenadorRotulo?: string | null;
  /** o projeto não tem usuário coordenador ativo: ninguém consegue aprovar */
  semCoordenador?: boolean;
  /** pedido sem projeto: quem aprova é a Supervisão (0169) */
  semProjeto?: boolean;
  /** coordenação do laboratório, já com a área, ex.: "Sandra (Genética)" */
  laboratorio?: string | null;
  /** 0176: data em que o ciclo abre, quando o pedido espera o ciclo seguinte */
  cicloAbreEm?: string | null;
  /** 0188: quem aprova pelo financeiro (nomes da função Administrativo) */
  financeiro?: string | null;
};

export function proximoPasso(
  pedido: {
    status: string | null | undefined;
    natureza?: string | null;
    aprovacao_area_em?: string | null;
    fluxo?: number | null;
  },
  contexto: ContextoProximoPasso = {},
): ProximoPasso {
  const status = pedido.status ?? "rascunho";
  const materialDeLaboratorio = pedido.natureza === "material_consumo_lab";

  // 0188: a ordem nova diz o nome de quem aprova em cada vez
  if (Number(pedido.fluxo ?? 1) === 2 || emAprovacaoFluxoNovo(status)) {
    const doFluxoNovo = proximoPassoFluxoNovo(status, contexto);
    if (doFluxoNovo) return doFluxoNovo;
  }

  // 0169: material de consumo de laboratório ainda passa pela coordenação do laboratório
  if (status === "validado" && materialDeLaboratorio && !pedido.aprovacao_area_em) {
    return {
      acao: "Aprovar pelo laboratório",
      responsavel: contexto.laboratorio?.trim() || "Coordenação do laboratório",
      depois: PASSOS.em_validacao.depois,
    };
  }
  if (status === "em_validacao") {
    const nome = contexto.coordenador?.trim();
    return {
      acao: PASSOS.em_validacao.acao,
      responsavel:
        nome && nome !== "—"
          ? `${nome} (${contexto.coordenadorRotulo?.trim() || "coordenador do projeto"})`
          : contexto.semCoordenador
            ? "Projeto sem coordenador (o Administrador aprova)"
            : contexto.semProjeto
              ? "Supervisão"
              : PASSOS.em_validacao.responsavel,
      depois: materialDeLaboratorio
        ? "a coordenação do laboratório também aprova, por ser material de laboratório."
        : PASSOS.em_validacao.depois,
    };
  }
  // 0176: pedido do ciclo seguinte só segue para compras quando o ciclo abrir
  if (status === "validado" && contexto.cicloAbreEm) {
    return {
      acao: `Aguardar o ciclo de ${rotuloCiclo(contexto.cicloAbreEm)}`,
      responsavel: `Compras/Administrativo, a partir de ${rotuloData(contexto.cicloAbreEm)}`,
      depois: "quando o ciclo abrir, o Administrativo formaliza a compra.",
    };
  }
  return PASSOS[status] ?? { acao: "Revisar pedido", responsavel: "Operação", depois: null };
}

function proximoPassoFluxoNovo(status: string, contexto: ContextoProximoPasso): ProximoPasso | null {
  if (status === "rascunho") {
    return {
      acao: "Enviar para aprovação",
      responsavel: "Solicitante",
      depois: "o laboratório ou campo aprova ou devolve; depois o financeiro e o coordenador do projeto.",
    };
  }
  if (status === "ajuste_solicitante") return PASSOS.ajuste_solicitante;
  // 0176/0188: aprovado depois do dia 10, segue para compras quando o ciclo abrir
  if (status === "aprovado_para_compra" && contexto.cicloAbreEm) {
    return {
      acao: `Aguardar o ciclo de ${rotuloCiclo(contexto.cicloAbreEm)}`,
      responsavel: `Compras, a partir de ${rotuloData(contexto.cicloAbreEm)}`,
      depois: "quando o ciclo abrir, Compras fecha a compra (direta ou pela instituição).",
    };
  }
  if (status === "aguardando_area") {
    return { ...PASSOS.aguardando_area, responsavel: contexto.laboratorio?.trim() || PASSOS.aguardando_area.responsavel };
  }
  if (status === "aguardando_financeiro") {
    const nomes = contexto.financeiro?.trim();
    return { ...PASSOS.aguardando_financeiro, responsavel: nomes ? `${nomes} (financeiro)` : PASSOS.aguardando_financeiro.responsavel };
  }
  if (status === "aguardando_projeto") {
    const nome = contexto.coordenador?.trim();
    return {
      ...PASSOS.aguardando_projeto,
      responsavel:
        nome && nome !== "—"
          ? `${nome} (${contexto.coordenadorRotulo?.trim() || "coordenador do projeto"})`
          : contexto.semCoordenador
            ? "Projeto sem coordenador (o Administrador aprova)"
            : contexto.semProjeto
              ? "Supervisão"
              : PASSOS.aguardando_projeto.responsavel,
    };
  }
  return null;
}
