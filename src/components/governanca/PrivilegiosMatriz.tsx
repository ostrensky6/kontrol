"use client";

import { useActionState, useMemo, useState } from "react";

import type { FormState } from "@/lib/actions/cadastros";
import { salvarPrivilegiosPapel } from "@/lib/actions/privilegios";
import {
  PERMISSOES,
  PAPEIS,
  type PapelUsuario,
  type PermissaoUsuario,
} from "@/lib/auth/permissions";
import type { PermissoesPorCategoria } from "@/lib/auth/permission-categories";
import { Button } from "@/components/ui/button";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

const initial: FormState = { ok: false, message: "" };

export function PrivilegiosMatriz({ permissoesPorCategoria }: { permissoesPorCategoria: PermissoesPorCategoria }) {
  const [papelEditando, setPapelEditando] = useState<PapelUsuario | null>(null);
  const [state, action] = useActionState(salvarPrivilegiosPapel, initial);
  const papel = PAPEIS.find((item) => item.value === papelEditando);
  const grupos = useMemo(() => {
    const modulos = new Map<string, typeof PERMISSOES>();
    for (const permissao of PERMISSOES) {
      modulos.set(permissao.modulo, [...(modulos.get(permissao.modulo) ?? []), permissao]);
    }
    return Array.from(modulos.entries());
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-semibold">Privilégios por papel</h2>
              <HelpTip title="Privilégios por papel">
                <p>
                  Padrão de cada papel. Um usuário pode ter <b>ajustes próprios</b> em Usuários e
                  permissões → Editar, que valem acima deste padrão.
                </p>
                <HelpExample>
                  Ligar &quot;Ver salário dos técnicos&quot; para Coordenador mostra o salário dos
                  técnicos a todos os coordenadores.
                </HelpExample>
              </HelpTip>
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-3 text-left">Privilégio</th>
                {PAPEIS.map((item) => (
                  <th key={item.value} className="px-3 py-3 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <span>{item.label}</span>
                      <Button type="button" variant="outline" size="sm" onClick={() => setPapelEditando(item.value)}>
                        Editar
                      </Button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            {grupos.map(([modulo, permissoes]) => (
              <tbody key={modulo} className="divide-y divide-border/70">
                <tr className="bg-muted/25">
                  <td colSpan={PAPEIS.length + 1} className="px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                    {modulo}
                  </td>
                </tr>
                {permissoes.map((permissao) => (
                  <tr key={permissao.key}>
                    <td className="px-3 py-3">
                      <p className="font-medium text-foreground">{permissao.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{permissao.descricao}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{permissao.key}</p>
                    </td>
                    {PAPEIS.map((item) => {
                      const permitido = permissoesPorCategoria[item.value][permissao.key];
                      return (
                        <td key={`${permissao.key}-${item.value}`} className="px-3 py-3 text-center">
                          <span
                            className={
                              permitido
                                ? "font-semibold text-brand-700 dark:text-brand-300"
                                : "text-muted-foreground/70"
                            }
                          >
                            {permitido ? "Sim" : "Não"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </section>

      <Dialog open={Boolean(papel)} onOpenChange={(open) => setPapelEditando(open ? papelEditando : null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Editar privilégios: {papel?.label}</DialogTitle>
            <DialogDescription>
              Muda o padrão do papel. Ajustes individuais de usuários continuam valendo.
            </DialogDescription>
          </DialogHeader>
          {papel && (
            <form action={action} {...formularioSemPerda(state)} className="space-y-4">
              <input type="hidden" name="papel" value={papel.value} />
              {/* sem isto, desmarcar tudo voltaria aos padrões do código */}
              <input type="hidden" name="permissoes_presentes" value="1" />
              <div className="max-h-[55dvh] overflow-y-auto pr-1">
                {grupos.map(([modulo, permissoes]) => (
                  <fieldset key={modulo} className="mb-4">
                    <legend className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{modulo}</legend>
                    <div className="grid gap-2 md:grid-cols-2">
                      {permissoes.map((permissao) => (
                        <label
                          key={permissao.key}
                          className="flex items-start gap-2 rounded-md border border-border p-2 text-xs"
                        >
                          <Checkbox
                            name="permissoes"
                            value={permissao.key}
                            defaultChecked={permissoesPorCategoria[papel.value][permissao.key as PermissaoUsuario]}
                            disabled={papel.value === "admin"}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block font-semibold text-foreground">{permissao.label}</span>
                            <span className="block leading-4 text-muted-foreground">{permissao.descricao}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
              <MensagemAcao estado={state} />
              <DialogFooter>
                <SubmitButton pendingLabel="Salvando…">Salvar privilégios</SubmitButton>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
