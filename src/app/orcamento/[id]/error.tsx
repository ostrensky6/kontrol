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
      titulo="Não foi possível abrir o orçamento laboratorial"
      explicacao="As análises e os custos já salvos continuam no orçamento. Tente de novo; se continuar, avise o suporte com o código abaixo."
      voltarHref="/orcamento/demandas"
      voltarRotulo="Voltar à lista de orçamentos"
    />
  );
}
