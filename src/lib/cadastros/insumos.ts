export type InsumoRow = Record<string, unknown>;

export type LoteInsumo = {
  insumo_id: number | string | null;
  status: string | null;
  quantidade_atual: number | string | null;
  validade: string | null;
  validade_apos_abertura: string | null;
  data_abertura: string | null;
};

function dataValida(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [ano, mes, dia] = value.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia ? value : null;
}

function hojeEmSaoPaulo() {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((parte) => parte.type === tipo)?.value;
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

function menorValidade(lote: LoteInsumo) {
  const datas = [dataValida(lote.validade), dataValida(lote.validade_apos_abertura)].filter(Boolean) as string[];
  return datas.sort()[0] ?? null;
}

function elegivel(lote: LoteInsumo, hoje: string) {
  const validade = menorValidade(lote);
  return (lote.status === "aceito" || lote.status === "em_uso")
    && Number(lote.quantidade_atual) > 0
    && (validade == null || validade >= hoje);
}

export function projetarTotaisInsumos(insumos: InsumoRow[], lotes: LoteInsumo[], hoje = hojeEmSaoPaulo()): InsumoRow[] {
  const totais = new Map<string, { fechadas: number; abertas: number }>();
  for (const lote of lotes) {
    if (!elegivel(lote, hoje) || lote.insumo_id == null) continue;
    const total = totais.get(String(lote.insumo_id)) ?? { fechadas: 0, abertas: 0 };
    if (lote.data_abertura == null) total.fechadas += Number(lote.quantidade_atual);
    else total.abertas += Number(lote.quantidade_atual);
    totais.set(String(lote.insumo_id), total);
  }
  return insumos.map((insumo) => {
    const total = totais.get(String(insumo.id)) ?? { fechadas: 0, abertas: 0 };
    return { ...insumo, unidades_fechadas: total.fechadas, unidades_abertas: total.abertas };
  });
}

/**
 * Quantidade exibida no cadastro (coluna "Quantidade" e planilha XLSX):
 * saldo dos lotes aceitos/em uso e não vencidos. No modelo de embalagens
 * fechadas corresponde ao número de embalagens fechadas.
 */
export function projetarQuantidadeInsumos(
  insumos: InsumoRow[],
  lotes: LoteInsumo[],
  hoje = hojeEmSaoPaulo(),
): InsumoRow[] {
  return projetarTotaisInsumos(insumos, lotes, hoje).map((linha) => {
    const { unidades_fechadas, unidades_abertas, ...resto } = linha;
    return { ...resto, quantidade: Number(unidades_fechadas ?? 0) + Number(unidades_abertas ?? 0) };
  });
}

export type ModeloQuantidade = "LEGADO" | "EMBALAGEM_FECHADA";

export type LoteModelo = {
  insumo_id: number | string | null;
  modelo_quantidade: string | null;
  quantidade_atual: number | string | null;
};

/**
 * Classifica cada insumo por modelo de quantidade a partir dos lotes com
 * saldo (> 0): LEGADO tem prioridade (preserva controle por volume existente
 * e evita reinterpretar saldo antigo como contagem de embalagens); insumos
 * sem nenhum lote com saldo não aparecem no mapa (equivalentes a "nenhum").
 */
export function modeloQuantidadePorInsumo(lotes: LoteModelo[]): Map<string, ModeloQuantidade> {
  const temLegado = new Set<string>();
  const temFechada = new Set<string>();
  for (const lote of lotes) {
    if (lote.insumo_id == null || !(Number(lote.quantidade_atual) > 0)) continue;
    const chave = String(lote.insumo_id);
    if (lote.modelo_quantidade === "EMBALAGEM_FECHADA") temFechada.add(chave);
    else temLegado.add(chave);
  }
  const mapa = new Map<string, ModeloQuantidade>();
  for (const chave of temLegado) mapa.set(chave, "LEGADO");
  for (const chave of temFechada) if (!mapa.has(chave)) mapa.set(chave, "EMBALAGEM_FECHADA");
  return mapa;
}

export type LoteValidade = Pick<LoteInsumo, "insumo_id" | "status" | "quantidade_atual" | "validade" | "validade_apos_abertura">;

/**
 * Coluna "Validade" do cadastro de insumos: a validade é do lote, não do
 * produto. Mostra a menor validade (inclusive a de após abertura) entre os
 * lotes com saldo que ainda não saíram do estoque; lote vencido também conta,
 * para o vencimento não sumir da lista.
 */
export function menorValidadePorInsumo(lotes: LoteValidade[]): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const lote of lotes) {
    if (lote.insumo_id == null || !(Number(lote.quantidade_atual) > 0)) continue;
    if (lote.status === "consumido" || lote.status === "descartado") continue;
    const validade = menorValidade({ ...lote, data_abertura: null });
    if (!validade) continue;
    const chave = String(lote.insumo_id);
    const atual = mapa.get(chave);
    if (!atual || validade < atual) mapa.set(chave, validade);
  }
  return mapa;
}
