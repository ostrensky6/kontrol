import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { empresaDeRegistro, type EmpresaEmissora } from "./empresas-emissoras";
import type { IdentidadeInstitucional } from "./identidade-institucional";
import type { SecaoPadrao } from "./textos-proposta";

type Cliente = Awaited<ReturnType<typeof createClient>>;

/**
 * Dados do documento que não estão nos itens: nomes das análises (catálogo),
 * cadastro da empresa emissora e seções padrão (0135). Falha de leitura não
 * derruba a tela: volta vazio e o documento usa o que tiver.
 */
export async function carregarComplementosDocumento(
  supabase: Cliente,
  args: { identidade: IdentidadeInstitucional; codigosAnalises: Array<string | null | undefined>; comSecoes?: boolean },
): Promise<{ nomesAnalises: Record<string, string>; empresa: EmpresaEmissora; secoesPadrao: SecaoPadrao[] }> {
  const codigos = [...new Set(args.codigosAnalises.filter((c): c is string => Boolean(c)))];
  const [analises, empresa, secoes] = await Promise.all([
    codigos.length
      ? supabase.from("analises").select("codigo, nome").in("codigo", codigos)
      : Promise.resolve({ data: [] as Array<{ codigo: string; nome: string | null }> }),
    supabase.from("empresas_emissoras").select("*").eq("codigo", args.identidade.id).maybeSingle(),
    args.comSecoes
      ? supabase
          .from("proposta_secoes_padrao")
          .select("chave, titulo, texto, ordem, ativo")
          .eq("empresa_codigo", args.identidade.id)
          .order("ordem")
      : Promise.resolve({ data: [] as SecaoPadrao[] }),
  ]);

  const nomesAnalises: Record<string, string> = {};
  for (const a of analises.data ?? []) if (a.nome?.trim()) nomesAnalises[a.codigo] = a.nome.trim();

  return {
    nomesAnalises,
    empresa: empresaDeRegistro(empresa.data, args.identidade),
    secoesPadrao: (secoes.data ?? []) as SecaoPadrao[],
  };
}
