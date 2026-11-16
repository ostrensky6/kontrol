import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function Breadcrumbs({
  items,
  className,
}: {
  items: BreadcrumbItem[];
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={cn("no-print text-xs text-muted-foreground", className)}>
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link
            href="/"
            className="toque-texto inline-flex items-center gap-1 font-medium hover:text-foreground pointer-coarse:-mx-2.5 pointer-coarse:px-2.5"
            aria-label="Início"
          >
            <Home className="h-3.5 w-3.5" />
          </Link>
        </li>
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li key={`${item.label}:${index}`} className="inline-flex items-center gap-1.5">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/70" aria-hidden="true" />
              {item.href && !current ? (
                <Link href={item.href} className="toque-texto font-medium hover:text-foreground">
                  {item.label}
                </Link>
              ) : (
                <span className={cn(current && "font-medium text-foreground")}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
