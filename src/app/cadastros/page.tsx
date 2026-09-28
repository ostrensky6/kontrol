import Link from "next/link";
import { getCadastrosOrdenados } from "@/lib/cadastros/config";
import { CadastrosCards } from "@/components/cadastros/CadastrosCards";
import { CadastrosWorkbookPanel } from "@/components/cadastros/CadastrosWorkbookPanel";
import { HelpTip } from "@/components/common/HelpTip";
import { pode } from "@/lib/auth/permissao-efetiva";

export default async function CadastrosIndex() {
  const cadastros = getCadastrosOrdenados();
  // a importação grava em vários cadastros; cada linha ainda passa pelo RLS da tabela
  const permissoes = await Promise.all([pode("cadastros.editar"), pode("insumos.editar"), pode("projetos.editar")]);
  const podeImportar = permissoes.some(Boolean);

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex items-center gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Cadastros — dados mestres</h1>
          <HelpTip title="Cadastros — dados mestres">
            <p>
              Projetos, clientes, insumos, equipamentos e demais bases do laboratório, usadas em todo o
              Kontrol.
            </p>
          </HelpTip>
        </div>

        <Link href="/cadastros/qualidade" className="mt-4 inline-flex rounded-md border border-input bg-card px-3 py-2 text-sm font-medium hover:bg-muted">
          Revisar qualidade dos cadastros
        </Link>

        <CadastrosWorkbookPanel podeImportar={podeImportar} />
        <CadastrosCards cadastros={cadastros} />
      </main>
    </div>
  );
}
