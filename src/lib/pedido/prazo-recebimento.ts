type Lancamento = {
  id: number;
  quantidade: number;
  recebido_em: string;
  estornado_em: string | null;
};

type Item = {
  id: number;
  quantidade: number;
  quantidade_recebida: number | null;
  quantidade_nao_atendida: number | null;
  destino_pendencia: string | null;
  compra_pendencia_id: number | null;
  pedidos_compra_item_recebimentos?: readonly Lancamento[] | null;
};

type ConsultaItens = {
  data: readonly Item[] | null;
  count: number | null;
  error: unknown;
  escopoComprovado: boolean;
};

function instante(valor: string | null) {
  if (typeof valor !== "string") return null;
  const partes = /^(\d{4}-\d\d-\d\d)T([01]\d|2[0-3])(:[0-5]\d:[0-5]\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(valor);
  if (!partes) return null;
  const [, dia, hora, minutosSegundos, fracao = "", fuso] = partes;
  const ms = Date.parse(`${dia}T${hora}${minutosSegundos}${fuso}`);
  const meiaNoite = Date.parse(`${dia}T00:00:00Z`);
  if (!Number.isFinite(ms) || !Number.isFinite(meiaNoite) || new Date(meiaNoite).toISOString().slice(0, 10) !== dia) return null;
  return { valor, micros: BigInt(ms) * BigInt(1000) + BigInt(fracao.padEnd(6, "0")) };
}

// O livro e o item usam a mesma unidade comercial. Compare os decimais
// retornados pela consulta sem tolerância ou arredondamento na soma.
function somaConfere(quantidade: number, recebidas: number[]) {
  const decimais = [quantidade, ...recebidas].map((valor) => {
    const [mantissa, expoente = "0"] = String(valor).split("e");
    const [inteira, fracao = ""] = mantissa.split(".");
    return { coeficiente: BigInt(inteira + fracao), escala: Number(expoente) - fracao.length };
  });
  const escala = decimais.reduce((minima, valor) => Math.min(minima, valor.escala), 0);
  const [pedido, ...parcelas] = decimais.map(({ coeficiente, escala: e }) =>
    coeficiente * BigInt(10) ** BigInt(e - escala),
  );
  return parcelas.reduce((soma, parcela) => soma + parcela, BigInt(0)) === pedido;
}

export function prazoRecebimentoObservado(
  compra: { status: string; criado_em: string | null },
  consulta: ConsultaItens,
) {
  if (compra.status !== "recebido") {
    return { estado: "fora_da_amostra", n: 0, motivo: compra.status === "cancelado" ? "cancelada" : "nao_recebida" } as const;
  }
  const { data: itens, count, error, escopoComprovado } = consulta;
  if (error || !itens || count !== itens.length || !escopoComprovado || new Set(itens.map((item) => item.id)).size !== count) {
    return { estado: "indisponivel", n: 0, motivo: "consulta_ou_escopo_incompleto" } as const;
  }

  const semLivro = { estado: "nao_demonstrado", n: 0, motivo: "livro_incompleto_ou_inconsistente" } as const;
  const dataInvalida = { estado: "nao_demonstrado", n: 0, motivo: "data_invalida_ou_invertida" } as const;
  if (!itens.length) return semLivro;
  const inicio = instante(compra.criado_em);
  if (!inicio) return dataInvalida;

  const lancamentos = new Set<number>();
  let fim = inicio;
  for (const item of itens) {
    if ((item.quantidade_nao_atendida !== null && item.quantidade_nao_atendida !== 0)
      || item.destino_pendencia !== null || item.compra_pendencia_id !== null) {
      return { estado: "nao_demonstrado", n: 0, motivo: "pendencia" } as const;
    }
    if (!Number.isFinite(item.quantidade) || item.quantidade <= 0
      || item.quantidade_recebida !== item.quantidade || !item.pedidos_compra_item_recebimentos) return semLivro;

    const recebidas: number[] = [];
    for (const lancamento of item.pedidos_compra_item_recebimentos) {
      if (lancamento.estornado_em !== null) {
        if (!instante(lancamento.estornado_em)) return semLivro;
        continue;
      }
      if (!Number.isFinite(lancamento.quantidade) || lancamento.quantidade <= 0 || lancamentos.has(lancamento.id)) return semLivro;
      const recebido = instante(lancamento.recebido_em);
      if (!recebido || recebido.micros < inicio.micros) return dataInvalida;
      lancamentos.add(lancamento.id);
      recebidas.push(lancamento.quantidade);
      if (recebido.micros > fim.micros) fim = recebido;
    }
    if (!somaConfere(item.quantidade, recebidas)) return semLivro;
  }

  return {
    estado: "observado", n: 1, duracaoMs: Number(fim.micros - inicio.micros) / 1000,
    inicioEm: inicio.valor, fimEm: fim.valor,
    origem: "livro_formal_de_recebimentos", fonteFinanciadora: null,
  } as const;
}
