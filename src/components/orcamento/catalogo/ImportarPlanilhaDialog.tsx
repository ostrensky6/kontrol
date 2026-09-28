"use client";

import { useId, useState, useTransition } from "react";
import { FileUp } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { EstadoImportacaoCatalogo } from "@/lib/actions/catalogo-custos";
import type { AcaoImportacao, LinhaPreviaImportacao } from "@/lib/orcamento/catalogo-planilha";
import { formatCurrency as brl } from "@/lib/formatters";

type AcaoImportar = (anterior: EstadoImportacaoCatalogo, formData: FormData) => Promise<EstadoImportacaoCatalogo>;

const ROTULO: Record<AcaoImportacao, { texto: string; classe: string }> = {
  novo: { texto: "Novo", classe: "bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200" },
  atualizar: { texto: "Muda valor", classe: "bg-warning-soft text-warning-strong" },
  igual: { texto: "Sem mudança", classe: "bg-muted text-muted-foreground" },
  repetido: { texto: "Repetido", classe: "bg-muted text-muted-foreground" },
  sem_permissao: { texto: "Sem permissão", classe: "bg-muted text-muted-foreground" },
  erro: { texto: "Erro", classe: "bg-danger-soft text-danger-strong" },
};

const ORDEM: AcaoImportacao[] = ["erro", "novo", "atualizar", "sem_permissao", "repetido", "igual"];

function valor(v: number | null) {
  return v == null ? "—" : brl(v);
}

/**
 * Importa a planilha do catálogo em dois passos (Fase E): conferir (prévia, nada gravado) e
 * gravar. O arquivo fica guardado no estado para o segundo passo, sem escolher de novo.
 */
export function ImportarPlanilhaDialog({ action }: { action: AcaoImportar }) {
  const [aberto, setAberto] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [estado, setEstado] = useState<EstadoImportacaoCatalogo | null>(null);
  const [pendente, iniciar] = useTransition();
  const id = useId();

  const linhas = estado?.ok && !estado.aplicado ? (estado.linhas ?? []) : [];
  const mudancas = (estado?.resumo?.novo ?? 0) + (estado?.resumo?.atualizar ?? 0);
  const ordenadas = [...linhas].sort((a, b) => ORDEM.indexOf(a.acao) - ORDEM.indexOf(b.acao));

  function enviar(aplicar: boolean) {
    if (!arquivo) return;
    const formData = new FormData();
    formData.set("arquivo", arquivo);
    if (aplicar) formData.set("aplicar", "1");
    iniciar(async () => {
      const resultado = await action(estado ?? { ok: false }, formData);
      if (!resultado.ok) {
        toast.error(resultado.message ?? "Não foi possível importar.");
        setEstado(resultado);
        return;
      }
      if (resultado.aplicado) {
        toast.success(resultado.message);
        setAberto(false);
        setArquivo(null);
        setEstado(null);
        return;
      }
      setEstado(resultado);
    });
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(proximo) => {
        setAberto(proximo);
        if (!proximo) {
          setArquivo(null);
          setEstado(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium hover:bg-muted"
        >
          <FileUp className="size-4" aria-hidden />
          Importar
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl text-left">
        <DialogHeader>
          <DialogTitle>Importar planilha do catálogo</DialogTitle>
          <DialogDescription>
            Use a planilha de “Exportar” (uma aba por rubrica). Primeiro o Kontrol mostra o que muda; só grava quando você
            confirmar. Nada é apagado e os orçamentos já feitos não mudam.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor={`${id}-arquivo`}>Planilha (.xlsx)</Label>
            <input
              id={`${id}-arquivo`}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(evento) => {
                setArquivo(evento.target.files?.[0] ?? null);
                setEstado(null);
              }}
              className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1 file:text-sm file:font-medium"
            />
          </div>
          <button
            type="button"
            disabled={!arquivo || pendente}
            onClick={() => enviar(false)}
            className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pendente && !linhas.length ? "Conferindo…" : "Conferir"}
          </button>
        </div>

        {estado?.message && (
          <p role="status" className={`text-sm ${estado.ok ? "text-foreground" : "text-danger-strong"}`}>
            {estado.message}
          </p>
        )}
        {!!estado?.ignoradas?.length && (
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {estado.ignoradas.slice(0, 5).map((texto) => (
              <li key={texto}>{texto}</li>
            ))}
            {estado.ignoradas.length > 5 && <li>… e mais {estado.ignoradas.length - 5}.</li>}
          </ul>
        )}

        {linhas.length > 0 && (
          <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-medium">Resultado</th>
                  <th className="px-2 py-1 font-medium">Rubrica</th>
                  <th className="px-2 py-1 font-medium">Descrição</th>
                  <th className="px-2 py-1 font-medium">Unidade</th>
                  <th className="px-2 py-1 text-right font-medium">Planilha</th>
                  <th className="px-2 py-1 text-right font-medium">Catálogo hoje</th>
                  <th className="px-2 py-1 font-medium">Onde</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {ordenadas.map((linha: LinhaPreviaImportacao) => (
                  <tr key={linha.origem}>
                    <td className="whitespace-nowrap px-2 py-1" title={linha.mensagem ?? undefined}>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${ROTULO[linha.acao].classe}`}>
                        {ROTULO[linha.acao].texto}
                      </span>
                      {linha.mensagem && <span className="block pt-0.5 text-[11px] text-muted-foreground">{linha.mensagem}</span>}
                    </td>
                    <td className="px-2 py-1">{linha.rubrica || "—"}</td>
                    <td className="px-2 py-1">
                      {linha.descricao ?? "—"}
                      {linha.itemId && <span className="ml-1 text-muted-foreground">({linha.itemId})</span>}
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">{linha.unidade ?? "un"}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{valor(linha.preco)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-muted-foreground">
                      {valor(linha.precoAtual)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">{linha.origem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={() => setAberto(false)}
            className="rounded-md border border-input px-4 py-1.5 text-sm font-medium hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!mudancas || pendente}
            onClick={() => enviar(true)}
            className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pendente && linhas.length ? "Gravando…" : mudancas ? `Gravar ${mudancas} ${mudancas === 1 ? "mudança" : "mudanças"}` : "Gravar"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
