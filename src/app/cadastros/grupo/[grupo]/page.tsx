import { notFound, redirect } from "next/navigation";

import { grupoPorId } from "@/lib/cadastros/grupos";

/** O grupo na barra de Cadastros abre o primeiro cadastro dele; as abas levam aos outros. */
export default async function GrupoDeCadastrosRedirectPage({ params }: { params: Promise<{ grupo: string }> }) {
  const { grupo: id } = await params;
  const grupo = grupoPorId(id);
  if (!grupo) notFound();
  redirect(`/cadastros/${grupo.slugs[0]}`);
}
