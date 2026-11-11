import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/Sidebar";
import { AppFooter } from "@/components/layout/AppFooter";
import { AvisosProvider } from "@/components/layout/AvisosContexto";
import { BarraSuperior, type ModuloDaBarra } from "@/components/layout/BarraSuperior";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { ContextHelp } from "@/components/layout/ContextHelp";
import { AvisoIncidentes } from "@/components/incidentes/AvisoIncidentes";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { getModulesForProfile } from "@/config/modules";
import { getCommandGroups, getSidebarGroups } from "@/config/navigation";
import { carregarAvisosDoSinoSeguro } from "@/lib/pendencias/carregar";
import { AVISOS_VAZIOS } from "@/lib/pendencias/tipos";
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
  // barra do topo: os lugares de cada módulo que a pessoa vê; o navegador escolhe o módulo pela rota
  const modulosDaBarra: ModuloDaBarra[] = getModulesForProfile(perfil).map((modulo) => ({
    id: modulo.id,
    label: modulo.label,
    activePaths: modulo.activePaths,
    itens: modulo.children
      .filter((child) => child.showInTopNav !== false)
      .map(({ href, label, desc, icon, ativoTambem }) => ({ href, label, desc, icon, ativoTambem })),
  }));
  const avisosIniciais = user ? await carregarAvisosDoSinoSeguro() : AVISOS_VAZIOS;

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
            <AvisosProvider iniciais={avisosIniciais}>
            <div className="flex min-h-dvh flex-col md:flex-row">
              <Sidebar groups={sidebarGroups} perfil={perfil} userEmail={user.email ?? null} />
              <div className="flex min-w-0 flex-1 flex-col">
                <AvisoIncidentes />
                <BarraSuperior modulos={modulosDaBarra} />
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
            </AvisosProvider>
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
