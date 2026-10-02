import { formatNumber } from "@/lib/formatters";

export type DivergenciaInventario = {
  quantidadeSistema: number;
  quantidadeContada: number;
  divergencia: number;
  temDivergencia: boolean;
};

export function calcularDivergenciaInventario(
  quantidadeSistema: number,
  quantidadeContada: number,
): DivergenciaInventario {
  const sistema = Number.isFinite(quantidadeSistema) ? quantidadeSistema : 0;
  const contada = Number.isFinite(quantidadeContada) ? quantidadeContada : 0;
  const divergencia = contada - sistema;

  return {
    quantidadeSistema: sistema,
    quantidadeContada: contada,
    divergencia,
    temDivergencia: Math.abs(divergencia) > 0.000001,
  };
}

export function exigeJustificativaInventario(
  quantidadeSistema: number,
  quantidadeContada: number,
) {
  return calcularDivergenciaInventario(quantidadeSistema, quantidadeContada).temDivergencia;
}

export type DiferencaDescrita = {
  /** "Faltam 10 un" — para colunas e selos */
  curta: string;
  /** "Faltam 10 un: o sistema tem 50, foram encontrados 40." — para avisos */
  frase: string;
  tipo: "falta" | "sobra" | "confere";
};

/** Diferença da contagem em palavras: quanto falta ou sobra frente ao que o sistema registra. */
export function descreverDiferencaInventario(
  quantidadeSistema: number,
  quantidadeContada: number,
  unidade?: string | null,
): DiferencaDescrita {
  const { quantidadeSistema: sistema, quantidadeContada: contada, divergencia, temDivergencia } =
    calcularDivergenciaInventario(quantidadeSistema, quantidadeContada);
  const qtdSistema = formatNumber(sistema);
  const qtdContada = formatNumber(contada);
  if (!temDivergencia) {
    return {
      curta: "Confere",
      frase: `Confere: o sistema tem ${qtdSistema} e foram encontrados ${qtdContada}.`,
      tipo: "confere",
    };
  }
  const falta = divergencia < 0;
  const quanto = Math.abs(divergencia);
  const verbo = falta ? (quanto === 1 ? "Falta" : "Faltam") : quanto === 1 ? "Sobra" : "Sobram";
  const curta = `${verbo} ${formatNumber(quanto)}${unidade ? ` ${unidade}` : ""}`;
  return {
    curta,
    frase: `${curta}: o sistema tem ${qtdSistema}, foram encontrados ${qtdContada}.`,
    tipo: falta ? "falta" : "sobra",
  };
}

export type LoteUnidade = {
  modelo_quantidade?: string | null;
  conteudo_embalagem_snapshot?: number | string | null;
  unidade_fisica_snapshot?: string | null;
};

/**
 * Unidade do saldo de um lote como o Controle de Estoque mostra: lote de
 * embalagens fechadas conta frascos ("frasco(s) de 1000 Un"); lote antigo
 * conta na unidade do insumo. Mesma regra de v_estoque_saldo.unidade_saldo.
 */
export function unidadeDoLote(lote: LoteUnidade | null | undefined, unidadeInsumo?: string | null) {
  if (lote?.modelo_quantidade === "EMBALAGEM_FECHADA") {
    const conteudo = Number(lote.conteudo_embalagem_snapshot);
    const unidade = (lote.unidade_fisica_snapshot ?? unidadeInsumo ?? "").trim();
    if (Number.isFinite(conteudo) && conteudo > 0) {
      // mesmo texto do banco (to_char sem separador de milhar)
      return `frasco(s) de ${String(conteudo)}${unidade ? ` ${unidade}` : ""}`;
    }
    return "frasco(s)";
  }
  return unidadeInsumo ?? null;
}
