"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";

import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { iniciarLeitorCamera, type ScannerCameraControls } from "@/components/scanner/zxing-adapter";
import { CODIGO_BARRAS_MAX, chaveCodigoBarras } from "@/lib/scanner/codigo-barras";

/**
 * Códigos de barras do fabricante no cadastro do insumo (vários por insumo).
 * Campo próprio, separado do "Código do fabricante" (referência de catálogo).
 * Leitor USB (digita e tecla Enter), câmera ou digitação.
 */
export function CodigosBarrasCampo({
  valorInicial,
  erro,
}: {
  valorInicial: string[];
  erro?: string;
}) {
  const [codigos, setCodigos] = useState<string[]>(valorInicial);
  const [texto, setTexto] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [camera, setCamera] = useState<"parada" | "iniciando" | "ativa">("parada");
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<ScannerCameraControls | null>(null);

  useEffect(() => () => controlsRef.current?.stop(), []);

  function adicionar(bruto: string) {
    const chave = chaveCodigoBarras(bruto);
    if (!chave) return;
    if (chave.length > CODIGO_BARRAS_MAX) {
      setAviso(`Código maior que ${CODIGO_BARRAS_MAX} caracteres.`);
      return;
    }
    setTexto("");
    if (codigos.some((codigo) => chaveCodigoBarras(codigo) === chave)) {
      setAviso(`O código ${chave} já está na lista.`);
      return;
    }
    setAviso(null);
    setCodigos((atual) => [...atual, chave]);
  }

  async function lerComCamera() {
    const video = videoRef.current;
    if (!video) return;
    setCamera("iniciando");
    setAviso(null);
    try {
      controlsRef.current = await iniciarLeitorCamera(video, (lido) => {
        controlsRef.current = null;
        setCamera("parada");
        adicionar(lido);
      });
      setCamera("ativa");
    } catch (error) {
      setCamera("parada");
      setAviso(error instanceof Error ? error.message : "Não foi possível acessar a câmera.");
    }
  }

  function pararCamera() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCamera("parada");
  }

  return (
    <div className="sm:col-span-2">
      <input type="hidden" name="_codigos_barras_enviado" value="1" />
      <input type="hidden" name="_codigos_barras" value={codigos.join("\n")} />
      <div className="flex min-h-5 items-center gap-0.5">
        <Label htmlFor="campo-codigos_barras" className="block">
          Códigos de barras
        </Label>
        <HelpTip title="Códigos de barras">
          <p>
            Códigos impressos na embalagem (EAN, GTIN, DataMatrix). Um insumo pode ter vários, por
            exemplo um por fornecedor ou tamanho de caixa. Com o código aqui, a{" "}
            <b>Entrada e saída por leitura</b> e o Inventário reconhecem o insumo sozinhos.
          </p>
          <p>Use o leitor USB, a câmera ou digite e tecle Enter.</p>
          <HelpExample>7891234567895</HelpExample>
        </HelpTip>
      </div>
      <div className="mt-1 flex gap-2">
        <Input
          id="campo-codigos_barras"
          value={texto}
          onChange={(event) => setTexto(event.target.value)}
          onKeyDown={(event) => {
            // o leitor USB termina com Enter: adiciona em vez de salvar o formulário
            if (event.key === "Enter") {
              event.preventDefault();
              adicionar(texto);
            }
          }}
          autoComplete="off"
          placeholder="Leia ou digite e tecle Enter"
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? "campo-codigos_barras-erro" : undefined}
        />
        <button
          type="button"
          onClick={() => adicionar(texto)}
          disabled={!texto.trim()}
          className="rounded-md border border-input px-3 text-sm hover:bg-muted disabled:opacity-50"
        >
          Adicionar
        </button>
        <button
          type="button"
          onClick={camera === "parada" ? () => void lerComCamera() : pararCamera}
          aria-label={camera === "parada" ? "Ler com a câmera" : "Parar câmera"}
          title={camera === "parada" ? "Ler com a câmera" : "Parar câmera"}
          className="inline-flex items-center rounded-md border border-input px-3 hover:bg-muted"
        >
          {camera === "iniciando" ? <Loader2 className="h-4 w-4 animate-spin" /> : camera === "ativa" ? <X className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
        </button>
      </div>
      <div className={`mt-2 overflow-hidden rounded-md border border-border ${camera === "parada" ? "hidden" : ""}`}>
        <video ref={videoRef} muted playsInline className="aspect-video w-full max-w-sm bg-card object-cover" />
      </div>
      {codigos.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Códigos de barras do insumo">
          {codigos.map((codigo) => (
            <li
              key={codigo}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 font-mono text-xs"
            >
              {codigo}
              <button
                type="button"
                onClick={() => setCodigos((atual) => atual.filter((c) => c !== codigo))}
                aria-label={`Remover o código ${codigo}`}
                className="rounded-full p-0.5 hover:bg-background"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Nenhum código vinculado.</p>
      )}
      <div aria-live="polite">
        {aviso && <p className="mt-1 text-xs text-muted-foreground">{aviso}</p>}
      </div>
      {erro && (
        <p id="campo-codigos_barras-erro" className="mt-1 text-xs text-destructive">
          {erro}
        </p>
      )}
    </div>
  );
}
