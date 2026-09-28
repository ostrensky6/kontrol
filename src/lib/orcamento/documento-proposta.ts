// Modelo ÚNICO do documento do cliente (A4 retrato, 28/09): a página da
// proposta, a prévia da elaboração, o link público e o DOCX leem daqui.
// Nunca carrega custo, percentual, parâmetro ou código de rubrica.
import { roundMoney } from "@/lib/costing/pricing";
import { formatDate } from "@/lib/formatters";
import { empresaPadrao, type EmpresaEmissora } from "./empresas-emissoras";
import { resolverIdentidadeComAviso, type IdentidadeInstitucional } from "./identidade-institucional";
import { rotuloModalidade } from "./orcamento-economico";
import { rotuloStatusVersaoFinal, statusEfetivoVersaoFinal } from "./rotulos-status";
import type { DocTexto } from "./texto-rico";
import { secoesImprimiveis, type TextosProposta } from "./textos-proposta";
import { formatarQuantidade, type GrupoCustoId, type VisaoInterna } from "./visao-interna";

export type VersaoDoc = {
  numero: string;
  versao: number;
  status: string;
  criado_em?: string | null;
  valido_ate?: string | null;
  validade_dias?: number | null;
  total_final?: number | null;
};

export type DemandaDoc = {
  titulo?: string | null;
  instituicao?: string | null;
  modalidade?: string | null;
  cliente_nome?: string | null;
  cliente_cnpj?: string | null;
  cliente_contato?: string | null;
  cliente_email?: string | null;
  cliente_telefone?: string | null;
  cliente_endereco?: string | null;
  matriz_amostra?: string | null;
  quantidade_amostras_estimada?: number | null;
  prazo_tecnico_dias?: number | null;
} | null;

export type ItemServico = { descricao: string; quantidade: string; valorUnitario: number; valorTotal: number };
export type GrupoServico = { id: GrupoCustoId; titulo: string; itens: ItemServico[]; subtotal: number };
export type SecaoDocumento = {
  numero: number;
  chave: string;
  titulo: string;
  linhasAutomaticas: string[];
  texto: DocTexto | null;
};

export type ModeloDocumentoProposta = {
  identidade: IdentidadeInstitucional;
  empresa: EmpresaEmissora;
  rascunho: boolean;
  numero: string;
  versao: number;
  statusRotulo: string;
  emitidoEm: string | null;
  validoAte: string | null;
  validadeDias: number | null;
  cliente: {
    nome: string;
    documento: string | null;
    endereco: string | null;
    contato: string | null;
    email: string | null;
    telefone: string | null;
  };
  resumo: { total: number; prazoDias: number | null; amostras: number | null };
  objeto: { titulo: string; modalidade: string | null; descricao: DocTexto | null };
  escopo: { matriz: string | null; amostras: number | null; analises: string[]; prazoDias: number | null } | null;
  servicos: { grupos: GrupoServico[]; total: number };
  secoes: SecaoDocumento[];
  numeracao: { objeto: number; escopo: number | null; servicos: number; aceite: number };
  /** avisos para a equipe (não vão ao papel) */
  avisos: string[];
};

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const inteiroPositivo = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function linhaValidade(dias: number | null, validoAte: string | null) {
  if (!dias && !validoAte) return null;
  const ate = validoAte ? ` (até ${formatDate(validoAte)})` : "";
  return dias
    ? `Validade da proposta: ${dias} dias a partir da emissão${ate}.`
    : `Validade da proposta: até ${formatDate(validoAte)}.`;
}

export function montarDocumentoProposta(args: {
  versao: VersaoDoc;
  demanda: DemandaDoc;
  visao: VisaoInterna;
  textos: TextosProposta;
  empresa: EmpresaEmissora | null;
  rascunho?: boolean;
}): ModeloDocumentoProposta {
  const { versao, demanda, visao, textos } = args;
  const rascunho = Boolean(args.rascunho);
  const { identidade, aviso } = resolverIdentidadeComAviso(demanda?.instituicao);
  const empresa = args.empresa ?? empresaPadrao(identidade);
  const validadeDias = inteiroPositivo(versao.validade_dias);
  const validoAte = rascunho ? null : versao.valido_ate ?? null;

  const servicos: GrupoServico[] = visao.grupos.map((grupo) => ({
    id: grupo.id,
    titulo: grupo.rotuloCliente,
    subtotal: grupo.naProposta,
    itens: grupo.itens.map((item) => ({
      // item sem descrição congelada: o nome do grupo basta ao cliente
      descricao: item.descricaoAusente ? grupo.rotuloCliente : item.descricao,
      quantidade: formatarQuantidade(item.quantidade, item.unidade),
      valorUnitario: item.quantidade > 0 ? roundMoney(item.naProposta / item.quantidade) : item.naProposta,
      valorTotal: item.naProposta,
    })),
  }));

  const analises = [
    ...new Set(
      visao.grupos
        .filter((g) => g.id === "laboratorio" || g.id === "analises_projeto")
        .flatMap((g) => g.itens)
        .map((i) => (i.codigo && i.descricao !== i.codigo ? `${i.descricao} (${i.codigo})` : i.descricao)),
    ),
  ];
  const escopoBase = {
    matriz: texto(demanda?.matriz_amostra),
    amostras: inteiroPositivo(demanda?.quantidade_amostras_estimada),
    analises,
    prazoDias: inteiroPositivo(demanda?.prazo_tecnico_dias),
  };
  const temEscopo = Boolean(escopoBase.matriz || escopoBase.amostras || escopoBase.prazoDias || analises.length);

  const numeroEscopo = temEscopo ? 2 : null;
  const numeroServicos = temEscopo ? 3 : 2;
  const validade = linhaValidade(validadeDias, validoAte);
  const secoes: SecaoDocumento[] = secoesImprimiveis(textos).map((secao, i) => ({
    numero: numeroServicos + 1 + i,
    chave: secao.chave,
    titulo: secao.titulo,
    linhasAutomaticas: secao.chave === "prazos" && validade ? [validade] : [],
    texto: secao.texto,
  }));

  const avisos: string[] = [];
  if (aviso) avisos.push(aviso);
  if (!empresa.cnpj || !empresa.endereco) {
    avisos.push("CNPJ ou endereço da empresa emissora em branco: preencha em Orçamentos › Documento da proposta.");
  }

  return {
    identidade,
    empresa,
    rascunho,
    numero: rascunho ? "Prévia" : versao.numero,
    versao: versao.versao,
    statusRotulo: rascunho
      ? "Prévia, ainda não emitida"
      : rotuloStatusVersaoFinal(statusEfetivoVersaoFinal({ status: versao.status, valido_ate: versao.valido_ate })),
    emitidoEm: rascunho ? null : versao.criado_em ?? null,
    validoAte,
    validadeDias,
    cliente: {
      nome: texto(demanda?.cliente_nome) ?? "—",
      documento: texto(demanda?.cliente_cnpj),
      endereco: texto(demanda?.cliente_endereco),
      contato: texto(demanda?.cliente_contato),
      email: texto(demanda?.cliente_email),
      telefone: texto(demanda?.cliente_telefone),
    },
    resumo: { total: visao.total, prazoDias: escopoBase.prazoDias, amostras: escopoBase.amostras },
    objeto: {
      titulo: texto(demanda?.titulo) ?? "Proposta comercial",
      modalidade: demanda?.modalidade ? rotuloModalidade(demanda.modalidade) : null,
      descricao: textos.descricao,
    },
    escopo: temEscopo ? escopoBase : null,
    servicos: { grupos: servicos, total: visao.total },
    secoes,
    numeracao: { objeto: 1, escopo: numeroEscopo, servicos: numeroServicos, aceite: numeroServicos + secoes.length + 1 },
    avisos,
  };
}
