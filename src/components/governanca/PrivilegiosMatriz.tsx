"use client";

import { useActionState, useState } from "react";

import type { FormState } from "@/lib/actions/cadastros";
import { salvarMatrizPrivilegios } from "@/lib/actions/privilegios";
import { PAPEIS } from "@/lib/auth/permissions";
import { gruposDePermissoes, type PermissoesPorCategoria } from "@/lib/auth/permission-categories";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { enviarSemReset } from "@/lib/formulario-sem-perda";
import { cn } from "@/lib/utils";
import { faixaDoModulo } from "./faixas";

const initial: FormState = { ok: false, message: "" };
const GRUPOS = gruposDePermissoes();


/**
 * Matriz de privilégios editável: uma caixinha por função e privilégio
 * (marcada = pode, vazia = não pode). O administrador sempre tem tudo.
 */
export function PrivilegiosMatriz({ permissoesPorCategoria }: { permissoesPorCategoria: PermissoesPorCategoria }) {
  const [state, action, salvando] = useActionState(salvarMatrizPrivilegios, initial);
  const [alterado, setAlterado] = useState(false);
  const botaoSalvar = (
    <Button type="submit" disabled={salvando} aria-busy={salvando || undefined}>
      {salvando ? "Salvando…" : "Salvar alterações"}
    </Button>
  );

  return (
    <form
      onSubmit={enviarSemReset((dados) => {
        action(dados);
        setAlterado(false);
      })}
      onChange={() => setAlterado(true)}
      className="rounded-lg border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold">Privilégios por função</h2>
          <HelpTip title="Privilégios por função">
            <p>
              Marque a caixinha para liberar e desmarque para tirar. Vale para todos da função; um usuário
              pode ter <b>ajustes próprios</b> em Usuários → Editar, que valem acima deste padrão.
            </p>
            <HelpExample>
              Marcar &quot;Ver salário dos técnicos&quot; na coluna Coordenador mostra o salário dos
              técnicos a todos os coordenadores.
            </HelpExample>
          </HelpTip>
        </div>
        <div className="flex items-center gap-3">
          {alterado && <span className="text-xs font-medium text-warning-strong">Alterações não salvas</span>}
          {botaoSalvar}
        </div>
      </div>

      <p id="privilegios-admin-nota" className="mt-2 text-xs text-muted-foreground">
        A coluna Administrador fica travada: o administrador sempre tem todos os privilégios.
      </p>

      {/* sem isto, desmarcar tudo de uma função voltaria aos padrões do código */}
      <input type="hidden" name="permissoes_presentes" value="1" />

      <div className="mt-4 max-h-[70dvh] overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-xs uppercase tracking-wide text-muted-foreground shadow-sm">
            <tr>
              <th scope="col" className="px-3 py-3 text-left">
                Privilégio
              </th>
              {PAPEIS.map((papel) => (
                <th key={papel.value} scope="col" className="w-28 px-2 py-3 text-center">
                  {papel.label}
                </th>
              ))}
            </tr>
          </thead>
          {GRUPOS.map(([modulo, permissoes], indice) => (
            <tbody
              key={modulo}
              data-modulo={modulo}
              className={cn("border-t-2 border-border", faixaDoModulo(indice))}
            >
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={PAPEIS.length + 1}
                  className="px-3 pb-1 pt-3 text-left text-xs font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300"
                >
                  {modulo}
                </th>
              </tr>
              {permissoes.map((permissao) => (
                <tr key={permissao.key} className="border-t border-border/50">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <p className="font-medium text-foreground">{permissao.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{permissao.descricao}</p>
                  </th>
                  {PAPEIS.map((papel) => {
                    const admin = papel.value === "admin";
                    return (
                      <td key={`${permissao.key}-${papel.value}`} className="px-2 py-2 text-center">
                        <Checkbox
                          name={`permissoes:${papel.value}`}
                          value={permissao.key}
                          defaultChecked={admin || permissoesPorCategoria[papel.value][permissao.key]}
                          disabled={admin}
                          aria-label={`${papel.label}: ${permissao.label}`}
                          title={admin ? "O administrador sempre tem tudo." : undefined}
                          aria-describedby={admin ? "privilegios-admin-nota" : undefined}
                          className="h-5 w-5 cursor-pointer accent-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <MensagemAcao estado={state} />
        <div className="ml-auto">{botaoSalvar}</div>
      </div>
    </form>
  );
}
