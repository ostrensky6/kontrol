import "server-only";
import type { createClientUntyped } from "@/lib/supabase/server";
import { mensagemDoBanco } from "@/lib/erros";
import { chaveCodigoBarras, variantesCodigoBarras } from "@/lib/scanner/codigo-barras";

/**
 * Vínculo código de barras ↔ insumo na tabela identificadores (0067/0068): um
 * insumo pode ter vários códigos; um código ativo aponta para um só cadastro.
 * Usado pelo cadastro de insumos, pela planilha e pela leitura no estoque,
 * para que os três caminhos gravem igual.
 */
type Supabase = Awaited<ReturnType<typeof createClientUntyped>>;

export type IdentificadorAtivo = {
  id: number;
  codigo: string;
  entidade_tipo: string;
  entidade_id: number;
};

export async function buscarIdentificadorAtivo(
  supabase: Supabase,
  bruto: string,
): Promise<IdentificadorAtivo | null> {
  const variantes = variantesCodigoBarras(bruto);
  if (variantes.length === 0) return null;
  const { data } = await supabase
    .from("identificadores")
    .select("id, codigo, codigo_normalizado, entidade_tipo, entidade_id")
    .in("codigo_normalizado", variantes)
    .eq("ativo", true)
    .limit(5);
  const linhas = (data ?? []) as (IdentificadorAtivo & { codigo_normalizado: string })[];
  // a forma exata vence as equivalentes (GTIN-14 × EAN-13)
  const linha = linhas.find((l) => l.codigo_normalizado === variantes[0]) ?? linhas[0];
  return linha
    ? { id: Number(linha.id), codigo: linha.codigo, entidade_tipo: linha.entidade_tipo, entidade_id: Number(linha.entidade_id) }
    : null;
}

/** Códigos de barras ativos por insumo (id → códigos), na ordem de cadastro. */
export async function codigosBarrasPorInsumo(supabase: Supabase): Promise<Map<string, string[]>> {
  const { data } = await supabase
    .from("identificadores")
    .select("codigo, entidade_id, formato, criado_em")
    .eq("entidade_tipo", "insumo")
    .eq("ativo", true)
    .order("criado_em", { ascending: true });
  const mapa = new Map<string, string[]>();
  for (const linha of (data ?? []) as { codigo: string; entidade_id: number; formato: string | null }[]) {
    if (linha.formato === "kontrol_interno" || linha.formato === "url_kontrol") continue;
    const chave = String(linha.entidade_id);
    mapa.set(chave, [...(mapa.get(chave) ?? []), linha.codigo]);
  }
  return mapa;
}

export type ConflitoCodigo = { codigo: string; descricao: string };

/** Códigos que já pertencem a outro cadastro ativo (não podem ser vinculados). */
export async function conflitosCodigos(
  supabase: Supabase,
  insumoId: number | null,
  codigos: string[],
): Promise<ConflitoCodigo[]> {
  const conflitos: ConflitoCodigo[] = [];
  for (const codigo of codigos) {
    const existente = await buscarIdentificadorAtivo(supabase, codigo);
    if (!existente) continue;
    if (existente.entidade_tipo === "insumo" && existente.entidade_id === insumoId) continue;
    let descricao = `${existente.entidade_tipo} #${existente.entidade_id}`;
    if (existente.entidade_tipo === "insumo") {
      const { data } = await supabase
        .from("insumos")
        .select("especificacao")
        .eq("id", existente.entidade_id)
        .maybeSingle();
      descricao = (data as { especificacao?: string | null } | null)?.especificacao ?? `insumo #${existente.entidade_id}`;
    }
    conflitos.push({ codigo, descricao });
  }
  return conflitos;
}

export function mensagemConflitos(conflitos: ConflitoCodigo[]) {
  return conflitos
    .map((c) => `O código ${c.codigo} já está vinculado a “${c.descricao}”.`)
    .join(" ");
}

/**
 * Grava os códigos do insumo. `remover`: desativa os que saíram da lista (o
 * formulário manda a lista inteira); a planilha só acrescenta. Desativar
 * preserva o histórico (nada é apagado).
 */
export async function sincronizarCodigosInsumo(
  supabase: Supabase,
  insumoId: number,
  codigos: string[],
  opcoes: { remover: boolean; criadoPor: string | null; origem?: "fabricante" | "manual" },
): Promise<{ adicionados: number; removidos: number; erro: string | null }> {
  const desejados = [...new Set(codigos.map(chaveCodigoBarras).filter(Boolean))];
  const { data: atuaisRaw, error: erroLeitura } = await supabase
    .from("identificadores")
    .select("id, codigo_normalizado, formato")
    .eq("entidade_tipo", "insumo")
    .eq("entidade_id", insumoId)
    .eq("ativo", true);
  if (erroLeitura) return { adicionados: 0, removidos: 0, erro: mensagemDoBanco(erroLeitura) };
  const atuais = ((atuaisRaw ?? []) as { id: number; codigo_normalizado: string; formato: string | null }[]).filter(
    (linha) => linha.formato !== "kontrol_interno" && linha.formato !== "url_kontrol",
  );
  const atuaisPorChave = new Map(atuais.map((linha) => [chaveCodigoBarras(linha.codigo_normalizado), linha]));

  let removidos = 0;
  if (opcoes.remover) {
    const sair = atuais.filter((linha) => !desejados.includes(chaveCodigoBarras(linha.codigo_normalizado)));
    if (sair.length > 0) {
      const { error } = await supabase
        .from("identificadores")
        .update({ ativo: false })
        .in(
          "id",
          sair.map((linha) => linha.id),
        );
      if (error) return { adicionados: 0, removidos: 0, erro: mensagemDoBanco(error) };
      removidos = sair.length;
    }
  }

  const novos = desejados.filter((codigo) => !atuaisPorChave.has(codigo));
  if (novos.length > 0) {
    const { error } = await supabase.from("identificadores").insert(
      novos.map((codigo) => ({
        tipo: "codigo_barras",
        valor: codigo,
        codigo,
        codigo_normalizado: codigo,
        formato: "codigo_barras",
        entidade_tipo: "insumo",
        entidade_id: insumoId,
        origem: opcoes.origem ?? "fabricante",
        metadata: {},
        ativo: true,
        criado_por: opcoes.criadoPor,
      })),
    );
    if (error) {
      return {
        adicionados: 0,
        removidos,
        erro:
          error.code === "23505"
            ? "Um dos códigos de barras já está vinculado a outro cadastro."
            : mensagemDoBanco(error),
      };
    }
  }

  return { adicionados: novos.length, removidos, erro: null };
}
