import { modalidadeExigeLaboratorio, modalidadeExigeProjeto } from "./orcamento-economico";

export type EtapaId = "demanda" | "laboratorio" | "projeto" | "parametros" | "final" | "historico";

export type EstadoEtapa = "ativo" | "concluido" | "pendente" | "bloqueado" | "pulado";

export const ORDEM_ETAPAS: EtapaId[] = [
  "demanda",
  "laboratorio",
  "projeto",
  "parametros",
  "final",
  "historico",
];

/** Modelo único de etapa da proposta (Fase 2.6). */
export type EtapaProposta = {
  id: EtapaId;
  label: string;
  estado: EstadoEtapa;
  status: string;
  aplicavel: boolean;
  obrigatoria: boolean;
  href: string;
};

type StatusModulo = "pendente" | "preenchido" | "revisado" | "nao_exigido";

export type EntradaEtapasProposta = {
  demandaId: number;
  modalidade?: string | null;
  /** Projeto vinculado força a etapa de projeto mesmo em modalidade só de análises. */
  projetoAssociado?: boolean;
  demandaCompleta: boolean;
  demandaFaltante: number;
  laboratorioStatus: StatusModulo;
  laboratorioLabel: string;
  projetoStatus: StatusModulo;
  projetoLabel: string;
  parametrosLiberados: boolean;
  orcamentoFinalPronto: boolean;
  versoesFinais: number;
};

function hrefEtapa(demandaId: number, id: EtapaId) {
  return `/orcamento/demandas/${demandaId}?etapa=${id}`;
}

/**
 * Fonte única de etapas da proposta. Substitui o antigo `calcularFluxoDemanda` e
 * a versão anterior (apenas `modalidade`) deste arquivo. A determinação de
 * modalidade delega para os helpers autoritativos de `orcamento-economico.ts`,
 * de modo que a forma canônica `projeto_com_analises` é reconhecida em todas as
 * camadas.
 */
export function montarEtapasProposta(args: EntradaEtapasProposta): EtapaProposta[] {
  const exigeAnalises = modalidadeExigeLaboratorio(args.modalidade);
  const exigeProjeto = modalidadeExigeProjeto(args.modalidade) || Boolean(args.projetoAssociado);
  const laboratorioLiberado = args.demandaCompleta && exigeAnalises;
  const projetoLiberado = args.demandaCompleta && exigeProjeto;
  // Sequenciamento: quando a modalidade exige análises, o laboratório precisa
  // sair de "pendente" antes de o orçamento de projeto ficar ativo.
  const laboratorioBloqueiaProjeto = exigeAnalises && args.laboratorioStatus === "pendente";

  const etapas: EtapaProposta[] = [
    {
      id: "demanda",
      label: "Dados",
      estado: args.demandaCompleta ? "concluido" : "ativo",
      status: args.demandaCompleta ? "Completa" : `${args.demandaFaltante}% faltante`,
      aplicavel: true,
      obrigatoria: true,
      href: hrefEtapa(args.demandaId, "demanda"),
    },
    {
      id: "laboratorio",
      label: "Orçamento laboratorial",
      estado: !exigeAnalises
        ? "pulado"
        : !laboratorioLiberado
          ? "bloqueado"
          : args.laboratorioStatus === "pendente"
            ? "ativo"
            : "concluido",
      status: exigeAnalises ? args.laboratorioLabel : "Pulado",
      aplicavel: exigeAnalises,
      obrigatoria: exigeAnalises,
      href: hrefEtapa(args.demandaId, "laboratorio"),
    },
    {
      id: "projeto",
      label: "Custos do projeto",
      estado: !exigeProjeto
        ? "pulado"
        : !projetoLiberado
          ? "bloqueado"
          : laboratorioBloqueiaProjeto
            ? "bloqueado"
            : args.projetoStatus === "pendente"
              ? "ativo"
              : "concluido",
      status: exigeProjeto ? args.projetoLabel : "Pulado",
      aplicavel: exigeProjeto,
      obrigatoria: exigeProjeto,
      href: hrefEtapa(args.demandaId, "projeto"),
    },
    {
      id: "parametros",
      label: "Parâmetros econômicos",
      estado: args.parametrosLiberados ? "pendente" : "bloqueado",
      status: args.parametrosLiberados ? "Liberado" : "Bloqueado",
      aplicavel: true,
      obrigatoria: true,
      href: hrefEtapa(args.demandaId, "parametros"),
    },
    {
      id: "final",
      label: "Proposta final",
      estado: args.orcamentoFinalPronto ? "pendente" : "bloqueado",
      status: args.orcamentoFinalPronto ? "Pronto" : "Bloqueado",
      aplicavel: true,
      obrigatoria: true,
      href: hrefEtapa(args.demandaId, "final"),
    },
    {
      id: "historico",
      label: "Histórico e auditoria",
      estado: "pendente",
      status: `${args.versoesFinais} versão(ões)`,
      aplicavel: true,
      obrigatoria: false,
      href: hrefEtapa(args.demandaId, "historico"),
    },
  ];

  return etapas;
}
