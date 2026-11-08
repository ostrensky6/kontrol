"use client";

import { useActionState, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";
import {
  registrarConsumoManual,
  type EstadoRegistroConsumoManual,
} from "@/lib/actions/consumo-manual";

type Preimagem = {
  insumoId: number;
  revisaoEsperada: number;
  operacaoId: string;
  conteudo: string;
  unidade: string;
};

async function registrar(anterior: EstadoRegistroConsumoManual, dados: FormData): Promise<EstadoRegistroConsumoManual> {
  try {
    return await registrarConsumoManual(anterior, dados);
  } catch (erro) {
    unstable_rethrow(erro);
    return { ok: false, codigo: "FALHA_ESCRITA", message: "O registro não foi confirmado." };
  }
}

export function RegistrarConsumoManualForm({ preimagem }: { preimagem: Preimagem }) {
  const [base] = useState(() => preimagem);
  const enviado = useRef(false);
  const [state, action, pending] = useActionState(registrar, { ok: false });
  const mudou = base.insumoId !== preimagem.insumoId || base.revisaoEsperada !== preimagem.revisaoEsperada ||
    base.conteudo !== preimagem.conteudo || base.unidade !== preimagem.unidade;
  const falhou = !state.ok && Boolean(state.message);
  const encerrado = state.ok || falhou || mudou;

  return (
    <form
      action={action}
      {...formularioSemPerda(state)}
      onSubmit={(event) => {
        if (encerrado || pending || enviado.current) event.preventDefault();
        else enviado.current = true;
      }}
      aria-busy={pending}
      className="mt-4 space-y-3 border-t border-border pt-4"
    >
      <h4 className="text-sm font-semibold">Registrar estimativa manual</h4>
      <input type="hidden" name="insumo_id" value={base.insumoId} />
      <input type="hidden" name="operacao_id" value={base.operacaoId} />
      <input type="hidden" name="revisao_esperada" value={base.revisaoEsperada} />
      <input type="hidden" name="conteudo_embalagem_esperado" value={base.conteudo} />
      <input type="hidden" name="unidade_conteudo_esperada" value={base.unidade} />
      <fieldset disabled={pending || encerrado} className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">Dados da estimativa manual</legend>
        <label className="block text-sm font-medium">
          Embalagens por mês
          <Input name="quantidade_embalagens_mes" inputMode="decimal" pattern="[0-9]+([.,][0-9]+)?" maxLength={128} required className="mt-1" />
        </label>
        <label className="block text-sm font-medium">
          Data de referência
          <Input name="data_referencia" type="date" required className="mt-1" />
        </label>
        <label className="block text-sm font-medium">
          De onde veio o número
          <Input name="fonte" maxLength={240} required className="mt-1" />
        </label>
        <label className="block text-sm font-medium">
          Motivo
          <Input name="motivo" maxLength={1000} required className="mt-1" />
        </label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input name="apresentacao_confirmada" type="checkbox" value="1" required className="mt-1 accent-primary" />
          Confirmo que cada embalagem tem {base.conteudo.replace(".", ",")} {base.unidade}.
        </label>
      </fieldset>
      {state.ok ? (
        <p role="status" className="text-sm text-success-strong">Estimativa registrada.</p>
      ) : falhou || mudou ? (
        <p role="alert" className="text-sm text-danger-strong">
          {state.message ?? "A estimativa ou a embalagem mudou enquanto você preenchia."} Recarregue a página e confira antes de tentar de novo.
        </p>
      ) : null}
      {encerrado ? (
        <Button type="button" variant="outline" onClick={() => window.location.reload()}>
          Recarregar a página
        </Button>
      ) : (
        <Button type="submit" disabled={pending}>{pending ? "Registrando…" : "Registrar estimativa"}</Button>
      )}
    </form>
  );
}
