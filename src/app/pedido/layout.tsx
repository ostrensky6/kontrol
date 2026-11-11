import { PedidosAbas } from "@/components/pedido/PedidosAbas";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PedidosAbas />
      {children}
    </>
  );
}
