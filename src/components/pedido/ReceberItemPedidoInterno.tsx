"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Camera, Keyboard, Loader2, PackageCheck, ScanLine } from "lucide-react";

import { HelpTip } from "@/components/common/HelpTip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { receberItemPedidoInterno } from "@/lib/actions/pedidos-internos";
import {
  resolverCodigoRecebimentoInterno,
  type ResultadoScannerRecebimento,
} from "@/lib/actions/scanner";
import type { FormState } from "@/lib/actions/cadastros";
import {
  iniciarLeitorCamera,
  type ScannerCameraControls,
} from "@/components/scanner/zxing-adapter";

type Insumo = { id: number; especificacao: string | null; unidade: string | null };

export type ItemRecebivel = {
  id: number;
  pedidoId: number;
  especificacao: string;
  quantidade: number;
  quantidadeRecebida?: number | null;
  compraFormalId?: number | null;
  unidade: string | null;
  insumoId: number | null;
  fornecedorSugerido: string | null;
  orcamentoPrevio: number | null;
  /** item pedido em frascos (0123): recebe frascos inteiros */
  emFrascos?: boolean;
};

export function ReceberItemPedidoInterno({
  item,
  insumos,
}: {
  item: ItemRecebivel;
  insumos: Insumo[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [operacaoId, setOperacaoId] = useState("");
  const [state, setState] = useState<FormState>({ ok: false });
  const [recebimentoPending, startRecebimentoTransition] = useTransition();
  const [scanPending, startScanTransition] = useTransition();
  const [insumoId, setInsumoId] = useState(item.insumoId ? String(item.insumoId) : "");
  const emFrascos = item.emFrascos ?? /^frasco/i.test((item.unidade ?? "").trim());
  const [codigoLote, setCodigoLote] = useState("");
  const [validade, setValidade] = useState("");
  // Campos controlados: o React limpa campos não controlados ao fim de cada envio,
  // inclusive na recusa; a quantidade voltava ao total pendente.
  const saldoPendenteInicial = Math.max(0, item.quantidade - Number(item.quantidadeRecebida ?? 0));
  const [quantidade, setQuantidade] = useState(String(saldoPendenteInicial || item.quantidade));
  const [custo, setCusto] = useState(item.orcamentoPrevio != null ? String(item.orcamentoPrevio) : "");
  const [fornecedor, setFornecedor] = useState(item.fornecedorSugerido ?? "");
  const [codigoScanner, setCodigoScanner] = useState("");
  const [resultadoScanner, setResultadoScanner] = useState<ResultadoScannerRecebimento | null>(null);
  const [cameraStatus, setCameraStatus] = useState<"parada" | "iniciando" | "ativa" | "erro">("parada");
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<ScannerCameraControls | null>(null);
  // Muda a cada parada: uma câmera que termina de iniciar depois de o diálogo
  // fechar (permissão concedida tarde) é desligada em vez de ficar ligada.
  const sessaoCameraRef = useRef(0);
  const codigoScannerRef = useRef<HTMLInputElement>(null);
  const uid = useId();

  function pararCamera(status: "parada" | "erro" = "parada") {
    sessaoCameraRef.current += 1;
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraStatus(status);
  }

  function abrir() {
    setOperacaoId((atual) => atual || crypto.randomUUID());
    if (!aberto) {
      setQuantidade(String(saldoPendenteInicial || item.quantidade));
      setCusto(item.orcamentoPrevio != null ? String(item.orcamentoPrevio) : "");
      setFornecedor(item.fornecedorSugerido ?? "");
    }
    setAberto(true);
  }

  function fechar() {
    if (recebimentoPending || scanPending) return;
    pararCamera();
    setAberto(false);
  }

  // Esc, clique fora, "Fechar" e "Cancelar" passam por aqui: a câmera sempre para.
  function alternar(abrirDialogo: boolean) {
    if (abrirDialogo) abrir();
    else fechar();
  }

  useEffect(() => {
    return () => {
      sessaoCameraRef.current += 1;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, []);

  function action(formData: FormData) {
    startRecebimentoTransition(async () => {
      const res = await receberItemPedidoInterno({ ok: false }, formData);
      setState(res);
      if (res.ok) {
        setOperacaoId(crypto.randomUUID());
        setAberto(false);
        pararCamera();
        router.refresh();
      }
    });
  }

  function aplicarResultadoScan(resultado: ResultadoScannerRecebimento) {
    setResultadoScanner(resultado);
    if (!resultado.ok || !resultado.encontrado) return;

    setInsumoId(String(resultado.insumoId));
    if (resultado.loteCodigo) setCodigoLote(resultado.loteCodigo);
    if (resultado.validade) setValidade(resultado.validade);
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
    const sessao = sessaoCameraRef.current;
    setCameraStatus("iniciando");
    setCameraMessage(null);

    try {
      const controles = await iniciarLeitorCamera(video, (codigoLido) => {
        setCodigoScanner(codigoLido);
        resolverScanner(codigoLido);
      });
      if (sessao !== sessaoCameraRef.current) {
        // o diálogo fechou (ou a câmera foi parada) enquanto iniciava
        controles.stop();
        return;
      }
      controlsRef.current = controles;
      setCameraStatus("ativa");
    } catch (error) {
      if (sessao !== sessaoCameraRef.current) return;
      setCameraStatus("erro");
      setCameraMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível acessar a câmera. Digite o código.",
      );
    }
  }

  const inp =
    "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus:border-leaf-500 focus:outline-none focus:ring-1 focus:ring-leaf-500";
  const scanInput =
    "h-9 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus:border-leaf-500 focus:outline-none focus:ring-1 focus:ring-leaf-500";
  const saldoPendente = Math.max(0, item.quantidade - Number(item.quantidadeRecebida ?? 0));

  function focoInicial(event: Event) {
    // Leitor de código USB/Bluetooth "digita" no campo focado. Em tela de toque
    // não abre o teclado por cima da câmera: fica o foco padrão do diálogo.
    if (!codigoScannerRef.current || !window.matchMedia?.("(pointer: fine)").matches) return;
    event.preventDefault();
    codigoScannerRef.current.focus();
  }

  return (
    <Dialog open={aberto} onOpenChange={alternar}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md bg-leaf-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-leaf-500"
        >
          <PackageCheck className="h-3.5 w-3.5" />
          Receber
        </button>
      </DialogTrigger>

      <DialogContent
        className="max-h-[92dvh] max-w-2xl gap-0 overflow-y-auto rounded-xl text-left"
        onOpenAutoFocus={focoInicial}
      >
        <DialogHeader className="gap-0 pr-6">
          <div className="flex items-center gap-1">
            <DialogTitle>Receber item</DialogTitle>
            <HelpTip title="Recebimento do item">
              <p>
                Ao confirmar, a quantidade entra no estoque como um <b>lote</b> do insumo escolhido.
              </p>
              <p>Se chegou só uma parte, o item continua pendente até completar o pedido.</p>
            </HelpTip>
          </div>
          <DialogDescription className="mt-1 text-xs">
            {item.especificacao}
            {item.unidade ? ` · ${item.unidade}` : ""}
          </DialogDescription>
          {Number(item.quantidadeRecebida ?? 0) > 0 && (
            <p className="mt-1 text-xs font-medium text-warning-strong">
              Parcial recebido: {item.quantidadeRecebida} de {item.quantidade} {item.unidade ?? ""}. Saldo: {saldoPendente} {item.unidade ?? ""}.
            </p>
          )}
        </DialogHeader>

        <section aria-labelledby={`${uid}-ler-codigo`} className="mt-4 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id={`${uid}-ler-codigo`} className="inline-flex items-center gap-2 text-sm font-semibold">
              <ScanLine className="h-4 w-4 text-leaf-600 dark:text-leaf-300" />
              Ler código
            </h3>
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
              <label htmlFor={`${uid}-codigo-scanner`} className="sr-only">
                Código da etiqueta ou do fornecedor
              </label>
              <Keyboard
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/80"
              />
              <input
                ref={codigoScannerRef}
                id={`${uid}-codigo-scanner`}
                autoComplete="off"
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
              className="inline-flex items-center gap-1.5 rounded-md bg-leaf-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-leaf-500 disabled:opacity-50"
            >
              {scanPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Resolver
            </button>
          </div>

          {resultadoScanner && (
            <div
              className={`mt-3 rounded-md px-3 py-2 text-xs ${
                resultadoScanner.ok && resultadoScanner.encontrado
                  ? "bg-leaf-50 text-leaf-800 dark:bg-leaf-950/30 dark:text-leaf-300"
                  : "bg-warning-soft text-warning-strong"
              }`}
            >
              <p>{resultadoScanner.message}</p>
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
          <input type="hidden" name="pedido_interno_id" value={item.pedidoId} />
          <input type="hidden" name="operacao_id" value={operacaoId} />

          <div className="col-span-2">
            <label htmlFor={`${uid}-insumo`} className="block text-xs font-medium text-muted-foreground">
              Insumo de estoque <span className="text-danger-strong">*</span>
            </label>
            <select
              id={`${uid}-insumo`}
              name="insumo_id"
              value={insumoId}
              onChange={(event) => setInsumoId(event.target.value)}
              required
              className={inp}
            >
              <option value="">— selecione —</option>
              {insumos.map((insumo) => (
                <option key={insumo.id} value={insumo.id}>
                  {insumo.especificacao}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-1">
            {/* o "?" fica ao lado do rótulo, fora do <label>: botão dentro de rótulo confunde leitor de tela */}
            <div className="flex items-center gap-1">
              <label htmlFor={`${uid}-quantidade`} className="text-xs font-medium text-muted-foreground">
                {emFrascos ? "Frascos recebidos" : "Quantidade"} <span className="text-danger-strong">*</span>
              </label>
              {emFrascos && (
                <HelpTip title="Frascos recebidos">
                  <p>Conte frascos fechados, não o volume.</p>
                </HelpTip>
              )}
            </div>
            <input
              id={`${uid}-quantidade`}
              name="quantidade"
              type="number"
              step={emFrascos ? "1" : "any"}
              min={emFrascos ? "1" : "0.000001"}
              max={saldoPendente || item.quantidade}
              value={quantidade}
              onChange={(event) => setQuantidade(event.target.value)}
              className={inp}
            />
          </div>
          <div className="col-span-1">
            <span className="block text-xs font-medium text-muted-foreground">Unidade</span>
            <p className={`${inp} bg-muted/40 text-muted-foreground`} aria-live="off">
              {item.unidade || "conforme o pedido"}
            </p>
          </div>
          <div className="col-span-1">
            <label htmlFor={`${uid}-validade`} className="block text-xs font-medium text-muted-foreground">
              Validade
            </label>
            <input
              id={`${uid}-validade`}
              name="validade"
              type="date"
              value={validade}
              onChange={(event) => setValidade(event.target.value)}
              className={inp}
            />
          </div>
          <div className="col-span-1">
            <label htmlFor={`${uid}-codigo-lote`} className="block text-xs font-medium text-muted-foreground">
              Código do lote
            </label>
            <input
              id={`${uid}-codigo-lote`}
              name="codigo"
              type="text"
              value={codigoLote}
              onChange={(event) => setCodigoLote(event.target.value)}
              className={inp}
            />
          </div>
          <div className="col-span-1">
            <label htmlFor={`${uid}-custo`} className="block text-xs font-medium text-muted-foreground">
              Custo unitário (R$)
            </label>
            <input
              id={`${uid}-custo`}
              name="custo"
              type="number"
              step="0.0001"
              min="0"
              value={custo}
              onChange={(event) => setCusto(event.target.value)}
              className={inp}
            />
          </div>
          <div className="col-span-1">
            <label htmlFor={`${uid}-fornecedor`} className="block text-xs font-medium text-muted-foreground">
              Fornecedor
            </label>
            <input
              id={`${uid}-fornecedor`}
              name="fornecedor"
              type="text"
              value={fornecedor}
              onChange={(event) => setFornecedor(event.target.value)}
              className={inp}
            />
          </div>

          {state.message && !state.ok && (
            <p role="alert" className="col-span-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">
              {state.message}
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
              className="rounded-md bg-leaf-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-leaf-500 disabled:opacity-50"
            >
              {recebimentoPending ? "Recebendo…" : "Confirmar recebimento"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
