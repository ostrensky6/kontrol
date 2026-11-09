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

export type AprovadoresPedido = {
  coordenador: AprovadorCoordenador | null;
  falta_coordenador: string | null;
  laboratorio_exigido: boolean;
  laboratorio: AprovadorLaboratorio | null;
  falta_laboratorio: string | null;
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
  return {
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
  return aprovadores.falta_coordenador ?? aprovadores.falta_laboratorio ?? null;
}

export type EtapaAprovacao = {
  chave: "coordenador" | "laboratorio";
  titulo: string;
  quem: string;
  situacao: "feita" | "aguardando" | "futura" | "travada";
  /** texto da situação, sempre escrito (a cor nunca é o único sinal) */
  rotuloSituacao: string;
  detalhe: string | null;
};

const ANTES_DA_VALIDACAO = ["rascunho", "ajuste_solicitante", "ajuste_compras"];

/** Linhas do quadro "Quem aprova", na ordem do fluxo. */
export function etapasAprovacao(
  aprovadores: AprovadoresPedido | null,
  pedido: { status: string; aprovacao_area_em?: string | null; aprovacao_area_por?: string | null; natureza?: string | null },
): EtapaAprovacao[] {
  if (!aprovadores || pedido.status === "cancelado") return [];
  const etapas: EtapaAprovacao[] = [];
  const antes = ANTES_DA_VALIDACAO.includes(pedido.status);

  const c = aprovadores.coordenador;
  etapas.push({
    chave: "coordenador",
    titulo: c?.motivo === "supervisao" ? "Validação pela Supervisão" : "Validação pelo coordenador do projeto",
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
        ? `${c.rotulo}. Na ausência, o Administrador valida como substituto.`
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

/** O usuário está entre os competentes (ou é o Administrador, como substituto)? */
export function usuarioDecide(ids: string[] | undefined, usuarioId: string | null | undefined, ehAdmin: boolean): boolean {
  if (ehAdmin) return true;
  return Boolean(usuarioId && ids?.includes(usuarioId));
}
