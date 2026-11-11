import { CadastroPagina } from "@/app/cadastros/[slug]/CadastroPagina";
import { AbasEquipamentos } from "@/components/estoque/AbasEquipamentos";

export const dynamic = "force-dynamic";

/** Equipamentos › Tipos e custo: o cadastro de equipamentos (nome, categoria e custo por dia). */
export default async function TiposEquipamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  return (
    <CadastroPagina
      slug="equipamentos"
      query={query}
      abas={<AbasEquipamentos ativa="tipos" />}
      breadcrumbs={[{ label: "Estoque", href: "/estoque" }, { label: "Equipamentos", href: "/estoque/equipamentos" }, { label: "Tipos e custo" }]}
    />
  );
}
