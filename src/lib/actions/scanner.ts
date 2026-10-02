"use server";

import { unidadeDoLote } from "@/lib/inventario/contagem";
import { redirect } from "next/navigation";
import { z } from "zod";
import { usuarioAtual } from "@/lib/auth/roles";
import { createClientUntyped } from "@/lib/supabase/server";
import {
  destinoScanner,
  entidadeScannerParaTipo,
  entidadeTipoRotaCurta,
  parseRotaCurtaKontrol,
  type EntidadeScanner,
} from "@/lib/scanner/resolver";
import {
  normalizarCodigo,
  resolverIdentificadorInterno,
} from "@/lib/scanner/identificadores";
import { buscarIdentificadorAtivo } from "@/lib/scanner/vinculos-codigo";
import type { FormState } from "./cadastros";

function texto(formData: FormData, chave: string) {
  return String(formData.get(chave) ?? "").trim();
}

const TABELAS_ENTIDADE: Record<EntidadeScanner, string> = {
  lote: "lotes_estoque",
  insumo: "insumos",
  equipamento: "equipamentos",
  equipamento_unidade: "equipamento_unidades",
  local: "locais",
};

const resolverSchema = z.object({
  codigo: z.string().trim().min(1, "Código obrigatório."),
});

type ResultadoScan = "encontrado" | "nao_encontrado" | "erro";

export type ResultadoScannerRecebimento =
  | {
      ok: true;
      encontrado: true;
      codigo: string;
      tipo: "insumo" | "lote";
      id: number;
      insumoId: number;
      insumoDescricao: string | null;
      loteCodigo: string | null;
      validade: string | null;
      message: string;
    }
  | {
      ok: true;
      encontrado: false;
      codigo: string;
      triagemUrl: string;
      message: string;
    }
  | {
      ok: false;
      message: string;
    };

export type ResultadoScannerInventario =
  | {
      ok: true;
      encontrado: true;
      codigo: string;
      /** código de barras do fabricante: contagem por insumo (embalagens fechadas, sem lote) */
      tipo: "insumo";
      id: number;
      insumoDescricao: string | null;
      /** embalagens fechadas no sistema (mesmo "em mãos" do Controle de Estoque) */
      quantidadeAtual: number;
      unidade: string | null;
      porInsumo: boolean;
      message: string;
    }
  | {
      ok: true;
      encontrado: true;
      codigo: string;
      tipo: "local";
      id: number;
      nome: string | null;
      message: string;
    }
  | {
      ok: true;
      encontrado: true;
      codigo: string;
      tipo: "lote";
      id: number;
      loteCodigo: string | null;
      validade: string | null;
      quantidadeAtual: number;
      localId: number | null;
      localNome: string | null;
      insumoDescricao: string | null;
      unidade: string | null;
      message: string;
    }
  | {
      ok: true;
      encontrado: false;
      codigo: string;
      triagemUrl: string;
      message: string;
    }
  | {
      ok: false;
      message: string;
    };

export type ResultadoScannerPlanejamento =
  | {
      ok: true;
      encontrado: true;
      codigo: string;
      tipo: "lote";
      id: number;
      insumoId: number;
      loteCodigo: string | null;
      validade: string | null;
      validadeAposAbertura: string | null;
      quantidadeAtual: number;
      status: string;
      insumoDescricao: string | null;
      unidade: string | null;
      message: string;
    }
  | {
      ok: true;
      encontrado: false;
      codigo: string;
      triagemUrl: string;
      message: string;
    }
  | {
      ok: false;
      message: string;
    };

async function registrarEventoScan(args: {
  codigo: string;
  formato?: string | null;
  tipo?: EntidadeScanner | null;
  id?: number | null;
  resultado: ResultadoScan;
  acao?: string;
  contexto?: Record<string, unknown>;
}) {
  try {
    const usuario = await usuarioAtual();
    const supabase = await createClientUntyped();
    await supabase.from("scan_eventos").insert({
      codigo: args.codigo,
      // coluna obrigatória da 0067; sem ela nenhuma leitura ficava registrada
      valor_lido: args.codigo,
      formato: args.formato ?? null,
      entidade_tipo: args.tipo ? entidadeScannerParaTipo(args.tipo) : null,
      entidade_id: args.id ?? null,
      acao: args.acao ?? "buscar",
      resultado: args.resultado,
      contexto: {
        ...args.contexto,
        codigo_normalizado: normalizarCodigo(args.codigo),
      },
      usuario: usuario?.email ?? usuario?.id ?? null,
    });
  } catch {
    // Registro de auditoria nao deve bloquear a resolucao/redirect principal.
  }
}

export async function entidadeEscaneavelExiste(
  tipo: EntidadeScanner,
  id: number,
) {
  if (!Number.isInteger(id) || id <= 0) return false;
  const supabase = await createClientUntyped();
  const { data } = await supabase
    .from(TABELAS_ENTIDADE[tipo])
    .select("id")
    .eq("id", id)
    .maybeSingle();

  return Boolean(data);
}

async function resolverCodigo(codigo: string): Promise<{
  tipo: EntidadeScanner;
  id: number;
  formato: string;
} | null> {
  const rota = parseRotaCurtaKontrol(codigo);
  if (rota) return { ...rota, formato: "url_kontrol" };

  const supabase = await createClientUntyped();
  // EAN-13, GTIN-14 e GS1 com lote/validade do mesmo produto caem no mesmo vínculo
  const data = await buscarIdentificadorAtivo(supabase, codigo);

  const tipo = data?.entidade_tipo ? entidadeTipoRotaCurta(String(data.entidade_tipo)) : null;
  const id = Number(data?.entidade_id);
  if (tipo && Number.isInteger(id) && id > 0) {
    return { tipo, id, formato: "identificador" };
  }

  const interno = resolverIdentificadorInterno(codigo);
  const tipoInterno = interno ? entidadeTipoRotaCurta(interno.entidadeTipo) : null;
  if (interno && tipoInterno) {
    return {
      tipo: tipoInterno,
      id: interno.entidadeId,
      formato: "kontrol_interno",
    };
  }

  return null;
}

async function detalheRecebimento(tipo: EntidadeScanner, id: number) {
  const supabase = await createClientUntyped();

  if (tipo === "insumo") {
    const { data } = await supabase
      .from("insumos")
      .select("id, especificacao")
      .eq("id", id)
      .maybeSingle();

    if (!data?.id) return null;

    return {
      tipo: "insumo" as const,
      id: Number(data.id),
      insumoId: Number(data.id),
      insumoDescricao: data.especificacao ? String(data.especificacao) : null,
      loteCodigo: null,
      validade: null,
    };
  }

  if (tipo === "lote") {
    const { data } = await supabase
      .from("lotes_estoque")
      .select("id, codigo_lote, validade, insumo_id, insumos(especificacao)")
      .eq("id", id)
      .maybeSingle();
    const insumoId = Number(data?.insumo_id);
    if (!data?.id || !Number.isInteger(insumoId) || insumoId <= 0) return null;

    const insumoRaw = data.insumos as
      | { especificacao: string | null }
      | { especificacao: string | null }[]
      | null;
    const insumo = Array.isArray(insumoRaw) ? (insumoRaw[0] ?? null) : insumoRaw;

    return {
      tipo: "lote" as const,
      id: Number(data.id),
      insumoId,
      insumoDescricao: insumo?.especificacao ?? null,
      loteCodigo: data.codigo_lote ? String(data.codigo_lote) : null,
      validade: data.validade ? String(data.validade) : null,
    };
  }

  return null;
}

async function detalheInventario(tipo: EntidadeScanner, id: number) {
  const supabase = await createClientUntyped();

  if (tipo === "insumo") {
    const { data } = await supabase
      .from("v_estoque_saldo")
      .select("insumo_id, especificacao, em_maos, unidade_saldo, modelo_quantidade")
      .eq("insumo_id", id)
      .maybeSingle();
    if (!data?.insumo_id) return null;
    // contagem sem lote = embalagens fechadas aceitas (mesma soma que o ajuste usa)
    const { data: fechados } = await supabase
      .from("lotes_estoque")
      .select("quantidade_atual")
      .eq("insumo_id", id)
      .eq("status", "aceito")
      .eq("modelo_quantidade", "EMBALAGEM_FECHADA");
    const fechadas = ((fechados ?? []) as { quantidade_atual: number | null }[]).reduce(
      (soma, lote) => soma + Number(lote.quantidade_atual ?? 0),
      0,
    );
    return {
      tipo: "insumo" as const,
      id: Number(data.insumo_id),
      insumoDescricao: data.especificacao ? String(data.especificacao) : null,
      quantidadeAtual: data.modelo_quantidade === "EMBALAGEM_FECHADA" ? fechadas : Number(data.em_maos ?? 0),
      unidade: data.unidade_saldo ? String(data.unidade_saldo) : null,
      porInsumo: data.modelo_quantidade === "EMBALAGEM_FECHADA",
    };
  }

  if (tipo === "local") {
    const { data } = await supabase
      .from("locais")
      .select("id, nome")
      .eq("id", id)
      .maybeSingle();

    if (!data?.id) return null;

    return {
      tipo: "local" as const,
      id: Number(data.id),
      nome: data.nome ? String(data.nome) : null,
    };
  }

  if (tipo === "lote") {
    const { data } = await supabase
      .from("lotes_estoque")
      .select("id, codigo_lote, validade, quantidade_atual, local_id, modelo_quantidade, conteudo_embalagem_snapshot, unidade_fisica_snapshot, locais(nome), insumos(especificacao, unidade)")
      .eq("id", id)
      .maybeSingle();

    if (!data?.id) return null;

    const localRaw = data.locais as { nome: string | null } | { nome: string | null }[] | null;
    const local = Array.isArray(localRaw) ? (localRaw[0] ?? null) : localRaw;
    const insumoRaw = data.insumos as
      | { especificacao: string | null; unidade: string | null }
      | { especificacao: string | null; unidade: string | null }[]
      | null;
    const insumo = Array.isArray(insumoRaw) ? (insumoRaw[0] ?? null) : insumoRaw;

    return {
      tipo: "lote" as const,
      id: Number(data.id),
      loteCodigo: data.codigo_lote ? String(data.codigo_lote) : null,
      validade: data.validade ? String(data.validade) : null,
      quantidadeAtual: Number(data.quantidade_atual ?? 0),
      localId: data.local_id == null ? null : Number(data.local_id),
      localNome: local?.nome ?? null,
      insumoDescricao: insumo?.especificacao ?? null,
      // mesma unidade do Controle de Estoque ("frasco(s) de 1000 Un")
      unidade: unidadeDoLote(data, insumo?.unidade ?? null),
    };
  }

  return null;
}

async function detalhePlanejamento(tipo: EntidadeScanner, id: number) {
  if (tipo !== "lote") return null;
  const supabase = await createClientUntyped();
  const { data } = await supabase
    .from("lotes_estoque")
    .select("id, codigo_lote, validade, validade_apos_abertura, quantidade_atual, status, insumo_id, insumos(especificacao, unidade)")
    .eq("id", id)
    .maybeSingle();

  const insumoId = Number(data?.insumo_id);
  if (!data?.id || !Number.isInteger(insumoId) || insumoId <= 0) return null;

  const insumoRaw = data.insumos as
    | { especificacao: string | null; unidade: string | null }
    | { especificacao: string | null; unidade: string | null }[]
    | null;
  const insumo = Array.isArray(insumoRaw) ? (insumoRaw[0] ?? null) : insumoRaw;

  return {
    tipo: "lote" as const,
    id: Number(data.id),
    insumoId,
    loteCodigo: data.codigo_lote ? String(data.codigo_lote) : null,
    validade: data.validade ? String(data.validade) : null,
    validadeAposAbertura: data.validade_apos_abertura ? String(data.validade_apos_abertura) : null,
    quantidadeAtual: Number(data.quantidade_atual ?? 0),
    status: String(data.status ?? ""),
    insumoDescricao: insumo?.especificacao ?? null,
    unidade: insumo?.unidade ?? null,
  };
}

export async function resolverCodigoRecebimentoInterno(
  codigoRaw: string,
): Promise<ResultadoScannerRecebimento> {
  const parsed = resolverSchema.safeParse({ codigo: codigoRaw });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Código inválido." };
  }

  const { codigo } = parsed.data;
  const resolvido = await resolverCodigo(codigo);
  if (!resolvido) {
    await registrarEventoScan({
      codigo,
      resultado: "nao_encontrado",
      acao: "recebimento_interno",
      contexto: { origem: "recebimento_interno" },
    });
    return {
      ok: true,
      encontrado: false,
      codigo,
      triagemUrl: `/scanner/desconhecido?codigo=${encodeURIComponent(codigo)}`,
      message: "Código não encontrado. Encaminhe para triagem antes de receber.",
    };
  }

  const detalhe = await detalheRecebimento(resolvido.tipo, resolvido.id);
  await registrarEventoScan({
    codigo,
    formato: resolvido.formato,
    tipo: resolvido.tipo,
    id: resolvido.id,
    resultado: detalhe ? "encontrado" : "nao_encontrado",
    acao: "recebimento_interno",
    contexto: { origem: "recebimento_interno" },
  });

  if (!detalhe) {
    return {
      ok: true,
      encontrado: false,
      codigo,
      triagemUrl: `/scanner/desconhecido?codigo=${encodeURIComponent(codigo)}`,
      message:
        resolvido.tipo === "insumo" || resolvido.tipo === "lote"
          ? "O item escaneado não está disponível para recebimento."
          : "Este código não corresponde a um insumo ou lote que possa ser recebido.",
    };
  }

  return {
    ok: true,
    encontrado: true,
    codigo,
    ...detalhe,
    message:
      detalhe.tipo === "lote"
        ? "Lote identificado. Confira os campos antes de confirmar."
        : "Insumo identificado. Confira os campos antes de confirmar.",
  };
}

export async function resolverCodigoInventario(
  codigoRaw: string,
): Promise<ResultadoScannerInventario> {
  const parsed = resolverSchema.safeParse({ codigo: codigoRaw });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Código inválido." };
  }

  const { codigo } = parsed.data;
  const resolvido = await resolverCodigo(codigo);
  if (!resolvido) {
    await registrarEventoScan({
      codigo,
      resultado: "nao_encontrado",
      acao: "inventario",
      contexto: { origem: "inventario" },
    });
    return {
      ok: true,
      encontrado: false,
      codigo,
      triagemUrl: `/scanner/desconhecido?codigo=${encodeURIComponent(codigo)}`,
      message: "Código não encontrado. Encaminhe para triagem antes de contar.",
    };
  }

  const detalhe = await detalheInventario(resolvido.tipo, resolvido.id);
  await registrarEventoScan({
    codigo,
    formato: resolvido.formato,
    tipo: resolvido.tipo,
    id: resolvido.id,
    resultado: detalhe ? "encontrado" : "nao_encontrado",
    acao: "inventario",
    contexto: { origem: "inventario" },
  });

  if (!detalhe) {
    return {
      ok: true,
      encontrado: false,
      codigo,
      triagemUrl: `/scanner/desconhecido?codigo=${encodeURIComponent(codigo)}`,
      message:
        resolvido.tipo === "local" || resolvido.tipo === "lote" || resolvido.tipo === "insumo"
          ? "O item escaneado não está disponível para inventário."
          : "Este código não corresponde a um local, insumo ou lote contável.",
    };
  }

  return {
    ok: true,
    encontrado: true,
    codigo,
    ...detalhe,
    message:
      detalhe.tipo === "local"
        ? "Local identificado para a contagem."
        : detalhe.tipo === "insumo"
          ? detalhe.porInsumo
            ? "Insumo identificado. Conte as embalagens fechadas (sem separar por lote)."
            : "Este insumo ainda é controlado por volume: leia a etiqueta do lote para contar."
          : "Lote identificado. Informe a quantidade contada antes de salvar.",
  };
}

export async function resolverCodigoPlanejamento(
  codigoRaw: string,
): Promise<ResultadoScannerPlanejamento> {
  const parsed = resolverSchema.safeParse({ codigo: codigoRaw });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Código inválido." };
  }

  const { codigo } = parsed.data;
  const resolvido = await resolverCodigo(codigo);
  if (!resolvido) {
    await registrarEventoScan({
      codigo,
      resultado: "nao_encontrado",
      acao: "planejamento_conferencia",
      contexto: { origem: "planejamento_conferencia" },
    });
    return {
      ok: true,
      encontrado: false,
      codigo,
      triagemUrl: `/scanner/desconhecido?codigo=${encodeURIComponent(codigo)}`,
      message: "Código não encontrado. Encaminhe para triagem antes da baixa.",
    };
  }

  const detalhe = await detalhePlanejamento(resolvido.tipo, resolvido.id);
  await registrarEventoScan({
    codigo,
    formato: resolvido.formato,
    tipo: resolvido.tipo,
    id: resolvido.id,
    resultado: detalhe ? "encontrado" : "nao_encontrado",
    acao: "planejamento_conferencia",
    contexto: { origem: "planejamento_conferencia" },
  });

  if (!detalhe) {
    return {
      ok: true,
      encontrado: false,
      codigo,
      triagemUrl: `/scanner/desconhecido?codigo=${encodeURIComponent(codigo)}`,
      message:
        resolvido.tipo === "lote"
          ? "O lote escaneado não está disponível para conferência."
          : "Este código não corresponde a um lote físico.",
    };
  }

  return {
    ok: true,
    encontrado: true,
    codigo,
    ...detalhe,
    message: "Lote identificado. Confira se corresponde ao insumo esperado antes de registrar.",
  };
}

export async function resolverCodigoEscaneado(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resolverSchema.safeParse({
    codigo: texto(formData, "codigo") || texto(formData, "valor_lido"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Código inválido." };
  }

  const { codigo } = parsed.data;
  const resolvido = await resolverCodigo(codigo);
  if (!resolvido) {
    await registrarEventoScan({
      codigo,
      resultado: "nao_encontrado",
      contexto: { origem: "resolver_codigo" },
    });
    redirect(`/scanner/desconhecido?codigo=${encodeURIComponent(codigo)}`);
  }

  const existe = await entidadeEscaneavelExiste(resolvido.tipo, resolvido.id);
  await registrarEventoScan({
    codigo,
    formato: resolvido.formato,
    tipo: resolvido.tipo,
    id: resolvido.id,
    resultado: existe ? "encontrado" : "nao_encontrado",
    contexto: { origem: "resolver_codigo" },
  });

  if (!existe) {
    redirect(`/scanner/desconhecido?codigo=${encodeURIComponent(codigo)}`);
  }
  redirect(destinoScanner(resolvido.tipo, resolvido.id));
}
