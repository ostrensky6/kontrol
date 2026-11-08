"use server";

import { revalidatePath } from "next/cache";
import { createClientUntyped } from "@/lib/supabase/server";
import { mensagemDoBanco, type EstadoAcao } from "@/lib/erros";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Liga ou desliga um Coordenador/Gestor de um projeto (0151/0160). Só o Admin. */
export async function alterarVinculoProjeto(_prev: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const projetoTexto = String(form.get("projeto_id") ?? "").trim();
  const usuario = String(form.get("usuario_id") ?? "").trim();
  const vinculado = String(form.get("vinculado") ?? "");
  if (!/^\d+$/.test(projetoTexto) || !UUID.test(usuario) || (vinculado !== "1" && vinculado !== "0")) {
    return { ok: false, message: "Pedido inválido. Recarregue a página." };
  }
  const supabase = await createClientUntyped();
  const { error } = await supabase.rpc("configurar_vinculo_projeto", {
    p_projeto_id: Number(projetoTexto),
    p_usuario_id: usuario,
    p_vinculado: vinculado === "1",
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidatePath(`/projetos/${projetoTexto}`);
  return { ok: true, message: vinculado === "1" ? "Pessoa ligada ao projeto." : "Pessoa desligada do projeto." };
}
