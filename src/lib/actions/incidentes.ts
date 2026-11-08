"use server";

import { revalidatePath } from "next/cache";
import { createClientUntyped } from "@/lib/supabase/server";
import { mensagemDoBanco, type EstadoAcao } from "@/lib/erros";

const DESTINOS = new Set(["laboratorio", "coordenador", "gestor", "supervisor", "admin"]);
const SITUACOES = new Set(["aberto", "em_andamento", "resolvido"]);

function texto(form: FormData, campo: string) {
  return String(form.get(campo) ?? "").trim();
}

/** Registra um incidente e avisa quem foi afetado (0162). */
export async function registrarIncidente(_prev: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const titulo = texto(form, "titulo");
  const descricao = texto(form, "descricao");
  const afetados = texto(form, "afetados");
  const orientacao = texto(form, "orientacao");
  const causa = texto(form, "causa");
  const destino = texto(form, "papel_destino") || "laboratorio";
  const errors: Record<string, string> = {};
  if (titulo.length < 3 || titulo.length > 200) errors.titulo = "Dê um título de 3 a 200 letras.";
  if (!descricao || descricao.length > 2000) errors.descricao = "Conte o que aconteceu (até 2000 letras).";
  if (!afetados || afetados.length > 500) errors.afetados = "Diga quem ou o que foi afetado.";
  if (!orientacao || orientacao.length > 2000) errors.orientacao = "Diga o que as pessoas devem fazer enquanto isso.";
  if (causa.length > 2000) errors.causa = "A causa passa de 2000 letras.";
  if (!DESTINOS.has(destino)) errors.papel_destino = "Escolha quem recebe o aviso.";
  if (Object.keys(errors).length > 0) return { ok: false, message: "Confira os campos marcados.", errors };

  const supabase = await createClientUntyped();
  const { error } = await supabase.rpc("registrar_incidente", {
    p_titulo: titulo,
    p_descricao: descricao,
    p_afetados: afetados,
    p_orientacao: orientacao,
    p_causa: causa || null,
    p_papel_destino: destino,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidatePath("/governanca/incidentes");
  revalidatePath("/", "layout");
  return { ok: true, message: "Incidente registrado e aviso enviado." };
}

/** Registra um passo do acompanhamento (situação, nota, causa e orientação). */
export async function atualizarIncidente(_prev: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const id = texto(form, "incidente_id");
  const situacao = texto(form, "situacao");
  const nota = texto(form, "nota");
  const causa = texto(form, "causa");
  const orientacao = texto(form, "orientacao");
  if (!/^\d+$/.test(id) || !SITUACOES.has(situacao)) {
    return { ok: false, message: "Pedido inválido. Recarregue a página." };
  }
  if (!nota || nota.length > 2000) return { ok: false, message: "Escreva o que mudou (até 2000 letras)." };
  if (causa.length > 2000 || orientacao.length > 2000) return { ok: false, message: "Texto longo demais (até 2000 letras)." };

  const supabase = await createClientUntyped();
  const { error } = await supabase.rpc("atualizar_incidente", {
    p_incidente_id: Number(id),
    p_situacao: situacao,
    p_nota: nota,
    p_causa: causa || null,
    p_orientacao: orientacao || null,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidatePath("/governanca/incidentes");
  revalidatePath("/", "layout");
  return { ok: true, message: situacao === "resolvido" ? "Incidente marcado como resolvido." : "Acompanhamento registrado." };
}
