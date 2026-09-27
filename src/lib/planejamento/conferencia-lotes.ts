export type LoteConferencia = {
  id: number;
  insumoId: number;
  quantidadeAtual: number;
  status: string;
  validade: string | null;
  validadeAposAbertura: string | null;
};

export function menorValidadeLote(lote: Pick<LoteConferencia, "validade" | "validadeAposAbertura">) {
  if (lote.validade && lote.validadeAposAbertura) {
    return lote.validade <= lote.validadeAposAbertura ? lote.validade : lote.validadeAposAbertura;
  }
  return lote.validade ?? lote.validadeAposAbertura;
}

export function loteEstaVencido(
  lote: Pick<LoteConferencia, "validade" | "validadeAposAbertura">,
  hoje = new Date().toISOString().slice(0, 10),
) {
  const validade = menorValidadeLote(lote);
  return validade != null && validade < hoje;
}

export function loteDisponivelParaBaixa(lote: LoteConferencia, hoje?: string) {
  return (
    lote.quantidadeAtual > 0
    && (lote.status === "aceito" || lote.status === "em_uso")
    && !loteEstaVencido(lote, hoje)
  );
}

export function ordenarLotesFefo(lotes: LoteConferencia[]) {
  return [...lotes].sort((a, b) => {
    const validadeA = menorValidadeLote(a);
    const validadeB = menorValidadeLote(b);
    if (validadeA && validadeB && validadeA !== validadeB) return validadeA.localeCompare(validadeB);
    if (validadeA && !validadeB) return -1;
    if (!validadeA && validadeB) return 1;
    return a.id - b.id;
  });
}

export function loteSugeridoFefo(lotes: LoteConferencia[], hoje?: string) {
  return ordenarLotesFefo(lotes.filter((lote) => loteDisponivelParaBaixa(lote, hoje)))[0] ?? null;
}

export function validarConferenciaLote(args: {
  lote: LoteConferencia;
  insumoEsperadoId: number;
  loteSugeridoId: number | null;
  justificativa?: string | null;
  hoje?: string;
}) {
  if (args.lote.insumoId !== args.insumoEsperadoId) {
    return { ok: false as const, status: "invalido", message: "Este lote é de outro insumo." };
  }
  if (args.lote.status !== "aceito" && args.lote.status !== "em_uso") {
    return { ok: false as const, status: "invalido", message: "Lote não liberado para uso." };
  }
  if (loteEstaVencido(args.lote, args.hoje)) {
    return { ok: false as const, status: "invalido", message: "Lote vencido não pode ser usado." };
  }
  if (args.lote.quantidadeAtual <= 0) {
    return { ok: false as const, status: "invalido", message: "Lote sem saldo disponível." };
  }
  if (args.loteSugeridoId && args.lote.id !== args.loteSugeridoId) {
    if (!args.justificativa?.trim()) {
      return {
        ok: false as const,
        status: "excecao_fefo",
        message: "Justifique o uso de lote fora da ordem de validade.",
      };
    }
    return {
      ok: true as const,
      status: "excecao_fefo",
      message: "Lote fora da ordem de validade registrado; a retirada sai deste lote se ele tiver saldo livre.",
    };
  }

  return { ok: true as const, status: "conferido", message: "Lote registrado conforme a sugestão por validade." };
}
