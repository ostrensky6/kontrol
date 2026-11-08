import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/Sidebar";
import { AppFooter } from "@/components/layout/AppFooter";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { ContextHelp } from "@/components/layout/ContextHelp";
import { AvisoIncidentes } from "@/components/incidentes/AvisoIncidentes";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { getCommandGroups, getSidebarGroups } from "@/config/navigation";
import { minhasPermissoes } from "@/lib/auth/permissao-efetiva";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kontrol App",
  description: "Custeio de análises, orçamento e controle de estoque do laboratório",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let perfil: {
    nome: string | null;
    email: string | null;
    papel: string;
    permissoes?: Awaited<ReturnType<typeof minhasPermissoes>>;
  } | null = null;
  if (user) {
    const { data } = await supabase
      .from("perfis")
      .select("nome, email, papel")
      .eq("id", user.id)
      .single();
    perfil = data ? { ...data, permissoes: await minhasPermissoes() } : null;
  }

  const sidebarGroups = getSidebarGroups(perfil);
  const commandGroups = getCommandGroups(perfil);

  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        suppressHydrationWarning
        className="app-canvas min-h-dvh text-foreground"
      >
        <a href="#conteudo-principal" className="skip-link">
          Ir para o conteúdo principal
        </a>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {user ? (
            <div className="flex min-h-dvh flex-col md:flex-row">
              <Sidebar groups={sidebarGroups} perfil={perfil} userEmail={user.email ?? null} />
              <div className="flex min-w-0 flex-1 flex-col">
                <AvisoIncidentes />
                <div
                  id="conteudo-principal"
                  tabIndex={-1}
                  className="min-w-0 flex-1 outline-none"
                >
                  {children}
                </div>
                <AppFooter />
              </div>
              <CommandPalette groups={commandGroups} />
              <ContextHelp />
            </div>
          ) : (
            <div id="conteudo-principal" tabIndex={-1} className="outline-none">
              {children}
            </div>
          )}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
