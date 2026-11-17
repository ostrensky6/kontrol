import Link from "next/link";
import { type PlanoModulo } from "@/lib/orcamento/garantir-modulos";

export function ModuloAcao({
  plano,
  rotulo,
  demandaId,
  acaoCriar,
  hrefBase,
  hrefAbrir,
  rotuloAbrir,
}: {
  plano: PlanoModulo;
  rotulo: string;
  demandaId: number;
  acaoCriar: (formData: FormData) => void | Promise<void>;
  hrefBase: string;
  /** destino alternativo do botão "Abrir" (ex.: etapa da própria demanda) */
  hrefAbrir?: string;
  rotuloAbrir?: string;
}) {
  if (!plano.aplicavel) {
    return (
      <span className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground/80">
        {rotulo === "laboratorial" ? "Laboratório" : "Projeto"} não se aplica
      </span>
    );
  }
  if (plano.acao === "bloqueado") {
    return (
      <span className="rounded-md border border-danger-strong/30 px-3 py-2 text-xs text-danger-strong">
        Orçamento {rotulo}: saneamento necessário
      </span>
    );
  }
  if (plano.acao === "abrir" && plano.moduloId) {
    return (
      <Link
        href={hrefAbrir ?? `${hrefBase}/${plano.moduloId}`}
        className="rounded-md border border-input px-3 py-2 text-xs font-medium hover:bg-muted"
      >
        {rotuloAbrir ?? `Abrir orçamento ${rotulo}`}
      </Link>
    );
  }
  return (
    <form action={acaoCriar}>
      <input suppressHydrationWarning type="hidden" name="demanda_id" value={demandaId} />
      <button className="rounded-md bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-500">
        Criar orçamento {rotulo}
      </button>
    </form>
  );
}
