/**
 * "Aguardando você" (PER2-10): o banco devolve, pelas permissões do usuário,
 * quantos itens esperam a ação dele (public.aguardando_voce, 0128; por
 * competência desde a 0173). Aqui só se traduz cada chave em texto e links.
 *
 * Quatro pendências não vêm da função do banco e são lidas pelo app com a
 * mesma permissão que a tela de destino exige (revisão de 11/11, F8): lotes
 * em quarentena, disputas de reserva, códigos sem cadastro e manutenção ou
 * calibração vencida. Ver lib/pendencias/carregar.ts.
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
  | "planos_rascunho"
  | "lotes_quarentena"
  | "disputas_decidir"
  | "codigos_triagem"
  | "equipamentos_vencidos";

export type PendenciaItem = { id: number; rotulo: string; href: string };

export type Pendencia = {
  chave: PendenciaChave;
  titulo: string;
  acao: string;
  /** a pendência numa frase, para as telas que mostram uma linha só (D4) */
  frase: string;
  quantidade: number;
  href: string;
  itens: PendenciaItem[];
};

const CATALOGO: Record<
  PendenciaChave,
  { titulo: string; acao: string; frase: [um: string, varios: string]; lista: string; item: (id: number) => string }
> = {
  pedidos_validacao: {
    titulo: "Pedidos para você aprovar",
    acao: "aprovar ou devolver ao solicitante",
    frase: ["pedido espera a sua aprovação", "pedidos esperam a sua aprovação"],
    lista: "/pedido?etapa=aprovacao",
    item: (id) => `/pedido/${id}`,
  },
  pedidos_laboratorio: {
    titulo: "Pedidos para a coordenação do laboratório",
    acao: "aprovar ou devolver o material de laboratório",
    frase: ["pedido espera a aprovação do laboratório", "pedidos esperam a aprovação do laboratório"],
    lista: "/pedido?etapa=aprovacao",
    item: (id) => `/pedido/${id}`,
  },
  pedidos_administrativo: {
    titulo: "Pedidos para formalizar e autorizar",
    acao: "formalizar, definir fonte e rubrica e autorizar",
    frase: ["pedido espera você formalizar e autorizar", "pedidos esperam você formalizar e autorizar"],
    lista: "/pedido?etapa=administrativo",
    item: (id) => `/pedido/${id}`,
  },
  pedidos_compras: {
    titulo: "Pedidos em cotação e compra",
    acao: "registrar os 3 orçamentos, escolher, aprovar e fechar a compra",
    frase: ["pedido espera cotação ou compra", "pedidos esperam cotação ou compra"],
    lista: "/pedido",
    item: (id) => `/pedido/${id}`,
  },
  pedidos_pagamento: {
    titulo: "Pedidos para pagar",
    acao: "pagar e anexar a nota fiscal (a entrega já foi registrada)",
    frase: ["pedido espera pagamento", "pedidos esperam pagamento"],
    lista: "/pedido",
    item: (id) => `/pedido/${id}`,
  },
  compras_aprovar: {
    titulo: "Compras para aprovar",
    acao: "aprovar ou cancelar a solicitação",
    frase: ["compra espera a sua aprovação", "compras esperam a sua aprovação"],
    lista: "/compras?status=solicitado",
    item: (id) => `/compras/${id}`,
  },
  compras_receber: {
    titulo: "Compras para receber",
    acao: "registrar a chegada dos itens",
    frase: ["compra espera o registro da chegada", "compras esperam o registro da chegada"],
    lista: "/recebimento",
    item: (id) => `/compras/${id}`,
  },
  propostas_emitir: {
    titulo: "Propostas prontas para emitir",
    acao: "revisar parâmetros e emitir",
    frase: ["proposta está pronta para emitir", "propostas estão prontas para emitir"],
    lista: "/orcamento/demandas?status=em_analise",
    item: (id) => `/orcamento/demandas/${id}`,
  },
  planos_rascunho: {
    titulo: "Planos em rascunho",
    acao: "completar e liberar o planejamento",
    frase: ["plano está em rascunho", "planos estão em rascunho"],
    lista: "/planejamento?status=rascunho",
    item: (id) => `/planejamento/${id}`,
  },
  lotes_quarentena: {
    titulo: "Lotes em quarentena",
    acao: "conferir e aceitar para liberar o uso",
    frase: ["lote em quarentena espera o aceite", "lotes em quarentena esperam o aceite"],
    lista: "/estoque?ver=lotes",
    item: (id) => `/estoque/lotes/${id}`,
  },
  disputas_decidir: {
    titulo: "Disputas de reserva para decidir",
    acao: "transferir a reserva de outro plano ou negar o pedido",
    frase: ["disputa de reserva espera a sua decisão", "disputas de reserva esperam a sua decisão"],
    lista: "/planejamento/disputas",
    item: (id) => `/planejamento/disputas#disputa-${id}`,
  },
  codigos_triagem: {
    titulo: "Códigos não reconhecidos",
    acao: "vincular a um insumo ou cadastrar",
    frase: ["código lido ainda não tem cadastro", "códigos lidos ainda não têm cadastro"],
    lista: "/scanner/triagem",
    item: () => "/scanner/triagem",
  },
  equipamentos_vencidos: {
    titulo: "Manutenção ou calibração vencida",
    acao: "agendar o serviço ou registrar o encaminhamento",
    frase: ["manutenção ou calibração está vencida", "manutenções ou calibrações estão vencidas"],
    lista: "/estoque/equipamentos",
    item: (id) => `/estoque/equipamentos?focus=${id}`,
  },
};

/** Pendências lidas pelo app (F8); as demais vêm de public.aguardando_voce. */
export const PENDENCIAS_DO_APP = [
  "lotes_quarentena",
  "disputas_decidir",
  "codigos_triagem",
  "equipamentos_vencidos",
] as const satisfies readonly PendenciaChave[];
export type PendenciaDoApp = (typeof PENDENCIAS_DO_APP)[number];

/** Quantos itens cada pendência mostra pelo nome; o resto fica no número. */
export const LIMITE_ITENS_PENDENCIA = 3;

export function montarPendenciaDoApp(
  chave: PendenciaDoApp,
  itens: Array<{ id: number; rotulo: string }>,
): Pendencia | null {
  if (itens.length === 0) return null;
  const def = CATALOGO[chave];
  return {
    chave,
    titulo: def.titulo,
    acao: def.acao,
    frase: fraseDe(chave, itens.length),
    quantidade: itens.length,
    href: def.lista,
    itens: itens.slice(0, LIMITE_ITENS_PENDENCIA).map((item) => ({ ...item, href: def.item(item.id) })),
  };
}

/**
 * Onde cada pendência aparece fora do Início (organização de 11/11/2026):
 * Suprimentos virou Compras e Estoque, e o Planejamento ficou com Projetos.
 * Cada chave tem um módulo só; o Início e o sino mostram todas.
 */
export const PENDENCIAS_DE_PEDIDOS: readonly PendenciaChave[] = [
  "pedidos_validacao",
  "pedidos_laboratorio",
  "pedidos_administrativo",
  "pedidos_compras",
  "pedidos_pagamento",
];
/** Visão geral de Compras: do pedido ao recebimento. */
export const PENDENCIAS_DE_COMPRAS: readonly PendenciaChave[] = [
  ...PENDENCIAS_DE_PEDIDOS,
  "compras_aprovar",
  "compras_receber",
];
/** Estoque: lotes, códigos lidos e equipamentos. */
export const PENDENCIAS_DE_ESTOQUE: readonly PendenciaChave[] = [
  "lotes_quarentena",
  "codigos_triagem",
  "equipamentos_vencidos",
];
/** Planejamento (em Projetos): planos e disputas de reserva. */
export const PENDENCIAS_DE_PLANEJAMENTO: readonly PendenciaChave[] = ["planos_rascunho", "disputas_decidir"];

/** Total de itens esperando a pessoa. */
export function totalPendencias(pendencias: readonly Pendencia[]) {
  return pendencias.reduce((soma, p) => soma + p.quantidade, 0);
}

/** Para a linha "Sua vez" (D4): com um item só, o link abre o registro; senão, a lista. */
export function destinoDaPendencia(p: Pendencia) {
  return p.quantidade === 1 && p.itens.length === 1 ? p.itens[0].href : p.href;
}

export function pendenciasDe(pendencias: readonly Pendencia[], chaves: readonly PendenciaChave[]): Pendencia[] {
  return pendencias.filter((p) => chaves.includes(p.chave));
}

function fraseDe(chave: PendenciaChave, quantidade: number) {
  const [um, varios] = CATALOGO[chave].frase;
  return `${quantidade} ${quantidade === 1 ? um : varios}`;
}

/** Só as chaves que a função do banco devolve: as pendências do app não entram por aqui. */
function ehChave(valor: unknown): valor is PendenciaChave {
  return typeof valor === "string" && valor in CATALOGO && !(PENDENCIAS_DO_APP as readonly string[]).includes(valor);
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
    pendencias.push({ chave, titulo: def.titulo, acao: def.acao, frase: fraseDe(chave, total), quantidade: total, href: def.lista, itens: lista });
  }
  return pendencias;
}
