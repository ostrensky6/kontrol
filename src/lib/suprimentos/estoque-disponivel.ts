import { loteVencido } from "@/lib/estoque/baixa";
import {
  insumoAtendeFiltro,
  loteVenceEmBreve,
  situacaoDoInsumo,
  type SinalInsumo,
  type TomSinal,
} from "@/lib/estoque/situacao-insumo";

/**
 * "Estoque disponível" da visão geral de Suprimentos: uma linha por insumo
 * ativo, com o que há para usar, o que está reservado, o que está a caminho e
 * a validade mais próxima. A situação usa as mesmas regras do Controle de
 * Estoque (situacaoDoInsumo): o mesmo insumo nunca aparece com rótulos
 * diferentes em telas diferentes.
 */

type Numerico = number | string | null | undefined;

export type SaldoDisponivelDb = {
  insumo_id: number | null;
  especificacao: string | null;
  unidade: string | null;
  unidade_saldo?: string | null;
  tipo_insumo?: string | null;
  ativo?: boolean | null;
  em_maos: Numerico;
  reservado: Numerico;
  disponivel: Numerico;
  ponto_reposicao: Numerico;
};

export type PrevisaoDisponivelDb = {
  insumo_id: number | null;
  qtd_sugerida_compra?: Numerico;
  qtd_pedida_aberta?: Numerico;
};

export type AlertaDisponivelDb = { insumo_id: number | null; tipo: string | null };

export type LoteValidadeDb = {
  insumo_id: number | null;
  validade: string | null;
  validade_apos_abertura?: string | null;
  quantidade_atual: Numerico;
  status?: string | null;
};

export type LinhaEstoqueDisponivel = {
  insumoId: number;
  especificacao: string;
  tipo: string | null;
  unidade: string;
  emMaos: number;
  reservado: number;
  disponivel: number;
  aCaminho: number;
  minimo: number;
  /** quanto a previsão sugere pedir; 0 quando não precisa */
  sugerido: number;
  /** validade mais próxima entre os lotes com saldo (a menor entre a do fabricante e a após abertura) */
  validade: string | null;
  validadeEstado: "vencido" | "vencendo" | null;
  sinais: SinalInsumo[];
  situacao: string;
  tom: TomSinal | "slate";
};

const num = (valor: Numerico) => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function validadeDoLote(lote: LoteValidadeDb) {
  if (lote.validade && lote.validade_apos_abertura) {
    return lote.validade <= lote.validade_apos_abertura ? lote.validade : lote.validade_apos_abertura;
  }
  return lote.validade ?? lote.validade_apos_abertura ?? null;
}

export function montarEstoqueDisponivel({
  saldo,
  previsao,
  alertas,
  lotes,
  hoje,
  janelaVencimento,
}: {
  saldo: readonly SaldoDisponivelDb[];
  previsao: readonly PrevisaoDisponivelDb[];
  alertas: readonly AlertaDisponivelDb[];
  lotes: readonly LoteValidadeDb[];
  hoje: string;
  janelaVencimento: number;
}): LinhaEstoqueDisponivel[] {
  const previsaoPorInsumo = new Map(previsao.map((p) => [Number(p.insumo_id), p]));
  const alertasPorInsumo = new Map<number, AlertaDisponivelDb[]>();
  for (const alerta of alertas) {
    const id = Number(alerta.insumo_id);
    alertasPorInsumo.set(id, [...(alertasPorInsumo.get(id) ?? []), alerta]);
  }
  const validadePorInsumo = new Map<number, string>();
  for (const lote of lotes) {
    if (!(num(lote.quantidade_atual) > 0) || lote.status === "consumido" || lote.status === "descartado") continue;
    const validade = validadeDoLote(lote);
    if (!validade) continue;
    const id = Number(lote.insumo_id);
    const atual = validadePorInsumo.get(id);
    if (!atual || validade < atual) validadePorInsumo.set(id, validade);
  }

  return saldo
    .filter((s) => s.insumo_id != null && s.ativo !== false)
    .map((s): LinhaEstoqueDisponivel => {
      const insumoId = Number(s.insumo_id);
      const prev = previsaoPorInsumo.get(insumoId);
      const sugerido = num(prev?.qtd_sugerida_compra);
      const disponivel = num(s.disponivel);
      const situacao = situacaoDoInsumo({ disponivel, qtd_sugerida_compra: sugerido }, alertasPorInsumo.get(insumoId) ?? []);
      const validade = validadePorInsumo.get(insumoId) ?? null;
      return {
        insumoId,
        especificacao: s.especificacao?.trim() || `Insumo #${insumoId}`,
        tipo: s.tipo_insumo ?? null,
        unidade: s.unidade_saldo ?? s.unidade ?? "",
        emMaos: num(s.em_maos),
        reservado: num(s.reservado),
        disponivel,
        aCaminho: num(prev?.qtd_pedida_aberta),
        minimo: num(s.ponto_reposicao),
        sugerido: sugerido > 0 ? sugerido : 0,
        validade,
        validadeEstado: loteVencido(validade, hoje)
          ? "vencido"
          : loteVenceEmBreve(validade, hoje, janelaVencimento)
            ? "vencendo"
            : null,
        sinais: situacao.sinais,
        situacao: situacao.rotulo,
        tom: situacao.tom,
      };
    })
    .sort((a, b) => a.especificacao.localeCompare(b.especificacao, "pt-BR"));
}

/**
 * Filtros da tabela; os valores são os mesmos do Controle de Estoque. A tela
 * abre em "Precisa de atenção": a lista inteira só aparece quando pedida.
 */
export const FILTROS_ESTOQUE_DISPONIVEL = [
  { valor: "atencao", rotulo: "Precisa de atenção", descricao: "Repor, sem estoque ou validade" },
  { valor: "reposicao", rotulo: "Repor", descricao: "Hora de pedir" },
  { valor: "sem_disponivel", rotulo: "Sem estoque", descricao: "Nada disponível agora" },
  { valor: "vencido_vencendo", rotulo: "Vencido ou vencendo", descricao: "Lote vencido ou perto de vencer" },
  { valor: "ok", rotulo: "Em dia", descricao: "Sem nenhum aviso" },
  { valor: "todos", rotulo: "Todos", descricao: "Todos os insumos ativos" },
] as const;

export type FiltroEstoqueDisponivel = (typeof FILTROS_ESTOQUE_DISPONIVEL)[number]["valor"];

export const FILTRO_ESTOQUE_PADRAO: FiltroEstoqueDisponivel = "atencao";

export function filtroEstoqueValido(valor: unknown): FiltroEstoqueDisponivel {
  return FILTROS_ESTOQUE_DISPONIVEL.some((f) => f.valor === valor)
    ? (valor as FiltroEstoqueDisponivel)
    : FILTRO_ESTOQUE_PADRAO;
}

export function linhaAtendeFiltro(linha: Pick<LinhaEstoqueDisponivel, "sinais">, filtro: FiltroEstoqueDisponivel) {
  return insumoAtendeFiltro(linha.sinais, filtro);
}
