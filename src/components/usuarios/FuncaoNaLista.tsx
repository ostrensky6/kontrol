"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { alterarFuncaoUsuario } from "@/lib/actions/usuarios";
import { PAPEIS, LABEL_PAPEL, isPapelUsuario } from "@/lib/auth/permissions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UsuarioRow } from "./UsuariosTable";

/**
 * Função direto na lista (0180): escolher outra abre a confirmação; ao
 * confirmar, a pessoa passa ao padrão da nova função. Removido não muda aqui
 * (reative antes).
 */
export function FuncaoNaLista({ row }: { row: UsuarioRow }) {
  const [nova, setNova] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nome = row.nome === "—" ? row.email : row.nome;

  if (row.removido) return <span className="text-muted-foreground">{row.papelLabel}</span>;

  function confirmar() {
    if (!nova) return;
    const fd = new FormData();
    if (row.preAprovadoId) fd.set("pre_aprovado_id", String(row.preAprovadoId));
    else fd.set("id", row.id);
    fd.set("papel", nova);
    startTransition(async () => {
      const res = await alterarFuncaoUsuario(fd);
      if (res.ok) {
        toast.success(res.message);
        setNova(null);
      } else {
        toast.error(res.message);
      }
    });
  }

  const novaLabel = nova && isPapelUsuario(nova) ? LABEL_PAPEL[nova] : nova;

  return (
    <>
      <Select
        aria-label={`Função de ${nome}`}
        value={row.papel}
        onChange={(event) => {
          if (event.target.value !== row.papel) setNova(event.target.value);
        }}
        className="h-11 min-w-36 md:h-8"
        disabled={pending}
      >
        {!isPapelUsuario(row.papel) && <option value={row.papel}>{row.papelLabel}</option>}
        {PAPEIS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
      <Dialog open={nova !== null} onOpenChange={(aberto) => !aberto && !pending && setNova(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Trocar a função</DialogTitle>
            <DialogDescription>
              {nome} passa de <b>{row.papelLabel}</b> para <b>{novaLabel}</b>. As permissões dele passam ao padrão
              de {novaLabel} (Governança → Privilégios); ajustes só dele ficam em Editar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setNova(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="button" onClick={confirmar} disabled={pending} aria-busy={pending}>
              {pending ? "Trocando…" : `Passar para ${novaLabel}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
