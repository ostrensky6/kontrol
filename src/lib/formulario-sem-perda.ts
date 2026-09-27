import { startTransition, type FormEvent } from "react";

type EstadoComOk = { ok: boolean; message?: string | null } | null | undefined;

/**
 * No React 19, `<form action={...}>` limpa os campos não controlados ao fim de
 * todo envio, inclusive quando a action devolve erro: o usuário perdia tudo o
 * que tinha digitado ao receber "Verifique os campos destacados".
 *
 * Espalhe o retorno no `<form>`: o atributo marca a última resposta como erro
 * (o React grava os atributos antes de limpar o formulário) e o `onReset`
 * cancela a limpeza nesse caso. Em caso de sucesso a limpeza continua normal.
 */
export function formularioSemPerda(estado: EstadoComOk) {
  return {
    "data-erro-acao": estado && !estado.ok && estado.message ? "1" : "0",
    onReset: (evento: FormEvent<HTMLFormElement>) => {
      if (evento.currentTarget.dataset.erroAcao === "1") evento.preventDefault();
    },
  };
}

/**
 * `onSubmit` que entrega o FormData sem o reset automático que o React aplica
 * a `<form action>`: em caso de erro, o que o usuário digitou continua no
 * formulário. Serve tanto para o `dispatch` de `useActionState` quanto para
 * handlers com `useTransition`. A validação nativa roda antes do submit.
 */
export function enviarSemReset(enviar: (dados: FormData) => void) {
  return (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    startTransition(() => enviar(dados));
  };
}
