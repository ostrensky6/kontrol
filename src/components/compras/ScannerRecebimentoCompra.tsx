"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Camera, Keyboard, Loader2, ScanLine } from "lucide-react";

import { HelpTip } from "@/components/common/HelpTip";
import { receberItemPedido } from "@/lib/actions/compras";
import {
  resolverCodigoRecebimentoInterno,
  type ResultadoScannerRecebimento,
} from "@/lib/actions/scanner";
import {
  iniciarLeitorCamera,
  type ScannerCameraControls,
} from "@/components/scanner/zxing-adapter";

type StatusCamera = "parada" | "iniciando" | "ativa" | "erro";

export type ItemCompraRecebivel = {
  id: number;
  pedidoId: number;
  quantidade: number;
  quantidadeRecebida: number;
  insumoId: number | null;
  insumoDescricao: string | null;
  unidade: string | null;
  /** Item comprado em frascos (0123): quantidade inteira e volume de cada frasco. */
  emFrascos?: boolean;
  conteudoEmbalagem?: number | null;
};

export function ScannerRecebimentoCompra({
  item,
  locais = [],
}: {
  item: ItemCompraRecebivel;
  /** onde o lote vai ficar guardado (opcional, CAD2-8) */
  locais?: { id: number; nome: string }[];
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<ScannerCameraControls | null>(null);
  const [aberto, setAberto] = useState(false);
  const [operacaoId, setOperacaoId] = useState("");
  const [recebimentoPending, startRecebimentoTransition] = useTransition();
  const [scanPending, startScanTransition] = useTransition();
  const [codigoScanner, setCodigoScanner] = useState("");
  const [codigoLote, setCodigoLote] = useState("");
  const [validade, setValidade] = useState("");
  const [resultadoScanner, setResultadoScanner] = useState<ResultadoScannerRecebimento | null>(null);
  const [aplicacaoMessage, setAplicacaoMessage] = useState<string | null>(null);
  const [erroRecebimento, setErroRecebimento] = useState<string | null>(null);
  const [cameraStatus, setCameraStatus] = useState<StatusCamera>("parada");
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const saldoPendente = Math.max(0, item.quantidade - item.quantidadeRecebida);
  // Campos controlados: o React limpa campos não controlados ao fim de cada envio,
  // inclusive quando o banco recusa; a quantidade voltava ao total pendente e um
  // segundo "Confirmar" registrava mais frascos do que chegaram.
  const [quantidade, setQuantidade] = useState(String(saldoPendente));
  const [conteudo, setConteudo] = useState(item.conteudoEmbalagem != null ? String(item.conteudoEmbalagem) : "");
  const [localId, setLocalId] = useState("");

  function pararCamera(status: StatusCamera = "parada") {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraStatus(status);
  }

  function abrir() {
    setOperacaoId((atual) => atual || crypto.randomUUID());
    if (!aberto) {
      setQuantidade(String(saldoPendente));
      setConteudo(item.conteudoEmbalagem != null ? String(item.conteudoEmbalagem) : "");
      setLocalId("");
    }
    setAberto(true);
  }

  useEffect(() => {
    return () => {
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, []);

  function fechar() {
    if (recebimentoPending || scanPending) return;
    pararCamera();
    setAberto(false);
  }

  function aplicarResultadoScan(resultado: ResultadoScannerRecebimento) {
    setResultadoScanner(resultado);
    setAplicacaoMessage(null);

    if (!resultado.ok || !resultado.encontrado) return;

    if (item.insumoId && resultado.insumoId !== item.insumoId) {
      setAplicacaoMessage(
        `Código aponta para o insumo #${resultado.insumoId}, mas este item do pedido é do insumo #${item.insumoId}.`,
      );
      return;
    }

    if (resultado.tipo === "lote") {
      if (resultado.loteCodigo) setCodigoLote(resultado.loteCodigo);
      if (resultado.validade) setValidade(resultado.validade);
      setAplicacaoMessage("Lote compatível identificado. Confira os campos antes de confirmar.");
      return;
    }

    setAplicacaoMessage("Insumo compatível identificado. Confira quantidade, validade e código do lote.");
  }

  function resolverScanner(codigo: string) {
    const codigoLimpo = codigo.trim();
    if (!codigoLimpo) {
      setResultadoScanner({ ok: false, message: "Informe um código para resolver." });
      return;
    }

    startScanTransition(async () => {
      const resultado = await resolverCodigoRecebimentoInterno(codigoLimpo);
      aplicarResultadoScan(resultado);
    });
  }

  async function iniciarCamera() {
    const video = videoRef.current;
    if (!video) return;

    pararCamera();
    setCameraStatus("iniciando");
    setCameraMessage(null);

    try {
      controlsRef.current = await iniciarLeitorCamera(video, (codigoLido) => {
        setCodigoScanner(codigoLido);
        resolverScanner(codigoLido);
      });
      setCameraStatus("ativa");
    } catch (error) {
      setCameraStatus("erro");
      setCameraMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível acessar a câmera. Digite o código.",
      );
    }
  }

  function action(formData: FormData) {
    setErroRecebimento(null);
    startRecebimentoTransition(async () => {
      try {
        const resultado = await receberItemPedido(formData);
        if (!resultado.ok) {
          setErroRecebimento(resultado.message ?? "Não foi possível receber o item.");
          return;
        }
        setOperacaoId(crypto.randomUUID());
        pararCamera();
        setAberto(false);
        router.refresh();
      } catch (error) {
        setErroRecebimento(error instanceof Error ? error.message : "Não foi possível receber o item.");
      }
    });
  }

  const inp =
    "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const scanInput =
    "h-9 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="inline-flex items-center gap-1.5 rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-500"
      >
        <ScanLine className="h-3.5 w-3.5" />
        Receber
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 text-left">
          <button
            type="button"
            aria-label="Fechar recebimento"
            className="absolute inset-0 bg-black/40"
            onClick={fechar}
          />
          <div className="relative max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-xl bg-card p-5 shadow-xl">
            <div className="flex items-center gap-1">
              <h3 className="text-base font-semibold">Receber item de compra</h3>
              <HelpTip title="Recebimento com leitor">
                <p>
                  A leitura do código só preenche ou confere os campos. O item é recebido quando você
                  clica em <b>Confirmar recebimento</b>.
                </p>
                <p>O lote entra em quarentena até ser aceito.</p>
              </HelpTip>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {item.insumoDescricao ?? `Insumo #${item.insumoId ?? "-"}`}
              {item.emFrascos
                ? ` · frascos${item.conteudoEmbalagem ? ` de ${item.conteudoEmbalagem} ${item.unidade ?? ""}` : ""}`
                : item.unidade ? ` · ${item.unidade}` : ""}
            </p>

            <section className="mt-4 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="inline-flex items-center gap-2 text-sm font-semibold">
                  <ScanLine className="h-4 w-4 text-brand-600 dark:text-brand-300" />
                  Ler código
                </h4>
                <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  {cameraStatus === "ativa"
                    ? "Câmera ativa"
                    : cameraStatus === "iniciando"
                      ? "Iniciando câmera"
                      : "Digitação disponível"}
                </span>
              </div>

              <div className="mt-3 overflow-hidden rounded-md border border-border bg-card">
                <video ref={videoRef} muted playsInline className="aspect-video w-full bg-card object-cover" />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={iniciarCamera}
                  disabled={cameraStatus === "iniciando" || scanPending || recebimentoPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {cameraStatus === "iniciando" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Camera className="h-3.5 w-3.5" />
                  )}
                  Usar câmera
                </button>
                <button
                  type="button"
                  onClick={() => pararCamera()}
                  disabled={cameraStatus === "parada" || recebimentoPending}
                  className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  Parar câmera
                </button>
              </div>

              {cameraMessage && (
                <p className="mt-3 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-strong">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {cameraMessage}
                </p>
              )}

              <div className="mt-3 flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Keyboard className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/80" />
                  <input
                    value={codigoScanner}
                    onChange={(event) => setCodigoScanner(event.target.value)}
                    className={`${scanInput} pl-8`}
                    placeholder="Código da etiqueta ou do fornecedor"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => resolverScanner(codigoScanner)}
                  disabled={scanPending || recebimentoPending || codigoScanner.trim().length === 0}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
                >
                  {scanPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Resolver
                </button>
              </div>

              {resultadoScanner && (
                <div
                  className={`mt-3 rounded-md px-3 py-2 text-xs ${
                    resultadoScanner.ok && resultadoScanner.encontrado && !aplicacaoMessage?.startsWith("Código aponta")
                      ? "bg-brand-50 text-brand-800 dark:bg-brand-950/30 dark:text-brand-300"
                      : "bg-warning-soft text-warning-strong"
                  }`}
                >
                  <p>{aplicacaoMessage ?? resultadoScanner.message}</p>
                  {resultadoScanner.ok && resultadoScanner.encontrado && (
                    <p className="mt-1 font-medium">
                      {resultadoScanner.insumoDescricao ?? `Insumo #${resultadoScanner.insumoId}`}
                      {resultadoScanner.loteCodigo ? ` · lote ${resultadoScanner.loteCodigo}` : ""}
                    </p>
                  )}
                  {resultadoScanner.ok && !resultadoScanner.encontrado && (
                    <Link href={resultadoScanner.triagemUrl} className="mt-1 inline-block font-medium underline">
                      Abrir triagem
                    </Link>
                  )}
                </div>
              )}
            </section>

            <form action={action} className="mt-4 grid grid-cols-2 gap-3">
              <input type="hidden" name="item_id" value={item.id} />
              <input type="hidden" name="pedido_id" value={item.pedidoId} />
              <input type="hidden" name="operacao_id" value={operacaoId} />
              <div className="col-span-1">
                <label className="block text-xs font-medium text-muted-foreground">
                  {item.emFrascos ? "Frascos recebidos" : "Quantidade"}
                </label>
                <input
                  name="quantidade_recebida"
                  type="number"
                  step={item.emFrascos ? "1" : "any"}
                  min={item.emFrascos ? "1" : "0.0000001"}
                  max={saldoPendente}
                  value={quantidade}
                  onChange={(event) => setQuantidade(event.target.value)}
                  className={inp}
                />
              </div>
              <div className="col-span-1">
                <label className="block text-xs font-medium text-muted-foreground">Validade</label>
                <input
                  name="validade"
                  type="date"
                  value={validade}
                  onChange={(event) => setValidade(event.target.value)}
                  className={inp}
                />
              </div>
              {item.emFrascos && (
                <div className="col-span-2">
                  <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    Volume de cada frasco ({item.unidade ?? "unidade do cadastro"})
                    <HelpTip title="Volume do frasco">
                      <p>Preencha só se o frasco veio diferente do cadastro.</p>
                      <p>O volume vale só para este lote; a compra continua com o volume pedido.</p>
                    </HelpTip>
                  </label>
                  <input
                    name="conteudo_embalagem"
                    type="number"
                    step="any"
                    min="0.0000001"
                    value={conteudo}
                    onChange={(event) => setConteudo(event.target.value)}
                    className={inp}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Altere só se a embalagem chegou diferente do cadastro.</p>
                </div>
              )}
              {locais.length > 0 && (
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground">Local de guarda (opcional)</label>
                  <select name="local_id" value={localId} onChange={(event) => setLocalId(event.target.value)} className={inp}>
                    <option value="">Definir depois</option>
                    {locais.map((local) => (
                      <option key={local.id} value={local.id}>{local.nome}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="col-span-2">
                <label className="block text-xs font-medium text-muted-foreground">Código do lote</label>
                <input
                  name="codigo"
                  type="text"
                  value={codigoLote}
                  onChange={(event) => setCodigoLote(event.target.value)}
                  className={inp}
                />
              </div>

              {erroRecebimento && (
                <p role="alert" className="col-span-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">
                  {erroRecebimento}
                </p>
              )}

              <div className="col-span-2 mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={fechar}
                  className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                >
                  Cancelar
                </button>
                <button
                  disabled={recebimentoPending || scanPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
                >
                  {recebimentoPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {recebimentoPending ? "Registrando…" : "Confirmar recebimento"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
