/**
 * "Aguardando você" (PER2-10): o banco devolve, pelas permissões do usuário,
 * quantos itens esperam a ação dele (public.aguardando_voce, 0128; por
 * competência desde a 0173). Aqui só se traduz cada chave em texto e links.
 */
export type PendenciaChave =
  | "pedidos_validacao"
  | "pedidos_laboratorio"
  | "pedidos_administrativo"
  | "pedidos_compras"
  | "pedidos_pagamento"
  | "compras_aprovar"
  | "compras_receber"
  | "propostas_emitir"
  | "planos_rascunho";

export type PendenciaItem = { id: number; rotulo: string; href: string };

export type Pendencia = {
  chave: PendenciaChave;
  titulo: string;
  acao: string;
  quantidade: number;
  href: string;
  itens: PendenciaItem[];
};

const CATALOGO: Record<
  PendenciaChave,
  { titulo: string; acao: string; lista: string; item: (id: number) => string }
> = {
  pedidos_validacao: {
    titulo: "Pedidos para você aprovar",
    acao: "aprovar ou devolver ao solicitante",
    lista: "/pedido?etapa=aprovacao",
    item: (id) => `/pedido/${id}`,
  },
  pedidos_laboratorio: {
    titulo: "Pedidos para a coordenação do laboratório",
    acao: "aprovar ou devolver o material de laboratório",
    lista: "/pedido?etapa=aprovacao",
    item: (id) => `/pedido/${id}`,
  },
  pedidos_administrativo: {
    titulo: "Pedidos para formalizar e autorizar",
    acao: "formalizar, definir fonte e rubrica e autorizar",
    lista: "/pedido?etapa=administrativo",
    item: (id) => `/pedido/${id}`,
  },
  pedidos_compras: {
    titulo: "Pedidos em cotação e compra",
    acao: "registrar os 3 orçamentos, escolher, aprovar e fechar a compra",
    lista: "/pedido",
    item: (id) => `/pedido/${id}`,
  },
  pedidos_pagamento: {
    titulo: "Pedidos para pagar",
    acao: "pagar e anexar a nota fiscal (a entrega já foi registrada)",
    lista: "/pedido",
    item: (id) => `/pedido/${id}`,
  },
  compras_aprovar: {
    titulo: "Compras para aprovar",
    acao: "aprovar ou cancelar a solicitação",
    lista: "/compras?status=solicitado",
    item: (id) => `/compras/${id}`,
  },
  compras_receber: {
    titulo: "Compras para receber",
    acao: "registrar a chegada dos itens",
    lista: "/recebimento",
    item: (id) => `/compras/${id}`,
  },
  propostas_emitir: {
    titulo: "Propostas prontas para emitir",
    acao: "revisar parâmetros e emitir",
    lista: "/orcamento/demandas?status=em_analise",
    item: (id) => `/orcamento/demandas/${id}`,
  },
  planos_rascunho: {
    titulo: "Planos em rascunho",
    acao: "completar e liberar o planejamento",
    lista: "/planejamento?status=rascunho",
    item: (id) => `/planejamento/${id}`,
  },
};

/** Chaves que dizem respeito aos pedidos (lista de Pedidos) e a Suprimentos inteiro (visão geral). */
export const PENDENCIAS_DE_PEDIDOS: readonly PendenciaChave[] = [
  "pedidos_validacao",
  "pedidos_laboratorio",
  "pedidos_administrativo",
  "pedidos_compras",
  "pedidos_pagamento",
];
export const PENDENCIAS_DE_SUPRIMENTOS: readonly PendenciaChave[] = [
  ...PENDENCIAS_DE_PEDIDOS,
  "compras_aprovar",
  "compras_receber",
  "planos_rascunho",
];

export function pendenciasDe(pendencias: readonly Pendencia[], chaves: readonly PendenciaChave[]): Pendencia[] {
  return pendencias.filter((p) => chaves.includes(p.chave));
}

function ehChave(valor: unknown): valor is PendenciaChave {
  return typeof valor === "string" && valor in CATALOGO;
}

/** Converte a resposta da RPC; ignora chaves desconhecidas e contagens zeradas. */
export function montarPendencias(bruto: unknown): Pendencia[] {
  if (!Array.isArray(bruto)) return [];
  const pendencias: Pendencia[] = [];
  for (const linha of bruto) {
    if (!linha || typeof linha !== "object") continue;
    const { chave, quantidade, itens } = linha as { chave?: unknown; quantidade?: unknown; itens?: unknown };
    if (!ehChave(chave)) continue;
    const total = Number(quantidade);
    if (!Number.isFinite(total) || total <= 0) continue;
    const def = CATALOGO[chave];
    const lista: PendenciaItem[] = Array.isArray(itens)
      ? itens.flatMap((item) => {
          const { id, rotulo } = (item ?? {}) as { id?: unknown; rotulo?: unknown };
          const numero = Number(id);
          if (!Number.isInteger(numero) || numero <= 0) return [];
          return [{ id: numero, rotulo: typeof rotulo === "string" && rotulo ? rotulo : `#${numero}`, href: def.item(numero) }];
        })
      : [];
    pendencias.push({ chave, titulo: def.titulo, acao: def.acao, quantidade: total, href: def.lista, itens: lista });
  }
  return pendencias;
}
