import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import { formularioSemPerda } from "./formulario-sem-perda";

/** Simula o `reset` do form: o React grava o atributo antes de disparar a limpeza. */
function dispararReset(props: ReturnType<typeof formularioSemPerda>) {
  const preventDefault = vi.fn();
  const evento = {
    currentTarget: { dataset: { erroAcao: props["data-erro-acao"] } },
    preventDefault,
  } as unknown as FormEvent<HTMLFormElement>;
  props.onReset(evento);
  return preventDefault;
}

describe("formularioSemPerda", () => {
  it("marca erro e cancela a limpeza quando a action devolve erro com mensagem", () => {
    const props = formularioSemPerda({ ok: false, message: "Verifique os campos destacados." });
    expect(props["data-erro-acao"]).toBe("1");
    expect(dispararReset(props)).toHaveBeenCalledTimes(1);
  });

  it("deixa limpar normalmente após sucesso", () => {
    const props = formularioSemPerda({ ok: true, message: "Salvo." });
    expect(props["data-erro-acao"]).toBe("0");
    expect(dispararReset(props)).not.toHaveBeenCalled();
  });

  it.each([
    ["estado inicial sem mensagem", { ok: false }],
    ["mensagem vazia", { ok: false, message: "" }],
    ["mensagem nula", { ok: false, message: null }],
    ["estado nulo", null],
    ["estado indefinido", undefined],
  ])("não cancela a limpeza com %s", (_rotulo, estado) => {
    const props = formularioSemPerda(estado);
    expect(props["data-erro-acao"]).toBe("0");
    expect(dispararReset(props)).not.toHaveBeenCalled();
  });
});
