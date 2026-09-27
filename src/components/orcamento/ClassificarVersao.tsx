"use client";

import { useId } from "react";

import { ConfirmSubmitButton } from "@/components/common/ConfirmSubmitButton";
import { SubmitButton } from "@/components/common/SubmitButton";
import { FormEstado } from "@/components/orcamento/FormEstado";
import type { EstadoAcao } from "@/lib/erros";
import { ROTULO_CLASSIFICACAO, type ClassificacaoVersao } from "@/lib/orcamento/transicoes-versao";

/**
 * Classificação comercial da versão (ORC2-8): só as transições que o banco
 * aceita; aprovar pede confirmação porque cria o planejamento.
 */
export function ClassificarVersao({
  versaoId,
  numero,
  opcoes,
  action,
}: {
  versaoId: number;
  numero: string;
  opcoes: ClassificacaoVersao[];
  action: (estado: EstadoAcao, formData: FormData) => Promise<EstadoAcao>;
}) {
  const idStatus = useId();
  const idObs = useId();
  const idObsAprovar = useId();
  const outras = opcoes.filter((opcao) => opcao !== "aprovado");
  if (opcoes.length === 0) return null;

  return (
    <div className="mt-2 grid min-w-48 gap-2">
      {outras.length > 0 && (
        <FormEstado action={action} className="grid gap-1" mensagemClassName="text-xs">
          <input type="hidden" name="versao_id" value={versaoId} />
          <label htmlFor={idStatus} className="sr-only">Nova situação da proposta {numero}</label>
          <select id={idStatus} name="status" defaultValue={outras[0]} className="h-8 rounded-md border border-input bg-card px-2 text-xs">
            {outras.map((opcao) => (
              <option key={opcao} value={opcao}>{ROTULO_CLASSIFICACAO[opcao]}</option>
            ))}
          </select>
          <label htmlFor={idObs} className="sr-only">Observação</label>
          <input id={idObs} name="motivo" placeholder="Observação (opcional)" className="h-8 rounded-md border border-input bg-card px-2 text-xs" />
          <SubmitButton size="sm" variant="outline" pendingLabel="Registrando…">Registrar situação</SubmitButton>
        </FormEstado>
      )}
      {opcoes.includes("aprovado") && (
        <FormEstado action={action} className="grid gap-1" mensagemClassName="text-xs">
          <input type="hidden" name="versao_id" value={versaoId} />
          <input type="hidden" name="status" value="aprovado" />
          <label htmlFor={idObsAprovar} className="sr-only">Como o cliente aprovou</label>
          <input id={idObsAprovar} name="motivo" placeholder="Como o cliente aprovou (opcional)" className="h-8 rounded-md border border-input bg-card px-2 text-xs" />
          <ConfirmSubmitButton
            className="h-8 rounded-md bg-brand-600 px-2 text-xs font-medium text-white hover:bg-brand-500"
            titulo="Aprovar e criar planejamento?"
            mensagem={`A proposta ${numero} passa a aprovada e o planejamento dela é criado em rascunho. Outra versão desta proposta só poderá ser aprovada depois de cancelar esta.`}
            confirmLabel="Aprovar e criar planejamento"
          >
            Aprovar
          </ConfirmSubmitButton>
        </FormEstado>
      )}
    </div>
  );
}
