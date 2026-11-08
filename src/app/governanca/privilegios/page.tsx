import { HelpTip } from "@/components/common/HelpTip";
import { PrivilegiosMatriz } from "@/components/governanca/PrivilegiosMatriz";
import { obterMatrizPrivilegios } from "@/lib/actions/privilegios";

export const dynamic = "force-dynamic";

export default async function PrivilegiosPage() {
  const leitura = await obterMatrizPrivilegios();

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex items-center gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Privilégios</h1>
          <HelpTip title="Privilégios">
            <p>
              A matriz mostra as regras gravadas por categoria, separadas por módulo. A categoria Administrador é fixa.
              Para consultar o acesso de uma pessoa, vá a Usuários.
            </p>
          </HelpTip>
        </div>

        <div className="mt-6">
          <PrivilegiosMatriz leitura={leitura} />
        </div>
      </main>
    </div>
  );
}
