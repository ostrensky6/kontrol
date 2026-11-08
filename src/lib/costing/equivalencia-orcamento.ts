import "server-only";
import {
  calcularAnaliseOrcamento, consumoInsumo, gargalo, reagentesTotal,
  type BreakdownOrcamento, type Etapa, type InsumoLinha,
} from "./engine";

type Dimensao = {
  unidade_estoque: string;
  unidade_consumo: string;
  fator_conversao: number | null;
};

type Alternativa = Dimensao & {
  insumo_id: number;
  apresentacao_ref: string;
  custo_unitario_estoque: number | null;
  fonte_custo: string | null;
  referencia_custo: string | null;
};

type DecisaoEfetiva = Dimensao & {
  codigo_analise: string;
  necessidade_id: number;
  etapa_id: number | null;
  metodo_revisao_ref: string;
  equipamento_ref: string | null;
  insumo_id: number;
  apresentacao_ref: string;
  decisao_ref: string;
  evidencia_ref: string;
  validador_id: string;
  papel_validador: "laboratorio" | "coordenador" | "supervisor";
  estado: "validada" | "revogada" | "reprovada";
  vigente_desde: number;
  vigente_ate: number | null;
};

type Necessidade = {
  id: number;
  etapa_id: number | null;
  equipamento_ref: string | null;
  quantidade_por_base: number;
  modo_cobranca: "por_amostra" | "por_execucao";
  unidade_consumo: string;
  alternativas: Alternativa[];
};

/** Contrato interno: somente um adaptador servidor/DB confiável pode montar esta entrada. */
export type EntradaEquivalencia = Omit<Parameters<typeof calcularAnaliseOrcamento>[0], "insumos" | "cenario" | "etapas"> & {
  versao: "equivalencia-contextual-v1";
  metodo_revisao_ref: string;
  instante: number; // epoch em ms, da operação servidor
  loteAmostras?: number;
  etapas: (Etapa & { id: number })[];
  necessidades: Necessidade[]; // conjunto confirmado; [] significa nenhuma necessidade
  decisoes: DecisaoEfetiva[]; // uma revisão efetiva por combinação, incluindo revogação
};

type Pendencia = {
  necessidade_id?: number;
  insumo_id?: number;
  motivo: "contexto_incompleto" | "sem_validacao_ativa" | "decisao_ambigua"
    | "dimensao_nao_comprovada" | "preco_nao_comprovado" | "quantidade_nao_comprovada";
};

type Selecao = {
  necessidade_id: number;
  etapa_id: number | null;
  insumo_id: number;
  apresentacao_ref: string;
  decisao_ref: string;
  evidencia_ref: string;
  quantidade_consumo: number;
  quantidade_estoque: number;
  custo_total_insumo: number;
};

type Resultado = { versao: EntradaEquivalencia["versao"] } & (
  | { estado: "pendente"; pendencias: Pendencia[] }
  | { estado: "calculado"; calculo: BreakdownOrcamento; selecao: Selecao[] }
);

const texto = (x: unknown): x is string => typeof x === "string" && x.trim() !== "";
const positivo = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const id = (x: unknown): x is number => positivo(x) && Number.isSafeInteger(x);
const vigente = (d: DecisaoEfetiva, instante: number) =>
  d.estado === "validada" && texto(d.decisao_ref) && texto(d.evidencia_ref) && texto(d.validador_id)
  && ["laboratorio", "coordenador", "supervisor"].includes(d.papel_validador)
  && Number.isFinite(d.vigente_desde) && d.vigente_desde <= instante
  && (d.vigente_ate === null || (Number.isFinite(d.vigente_ate) && d.vigente_ate > instante));

/** Opt-in exclusivo de orçamento novo; não aceita escolha de grupo como prova técnica. */
export function calcularOrcamentoEquivalencia(args: EntradaEquivalencia): Resultado {
  const versao = "equivalencia-contextual-v1";
  const pendencias: Pendencia[] = [];
  const pendente = (): Resultado => ({ versao, estado: "pendente", pendencias });
  if (args.versao !== versao || !texto(args.codigo) || !texto(args.metodo_revisao_ref)
    || !Number.isFinite(args.instante) || !id(args.numeroAmostras)
    || (args.loteAmostras !== undefined && !id(args.loteAmostras))
    || !Array.isArray(args.etapas) || !Array.isArray(args.necessidades) || !Array.isArray(args.decisoes)) {
    pendencias.push({ motivo: "contexto_incompleto" });
    return pendente();
  }

  const loteGeral = args.loteAmostras ?? gargalo(args.etapas).amostrasPorExecucao;
  const insumos: InsumoLinha[] = [];
  const lotes = new Map<InsumoLinha, number>();
  const selecao: Selecao[] = [];
  const necessidadesVistas = new Set<number>();

  for (const n of args.necessidades) {
    const etapa = n.etapa_id === null ? [] : args.etapas.filter((e) => e.id === n.etapa_id);
    if (!id(n.id) || necessidadesVistas.has(n.id)
      || (n.etapa_id !== null && (!id(n.etapa_id) || etapa.length !== 1))
      || (n.equipamento_ref !== null && !texto(n.equipamento_ref))
      || !texto(n.unidade_consumo) || !Array.isArray(n.alternativas)) {
      pendencias.push({ necessidade_id: n.id, motivo: "contexto_incompleto" });
      continue;
    }
    necessidadesVistas.add(n.id);
    const lote = etapa[0] ? etapa[0].amostras_por_execucao : loteGeral;
    if (!positivo(n.quantidade_por_base)
      || (n.modo_cobranca !== "por_amostra" && n.modo_cobranca !== "por_execucao")
      || (n.modo_cobranca === "por_execucao" && !id(lote))) {
      pendencias.push({ necessidade_id: n.id, motivo: "quantidade_nao_comprovada" });
      continue;
    }
    let maior: { linha: InsumoLinha; rastro: Selecao } | undefined;
    const opcoesVistas = new Set<string>();
    const pendenciasAntes = pendencias.length;
    const decisoesContexto = args.decisoes.filter((d) =>
      d.codigo_analise === args.codigo && d.necessidade_id === n.id && d.etapa_id === n.etapa_id
      && d.metodo_revisao_ref === args.metodo_revisao_ref && d.equipamento_ref === n.equipamento_ref,
    );
    const skusRecebidos = new Set(n.alternativas.map((a) => a.insumo_id));
    for (const d of decisoesContexto) {
      if (vigente(d, args.instante) && !skusRecebidos.has(d.insumo_id)) {
        pendencias.push({ necessidade_id: n.id, insumo_id: d.insumo_id, motivo: "contexto_incompleto" });
      }
    }

    for (const a of n.alternativas) {
      const chave = `${a.insumo_id}:${a.apresentacao_ref}`;
      const recusar = (motivo: Pendencia["motivo"]) =>
        pendencias.push({ necessidade_id: n.id, insumo_id: a.insumo_id, motivo });
      if (!id(a.insumo_id) || !texto(a.apresentacao_ref) || opcoesVistas.has(chave)) {
        recusar("contexto_incompleto");
        continue;
      }
      opcoesVistas.add(chave);
      const correspondentes = decisoesContexto.filter((d) =>
        d.insumo_id === a.insumo_id && d.apresentacao_ref === a.apresentacao_ref,
      );
      if (correspondentes.length > 1) {
        recusar("decisao_ambigua");
        continue;
      }
      const [d] = correspondentes;
      if (!d || !vigente(d, args.instante)) continue;

      const fator = a.fator_conversao;
      if (!positivo(fator) || !texto(a.unidade_estoque) || a.unidade_consumo !== n.unidade_consumo
        || d.fator_conversao !== fator || d.unidade_estoque !== a.unidade_estoque
        || d.unidade_consumo !== a.unidade_consumo) {
        recusar("dimensao_nao_comprovada");
        continue;
      }
      const bruto = a.custo_unitario_estoque;
      if (typeof bruto !== "number" || !Number.isFinite(bruto) || bruto < 0
        || !texto(a.fonte_custo) || !texto(a.referencia_custo)) {
        recusar("preco_nao_comprovado");
        continue;
      }
      const normalizado = bruto / fator;
      if (!Number.isFinite(normalizado) || (bruto > 0 && normalizado === 0)) {
        recusar("preco_nao_comprovado");
        continue;
      }
      const linha: InsumoLinha = {
        nome_etapa: etapa[0]?.nome_etapa ?? "", nome_atividade: etapa[0]?.nome_atividade ?? "",
        especificacao_insumo: null, grupo_escolha: null,
        quantidade_por_amostra: n.quantidade_por_base, modo_cobranca: n.modo_cobranca,
        insumo_id: a.insumo_id, unidade_estoque: a.unidade_estoque, unidade_consumo: a.unidade_consumo,
        fator_conversao: fator, fonte_custo: a.fonte_custo, referencia_custo: a.referencia_custo,
        custo_unitario: normalizado, custo_unitario_estoque: bruto, custo_unitario_consumo: normalizado,
      };
      const quantidade = consumoInsumo(linha, args.numeroAmostras, id(lote) ? Math.ceil(args.numeroAmostras / lote) : 0);
      const total = reagentesTotal([linha], args.numeroAmostras, loteGeral, () => lote).total;
      if (!positivo(quantidade) || !positivo(quantidade / fator) || !Number.isFinite(total)) {
        recusar("quantidade_nao_comprovada");
        continue;
      }
      const rastro: Selecao = {
        necessidade_id: n.id, etapa_id: n.etapa_id, insumo_id: a.insumo_id,
        apresentacao_ref: a.apresentacao_ref, decisao_ref: d.decisao_ref, evidencia_ref: d.evidencia_ref,
        quantidade_consumo: quantidade, quantidade_estoque: quantidade / fator, custo_total_insumo: total,
      };
      // Empate monetário: ordem estável de identificação, sem hierarquia técnica.
      if (!maior || total > maior.rastro.custo_total_insumo || (total === maior.rastro.custo_total_insumo
        && (a.insumo_id < maior.rastro.insumo_id
          || (a.insumo_id === maior.rastro.insumo_id && a.apresentacao_ref < maior.rastro.apresentacao_ref)))) {
        maior = { linha, rastro };
      }
    }

    if (maior) {
      insumos.push(maior.linha);
      if (id(lote)) lotes.set(maior.linha, lote);
      selecao.push(maior.rastro);
    } else if (pendencias.length === pendenciasAntes) {
      pendencias.push({ necessidade_id: n.id, motivo: "sem_validacao_ativa" });
    }
  }

  if (pendencias.length) return pendente();
  const calculo = calcularAnaliseOrcamento({
    ...args, insumos, cenario: { loteAmostras: args.loteAmostras },
  }, (linha) => lotes.get(linha));
  if (Object.values(calculo.totais).some((valor) => !Number.isFinite(valor))) {
    pendencias.push({ motivo: "preco_nao_comprovado" });
    return pendente();
  }
  return { versao, estado: "calculado", calculo, selecao };
}
