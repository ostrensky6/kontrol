"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { calcularTodas, type FonteCustoInsumos } from "@/lib/costing/loader";
import type { Breakdown } from "@/lib/costing/engine";
import { custeioLaboratorialCompleto } from "@/lib/costing/completude-laboratorial";
import { registrarVersaoParametrosEconomicos } from "@/lib/orcamento/parametros-versionamento";
import {
  montarSnapshotLaboratorio,
  statusOperacionalLaboratorio,
  type ItemLaboratorioOperacional,
} from "@/lib/orcamento/laboratorio-operacional";
import { exigirPapelOrcamento } from "@/lib/orcamento/governanca";
import { recusaSemPermissao } from "@/lib/orcamento/permissao-acao";
import { temPermissao } from "@/lib/auth/permissao-efetiva";
import { validarTransporteCapturaEquivalencia } from "@/lib/orcamento/snapshot-equivalencia-transporte";
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
  const { error } = await supabase.from("orcamentos").update({
    status_operacional: status,
    status_operacional_atualizado_em: new Date().toISOString(),
  }).eq("id", id);
  return { error };
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
  const [{ data: anterior, error: anteriorError }, { data: itens, error: itensError }] = await Promise.all([
    supabase
      .from("orcamentos")
      .select("id, status, status_operacional, responsavel, fonte_custo_insumos, custo_snapshot")
      .eq("id", id)
      .single(),
    supabase
      .from("orcamento_itens")
      .select("id, codigo_analise, n_amostras, custo_unitario, preco_unitario, valor_snapshot")
      .eq("orcamento_id", id),
  ]);
  if (anteriorError || !anterior) {
    return falha("Não foi possível carregar o orçamento para revisão. Tente novamente.");
  }
  if (itensError) return falha("Não foi possível conferir as análises do orçamento. Tente novamente.");
  if ((itens ?? []).length === 0) {
    return falha("Adicione ao menos uma análise antes de revisar os custos laboratoriais.");
  }

  const transporte = validarTransporteCapturaEquivalencia({ ...anterior, orcamento_itens: itens });
  if (transporte.estado === "invalido") return falha(transporte.message);
  const capturado = transporte.estado === "equivalencia";
  if (capturado) {
    if (!await temPermissao("orcamentos.criar_editar")) {
      return falha("A revisão exige também permissão para gravar os metadados do orçamento.");
    }
    if (anterior.status !== "rascunho" && anterior.status !== "enviado") {
      return falha("O estado atual não permite revisar esta captura nem retomar seus metadados.");
    }
    if (anterior.status === "enviado" && anterior.status_operacional === "revisado" && anterior.responsavel) {
      return anterior.responsavel === responsavel
        ? sucesso("Revisão interna já confirmada, sem nova transição ou gravação.")
        : falha("A revisão interna já está concluída com outro responsável; não foi alterada.");
    }
  }

  // Transição primeiro: se o banco recusar, nada foi gravado e o módulo não
  // fica "revisado" com o documento ainda em rascunho. Se a gravação seguinte
  // falhar, repetir a revisão pula a transição (já feita) e completa o resto.
  const statusFinal = anterior.status === "rascunho" ? novoStatus : anterior.status ?? novoStatus;
  if (anterior.status === "rascunho") {
    const { data: transicao, error: transicaoError } = await Promise.resolve(supabase.rpc("transicionar_orcamento", {
      p_orcamento_id: id,
      p_status_destino: novoStatus,
      p_observacao: "Revisão do módulo laboratorial.",
    })).catch(() => ({ data: null, error: { message: "Resultado da transição não confirmado. Consulte o estado antes de retomar a revisão." } }));
    if (transicaoError) return falha(mensagemDoBanco(transicaoError));
    if (capturado && !z.object({ status_destino: z.literal("enviado"), alterado: z.boolean() }).safeParse(transicao).success) {
      return falha("Resultado da transição não confirmado. Consulte o estado antes de retomar a revisão.");
    }
  }
  // responsável e andamento na mesma linha, numa única gravação
  let gravacao = supabase
    .from("orcamentos")
    .update({
      responsavel,
      status_operacional: statusOperacionalLaboratorio({
        statusDocumento: statusFinal,
        quantidadeItens: itens?.length ?? 0,
      }),
      status_operacional_atualizado_em: new Date().toISOString(),
    })
    .eq("id", id);
  // Impede completar metadados se o documento mudou de estado entre as duas transações.
  if (capturado) gravacao = gravacao.eq("status", novoStatus);
  const { data: gravados, error } = await Promise.resolve(gravacao.select("id"))
    .catch(() => ({ data: null, error: { message: "Resposta da gravação indisponível." } }));
  if (error || gravados?.length !== 1 || gravados[0].id !== id) {
    return falha(statusFinal === "enviado"
      ? "Revisão interna enviada, mas metadados não confirmados. Confira o estado e repita a revisão para completar o responsável e o andamento; não houve rollback da transição."
      : "Metadados da revisão não confirmados. Confira o estado e tente novamente.");
  }
  revalidatePath(`/orcamento/${id}`);
  revalidatePath("/orcamento");
  return sucesso("Revisão interna confirmada. A emissão continua sujeita às demais validações e permissões.");
}

type ItemGravado = {
  codigo_analise: string;
  n_amostras: number;
  custo_unitario: number;
  preco_unitario: number;
  valor_snapshot: unknown;
};

const mensagemCusteioPendente = (codigos: string) =>
  `Custo pendente para: ${codigos}. Confira preço, unidade e conversão dos insumos na receita em Análises.`;

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
  if (!remover && !custeioLaboratorialCompleto(breakdown)) {
    return falha(mensagemCusteioPendente(codigo));
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

  const paraGravar: ItemGravado[] = [];
  const semCusto: string[] = [];
  for (const [codigo, n] of quantidades) {
    const breakdown = breakdowns.find((x) => x.codigo === codigo);
    if (!custeioLaboratorialCompleto(breakdown)) {
      semCusto.push(codigo);
      continue;
    }
    paraGravar.push({ codigo_analise: codigo, ...itemDoCusteio(breakdown, n, fonteCustoInsumos) });
  }
  if (semCusto.length > 0) return falha(mensagemCusteioPendente(semCusto.join(", ")));

  const gravados: ItemGravado[] = [];
  for (const novo of paraGravar) {
    gravados.push(novo);
    const custoSnapshot = {
      ...(montarSnapshotLaboratorio(gravados as ItemLaboratorioOperacional[], breakdowns) as Record<string, Json>),
      fonte_custo_insumos: fonteCustoInsumos,
    };
    const { error } = await supabase.rpc("salvar_item_orcamento", {
      p_orcamento_id: orcamentoId,
      p_codigo_analise: novo.codigo_analise,
      p_n_amostras: novo.n_amostras,
      p_custo_unitario: novo.custo_unitario,
      p_preco_unitario: novo.preco_unitario,
      p_valor_snapshot: novo.valor_snapshot as Json,
      p_custo_snapshot: custoSnapshot,
    });
    if (error) return falha(mensagemDoBanco(error));
  }
  revalidatePath(`/orcamento/${orcamentoId}`);
  return sucesso(`${gravados.length} análise(s) trazidas do orçamento.`);
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
  const semCusteio = (itens ?? []).find((it) =>
    !custeioLaboratorialCompleto(breakdowns.find((x) => x.codigo === it.codigo_analise)));
  if (semCusteio) {
    return {
      ok: false,
      message: mensagemCusteioPendente(semCusteio.codigo_analise),
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
  const id = idValido(formData.get("orcamento_id"));
  if (!id) throw new Error("Orçamento não identificado.");
  const supabase = await createClient();
  const { data: atual, error: erroLeitura } = await supabase
    .from("orcamentos")
    .select("status")
    .eq("id", id)
    .single();

  if (erroLeitura || !atual || atual.status !== "rascunho") {
    redirect(`/orcamento/${id}?erro_exclusao=${encodeURIComponent("Somente orçamento em rascunho com permissão pode ser excluído. Para os demais estados, preserve o histórico pelo cancelamento.")}`);
  }

  const { data: removidos, error } = await supabase
    .from("orcamentos")
    .delete()
    .eq("id", id)
    .eq("status", "rascunho")
    .select("id");
  if (error) {
    redirect(`/orcamento/${id}?erro_exclusao=${encodeURIComponent(`Não foi possível excluir o orçamento: ${mensagemDoBanco(error)}`)}`);
  }
  if (removidos?.length !== 1 || removidos[0].id !== id) {
    redirect(`/orcamento/${id}?erro_exclusao=${encodeURIComponent("Exclusão não confirmada. O orçamento pode ter mudado de estado ou você não tem permissão. Atualize a página e tente novamente.")}`);
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

  const jaCancelado = atual.status === "cancelado";
  if (!jaCancelado) {
    const { error } = await supabase.rpc("transicionar_orcamento", {
      p_orcamento_id: id,
      p_status_destino: "cancelado",
      p_observacao: motivo,
    });
    if (error) return falha(mensagemDoBanco(error));
  }
  // Repetir o cancelamento acerta o andamento que tenha ficado para trás.
  const { error: andamentoError } = await atualizarOperacionalLaboratorio(supabase, id, "cancelado");
  revalidatePath(`/orcamento/${id}`);
  revalidatePath("/orcamento");
  if (andamentoError) {
    return falha(
      "O orçamento foi cancelado, mas o andamento do módulo não foi atualizado. Use “Concluir cancelamento” para corrigir.",
    );
  }
  return sucesso(jaCancelado ? "O orçamento já estava cancelado." : "Orçamento cancelado. O histórico foi preservado.");
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
