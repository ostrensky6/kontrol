/**
 * Quem aprova cada etapa do pedido interno (0169). A regra mora no banco
 * (kontrol_private.aprovadores_pedido); aqui só se lê o resultado e se monta
 * o texto da tela, para que tela e banco digam a mesma coisa.
 */

export type AprovadorCoordenador = {
  motivo: "coordenador_projeto" | "supervisao";
  rotulo: string;
  nome: string | null;
  email: string | null;
  ids: string[];
};

export type AprovadorLaboratorio = {
  area_id: number;
  area: string;
  nome: string | null;
  substituto_nome: string | null;
  ids: string[];
};

export type AprovadorFinanceiro = {
  nome: string | null;
  ids: string[];
};

export type AprovadoresPedido = {
  /** 0188: 2 = ordem nova (laboratório ou campo → financeiro → coordenador do projeto) */
  fluxo: 1 | 2;
  coordenador: AprovadorCoordenador | null;
  falta_coordenador: string | null;
  laboratorio_exigido: boolean;
  laboratorio: AprovadorLaboratorio | null;
  falta_laboratorio: string | null;
  financeiro: AprovadorFinanceiro | null;
  /** aviso, não trava: sem função Administrativo, o Administrador aprova */
  falta_financeiro: string | null;
};

type Rpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor : null;
}

function ids(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
}

/** Normaliza o JSON da RPC; devolve null quando não veio nada utilizável. */
export function normalizarAprovadores(bruto: unknown): AprovadoresPedido | null {
  if (!bruto || typeof bruto !== "object") return null;
  const r = bruto as Record<string, unknown>;
  const c = r.coordenador as Record<string, unknown> | null | undefined;
  const l = r.laboratorio as Record<string, unknown> | null | undefined;
  const f = r.financeiro as Record<string, unknown> | null | undefined;
  return {
    fluxo: Number(r.fluxo) === 2 ? 2 : 1,
    coordenador: c
      ? {
          motivo: c.motivo === "supervisao" ? "supervisao" : "coordenador_projeto",
          rotulo: texto(c.rotulo) ?? "Coordenador",
          nome: texto(c.nome),
          email: texto(c.email),
          ids: ids(c.ids),
        }
      : null,
    falta_coordenador: texto(r.falta_coordenador),
    laboratorio_exigido: r.laboratorio_exigido === true,
    laboratorio: l
      ? {
          area_id: Number(l.area_id),
          area: texto(l.area) ?? "Laboratório",
          nome: texto(l.nome),
          substituto_nome: texto(l.substituto_nome),
          ids: ids(l.ids),
        }
      : null,
    falta_laboratorio: texto(r.falta_laboratorio),
    financeiro: f ? { nome: texto(f.nome), ids: ids(f.ids) } : null,
    falta_financeiro: texto(r.falta_financeiro),
  };
}

export async function lerAprovadores(supabase: Rpc, pedidoId: number): Promise<AprovadoresPedido | null> {
  const { data, error } = await supabase.rpc("aprovadores_pedido_interno", { p_pedido_id: pedidoId });
  if (error) return null;
  return normalizarAprovadores(data);
}

/** Primeira trava do envio, em texto claro; null quando o pedido pode seguir. */
export function travaDoEnvio(aprovadores: AprovadoresPedido | null): string | null {
  if (!aprovadores) return null;
  // 0188: na ordem nova o laboratório ou campo é a primeira aprovação
  if (aprovadores.fluxo === 2) return aprovadores.falta_laboratorio ?? aprovadores.falta_coordenador ?? null;
  return aprovadores.falta_coordenador ?? aprovadores.falta_laboratorio ?? null;
}

export type EtapaAprovacao = {
  chave: "coordenador" | "laboratorio" | "financeiro";
  titulo: string;
  quem: string;
  situacao: "feita" | "aguardando" | "futura" | "travada";
  /** texto da situação, sempre escrito (a cor nunca é o único sinal) */
  rotuloSituacao: string;
  detalhe: string | null;
};

const ANTES_DA_VALIDACAO = ["rascunho", "ajuste_solicitante", "ajuste_compras"];

type PedidoEtapas = {
  status: string;
  aprovacao_area_em?: string | null;
  aprovacao_area_por?: string | null;
  aprovacao_financeiro_em?: string | null;
  aprovacao_financeiro_por?: string | null;
  natureza?: string | null;
};

const ORDEM_FLUXO_NOVO = ["aguardando_area", "aguardando_financeiro", "aguardando_projeto"] as const;

/**
 * 0188: as três aprovações da ordem nova, na ordem em que acontecem —
 * laboratório ou campo, financeiro, coordenador do projeto. 0189: entre o
 * financeiro e o coordenador, a cotação de quem pediu (não é aprovação).
 */
function etapasFluxoNovo(aprovadores: AprovadoresPedido, pedido: PedidoEtapas): EtapaAprovacao[] {
  const antes = ANTES_DA_VALIDACAO.includes(pedido.status);
  // 0189: na cotação, laboratório e financeiro já aprovaram; o coordenador vem depois dela
  const naCotacao = pedido.status === "aguardando_cotacao";
  const posicao = naCotacao ? 2 : (ORDEM_FLUXO_NOVO as readonly string[]).indexOf(pedido.status);
  const depoisDeTodas = !antes && posicao < 0;
  const situacaoDe = (indice: number, trava: string | null, feita: boolean) => {
    if (trava && antes) return { situacao: "travada" as const, rotulo: "Trava o envio" };
    if (feita || depoisDeTodas || (posicao >= 0 && indice < posicao)) return { situacao: "feita" as const, rotulo: "Feita" };
    if (indice === posicao && !naCotacao) return { situacao: "aguardando" as const, rotulo: "Aguardando" };
    const rotulo = indice === 0 ? "Depois do envio" : indice === 2 ? "Depois da cotação" : "Depois da anterior";
    return { situacao: "futura" as const, rotulo };
  };

  const l = aprovadores.laboratorio;
  const area = situacaoDe(0, aprovadores.falta_laboratorio, false);
  const f = aprovadores.financeiro;
  const fin = situacaoDe(1, null, false);
  const c = aprovadores.coordenador;
  const proj = situacaoDe(2, aprovadores.falta_coordenador, false);
  return [
    {
      chave: "laboratorio",
      titulo: l ? `Laboratório ou campo (${l.area})` : "Laboratório ou campo",
      quem: l?.nome ?? "Sem coordenação indicada",
      situacao: area.situacao,
      rotuloSituacao: area.rotulo,
      detalhe: area.situacao === "travada"
        ? aprovadores.falta_laboratorio
        : area.situacao === "feita" && pedido.aprovacao_area_por
          ? `Aprovado por ${pedido.aprovacao_area_por}.`
          : l?.substituto_nome
            ? `Substituto: ${l.substituto_nome}.`
            : null,
    },
    {
      chave: "financeiro",
      titulo: "Financeiro (fonte de pagamento)",
      quem: f?.nome ?? "Administrador",
      situacao: fin.situacao,
      rotuloSituacao: fin.rotulo,
      detalhe: fin.situacao === "feita" && pedido.aprovacao_financeiro_por
        ? `Aprovado por ${pedido.aprovacao_financeiro_por}.`
        : aprovadores.falta_financeiro,
    },
    {
      chave: "coordenador",
      titulo: c?.motivo === "supervisao" ? "Supervisão (pedido sem projeto)" : "Coordenador do projeto",
      quem: c?.nome ?? "Sem coordenador indicado",
      situacao: proj.situacao,
      rotuloSituacao: proj.rotulo,
      detalhe: proj.situacao === "travada"
        ? aprovadores.falta_coordenador
        : c
          ? `${c.rotulo}. Aprova por último, vendo os 3 orçamentos da cotação. Na ausência, o Administrador aprova como substituto.`
          : null,
    },
  ];
}

/** Linhas do quadro "Quem aprova", na ordem do fluxo. */
export function etapasAprovacao(
  aprovadores: AprovadoresPedido | null,
  pedido: PedidoEtapas,
): EtapaAprovacao[] {
  if (!aprovadores || pedido.status === "cancelado") return [];
  if (aprovadores.fluxo === 2) return etapasFluxoNovo(aprovadores, pedido);
  const etapas: EtapaAprovacao[] = [];
  const antes = ANTES_DA_VALIDACAO.includes(pedido.status);

  const c = aprovadores.coordenador;
  etapas.push({
    chave: "coordenador",
    titulo: c?.motivo === "supervisao" ? "Aprovação pela Supervisão" : "Aprovação pelo coordenador do projeto",
    quem: c?.nome ?? "Sem coordenador indicado",
    situacao: aprovadores.falta_coordenador && antes
      ? "travada"
      : pedido.status === "em_validacao"
        ? "aguardando"
        : antes
          ? "futura"
          : "feita",
    rotuloSituacao: aprovadores.falta_coordenador && antes
      ? "Trava o envio"
      : pedido.status === "em_validacao"
        ? "Aguardando"
        : antes
          ? "Depois do envio"
          : "Feita",
    detalhe: antes && aprovadores.falta_coordenador
      ? aprovadores.falta_coordenador
      : c
        ? `${c.rotulo}. Na ausência, o Administrador aprova como substituto.`
        : null,
  });

  if (aprovadores.laboratorio_exigido || pedido.natureza === "material_consumo_lab") {
    const l = aprovadores.laboratorio;
    const aprovada = Boolean(pedido.aprovacao_area_em);
    const travada = Boolean(aprovadores.falta_laboratorio) && antes;
    const depois = !antes && pedido.status !== "em_validacao" && pedido.status !== "validado";
    etapas.push({
      chave: "laboratorio",
      titulo: l ? `Coordenação do laboratório (${l.area})` : "Coordenação do laboratório",
      quem: l?.nome ?? "Sem coordenação indicada",
      situacao: travada ? "travada" : aprovada || depois ? "feita" : pedido.status === "validado" ? "aguardando" : "futura",
      rotuloSituacao: travada
        ? "Trava o envio"
        : aprovada || depois
          ? "Feita"
          : pedido.status === "validado"
            ? "Aguardando"
            : "Depois do coordenador",
      detalhe: travada
        ? aprovadores.falta_laboratorio
        : aprovada && pedido.aprovacao_area_por
          ? `Aprovado por ${pedido.aprovacao_area_por}.`
          : l?.substituto_nome
            ? `Substituto: ${l.substituto_nome}. Material de consumo de laboratório só segue para compras com esta aprovação.`
            : "Material de consumo de laboratório só segue para compras com esta aprovação.",
    });
  }
  return etapas;
}

/** O pedido validado ainda espera a coordenação do laboratório? */
export function aguardaLaboratorio(pedido: {
  status: string | null;
  natureza?: string | null;
  aprovacao_area_em?: string | null;
}): boolean {
  return pedido.status === "validado" && pedido.natureza === "material_consumo_lab" && !pedido.aprovacao_area_em;
}

/**
 * 0136 (D2), mesma regra do banco (kontrol_private.pode_decidir_proprio_pedido):
 * quem pediu não dá a aprovação final do próprio pedido, a não ser que
 * coordene o projeto ou seja o Administrador. Não é caixinha de Usuários: com
 * todas as permissões, a aprovação final do próprio pedido continua com outra
 * pessoa. Devolve o motivo para o botão, ou null quando pode.
 */
export function motivoProprioPedido({
  solicitante,
  emailUsuario,
  ehAdmin,
  coordenaProjeto,
}: {
  solicitante: string | null | undefined;
  emailUsuario: string | null | undefined;
  ehAdmin: boolean;
  coordenaProjeto: boolean;
}): string | null {
  if (ehAdmin || coordenaProjeto) return null;
  const quemPediu = (solicitante ?? "").trim().toLowerCase();
  const eu = (emailUsuario ?? "").trim().toLowerCase();
  if (!quemPediu || !eu || quemPediu !== eu) return null;
  return "Quem pediu não dá a aprovação final do próprio pedido. Ela fica com outra pessoa que tenha “Aprovar pedidos” ou com quem coordena o projeto.";
}

/**
 * 0188: quem decide a aprovação em que o pedido da ordem nova está, pela mesma
 * regra do banco (kontrol_private.pode_decidir_fluxo2). Quem conduz a compra
 * inteira (Administrador ou "Conduzir a compra inteira") decide qualquer uma.
 */
export function idsDaVezFluxoNovo(aprovadores: AprovadoresPedido | null, status: string | null | undefined): string[] {
  if (!aprovadores) return [];
  if (status === "aguardando_area") return aprovadores.laboratorio?.ids ?? [];
  if (status === "aguardando_financeiro") return aprovadores.financeiro?.ids ?? [];
  if (status === "aguardando_projeto") return aprovadores.coordenador?.ids ?? [];
  return [];
}

/** O usuário está entre os competentes (ou é o Administrador, como substituto)? */
export function usuarioDecide(ids: string[] | undefined, usuarioId: string | null | undefined, ehAdmin: boolean): boolean {
  if (ehAdmin) return true;
  return Boolean(usuarioId && ids?.includes(usuarioId));
}
