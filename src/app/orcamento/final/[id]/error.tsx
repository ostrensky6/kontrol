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
      titulo="Não foi possível abrir a proposta"
      explicacao="A versão emitida está guardada com os valores do dia da emissão. Tente de novo; se continuar, avise o suporte com o código abaixo."
      voltarHref="/orcamento/historico"
      voltarRotulo="Ir para o histórico"
    />
  );
}
