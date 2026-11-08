"use server";

import { unstable_rethrow } from "next/navigation";
import { createClientUntyped } from "@/lib/supabase/server";

const PAPEIS_ESCRITA = new Set(["laboratorio", "gestor", "coordenador", "supervisor", "admin"]);
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export type RevisaoConsumoManual = {
  insumo_id: number;
  revisao: number;
  quantidade_embalagens_mes: number;
  conteudo_embalagem: number;
  unidade_conteudo: string;
  fonte: string;
  motivo: string;
  data_referencia: string;
  ator_id: string;
  registrado_em: string;
};

type FalhaCodigo = "ENTRADA_INVALIDA" | "ESCRITA_DESABILITADA" | "SESSAO_INVALIDA" |
  "SEM_ACESSO" | "APRESENTACAO_DIVERGENTE" | "REVISAO_DIVERGENTE" | "OPERACAO_CONFLITANTE" |
  "RESPOSTA_INVALIDA" | "FALHA_LEITURA" | "FALHA_ESCRITA";

type Falha = { ok: false; codigo: FalhaCodigo; message: string };

export type ResultadoRegistroConsumoManual = Falha | { ok: true; estado: "registrada" | "repetida"; registro: RevisaoConsumoManual };
export type EstadoRegistroConsumoManual = ResultadoRegistroConsumoManual | { ok: false; codigo?: never; message?: never };

type Apresentacao = { estado: "disponivel"; conteudo: number; unidade: string } |
  { estado: "indisponivel"; motivo: "FALHA_CATALOGO" | "APRESENTACAO_INCOMPLETA" };

type Pagina = {
  estado: "nenhuma" | "registrada";
  vigente: RevisaoConsumoManual | null;
  historico: RevisaoConsumoManual[];
  proxima_antes_da_revisao: number | null;
};

export type ResultadoLeituraConsumoManual = Falha | (Pagina & {
  ok: true;
  apresentacao: Apresentacao | null;
  podeRegistrar: boolean;
});

function falha(codigo: FalhaCodigo, message: string): Falha {
  return { ok: false, codigo, message };
}

function entradaInvalida() {
  return falha("ENTRADA_INVALIDA", "Confira os dados e confirme a apresentação da embalagem.");
}

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor as Record<string, unknown> : null;
}

function inteiro(valor: unknown, min: number): valor is number {
  return typeof valor === "number" && Number.isSafeInteger(valor) && valor >= min;
}

function numeroDecimal(valor: unknown, aceitaZero: boolean): valor is number {
  return typeof valor === "number" && Number.isFinite(valor) && valor <= Number.MAX_SAFE_INTEGER &&
    (aceitaZero ? valor >= 0 : valor > 0);
}

function texto(valor: unknown, limite?: number): valor is string {
  return typeof valor === "string" && valor.trim().length > 0 && !valor.includes("\u0000") &&
    (limite === undefined || [...valor].length <= limite);
}

function unidade(valor: unknown): valor is string {
  return texto(valor) && !["-", "—"].includes(valor.trim());
}

function dataCivil(valor: unknown): valor is string {
  if (typeof valor !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const d = new Date(`${valor}T00:00:00.000Z`);
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === valor;
}

function timestamp(valor: unknown): valor is string {
  return typeof valor === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(valor) && Number.isFinite(Date.parse(valor));
}

function campo(form: FormData, nome: string) {
  const [valor, ...resto] = form.getAll(nome);
  return resto.length === 0 && typeof valor === "string" ? valor.trim() : null;
}

function inteiroDoForm(valor: string | null, min: number) {
  const n = valor !== null && /^\d+$/.test(valor) ? Number(valor) : NaN;
  return inteiro(n, min) ? n : null;
}

function decimalDoForm(valor: string | null, aceitaZero: boolean) {
  const partes = valor !== null && valor.length <= 128 ? /^(\d+)(?:[.,](\d+))?$/.exec(valor) : null;
  if (!partes) return null;
  const inteiro = partes[1].replace(/^0+(?=\d)/, "");
  const fracao = partes[2]?.replace(/0+$/, "");
  const canonico = fracao ? `${inteiro}.${fracao}` : inteiro;
  const n = Number(canonico);
  if (!numeroDecimal(n, aceitaZero)) return null;
  // O numeric da RPC viaja em JSON. Rejeitar arredondamento ou underflow silencioso.
  const serializado = String(n);
  const expoente = /^(\d)(?:\.(\d+))?e-(\d+)$/.exec(serializado);
  const decimal = expoente
    ? `0.${"0".repeat(Number(expoente[3]) - 1)}${expoente[1]}${expoente[2] ?? ""}`
    : serializado;
  return decimal === canonico ? n : null;
}

function parametros(form: FormData) {
  const insumo = inteiroDoForm(campo(form, "insumo_id"), 1);
  const operacao = campo(form, "operacao_id");
  const revisao = inteiroDoForm(campo(form, "revisao_esperada"), 0);
  const quantidade = decimalDoForm(campo(form, "quantidade_embalagens_mes"), true);
  const conteudo = decimalDoForm(campo(form, "conteudo_embalagem_esperado"), false);
  const un = campo(form, "unidade_conteudo_esperada");
  const fonte = campo(form, "fonte");
  const motivo = campo(form, "motivo");
  const data = campo(form, "data_referencia");
  if (insumo === null || !operacao || !UUID.test(operacao) || revisao === null || revisao >= Number.MAX_SAFE_INTEGER ||
    quantidade === null || conteudo === null || !unidade(un) || !texto(fonte, 240) || !texto(motivo, 1000) ||
    !dataCivil(data) || campo(form, "apresentacao_confirmada") !== "1") return null;
  return {
    p_insumo_id: insumo, p_operacao_id: operacao.toLowerCase(), p_revisao_esperada: revisao,
    p_quantidade_embalagens_mes: quantidade, p_conteudo_embalagem_esperado: conteudo,
    p_unidade_conteudo_esperada: un, p_apresentacao_confirmada: true,
    p_fonte: fonte, p_motivo: motivo, p_data_referencia: data,
  };
}

function revisaoDoBanco(valor: unknown, insumoId: number): RevisaoConsumoManual | null {
  const r = objeto(valor);
  if (!r || r.insumo_id !== insumoId || !inteiro(r.revisao, 1) || !numeroDecimal(r.quantidade_embalagens_mes, true) ||
    !numeroDecimal(r.conteudo_embalagem, false) || !unidade(r.unidade_conteudo) ||
    !texto(r.fonte, 240) || !texto(r.motivo, 1000) || !dataCivil(r.data_referencia) ||
    typeof r.ator_id !== "string" || !UUID.test(r.ator_id) || !timestamp(r.registrado_em)) return null;
  return {
    insumo_id: insumoId, revisao: r.revisao, quantidade_embalagens_mes: r.quantidade_embalagens_mes,
    conteudo_embalagem: r.conteudo_embalagem, unidade_conteudo: r.unidade_conteudo,
    fonte: r.fonte, motivo: r.motivo, data_referencia: r.data_referencia,
    ator_id: r.ator_id, registrado_em: r.registrado_em,
  };
}

function paginaDoBanco(valor: unknown, insumo: number, antes: number | null, limite: number): Pagina | null {
  const p = objeto(valor);
  if (!p || !Array.isArray(p.historico) || p.historico.length > limite) return null;
  if (p.estado === "nenhuma") {
    return p.vigente === null && p.historico.length === 0 && p.proxima_antes_da_revisao === null
      ? { estado: "nenhuma", vigente: null, historico: [], proxima_antes_da_revisao: null } : null;
  }
  const vigente = revisaoDoBanco(p.vigente, insumo);
  if (p.estado !== "registrada" || !vigente) return null;
  const historico: RevisaoConsumoManual[] = [];
  let teto = antes ?? Infinity;
  for (const item of p.historico) {
    const linha = revisaoDoBanco(item, insumo);
    if (!linha || linha.revisao >= teto || linha.revisao > vigente.revisao) return null;
    historico.push(linha);
    teto = linha.revisao;
  }
  if (antes === null && JSON.stringify(historico[0]) !== JSON.stringify(vigente)) return null;
  const proxima = p.proxima_antes_da_revisao;
  if (proxima !== null && (!inteiro(proxima, 2) || historico.length !== limite || proxima !== historico.at(-1)?.revisao)) return null;
  return { estado: "registrada", vigente, historico, proxima_antes_da_revisao: proxima };
}

function escritaHabilitada() {
  return process.env.KONTROL_CONSUMO_MANUAL_ESCRITA_HABILITADA === "1";
}

type ClienteSessao = Awaited<ReturnType<typeof createClientUntyped>>;

async function atorDaSessao(cliente: ClienteSessao) {
  const { data, error } = await cliente.auth.getUser();
  const id = data?.user?.id;
  return !error && typeof id === "string" && UUID.test(id) ? id.toLowerCase() : null;
}

async function podeEscrever(cliente: ClienteSessao) {
  const { data, error } = await cliente.rpc("current_papel");
  return !error && typeof data === "string" && PAPEIS_ESCRITA.has(data);
}

async function contextoDeEdicao(cliente: ClienteSessao, insumo: number) {
  let apresentacao: Apresentacao = { estado: "indisponivel", motivo: "FALHA_CATALOGO" };
  let podeRegistrar = false;
  try {
    const { data, error } = await cliente.from("insumos").select("id, quantidade_embalagem, unidade").eq("id", insumo).maybeSingle();
    if (!error) {
      apresentacao = data?.id === insumo && numeroDecimal(data.quantidade_embalagem, false) && unidade(data.unidade)
        ? { estado: "disponivel", conteudo: data.quantidade_embalagem, unidade: data.unidade.trim() }
        : { estado: "indisponivel", motivo: "APRESENTACAO_INCOMPLETA" };
    }
    if (apresentacao.estado === "disponivel" && escritaHabilitada()) podeRegistrar = await podeEscrever(cliente);
  } catch (error) {
    unstable_rethrow(error);
  }
  return { apresentacao, podeRegistrar };
}

/** Consulta só o insumo selecionado; páginas de histórico não consultam o cadastro outra vez. */
export async function lerConsumoManual(
  insumoId: number, antesDaRevisao: number | null = null, limite = 25,
): Promise<ResultadoLeituraConsumoManual> {
  if (!inteiro(insumoId, 1) || (antesDaRevisao !== null && !inteiro(antesDaRevisao, 1)) ||
    !inteiro(limite, 1) || limite > 100) return entradaInvalida();
  try {
    const cliente = await createClientUntyped();
    if (!await atorDaSessao(cliente)) return falha("SESSAO_INVALIDA", "Entre novamente para consultar a estimativa.");
    const { data, error } = await cliente.rpc("ler_consumo_manual_insumo", {
      p_insumo_id: insumoId, p_antes_da_revisao: antesDaRevisao, p_limite: limite,
    });
    if (error?.code === "42501") return falha("SEM_ACESSO", "Insumo indisponível para esta sessão.");
    if (error) return falha("FALHA_LEITURA", "Não foi possível ler a estimativa manual.");
    const pagina = paginaDoBanco(data, insumoId, antesDaRevisao, limite);
    if (!pagina) return falha("RESPOSTA_INVALIDA", "A leitura da estimativa não pôde ser confirmada.");
    const contexto = antesDaRevisao === null
      ? await contextoDeEdicao(cliente, insumoId)
      : { apresentacao: null, podeRegistrar: false };
    return { ok: true, ...pagina, ...contexto };
  } catch (error) {
    unstable_rethrow(error);
    return falha("FALHA_LEITURA", "Não foi possível ler a estimativa manual.");
  }
}

export async function registrarConsumoManual(
  _anterior: EstadoRegistroConsumoManual, form: FormData,
): Promise<ResultadoRegistroConsumoManual> {
  if (!escritaHabilitada()) return falha("ESCRITA_DESABILITADA", "O registro de estimativas manuais ainda não está habilitado.");
  if (!(form instanceof FormData)) return entradaInvalida();
  const args = parametros(form);
  if (!args) return entradaInvalida();
  try {
    const cliente = await createClientUntyped();
    const ator = await atorDaSessao(cliente);
    if (!ator) return falha("SESSAO_INVALIDA", "Entre novamente para registrar a estimativa.");
    if (!await podeEscrever(cliente)) return falha("SEM_ACESSO", "Esta função não pode registrar estimativas manuais.");
    const { data, error } = await cliente.rpc("registrar_consumo_manual_insumo", args);
    switch (error?.code) {
      case "42501": return falha("SEM_ACESSO", "Insumo indisponível ou registro não autorizado para esta sessão.");
      case "22023": return falha("APRESENTACAO_DIVERGENTE", "Confira novamente a apresentação cadastrada e os dados da estimativa.");
      case "40001": return falha("REVISAO_DIVERGENTE", "A revisão mudou. Recarregue a estimativa antes de salvar.");
      case "23505": return falha("OPERACAO_CONFLITANTE", "Esta operação já foi usada com outros dados. Recarregue a estimativa.");
    }
    if (error) return falha("FALHA_ESCRITA", "O registro não foi confirmado. Consulte o histórico antes de repetir.");
    const recibo = objeto(data);
    const r = revisaoDoBanco(recibo?.registro, args.p_insumo_id);
    if (!r || typeof recibo?.repetida !== "boolean" || r.revisao !== args.p_revisao_esperada + 1 ||
      r.ator_id.toLowerCase() !== ator || r.quantidade_embalagens_mes !== args.p_quantidade_embalagens_mes ||
      r.conteudo_embalagem !== args.p_conteudo_embalagem_esperado || r.unidade_conteudo !== args.p_unidade_conteudo_esperada ||
      r.fonte !== args.p_fonte || r.motivo !== args.p_motivo || r.data_referencia !== args.p_data_referencia) {
      return falha("RESPOSTA_INVALIDA", "O recibo não confirmou o registro. Consulte o histórico antes de repetir.");
    }
    return { ok: true, estado: recibo.repetida ? "repetida" : "registrada", registro: r };
  } catch (error) {
    unstable_rethrow(error);
    return falha("FALHA_ESCRITA", "O registro não foi confirmado. Consulte o histórico antes de repetir.");
  }
}
