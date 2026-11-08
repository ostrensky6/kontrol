"use server";

import { revalidatePath } from "next/cache";
import { createClientUntyped } from "@/lib/supabase/server";
import { mensagemDoBanco, type EstadoAcao } from "@/lib/erros";

const ID = /^\d+$/;

/** Pede a reserva de outro plano para cobrir a falta de um insumo (0163). */
export async function pedirReservaDeOutroPlano(_prev: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const plano = String(form.get("planejamento_id") ?? "").trim();
  const insumo = String(form.get("insumo_id") ?? "").trim();
  const motivo = String(form.get("motivo") ?? "").trim();
  if (!ID.test(plano) || !ID.test(insumo)) return { ok: false, message: "Pedido inválido. Recarregue a página." };
  if (!motivo || motivo.length > 1000) return { ok: false, message: "Diga por que este plano precisa da reserva (até 1000 letras)." };
  const supabase = await createClientUntyped();
  const { error } = await supabase.rpc("pedir_reserva_de_outro_plano", {
    p_planejamento_id: Number(plano),
    p_insumo_id: Number(insumo),
    p_motivo: motivo,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidatePath(`/planejamento/${plano}`);
  revalidatePath("/planejamento/disputas");
  return { ok: true, message: "Pedido enviado. Coordenador ou acima vai decidir." };
}

/** Coordenador ou acima transfere a reserva de um plano para outro, ou nega. */
export async function decidirDisputaReserva(_prev: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const disputa = String(form.get("disputa_id") ?? "").trim();
  const decisao = String(form.get("decisao") ?? "").trim();
  const origem = String(form.get("planejamento_origem_id") ?? "").trim();
  const observacao = String(form.get("observacao") ?? "").trim();
  if (!ID.test(disputa) || (decisao !== "transferir" && decisao !== "negar")) {
    return { ok: false, message: "Pedido inválido. Recarregue a página." };
  }
  if (decisao === "transferir" && !ID.test(origem)) return { ok: false, message: "Escolha o plano que vai ceder a reserva." };
  if (!observacao || observacao.length > 1000) return { ok: false, message: "Escreva o motivo da decisão (até 1000 letras)." };
  const supabase = await createClientUntyped();
  const { data, error } = await supabase.rpc("decidir_disputa_reserva", {
    p_disputa_id: Number(disputa),
    p_decisao: decisao,
    p_planejamento_origem_id: decisao === "transferir" ? Number(origem) : null,
    p_observacao: observacao,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidatePath("/planejamento/disputas");
  revalidatePath("/planejamento", "layout");
  if (decisao === "negar") return { ok: true, message: "Pedido negado. Quem pediu foi avisado." };
  const qtd = Number((data as { transferido?: number } | null)?.transferido ?? 0);
  return { ok: true, message: `Reserva transferida (${qtd.toLocaleString("pt-BR")}). Os dois planos foram atualizados.` };
}
