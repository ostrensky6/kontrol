import { ModuleTopNav } from "@/components/layout/ModuleTopNav";
import { ConfiguracoesSubnav } from "@/components/orcamento/ConfiguracoesSubnav";
import { permiteAcesso } from "@/config/modules";
import { minhasPermissoes } from "@/lib/auth/permissao-efetiva";
import { SECOES_CONFIGURACAO_ORCAMENTO } from "@/lib/orcamento/secoes-configuracao";

export default async function OrcamentoLayout({ children }: { children: React.ReactNode }) {
  const permissoes = await minhasPermissoes();
  const secoes = SECOES_CONFIGURACAO_ORCAMENTO.filter((secao) => permiteAcesso({ permissoes }, secao.href));

  return (
    <>
      <ModuleTopNav moduleId="orcamentos" />
      <ConfiguracoesSubnav secoes={secoes.map((secao) => ({ ...secao }))} />
      {children}
    </>
  );
}
