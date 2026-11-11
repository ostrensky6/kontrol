"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { KontrolLogo } from "@/components/brand/KontrolLogo";
import { APP_VERSION, APP_YEAR } from "@/config/app";

const links = [
  { href: "/privacidade", label: "Privacidade" },
  { href: "/termos", label: "Termos" },
  { href: "/suporte", label: "Suporte" },
];

/**
 * Rodapé institucional completo só na página inicial. Nas demais telas a versão
 * e os links cabem numa linha: o bloco de logotipos tomava cerca de 180 px no
 * fim de toda tela (revisão de 11/11, seção 10.2).
 */
export function AppFooter() {
  const pathname = usePathname();
  if (pathname !== "/") {
    return (
      <footer
        aria-label="Informações institucionais"
        className="border-t border-border/70 bg-card print:hidden"
      >
        <div className="app-topnav-container flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-2 text-xs text-muted-foreground md:justify-between">
          <p>
            Kontrol · Versão {APP_VERSION} · {APP_YEAR}
          </p>
          <nav aria-label="Links institucionais" className="flex flex-wrap items-center gap-x-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="inline-flex min-h-8 items-center rounded-md px-2 font-medium transition-colors hover:bg-muted hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    );
  }

  return (
    <footer
      aria-label="Informações institucionais"
      className="border-t border-border/70 bg-card"
    >
      <div className="app-topnav-container py-5">
        <div className="flex flex-col items-center gap-5 text-center md:flex-row md:justify-between md:text-left">
          <div className="flex flex-col items-center gap-2 md:items-start">
            <KontrolLogo
              alt="Kontrol"
              className="h-auto w-28 max-w-full object-contain"
            />
            <p className="text-xs font-medium text-muted-foreground">
              Uma parceria GIA &amp; ATGC
            </p>
            <p className="text-xs text-muted-foreground">
              Versão {APP_VERSION} · {APP_YEAR}
            </p>
          </div>

          <div className="flex items-center justify-center gap-4" aria-hidden="true">
            <Image
              src="/logos/gia.svg"
              alt=""
              width={1767}
              height={1434}
              className="h-9 w-auto object-contain opacity-80 dark:opacity-100"
              unoptimized
            />
            <Image
              src="/logos/atgc.svg"
              alt=""
              width={250}
              height={250}
              className="h-9 w-auto object-contain opacity-90"
              unoptimized
            />
          </div>
        </div>

        <nav
          aria-label="Links institucionais"
          className="mt-5 flex flex-wrap items-center justify-center gap-x-2 border-t border-border/70 pt-2 md:justify-start"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex min-h-11 items-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
