import { AjudaCentro } from "@/components/ajuda/AjudaCentro";
import { topicoDaUrl } from "@/lib/ajuda/secao";

export const metadata = {
  title: "Ajuda · Kontrol",
  description: "Central de ajuda com orientações de todos os módulos do app.",
};

export default async function AjudaPage({
  searchParams,
}: {
  searchParams: Promise<{ topico?: string | string[] }>;
}) {
  const query = await searchParams;
  // link direto: /ajuda?topico=pedido abre o tópico da tela de onde a pessoa veio
  const topico = topicoDaUrl(Array.isArray(query.topico) ? query.topico[0] : query.topico);
  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Central de Ajuda</h1>
          <p className="mt-1 text-sm text-muted-foreground">Busque pelo assunto ou escolha o módulo.</p>
        </div>

        <div className="mt-6">
          <AjudaCentro key={topico?.id ?? "inicio"} topicoInicial={topico?.id} />
        </div>
      </main>
    </div>
  );
}
