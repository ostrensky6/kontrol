/**
 * Prazos de compra observados (plano de evolução, item 5): do envio do pedido
 * interno para validação até o recebimento de cada item, por caminho de compra
 * (ATGC, fundação/Funpar, universidade...), insumo e categoria.
 * Só entram itens recebidos; compra aberta ou atrasada não é prazo concluído.
 */

export type PedidoPrazoRow = {
  id: number;
  criado_em: string | null;
  enviado_validacao_em: string | null;
  modalidade_compra: string | null;
  instituicao_destino: string | null;
  pedidos_internos_itens:
    | readonly {
        insumo_id: number | null;
        recebido_em: string | null;
        insumos: { especificacao: string | null; categoria_compra: string | null } | null;
      }[]
    | null;
};

export type AmostraPrazo = {
  pedido_id: number;
  caminho: string;
  insumo_id: number | null;
  insumo: string;
  categoria: string;
  dias: number;
};

export type ResumoPrazo = {
  chave: string;
  n: number;
  curta: number;
  intermediaria: number;
  conservadora: number;
  confianca: "baixa" | "media" | "alta";
};

const ROTULO_MODALIDADE: Record<string, string> = {
  compra_direta: "ATGC (compra direta)",
  fundacao: "Fundação",
  universidade: "Universidade",
  outra: "Outro caminho",
};

const DIA_MS = 24 * 60 * 60 * 1000;

/** Caminho da compra: a instituição informada vale sobre a modalidade. */
export function caminhoCompra(p: Pick<PedidoPrazoRow, "modalidade_compra" | "instituicao_destino">) {
  const inst = (p.instituicao_destino ?? "").trim();
  if (inst) return /funpar/i.test(inst) ? "Funpar" : inst;
  if (p.modalidade_compra) return ROTULO_MODALIDADE[p.modalidade_compra] ?? p.modalidade_compra;
  return "Caminho não informado";
}

function data(valor: string | null) {
  if (!valor) return null;
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? ms : null;
}

export function amostrasPrazo(pedidos: readonly PedidoPrazoRow[]): AmostraPrazo[] {
  const amostras: AmostraPrazo[] = [];
  for (const p of pedidos) {
    const inicio = data(p.enviado_validacao_em) ?? data(p.criado_em);
    if (inicio === null) continue;
    const caminho = caminhoCompra(p);
    for (const item of p.pedidos_internos_itens ?? []) {
      const fim = data(item.recebido_em);
      if (fim === null || fim < inicio) continue;
      amostras.push({
        pedido_id: p.id,
        caminho,
        insumo_id: item.insumo_id,
        insumo: item.insumos?.especificacao?.trim() || "Item sem insumo cadastrado",
        categoria: item.insumos?.categoria_compra?.trim() || "Sem categoria",
        dias: Math.round((fim - inicio) / DIA_MS),
      });
    }
  }
  return amostras;
}

/** Percentil por interpolação linear (p entre 0 e 1). */
export function percentil(valores: readonly number[], p: number) {
  if (valores.length === 0) return 0;
  const v = [...valores].sort((a, b) => a - b);
  const pos = (v.length - 1) * p;
  const base = Math.floor(pos);
  const resto = pos - base;
  return v[base + 1] !== undefined ? v[base] + resto * (v[base + 1] - v[base]) : v[base];
}

export function confianca(n: number): ResumoPrazo["confianca"] {
  if (n >= 10) return "alta";
  if (n >= 3) return "media";
  return "baixa";
}

/**
 * Curta = mediana (metade das compras chegou antes), intermediária = 75% e
 * conservadora = 90% das compras chegaram dentro do prazo.
 */
export function resumirPrazos(amostras: readonly AmostraPrazo[], chave: (a: AmostraPrazo) => string): ResumoPrazo[] {
  const grupos = new Map<string, number[]>();
  for (const a of amostras) {
    const k = chave(a);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(a.dias);
  }
  return [...grupos].map(([k, dias]) => ({
    chave: k,
    n: dias.length,
    curta: Math.round(percentil(dias, 0.5)),
    intermediaria: Math.round(percentil(dias, 0.75)),
    conservadora: Math.round(percentil(dias, 0.9)),
    confianca: confianca(dias.length),
  })).sort((a, b) => b.n - a.n || a.chave.localeCompare(b.chave));
}
