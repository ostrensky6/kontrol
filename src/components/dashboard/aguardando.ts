/**
 * "Aguardando você" (PER2-10): o banco devolve, pelas permissões do usuário,
 * quantos itens esperam a ação dele (public.aguardando_voce, 0128). Aqui só
 * se traduz cada chave em texto e links.
 */
export type PendenciaChave =
  | "pedidos_validacao"
  | "compras_aprovar"
  | "compras_receber"
  | "lotes_quarentena"
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
    titulo: "Pedidos internos para validar",
    acao: "validar ou devolver ao solicitante",
    lista: "/pedido?status=em_validacao",
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
  lotes_quarentena: {
    titulo: "Lotes em quarentena",
    acao: "conferir e aceitar para uso",
    lista: "/estoque/controle?status=quarentena",
    item: (id) => `/estoque/lotes/${id}`,
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
