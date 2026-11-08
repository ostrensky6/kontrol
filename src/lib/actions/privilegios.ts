"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";

import type { FormState } from "@/lib/actions/cadastros";
import { temPapel } from "@/lib/auth/roles";
import { PAPEIS, PERMISSOES, type PapelUsuario, type PermissaoUsuario } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type PapelEditavel = Exclude<PapelUsuario, "admin">;
type Categoria = { papel: string; permissoes: unknown; atualizado_em: string };
type CategoriaValida = Categoria & { permissoes: Record<string, boolean> };
type LinhaMatriz = { armazenadas: Record<PermissaoUsuario, boolean | null>; revisao: string };
type LeituraMatriz =
  | { ok: true; categorias: Record<PapelEditavel, LinhaMatriz> }
  | { ok: false; motivo: "sem_permissao" | "leitura"; message: string };
type ResultadoMatriz = FormState & { conflito?: true };

const EDITAVEIS = PAPEIS.map(({ value }) => value).filter((papel) => papel !== "admin");
const CHAVES = new Set<string>(PERMISSOES.map(({ key }) => key));
const CAMPOS = "papel, permissoes, atualizado_em";
const ERRO_LEITURA = "Não foi possível ler os privilégios armazenados. Recarregue a página antes de editar.";
const CONFLITO = "A categoria mudou desde a exibição. Recarregue a página e confira antes de salvar novamente.";

function categoriaValida(linha: Categoria | null | undefined): linha is CategoriaValida {
  return !!linha && typeof linha.atualizado_em === "string" && Number.isFinite(Date.parse(linha.atualizado_em))
    && linha.permissoes !== null && typeof linha.permissoes === "object" && !Array.isArray(linha.permissoes)
    && Object.values(linha.permissoes).every((valor) => typeof valor === "boolean");
}

function revisaoDa(linha: CategoriaValida): string {
  const chaves = Object.keys(linha.permissoes).sort();
  return createHash("sha256").update(JSON.stringify([
    linha.papel, linha.atualizado_em, chaves.map((chave) => [chave, linha.permissoes[chave]]),
  ])).digest("hex");
}

export async function obterMatrizPrivilegios(): Promise<LeituraMatriz> {
  try {
    if (!(await temPapel("admin"))) {
      return { ok: false, motivo: "sem_permissao", message: "Apenas administradores gerenciam privilégios." };
    }
    const supabase = await createClient();
    const { data, error } = await supabase.from("permissoes_categorias").select(CAMPOS);
    if (error || !data) return { ok: false, motivo: "leitura", message: ERRO_LEITURA };
    const categorias = {} as Record<PapelEditavel, LinhaMatriz>;
    for (const papel of EDITAVEIS) {
      const linha = data.find((item) => item.papel === papel);
      if (!categoriaValida(linha)) return { ok: false, motivo: "leitura", message: ERRO_LEITURA };
      categorias[papel] = {
        armazenadas: Object.fromEntries(PERMISSOES.map(({ key }) => [
          key, Object.hasOwn(linha.permissoes, key) ? linha.permissoes[key] : null,
        ])) as LinhaMatriz["armazenadas"],
        revisao: revisaoDa(linha),
      };
    }
    return { ok: true, categorias };
  } catch {
    return { ok: false, motivo: "leitura", message: ERRO_LEITURA };
  }
}

function lerIntencao(formData: FormData) {
  const campo = (nome: string) => {
    const entradas = formData.getAll(nome);
    return entradas.length === 1 && typeof entradas[0] === "string" ? entradas[0] : null;
  };
  const papel = EDITAVEIS.find((valor) => valor === campo("papel"));
  const revisao = campo("revisao");
  const bruto = campo("alteracoes");
  if (!papel || !revisao || !/^[a-f0-9]{64}$/.test(revisao) || bruto === null) return null;
  let pares: unknown;
  try { pares = JSON.parse(bruto); } catch { return null; }
  if (!Array.isArray(pares) || pares.length > CHAVES.size) return null;
  const alteracoes = new Map<string, boolean>();
  for (const par of pares) {
    if (!Array.isArray(par) || par.length !== 2) return null;
    const [chave, valor] = par;
    if (typeof chave !== "string" || !CHAVES.has(chave) || typeof valor !== "boolean" || alteracoes.has(chave)) return null;
    alteracoes.set(chave, valor);
  }
  return { papel, revisao, alteracoes };
}

/** Uma categoria por envio; ausência só muda por uma intenção explícita. */
export async function salvarMatrizPrivilegios(_prev: FormState, formData: FormData): Promise<ResultadoMatriz> {
  try {
    if (!(await temPapel("admin"))) return { ok: false, message: "Sem permissão para editar privilégios." };
    const intencao = lerIntencao(formData);
    if (!intencao) return { ok: false, message: "Alterações inválidas. Recarregue a página e tente novamente." };
    const { papel, revisao, alteracoes } = intencao;
    const supabase = await createClient();
    const { data: atual, error: erroLeitura } = await supabase.from("permissoes_categorias")
      .select(CAMPOS).eq("papel", papel).maybeSingle();
    if (erroLeitura || !categoriaValida(atual) || atual.papel !== papel) return { ok: false, message: ERRO_LEITURA };
    if (revisaoDa(atual) !== revisao) return { ok: false, conflito: true, message: CONFLITO };
    const mudancas = [...alteracoes].filter(([chave, valor]) => atual.permissoes[chave] !== valor);
    if (!mudancas.length) return { ok: true, message: "Nada mudou." };

    const { data, error } = await createAdminClient().from("permissoes_categorias")
      .update({ permissoes: { ...atual.permissoes, ...Object.fromEntries(mudancas) }, atualizado_em: new Date().toISOString() })
      .eq("papel", papel)
      .eq("atualizado_em", atual.atualizado_em)
      // Igualdade do JSONB inteiro, incluindo chaves fora do catálogo; não contém/subconjunto.
      .filter("permissoes", "eq", JSON.stringify(atual.permissoes))
      .select("papel");
    if (error) return { ok: false, message: "Não foi possível salvar os privilégios. Recarregue a página e tente novamente." };
    if (data?.length === 0) return { ok: false, conflito: true, message: CONFLITO };
    if (data?.length !== 1 || data[0].papel !== papel) {
      return { ok: false, message: "A gravação não pôde ser confirmada. Recarregue a página para conferir." };
    }

    revalidatePath("/governanca/privilegios");
    revalidatePath("/usuarios");
    return { ok: true, message: `Privilégios salvos: ${PAPEIS.find((item) => item.value === papel)?.label}.` };
  } catch {
    return { ok: false, message: "Não foi possível confirmar a operação. Recarregue a página para conferir." };
  }
}
