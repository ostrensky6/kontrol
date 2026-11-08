"use client";

import { useActionState, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";
import {
  avaliarAvisoEquipamento,
  encaminharAvisoEquipamento,
  reconhecerAvisoEquipamento,
  type ResultadoAcaoAvisoEquipamento,
} from "@/lib/actions/equipamentos-avisos";

const ACOES = {
  avaliar: avaliarAvisoEquipamento,
  reconhecer: reconhecerAvisoEquipamento,
  encaminhar: encaminharAvisoEquipamento,
};
const ROTULOS = { avaliar: "Avaliar janela", reconhecer: "Reconhecer aviso", encaminhar: "Encaminhar aviso" };
const RESULTADOS = {
  nao_configurado: "Não há regra configurada.",
  referencia_alterada: "A referência mudou. Nenhum novo aviso foi confirmado.",
  indisponivel: "Não foi possível confirmar a próxima data de referência.",
  fora_janela: "A referência está fora da janela de aviso.",
  aberto: "Aviso pendente registrado.",
  ja_existente: "Já existe um aviso para essa referência.",
  reconhecido: "Reconhecimento registrado.",
  encaminhado: "Encaminhamento registrado na trilha.",
};
type Props = {
  operacao: keyof typeof ACOES;
  operacaoId: string;
  campos: Record<string, string>;
};

export function OperarAvisoEquipamentoForm({ operacao, operacaoId, campos }: Props) {
  const [base] = useState(() => ({ operacao, operacaoId, campos }));
  const enviado = useRef(false);
  const [state, action, pending] = useActionState(async (
    anterior: ResultadoAcaoAvisoEquipamento | null, dados: FormData,
  ): Promise<ResultadoAcaoAvisoEquipamento> => {
    try {
      return await ACOES[base.operacao](anterior, dados);
    } catch (erro) {
      unstable_rethrow(erro);
      return { ok: false, codigo: "INDISPONIVEL", message: "A operação não pôde ser confirmada. Consulte o estado atual antes de reenviar." };
    }
  }, null);
  const mudou = operacao !== base.operacao || JSON.stringify(campos) !== JSON.stringify(base.campos);
  const encerrado = state !== null || mudou;
  const resultado = state?.ok ? Object.entries(RESULTADOS).find(([estado]) => estado === state.recibo.estado)?.[1] : null;

  return (
    <details className="mt-2 rounded-md border border-border/70 px-3">
      <summary className="min-h-10 cursor-pointer py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {ROTULOS[base.operacao]}
      </summary>
      <form
        action={action}
        {...formularioSemPerda(state)}
        onSubmit={(event) => {
          if (encerrado || pending || enviado.current) event.preventDefault();
          else enviado.current = true;
        }}
        aria-busy={pending}
        className="space-y-3 border-t border-border/70 py-3"
      >
        <input type="hidden" name="p_operacao_id" value={base.operacaoId} />
        {Object.entries(base.campos).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <fieldset disabled={pending || encerrado} className="space-y-2">
          <legend className="sr-only">{ROTULOS[base.operacao]}</legend>
          {base.operacao !== "avaliar" && (
            <label className="block text-sm font-medium">Motivo<Input name="p_motivo" required className="mt-1" /></label>
          )}
          {base.operacao === "encaminhar" && (
            <label className="block text-sm font-medium">
              Destino a registrar na trilha
              <Input name="p_destino" required className="mt-1" />
            </label>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" required className="mt-1 accent-primary" />
            Confirmo esta operação. Ela não executa nem conclui a manutenção.
          </label>
        </fieldset>
        {state?.ok ? (
          <p role="status" className="text-sm text-foreground">{resultado ?? "Operação confirmada."}</p>
        ) : encerrado ? (
          <p role="alert" className="text-sm text-danger-strong">
            {state?.message ?? "A regra ou o estado do aviso mudou."} Recarregue e confira a trilha antes de outra tentativa.
          </p>
        ) : null}
        {encerrado ? (
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>Recarregar e conferir trilha</Button>
        ) : (
          <Button type="submit" disabled={pending}>{pending ? "Registrando…" : "Confirmar operação"}</Button>
        )}
      </form>
    </details>
  );
}
