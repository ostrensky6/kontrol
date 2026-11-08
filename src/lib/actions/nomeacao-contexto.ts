"use server";

import "server-only";
import { z } from "zod";
import { unstable_rethrow } from "next/navigation";
import { createClientUntyped } from "@/lib/supabase/server";
import { isPapelUsuario, PAPEIS, type PapelUsuario } from "@/lib/auth/permissions";

const uuid = z.string().regex(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i).transform((v) => v.toLowerCase());
const consulta = z.object({
  apos_usuario_id: uuid.nullable().default(null),
  limite: z.number().int().min(1).max(100).default(50),
}).strict();
const papel = z.custom<PapelUsuario>(isPapelUsuario);
const pagina = z.object({
  itens: z.array(z.object({
    usuario_id: uuid, nome: z.string().nullable(), papel_atual_esperado: papel,
    suspenso: z.boolean(), senha_provisoria: z.boolean(),
    papeis_destino: z.array(papel).min(1).max(PAPEIS.length).refine((v) => new Set(v).size === v.length),
  }).strict()).max(100),
  proximo_usuario_id: uuid.nullable(),
}).strict();

export type PaginaContextoNomeacao = z.infer<typeof pagina>;
export type ResultadoContextoNomeacao =
  | { ok: true; estado: "PAGINA_CONFIRMADA" | "PAGINA_VAZIA"; pagina: PaginaContextoNomeacao }
  | { ok: false; codigo: "ENTRADA_INVALIDA" | "SESSAO_INVALIDA" | "ACESSO_NEGADO" | "CONTRATO_INVALIDO" | "FALHA_LEITURA"; message: string };

/** Foto da 0162, sem autorização local paralela ou dependência da flag de escrita.
 * Preserva destino igual ao papel atual: UI deve desabilitar esse no-op (action89
 * exige alterado=true). Coordenador recebe apenas Gestor -> Gestor, sem troca.
 * Encaminhar papel_atual_esperado ao CAS0151; a escrita reautoriza no backend.
 */
export async function listarContextoNomeacao(input: unknown = {}): Promise<ResultadoContextoNomeacao> {
  const negar = (codigo: Extract<ResultadoContextoNomeacao, { ok: false }>["codigo"]): ResultadoContextoNomeacao => ({
    ok: false, codigo, message: "Consulta de nomeação não confirmada. Falha não significa página vazia ou ausência de autorização.",
  });
  const q = consulta.safeParse(input);
  if (!q.success) return negar("ENTRADA_INVALIDA");
  try {
    const client = await createClientUntyped();
    const sessao = await client.auth.getUser();
    const ator = uuid.safeParse(sessao.data?.user?.id);
    if (sessao.error || !ator.success) return negar("SESSAO_INVALIDA");
    // A 0162 decide Admin/Supervisor/Coordenador, sessão viva e elegibilidade.
    // Não usar usuarios.gerenciar, projeto, metadados JWT ou hierarquia genérica.
    const { data, error } = await client.rpc("listar_contexto_nomeacao", {
      p_apos_usuario_id: q.data.apos_usuario_id, p_limite: q.data.limite,
    });
    if (error) return negar(error.code === "42501" ? "ACESSO_NEGADO"
      : error.code === "22023" ? "ENTRADA_INVALIDA" : "FALHA_LEITURA");
    const p = pagina.safeParse(data);
    if (!p.success || p.data.itens.length > q.data.limite) return negar("CONTRATO_INVALIDO");
    let anterior = q.data.apos_usuario_id;
    for (const item of p.data.itens) {
      if (item.usuario_id === ator.data || (anterior !== null && item.usuario_id <= anterior)) return negar("CONTRATO_INVALIDO");
      anterior = item.usuario_id;
    }
    if (p.data.proximo_usuario_id !== null && (p.data.itens.length !== q.data.limite
      || p.data.proximo_usuario_id !== anterior)) return negar("CONTRATO_INVALIDO");
    return { ok: true, estado: p.data.itens.length ? "PAGINA_CONFIRMADA" : "PAGINA_VAZIA", pagina: p.data };
  } catch (error) { unstable_rethrow(error); return negar("FALHA_LEITURA"); }
}
