import { ModuleTopNav } from "@/components/layout/ModuleTopNav";
import { EstoqueSubnav } from "@/components/estoque/EstoqueSubnav";

export default function EtiquetasLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="print:hidden">
        <ModuleTopNav moduleId="suprimentos" />
      </div>
      <EstoqueSubnav />
      {children}
    </>
  );
}
