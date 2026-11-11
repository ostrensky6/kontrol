import { EstoqueSubnav } from "@/components/estoque/EstoqueSubnav";

export default function TriagemLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <EstoqueSubnav />
      {children}
    </>
  );
}
