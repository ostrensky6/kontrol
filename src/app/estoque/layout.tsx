import { EstoqueSubnav } from "@/components/estoque/EstoqueSubnav";

export default function EstoqueLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <EstoqueSubnav />
      {children}
    </>
  );
}
