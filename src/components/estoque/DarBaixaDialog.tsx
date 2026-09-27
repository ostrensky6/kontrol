"use client";

import { useId, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { darBaixaLote } from "@/lib/actions/estoque";
import type { FormState } from "@/lib/actions/cadastros";
import {
  MOTIVOS_BAIXA,
  disponivelParaBaixa,
  formatarDataIso,
  loteVencido,
  lotesParaBaixa,
  situacaoBaixa,
  type LoteBaixa,
} from "@/lib/estoque/baixa";
import { formatNumber } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const TRIGGER_PADRAO =
  "rounded px-2 py-1 text-xs font-medium text-danger-strong hover:bg-danger-soft disabled:opacity-50";

type Erros = Partial<Record<"lote" | "quantidade" | "motivo_tipo" | "motivo_detalhe", string>>;

/**
 * "Dar baixa" reutilizável: por lote (página do lote, tabela de lotes) ou
 * por insumo (sugere o lote FEFO e permite trocar). Pede frascos inteiros
 * para lotes de embalagens fechadas e quantidade na unidade do insumo para
 * lotes legados. Motivo obrigatório.
 */
export function DarBaixaDialog({
  lotes,
  unidade,
  especificacao,
  triggerLabel = "Dar baixa",
  triggerClassName = TRIGGER_PADRAO,
  mostrarIndisponivel = true,
}: {
  lotes: LoteBaixa[];
  unidade: string;
  especificacao?: string;
  triggerLabel?: string;
  triggerClassName?: string;
  /** exibe o motivo quando nenhum lote aceita baixa */
  mostrarIndisponivel?: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const enviando = useRef(false);
  const [aberto, setAberto] = useState(false);
  const [loteId, setLoteId] = useState<number | null>(null);
  const [quantidade, setQuantidade] = useState("");
  const [motivoTipo, setMotivoTipo] = useState("");
  const [motivoDetalhe, setMotivoDetalhe] = useState("");
  const [erros, setErros] = useState<Erros>({});
  const [resultado, setResultado] = useState<FormState>({ ok: false });
  const [operacaoId, setOperacaoId] = useState("");

  const candidatos = useMemo(() => lotesParaBaixa(lotes), [lotes]);
  const sugerido = candidatos[0] ?? null;
  const lote = candidatos.find((item) => item.id === loteId) ?? sugerido;

  if (!sugerido) {
    if (!mostrarIndisponivel || lotes.length === 0) return null;
    const motivos = [
      ...new Set(lotes.map((item) => situacaoBaixa(item)).map((s) => (s.permitida ? "" : s.motivo))),
    ].filter(Boolean);
    const motivo = motivos.length === 1 ? motivos[0] : "Nenhum lote disponível para baixa.";
    const curto = motivo.startsWith("Lote vencido") ? "Vencido: sem baixa" : motivo;
    return (
      <span className="px-2 py-1 text-xs text-muted-foreground" title={motivo}>
        {curto}
      </span>
    );
  }

  const emEmbalagens = lote?.modeloQuantidade === "EMBALAGEM_FECHADA";
  // lote vencido não vai para uso: só sai do saldo como Vencimento
  const somenteVencimento = lote ? loteVencido(lote.validade) : false;
  const motivosPermitidos = somenteVencimento ? (["Vencimento"] as const) : MOTIVOS_BAIXA;
  const motivoEfetivo = somenteVencimento ? "Vencimento" : motivoTipo;
  const disponivel = lote ? disponivelParaBaixa(lote) : 0;
  const unidadeQtd = emEmbalagens ? "frasco(s)" : unidade;

  function limpar() {
    setLoteId(null);
    setQuantidade("");
    setMotivoTipo("");
    setMotivoDetalhe("");
    setErros({});
  }

  function alternar(abrir: boolean) {
    if (pending) return;
    setAberto(abrir);
    if (abrir) {
      limpar();
      setResultado({ ok: false });
      setOperacaoId(crypto.randomUUID());
    }
  }

  function validar(): Erros {
    const novos: Erros = {};
    const n = Number(quantidade.replace(",", "."));
    if (!lote) novos.lote = "Selecione o lote.";
    if (!quantidade.trim() || !Number.isFinite(n) || n <= 0) novos.quantidade = "Informe uma quantidade maior que zero.";
    else if (emEmbalagens && !Number.isInteger(n)) novos.quantidade = "Use um número inteiro de frascos.";
    else if (n > disponivel) {
      novos.quantidade = `Máximo disponível: ${formatNumber(disponivel)} ${unidadeQtd}.`;
    }
    if (!motivoEfetivo) novos.motivo_tipo = "Selecione o motivo.";
    if (motivoEfetivo === "Outro" && motivoDetalhe.trim().length < 3) novos.motivo_detalhe = "Descreva o motivo.";
    return novos;
  }

  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enviando.current || !lote) return;
    const novos = validar();
    setErros(novos);
    if (Object.keys(novos).length > 0) return;

    const formData = new FormData();
    formData.set("lote_id", String(lote.id));
    formData.set("quantidade", quantidade.replace(",", "."));
    formData.set("quantidade_esperada", String(lote.quantidadeAtual));
    formData.set("motivo_tipo", motivoEfetivo);
    formData.set("motivo_detalhe", motivoDetalhe);
    formData.set("operacao_id", operacaoId);

    enviando.current = true;
    startTransition(async () => {
      try {
        const res = await darBaixaLote({ ok: false }, formData);
        if (res.ok) {
          setAberto(false);
          limpar();
          setResultado(res);
          router.refresh();
        } else {
          setResultado(res);
          if (res.errors) setErros((atual) => ({ ...atual, ...res.errors }));
        }
      } catch (error) {
        setResultado({
          ok: false,
          message: error instanceof Error ? error.message : "Não foi possível registrar a baixa.",
        });
      } finally {
        enviando.current = false;
      }
    });
  }

  const descricaoLote = (item: LoteBaixa) =>
    `${item.codigoLote} · val. ${formatarDataIso(item.validade)} · ${formatNumber(disponivelParaBaixa(item))} ${
      item.modeloQuantidade === "EMBALAGEM_FECHADA" ? "emb." : unidade
    } disponíveis`;

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Dialog open={aberto} onOpenChange={alternar}>
        <DialogTrigger asChild>
          <button type="button" className={triggerClassName}>
            {triggerLabel}
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-md text-left">
          <form onSubmit={enviar} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Dar baixa</DialogTitle>
              <DialogDescription>
                {especificacao ? `${especificacao}. ` : ""}Registra a saída do estoque com motivo; fica no histórico do lote.
              </DialogDescription>
            </DialogHeader>

            {candidatos.length > 1 ? (
              <div className="grid gap-1">
                <Label htmlFor={`${uid}-lote`}>Lote</Label>
                <Select
                  id={`${uid}-lote`}
                  value={String(lote?.id ?? "")}
                  onChange={(event) => setLoteId(Number(event.target.value))}
                  aria-describedby={`${uid}-lote-ajuda`}
                >
                  {candidatos.map((item) => (
                    <option key={item.id} value={item.id}>
                      {descricaoLote(item)}
                    </option>
                  ))}
                </Select>
                <p id={`${uid}-lote-ajuda`} className="text-xs text-muted-foreground">
                  {lote?.id === sugerido.id
                    ? "Sugerido: o lote que vence primeiro (FEFO)."
                    : `Atenção: o lote ${sugerido.codigoLote} vence antes (FEFO).`}
                </p>
              </div>
            ) : (
              <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                Lote <span className="font-medium text-foreground">{lote?.codigoLote}</span> · validade{" "}
                {formatarDataIso(lote?.validade)} · saldo {formatNumber(lote?.quantidadeAtual ?? 0)}{" "}
                {emEmbalagens ? "frasco(s)" : unidade}
                {lote && lote.reservado > 0 ? ` (${formatNumber(lote.reservado)} reservado)` : ""}
              </p>
            )}

            <div className="grid gap-1">
              <Label htmlFor={`${uid}-quantidade`}>
                {emEmbalagens ? "Frascos a baixar" : `Quantidade a baixar (${unidade || "unidade do insumo"})`}
              </Label>
              <Input
                id={`${uid}-quantidade`}
                name="quantidade"
                type="number"
                inputMode={emEmbalagens ? "numeric" : "decimal"}
                step={emEmbalagens ? 1 : "any"}
                min={emEmbalagens ? 1 : 0}
                max={disponivel}
                value={quantidade}
                onChange={(event) => setQuantidade(event.target.value)}
                aria-invalid={Boolean(erros.quantidade)}
                aria-describedby={`${uid}-quantidade-ajuda`}
              />
              <p id={`${uid}-quantidade-ajuda`} className={erros.quantidade ? "text-xs text-danger-strong" : "text-xs text-muted-foreground"}>
                {erros.quantidade ??
                  (emEmbalagens
                    ? `Número inteiro de frascos fechados. Disponível: ${formatNumber(disponivel)}.`
                    : `Disponível: ${formatNumber(disponivel)} ${unidade}.`)}
              </p>
            </div>

            <div className="grid gap-1">
              <Label htmlFor={`${uid}-motivo`}>Motivo</Label>
              <Select
                id={`${uid}-motivo`}
                name="motivo_tipo"
                value={motivoEfetivo}
                onChange={(event) => setMotivoTipo(event.target.value)}
                disabled={somenteVencimento}
                aria-invalid={Boolean(erros.motivo_tipo)}
                aria-describedby={erros.motivo_tipo ? `${uid}-motivo-erro` : undefined}
                required
              >
                <option value="">Selecione…</option>
                {motivosPermitidos.map((motivo) => (
                  <option key={motivo} value={motivo}>
                    {motivo}
                  </option>
                ))}
              </Select>
              {somenteVencimento && (
                <p className="text-xs text-warning-strong">Lote vencido: sai do saldo como perda por vencimento.</p>
              )}
              {erros.motivo_tipo && (
                <p id={`${uid}-motivo-erro`} className="text-xs text-danger-strong">
                  {erros.motivo_tipo}
                </p>
              )}
            </div>

            <div className="grid gap-1">
              <Label htmlFor={`${uid}-detalhe`}>
                Detalhe {motivoTipo === "Outro" ? "(obrigatório)" : "(opcional)"}
              </Label>
              <Textarea
                id={`${uid}-detalhe`}
                name="motivo_detalhe"
                rows={2}
                value={motivoDetalhe}
                onChange={(event) => setMotivoDetalhe(event.target.value)}
                placeholder="Ex.: frasco trincado, análise extra do lote 12…"
                aria-invalid={Boolean(erros.motivo_detalhe)}
                aria-describedby={erros.motivo_detalhe ? `${uid}-detalhe-erro` : undefined}
              />
              {erros.motivo_detalhe && (
                <p id={`${uid}-detalhe-erro`} className="text-xs text-danger-strong">
                  {erros.motivo_detalhe}
                </p>
              )}
            </div>

            {resultado.message && !resultado.ok && (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">
                {resultado.message}
              </p>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" disabled={pending}>
                  Cancelar
                </Button>
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={pending} aria-busy={pending}>
                {pending ? "Registrando…" : "Registrar baixa"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {resultado.ok && resultado.message && (
        <span role="status" className="text-[11px] text-brand-700 dark:text-brand-300">
          {resultado.message}
        </span>
      )}
    </span>
  );
}
