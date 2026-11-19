"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ACEITA_ANEXO, LIMITE_ENVIO_ANEXOS_ROTULO, motivoArquivosRecusados } from "@/lib/pedido/anexos";

const EVENTO_LIMPAR = "kontrol:anexo-conferido";

/**
 * Campo de arquivo dos documentos do pedido. Confere, antes do envio, o formato
 * e a soma dos arquivos de todo o formulário: acima do limite, o servidor
 * recusaria o envio inteiro (e, no "Novo pedido", o pedido junto).
 */
export function CampoArquivosAnexo({
  id,
  name,
  label,
  multiple = false,
  className,
}: {
  id: string;
  name: string;
  label: string;
  multiple?: boolean;
  className?: string;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const campoRef = useRef<HTMLInputElement>(null);

  // outro campo do formulário refez a conta e ficou com o aviso (ou não há aviso)
  useEffect(() => {
    const campo = campoRef.current;
    if (!campo) return;
    const limpar = () => setErro(null);
    campo.addEventListener(EVENTO_LIMPAR, limpar);
    return () => campo.removeEventListener(EVENTO_LIMPAR, limpar);
  }, []);

  function aoEscolher(evento: ChangeEvent<HTMLInputElement>) {
    const campo = evento.currentTarget;
    const campos = Array.from(
      campo.form?.querySelectorAll<HTMLInputElement>("input[type=file][data-anexo-pedido]") ?? [campo],
    );
    const arquivos = campos.flatMap((c) => Array.from(c.files ?? []));
    const motivo = motivoArquivosRecusados(arquivos);
    for (const c of campos) {
      if (c === campo) continue;
      c.setCustomValidity("");
      c.dispatchEvent(new Event(EVENTO_LIMPAR));
    }
    campo.setCustomValidity(motivo ?? "");
    setErro(motivo);
  }

  const ajudaId = `${id}-ajuda`;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs text-muted-foreground/80">{label}</label>
      <input
        ref={campoRef}
        id={id}
        name={name}
        type="file"
        multiple={multiple}
        accept={ACEITA_ANEXO}
        data-anexo-pedido=""
        aria-describedby={ajudaId}
        aria-invalid={erro ? true : undefined}
        onChange={aoEscolher}
        className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
      />
      {erro ? (
        <p id={ajudaId} role="alert" className="mt-1 text-xs font-medium text-danger-strong">{erro}</p>
      ) : (
        <p id={ajudaId} className="mt-1 text-xs text-muted-foreground">
          PDF, imagem, DOCX ou XLSX, até {LIMITE_ENVIO_ANEXOS_ROTULO}
          {multiple ? " somando todos os arquivos" : ""}.
        </p>
      )}
    </div>
  );
}
