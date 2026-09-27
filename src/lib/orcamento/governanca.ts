import "server-only";

import { temPapel, type Papel } from "@/lib/auth/roles";
import { temPermissao } from "@/lib/auth/permissao-efetiva";
import { PERMISSOES, type PermissaoUsuario } from "@/lib/auth/permissions";

export type AcaoOrcamento =
  | "criar_demanda"
  | "preencher_custos"
  | "recalcular_custos"
  | "revisar_modulo"
  | "editar_parametros"
  | "emitir_final"
  | "classificar_final"
  | "duplicar_final"
  | "cancelar_documento"
  | "acompanhar_fundos"
  | "gerir_modelos"
  | "ver_governanca";

export type PermissaoOrcamento = {
  acao: AcaoOrcamento;
  titulo: string;
  descricao: string;
  papelMinimo: Papel;
  /**
   * Permissão individual de /usuarios que também libera a ação ("papel OU
   * permissão", como em análises). null: só o papel. O banco aplica a mesma
   * regra nas RPCs de orçamento (migration 0121).
   */
  chave: PermissaoUsuario | null;
  motivoObrigatorio: boolean;
  eventoAuditavel: string;
};

export const LABEL_PAPEL: Record<Papel, string> = {
  tecnico: "Técnico",
  coordenador: "Coordenador",
  gestor: "Gestor",
  admin: "Administrador",
};

export const PERMISSOES_ORCAMENTO: PermissaoOrcamento[] = [
  {
    acao: "criar_demanda",
    chave: "orcamentos.criar_editar",
    titulo: "Criar orçamento",
    descricao: "Abrir um orçamento com os dados do cliente, das amostras e das análises.",
    papelMinimo: "tecnico",
    motivoObrigatorio: false,
    eventoAuditavel: "Registro do orçamento",
  },
  {
    acao: "preencher_custos",
    chave: "orcamentos.criar_editar",
    titulo: "Preencher custos",
    descricao: "Adicionar análises, custos de projeto, anexos e premissas operacionais.",
    papelMinimo: "tecnico",
    motivoObrigatorio: false,
    eventoAuditavel: "Auditoria de tabelas de custo",
  },
  {
    acao: "recalcular_custos",
    chave: "orcamentos.emitir",
    titulo: "Recalcular custos",
    descricao: "Atualizar snapshots com parâmetros e cadastros vigentes.",
    papelMinimo: "coordenador",
    motivoObrigatorio: true,
    eventoAuditavel: "Evento de recalculo",
  },
  {
    acao: "revisar_modulo",
    chave: "orcamentos.emitir",
    titulo: "Revisar módulo",
    descricao: "Mover módulo para enviado, aprovado ou etapa equivalente de revisão.",
    papelMinimo: "coordenador",
    motivoObrigatorio: false,
    eventoAuditavel: "Mudança de status",
  },
  {
    acao: "editar_parametros",
    chave: "orcamento.parametros.editar",
    titulo: "Editar parâmetros",
    descricao: "Alterar percentuais financeiros, gross-up e parâmetros globais.",
    papelMinimo: "gestor",
    motivoObrigatorio: false,
    eventoAuditavel: "Versão de parâmetros",
  },
  {
    acao: "emitir_final",
    chave: "orcamentos.emitir",
    titulo: "Emitir orçamento final",
    descricao: "Gerar proposta institucional com snapshot consolidado.",
    papelMinimo: "coordenador",
    motivoObrigatorio: false,
    eventoAuditavel: "Emissão final",
  },
  {
    acao: "classificar_final",
    chave: "orcamentos.emitir",
    titulo: "Classificar orçamento final",
    descricao: "Registrar se a proposta foi enviada, reenviada, aprovada ou recusada.",
    papelMinimo: "coordenador",
    motivoObrigatorio: false,
    eventoAuditavel: "Classificação comercial de versão final",
  },
  {
    acao: "duplicar_final",
    chave: "orcamentos.emitir",
    titulo: "Duplicar versão final",
    descricao: "Criar nova versão preservando a origem e substituindo a versão ativa.",
    papelMinimo: "coordenador",
    motivoObrigatorio: false,
    eventoAuditavel: "Duplicação de versão",
  },
  {
    acao: "cancelar_documento",
    chave: "orcamentos.cancelar",
    titulo: "Cancelar documento",
    descricao: "Cancelar orçamento, projeto ou versão final sem apagar histórico.",
    papelMinimo: "coordenador",
    motivoObrigatorio: true,
    eventoAuditavel: "Cancelamento com motivo",
  },
  {
    acao: "acompanhar_fundos",
    chave: "orcamentos.fundos",
    titulo: "Acompanhar fundos e taxas",
    descricao: "Registrar recebimentos, impostos pagos e execução de fundos de orçamentos emitidos.",
    papelMinimo: "gestor",
    motivoObrigatorio: false,
    eventoAuditavel: "Acompanhamento financeiro auditável",
  },
  {
    acao: "gerir_modelos",
    chave: "orcamentos.modelos",
    titulo: "Gerir modelos e catálogos",
    descricao: "Duplicar, arquivar e manter templates ou catálogo institucional.",
    papelMinimo: "gestor",
    motivoObrigatorio: false,
    eventoAuditavel: "Auditoria de template/catálogo",
  },
  {
    acao: "ver_governanca",
    chave: "auditoria.visualizar",
    titulo: "Ver governança",
    descricao: "Consultar matriz de permissões, eventos e alterações por campo.",
    papelMinimo: "gestor",
    motivoObrigatorio: false,
    eventoAuditavel: "Leitura restrita",
  },
];

export function permissaoOrcamento(acao: AcaoOrcamento) {
  const permissao = PERMISSOES_ORCAMENTO.find((item) => item.acao === acao);
  if (!permissao) throw new Error(`Ação de orçamento sem política: ${acao}`);
  return permissao;
}

/**
 * A caixinha manda (migration 0124): a ação exige a permissão efetiva da
 * pessoa. O papel só define a marcação inicial da categoria.
 */
export async function podeOrcamento(acao: AcaoOrcamento) {
  const permissao = permissaoOrcamento(acao);
  if (!permissao.chave) return temPapel(permissao.papelMinimo);
  return temPermissao(permissao.chave);
}

export async function exigirPapelOrcamento(acao: AcaoOrcamento) {
  if (await podeOrcamento(acao)) return;

  const permissao = permissaoOrcamento(acao);
  const rotulo = PERMISSOES.find((item) => item.key === permissao.chave)?.label;
  throw new Error(
    `Sem permissão para ${permissao.titulo.toLowerCase()}.${rotulo ? ` Peça ao administrador a permissão “${rotulo}” em Usuários.` : ""}`,
  );
}
