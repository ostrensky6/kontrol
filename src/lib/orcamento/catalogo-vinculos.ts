/**
 * Catálogo de custos ligado aos cadastros de Insumos e Técnicos (decisão 5 de
 * Antonio, 11/11/2026; migration 0179). Aqui ficam só as regras de tela:
 * rótulos, sugestão pelo nome e leitura do formulário. Ligar, desfazer e o valor
 * do cadastro (que pode ser salário) ficam no banco.
 */

export const BASES_INSUMO = ["embalagem", "unidade"] as const;
export const BASES_TECNICO = ["mes", "hora"] as const;
export type BaseInsumo = (typeof BASES_INSUMO)[number];
export type BaseTecnico = (typeof BASES_TECNICO)[number];
export type BaseVinculo = BaseInsumo | BaseTecnico;

export const ROTULO_BASE: Record<BaseVinculo, string> = {
  embalagem: "por embalagem",
  unidade: "por unidade",
  mes: "por mês",
  hora: "por hora",
};

/** Só material de consumo tem par em Insumos e só pessoal tem par em Técnicos. */
export function cadastroDaRubrica(rubrica: string | null | undefined): "insumo" | "tecnico" | null {
  if (rubrica === "MC") return "insumo";
  if (rubrica === "PE") return "tecnico";
  return null;
}

export type VinculoCatalogo = {
  catalogo_item_id: string;
  insumo_id: number | null;
  insumo_nome: string | null;
  insumo_unidade: string | null;
  tecnico_id: number | null;
  tecnico_nome: string | null;
  vinculo_base: BaseVinculo | null;
  /** null = pessoal para quem não tem "Valores de pessoal no orçamento". */
  cadastro_sem_custo: boolean | null;
  vinculo_em: string | null;
};

function ehBase(valor: unknown): valor is BaseVinculo {
  return typeof valor === "string" && valor in ROTULO_BASE;
}

function numeroOuNulo(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function textoOuNulo(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor : null;
}

/** Linhas de orcamento_projeto_catalogo_vinculos() por código do item. */
export function mapaVinculos(linhas: unknown): Map<string, VinculoCatalogo> {
  const mapa = new Map<string, VinculoCatalogo>();
  if (!Array.isArray(linhas)) return mapa;
  for (const bruta of linhas) {
    if (!bruta || typeof bruta !== "object") continue;
    const linha = bruta as Record<string, unknown>;
    const id = textoOuNulo(linha.catalogo_item_id);
    if (!id) continue;
    const insumoId = numeroOuNulo(linha.insumo_id);
    const tecnicoId = numeroOuNulo(linha.tecnico_id);
    if (insumoId == null && tecnicoId == null) continue;
    mapa.set(id, {
      catalogo_item_id: id,
      insumo_id: insumoId,
      insumo_nome: textoOuNulo(linha.insumo_nome),
      insumo_unidade: textoOuNulo(linha.insumo_unidade),
      tecnico_id: tecnicoId,
      tecnico_nome: textoOuNulo(linha.tecnico_nome),
      vinculo_base: ehBase(linha.vinculo_base) ? linha.vinculo_base : null,
      cadastro_sem_custo: typeof linha.cadastro_sem_custo === "boolean" ? linha.cadastro_sem_custo : null,
      vinculo_em: textoOuNulo(linha.vinculo_em),
    });
  }
  return mapa;
}

/** "Do cadastro de Insumos" / "Do cadastro de Técnicos". */
export function seloCadastro(vinculo: VinculoCatalogo | null | undefined): string | null {
  if (!vinculo) return null;
  if (vinculo.insumo_id != null) return "Do cadastro de Insumos";
  if (vinculo.tecnico_id != null) return "Do cadastro de Técnicos";
  return null;
}

/** Nome do cadastro para as mensagens ("Insumos" ou "Técnicos"). */
export function nomeCadastro(vinculo: VinculoCatalogo | null | undefined): "Insumos" | "Técnicos" | null {
  if (!vinculo) return null;
  if (vinculo.insumo_id != null) return "Insumos";
  if (vinculo.tecnico_id != null) return "Técnicos";
  return null;
}

/** "Insumo Luva nitrílica M · por embalagem" (sem valor nenhum). */
export function descreverVinculo(vinculo: VinculoCatalogo): string {
  const base = vinculo.vinculo_base ? ` · ${ROTULO_BASE[vinculo.vinculo_base]}` : "";
  if (vinculo.insumo_id != null) {
    return `Insumo ${vinculo.insumo_nome ?? `#${vinculo.insumo_id}`}${base}`;
  }
  return `Técnico ${vinculo.tecnico_nome ?? `#${vinculo.tecnico_id}`}${base}`;
}

/** Cadastro sem custo não substitui o catálogo: o aviso diz isso. */
export function avisoSemCusto(vinculo: VinculoCatalogo | null | undefined): string | null {
  if (!vinculo || vinculo.cadastro_sem_custo !== true) return null;
  return vinculo.insumo_id != null
    ? "Insumo sem custo no cadastro: vale o valor do catálogo."
    : "Técnico sem valor no cadastro: vale o valor do catálogo.";
}

/** Texto do aviso quando o valor da linha muda num orçamento. */
export function avisoValorAlterado(vinculo: VinculoCatalogo | null | undefined): string {
  const cadastro = nomeCadastro(vinculo);
  if (cadastro) return `Valor alterado: vale só para este orçamento. O catálogo segue o cadastro de ${cadastro}.`;
  return "Valor alterado: vale para este orçamento e, ao concluir a revisão, atualiza o catálogo.";
}

// ---- Sugestão pelo nome ------------------------------------------------------

const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "com", "para", "por", "sem", "em", "e", "a", "o", "x"]);

/** Palavras do nome, sem acento, sem maiúscula e sem plural simples. */
export function palavrasDoNome(texto: string | null | undefined): string[] {
  if (!texto) return [];
  const limpo = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!limpo) return [];
  const palavras = limpo
    .split(" ")
    .filter((palavra) => palavra.length >= 2 && !PALAVRAS_VAZIAS.has(palavra))
    .map((palavra) => (palavra.length > 4 && palavra.endsWith("s") ? palavra.slice(0, -1) : palavra));
  return [...new Set(palavras)];
}

function combina(a: string, b: string): boolean {
  if (a === b) return true;
  // "microtubo" e "microtubos", "nitril" e "nitrilica": prefixo de 5+ letras conta
  const menor = a.length <= b.length ? a : b;
  const maior = a.length <= b.length ? b : a;
  return menor.length >= 5 && maior.startsWith(menor);
}

/** Pontos do candidato: palavras do item que aparecem no nome dele. */
export function pontosSugestao(descricao: string, nome: string): number {
  const doItem = palavrasDoNome(descricao);
  const doCandidato = palavrasDoNome(nome);
  if (doItem.length === 0 || doCandidato.length === 0) return 0;
  let pontos = 0;
  for (const palavra of doItem) {
    if (doCandidato.some((outra) => combina(palavra, outra))) pontos += palavra.length >= 4 ? 2 : 1;
  }
  return pontos;
}

/** Até `limite` candidatos que dividem palavras com a descrição, do mais parecido ao menos. */
export function sugerirCadastro<T extends { id: number; nome: string }>(
  descricao: string,
  candidatos: readonly T[],
  limite = 5,
): T[] {
  return candidatos
    .map((candidato) => ({ candidato, pontos: pontosSugestao(descricao, candidato.nome) }))
    .filter((entrada) => entrada.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos || a.candidato.nome.localeCompare(b.candidato.nome, "pt-BR"))
    .slice(0, limite)
    .map((entrada) => entrada.candidato);
}

// ---- Formulário ---------------------------------------------------------------

export type EntradaVinculo = {
  id: string;
  insumoId: number | null;
  tecnicoId: number | null;
  base: BaseVinculo | null;
};

function campo(formData: FormData, chave: string) {
  const valor = String(formData.get(chave) ?? "").trim();
  return valor || null;
}

/**
 * Lê o formulário de vínculo: `id` do item, `acao` ("ligar" ou "desfazer"),
 * `cadastro` ("insumo:12" ou "tecnico:3") e `base`.
 */
export function lerVinculo(
  formData: FormData,
): { ok: true; vinculo: EntradaVinculo } | { ok: false; message: string } {
  const id = campo(formData, "id");
  if (!id) return { ok: false, message: "Item do catálogo não informado." };
  if (campo(formData, "acao") === "desfazer") {
    return { ok: true, vinculo: { id, insumoId: null, tecnicoId: null, base: null } };
  }
  const cadastro = campo(formData, "cadastro");
  const casado = cadastro ? /^(insumo|tecnico):(\d+)$/.exec(cadastro) : null;
  if (!casado) return { ok: false, message: "Escolha o insumo ou o técnico." };
  const tipo = casado[1] as "insumo" | "tecnico";
  const cadastroId = Number(casado[2]);
  const base = campo(formData, "base");
  const bases: readonly string[] = tipo === "insumo" ? BASES_INSUMO : BASES_TECNICO;
  if (!base || !bases.includes(base)) {
    return {
      ok: false,
      message: tipo === "insumo" ? "Diga se o valor é por embalagem ou por unidade." : "Diga se o valor é por mês ou por hora.",
    };
  }
  return {
    ok: true,
    vinculo: {
      id,
      insumoId: tipo === "insumo" ? cadastroId : null,
      tecnicoId: tipo === "tecnico" ? cadastroId : null,
      base: base as BaseVinculo,
    },
  };
}

/** Aviso depois de ligar ou desfazer, a partir da resposta do banco. */
export function mensagemVinculo(resposta: unknown, entrada: EntradaVinculo): string {
  const r = (resposta && typeof resposta === "object" ? resposta : {}) as {
    ligado?: unknown;
    aplicado?: unknown;
    sem_custo?: unknown;
  };
  if (!entrada.insumoId && !entrada.tecnicoId) return `${entrada.id}: vínculo desfeito. O item ficou livre com o valor atual.`;
  const cadastro = entrada.insumoId ? "Insumos" : "Técnicos";
  if (r.sem_custo === true) {
    return `${entrada.id} ligado ao cadastro de ${cadastro}. O cadastro está sem custo; o catálogo mantém o valor atual.`;
  }
  if (r.aplicado === true) return `${entrada.id} ligado ao cadastro de ${cadastro}. O valor do catálogo passou a ser o do cadastro.`;
  return `${entrada.id} ligado ao cadastro de ${cadastro}. O valor já era o do cadastro.`;
}
