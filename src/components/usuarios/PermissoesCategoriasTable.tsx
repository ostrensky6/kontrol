"use client";

import { useActionState, useState } from "react";

import { salvarPermissoesCategoria } from "@/lib/actions/usuarios";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PERMISSOES, PAPEIS, type PapelUsuario, type PermissaoUsuario } from "@/lib/auth/permissions";
import type { FormState } from "@/lib/actions/cadastros";
import { HelpTip } from "@/components/common/HelpTip";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

const initial: FormState = { ok: false, message: "" };

type PermissoesPorCategoria = Record<PapelUsuario, Record<PermissaoUsuario, boolean>>;

export function PermissoesCategoriasTable({ permissoesPorCategoria }: { permissoesPorCategoria: PermissoesPorCategoria }) {
  const [categoriaEditando, setCategoriaEditando] = useState<PapelUsuario | null>(null);
  const categoria = PAPEIS.find((papel) => papel.value === categoriaEditando);
  const [state, action] = useActionState(salvarPermissoesCategoria, initial);

  return (
    <section className="mt-8 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1">
            <h2 className="text-sm font-semibold">Tabela de permissões por categoria</h2>
            <HelpTip title="Permissões por categoria">
              <p>
                Padrão aplicado a quem está em cada categoria. Para uma pessoa específica, use{" "}
                <b>Editar</b> na linha dela: o ajuste individual vale acima do padrão.
              </p>
            </HelpTip>
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-3 text-left">Permissão</th>
              {PAPEIS.map((papel) => (
                <th key={papel.value} className="px-3 py-3 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <span>{papel.label}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => setCategoriaEditando(papel.value)}>
                      Editar
                    </Button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {PERMISSOES.map((permissao) => (
              <tr key={permissao.key}>
                <td className="px-3 py-3">
                  <p className="font-medium text-foreground">{permissao.modulo} · {permissao.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{permissao.descricao}</p>
                </td>
                {PAPEIS.map((papel) => {
                  const permitido = permissoesPorCategoria[papel.value][permissao.key];
                  return (
                    <td key={`${permissao.key}-${papel.value}`} className="px-3 py-3 text-center">
                      <span className={permitido ? "font-semibold text-brand-700 dark:text-brand-300" : "text-muted-foreground/70"}>
                        {permitido ? "Sim" : "Não"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={Boolean(categoria)} onOpenChange={(open) => setCategoriaEditando(open ? categoriaEditando : null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar permissões: {categoria?.label}</DialogTitle>
            <DialogDescription>
              Essas permissões serão usadas como padrão para novos usuários desta categoria.
            </DialogDescription>
          </DialogHeader>
          {categoria && (
            <form action={action} {...formularioSemPerda(state)} className="space-y-4">
              <input type="hidden" name="papel" value={categoria.value} />
              <input type="hidden" name="permissoes_presentes" value="1" />
              <div className="grid gap-2 md:grid-cols-2">
                {PERMISSOES.map((permissao) => (
                  <label key={permissao.key} className="flex items-start gap-2 rounded-md border border-border p-2 text-xs">
                    <Checkbox
                      name="permissoes"
                      value={permissao.key}
                      defaultChecked={permissoesPorCategoria[categoria.value][permissao.key]}
                      disabled={categoria.value === "admin"}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block font-semibold text-foreground">{permissao.modulo} · {permissao.label}</span>
                      <span className="block leading-4 text-muted-foreground">{permissao.descricao}</span>
                    </span>
                  </label>
                ))}
              </div>
              <MensagemAcao estado={state} />
              <DialogFooter>
                <SubmitButton pendingLabel="Salvando…">Salvar permissões</SubmitButton>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

export type { PermissoesPorCategoria };
