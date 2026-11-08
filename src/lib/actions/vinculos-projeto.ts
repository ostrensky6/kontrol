"use server";

import { z } from "zod";
import { unstable_rethrow } from "next/navigation";
import { createClientUntyped } from "@/lib/supabase/server";

const uuid = z.string().regex(/^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/).transform((v) => v.toLowerCase());
const entrada = z.object({
  projeto_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  usuario_id: uuid,
  vinculado: z.boolean(),
}).strict();
const recibo = entrada.extend({ alterado: z.boolean(), coordenacao_direta: z.boolean() }).strict();

export type VinculoProjetoResultado =
  | { ok: true; recibo: z.infer<typeof recibo> }
  | { ok: false; codigo: "ESCRITA_DESLIGADA" | "ENTRADA_INVALIDA" | "NAO_AUTORIZADO" | "NAO_CONFIRMADO"; message: string };

/** Só altera a membresia explícita. A 0151 valida sessão ativa e Admin sob lock.
 * Habilitação server-side somente após E2; nenhuma configuração é gravada aqui.
 * O consumidor deve reler a projeção autorizada; não inferir acesso efetivo do recibo.
 */
export async function configurarVinculoProjeto(input: unknown): Promise<VinculoProjetoResultado> {
  if (process.env.KONTROL_VINCULOS_PROJETO_ESCRITA !== "1") {
    return { ok: false, codigo: "ESCRITA_DESLIGADA", message: "Alteração de vínculos indisponível até validação da integração." };
  }
  const validada = entrada.safeParse(input);
  if (!validada.success) return { ok: false, codigo: "ENTRADA_INVALIDA", message: "Informe projeto, usuário e vínculo válidos, sem campos adicionais." };
  const naoConfirmado: VinculoProjetoResultado = {
    ok: false, codigo: "NAO_CONFIRMADO",
    message: "Alteração não confirmada. Consulte o estado autorizado antes de tentar novamente.",
  };
  try {
    const client = await createClientUntyped();
    const sessao = await client.auth.getUser();
    if (sessao.error || !sessao.data?.user?.id) {
      return { ok: false, codigo: "NAO_AUTORIZADO", message: "É necessária uma sessão de Administrador apto." };
    }
    const perfil = await client.from("perfis").select("id,papel,suspenso,senha_provisoria")
      .eq("id", sessao.data.user.id).maybeSingle();
    if (perfil.error || perfil.data?.id !== sessao.data.user.id || perfil.data?.papel !== "admin"
      || perfil.data?.suspenso !== false || perfil.data?.senha_provisoria !== false) {
      return { ok: false, codigo: "NAO_AUTORIZADO", message: "É necessária uma sessão de Administrador apto." };
    }
    const pedido = validada.data;
    const { data, error } = await client.rpc("configurar_vinculo_projeto", {
      p_projeto_id: pedido.projeto_id, p_usuario_id: pedido.usuario_id, p_vinculado: pedido.vinculado,
    });
    const confirmado = recibo.safeParse(data);
    if (error || !confirmado.success || confirmado.data.projeto_id !== pedido.projeto_id
      || confirmado.data.usuario_id !== pedido.usuario_id || confirmado.data.vinculado !== pedido.vinculado) {
      return naoConfirmado;
    }
    return { ok: true, recibo: confirmado.data };
  } catch (error) {
    unstable_rethrow(error);
    return naoConfirmado;
  }
}

const consultaVinculos = z.object({
  projeto_id: entrada.shape.projeto_id,
  apos_usuario_id: uuid.nullable().default(null),
  limite: z.number().int().min(1).max(100).default(50),
}).strict();
const paginaVinculos = z.object({
  projeto_id: entrada.shape.projeto_id,
  itens: z.array(z.object({
    usuario_id: uuid, nome: z.string().nullable(),
    papel: z.enum(["laboratorio", "compra", "cadastro", "coordenador", "gestor", "supervisor", "admin"]),
    suspenso: z.boolean(), senha_provisoria: z.boolean(), vinculado: z.boolean(), coordenacao_direta: z.boolean(),
  }).strict()).max(100),
  proximo_usuario_id: uuid.nullable(),
}).strict();
export type PaginaVinculosProjeto = z.infer<typeof paginaVinculos>;
export type LeituraVinculosProjeto =
  | { ok: true; estado: "PAGINA_VAZIA" | "PAGINA_CONFIRMADA"; pagina: PaginaVinculosProjeto; escrita_habilitada: boolean }
  | { ok: false; codigo: "ENTRADA_INVALIDA" | "NAO_AUTORIZADO" | "PROJETO_INEXISTENTE" | "RESPOSTA_INVALIDA" | "FALHA_LEITURA"; message: string };

/** Usar projeto.id confirmado pela rota existente /projetos/[id].
 * Página não é catálogo completo: ausência nela nunca prova desvínculo.
 * Papel alterado com vinculado=true é removível, não concede nova elegibilidade.
 */
export async function listarVinculosProjeto(input: unknown): Promise<LeituraVinculosProjeto> {
  const negar = (codigo: Extract<LeituraVinculosProjeto, { ok: false }>["codigo"]): LeituraVinculosProjeto => ({
    ok: false, codigo, message: "Leitura dos vínculos não confirmada. Não interprete falha como lista vazia.",
  });
  const consulta = consultaVinculos.safeParse(input);
  if (!consulta.success) return negar("ENTRADA_INVALIDA");
  try {
    const client = await createClientUntyped();
    const sessao = await client.auth.getUser();
    const ator = uuid.safeParse(sessao.data?.user?.id);
    if (sessao.error || !ator.success) return negar("NAO_AUTORIZADO");
    const perfil = await client.from("perfis").select("id,papel,suspenso,senha_provisoria")
      .eq("id", ator.data).maybeSingle();
    if (perfil.error || perfil.data?.id !== ator.data || perfil.data?.papel !== "admin"
      || perfil.data?.suspenso !== false || perfil.data?.senha_provisoria !== false) return negar("NAO_AUTORIZADO");
    const q = consulta.data;
    const { data, error } = await client.rpc("listar_vinculos_projeto", {
      p_projeto_id: q.projeto_id, p_apos_usuario_id: q.apos_usuario_id, p_limite: q.limite,
    });
    if (error) return negar(error.code === "42501" ? "NAO_AUTORIZADO" : error.code === "P0002"
      ? "PROJETO_INEXISTENTE" : error.code === "22023" ? "ENTRADA_INVALIDA" : "FALHA_LEITURA");
    const parsed = paginaVinculos.safeParse(data);
    if (!parsed.success || parsed.data.projeto_id !== q.projeto_id || parsed.data.itens.length > q.limite) return negar("RESPOSTA_INVALIDA");
    const pagina = parsed.data;
    let anterior = q.apos_usuario_id;
    for (const item of pagina.itens) {
      if ((anterior !== null && item.usuario_id <= anterior)
        || (!item.vinculado && item.papel !== "coordenador" && item.papel !== "gestor")
        || (item.coordenacao_direta && item.papel !== "coordenador")) return negar("RESPOSTA_INVALIDA");
      anterior = item.usuario_id;
    }
    if (pagina.proximo_usuario_id !== null && (pagina.itens.length !== q.limite
      || pagina.proximo_usuario_id !== anterior)) return negar("RESPOSTA_INVALIDA");
    return { ok: true, estado: pagina.itens.length ? "PAGINA_CONFIRMADA" : "PAGINA_VAZIA", pagina,
      escrita_habilitada: process.env.KONTROL_VINCULOS_PROJETO_ESCRITA === "1" };
  } catch (error) { unstable_rethrow(error); return negar("FALHA_LEITURA"); }
}
