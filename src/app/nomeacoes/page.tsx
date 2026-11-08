import Link from "next/link";
import { NomeacaoDelegada } from "@/components/usuarios/NomeacaoDelegada";

export default function NomeacoesPage() {
  return <main className="app-page-container">
    <Link href="/" className="text-primary underline">Voltar ao início</Link>
    <h1 className="text-2xl font-semibold">Nomeação delegada de funções</h1>
    <NomeacaoDelegada />
  </main>;
}
