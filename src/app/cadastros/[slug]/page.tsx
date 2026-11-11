import { redirect } from "next/navigation";

import { CadastroPagina } from "./CadastroPagina";

export const dynamic = "force-dynamic";

/** Os dois cadastros de equipamento vivem em Estoque → Equipamentos; o endereço antigo continua valendo. */
const NO_ESTOQUE: Record<string, string> = {
  equipamentos: "/estoque/equipamentos/tipos",
  previsao_equipamentos: "/estoque/equipamentos/previsao",
};

export default async function CadastroPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const destino = NO_ESTOQUE[slug];
  if (destino) {
    const consulta = new URLSearchParams();
    for (const [chave, valor] of Object.entries(query)) {
      for (const item of Array.isArray(valor) ? valor : valor === undefined ? [] : [valor]) consulta.append(chave, item);
    }
    const texto = consulta.toString();
    redirect(texto ? `${destino}?${texto}` : destino);
  }
  return <CadastroPagina slug={slug} query={query} />;
}
