"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { pode } from "@/lib/auth/permissao-efetiva";
import { usuarioAtual } from "@/lib/auth/roles";
import { mensagemDoBanco } from "@/lib/erros";
import { hojeIso } from "@/lib/estoque/baixa";
import { chaveCodigoBarras, codigoBarrasValido, lerGs1 } from "@/lib/scanner/codigo-barras";
import { normalizarCodigo, resolverIdentificadorInterno } from "@/lib/scanner/identificadores";
import { parseRotaCurtaKontrol } from "@/lib/scanner/resolver";
import {
  buscarIdentificadorAtivo,
  conflitosCodigos,
  mensagemConflitos,
  sincronizarCodigosInsumo,
} from "@/lib/scanner/vinculos-codigo";
import { createClientUntyped } from "@/lib/supabase/server";

/**
 * Entrada e saída de insumos pela leitura do código de barras do fabricante
 * (relatório de bugs, item 18). O código identifica o insumo; o lote é
 * interno (gerado na entrada, escolhido por validade na saída).
 */

export type PedidoAbertoLeitura = {
  pedidoId: number;
  itemId: number;
  /** quanto ainda falta receber, na unidade do item */
  pendente: number;
  /** item comprado em embalagens (frascos): pode receber pela leitura */
  emEmbalagens: boolean;
  fornecedor: string | null;
};

export type InsumoLeitura = {
  id: number;
  especificacao: string;
  /** "frasco(s) de 1000 Un": a mesma unidade do Controle de Estoque */
  unidadeSaldo: string;
  /** embalagens fechadas em estoque (inclui vencidas, como o Controle) */
  fechadas: number;
  modelo: "EMBALAGEM_FECHADA" | "LEGADO";
  /** lote que sai na próxima abertura (vence primeiro) */
  proximaSaida: { codigoLote: string; validade: string | null } | null;
  /** por que a abertura não pode ser registrada agora */
  motivoSemSaida: string | null;
  pedidosAbertos: PedidoAbertoLeitura[];
};

export type ResultadoIdentificacao =
  | {
      ok: true;
      encontrado: true;
      codigo: string;
      chave: string;
      /** validade lida do GS1 (DataMatrix/GS1-128), quando o código traz */
      validadeLida: string | null;
      insumo: InsumoLeitura;
    }
  | {
      ok: true;
      encontrado: false;
      codigo: string;
      chave: string;
      validadeLida: string | null;
      /** o código existe, mas aponta para um local, equipamento… */
      outroCadastro: string | null;
      message: string;
    }
  | { ok: false; message: string };

export type ResultadoMovimentoLeitura =
  | {
      ok: true;
      tipo: "entrada" | "saida";
      operacaoId: string;
      insumoId: number;
      especificacao: string;
      codigoLote: string | null;
      validade: string | null;
      quantidade: number;
      fechadas: number;
      pedidoId: number | null;
      repetido: boolean;
      message: string;
    }
  | { ok: false; message: string };

const SEM_PERMISSAO = "Seu perfil não tem permissão para esta ação. Peça ao administrador para liberar em Usuários.";
const MENSAGEM_INSUMO_INATIVO = "Insumo inativo. Reative o cadastro para iniciar uma nova operação.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Supabase = Awaited<ReturnType<typeof createClientUntyped>>;

function primeiro<T>(valor: T | T[] | null | undefined): T | null {
  return Array.isArray(valor) ? (valor[0] ?? null) : (valor ?? null);
}

async function insumoAtivo(supabase: Supabase, insumoId: number) {
  const { data } = await supabase.from("insumos").select("ativo").eq("id", insumoId).maybeSingle();
  return (data as { ativo?: boolean } | null)?.ativo === true;
}

function revalidarEstoque() {
  for (const path of [
    "/estoque",
    "/estoque/controle",
    "/estoque/inventario",
    "/estoque/leitura",
    "/suprimentos",
    "/cadastros/insumos",
    "/insumos",
    "/planejamento",
    "/recebimento",
    "/compras",
  ]) {
    revalidatePath(path);
  }
}

async function registrarLeitura(
  supabase: Supabase,
  codigo: string,
  resultado: "encontrado" | "nao_encontrado",
  insumoId: number | null,
) {
  try {
    const usuario = await usuarioAtual();
    await supabase.from("scan_eventos").insert({
      codigo,
      valor_lido: codigo,
      formato: "codigo_barras",
      entidade_tipo: insumoId ? "insumo" : null,
      entidade_id: insumoId,
      acao: "leitura_estoque",
      resultado,
      contexto: { origem: "leitura_estoque", codigo_normalizado: normalizarCodigo(codigo) },
      usuario: usuario?.email ?? usuario?.id ?? null,
    });
  } catch {
    // o registro da leitura nunca bloqueia a operação
  }
}

/** Insumo do código: vínculo de código de barras, etiqueta de lote ou QR do Kontrol. */
async function insumoDoCodigo(
  supabase: Supabase,
  codigo: string,
): Promise<{ insumoId: number | null; outroCadastro: string | null }> {
  const rota = parseRotaCurtaKontrol(codigo);
  const interno = resolverIdentificadorInterno(codigo);
  const vinculo = rota || interno ? null : await buscarIdentificadorAtivo(supabase, codigo);
  const tipo = rota?.tipo ?? interno?.entidadeTipo ?? vinculo?.entidade_tipo ?? null;
  const id = rota?.id ?? interno?.entidadeId ?? vinculo?.entidade_id ?? null;
  if (!tipo || !id) return { insumoId: null, outroCadastro: null };
  if (tipo === "insumo") return { insumoId: Number(id), outroCadastro: null };
  if (tipo === "lote") {
    const { data } = await supabase.from("lotes_estoque").select("insumo_id").eq("id", id).maybeSingle();
    const insumoId = Number((data as { insumo_id?: number } | null)?.insumo_id);
    return Number.isInteger(insumoId) && insumoId > 0
      ? { insumoId, outroCadastro: null }
      : { insumoId: null, outroCadastro: "lote" };
  }
  const nomes: Record<string, string> = {
    local: "um local",
    equipamento: "um equipamento",
    equipamento_unidade: "uma unidade de equipamento",
  };
  return { insumoId: null, outroCadastro: nomes[tipo] ?? tipo };
}

async function carregarInsumoLeitura(supabase: Supabase, insumoId: number): Promise<InsumoLeitura | null> {
  const [{ data: saldo }, { data: lotesRaw }, { data: reservasRaw }, { data: itensRaw }] = await Promise.all([
    supabase
      .from("v_estoque_saldo")
      .select("insumo_id, especificacao, unidade, em_maos, unidade_saldo, modelo_quantidade")
      .eq("insumo_id", insumoId)
      .maybeSingle(),
    supabase
      .from("lotes_estoque")
      .select("id, codigo_lote, validade, quantidade_atual, status, modelo_quantidade")
      .eq("insumo_id", insumoId)
      .eq("status", "aceito")
      .gt("quantidade_atual", 0),
    supabase
      .from("reservas_estoque")
      .select("lote_id, quantidade, quantidade_consumida, status")
      .eq("insumo_id", insumoId)
      .in("status", ["reservado", "parcial"]),
    supabase
      .from("pedidos_compra_itens")
      .select("id, pedido_id, quantidade, quantidade_recebida, quantidade_em, lote_id, pedidos_compra!inner(id, status, fornecedores(nome))")
      .eq("insumo_id", insumoId)
      .in("pedidos_compra.status", ["aprovado", "enviado", "em_transito"]),
  ]);
  const s = saldo as {
    insumo_id: number;
    especificacao: string | null;
    unidade: string | null;
    em_maos: number | null;
    unidade_saldo: string | null;
    modelo_quantidade: string | null;
  } | null;
  if (!s?.insumo_id) return null;

  const modelo = s.modelo_quantidade === "EMBALAGEM_FECHADA" ? "EMBALAGEM_FECHADA" : "LEGADO";
  const reservado = new Map<number, number>();
  for (const r of (reservasRaw ?? []) as { lote_id: number | null; quantidade: number; quantidade_consumida: number | null }[]) {
    if (r.lote_id == null) continue;
    const pendente = Number(r.quantidade ?? 0) - Number(r.quantidade_consumida ?? 0);
    if (pendente > 0) reservado.set(Number(r.lote_id), (reservado.get(Number(r.lote_id)) ?? 0) + pendente);
  }
  const hoje = hojeIso();
  const fechados = ((lotesRaw ?? []) as {
    id: number;
    codigo_lote: string | null;
    validade: string | null;
    quantidade_atual: number;
    modelo_quantidade: string | null;
  }[]).filter((l) => l.modelo_quantidade === "EMBALAGEM_FECHADA");
  const validos = fechados.filter((l) => !l.validade || l.validade >= hoje);
  const livres = validos
    .filter((l) => Number(l.quantidade_atual) - (reservado.get(Number(l.id)) ?? 0) >= 1)
    // mesma ordem da RPC: vence primeiro; sem validade, o mais antigo
    .sort((a, b) => {
      if (a.validade && b.validade && a.validade !== b.validade) return a.validade < b.validade ? -1 : 1;
      if (a.validade && !b.validade) return -1;
      if (!a.validade && b.validade) return 1;
      return Number(a.id) - Number(b.id);
    });

  const fechadas = fechados.reduce((soma, l) => soma + Number(l.quantidade_atual), 0);
  let motivoSemSaida: string | null = null;
  if (modelo === "LEGADO") {
    motivoSemSaida = "Este insumo ainda é controlado por volume (modelo antigo); registre a saída por Dar baixa.";
  } else if (fechadas <= 0) {
    motivoSemSaida = "Não há embalagem fechada deste insumo no estoque.";
  } else if (validos.length === 0) {
    motivoSemSaida = "As embalagens fechadas deste insumo estão vencidas; dê baixa por vencimento no Controle de Estoque.";
  } else if (livres.length === 0) {
    motivoSemSaida = "As embalagens fechadas estão reservadas para planejamentos; registre a retirada pelo planejamento.";
  }

  const pedidosAbertos: PedidoAbertoLeitura[] = [];
  for (const item of (itensRaw ?? []) as unknown as {
    id: number;
    pedido_id: number;
    quantidade: number;
    quantidade_recebida: number | null;
    quantidade_em: string | null;
    lote_id: number | null;
    pedidos_compra: { id: number; status: string; fornecedores: { nome: string | null } | { nome: string | null }[] | null } | null;
  }[]) {
    const recebido = Number(item.quantidade_recebida ?? (item.lote_id != null ? item.quantidade : 0));
    const pendente = Number(item.quantidade) - recebido;
    if (!(pendente > 0)) continue;
    pedidosAbertos.push({
      pedidoId: Number(item.pedido_id),
      itemId: Number(item.id),
      pendente,
      emEmbalagens: item.quantidade_em === "embalagem",
      fornecedor: primeiro(item.pedidos_compra?.fornecedores)?.nome ?? null,
    });
  }
  pedidosAbertos.sort((a, b) => a.pedidoId - b.pedidoId);

  return {
    id: Number(s.insumo_id),
    especificacao: s.especificacao ?? `Insumo #${s.insumo_id}`,
    unidadeSaldo: s.unidade_saldo ?? s.unidade ?? "",
    fechadas: modelo === "EMBALAGEM_FECHADA" ? fechadas : Number(s.em_maos ?? 0),
    modelo,
    proximaSaida: livres[0]
      ? { codigoLote: livres[0].codigo_lote ?? `Lote #${livres[0].id}`, validade: livres[0].validade }
      : null,
    motivoSemSaida,
    pedidosAbertos,
  };
}

const codigoSchema = z.string().trim().min(1, "Leia ou digite um código.").max(400, "Código longo demais.");

/** Identifica o insumo do código lido (sem registrar movimento). */
export async function identificarCodigoLeitura(codigoRaw: string): Promise<ResultadoIdentificacao> {
  const parsed = codigoSchema.safeParse(codigoRaw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Código inválido." };
  if (!(await pode("estoque.ver"))) return { ok: false, message: SEM_PERMISSAO };

  const codigo = parsed.data;
  const chave = chaveCodigoBarras(codigo);
  const validadeLida = lerGs1(codigo)?.validade ?? null;
  try {
    const supabase = await createClientUntyped();
    const { insumoId, outroCadastro } = await insumoDoCodigo(supabase, codigo);
    const insumo = insumoId ? await carregarInsumoLeitura(supabase, insumoId) : null;
    await registrarLeitura(supabase, codigo, insumo ? "encontrado" : "nao_encontrado", insumo?.id ?? null);
    if (!insumo) {
      return {
        ok: true,
        encontrado: false,
        codigo,
        chave,
        validadeLida,
        outroCadastro,
        message: outroCadastro
          ? `Este código é de ${outroCadastro}, não de um insumo.`
          : "Código não reconhecido. Vincule a um insumo para as próximas leituras serem automáticas.",
      };
    }
    return { ok: true, encontrado: true, codigo, chave, validadeLida, insumo };
  } catch (error) {
    return { ok: false, message: mensagemDoBanco(error, "Não foi possível identificar o código agora.") };
  }
}

const vincularSchema = z.object({
  codigo: codigoSchema,
  insumoId: z.number().int().positive("Escolha o insumo."),
});

/**
 * Aprendizado: vincula o código lido a um insumo existente. A próxima leitura
 * do mesmo código é reconhecida sozinha; a triagem pendente do código (aba
 * Códigos não reconhecidos) é resolvida junto.
 */
export async function vincularCodigoLeitura(input: {
  codigo: string;
  insumoId: number;
}): Promise<ResultadoIdentificacao> {
  const parsed = vincularSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique os campos." };
  if (!(await pode("insumos.editar"))) {
    return {
      ok: false,
      message: "Vincular código a insumo exige a permissão “Editar insumos”. Mande o código para a triagem.",
    };
  }
  const { codigo, insumoId } = parsed.data;
  if (!codigoBarrasValido(codigo)) return { ok: false, message: "Código inválido." };
  const chave = chaveCodigoBarras(codigo);

  try {
    const supabase = await createClientUntyped();
    if (!(await insumoAtivo(supabase, insumoId))) {
      return { ok: false, message: MENSAGEM_INSUMO_INATIVO };
    }
    const conflitos = await conflitosCodigos(supabase, insumoId, [chave]);
    if (conflitos.length > 0) return { ok: false, message: mensagemConflitos(conflitos) };
    const usuario = await usuarioAtual();
    const resultado = await sincronizarCodigosInsumo(supabase, insumoId, [chave], {
      remover: false,
      criadoPor: usuario?.email ?? usuario?.id ?? null,
    });
    if (resultado.erro) return { ok: false, message: resultado.erro };

    // Triagem pendente deste código: resolvida pelo mesmo vínculo.
    await supabase
      .from("cadastros_triagem")
      .update({
        status: "resolvido",
        entidade_tipo: "insumo",
        entidade_id: insumoId,
        resolvido_em: new Date().toISOString(),
      })
      .in("codigo_normalizado", [...new Set([normalizarCodigo(codigo), chave])])
      .in("status", ["pendente", "em_analise"]);

    revalidatePath("/scanner/triagem");
    revalidatePath("/cadastros/insumos");
    const insumo = await carregarInsumoLeitura(supabase, insumoId);
    if (!insumo) return { ok: false, message: "Insumo não encontrado." };
    return { ok: true, encontrado: true, codigo, chave, validadeLida: lerGs1(codigo)?.validade ?? null, insumo };
  } catch (error) {
    return { ok: false, message: mensagemDoBanco(error, "Não foi possível vincular o código agora.") };
  }
}

const dataSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
  .nullable();

const entradaSchema = z.object({
  codigo: codigoSchema,
  insumoId: z.number().int().positive(),
  quantidade: z
    .number({ error: "Informe a quantidade de embalagens." })
    .int("Use um número inteiro de embalagens.")
    .positive("Informe ao menos 1 embalagem.")
    .max(10_000, "Quantidade alta demais para uma leitura."),
  validade: dataSchema,
  localId: z.number().int().positive().nullable(),
  pedido: z.object({ pedidoId: z.number().int().positive(), itemId: z.number().int().positive() }).nullable(),
  operacaoId: z.string().regex(UUID_RE, "Operação inválida; leia o código de novo."),
});

type RespostaRpc = {
  insumo_id: number;
  especificacao: string | null;
  codigo_lote: string | null;
  validade: string | null;
  quantidade_embalagens: number;
  fechadas: number;
  pedido_id?: number | null;
  repetido?: boolean;
};

function movimento(tipo: "entrada" | "saida", operacaoId: string, r: RespostaRpc): ResultadoMovimentoLeitura {
  const quantidade = Number(r.quantidade_embalagens ?? 1);
  const especificacao = r.especificacao ?? `Insumo #${r.insumo_id}`;
  const embalagens = `${quantidade} ${quantidade === 1 ? "embalagem" : "embalagens"}`;
  const message = r.repetido
    ? "Esta leitura já estava registrada; nada foi lançado de novo."
    : tipo === "entrada"
      ? `Entrada registrada: ${embalagens} de ${especificacao}${r.pedido_id ? ` pelo pedido de compra #${r.pedido_id}` : ""}.`
      : `Abertura registrada: 1 embalagem de ${especificacao} saiu do estoque.`;
  return {
    ok: true,
    tipo,
    operacaoId,
    insumoId: Number(r.insumo_id),
    especificacao,
    codigoLote: r.codigo_lote ?? null,
    validade: r.validade ?? null,
    quantidade,
    fechadas: Number(r.fechadas ?? 0),
    pedidoId: r.pedido_id == null ? null : Number(r.pedido_id),
    repetido: Boolean(r.repetido),
    message,
  };
}

/** Entrada por leitura: avulsa (lote interno) ou pelo item do pedido em aberto. */
export async function registrarEntradaLeitura(input: z.input<typeof entradaSchema>): Promise<ResultadoMovimentoLeitura> {
  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique os campos." };
  const d = parsed.data;
  if (d.validade && d.validade < hojeIso()) {
    return { ok: false, message: "A validade informada já passou: material vencido não entra no estoque." };
  }
  if (!(await pode(d.pedido ? "compras.receber" : "estoque.movimentar"))) return { ok: false, message: SEM_PERMISSAO };

  try {
    const supabase = await createClientUntyped();
    if (!d.pedido && !(await insumoAtivo(supabase, d.insumoId))) {
      return { ok: false, message: MENSAGEM_INSUMO_INATIVO };
    }
    const { data, error } = d.pedido
      ? await supabase.rpc("registrar_recebimento_por_leitura" as never, {
          p_insumo_id: d.insumoId,
          p_pedido_id: d.pedido.pedidoId,
          p_item_id: d.pedido.itemId,
          p_quantidade_embalagens: d.quantidade,
          p_validade: d.validade,
          p_local_id: d.localId,
          p_codigo: d.codigo,
          p_operacao_id: d.operacaoId,
        } as never)
      : await supabase.rpc("registrar_entrada_por_leitura" as never, {
          p_insumo_id: d.insumoId,
          p_quantidade_embalagens: d.quantidade,
          p_validade: d.validade,
          p_local_id: d.localId,
          p_codigo: d.codigo,
          p_operacao_id: d.operacaoId,
        } as never);
    if (error) return { ok: false, message: mensagemDoBanco(error) };
    revalidarEstoque();
    if (d.pedido) revalidatePath(`/compras/${d.pedido.pedidoId}`);
    return movimento("entrada", d.operacaoId, data as unknown as RespostaRpc);
  } catch (error) {
    return { ok: false, message: mensagemDoBanco(error, "Não foi possível registrar a entrada agora.") };
  }
}

const saidaSchema = z.object({
  codigo: codigoSchema,
  insumoId: z.number().int().positive(),
  operacaoId: z.string().regex(UUID_RE, "Operação inválida; leia o código de novo."),
});

/** Saída por leitura: abertura de 1 embalagem do lote que vence primeiro. */
export async function registrarSaidaLeitura(input: z.input<typeof saidaSchema>): Promise<ResultadoMovimentoLeitura> {
  const parsed = saidaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique os campos." };
  if (!(await pode("estoque.movimentar"))) return { ok: false, message: SEM_PERMISSAO };
  const d = parsed.data;
  try {
    const supabase = await createClientUntyped();
    if (!(await insumoAtivo(supabase, d.insumoId))) {
      return { ok: false, message: MENSAGEM_INSUMO_INATIVO };
    }
    const { data, error } = await supabase.rpc("abrir_embalagem_por_leitura" as never, {
      p_insumo_id: d.insumoId,
      p_codigo: d.codigo,
      p_operacao_id: d.operacaoId,
    } as never);
    if (error) return { ok: false, message: mensagemDoBanco(error) };
    revalidarEstoque();
    return movimento("saida", d.operacaoId, data as unknown as RespostaRpc);
  } catch (error) {
    return { ok: false, message: mensagemDoBanco(error, "Não foi possível registrar a abertura agora.") };
  }
}

/** Desfaz a última leitura registrada (quem leu, até 2 horas; ou "Corrigir estoque"). */
export async function desfazerLeitura(operacaoId: string): Promise<{ ok: boolean; message: string }> {
  if (!UUID_RE.test(operacaoId)) return { ok: false, message: "Leitura inválida." };
  if (!(await pode("estoque.movimentar"))) return { ok: false, message: SEM_PERMISSAO };
  try {
    const supabase = await createClientUntyped();
    const { data, error } = await supabase.rpc("desfazer_leitura_estoque" as never, {
      p_operacao_id: operacaoId,
    } as never);
    if (error) return { ok: false, message: mensagemDoBanco(error) };
    revalidarEstoque();
    const r = (data ?? {}) as { tipo?: string; repetido?: boolean };
    if (r.repetido) return { ok: true, message: "Esta leitura já tinha sido desfeita." };
    return {
      ok: true,
      message: r.tipo === "saida" ? "Abertura desfeita: a embalagem voltou ao estoque." : "Entrada desfeita: o lote saiu do estoque.",
    };
  } catch (error) {
    return { ok: false, message: mensagemDoBanco(error, "Não foi possível desfazer agora.") };
  }
}
