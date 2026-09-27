import { modalidadeExigeLaboratorio, modalidadeExigeProjeto } from "./orcamento-economico";

export type DemandaCompletudeInput = {
  titulo?: string | null;
  cliente_id?: number | null;
  cliente_nome?: string | null;
  modalidade?: string | null;
  projeto_id?: number | null;
  descricao?: string | null;
  escopo_preliminar?: string | null;
  matriz_amostra?: string | null;
  quantidade_amostras_estimada?: number | null;
  prazo_tecnico_dias?: number | null;
};

function preenchido(valor: unknown) {
  return typeof valor === "string" ? valor.trim().length > 0 : Boolean(valor);
}

export function avaliarCompletudeDemanda(demanda: DemandaCompletudeInput) {
  const pendencias: string[] = [];
  const modalidade = demanda.modalidade || "analises";
  const criterios: boolean[] = [];

  criterios.push(preenchido(demanda.titulo));
  if (!criterios.at(-1)) {
    pendencias.push("informar o título");
  }

  criterios.push(Boolean(demanda.cliente_id || preenchido(demanda.cliente_nome)));
  if (!criterios.at(-1)) {
    pendencias.push("informar o cliente (cadastrado ou pelo nome)");
  }

  criterios.push(preenchido(modalidade));
  if (!criterios.at(-1)) {
    pendencias.push("confirmar a modalidade");
  }

  criterios.push(Boolean(preenchido(demanda.escopo_preliminar) || preenchido(demanda.descricao)));
  if (!criterios.at(-1)) {
    pendencias.push("descrever o escopo ou a descrição");
  }

  if (modalidadeExigeProjeto(modalidade)) {
    criterios.push(Boolean(demanda.projeto_id));
    if (!criterios.at(-1)) {
      pendencias.push("vincular um projeto para modalidades com projeto");
    }
  }

  if (modalidadeExigeLaboratorio(modalidade)) {
    criterios.push(preenchido(demanda.matriz_amostra));
    if (!criterios.at(-1)) {
      pendencias.push("informar matriz ou tipo de amostra");
    }

    criterios.push(Number(demanda.quantidade_amostras_estimada ?? 0) > 0);
    if (!criterios.at(-1)) {
      pendencias.push("informar quantidade estimada de amostras");
    }
  }

  const faltantes = criterios.filter((criterio) => !criterio).length;

  return {
    completa: pendencias.length === 0,
    faltante: Math.round((faltantes / criterios.length) * 100),
    pendencias,
  };
}
