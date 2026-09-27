"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertCircle, Camera, Keyboard, Loader2 } from "lucide-react";
import { registrarConferenciaLotePlanejamento } from "@/lib/actions/planejamento-conferencia";
import {
  resolverCodigoPlanejamento,
  type ResultadoScannerPlanejamento,
} from "@/lib/actions/scanner";
import {
  iniciarLeitorCamera,
  type ScannerCameraControls,
} from "@/components/scanner/zxing-adapter";
import {
  loteEstaVencido,
  validarConferenciaLote,
} from "@/lib/planejamento/conferencia-lotes";
import type { FormState } from "@/lib/actions/cadastros";
import { enviarSemReset } from "@/lib/formulario-sem-perda";
import { HelpTip } from "@/components/common/HelpTip";

type StatusCamera = "parada" | "iniciando" | "ativa" | "erro";

export type PlanoConferenciaInsumo = {
  insumoId: number;
  especificacao: string;
  unidade: string | null;
  quantidadePrevista: number;
  loteSugeridoId: number | null;
  loteSugeridoLabel: string | null;
};

export type PlanoConferenciaRegistro = {
  id: number;
  insumoId: number;
  loteId: number;
  quantidadeConferida: number;
  status: string;
  justificativa: string | null;
};

export function PlanejamentoConferenciaLotes({
  planId,
  insumos,
  conferencias,
}: {
  planId: number;
  insumos: PlanoConferenciaInsumo[];
  conferencias: PlanoConferenciaRegistro[];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<ScannerCameraControls | null>(null);
  const [scanPending, startScanTransition] = useTransition();
  const [submitPending, startSubmitTransition] = useTransition();
  const [cameraStatus, setCameraStatus] = useState<StatusCamera>("parada");
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const [codigoScanner, setCodigoScanner] = useState("");
  const [insumoId, setInsumoId] = useState(insumos[0]?.insumoId ? String(insumos[0].insumoId) : "");
  const [resultadoScanner, setResultadoScanner] = useState<ResultadoScannerPlanejamento | null>(null);
  const [quantidadeConferida, setQuantidadeConferida] = useState(
    insumos[0]?.quantidadePrevista != null ? String(insumos[0].quantidadePrevista) : "",
  );
  const [justificativa, setJustificativa] = useState("");
  const [state, setState] = useState<FormState>({ ok: false });

  const insumoSelecionado = useMemo(
    () => insumos.find((item) => String(item.insumoId) === insumoId) ?? null,
    [insumoId, insumos],
  );
  const loteEscaneado = resultadoScanner?.ok && resultadoScanner.encontrado ? resultadoScanner : null;
  const validacao = loteEscaneado && insumoSelecionado
    ? validarConferenciaLote({
        lote: {
          id: loteEscaneado.id,
          insumoId: loteEscaneado.insumoId,
          quantidadeAtual: loteEscaneado.quantidadeAtual,
          status: loteEscaneado.status,
          validade: loteEscaneado.validade,
          validadeAposAbertura: loteEscaneado.validadeAposAbertura,
        },
        insumoEsperadoId: insumoSelecionado.insumoId,
        loteSugeridoId: insumoSelecionado.loteSugeridoId,
        justificativa,
      })
    : null;
  const precisaJustificativa = Boolean(validacao && !validacao.ok && validacao.status === "excecao_fefo")
    || Boolean(validacao && validacao.ok && validacao.status === "excecao_fefo");

  function pararCamera(status: StatusCamera = "parada") {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraStatus(status);
  }

  useEffect(() => {
    return () => {
      controlsRef.current?.stop();
    };
  }, []);

  function resolverScanner(codigo: string) {
    const codigoLimpo = codigo.trim();
    if (!codigoLimpo) {
      setResultadoScanner({ ok: false, message: "Informe um código para resolver." });
      return;
    }

    startScanTransition(async () => {
      const resultado = await resolverCodigoPlanejamento(codigoLimpo);
      setResultadoScanner(resultado);
      setState({ ok: false });
      setJustificativa("");
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
          : "Não foi possível acessar a câmera. Use a entrada manual.",
      );
    }
  }

  function salvarConferencia(formData: FormData) {
    setState({ ok: false });
    startSubmitTransition(async () => {
      const result = await registrarConferenciaLotePlanejamento({ ok: false }, formData);
      setState(result);
    });
  }

  const inputCls =
    "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const conferenciasPorInsumo = new Map(conferencias.map((item) => [item.insumoId, item]));
  const podeSalvar = Boolean(loteEscaneado && insumoSelecionado && validacao?.ok);

  return (
    <section className="mt-8 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Separar material</h2>
            <HelpTip title="Separar material">
              <p>
                A retirada acontece ao clicar em <b>Retirar insumos e iniciar</b>. Ela sai do lote
                conferido aqui quando ele tem saldo livre para a reserva; senão, do lote{" "}
                <b>reservado</b>.
              </p>
            </HelpTip>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Escaneie o lote separado para conferir com a reserva. Não dá baixa no estoque.
          </p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {cameraStatus === "ativa"
            ? "Câmera ativa"
            : cameraStatus === "iniciando"
              ? "Iniciando câmera"
              : "Digitação manual"}
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="space-y-3">
          {insumos.map((item) => {
            const conferencia = conferenciasPorInsumo.get(item.insumoId);
            return (
              <button
                key={item.insumoId}
                type="button"
                onClick={() => {
                  setInsumoId(String(item.insumoId));
                  setQuantidadeConferida(String(item.quantidadePrevista));
                }}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                  String(item.insumoId) === insumoId
                    ? "border-brand-400 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/30"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <span className="font-medium">{item.especificacao}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {item.quantidadePrevista} {item.unidade ?? ""}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Referência para conferência: {item.loteSugeridoLabel ?? "sem lote reservado/disponível"}
                </span>
                {conferencia && (
                  <span className="mt-1 inline-flex rounded-full bg-brand-100 px-2 py-0.5 text-[11px] text-brand-800 dark:bg-brand-950/50 dark:text-brand-300">
                    Rastreado lote #{conferencia.loteId}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <video ref={videoRef} muted playsInline className="aspect-video w-full bg-card object-cover" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={iniciarCamera}
              disabled={cameraStatus === "iniciando" || scanPending || submitPending}
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
              disabled={cameraStatus === "parada" || submitPending}
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
                className={`${inputCls} mt-0 pl-8`}
                placeholder="/s/lote/123 ou código interno"
              />
            </div>
            <button
              type="button"
              onClick={() => resolverScanner(codigoScanner)}
              disabled={scanPending || submitPending || codigoScanner.trim().length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {scanPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Resolver
            </button>
          </div>

          {resultadoScanner && (
            <div
              className={`mt-3 rounded-md px-3 py-2 text-xs ${
                loteEscaneado && validacao?.ok
                  ? "bg-brand-50 text-brand-800 dark:bg-brand-950/30 dark:text-brand-300"
                  : "bg-warning-soft text-warning-strong"
              }`}
            >
              <p>{validacao?.message ?? resultadoScanner.message}</p>
              {validacao?.status === "excecao_fefo" && (
                <p className="mt-1">Na retirada, este lote substitui o reservado se tiver saldo livre.</p>
              )}
              {loteEscaneado && (
                <p className="mt-1 font-medium">
                  Lote #{loteEscaneado.id}
                  {loteEscaneado.loteCodigo ? ` · ${loteEscaneado.loteCodigo}` : ""}
                  {loteEstaVencido(loteEscaneado) ? " · vencido" : ""}
                  {loteEscaneado.status !== "aceito" && loteEscaneado.status !== "em_uso"
                    ? ` · ${loteEscaneado.status}`
                    : ""}
                </p>
              )}
              {resultadoScanner.ok && !resultadoScanner.encontrado && (
                <Link href={resultadoScanner.triagemUrl} className="mt-1 inline-block font-medium underline">
                  Abrir triagem
                </Link>
              )}
            </div>
          )}

          <form onSubmit={enviarSemReset(salvarConferencia)} className="mt-4 grid gap-3">
            <input type="hidden" name="planejamento_id" value={planId} />
            <input type="hidden" name="insumo_id" value={insumoSelecionado?.insumoId ?? ""} />
            <input type="hidden" name="lote_id" value={loteEscaneado?.id ?? ""} />
            <input type="hidden" name="quantidade_prevista" value={insumoSelecionado?.quantidadePrevista ?? ""} />
            <div>
              <label className="block text-xs font-medium text-muted-foreground">
                Quantidade conferida
              </label>
              <input
                name="quantidade_conferida"
                type="number"
                step="any"
                min="0"
                value={quantidadeConferida}
                onChange={(event) => setQuantidadeConferida(event.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Justificativa {precisaJustificativa && <span className="text-danger-strong">*</span>}
                <HelpTip title="Quando justificar">
                  <p>
                    Quando o lote separado <b>difere do reservado</b> ou não é o que vence primeiro. A
                    justificativa fica registrada e a retirada passa a sair do lote conferido.
                  </p>
                </HelpTip>
              </label>
              <textarea
                name="justificativa"
                rows={3}
                value={justificativa}
                onChange={(event) => setJustificativa(event.target.value)}
                required={precisaJustificativa}
                className={inputCls}
              />
              {state.errors?.justificativa && (
                <p className="mt-1 text-xs text-danger-strong">{state.errors.justificativa}</p>
              )}
            </div>

            {state.message && (
              <p
                className={`rounded-md px-3 py-2 text-sm ${
                  state.ok
                    ? "bg-brand-50 text-brand-800 dark:bg-brand-950/30 dark:text-brand-300"
                    : "bg-danger-soft text-danger-strong"
                }`}
              >
                {state.message}
              </p>
            )}

            <button
              disabled={submitPending || !podeSalvar}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {submitPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Registrar conferência
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
