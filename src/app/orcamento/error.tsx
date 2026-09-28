"use client";

import { ErroTela } from "@/components/common/ErroTela";

export default function Erro({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <ErroTela
      error={error}
      retry={unstable_retry}
      titulo="Não foi possível abrir esta tela de Orçamentos"
      explicacao="Nada foi alterado. Tente de novo; se continuar, avise o suporte com o código abaixo."
      voltarHref="/orcamento/demandas"
      voltarRotulo="Voltar à lista de orçamentos"
    />
  );
}
