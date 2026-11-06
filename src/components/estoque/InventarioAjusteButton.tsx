"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { aplicarAjusteContagemInventario } from "@/lib/actions/inventario";
import type { FormState } from "@/lib/actions/cadastros";

export function InventarioAjusteButton({ contagemId }: { contagemId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<FormState>({ ok: false });

  function aplicar() {
    const formData = new FormData();
    formData.set("contagem_id", String(contagemId));
    startTransition(async () => {
      const result = await aplicarAjusteContagemInventario({ ok: false }, formData);
      setState(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={aplicar}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Aplicar ajuste
      </button>
      {state.message && (
        <span className={`max-w-48 text-[11px] ${state.ok ? "text-brand-700" : "text-danger-strong"}`}>
          {state.message}
        </span>
      )}
    </span>
  );
}
