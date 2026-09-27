import Link from "next/link";

export const metadata = { title: "Sem acesso · Kontrol" };

export default async function SemAcessoPage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string; falha?: string }>;
}) {
  const { area, falha } = await searchParams;
  const falhouConsulta = falha === "1";
  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="mx-auto mt-16 max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold">
            {falhouConsulta ? "Não foi possível abrir" : "Sem acesso"}
            {area ? ` ${falhouConsulta ? "" : "a "}${area}` : ""}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {falhouConsulta
              ? "Não conseguimos conferir as suas permissões agora. Por segurança, a área fica fechada. Tente de novo em instantes; se continuar, avise o administrador."
              : "Seu usuário não tem a permissão para abrir esta área. Se precisar dela, peça ao administrador para liberar em Usuários."}
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Voltar ao início
          </Link>
        </div>
      </main>
    </div>
  );
}
