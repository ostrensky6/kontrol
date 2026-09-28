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
      titulo="Não foi possível carregar o histórico"
      explicacao="As propostas emitidas não foram alteradas. Tente de novo ou limpe os filtros; se continuar, avise o suporte com o código abaixo."
      voltarHref="/orcamento/demandas"
      voltarRotulo="Voltar à lista de orçamentos"
    />
  );
}
