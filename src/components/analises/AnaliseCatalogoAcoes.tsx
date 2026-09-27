"use client";

import { useActionState, useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  criarAnaliseAcao,
  definirSituacaoAnalise,
  excluirAnaliseAcao,
  type AnaliseFormState,
} from "@/lib/actions/receita";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

export type AnaliseOpcao = { codigo: string; rotulo: string };

const inicial: AnaliseFormState = { ok: false };

/** Botão "Nova análise" do catálogo. */
export function NovaAnaliseButton({ analises }: { analises: AnaliseOpcao[] }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setAberto(true)}>
        <Plus />
        Nova análise
      </Button>
      {aberto && <NovaAnaliseDialog analises={analises} onOpenChange={setAberto} />}
    </>
  );
}

function NovaAnaliseDialog({
  analises,
  origemInicial,
  onOpenChange,
}: {
  analises: AnaliseOpcao[];
  origemInicial?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const ids = useId();
  const [state, action, pending] = useActionState(criarAnaliseAcao, inicial);
  const origemRotulo = analises.find((a) => a.codigo === origemInicial)?.rotulo;

  useEffect(() => {
    if (!state.ok || !state.codigo) return;
    toast.success("Análise criada", { description: state.codigo });
    onOpenChange(false);
    router.push(`/analises/${encodeURIComponent(state.codigo)}`);
  }, [state.ok, state.codigo, router, onOpenChange]);

  return (
    <Dialog open onOpenChange={(open) => !pending && onOpenChange(open)}>
      <DialogContent className="max-w-md" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{origemInicial ? "Duplicar análise" : "Nova análise"}</DialogTitle>
          <DialogDescription>
            {origemInicial
              ? `Cria uma cópia de ${origemRotulo ?? origemInicial} com etapas, materiais e equipamentos.`
              : "Depois de criar, complete etapas, materiais e equipamentos na ficha."}
          </DialogDescription>
        </DialogHeader>

        <form action={action} {...formularioSemPerda(state)} className="grid gap-4">
          <div>
            <div className="flex items-center gap-0.5">
              <Label htmlFor={`${ids}-codigo`}>
                Código <span className="text-destructive">*</span>
              </Label>
              <HelpTip title="Código da análise">
                <p>Identificador curto e único, usado em orçamentos e planos. <b>Não pode ser alterado</b> depois.</p>
                <HelpExample>qPCR_SARS2, Illumina_16S, Sanger</HelpExample>
              </HelpTip>
            </div>
            <Input
              id={`${ids}-codigo`}
              name="codigo"
              required
              maxLength={60}
              pattern="[A-Za-z0-9_.\-]{2,60}"
              autoComplete="off"
              placeholder="Ex.: qPCR_SARS2"
              className="mt-1 font-mono"
              aria-invalid={state.errors?.codigo ? true : undefined}
            />
            {state.errors?.codigo && <p className="mt-1 text-xs text-destructive">{state.errors.codigo}</p>}
          </div>

          <div>
            <Label htmlFor={`${ids}-nome`}>Nome</Label>
            <Input id={`${ids}-nome`} name="nome" maxLength={160} className="mt-1" placeholder="Ex.: RT-qPCR SARS-CoV-2" />
          </div>

          <div>
            <Label htmlFor={`${ids}-descricao`}>Descrição (opcional)</Label>
            <Textarea id={`${ids}-descricao`} name="descricao" rows={2} maxLength={500} className="mt-1" />
          </div>

          {origemInicial ? (
            <input type="hidden" name="origem" value={origemInicial} />
          ) : (
            <div>
              <div className="flex items-center gap-0.5">
                <Label htmlFor={`${ids}-origem`}>Começar a partir de</Label>
                <HelpTip title="Começar a partir de">
                  <p>
                    Escolha uma análise parecida para <b>copiar</b> etapas, materiais e equipamentos.
                    Depois, ajuste só o que muda.
                  </p>
                </HelpTip>
              </div>
              <Select id={`${ids}-origem`} name="origem" defaultValue="" className="mt-1">
                <option value="">Análise em branco</option>
                {analises.map((a) => (
                  <option key={a.codigo} value={a.codigo}>
                    Cópia de {a.rotulo}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {state.message && !state.ok && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">
              {state.message}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Criando…" : origemInicial ? "Duplicar" : "Criar análise"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Ações por linha do catálogo: abrir ficha, duplicar, excluir. */
export function AnaliseLinhaAcoes({
  codigo,
  rotulo,
  analises,
  podeEditar,
}: {
  codigo: string;
  rotulo: string;
  analises: AnaliseOpcao[];
  podeEditar: boolean;
}) {
  const [dialogo, setDialogo] = useState<null | "duplicar" | "excluir">(null);
  const href = `/analises/${encodeURIComponent(codigo)}`;

  return (
    <span className="inline-flex items-center gap-1">
      <Button asChild size="sm">
        <Link href={href}>Abrir ficha</Link>
      </Button>
      {podeEditar && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={`Mais ações de ${rotulo}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setDialogo("duplicar")}>
              <Copy />
              Duplicar
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setDialogo("excluir")}>
              <Trash2 />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {dialogo === "duplicar" && (
        <NovaAnaliseDialog analises={analises} origemInicial={codigo} onOpenChange={() => setDialogo(null)} />
      )}
      {dialogo === "excluir" && (
        <ExcluirAnaliseDialog codigo={codigo} rotulo={rotulo} onOpenChange={() => setDialogo(null)} />
      )}
    </span>
  );
}

function ExcluirAnaliseDialog({
  codigo,
  rotulo,
  onOpenChange,
}: {
  codigo: string;
  rotulo: string;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(excluirAnaliseAcao, inicial);

  useEffect(() => {
    if (!state.ok) return;
    toast.success("Análise excluída", { description: codigo });
    onOpenChange(false);
    router.refresh();
  }, [state.ok, codigo, router, onOpenChange]);

  return (
    <Dialog open onOpenChange={(open) => !pending && onOpenChange(open)}>
      <DialogContent className="max-w-sm" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Excluir análise</DialogTitle>
          <DialogDescription>
            Excluir <b>{rotulo}</b> e sua receita? Só é possível quando a análise nunca foi usada em
            orçamentos ou planos; nesse caso, inative-a na ficha.
          </DialogDescription>
        </DialogHeader>
        {state.message && !state.ok && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">
            {state.message}
          </p>
        )}
        <form action={action} {...formularioSemPerda(state)}>
          <input type="hidden" name="codigo" value={codigo} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Excluindo…" : "Excluir"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Situação na ficha: ativa/inativa e ofertável em propostas. */
export function AnaliseSituacao({
  codigo,
  ativo,
  ofertavel,
  podeEditar,
}: {
  codigo: string;
  ativo: boolean;
  ofertavel: boolean;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(definirSituacaoAnalise, inicial);

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  if (!podeEditar) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={action} {...formularioSemPerda(state)}>
        <input type="hidden" name="codigo" value={codigo} />
        <input type="hidden" name="campo" value="ativo" />
        <input type="hidden" name="valor" value={String(!ativo)} />
        <Button type="submit" size="sm" variant={ativo ? "outline" : "default"} disabled={pending}>
          {ativo ? "Inativar" : "Reativar"}
        </Button>
      </form>
      <form action={action} {...formularioSemPerda(state)}>
        <input type="hidden" name="codigo" value={codigo} />
        <input type="hidden" name="campo" value="ofertavel" />
        <input type="hidden" name="valor" value={String(!ofertavel)} />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {ofertavel ? "Retirar da oferta" : "Ofertar em propostas"}
        </Button>
      </form>
      <HelpTip title="Ativa e ofertável">
        <p>
          <b>Ativa</b>: pode ser usada em planos e orçamentos. <b>Ofertável</b>: aparece também para o
          cliente nas propostas.
        </p>
        <p>Inativar também retira da oferta; o histórico é preservado.</p>
      </HelpTip>
      {state.message && !state.ok && (
        <p role="alert" className="basis-full rounded-md bg-danger-soft px-3 py-2 text-xs text-danger-strong">
          {state.message}
        </p>
      )}
    </div>
  );
}
