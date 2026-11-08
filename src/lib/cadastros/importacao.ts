/**
 * Leitura e preparação das planilhas XLSX de cadastros (importação).
 *
 * Funções puras (sem Supabase) usadas por `importarCadastrosWorkbook`:
 * mapeamento de cabeçalhos pelo rótulo, conversão de números/datas em
 * formato brasileiro, montagem do registro para criação/atualização e
 * diferença mínima para atualizar apenas o que mudou.
 *
 * Regras de negócio da importação ("só adicionar e atualizar"):
 * - nunca exclui registros;
 * - em registros existentes, célula vazia mantém o valor atual e colunas
 *   ausentes na planilha não são tocadas;
 * - a coluna de quantidade de insumos só vale para itens novos.
 */
import { codigoBarrasValido, separarCodigosBarras } from "@/lib/scanner/codigo-barras";
import { createHash } from "node:crypto";
import type ExcelJS from "exceljs";
import type { CadastroConfig, Campo } from "@/lib/cadastros/config";
import { estaMascarado } from "@/lib/cadastros/mascara";

/** Mesmo nome de campo usado em src/lib/cadastros/salario.ts. */
const CAMPO_SALARIO = "valor_mes";

export const TECH_ID_HEADER = "ID";
export const TECH_SUFFIX = "__id";

/** Chave e rótulo da coluna de quantidade (embalagens fechadas) de insumos. */
export const QUANTIDADE_INSUMO_KEY = "quantidade";
export const QUANTIDADE_INSUMO_LABEL = "Quantidade (embalagens fechadas)";
export const CODIGOS_BARRAS_KEY = "codigos_barras";
export const CODIGOS_BARRAS_LABEL = "Códigos de barras";

/** Campos aceitos por public.criar_insumo_com_quantidade (migration 0109). */
export const CAMPOS_RPC_INSUMO = [
  "categoria_compra",
  "codigo_fabricante",
  "codigo_interno",
  "condicao_armazenamento",
  "custo_total_embalagem",
  "data_aquisicao",
  "data_fabricacao",
  "data_validade",
  "especificacao",
  "estoque_seguranca",
  "fabricante",
  "fator_conversao",
  "fornecedor_alt_id",
  "fornecedor_id",
  "lead_time_dias",
  "nome_item",
  "ponto_reposicao",
  "prazo_entrega_max_dias",
  "quantidade_embalagem",
  "quantidade_minima_compra",
  "sds_url",
  "tipo_insumo_id",
  "unidade",
  "unidade_consumo",
  "validade_apos_abertura_dias",
  "validade_dias",
] as const;

/** Só letras e números, sem acento: compara nomes com pontuação diferente. */
function chaveSolta(value: unknown) {
  return normalizarChave(value).replace(/[^a-z0-9]+/g, "");
}

export function normalizarChave(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

function dataIso(ano: number, mes: number, dia: number): string | null {
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) {
    return null;
  }
  return data.toISOString().slice(0, 10);
}

/**
 * Número digitado em formato brasileiro ou internacional.
 * "1.234,56" → 1234.56 · "12,50" → 12.5 · "1.500" → 1500 · "0.5" → 0.5 ·
 * "R$ 10,00" → 10 · "12,5%" → 12.5. Retorna null quando não é número.
 */
export function parseNumeroBr(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let texto = value.replace(/R\$/gi, "").replace(/%/g, "").replace(/[\s ]/g, "");
  if (!texto) return null;
  const negativo = /^-/.test(texto);
  texto = texto.replace(/^[-+]/, "");
  if (texto.includes(",") && texto.includes(".")) {
    // o separador que aparece por último é o decimal
    texto =
      texto.lastIndexOf(",") > texto.lastIndexOf(".")
        ? texto.replace(/\./g, "").replace(",", ".")
        : texto.replace(/,/g, "");
  } else if (texto.includes(",")) {
    if ((texto.match(/,/g) ?? []).length > 1) return null;
    texto = texto.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(texto)) {
    // "1.500" / "1.234.567": ponto como separador de milhar (padrão pt-BR)
    texto = texto.replace(/\./g, "");
  }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(texto)) return null;
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return null;
  return negativo ? -numero : numero;
}

/**
 * Data de célula: Date do Excel, número serial do Excel, "dd/mm/aaaa",
 * "dd-mm-aaaa" ou "aaaa-mm-dd". Retorna "aaaa-mm-dd" ou null se inválida.
 */
export function parseDataBr(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // serial do Excel (dias desde 1899-12-30)
    const data = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
    return data.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const texto = value.trim();
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(texto);
  if (br) return dataIso(Number(br[3]), Number(br[2]), Number(br[1]));
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(texto);
  if (iso) return dataIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return null;
}

export function valorCelula(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value !== "object") return typeof value === "string" ? value.trim() : value;
  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join("").trim();
  }
  if ("text" in value && typeof value.text === "string") return value.text.trim();
  if ("result" in value) return value.result ?? null;
  if ("error" in value) return null;
  return String(cell.text ?? "").trim();
}

/** Mapa cabeçalho normalizado → chave interna (campo, id técnico ou coluna extra). */
/** Cabeçalhos alternativos aceitos para insumos (planilha do próprio laboratório). */
const ALIASES_INSUMOS: [string, string][] = [
  ["Marca", "fabricante"],
  ["Fabricante", "fabricante"],
  ["Código", "codigo_fabricante"],
  ["Catálogo", "codigo_fabricante"],
  ["Referência", "codigo_fabricante"],
  ["Part number", "codigo_fabricante"],
  ["Preço", "custo_total_embalagem"],
  ["Preço (R$)", "custo_total_embalagem"],
  ["Valor", "custo_total_embalagem"],
  ["Valor (R$)", "custo_total_embalagem"],
  ["Preço da embalagem", "custo_total_embalagem"],
  ["Conteúdo da embalagem", "quantidade_embalagem"],
  ["Qtd. na embalagem", "quantidade_embalagem"],
  ["Fornecedor", "fornecedor_id"],
  ["Categoria", "nome_item"],
  ["Mínimo", "ponto_reposicao"],
  ["Estoque mínimo", "ponto_reposicao"],
  ["Armazenamento", "condicao_armazenamento"],
  ["Validade", "data_validade"],
  ["Data de vencimento", "data_validade"],
  ["Vencimento", "data_validade"],
];

export function mapaCabecalhos(cfg: CadastroConfig) {
  const mapa = new Map<string, string>();
  mapa.set(normalizarChave(TECH_ID_HEADER), "id");
  for (const campo of cfg.campos) {
    mapa.set(normalizarChave(campo.label), campo.name);
    mapa.set(normalizarChave(campo.name), campo.name);
    for (const antigo of campo.rotulosAntigos ?? []) mapa.set(normalizarChave(antigo), campo.name);
    if (campo.tipo === "select" && campo.opcoesDe) {
      mapa.set(normalizarChave(`${campo.label} ID`), `${campo.name}${TECH_SUFFIX}`);
      mapa.set(normalizarChave(`${campo.name}${TECH_SUFFIX}`), `${campo.name}${TECH_SUFFIX}`);
    }
  }
  if (cfg.slug === "insumos") {
    // Nomes comuns em planilhas feitas à mão. Só valem quando não colidem
    // com um rótulo do modelo (o modelo sempre ganha).
    for (const [alias, chave] of ALIASES_INSUMOS) {
      const normalizado = normalizarChave(alias);
      if (!mapa.has(normalizado)) mapa.set(normalizado, chave);
    }
    mapa.set(normalizarChave(QUANTIDADE_INSUMO_LABEL), QUANTIDADE_INSUMO_KEY);
    mapa.set(normalizarChave("Quantidade"), QUANTIDADE_INSUMO_KEY);
    mapa.set(normalizarChave(CODIGOS_BARRAS_LABEL), CODIGOS_BARRAS_KEY);
    mapa.set(normalizarChave("Código de barras"), CODIGOS_BARRAS_KEY);
    mapa.set(normalizarChave(CODIGOS_BARRAS_KEY), CODIGOS_BARRAS_KEY);
  }
  return mapa;
}

/** Rótulo amigável para mensagens de erro ("Valor da embalagem (R$)"). */
export function rotuloCampo(cfg: CadastroConfig, chave: string) {
  if (cfg.slug === "insumos" && chave === QUANTIDADE_INSUMO_KEY) return QUANTIDADE_INSUMO_LABEL;
  if (cfg.slug === "insumos" && chave === CODIGOS_BARRAS_KEY) return CODIGOS_BARRAS_LABEL;
  if (chave === "id") return TECH_ID_HEADER;
  return (
    cfg.campos.find((campo) => campo.name === chave)?.label ??
    cfg.colunasXlsx?.find((coluna) => coluna.key === chave)?.label ??
    chave
  );
}

function minusculaInicial(texto: string) {
  return texto ? texto.charAt(0).toLowerCase() + texto.slice(1) : texto;
}

export function erroLinha(linha: number, rotulo: string, mensagem: string) {
  return `Linha ${linha}, ${rotulo}: ${minusculaInicial(mensagem)}`;
}

type ResultadoValor = { ok: true; valor: unknown } | { ok: false; erro: string };

/**
 * Converte o valor bruto da célula para o formato que os schemas esperam.
 * `celulaEmPercentual`: a célula está formatada como % no Excel (a planilha
 * exportada pelo Kontrol usa "0.0%"), então o número guardado é a fração
 * (0,5 = 50%). Sem esse formato, o número já está em pontos percentuais:
 * "1" é 1%, nunca 100%.
 */
export function valorParaCampo(
  value: unknown,
  campo: Campo,
  opcoes?: Map<string, string>,
  { celulaEmPercentual = false }: { celulaEmPercentual?: boolean } = {},
): ResultadoValor {
  if (value == null || value === "") return { ok: true, valor: "" };
  // Salário exportado mascarado ("XXX") equivale a célula vazia: mantém o atual.
  if (campo.name === CAMPO_SALARIO && estaMascarado(value)) return { ok: true, valor: "" };
  if (campo.tipo === "checkbox") {
    const normalizado = normalizarChave(value);
    return {
      ok: true,
      valor: ["sim", "s", "true", "1", "x", "yes", "on", "verdadeiro"].includes(normalizado) ? "true" : "false",
    };
  }
  if (campo.tipo === "date") {
    const data = parseDataBr(value);
    return data ? { ok: true, valor: data } : { ok: false, erro: "data inválida (use dd/mm/aaaa)" };
  }
  if (campo.tipo === "number" || campo.tipo === "currency" || campo.tipo === "percent") {
    const numero = parseNumeroBr(value);
    if (numero == null) return { ok: false, erro: "número inválido" };
    if (campo.tipo === "percent") {
      // Só a célula formatada como % guarda fração. Texto ("12,5%") e número
      // sem formato de % já estão em pontos percentuais.
      const fracao = celulaEmPercentual && typeof value === "number";
      return { ok: true, valor: fracao ? numero * 100 : numero };
    }
    return { ok: true, valor: numero };
  }
  if (campo.tipo === "select") {
    const bruto = String(value).trim();
    if (!opcoes) return { ok: true, valor: bruto };
    if (opcoes.has(bruto)) return { ok: true, valor: bruto };
    for (const [id, label] of opcoes) {
      if (normalizarChave(label) === normalizarChave(bruto)) return { ok: true, valor: id };
    }
    // Nome cortado ou com pontuação diferente ("... PRODUTOS PARA LABOR" no
    // lugar de "... PRODUTOS PARA LABORATÓRIO LTDA"): aceita quando um nome
    // começa pelo outro e só um cadastro combina.
    const alvo = chaveSolta(bruto);
    if (campo.opcoesDe && alvo.length >= 8) {
      const candidatos = [...opcoes].filter(([, label]) => {
        const nome = chaveSolta(label);
        return nome.length >= 8 && (nome.startsWith(alvo) || alvo.startsWith(nome));
      });
      if (candidatos.length === 1) return { ok: true, valor: candidatos[0][0] };
    }
    return {
      ok: false,
      erro: campo.opcoesDe ? `"${bruto}" não encontrado no cadastro` : `valor inválido "${bruto}"`,
    };
  }
  return { ok: true, valor: typeof value === "string" ? value : String(value) };
}

/** A célula (ou a coluna) está formatada como porcentagem no Excel. */
export function formatoPercentual(cell: Pick<ExcelJS.Cell, "numFmt">): boolean {
  return typeof cell.numFmt === "string" && cell.numFmt.includes("%");
}

export type LinhaImportada = {
  excelRow: number;
  id: number | null;
  /** somente células preenchidas, já convertidas para o formato do formulário */
  valores: Record<string, unknown>;
  /** quantidade bruta (insumos), null quando a célula está vazia */
  quantidade: number | null;
  /** insumos: códigos de barras da coluna própria (só acrescenta), null quando vazia */
  codigosBarras: string[] | null;
  erros: string[];
  /** ajustes feitos na linha que não impedem a importação */
  avisos: string[];
};

export type AbaLida = {
  linhas: LinhaImportada[];
  /** chaves internas das colunas reconhecidas no cabeçalho */
  colunas: Set<string>;
  /** títulos de coluna que o importador não reconheceu (dados ignorados) */
  ignoradas: string[];
};

/** Quantas linhas do topo são examinadas à procura do cabeçalho. */
export const LINHAS_BUSCA_CABECALHO = 10;

export type CabecalhoEncontrado = {
  /** número da linha do cabeçalho na aba (1 = primeira linha) */
  linha: number;
  /** colunas de dados reconhecidas (sem ID técnico) */
  reconhecidas: string[];
  /** o cabeçalho tem a coluna que identifica o registro (ex.: Item específico / SKU) */
  temRotulo: boolean;
};

/**
 * Procura, nas primeiras linhas da aba, a que mais parece o cabeçalho do
 * cadastro. Planilhas feitas à mão costumam ter título ou linhas em branco
 * antes dos nomes das colunas; a planilha modelo tem o cabeçalho na linha 1.
 */
export function encontrarCabecalho(sheet: ExcelJS.Worksheet, cfg: CadastroConfig): CabecalhoEncontrado {
  const headerMap = mapaCabecalhos(cfg);
  let melhor: CabecalhoEncontrado = { linha: 1, reconhecidas: [], temRotulo: false };
  const limite = Math.min(sheet.rowCount || 1, LINHAS_BUSCA_CABECALHO);
  for (let linha = 1; linha <= limite; linha += 1) {
    const reconhecidas = new Set<string>();
    sheet.getRow(linha).eachCell((cell) => {
      const chave = headerMap.get(normalizarChave(valorCelula(cell)));
      if (chave && chave !== "id" && !chave.endsWith(TECH_SUFFIX)) reconhecidas.add(chave);
    });
    if (reconhecidas.size > melhor.reconhecidas.length) {
      melhor = { linha, reconhecidas: [...reconhecidas], temRotulo: reconhecidas.has(cfg.rotulo) };
    }
  }
  return melhor;
}

export function lerAbaCadastro(
  sheet: ExcelJS.Worksheet,
  cfg: CadastroConfig,
  opcoes: Record<string, Map<string, string>>,
  linhaCabecalho = 1,
): AbaLida {
  const headers: string[] = [];
  const colunas = new Set<string>();
  const headerMap = mapaCabecalhos(cfg);
  const ignoradas: string[] = [];
  // Colunas só de leitura do modelo (calculadas na exportação) não contam como ignoradas.
  const soLeitura = new Set(
    (cfg.colunasXlsx ?? []).flatMap((coluna) => [normalizarChave(coluna.key), normalizarChave(coluna.label)]),
  );
  sheet.getRow(linhaCabecalho).eachCell((cell, colNumber) => {
    const titulo = valorCelula(cell);
    const chave = headerMap.get(normalizarChave(titulo)) ?? "";
    headers[colNumber] = chave;
    if (chave) colunas.add(chave);
    else if (
      titulo != null &&
      String(titulo).trim() &&
      !soLeitura.has(normalizarChave(titulo)) &&
      // Coluna bruta do banco que a exportação acrescenta (ex.: custo_unitario, ativo).
      !/^[a-z][a-z0-9_]*$/.test(String(titulo).trim())
    ) {
      ignoradas.push(String(titulo).trim());
    }
  });

  const campoPorNome = new Map(cfg.campos.map((campo) => [campo.name, campo]));
  const linhas: LinhaImportada[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= linhaCabecalho) return;
    const valores: Record<string, unknown> = {};
    const idsTecnicos: Record<string, unknown> = {};
    const erros: string[] = [];
    const avisos: string[] = [];
    let id: unknown = null;
    let quantidade: number | null = null;
    let codigosBarras: string[] | null = null;
    let temValor = false;

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const chave = headers[colNumber];
      if (!chave) return;
      const bruto = valorCelula(cell);
      if (bruto == null || bruto === "") return;
      if (chave === "id") {
        id = bruto;
        return;
      }
      if (chave.endsWith(TECH_SUFFIX)) {
        idsTecnicos[chave.slice(0, -TECH_SUFFIX.length)] = bruto;
        return;
      }
      temValor = true;
      if (chave === QUANTIDADE_INSUMO_KEY && cfg.slug === "insumos") {
        const numero = parseNumeroBr(bruto);
        if (numero == null) erros.push(erroLinha(rowNumber, QUANTIDADE_INSUMO_LABEL, "número inválido"));
        else quantidade = numero;
        return;
      }
      if (chave === CODIGOS_BARRAS_KEY && cfg.slug === "insumos") {
        codigosBarras = separarCodigosBarras(bruto);
        const longo = codigosBarras.find((codigo) => !codigoBarrasValido(codigo));
        if (longo) erros.push(erroLinha(rowNumber, CODIGOS_BARRAS_LABEL, `código inválido (${longo.slice(0, 20)}…)`));
        return;
      }
      const campo = campoPorNome.get(chave);
      if (!campo) return;
      const convertido = valorParaCampo(bruto, campo, opcoes[chave], {
        celulaEmPercentual: formatoPercentual(cell),
      });
      if (convertido.ok) valores[chave] = convertido.valor;
      else if (campo.opcoesDe && !campo.obrigatorio) {
        // Vínculo opcional que não existe no cadastro (ex.: fornecedor ainda
        // não cadastrado): a linha entra e o campo fica em branco.
        avisos.push(erroLinha(rowNumber, campo.label, `${convertido.erro}; ficou em branco`));
      } else erros.push(erroLinha(rowNumber, campo.label, convertido.erro));
    });

    // ID técnico (coluna oculta) só vale quando o rótulo visível está vazio
    // ou não identifica um registro: o que o usuário digitou prevalece.
    for (const [chave, valor] of Object.entries(idsTecnicos)) {
      const atual = valores[chave];
      const opcoesCampo = opcoes[chave];
      const idTecnico = String(valor).trim();
      if (opcoesCampo && !opcoesCampo.has(idTecnico)) continue;
      if (atual == null || atual === "" || (opcoesCampo && !opcoesCampo.has(String(atual)))) {
        valores[chave] = idTecnico;
        const prefixo = `Linha ${rowNumber}, ${campoPorNome.get(chave)?.label ?? chave}:`;
        const erroDoRotulo = erros.findIndex((erro) => erro.startsWith(prefixo));
        if (erroDoRotulo >= 0) erros.splice(erroDoRotulo, 1);
      }
    }

    if (!temValor) return;
    const idNumero = id == null ? null : parseNumeroBr(id);

    linhas.push({
      excelRow: rowNumber,
      id: idNumero != null && Number.isSafeInteger(idNumero) && idNumero > 0 ? idNumero : null,
      valores,
      quantidade,
      codigosBarras,
      erros,
      avisos,
    });
  });

  return { linhas, colunas, ignoradas };
}

/**
 * Padrões do formulário: checkbox ausente = desmarcado, fator de conversão 1,
 * unidade de consumo = unidade da embalagem quando vazia.
 */
export function aplicarPadroesCadastro(slug: string, obj: Record<string, unknown>) {
  if (slug === "equipamentos" && !("possui" in obj)) obj.possui = "false";
  if (slug === "tipo_insumos" && !("ativo" in obj)) obj.ativo = "false";
  if ((slug === "clientes" || slug === "fornecedores" || slug === "tecnicos") && !("ativo" in obj)) obj.ativo = "false";
  if (slug === "insumos") {
    if (!("fator_conversao" in obj) || obj.fator_conversao === "" || obj.fator_conversao == null) {
      obj.fator_conversao = "1";
    }
    if (
      (!("unidade_consumo" in obj) || obj.unidade_consumo === "" || obj.unidade_consumo == null) &&
      typeof obj.unidade === "string" &&
      obj.unidade.trim()
    ) {
      obj.unidade_consumo = obj.unidade;
    }
  }
  return obj;
}

/** Registro novo: valores da planilha + padrões de criação do formulário. */
export function registroNovo(cfg: CadastroConfig, valores: Record<string, unknown>) {
  const obj: Record<string, unknown> = { ...valores };
  for (const campo of cfg.campos) {
    if (obj[campo.name] != null && obj[campo.name] !== "") continue;
    if (campo.tipo === "checkbox" && campo.padraoLigado) obj[campo.name] = "true";
    else if (campo.valorPadrao != null) obj[campo.name] = String(campo.valorPadrao);
  }
  return aplicarPadroesCadastro(cfg.slug, obj);
}

/**
 * Registro existente: parte do valor atual e sobrepõe só as células
 * preenchidas. Colunas ausentes ou vazias preservam o que está gravado.
 */
export function registroAtualizado(
  cfg: CadastroConfig,
  existente: Record<string, unknown>,
  valores: Record<string, unknown>,
) {
  const obj: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(existente)) {
    obj[chave] = valor == null ? "" : valor;
  }
  // checkbox ligado por padrão sem valor gravado (ex.: `ativo` antes da coluna
  // existir) continua ligado; célula vazia não desativa o registro
  for (const campo of cfg.campos) {
    if (campo.tipo === "checkbox" && campo.padraoLigado && existente[campo.name] == null) obj[campo.name] = "true";
  }
  for (const [chave, valor] of Object.entries(valores)) {
    if (valor == null || valor === "") continue;
    obj[chave] = valor;
  }
  return aplicarPadroesCadastro(cfg.slug, obj);
}

function vazio(valor: unknown) {
  return valor == null || (typeof valor === "string" && valor.trim() === "");
}

export function valoresEquivalentes(a: unknown, b: unknown) {
  if (vazio(a) && vazio(b)) return true;
  if (vazio(a) || vazio(b)) return false;
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b);
  const na = typeof a === "number" ? a : typeof a === "string" && a.trim() !== "" ? Number(a) : NaN;
  const nb = typeof b === "number" ? b : typeof b === "string" && b.trim() !== "" ? Number(b) : NaN;
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    return Math.abs(na - nb) <= 1e-9 * Math.max(1, Math.abs(na), Math.abs(nb));
  }
  const sa = String(a).trim();
  const sb = String(b).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(sa) && /^\d{4}-\d{2}-\d{2}/.test(sb)) return sa.slice(0, 10) === sb.slice(0, 10);
  return sa === sb;
}

/** Somente as colunas cujo valor realmente muda (update mínimo). */
export function diferencas(
  novo: Record<string, unknown>,
  existente: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(novo)) {
    if (!valoresEquivalentes(valor, existente[chave])) payload[chave] = valor;
  }
  return payload;
}

/** Hash SHA-256 (hex) do conteúdo do arquivo importado. */
export function hashConteudo(conteudo: ArrayBuffer | Uint8Array | string) {
  const hash = createHash("sha256");
  hash.update(typeof conteudo === "string" ? conteudo : Buffer.from(conteudo as ArrayBuffer));
  return hash.digest("hex");
}

/**
 * UUID determinístico (formato v5) derivado do arquivo + aba + linha.
 * Reenviar o mesmo arquivo reaproveita o mesmo operacao_id, e a RPC
 * idempotente não duplica o estoque inicial.
 */
export function operacaoIdDeterministico(...partes: (string | number)[]) {
  const bytes = createHash("sha256").update(`kontrol-importacao:${partes.join(":")}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Recorta o payload aos campos aceitos pela RPC de criação de insumo. */
export function payloadRpcInsumo(dados: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};
  for (const chave of CAMPOS_RPC_INSUMO) {
    if (chave in dados) payload[chave] = dados[chave];
  }
  return payload;
}

// ---- reconhecimento do arquivo e das abas ----

export type TipoArquivoPlanilha = "xlsx" | "xls" | "texto" | "desconhecido";

/**
 * Tipo real do arquivo pelos primeiros bytes (a extensão não basta: há .xls
 * que são .xlsx renomeados e vice-versa). xlsx = pacote ZIP (PK); xls =
 * Excel 97-2003 (contêiner OLE D0 CF 11 E0); texto = CSV/HTML/XML salvos
 * com extensão de planilha.
 */
export function tipoArquivoPlanilha(bytes: Uint8Array): TipoArquivoPlanilha {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "xlsx";
  }
  if (
    bytes.length >= 8 &&
    [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, i) => bytes[i] === byte)
  ) {
    return "xls";
  }
  const inicio = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 512));
  // Texto legível (CSV, HTML ou XML de planilha) sem bytes de controle binários.
  if (inicio.length > 0 && !/[\u0000-\u0008\u000e-\u001f]/.test(inicio)) return "texto";
  return "desconhecido";
}

export const MENSAGEM_ARQUIVO: Record<Exclude<TipoArquivoPlanilha, "xlsx">, string> = {
  xls:
    'Este arquivo está no formato antigo do Excel (.xls, Excel 97-2003), que o Kontrol ainda não lê. No Excel, abra a planilha, clique em Arquivo → Salvar como e escolha "Pasta de Trabalho do Excel (*.xlsx)". Depois importe o arquivo .xlsx.',
  texto:
    'Este arquivo é texto (CSV, HTML ou XML), não uma pasta de trabalho do Excel, mesmo com extensão de planilha. No Excel, abra o arquivo, clique em Arquivo → Salvar como e escolha "Pasta de Trabalho do Excel (*.xlsx)". Depois importe o arquivo .xlsx.',
  desconhecido:
    'Não foi possível reconhecer este arquivo como planilha do Excel. Salve no Excel como "Pasta de Trabalho do Excel (*.xlsx)" e importe de novo.',
};

/** Abas do modelo que não são cadastros (instruções e listas de apoio). */
const ABAS_DE_APOIO = new Set(["instrucoes", "listas", "_listas", "opcoes"]);

/** "Insumos", "insumo", "INSUMOS " → "insumo" (só para comparar nomes de aba). */
function nomeAbaComparavel(nome: unknown) {
  return normalizarChave(nome).replace(/s$/, "");
}

export type AbaReconhecida = {
  cfg: CadastroConfig;
  sheet: ExcelJS.Worksheet;
  /** linha do cabeçalho na aba */
  linhaCabecalho: number;
  /** como a aba foi reconhecida (para avisar o usuário) */
  pelo: "nome" | "cabecalho";
};

/** Mínimo de colunas reconhecidas para aceitar uma aba pelo cabeçalho. */
const MIN_COLUNAS_PELO_CABECALHO = 2;

/**
 * Liga cada aba da planilha a um cadastro. Primeiro pelo nome da aba (com ou
 * sem plural, sem acento/maiúscula); as abas que sobrarem, pelo cabeçalho:
 * a aba vai para o cadastro cujas colunas ela mais tem, desde que tenha a
 * coluna que identifica o registro e pelo menos duas colunas reconhecidas.
 * Assim "Planilha1" com as colunas de insumos é importada como Insumos.
 */
export function localizarAbasCadastro(
  workbook: ExcelJS.Workbook,
  configs: CadastroConfig[],
): AbaReconhecida[] {
  const resultado: AbaReconhecida[] = [];
  const cfgUsados = new Set<string>();
  const abasUsadas = new Set<number>();

  for (const cfg of configs) {
    const nomes = new Set([
      nomeAbaComparavel(cfg.titulo),
      nomeAbaComparavel(cfg.titulo.slice(0, 31)),
      nomeAbaComparavel(cfg.slug),
    ]);
    const sheet = workbook.worksheets.find(
      (aba) => !abasUsadas.has(aba.id) && nomes.has(nomeAbaComparavel(aba.name)),
    );
    if (!sheet) continue;
    const cabecalho = encontrarCabecalho(sheet, cfg);
    resultado.push({ cfg, sheet, linhaCabecalho: cabecalho.linha, pelo: "nome" });
    cfgUsados.add(cfg.slug);
    abasUsadas.add(sheet.id);
  }

  const candidatas: { cfg: CadastroConfig; sheet: ExcelJS.Worksheet; linha: number; pontos: number }[] = [];
  for (const sheet of workbook.worksheets) {
    if (abasUsadas.has(sheet.id) || sheet.state === "veryHidden" || sheet.state === "hidden") continue;
    if (ABAS_DE_APOIO.has(normalizarChave(sheet.name))) continue;
    for (const cfg of configs) {
      if (cfgUsados.has(cfg.slug)) continue;
      const cabecalho = encontrarCabecalho(sheet, cfg);
      if (!cabecalho.temRotulo || cabecalho.reconhecidas.length < MIN_COLUNAS_PELO_CABECALHO) continue;
      candidatas.push({ cfg, sheet, linha: cabecalho.linha, pontos: cabecalho.reconhecidas.length });
    }
  }
  // Maior número de colunas reconhecidas primeiro; empate segue a ordem de importação.
  candidatas.sort((a, b) => b.pontos - a.pontos);
  for (const candidata of candidatas) {
    if (cfgUsados.has(candidata.cfg.slug) || abasUsadas.has(candidata.sheet.id)) continue;
    resultado.push({ cfg: candidata.cfg, sheet: candidata.sheet, linhaCabecalho: candidata.linha, pelo: "cabecalho" });
    cfgUsados.add(candidata.cfg.slug);
    abasUsadas.add(candidata.sheet.id);
  }

  // Importa na ordem dos cadastros (dependências primeiro), não na ordem das abas.
  const ordem = new Map(configs.map((cfg, i) => [cfg.slug, i]));
  return resultado.sort((a, b) => (ordem.get(a.cfg.slug) ?? 0) - (ordem.get(b.cfg.slug) ?? 0));
}

/** Colunas obrigatórias de um cadastro, pelos nomes do modelo. */
export function colunasObrigatorias(cfg: CadastroConfig) {
  return cfg.campos.filter((campo) => campo.obrigatorio).map((campo) => campo.label);
}

/**
 * Explica por que nenhuma aba foi reconhecida: quais abas o arquivo tem e o
 * que falta, usando como exemplo o cadastro mais próximo (ou Insumos).
 */
export function mensagemSemAbaReconhecida(workbook: ExcelJS.Workbook, configs: CadastroConfig[]) {
  const abas = workbook.worksheets.map((aba) => `"${aba.name}"`);
  let melhor: { cfg: CadastroConfig; reconhecidas: string[] } | null = null;
  for (const sheet of workbook.worksheets) {
    for (const cfg of configs) {
      const cabecalho = encontrarCabecalho(sheet, cfg);
      if (!melhor || cabecalho.reconhecidas.length > melhor.reconhecidas.length) {
        melhor = { cfg, reconhecidas: cabecalho.reconhecidas };
      }
    }
  }
  const alvo =
    melhor && melhor.reconhecidas.length > 0
      ? melhor.cfg
      : configs.find((cfg) => cfg.slug === "insumos") ?? configs[0];
  const partes = [
    `Nenhuma aba de cadastro encontrada${abas.length ? ` (abas no arquivo: ${abas.join(", ")})` : ""}.`,
    `Dê à aba o nome do cadastro, por exemplo "${alvo.titulo}", ou use na primeira linha os nomes de coluna da planilha modelo (botão Baixar XLSX).`,
  ];
  const obrigatorias = colunasObrigatorias(alvo);
  if (obrigatorias.length) {
    const presentes = new Set(melhor && melhor.cfg.slug === alvo.slug ? melhor.reconhecidas : []);
    const faltam = alvo.campos
      .filter((campo) => campo.obrigatorio && !presentes.has(campo.name))
      .map((campo) => campo.label);
    partes.push(
      faltam.length && presentes.size > 0
        ? `Para ${alvo.titulo}, faltam as colunas: ${faltam.join(", ")}.`
        : `Para ${alvo.titulo}, as colunas obrigatórias são: ${obrigatorias.join(", ")}.`,
    );
  }
  return partes.join(" ");
}

/**
 * Insumo novo vindo de planilha com colunas obrigatórias vazias: completa
 * com o que é seguro, em vez de recusar a linha, e devolve avisos.
 * - Unidade da embalagem vazia: usa a Unidade de consumo; sem as duas, "unidade".
 * - Quantidade na embalagem vazia: 1.
 * - Valor da embalagem vazio: 0 (fica como "sem custo", igual ao formulário).
 * Só para registros novos; em registros existentes célula vazia mantém o valor.
 */
export function completarInsumoNovo(valores: Record<string, unknown>, excelRow: number) {
  const completos = { ...valores };
  const avisos: string[] = [];
  const vazio = (chave: string) => completos[chave] == null || completos[chave] === "";
  if (vazio("unidade") && !vazio("unidade_consumo")) {
    completos.unidade = completos.unidade_consumo;
    avisos.push(`Linha ${excelRow}: sem Unidade da embalagem; usada a Unidade de consumo ("${completos.unidade_consumo}").`);
  } else if (vazio("unidade")) {
    completos.unidade = "unidade";
    avisos.push(`Linha ${excelRow}: sem Unidade da embalagem nem de consumo; considerado "unidade" (confira depois).`);
  }
  if (vazio("quantidade_embalagem")) {
    completos.quantidade_embalagem = 1;
    avisos.push(`Linha ${excelRow}: sem Quantidade na embalagem; considerado 1.`);
  }
  if (vazio("custo_total_embalagem")) {
    completos.custo_total_embalagem = 0;
    avisos.push(`Linha ${excelRow}: sem Valor da embalagem; cadastrado sem custo (preencha depois).`);
  }
  return { valores: completos, avisos };
}
