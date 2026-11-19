/**
 * Documentos do pedido: que tipo entra em que momento e quanto cabe num envio.
 *
 * Relatório de ajustes de 19/11/2026, ajuste 2: a cotação prévia e o termo de
 * referência são de quem pede. Entram com o pedido, no "Novo pedido", e
 * enquanto o pedido está com o solicitante (rascunho ou devolvido para ajuste).
 * Da Aprovação em diante, essas duas opções saem de "Registrar documento"; o
 * que já foi registrado continua na lista.
 */

export const TIPOS_DOCUMENTO_PEDIDO = [
  { valor: "orcamento_previo", rotulo: "Cotação prévia" },
  { valor: "proposta", rotulo: "Cotação do fornecedor" },
  { valor: "print", rotulo: "Print" },
  { valor: "email", rotulo: "E-mail" },
  { valor: "termo_referencia", rotulo: "Termo de referência" },
  { valor: "oficio", rotulo: "Ofício" },
  { valor: "boleto", rotulo: "Boleto" },
  { valor: "nota_fiscal", rotulo: "Nota fiscal" },
  { valor: "comprovante", rotulo: "Comprovante" },
  { valor: "outro", rotulo: "Outro" },
] as const;

/** Documentos que quem pede anexa na solicitação. */
export const TIPOS_DOCUMENTO_SOLICITACAO: readonly string[] = ["orcamento_previo", "termo_referencia"];

/** Status em que o pedido está com o solicitante (os mesmos em que ele edita o pedido). */
export const STATUS_COM_SOLICITANTE: readonly string[] = ["rascunho", "ajuste_solicitante", "ajuste_compras"];

export function pedidoComSolicitante(status: string | null | undefined): boolean {
  return STATUS_COM_SOLICITANTE.includes(status ?? "");
}

/** Tipos que "Registrar documento" oferece para o pedido nesse status. */
export function tiposDeDocumentoNoStatus(status: string | null | undefined) {
  const comSolicitante = pedidoComSolicitante(status);
  return TIPOS_DOCUMENTO_PEDIDO.filter((tipo) => comSolicitante || !TIPOS_DOCUMENTO_SOLICITACAO.includes(tipo.valor));
}

export const MSG_DOCUMENTO_DA_SOLICITACAO =
  "Cotação prévia e termo de referência entram com o pedido, por quem pede: no “Novo pedido” ou enquanto o pedido está devolvido para ajuste.";

/** Motivo para recusar o tipo de documento nesse status, ou null quando pode. */
export function motivoTipoForaDaEtapa(tipo: string | null | undefined, status: string | null | undefined): string | null {
  if (!TIPOS_DOCUMENTO_SOLICITACAO.includes(tipo ?? "")) return null;
  return pedidoComSolicitante(status) ? null : MSG_DOCUMENTO_DA_SOLICITACAO;
}

/**
 * Quanto cabe num envio de formulário. O servidor aceita até 4 MB por envio
 * (next.config.ts, serverActions.bodySizeLimit; a Vercel corta em 4,5 MB), e
 * o resto do formulário precisa de folga. A tela dizia "até 15 MB", mas acima
 * de 4 MB o envio era recusado antes de chegar à conferência.
 */
export const LIMITE_ENVIO_ANEXOS_BYTES = 3.5 * 1024 * 1024;
export const LIMITE_ENVIO_ANEXOS_ROTULO = "3,5 MB";

export const MIME_TYPES_ANEXO: readonly string[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

export const ACEITA_ANEXO = "application/pdf,image/jpeg,image/png,image/webp,.docx,.xlsx";

function megabytes(bytes: number) {
  return (bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

/** Confere os arquivos de um envio: formato e soma dos tamanhos. */
export function motivoArquivosRecusados(arquivos: readonly { name: string; size: number; type: string }[]): string | null {
  const formatoErrado = arquivos.find((arquivo) => arquivo.type && !MIME_TYPES_ANEXO.includes(arquivo.type));
  if (formatoErrado) return `“${formatoErrado.name}” não é PDF, imagem, DOCX ou XLSX.`;
  const total = arquivos.reduce((soma, arquivo) => soma + arquivo.size, 0);
  if (total > LIMITE_ENVIO_ANEXOS_BYTES) {
    return arquivos.length > 1
      ? `Os arquivos somam ${megabytes(total)} MB; cabem até ${LIMITE_ENVIO_ANEXOS_ROTULO} por envio. Reduza os PDFs, ou guarde o pedido como rascunho e registre um por vez em Documentos.`
      : `O arquivo tem ${megabytes(total)} MB; cabe até ${LIMITE_ENVIO_ANEXOS_ROTULO}. Reduza o PDF ou registre um link.`;
  }
  return null;
}
