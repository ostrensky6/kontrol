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

export const ROTULO_ETAPA: Record<EtapaId, string> = {
  demanda: "Dados",
  laboratorio: "Orçamento laboratorial",
  projeto: "Custos do projeto",
  parametros: "Parâmetros econômicos",
  final: "Proposta final",
  historico: "Histórico e auditoria",
};

/** Etapas de trabalho, na ordem, para a modalidade (o histórico fica fora da sequência). */
export function etapasDoFluxo(modalidade?: string | null): EtapaId[] {
  const exigeAnalises = modalidadeExigeLaboratorio(modalidade);
  const exigeProjeto = modalidadeExigeProjeto(modalidade);
  return ORDEM_ETAPAS.filter(
    (id) => id !== "historico" && (id !== "laboratorio" || exigeAnalises) && (id !== "projeto" || exigeProjeto),
  );
}

/**
 * Etapa anterior e próxima da sequência, para a barra "← anterior · próxima →"
 * e para o avanço automático depois de salvar ou concluir uma etapa.
 * O histórico volta para a proposta final.
 */
export function vizinhasEtapa(
  modalidade: string | null | undefined,
  atual: EtapaId,
): { anterior: EtapaId | null; proxima: EtapaId | null } {
  const fluxo = etapasDoFluxo(modalidade);
  if (atual === "historico") return { anterior: "final", proxima: null };
  const i = fluxo.indexOf(atual);
  if (i < 0) return { anterior: null, proxima: fluxo[0] ?? null };
  return { anterior: fluxo[i - 1] ?? null, proxima: fluxo[i + 1] ?? null };
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
  // O tipo do orçamento decide as etapas (dono, 28/09): ligação com projeto não cria etapa de custos.
  const exigeProjeto = modalidadeExigeProjeto(args.modalidade);
  // Dados incompletos NÃO travam os custos (dono, 28/09): dá para fazer uma rodada de custos
  // antes de escrever escopo e descrição; os dados completos só são cobrados na emissão.
  const laboratorioLiberado = exigeAnalises;
  const projetoLiberado = exigeProjeto;
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
