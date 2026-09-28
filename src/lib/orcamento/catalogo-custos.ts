/**
 * Catálogo de custos de projeto (Fase D): regras de tela — valor velho, origem do
 * valor, eventos do histórico e leitura do formulário de item. A identidade do
 * item (rubrica + descrição + unidade) e as gravações ficam no banco (0137/0138).
 */

/** DC7 (dono, 28/09): valor sem atualização há mais de 8 meses ganha alerta amarelo. */
export const MESES_VALOR_VELHO = 8;

export const RUBRICAS_CATALOGO = ["PE", "MC", "MP", "ST", "VD", "OU"] as const;
export type RubricaCatalogo = (typeof RUBRICAS_CATALOGO)[number];

export function valorDesatualizado(atualizadoEm: string | null | undefined, hoje: Date = new Date()): boolean {
  if (!atualizadoEm) return false;
  const data = new Date(atualizadoEm);
  if (Number.isNaN(data.getTime())) return false;
  const limite = new Date(hoje.getTime());
  limite.setUTCMonth(limite.getUTCMonth() - MESES_VALOR_VELHO);
  return data.getTime() < limite.getTime();
}

/** De onde veio o valor atual do item, em linguagem de usuário. */
export function origemDoValor(item: {
  valor_origem_demanda_titulo?: string | null;
  valor_atualizado_por?: string | null;
  origem?: string | null;
}): string {
  if (item.valor_origem_demanda_titulo) return `proposta “${item.valor_origem_demanda_titulo}”`;
  if (item.valor_atualizado_por) return "ajustado no catálogo";
  if (item.origem === "orcamento_projetos_antigo") return "carga do app antigo";
  return "carga inicial do catálogo";
}

export const ROTULO_EVENTO_CATALOGO: Record<string, string> = {
  carga_inicial: "Carga inicial",
  item_novo: "Item novo",
  valor_alterado: "Alterado numa revisão de custos",
  edicao_catalogo: "Editado no catálogo",
  unificacao: "Unificado",
  pendente_permissao: "Pessoal pendente",
};

export type EntradaItemCatalogo = {
  /** null = item novo. */
  id: string | null;
  rubrica: RubricaCatalogo;
  descricao: string;
  unidade: string | null;
  categoria: string | null;
  /** null = manter o valor atual (só na edição). */
  preco: number | null;
};

function texto(formData: FormData, chave: string) {
  const valor = String(formData.get(chave) ?? "").trim();
  return valor || null;
}

function ehRubrica(valor: string): valor is RubricaCatalogo {
  return (RUBRICAS_CATALOGO as readonly string[]).includes(valor);
}

/** Lê e valida o formulário de item do catálogo (novo ou edição). */
export function lerItemCatalogo(
  formData: FormData,
): { ok: true; item: EntradaItemCatalogo } | { ok: false; message: string } {
  const id = texto(formData, "id");
  const rubrica = texto(formData, "rubrica") ?? "";
  if (!ehRubrica(rubrica)) return { ok: false, message: "Escolha uma rubrica válida (PE, MC, MP, ST, VD ou OU)." };
  const descricao = texto(formData, "descricao");
  if (!descricao) return { ok: false, message: "Informe a descrição do item." };
  if (descricao.length > 200) return { ok: false, message: "A descrição pode ter no máximo 200 caracteres." };
  const unidade = texto(formData, "unidade");
  if (unidade && unidade.length > 40) return { ok: false, message: "A unidade pode ter no máximo 40 caracteres." };
  const categoria = texto(formData, "categoria");
  if (categoria && categoria.length > 80) return { ok: false, message: "O grupo pode ter no máximo 80 caracteres." };

  const precoTexto = texto(formData, "preco");
  let preco: number | null = null;
  if (precoTexto !== null) {
    preco = Number(precoTexto.replace(",", "."));
    if (!Number.isFinite(preco)) return { ok: false, message: "Informe o valor em reais (ex.: 12,50)." };
    if (preco < 0) return { ok: false, message: "O valor não pode ser negativo." };
  } else if (!id) {
    return { ok: false, message: "Informe o valor do item novo." };
  }

  return { ok: true, item: { id, rubrica, descricao, unidade, categoria, preco } };
}
