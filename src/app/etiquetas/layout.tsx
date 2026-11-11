import { EstoqueSubnav } from "@/components/estoque/EstoqueSubnav";

export default function EtiquetasLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <EstoqueSubnav />
      {children}
    </>
  );
}
