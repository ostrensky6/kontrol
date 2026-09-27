"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { calcularTodas, type FonteCustoInsumos } from "@/lib/costing/loader";
import type { Breakdown } from "@/lib/costing/engine";
import { registrarVersaoParametrosEconomicos } from "@/lib/orcamento/parametros-versionamento";
import {
  montarSnapshotLaboratorio,
  statusOperacionalLaboratorio,
  type ItemLaboratorioOperacional,
} from "@/lib/orcamento/laboratorio-operacional";
import { exigirPapelOrcamento } from "@/lib/orcamento/governanca";
import { recusaSemPermissao } from "@/lib/orcamento/permissao-acao";
import { moduloBloqueadoParaEdicao } from "@/lib/orcamento/ciclo-vida-modulo";
import { falha, mensagemDoBanco, sucesso, type EstadoAcao } from "@/lib/erros";
import { registrarEvento } from "./eventos";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ParametrosEconomicosState = {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
};

const parametroNumero = (opts: { min?: number; max?: number } = {}) =>
  z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z
      .number({ error: "Obrigatório" })
      .refine((n) => !Number.isNaN(n), "Número inválido")
      .refine((n) => opts.min == null || n >= opts.min, `Mínimo ${opts.min}`)
      .refine((n) => opts.max == null || n <= opts.max, `Máximo ${opts.max}`),
  );

const parametrosEconomicosSchema = z.object({
  dias_uteis_ano: parametroNumero({ min: 1 }),
  margem_lucro: parametroNumero({ min: 0, max: 100 }),
  impostos: parametroNumero({ min: 0, max: 100 }),
  taxas: parametroNumero({ min: 0, max: 100 }),
  fundo_reserva: parametroNumero({ min: 0, max: 100 }),
  fundo_investimento: parametroNumero({ min: 0, max: 100 }),
});

const PARAMETROS_META: Record<
  keyof z.infer<typeof parametrosEconomicosSchema>,
  { unidade: string; descricao: string }
> = {
  dias_uteis_ano: {
    unidade: "dias",
    descricao: "Dias úteis/ano para rateio de equipamentos",
  },
  margem_lucro: {
    unidade: "%",
    descricao: "Margem de lucro sobre o custo total",
  },
  impostos: {
    unidade: "%",
    descricao: "Impostos sobre a venda",
  },
  taxas: {
    unidade: "%",
    descricao: "Taxas administrativas",
  },
  fundo_reserva: {
    unidade: "%",
    descricao: "Fundo de reserva",
  },
  fundo_investimento: {
    unidade: "%",
    descricao: "Fundo de investimento",
  },
};

function idValido(valor: FormDataEntryValue | null): number | null {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function atualizarOperacionalLaboratorio(
  supabase: Supabase,
  id: number,
  statusDocumento?: string | null,
) {
  const [{ data: orc }, { data: itens }] = await Promise.all([
    supabase.from("orcamentos").select("status").eq("id", id).single(),
    supabase
      .from("orcamento_itens")
      .select("id")
      .eq("orcamento_id", id),
  ]);
  const status = statusOperacionalLaboratorio({
    statusDocumento: statusDocumento ?? orc?.status,
    quantidadeItens: itens?.length ?? 0,
  });
  await supabase.from("orcamentos").update({
    status_operacional: status,
    status_operacional_atualizado_em: new Date().toISOString(),
  }).eq("id", id);
}

/** Salva o cabeçalho (cliente/projeto + dados) de um orçamento sem proposta.
 *  Se um cliente cadastrado for vinculado, os dados do documento vêm dele. O
 *  status não é mais editado aqui (UI-6): muda só pelas ações do fluxo. */
export async function salvarCabecalho(_estado: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  const id = idValido(formData.get("orcamento_id"));
  if (!id) return falha("Orçamento não identificado.");
  const recusa = await recusaSemPermissao("preencher_custos");
  if (recusa) return recusa;
  const supabase = await createClient();

  const cliente_id = formData.get("cliente_id") ? Number(formData.get("cliente_id")) : null;
  const projeto_id = formData.get("projeto_id") ? Number(formData.get("projeto_id")) : null;

  // dados do documento — por padrão vêm dos campos de texto
  let cliente_nome = String(formData.get("cliente_nome") ?? "").trim() || "Cliente sem nome";
  let cliente_cnpj = (formData.get("cliente_cnpj") as string)?.trim() || null;
  let cliente_endereco = (formData.get("cliente_endereco") as string)?.trim() || null;
  let cliente_contato = (formData.get("cliente_contato") as string)?.trim() || null;

  // se vinculado a um cliente cadastrado, o documento reflete o cadastro
  if (cliente_id) {
    const { data: c } = await supabase
      .from("clientes")
      .select("nome, cnpj, endereco, contato, email, telefone")
      .eq("id", cliente_id)
      .single();
    if (c) {
      cliente_nome = c.nome;
      cliente_cnpj = c.cnpj;
      cliente_endereco = c.endereco;
      cliente_contato = c.contato || c.email || c.telefone;
    }
  }

  const patch = {
    cliente_id,
    projeto_id,
    cliente_nome,
    cliente_cnpj,
    cliente_endereco,
    cliente_contato,
    data_orcamento: (formData.get("data_orcamento") as string) || undefined,
    validade_dias: Number(formData.get("validade_dias")) || 30,
    responsavel: (formData.get("responsavel") as string)?.trim() || null,
    observacoes: (formData.get("observacoes") as string)?.trim() || null,
  };
  const { data: gravado, error } = await supabase.from("orcamentos").update(patch).eq("id", id).select("id");
  if (error) return falha(mensagemDoBanco(error));
  if (!gravado?.length) return falha("Nada foi salvo: seu perfil não pode alterar este orçamento.");
  revalidatePath(`/orcamento/${id}`);
  revalidatePath("/orcamento");
  return sucesso("Dados salvos.");
}

function normalizarFonteCustoInsumos(valor: unknown): FonteCustoInsumos {
  return valor === "custo_medio_ponderado" ? "custo_medio_ponderado" : "custo_padrao";
}

export async function revisarOrcamentoLaboratorio(_estado: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  const recusa = await recusaSemPermissao("revisar_modulo");
  if (recusa) return recusa;
  const id = idValido(formData.get("orcamento_id"));
  const responsavel = String(formData.get("responsavel") ?? "").trim();
  // A revisão interna só marca o módulo como revisado ("enviado"). Aprovação
  // é decisão do cliente e fica na proposta (versão final), não aqui.
  const novoStatus = "enviado";
  if (!id) return falha("Orçamento não identificado.");
  if (!responsavel) {
    return falha("Informe o responsável técnico antes de revisar os custos laboratoriais.");
  }

  const supabase = await createClient();
  const [{ data: anterior }, { data: itens }] = await Promise.all([
    supabase
      .from("orcamentos")
      .select("status")
      .eq("id", id)
      .single(),
    supabase
      .from("orcamento_itens")
      .select("id")
      .eq("orcamento_id", id),
  ]);
  if ((itens ?? []).length === 0) {
    return falha("Adicione ao menos uma análise antes de revisar os custos laboratoriais.");
  }

  // Transição primeiro: se o banco recusar, nada foi gravado e o módulo não
  // fica "revisado" com o documento ainda em rascunho.
  const statusFinal = anterior?.status === "rascunho" ? novoStatus : anterior?.status ?? novoStatus;
  if (anterior?.status === "rascunho") {
    const { error: transicaoError } = await supabase.rpc("transicionar_orcamento", {
      p_orcamento_id: id,
      p_status_destino: novoStatus,
      p_observacao: "Revisão do módulo laboratorial.",
    });
    if (transicaoError) return falha(mensagemDoBanco(transicaoError));
  }
  const { error } = await supabase
    .from("orcamentos")
    .update({
      responsavel,
      status_operacional: "revisado",
      status_operacional_atualizado_em: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return falha(mensagemDoBanco(error));
  await atualizarOperacionalLaboratorio(supabase, id, statusFinal);
  revalidatePath(`/orcamento/${id}`);
  revalidatePath("/orcamento");
  return sucesso("Custos revisados. A proposta já pode ser emitida.");
}

type ItemGravado = {
  codigo_analise: string;
  n_amostras: number;
  custo_unitario: number;
  preco_unitario: number;
  valor_snapshot: unknown;
};

/** Custo congelado de uma análise no momento em que entra (ou muda) no orçamento. */
function itemDoCusteio(b: Breakdown, n: number, fonteCustoInsumos: FonteCustoInsumos) {
  const lote = b.lote > 0 ? b.lote : 1;
  return {
    n_amostras: n,
    custo_unitario: b.custoTotal,
    preco_unitario: b.preco,
    valor_snapshot: {
      lote_padrao: lote,
      numero_execucoes: Math.ceil(n / lote),
      composicao: {
        reagentes: b.reagentes,
        equipamento: b.equipamento,
        pessoal: b.pessoal,
        overhead: b.overhead,
        custo_total: b.custoTotal,
        preco: b.preco,
      },
      composicao_totais: {
        reagentes: b.reagentes * n,
        equipamento: b.equipamento * n,
        pessoal: b.pessoal * n,
        overhead: b.overhead * n,
        custo_total: b.custoTotal * n,
        preco: b.preco * n,
      },
      proveniencia_dimensional: b.provenienciaDimensional ?? [],
      fonte_custo_insumos: fonteCustoInsumos,
    },
  };
}

/**
 * Inclui, remove ou muda a quantidade de uma análise do orçamento
 * laboratorial (ORC2-1). Item e custo congelado do módulo são gravados juntos
 * pela RPC salvar_item_orcamento (0126); antes, a segunda gravação era sempre
 * recusada pelo banco e o item ficava sem custo.
 */
export async function salvarItemOrcamento(_estado: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  const recusa = await recusaSemPermissao("preencher_custos");
  if (recusa) return recusa;
  const id = idValido(formData.get("orcamento_id"));
  const codigo = String(formData.get("codigo_analise") ?? "").trim();
  const remover = String(formData.get("acao") ?? "") === "remover";
  const n = Number(formData.get("n_amostras"));
  if (!id || !codigo) return falha("Análise ou orçamento não identificado.");
  if (!remover && !(Number.isInteger(n) && n > 0)) {
    return falha("Informe a quantidade de amostras (número inteiro maior que zero).");
  }

  const supabase = await createClient();
  const { data: orcamento, error: orcamentoError } = await supabase
    .from("orcamentos")
    .select("status, status_operacional, fonte_custo_insumos")
    .eq("id", id)
    .single();
  if (orcamentoError || !orcamento) return falha("Orçamento não encontrado.");
  const bloqueio = moduloBloqueadoParaEdicao({ status: orcamento.status, statusOperacional: orcamento.status_operacional });
  if (bloqueio.bloqueado) {
    return falha("Análises e quantidades deste orçamento estão travadas (revisado, enviado, aprovado ou cancelado).");
  }

  const fonteCustoInsumos = normalizarFonteCustoInsumos(orcamento.fonte_custo_insumos);
  const { breakdowns } = await calcularTodas({}, fonteCustoInsumos);
  const breakdown = breakdowns.find((x) => x.codigo === codigo);
  if (!remover && !breakdown) {
    return falha(`Não foi possível calcular o custo da análise ${codigo}. Confira a receita dela em Análises.`);
  }

  const { data: itensAtuais, error: itensError } = await supabase
    .from("orcamento_itens")
    .select("codigo_analise, n_amostras, custo_unitario, preco_unitario, valor_snapshot")
    .eq("orcamento_id", id);
  if (itensError) return falha(mensagemDoBanco(itensError));

  const novo = !remover && breakdown ? itemDoCusteio(breakdown, n, fonteCustoInsumos) : null;
  const itensSnapshot: ItemGravado[] = [
    ...((itensAtuais ?? []) as ItemGravado[]).filter((item) => item.codigo_analise !== codigo),
    ...(novo ? [{ codigo_analise: codigo, ...novo }] : []),
  ];
  const custoSnapshot = {
    ...(montarSnapshotLaboratorio(
      itensSnapshot as ItemLaboratorioOperacional[],
      breakdowns,
    ) as Record<string, Json>),
    fonte_custo_insumos: fonteCustoInsumos,
  };

  const { error } = await supabase.rpc("salvar_item_orcamento", {
    p_orcamento_id: id,
    p_codigo_analise: codigo,
    p_n_amostras: novo ? n : 0,
    p_custo_unitario: novo?.custo_unitario ?? 0,
    p_preco_unitario: novo?.preco_unitario ?? 0,
    p_valor_snapshot: (novo?.valor_snapshot ?? {}) as Json,
    p_custo_snapshot: custoSnapshot,
  });
  if (error) return falha(mensagemDoBanco(error));
  revalidatePath(`/orcamento/${id}`);
  return sucesso(remover ? `${codigo} removida.` : `${codigo}: ${n} amostra(s) salvas.`);
}

/**
 * Copia para o orçamento laboratorial recém-criado as análises escolhidas nos
 * grupos de amostras do orçamento (demanda_analises), somando as quantidades da
 * mesma análise. Antes o módulo nascia vazio e o técnico escolhia tudo de novo.
 * Cada item passa pela mesma RPC transacional do "Incluir" (custo congelado).
 */
export async function incluirAnalisesDaDemandaNoOrcamento(orcamentoId: number, demandaId: number): Promise<EstadoAcao> {
  const supabase = await createClient();
  const { data: escolhidas, error: escolhidasError } = await supabase
    .from("demanda_analises")
    .select("codigo_analise, quantidade_amostras")
    .eq("demanda_id", demandaId);
  if (escolhidasError) return falha(mensagemDoBanco(escolhidasError));
  const quantidades = new Map<string, number>();
  for (const linha of (escolhidas ?? []) as { codigo_analise: string; quantidade_amostras: number }[]) {
    quantidades.set(linha.codigo_analise, (quantidades.get(linha.codigo_analise) ?? 0) + Number(linha.quantidade_amostras));
  }
  if (quantidades.size === 0) return sucesso("Nenhuma análise escolhida no orçamento.");

  const { data: orcamento } = await supabase
    .from("orcamentos")
    .select("fonte_custo_insumos")
    .eq("id", orcamentoId)
    .single();
  const fonteCustoInsumos = normalizarFonteCustoInsumos(orcamento?.fonte_custo_insumos);
  const { breakdowns } = await calcularTodas({}, fonteCustoInsumos);

  const gravados: ItemGravado[] = [];
  const semCusto: string[] = [];
  for (const [codigo, n] of quantidades) {
    const breakdown = breakdowns.find((x) => x.codigo === codigo);
    if (!breakdown) {
      semCusto.push(codigo);
      continue;
    }
    const novo = itemDoCusteio(breakdown, n, fonteCustoInsumos);
    gravados.push({ codigo_analise: codigo, ...novo });
    const custoSnapshot = {
      ...(montarSnapshotLaboratorio(gravados as ItemLaboratorioOperacional[], breakdowns) as Record<string, Json>),
      fonte_custo_insumos: fonteCustoInsumos,
    };
    const { error } = await supabase.rpc("salvar_item_orcamento", {
      p_orcamento_id: orcamentoId,
      p_codigo_analise: codigo,
      p_n_amostras: n,
      p_custo_unitario: novo.custo_unitario,
      p_preco_unitario: novo.preco_unitario,
      p_valor_snapshot: novo.valor_snapshot as Json,
      p_custo_snapshot: custoSnapshot,
    });
    if (error) return falha(mensagemDoBanco(error));
  }
  revalidatePath(`/orcamento/${orcamentoId}`);
  return semCusto.length > 0
    ? falha(`Sem custo calculado para: ${semCusto.join(", ")}. Confira a receita em Análises e inclua depois.`)
    : sucesso(`${gravados.length} análise(s) trazidas do orçamento.`);
}

export type ResultadoRecalculoOrcamento = {
  ok: boolean;
  message: string;
};

/** Reatualiza os snapshots de custo/preço dos itens com os parâmetros atuais. */
export async function recalcularOrcamento(
  formData: FormData,
): Promise<ResultadoRecalculoOrcamento> {
  const recusa = await recusaSemPermissao("recalcular_custos");
  if (recusa) return { ok: false, message: recusa.message ?? "Sem permissão para recalcular." };
  const id = Number(formData.get("orcamento_id"));
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, message: "Informe um orçamento válido para recalcular." };
  }
  const operacaoId = String(formData.get("operacao_id") ?? "").trim();
  if (!z.string().uuid().safeParse(operacaoId).success) {
    return { ok: false, message: "Identidade da operação de recálculo inválida." };
  }
  const supabase = await createClient();
  const { data: atual, error: atualError } = await supabase
    .from("orcamentos")
    .select("status, fonte_custo_insumos, custo_revisao")
    .eq("id", id)
    .maybeSingle();
  if (atualError) return { ok: false, message: mensagemDoBanco(atualError) };
  if (!atual) {
    return { ok: false, message: "Orçamento não encontrado para recálculo." };
  }
  const motivoInformado = String(formData.get("motivo") ?? "").trim();
  if (atual && ["enviado", "aprovado", "cancelado"].includes(atual.status)) {
    if (!motivoInformado) {
      return {
        ok: false,
        message: "Recalcular orçamento enviado, aprovado ou cancelado exige motivo.",
      };
    }
  }
  const fonteCustoInsumos = normalizarFonteCustoInsumos(formData.get("fonte_custo_insumos") ?? atual?.fonte_custo_insumos);
  const { data: itens, error: itensError } = await supabase
    .from("orcamento_itens")
    .select("id, codigo_analise, n_amostras, custo_unitario, preco_unitario, valor_snapshot")
    .eq("orcamento_id", id);
  if (itensError) return { ok: false, message: mensagemDoBanco(itensError) };
  const { breakdowns } = await calcularTodas({}, fonteCustoInsumos);
  const semCusteio = (itens ?? []).find((it) => !breakdowns.some((x) => x.codigo === it.codigo_analise));
  if (semCusteio) {
    return {
      ok: false,
      message: `Não foi possível recalcular a análise ${semCusteio.codigo_analise}. Confira a receita dela em Análises.`,
    };
  }
  const itensRecalculados = (itens ?? []).map((it) => {
    const b = breakdowns.find((x) => x.codigo === it.codigo_analise) as Breakdown;
    const quantidade = Number(it.n_amostras ?? 0);
    const lote = b.lote > 0 ? b.lote : 1;
    return {
      id: it.id,
      codigo_analise: it.codigo_analise,
      n_amostras: quantidade,
      custo_unitario: b.custoTotal,
      preco_unitario: b.preco,
      valor_snapshot: {
        lote_padrao: lote,
        numero_execucoes: quantidade > 0 ? Math.ceil(quantidade / lote) : 0,
        composicao: {
          reagentes: b.reagentes,
          equipamento: b.equipamento,
          pessoal: b.pessoal,
          overhead: b.overhead,
          custo_total: b.custoTotal,
          preco: b.preco,
        },
        composicao_totais: {
          reagentes: b.reagentes * quantidade,
          equipamento: b.equipamento * quantidade,
          pessoal: b.pessoal * quantidade,
          overhead: b.overhead * quantidade,
          custo_total: b.custoTotal * quantidade,
          preco: b.preco * quantidade,
        },
        proveniencia_dimensional: b.provenienciaDimensional ?? [],
        fonte_custo_insumos: fonteCustoInsumos,
      },
    };
  });
  const snapshot = {
    ...(montarSnapshotLaboratorio(
      itensRecalculados as ItemLaboratorioOperacional[],
      breakdowns,
    ) as Record<string, Json>),
    fonte_custo_insumos: fonteCustoInsumos,
  };
  const motivo =
    motivoInformado || `Recálculo de snapshots laboratoriais com ${fonteCustoInsumos}.`;
  const { error } = await supabase.rpc("recalcular_orcamento_transacional", {
    p_orcamento_id: id,
    p_motivo: motivo,
    p_revisao_esperada: Number(atual.custo_revisao ?? 0),
    p_fonte_custo_insumos: fonteCustoInsumos,
    p_itens: itensRecalculados,
    p_snapshot: snapshot,
    p_operacao_id: operacaoId,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidatePath(`/orcamento/${id}`);
  return { ok: true, message: "Orçamento recalculado com sucesso." };
}

export async function excluirOrcamento(formData: FormData) {
  await exigirPapelOrcamento("cancelar_documento");
  const id = Number(formData.get("orcamento_id"));
  const supabase = await createClient();
  const { data: atual } = await supabase
    .from("orcamentos")
    .select("status")
    .eq("id", id)
    .single();

  if (atual && ["enviado", "aprovado"].includes(atual.status)) {
    redirect(`/orcamento/${id}?erro_exclusao=${encodeURIComponent("Orçamento enviado ou aprovado não pode ser excluído. Cancele-o com um motivo.")}`);
  }

  const { error } = await supabase.from("orcamentos").delete().eq("id", id);
  if (error) {
    redirect(`/orcamento/${id}?erro_exclusao=${encodeURIComponent(`Não foi possível excluir o orçamento: ${mensagemDoBanco(error)}`)}`);
  }
  revalidatePath("/orcamento");
  redirect("/orcamento");
}

export async function cancelarOrcamento(_estado: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  const id = idValido(formData.get("orcamento_id"));
  if (!id) return falha("Orçamento não identificado.");
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (motivo.length < 3) return falha("Informe o motivo do cancelamento.");
  const recusa = await recusaSemPermissao("cancelar_documento");
  if (recusa) return recusa;
  const supabase = await createClient();
  const { data: atual } = await supabase
    .from("orcamentos")
    .select("status")
    .eq("id", id)
    .single();
  if (!atual) return falha("Orçamento não encontrado.");
  if (atual.status === "cancelado") return sucesso("O orçamento já estava cancelado.");

  const { error } = await supabase.rpc("transicionar_orcamento", {
    p_orcamento_id: id,
    p_status_destino: "cancelado",
    p_observacao: motivo,
  });
  if (error) return falha(mensagemDoBanco(error));
  await atualizarOperacionalLaboratorio(supabase, id, "cancelado");
  revalidatePath(`/orcamento/${id}`);
  revalidatePath("/orcamento");
  return sucesso("Orçamento cancelado. O histórico foi preservado.");
}

export async function salvarParametrosEconomicos(
  _prev: ParametrosEconomicosState,
  formData: FormData,
): Promise<ParametrosEconomicosState> {
  const parsed = parametrosEconomicosSchema.safeParse({
    dias_uteis_ano: formData.get("dias_uteis_ano"),
    margem_lucro: formData.get("margem_lucro"),
    impostos: formData.get("impostos"),
    taxas: formData.get("taxas"),
    fundo_reserva: formData.get("fundo_reserva"),
    fundo_investimento: formData.get("fundo_investimento"),
  });

  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = String(issue.path[0] ?? "");
      if (path && !errors[path]) errors[path] = issue.message;
    }
    return { ok: false, message: "Verifique os campos destacados.", errors };
  }
  const recusa = await recusaSemPermissao("editar_parametros");
  if (recusa) return recusa;

  const supabase = await createClient();
  const atualizado_em = new Date().toISOString();
  const rows = Object.entries(parsed.data).map(([chave, valor]) => ({
    chave,
    valor,
    unidade: PARAMETROS_META[chave as keyof typeof PARAMETROS_META].unidade,
    descricao: PARAMETROS_META[chave as keyof typeof PARAMETROS_META].descricao,
    atualizado_em,
  }));

  const { error } = await supabase.from("parametros").upsert(rows, {
    onConflict: "chave",
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  await registrarVersaoParametrosEconomicos(supabase, {
    escopo: "laboratorio_global",
    parametros: parsed.data,
    origem: "orcamento/parametros",
  });
  await registrarEvento(
    "orcamento_parametros",
    0,
    "laboratorio_global",
    "alterado",
    "Parâmetros econômicos globais atualizados com nova versão.",
  );

  revalidatePath("/orcamento/parametros");
  revalidatePath("/orcamento");
  revalidatePath("/custeio");
  revalidatePath("/analises");
  return { ok: true, message: "Parâmetros econômicos atualizados." };
}
