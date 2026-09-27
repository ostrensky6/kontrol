import { itemProjetoTotal } from "@/lib/project-budget/orcamento-projeto";
import { criarResolvedorDeTaxas, valorLaboratorioNaProposta, valorProjetoNaProposta } from "@/lib/orcamento/valores-modulos";
import { createClient } from "@/lib/supabase/server";
import { hojeCalendario, statusEfetivoVersaoFinal } from "@/lib/orcamento/rotulos-status";
import type { OrcamentoRow } from "@/components/orcamento/OrcamentosTable";

const STATUS: Record<string, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado",
  alterado_reenviado: "Alterado e reenviado",
  aprovado: "Aprovado",
  recusado: "Recusado",
  rejeitado: "Rejeitado",
  cancelado: "Cancelado",
  emitido: "Emitido",
  substituido: "Substituído",
  vencido: "Vencido",
  convertido_projeto: "Convertido em projeto",
};

const TIPO = {
  analises: "Só análises",
  projeto: "Só projeto",
  analises_projeto: "Análises + projeto",
} as const;

const MODALIDADE_TIPO: Record<string, keyof typeof TIPO> = {
  analises: "analises",
  projeto: "projeto",
  projeto_com_analises: "analises_projeto",
  analises_projeto: "analises_projeto",
  projeto_analises_custos: "analises_projeto",
};

type ItemAnalise = { n_amostras: number; custo_unitario?: number; preco_unitario: number };
type CustoProjeto = {
  rubrica: string | null;
  quantidade: number;
  custo_unitario?: number;
  preco_unitario: number;
  meses_selecionados: number[] | null;
};

type Demanda = {
  id: number;
  modalidade: string;
  titulo?: string | null;
  cliente_nome?: string | null;
  responsavel_interno?: string | null;
};

export type OrcamentoFila = OrcamentoRow & {
  origem: "laboratorio" | "projeto" | "final";
  grupo: "em_elaboracao" | "revisao" | "emitidos" | "decididos";
  criadoEm: string;
  demandaId: number | null;
};

export async function carregarLinhasOrcamentos(): Promise<OrcamentoFila[]> {
  const supabase = await createClient();
  const [
    { data: orcamentos },
    { data: orcProjetos },
    { data: projetos },
    { data: demandas },
    { data: versoesFinais },
    { data: parametrosGlobais },
  ] =
    await Promise.all([
      supabase
        .from("orcamentos")
        .select(
          "id, tipo, demanda_id, cliente_nome, data_orcamento, status, status_operacional, status_operacional_atualizado_em, criado_em, projeto_id, responsavel, orcamento_itens(n_amostras, custo_unitario, preco_unitario)",
        )
        .order("criado_em", { ascending: false }),
      supabase
        .from("orcamento_projetos")
        .select(
          "id, demanda_id, titulo, cliente_nome, data_orcamento, status, projeto_id, responsavel, margem_lucro, impostos, impostos_legacy, incubacao, reserva, investimentos, lucro, criado_em, orcamento_projeto_analises(n_amostras, custo_unitario, preco_unitario), orcamento_projeto_custos(rubrica, quantidade, custo_unitario, preco_unitario, meses_selecionados)",
        )
        .order("criado_em", { ascending: false }),
      supabase.from("projetos").select("id, nome").order("nome"),
      supabase
        .from("demandas_propostas")
        .select("id, modalidade, titulo, cliente_nome, responsavel_interno, param_impostos, param_incubacao, param_reserva, param_investimentos, param_lucro"),
      supabase
        .from("orcamento_final_versoes")
        .select("id, demanda_id, versao, numero, status, valido_ate, total_final, criado_em, criado_por")
        .order("criado_em", { ascending: false }),
      supabase.from("parametros").select("chave, valor"),
    ]);

  const projetoNome = new Map((projetos ?? []).map((p) => [p.id, p.nome]));
  const demandaPorId = new Map((demandas ?? []).map((d) => [d.id, d as Demanda]));
  const modalidadePorDemanda = new Map((demandas ?? []).map((d) => [d.id, d.modalidade]));
  // valores pela mesma regra da emissão (custo técnico + gross-up único com as taxas da proposta)
  const taxasDa = criarResolvedorDeTaxas({ projetos: orcProjetos, demandas, parametrosGlobais });
  // ORC2-5: a situação comercial vem da versão da proposta, não do status do
  // módulo (aprovar pela equipe não mexe nos módulos; pelo link, sim).
  const hoje = hojeCalendario();
  const situacaoProposta = situacaoPorProposta(versoesFinais ?? [], hoje);

  const linhasAnalises: OrcamentoFila[] = (orcamentos ?? []).map((o) => {
    const itens = (o.orcamento_itens as ItemAnalise[]) ?? [];
    const total = valorLaboratorioNaProposta(itens, taxasDa(o.demanda_id));
    const demanda = o.demanda_id ? demandaPorId.get(o.demanda_id) : null;
    const statusOperacional = o.status_operacional ?? (itens.length > 0 ? "preenchido" : "pendente");
    return {
      key: `analises-${o.id}`,
      href: `/orcamento/${o.id}`,
      titulo: `Laboratório ${o.id}`,
      cliente: o.cliente_nome ?? demanda?.cliente_nome ?? "Cliente sem nome",
      projeto: o.projeto_id != null ? projetoNome.get(o.projeto_id) ?? "—" : "—",
      data: o.data_orcamento ?? "—",
      tipo: (o.tipo ?? "analises") as keyof typeof TIPO,
      tipoLabel: TIPO[((o.tipo ?? "analises") as keyof typeof TIPO)] ?? TIPO.analises,
      analises: itens.length,
      custosProjeto: 0,
      total,
      status: o.status,
      statusLabel: STATUS[o.status] ?? o.status,
      etapaAtual: etapaLaboratorio(o.status, statusOperacional),
      responsavel: o.responsavel ?? demanda?.responsavel_interno ?? "—",
      atualizadoEm: o.status_operacional_atualizado_em ?? o.criado_em,
      proximaAcao: proximaAcaoLaboratorio(o.status, statusOperacional),
      origem: "laboratorio",
      grupo: grupoDocumento(o.status, etapaLaboratorio(o.status, statusOperacional)),
      ...(o.status !== "cancelado" && o.demanda_id != null ? situacaoProposta.get(o.demanda_id) : undefined),
      criadoEm: o.criado_em,
      demandaId: o.demanda_id ?? null,
    };
  });

  const linhasProjeto: OrcamentoFila[] = (orcProjetos ?? []).map((o) => {
    const analises = (o.orcamento_projeto_analises as ItemAnalise[]) ?? [];
    const custos = (o.orcamento_projeto_custos as CustoProjeto[]) ?? [];
    const totalProjeto = valorProjetoNaProposta({ custos, analises }, taxasDa(o.demanda_id, o));
    const demanda = o.demanda_id ? demandaPorId.get(o.demanda_id) : null;
    const tipoDaDemanda = o.demanda_id != null ? MODALIDADE_TIPO[modalidadePorDemanda.get(o.demanda_id) ?? ""] : undefined;
    const tipo = tipoDaDemanda ?? (analises.length > 0 ? "analises_projeto" : "projeto");
    const etapaAtual = etapaProjeto(o.status, custos.length + analises.length);
    return {
      key: `projeto-${o.id}`,
      href: o.demanda_id != null ? `/orcamento/demandas/${o.demanda_id}?etapa=projeto` : `/orcamento/projetos/${o.id}`,
      titulo: o.titulo ?? `Projeto ${o.id}`,
      cliente: o.cliente_nome ?? demanda?.cliente_nome ?? "Cliente sem nome",
      projeto: o.projeto_id != null ? projetoNome.get(o.projeto_id) ?? "—" : "—",
      data: o.data_orcamento ?? "—",
      tipo,
      tipoLabel: TIPO[tipo],
      analises: analises.length,
      custosProjeto: custos.reduce(
        (a, it) => a + itemProjetoTotal({ ...it, preco_unitario: Number(it.custo_unitario ?? it.preco_unitario ?? 0) }),
        0,
      ),
      total: totalProjeto,
      status: o.status,
      statusLabel: STATUS[o.status] ?? o.status,
      etapaAtual,
      responsavel: o.responsavel ?? demanda?.responsavel_interno ?? "—",
      atualizadoEm: o.criado_em,
      proximaAcao: etapaAtual === "Custos pendentes" ? "Preencher custos" : etapaAtual === "Pronto para revisão" ? "Revisar projeto" : "Abrir",
      origem: "projeto",
      grupo: grupoDocumento(o.status, etapaAtual),
      ...(o.status !== "cancelado" && o.demanda_id != null ? situacaoProposta.get(o.demanda_id) : undefined),
      criadoEm: o.criado_em,
      demandaId: o.demanda_id ?? null,
    };
  });

  const linhasFinais: OrcamentoFila[] = (versoesFinais ?? []).map((versao) => {
    const v = { ...versao, status: statusEfetivoVersaoFinal(versao, hoje) };
    const demanda = demandaPorId.get(v.demanda_id);
    return {
      key: `final-${v.id}`,
      href: `/orcamento/final/${v.id}`,
      titulo: v.numero,
      cliente: demanda?.cliente_nome ?? "Cliente sem nome",
      projeto: "—",
      data: v.valido_ate ?? "—",
      tipo: (MODALIDADE_TIPO[demanda?.modalidade ?? ""] ?? "analises_projeto"),
      tipoLabel: TIPO[MODALIDADE_TIPO[demanda?.modalidade ?? ""] ?? "analises_projeto"],
      analises: 0,
      custosProjeto: 0,
      total: Number(v.total_final ?? 0),
      status: v.status,
      statusLabel: STATUS[v.status] ?? v.status,
      etapaAtual: ["emitido", "enviado", "alterado_reenviado"].includes(v.status)
        ? "Proposta ativa"
        : v.status === "vencido" ? "Vencido" : "Histórico",
      responsavel: demanda?.responsavel_interno ?? v.criado_por ?? "—",
      atualizadoEm: v.criado_em,
      proximaAcao: ["emitido", "enviado", "alterado_reenviado"].includes(v.status) ? "Acompanhar retorno" : "Abrir histórico",
      origem: "final",
      grupo: ["emitido", "enviado", "alterado_reenviado", "vencido"].includes(v.status) ? "emitidos" : "decididos",
      criadoEm: v.criado_em,
      demandaId: v.demanda_id ?? null,
    };
  });

  return [...linhasAnalises, ...linhasProjeto, ...linhasFinais].sort(
    (a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime(),
  );
}

type SituacaoProposta = Pick<OrcamentoFila, "etapaAtual" | "grupo" | "proximaAcao">;

/** Situação comercial de cada proposta pela versão: aprovada vigente, ou emitida viva. */
export function situacaoPorProposta(
  versoes: Array<{ demanda_id: number; status: string; valido_ate?: string | null }>,
  hoje: string,
): Map<number, SituacaoProposta> {
  const situacao = new Map<number, SituacaoProposta>();
  for (const versao of versoes) {
    const status = statusEfetivoVersaoFinal(versao, hoje);
    if (["aprovado", "convertido_projeto"].includes(status)) {
      situacao.set(versao.demanda_id, { etapaAtual: "Proposta aprovada", grupo: "decididos", proximaAcao: "Abrir proposta" });
    } else if (["emitido", "enviado", "alterado_reenviado"].includes(status) && !situacao.has(versao.demanda_id)) {
      situacao.set(versao.demanda_id, { etapaAtual: "Proposta emitida", grupo: "emitidos", proximaAcao: "Acompanhar retorno" });
    }
  }
  return situacao;
}

function etapaLaboratorio(status: string, statusOperacional: string) {
  if (status === "cancelado") return "Cancelado";
  if (["aprovado", "recusado"].includes(status)) return "Decidido";
  if (["enviado"].includes(status) || statusOperacional === "revisado") return "Pronto para revisão";
  if (statusOperacional === "preenchido") return "Custos preenchidos";
  return "Custos pendentes";
}

function etapaProjeto(status: string, quantidadeItens: number) {
  if (status === "cancelado") return "Cancelado";
  if (["aprovado", "recusado"].includes(status)) return "Decidido";
  if (status === "enviado") return "Pronto para revisão";
  if (quantidadeItens > 0) return "Custos preenchidos";
  return "Custos pendentes";
}

function grupoDocumento(status: string, etapaAtual: string): OrcamentoFila["grupo"] {
  if (["aprovado", "recusado", "cancelado"].includes(status)) return "decididos";
  if (status === "enviado" || etapaAtual === "Pronto para revisão") return "revisao";
  return "em_elaboracao";
}

function proximaAcaoLaboratorio(status: string, statusOperacional: string) {
  if (status === "cancelado") return "Abrir histórico";
  if (["enviado", "aprovado"].includes(status) || statusOperacional === "revisado") return "Revisar laboratório";
  if (statusOperacional === "preenchido") return "Conferir custos";
  return "Adicionar análises";
}
