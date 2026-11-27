/**
 * Item novo: material ou equipamento escrito à mão no pedido, sem insumo do
 * cadastro (algo que o laboratório nunca comprou).
 *
 * Decisão de Antonio em 19/11/2026, a partir da pergunta do Giorgi trazida
 * pela Rafaela: quem pede só descreve o item; quem conduz a compra cadastra o
 * insumo pelo próprio pedido, antes de formalizar. Serviço não tem insumo e
 * nunca é item novo. O banco recusa a formalização enquanto houver material
 * ou equipamento sem insumo (formalizar_pedido_interno).
 */

const TIPOS_COM_INSUMO: readonly string[] = ["material", "equipamento"];

type ItemDoPedido = { tipo?: string | null; insumo_id?: number | string | null };

/** Material ou equipamento ainda sem insumo do cadastro. */
export function ehItemNovo(item: ItemDoPedido): boolean {
  if (!TIPOS_COM_INSUMO.includes(item.tipo ?? "material")) return false;
  return !(Number(item.insumo_id ?? 0) > 0);
}

export function contarItensNovos(itens: readonly ItemDoPedido[]): number {
  return itens.filter(ehItemNovo).length;
}

/** Status em que o item novo ainda pode ser cadastrado e ligado (os mesmos em que os itens mudam). */
export const STATUS_CADASTRA_ITEM_NOVO: readonly string[] = [
  "rascunho",
  "ajuste_solicitante",
  "ajuste_compras",
  "em_validacao",
  "validado",
  // 0188: na ordem nova, o financeiro confere que todo material tem cadastro antes de aprovar
  "aguardando_area",
  "aguardando_financeiro",
];

export const MSG_SEM_EDITAR_INSUMOS =
  "Cadastrar o insumo pede a permissão “Editar insumos”. Peça ao administrador, em Usuários, ou a quem cuida do cadastro.";

/**
 * Por que "Formalizar em compras" ainda não pode: há item novo sem cadastro.
 * `null` quando todos os materiais e equipamentos já têm insumo.
 */
export function motivoItensSemCadastro(
  itens: readonly ItemDoPedido[],
  { podeCadastrar, fluxoNovo = false }: { podeCadastrar: boolean; fluxoNovo?: boolean },
): string | null {
  const novos = contarItensNovos(itens);
  if (novos === 0) return null;
  const quantos = novos === 1 ? "Há 1 item novo, ainda sem cadastro" : `Há ${novos} itens novos, ainda sem cadastro`;
  // 0188: na ordem nova, o financeiro só aprova com todo material ligado ao insumo
  return podeCadastrar
    ? `${quantos}. Use “Cadastrar insumo” na lista de itens antes de ${fluxoNovo ? "aprovar" : "formalizar"}.`
    : `${quantos}. ${MSG_SEM_EDITAR_INSUMOS}`;
}

function semAcento(valor: string) {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Nome para comparar: sem acento, sem caixa, sem pontuação e sem espaço repetido. */
export function nomeNormalizado(valor: string | null | undefined): string {
  return semAcento(String(valor ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type InsumoDoCatalogo = {
  id: number;
  especificacao: string | null;
  nomeItem?: string | null;
  fabricante?: string | null;
  codigoFabricante?: string | null;
  sinonimos?: string[];
};

const PALAVRAS_SEM_PESO = new Set(["de", "da", "do", "das", "dos", "para", "com", "sem", "por", "em", "e", "a", "o", "un", "ml", "kit", "cx"]);

function palavras(valor: string | null | undefined): string[] {
  return nomeNormalizado(valor)
    .split(" ")
    .filter((palavra) => palavra.length > 1 && !PALAVRAS_SEM_PESO.has(palavra));
}

/**
 * Insumos do cadastro que parecem o item escrito à mão: mesma descrição, mesmo
 * código do fabricante ou a maior parte das palavras em comum. Serve para
 * avisar antes de criar um cadastro repetido.
 */
export function insumosParecidos<T extends InsumoDoCatalogo>(
  item: { especificacao?: string | null; codigoFabricante?: string | null },
  catalogo: readonly T[],
  limite = 3,
): T[] {
  const alvo = palavras(item.especificacao);
  const codigo = nomeNormalizado(item.codigoFabricante);
  const pontuados: { insumo: T; pontos: number }[] = [];
  for (const insumo of catalogo) {
    if (codigo && nomeNormalizado(insumo.codigoFabricante) === codigo) {
      pontuados.push({ insumo, pontos: 2 });
      continue;
    }
    if (alvo.length === 0) continue;
    const doInsumo = new Set([
      ...palavras(insumo.especificacao),
      ...palavras(insumo.nomeItem),
      ...(insumo.sinonimos ?? []).flatMap((sinonimo) => palavras(sinonimo)),
    ]);
    const emComum = alvo.filter((palavra) => doInsumo.has(palavra)).length;
    const pontos = emComum / alvo.length;
    // metade das palavras ou mais, e ao menos uma palavra que identifica o item
    if (emComum > 0 && pontos >= 0.5) pontuados.push({ insumo, pontos });
  }
  return pontuados
    .sort((a, b) => b.pontos - a.pontos || String(a.insumo.especificacao).localeCompare(String(b.insumo.especificacao), "pt-BR"))
    .slice(0, limite)
    .map(({ insumo }) => insumo);
}

export type SugestaoInsumo = {
  especificacao: string;
  fabricante: string;
  unidade: string;
  quantidadeEmbalagem: string;
  custoEmbalagem: string;
};

/**
 * Cadastro sugerido a partir do item escrito à mão. "Volume" do tipo "500 mL"
 * vira a embalagem (500 e mL); sem isso, a embalagem é 1 da unidade do item.
 * Quem cadastra confere antes de gravar.
 */
export function sugerirInsumoDoItem(item: {
  especificacao?: string | null;
  modelo?: string | null;
  volume?: string | null;
  unidade?: string | null;
  orcamento_previo?: number | string | null;
}): SugestaoInsumo {
  const volume = /^\s*(\d+(?:[.,]\d+)?)\s*([^\d\s][^\d]*?)\s*$/.exec(item.volume ?? "");
  const custo = item.orcamento_previo == null || item.orcamento_previo === "" ? "" : String(item.orcamento_previo);
  return {
    especificacao: String(item.especificacao ?? "").trim(),
    fabricante: String(item.modelo ?? "").trim(),
    unidade: volume ? volume[2].trim() : String(item.unidade ?? "").trim() || "un",
    quantidadeEmbalagem: volume ? volume[1].replace(",", ".") : "1",
    custoEmbalagem: custo,
  };
}

type Numero = { ok: true; valor: number } | { ok: false };

function numeroPositivo(valor: unknown, { aceitaZero = false } = {}): Numero {
  const texto = String(valor ?? "").trim().replace(",", ".");
  if (!texto) return { ok: false };
  const n = Number(texto);
  if (!Number.isFinite(n) || n < 0 || (!aceitaZero && n === 0)) return { ok: false };
  return { ok: true, valor: n };
}

export type DadosInsumoDoItem = {
  especificacao: string;
  fabricante: string | null;
  codigo_fabricante: string | null;
  unidade: string;
  quantidade_embalagem: number;
  custo_total_embalagem: number;
  fator_conversao: number;
};

/**
 * Confere o que veio do formulário "Cadastrar insumo" do pedido. Os campos
 * obrigatórios são os mesmos de Cadastros > Insumos: nome, unidade, quantidade
 * na embalagem e valor da embalagem (R$ 0 vale: o insumo entra sem custo).
 */
export function lerDadosInsumoDoItem(
  formData: FormData,
): { ok: true; dados: DadosInsumoDoItem } | { ok: false; message: string } {
  const texto = (campo: string, limite: number) => String(formData.get(campo) ?? "").trim().slice(0, limite) || null;
  const especificacao = texto("insumo_especificacao", 300);
  const unidade = texto("insumo_unidade", 40);
  const quantidade = numeroPositivo(formData.get("insumo_quantidade_embalagem"));
  const custo = numeroPositivo(formData.get("insumo_custo_embalagem"), { aceitaZero: true });
  if (!especificacao) return { ok: false, message: "Informe o nome do insumo (item específico / SKU)." };
  if (!unidade) return { ok: false, message: "Informe a unidade da embalagem (mL, g, un…)." };
  if (!quantidade.ok) return { ok: false, message: "Informe quanto vem em 1 embalagem (maior que zero)." };
  if (!custo.ok) return { ok: false, message: "Informe o valor da embalagem (use 0 se ainda não souber)." };
  return {
    ok: true,
    dados: {
      especificacao,
      fabricante: texto("insumo_fabricante", 200),
      codigo_fabricante: texto("insumo_codigo_fabricante", 120),
      unidade,
      quantidade_embalagem: quantidade.valor,
      custo_total_embalagem: custo.valor,
      fator_conversao: 1,
    },
  };
}
