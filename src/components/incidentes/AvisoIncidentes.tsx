import Link from "next/link";
import { createClientUntyped } from "@/lib/supabase/server";

type Aberto = { id: number; titulo: string; orientacao: string };

async function lerAbertos(): Promise<{ ultimo: Aberto; total: number } | null> {
  try {
    const supabase = await createClientUntyped();
    const { data, count } = await supabase
      .from("incidentes")
      .select("id, titulo, orientacao", { count: "exact" })
      .neq("situacao", "resolvido")
      .order("registrado_em", { ascending: false })
      .limit(1);
    const ultimo = (data ?? [])[0] as Aberto | undefined;
    return ultimo ? { ultimo, total: count ?? 1 } : null;
  } catch {
    return null;
  }
}

/**
 * Faixa no topo de todas as telas enquanto houver incidente em aberto (0162).
 * Mostra o mais recente e o que fazer. Falha de leitura não atrapalha a tela.
 */
export async function AvisoIncidentes() {
  const abertos = await lerAbertos();
  if (!abertos) return null;
  const { ultimo, total } = abertos;
  return (
    <aside aria-label="Incidente em aberto" className="border-b border-danger-strong/30 bg-danger-soft px-4 py-2 text-sm text-danger-strong">
      <span className="font-semibold">Incidente em aberto: {ultimo.titulo}.</span>{" "}
      <span>O que fazer: {ultimo.orientacao}</span>{" "}
      <Link href={`/governanca/incidentes#incidente-${ultimo.id}`} className="font-medium underline">
        {total > 1 ? `Ver os ${total} incidentes` : "Ver detalhes"}
      </Link>
    </aside>
  );
}
