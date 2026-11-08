type EscopoAviso = {
  equipamento_unidade_id: number;
  tipo: string;
};

type RegraAviso = EscopoAviso & {
  ocorrencia_id: number;
  data_referencia: string;
  antecedencia_dias: number;
};

type OrigemAviso = EscopoAviso & {
  id: number;
  status: string;
  proxima_data: string | null;
};

type AvisoGravado = {
  id: string;
  ocorrencia_id: number;
  regra_id: string;
  data_referencia: string;
  responsavel_id: string;
  aberto_em: string;
  estado: "pendente" | "reconhecido" | "encaminhado";
};

type Leitura<T> = { estado: "confirmada"; dado: T } | { estado: "indisponivel" };

export type LeituraAvisosEquipamento = EscopoAviso & {
  hoje_sp: string | null;
  regra: Leitura<RegraAviso | null>;
  origem: Leitura<OrigemAviso | null>;
  avisos: Leitura<readonly AvisoGravado[]>;
  permissoes?: {
    configurar?: boolean;
    reconhecer?: boolean;
    encaminhar?: boolean;
  };
};

function mesmoEscopo(a: EscopoAviso, b: EscopoAviso) {
  return a.equipamento_unidade_id === b.equipamento_unidade_id && a.tipo === b.tipo;
}

// UTC aqui representa apenas o ordinal de uma data civil, nunca o relógio da autorização.
function diaCivil(data: string | null) {
  if (typeof data !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  const instante = Date.parse(data + "T00:00:00Z");
  return Number.isFinite(instante) && new Date(instante).toISOString().slice(0, 10) === data
    ? instante / 86_400_000
    : null;
}

function indisponivel(motivo: "leitura" | "regra" | "origem" | "proxima_data_invalida" | "data_civil") {
  return { estado: "indisponivel", motivo } as const;
}

function referenciaAlterada(motivo: "origem_ausente" | "origem_divergente" | "origem_cancelada" | "proxima_data_nao_informada" | "proxima_data_alterada") {
  return { estado: "referencia_alterada", motivo } as const;
}

function avaliarJanela(escopo: EscopoAviso, leitura: LeituraAvisosEquipamento | null) {
  if (!leitura) return indisponivel("leitura");
  if (leitura.regra?.estado !== "confirmada") return indisponivel("regra");
  const regra = leitura.regra.dado;
  if (regra === null) return { estado: "nao_configurado" } as const;
  if (!regra || !mesmoEscopo(escopo, regra) ||
    !Number.isSafeInteger(regra.ocorrencia_id) || regra.ocorrencia_id <= 0 ||
    !Number.isSafeInteger(regra.antecedencia_dias) || regra.antecedencia_dias < 0) {
    return indisponivel("regra");
  }
  const referencia = diaCivil(regra.data_referencia);
  if (referencia === null) return indisponivel("regra");

  if (leitura.origem?.estado !== "confirmada") return indisponivel("origem");
  const origem = leitura.origem.dado;
  if (origem === null) return referenciaAlterada("origem_ausente");
  if (!origem || !mesmoEscopo(escopo, origem) || origem.id !== regra.ocorrencia_id) {
    return referenciaAlterada("origem_divergente");
  }
  if (origem.status === "cancelada") return referenciaAlterada("origem_cancelada");
  if (!origem.status) return indisponivel("origem");
  if (origem.proxima_data === null) return referenciaAlterada("proxima_data_nao_informada");
  if (diaCivil(origem.proxima_data) === null) return indisponivel("proxima_data_invalida");
  if (origem.proxima_data !== regra.data_referencia) return referenciaAlterada("proxima_data_alterada");

  const hoje = diaCivil(leitura.hoje_sp);
  if (hoje === null) return indisponivel("data_civil");
  return {
    estado: "janela_confirmada",
    na_janela: referencia - hoje <= regra.antecedencia_dias,
    ocorrencia_id: regra.ocorrencia_id,
    data_referencia: regra.data_referencia,
    antecedencia_dias: regra.antecedencia_dias,
  } as const;
}

/** Projeção da leitura RPC por escopo. hoje_sp vem do servidor em America/Sao_Paulo.
 * A janela não é autorização, abertura, conclusão nem condição de uso do equipamento.
 */
export function projetarAvisosEquipamento(escopo: EscopoAviso, resposta: LeituraAvisosEquipamento | null) {
  const leitura = resposta && mesmoEscopo(escopo, resposta) ? resposta : null;
  return {
    janela: avaliarJanela(escopo, leitura),
    avisos: leitura?.avisos?.estado === "confirmada" && Array.isArray(leitura.avisos.dado)
      ? leitura.avisos.dado
      : null,
    configuracao: leitura?.permissoes?.configurar === true ? "permitida" : "negada",
    pode_reconhecer: leitura?.permissoes?.reconhecer === true,
    pode_encaminhar: leitura?.permissoes?.encaminhar === true,
  } as const;
}
