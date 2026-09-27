"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  aceitarLote,
  ajustarSaldoLote,
  bloquearLote,
  desbloquearLote,
  descartarLote,
  estornarRecebimentoLote,
} from "@/lib/actions/estoque";
import type { FormState } from "@/lib/actions/cadastros";
import { DarBaixaDialog } from "@/components/estoque/DarBaixaDialog";
import { HelpTip } from "@/components/common/HelpTip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ModeloQuantidadeLote } from "@/lib/estoque/baixa";

type Acao = (fd: FormData) => Promise<{ ok: boolean; message?: string }>;
type ActionState = (prev: FormState, fd: FormData) => Promise<FormState>;

export function LoteAcoes({
  loteId,
  codigoLote = `LOTE-${loteId}`,
  status,
  quantidadeAtual,
  unidade,
  critico,
  validade = null,
  rotuloBaixa = "Baixa",
  reservado = 0,
  modeloQuantidade = "LEGADO",
  estornoDiretoPermitido = false,
  estornoRecebimento = false,
  origemRecebimento = "compra",
  responsavelPadrao = "",
  aceiteBloqueadoMotivo = null,
  podeAceitar,
  podeGerir,
  podeCorrigir = podeAceitar,
  podeBaixar = true,
}: {
  loteId: number;
  codigoLote?: string;
  status: string;
  quantidadeAtual: number;
  unidade: string;
  critico: boolean;
  /** validade efetiva (aaaa-mm-dd) */
  validade?: string | null;
  vencido?: boolean;
  /** texto do botão de baixa (na página do lote: "Dar baixa") */
  rotuloBaixa?: string;
  reservado?: number;
  modeloQuantidade?: ModeloQuantidadeLote;
  estornoDiretoPermitido?: boolean;
  /** lote de compra ou pedido interno sem consumo: estorno bilateral do recebimento */
  estornoRecebimento?: boolean;
  /** de onde veio o recebimento estornável: muda só o texto do diálogo */
  origemRecebimento?: "compra" | "pedido_interno";
  /** nome (ou e-mail) de quem está logado: sugestão editável do responsável pelo aceite */
  responsavelPadrao?: string;
  /** quem registrou a chegada não aceita o próprio lote: explica por que o Aceitar sumiu */
  aceiteBloqueadoMotivo?: string | null;
  /** permissão "Aceitar lotes" */
  podeAceitar: boolean;
  /** permissão "Bloquear e descartar lotes" */
  podeGerir: boolean;
  /** permissão "Corrigir estoque": ajustar saldo e estornar entrada */
  podeCorrigir?: boolean;
  /** permissão "Dar baixa e registrar entradas" */
  podeBaixar?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const executando = useRef(false);
  const [modal, setModal] = useState<null | "aceitar" | "estornar" | "bloquear" | "descartar" | "ajuste">(null);
  const [motivo, setMotivo] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [state, setState] = useState<FormState>({ ok: false });

  function fd(extra: Record<string, string> = {}) {
    const f = new FormData();
    f.set("lote_id", String(loteId));
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  }
  function run(action: Acao, extra: Record<string, string> = {}) {
    if (executando.current) return;
    executando.current = true;
    start(async () => {
      try {
        const res = await action(fd(extra));
        setState(res);
        if (res.ok) {
          setModal(null);
          setMotivo("");
          setQuantidade("");
          setResponsavel("");
          setState({ ok: false });
          router.refresh();
        }
      } catch (error) {
        setState({
          ok: false,
          message: error instanceof Error ? error.message : "Não foi possível concluir a ação.",
        });
      } finally {
        executando.current = false;
      }
    });
  }
  function runState(action: ActionState, extra: Record<string, string>) {
    if (executando.current) return;
    executando.current = true;
    start(async () => {
      try {
        const res = await action({ ok: false }, fd(extra));
        setState(res);
        if (res.ok) {
          setModal(null);
          setMotivo("");
          setQuantidade("");
          setResponsavel("");
          router.refresh();
        }
      } catch (error) {
        setState({
          ok: false,
          message: error instanceof Error ? error.message : "Não foi possível concluir a ação.",
        });
      } finally {
        executando.current = false;
      }
    });
  }

  function fechar() {
    setModal(null);
    setState({ ok: false });
    setMotivo("");
    setQuantidade("");
    setResponsavel("");
  }

  const rotuloMotivo =
    modal === "aceitar"
      ? "Critério de aceite"
      : modal === "estornar"
        ? "Motivo do estorno"
        : modal === "bloquear"
          ? "Motivo do bloqueio"
          : modal === "descartar"
            ? "Justificativa do descarte"
            : "Motivo do ajuste";
  const btn = "rounded px-2 py-1 text-xs font-medium disabled:opacity-50";
  const loteAtivo = status === "aceito" || status === "em_uso";
  const emEmbalagens = modeloQuantidade === "EMBALAGEM_FECHADA";

  return (
    <span className="inline-flex flex-wrap gap-1">
      {status === "quarentena" && (
        <>
          {podeAceitar && !aceiteBloqueadoMotivo && (
            <button disabled={pending} onClick={() => {
                setState({ ok: false });
                setResponsavel(responsavelPadrao);
                setModal("aceitar");
              }} className={`${btn} text-brand-700 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/30`}>
              Aceitar
            </button>
          )}
          {podeAceitar && aceiteBloqueadoMotivo && (
            <span className="text-xs text-muted-foreground">{aceiteBloqueadoMotivo}</span>
          )}
          {estornoDiretoPermitido && podeCorrigir && (
            <button disabled={pending} onClick={() => setModal("estornar")} className={`${btn} text-danger-strong hover:bg-danger-soft`}>
              Estornar entrada
            </button>
          )}
        </>
      )}
      {estornoRecebimento && podeCorrigir && (status === "quarentena" || status === "aceito") && (
        <button disabled={pending} onClick={() => setModal("estornar")} className={`${btn} text-danger-strong hover:bg-danger-soft`}>
          Estornar recebimento
        </button>
      )}
      {(status === "aceito" || status === "em_uso") && podeGerir && (
        <button disabled={pending} onClick={() => setModal("bloquear")} className={`${btn} text-warning-strong hover:bg-warning-soft`}>
          Bloquear
        </button>
      )}
      {/* vencido também: o diálogo só aceita o motivo Vencimento (0117) */}
      {loteAtivo && podeBaixar && (
        <DarBaixaDialog
          lotes={[{ id: loteId, codigoLote, validade, quantidadeAtual, reservado, modeloQuantidade, status }]}
          unidade={unidade}
          triggerLabel={rotuloBaixa}
          triggerClassName={`${btn} text-danger-strong hover:bg-danger-soft`}
        />
      )}
      {loteAtivo && podeCorrigir && (
        <button disabled={pending} onClick={() => setModal("ajuste")} className={`${btn} text-info-strong hover:bg-info-soft`}>
          Ajustar
        </button>
      )}
      {status === "bloqueado" && podeGerir && (
        <button aria-busy={pending} disabled={pending} onClick={() => run(desbloquearLote)} className={`${btn} text-info-strong hover:bg-info-soft`}>
          {pending ? "Desbloqueando…" : "Desbloquear"}
        </button>
      )}
      {status !== "consumido" && status !== "descartado" && podeGerir && (
        <button disabled={pending} onClick={() => setModal("descartar")} className={`${btn} text-danger-strong hover:bg-danger-soft`}>
          Descartar
        </button>
      )}
      {!podeAceitar && !podeGerir && status === "quarentena" && (
        <span className="text-xs text-muted-foreground/80">aguardando aceitação</span>
      )}
      {state.message && !state.ok && !modal && (
        <span role="alert" className="basis-full rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">
          {state.message}
        </span>
      )}

      {state.ok && state.message && !modal && (
        <span role="status" aria-live="polite" className="basis-full rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800 dark:bg-brand-950/50 dark:text-brand-300">
          {state.message}
        </span>
      )}

      <Dialog
        open={modal !== null}
        onOpenChange={(aberto) => {
          if (!aberto && !pending) fechar();
        }}
      >
        <DialogContent className="max-w-sm text-left" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-center gap-1">
              <DialogTitle>
                {modal === "aceitar"
                  ? "Aceitar lote"
                  : modal === "estornar"
                    ? estornoRecebimento ? "Estornar recebimento" : "Estornar entrada"
                  : modal === "bloquear"
                  ? "Bloquear lote"
                  : modal === "descartar"
                    ? "Descartar lote"
                    : "Ajustar saldo"}
              </DialogTitle>
              {modal === "estornar" && (
                <HelpTip title="Estorno de entrada">
                  <p>
                    Corrige uma entrada lançada por engano <b>sem apagar o histórico</b>: um movimento
                    compensatório zera o saldo do lote.
                  </p>
                  <p>
                    {estornoRecebimento
                      ? "Lote de compra ou pedido interno: o estorno também devolve a quantidade ao item, que volta a aguardar a chegada."
                      : "Só aparece para lotes em quarentena que não vieram de um pedido."}
                  </p>
                </HelpTip>
              )}
              {modal === "ajuste" && (
                <HelpTip title="Ajuste de saldo">
                  <p>
                    Use quando a contagem física não bate com o sistema. O novo saldo substitui o
                    atual e a <b>diferença</b> fica registrada com o motivo.
                  </p>
                </HelpTip>
              )}
            </div>
            <DialogDescription className="text-xs">
              {modal === "aceitar"
                ? critico
                  ? "Material crítico precisa de responsável e critério de aceite antes de ficar disponível."
                  : "Registre a liberação do lote para uso."
                : modal === "estornar"
                  ? estornoRecebimento
                    ? origemRecebimento === "pedido_interno"
                      ? "O saldo do lote será zerado e o pedido interno volta a aguardar esse recebimento. O histórico é mantido."
                      : "O saldo do lote será zerado e a compra volta a aguardar esse recebimento. O histórico é mantido."
                    : "O saldo do lote será zerado; o histórico é mantido."
                : modal === "bloquear"
                ? "Informe o motivo do bloqueio (não conformidade, recall, investigação…)."
                : modal === "descartar"
                  ? "Informe a justificativa do descarte. O saldo será zerado."
                  : `Informe o saldo contado no inventário. Saldo atual: ${quantidadeAtual} ${emEmbalagens ? "frasco(s)" : unidade}.`}
            </DialogDescription>
          </DialogHeader>
          {modal === "ajuste" && (
            <div>
              <label htmlFor={`lote-${loteId}-saldo-contado`} className="block text-xs font-medium text-muted-foreground">
                Saldo contado{emEmbalagens ? " (frascos inteiros)" : ""}
              </label>
              <input
                id={`lote-${loteId}-saldo-contado`}
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                type="number"
                step={emEmbalagens ? 1 : "any"}
                min="0"
                className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-brand-700 dark:text-brand-300"
              />
              {state.errors?.quantidade_nova && <p className="mt-1 text-xs text-danger-strong">{state.errors.quantidade_nova}</p>}
            </div>
          )}
          {modal === "aceitar" && (
            <div>
              <label htmlFor={`lote-${loteId}-responsavel`} className="block text-xs font-medium text-muted-foreground">
                Responsável {critico && <span className="text-danger-strong">*</span>}
              </label>
              <input
                id={`lote-${loteId}-responsavel`}
                value={responsavel}
                onChange={(e) => setResponsavel(e.target.value)}
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-brand-700 dark:text-brand-300"
              />
            </div>
          )}
          <div>
            <label htmlFor={`lote-${loteId}-motivo`} className="block text-xs font-medium text-muted-foreground">
              {rotuloMotivo}
              {modal !== "aceitar" || critico ? <span className="text-danger-strong"> *</span> : null}
            </label>
            <textarea
              id={`lote-${loteId}-motivo`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-brand-700 dark:text-brand-300"
            />
            {state.errors?.motivo && <p className="mt-1 text-xs text-danger-strong">{state.errors.motivo}</p>}
          </div>
          {state.message && !state.ok && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">
              {state.message}
            </p>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={fechar}
              disabled={pending}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            >
              Voltar
            </button>
            <button
              type="button"
              aria-busy={pending}
              disabled={
                pending ||
                (modal !== "aceitar" && !motivo.trim()) ||
                (modal === "aceitar" && critico && (!motivo.trim() || !responsavel.trim())) ||
                (modal === "ajuste" && !quantidade)
              }
              onClick={() => {
                if (modal === "aceitar") run(aceitarLote, { criterio: motivo, responsavel });
                if (modal === "estornar") runState(estornarRecebimentoLote, { motivo });
                if (modal === "bloquear") run(bloquearLote, { motivo });
                if (modal === "descartar") run(descartarLote, { justificativa: motivo });
                if (modal === "ajuste") runState(ajustarSaldoLote, { motivo, quantidade_nova: quantidade });
              }}
              className={`rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
                modal === "bloquear"
                  ? "bg-warning-strong hover:bg-warning-strong/90"
                  : modal === "aceitar"
                    ? "bg-brand-600 hover:bg-brand-500"
                  : modal === "ajuste"
                    ? "bg-primary hover:bg-primary/90"
                    : "bg-destructive hover:bg-destructive/90"
              }`}
            >
              {pending
                ? "Processando…"
                 : modal === "aceitar"
                   ? "Aceitar"
                 : modal === "estornar"
                   ? "Confirmar estorno"
                 : modal === "bloquear"
                  ? "Bloquear"
                  : modal === "descartar"
                    ? "Descartar"
                    : "Ajustar saldo"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}
