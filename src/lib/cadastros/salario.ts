import type { SupabaseClient } from "@supabase/supabase-js";
import type { Campo } from "@/lib/cadastros/config";
import { VALOR_MASCARADO, estaMascarado } from "@/lib/cadastros/mascara";

/**
 * Salário dos técnicos (tecnicos.valor_mes) — preparo SERVER-SIDE.
 *
 * Desde a migration 0112 o banco não concede SELECT direto de valor_mes a
 * nenhum usuário do PostgREST (inclusive admin): a leitura é feita pelas
 * colunas públicas + RPC tecnicos_remuneracao(), que devolve o valor real só
 * para quem tem a permissão efetiva "tecnicos.salario.ver" (NULL para os
 * demais). Aqui o valor ausente vira "XXX" antes de qualquer serialização
 * para o cliente, e os derivados (custo/hora, valor HH) também são mascarados,
 * já que permitiriam recalcular o salário.
 */

type Row = Record<string, unknown>;
type Remuneracao = { id: number | string; valor_mes: number | string | null };
type ErroLeitura = { message: string } | null;

export const PERMISSAO_SALARIO = "tecnicos.salario.ver" as const;
export const CAMPO_SALARIO = "valor_mes";

/** Colunas de tecnicos liberadas a authenticated (sem valor_mes; `ativo` desde a 0129). */
export const TECNICOS_COLUNAS_PUBLICAS = "id, nome, processo, horas_mes_base, percentual_dedicado, ativo";

/** Junta o salário vindo da RPC; sem permissão (ou sem valor), "XXX". */
export function mesclarRemuneracao(
  rows: Row[],
  remuneracao: Remuneracao[] | null,
  podeVer: boolean,
): Row[] {
  const porId = new Map((remuneracao ?? []).map((r) => [String(r.id), r.valor_mes]));
  return rows.map((row) => {
    const valor = podeVer ? porId.get(String(row.id)) : null;
    return {
      ...row,
      valor_mes: valor == null || !Number.isFinite(Number(valor)) ? VALOR_MASCARADO : Number(valor),
    };
  });
}

/** custo_hora = valor_mes / horas_mes_base; valor_hh = custo_hora × %dedicado / 100. */
export function colunasCalculadasTecnico(row: Row): Row {
  if (estaMascarado(row.valor_mes)) {
    return { ...row, custo_hora: VALOR_MASCARADO, valor_hh: VALOR_MASCARADO };
  }
  const custoHora =
    Number(row.horas_mes_base) > 0 ? Number(row.valor_mes) / Number(row.horas_mes_base) : 0;
  return {
    ...row,
    custo_hora: custoHora,
    valor_hh: (custoHora * Number(row.percentual_dedicado)) / 100,
  };
}

/** Sem permissão, o campo de salário fica somente leitura ("XXX") e opcional. */
export function camposTecnicosParaUsuario(campos: Campo[], podeVer: boolean): Campo[] {
  if (podeVer) return campos;
  return campos.map((campo) =>
    campo.name === CAMPO_SALARIO ? { ...campo, obrigatorio: false, mascarado: true } : campo,
  );
}

export async function carregarTecnicos(
  supabase: SupabaseClient,
  podeVer: boolean,
): Promise<{ data: Row[] | null; error: ErroLeitura }> {
  const { data, error } = await supabase
    .from("tecnicos")
    .select(TECNICOS_COLUNAS_PUBLICAS)
    .order("id");
  if (error) return { data: null, error };

  let remuneracao: Remuneracao[] | null = null;
  if (podeVer) {
    const resultado = await supabase.rpc("tecnicos_remuneracao");
    if (resultado.error) return { data: null, error: resultado.error };
    remuneracao = (resultado.data ?? []) as Remuneracao[];
  }
  return { data: mesclarRemuneracao((data ?? []) as Row[], remuneracao, podeVer), error: null };
}

/**
 * Leitura genérica de um cadastro. Para tecnicos nunca usa select("*")
 * (negado pelo banco desde a 0112) e já devolve o salário mascarado.
 */
export async function lerLinhasCadastro(
  supabase: SupabaseClient,
  tabela: string,
  opcoes: { podeVerSalario: boolean },
): Promise<{ data: Row[] | null; error: ErroLeitura }> {
  if (tabela === "tecnicos") return carregarTecnicos(supabase, opcoes.podeVerSalario);
  const { data, error } = await supabase.from(tabela).select("*").order("id");
  return { data: (data ?? null) as Row[] | null, error };
}

/**
 * Normaliza valor_mes antes de validar/gravar um técnico.
 * - sem permissão: o salário nunca é enviado (update mantém o atual; insert
 *   usa o padrão 0 da coluna, único valor aceito pelo banco sem permissão);
 * - "XXX" (valor mascarado exportado/exibido): mantém o atual;
 * - em branco na importação: mantém o atual (no formulário continua obrigatório).
 */
export function prepararSalarioTecnico(
  obj: Row,
  { podeVer, contexto }: { podeVer: boolean; contexto: "formulario" | "importacao" },
): { obj: Row; semSalario: boolean } {
  const valor = obj[CAMPO_SALARIO];
  const emBranco = valor == null || (typeof valor === "string" && valor.trim() === "");
  if (!podeVer || estaMascarado(valor) || (contexto === "importacao" && emBranco)) {
    const semSalario = { ...obj };
    delete semSalario[CAMPO_SALARIO];
    return { obj: semSalario, semSalario: true };
  }
  return { obj, semSalario: false };
}

/**
 * Catálogo de projetos (orcamento_projeto_catalogo_listar): preço PE sem
 * permissão chega NULL + preco_mascarado = true. Falha fechada para PE nulo.
 */
export function precoCatalogoMascarado(item: {
  rubrica: string;
  preco_unitario: number | string | null;
  preco_mascarado?: boolean | null;
}): boolean {
  return item.preco_mascarado === true || (item.rubrica === "PE" && item.preco_unitario == null);
}

type LinhaAuditoria = {
  tabela: string;
  valor_anterior: Record<string, unknown> | null;
  valor_novo: Record<string, unknown> | null;
};

function mascararChave(valor: Record<string, unknown> | null, chave: string) {
  if (!valor || !(chave in valor)) return valor;
  return { ...valor, [chave]: VALOR_MASCARADO };
}

/**
 * Defesa em profundidade para as telas de auditoria: além da policy
 * RESTRICTIVE da 0112, mascara salário/preço PE antes de renderizar.
 */
export function mascararAuditoriaSigilosa<T extends LinhaAuditoria>(row: T, podeVer: boolean): T {
  if (podeVer) return row;
  if (row.tabela === "tecnicos" || row.tabela === "tecnicos_remuneracao") {
    return {
      ...row,
      valor_anterior: mascararChave(row.valor_anterior, CAMPO_SALARIO),
      valor_novo: mascararChave(row.valor_novo, CAMPO_SALARIO),
    };
  }
  if (
    row.tabela === "orcamento_projeto_catalogo" &&
    (row.valor_anterior?.rubrica === "PE" || row.valor_novo?.rubrica === "PE")
  ) {
    return {
      ...row,
      valor_anterior: mascararChave(row.valor_anterior, "preco_unitario"),
      valor_novo: mascararChave(row.valor_novo, "preco_unitario"),
    };
  }
  return row;
}
