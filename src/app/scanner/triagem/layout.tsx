import { ModuleTopNav } from "@/components/layout/ModuleTopNav";
import { EstoqueSubnav } from "@/components/estoque/EstoqueSubnav";

export default function TriagemLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModuleTopNav moduleId="suprimentos" />
      <EstoqueSubnav />
      {children}
    </>
  );
}
