import { CadastroPagina } from "@/app/cadastros/[slug]/CadastroPagina";
import { AbasEquipamentos } from "@/components/estoque/AbasEquipamentos";

export const dynamic = "force-dynamic";

/** Equipamentos › Previsão de compra: o que a equipe vai precisar (aba EQ da planilha). */
export default async function PrevisaoEquipamentosPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  return (
    <CadastroPagina
      slug="previsao_equipamentos"
      query={query}
      abas={<AbasEquipamentos ativa="previsao" />}
      breadcrumbs={[{ label: "Estoque", href: "/estoque" }, { label: "Equipamentos", href: "/estoque/equipamentos" }, { label: "Previsão de compra" }]}
    />
  );
}
