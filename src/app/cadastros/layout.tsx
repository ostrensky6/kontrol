import { CadastrosSubnav } from "@/components/cadastros/CadastrosSubnav";
import { getCadastrosOrdenados } from "@/lib/cadastros/config";

export default function CadastrosLayout({ children }: { children: React.ReactNode }) {
  const titulos = Object.fromEntries(getCadastrosOrdenados().map((cadastro) => [cadastro.slug, cadastro.titulo]));
  return (
    <>
      <CadastrosSubnav titulos={titulos} />
      {children}
    </>
  );
}
