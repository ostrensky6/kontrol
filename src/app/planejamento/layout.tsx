import { PlanejamentoSubnav } from "@/components/planejamento/PlanejamentoSubnav";

export default function PlanejamentoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PlanejamentoSubnav />
      {children}
    </>
  );
}
