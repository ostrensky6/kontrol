import type { Campo } from "@/lib/cadastros/config";
import { PAPEIS, type PapelUsuario } from "@/lib/auth/permissions";

export type OpcaoPessoa = { value: string; label: string; inativo?: boolean };

/** Função que o formulário sugere para a pessoa nova de um campo de usuário. */
export function papelDaNovaPessoa(campo: Pick<Campo, "novaPessoaPapel">): PapelUsuario {
  const papel = campo.novaPessoaPapel ?? "coordenador";
  return PAPEIS.some((item) => item.value === papel) ? papel : "coordenador";
}

/**
 * Põe as pessoas cadastradas agora no formulário em todos os campos de usuário
 * (quem entra como coordenador também pode ser o substituto). A lista que vem
 * do servidor continua valendo: depois de salvar, a pessoa já está nela e não
 * aparece duas vezes.
 */
export function comPessoasNovas(campos: Campo[], novas: readonly OpcaoPessoa[]): Campo[] {
  if (novas.length === 0) return campos;
  return campos.map((campo) => {
    if (campo.opcoesDe !== "perfis") return campo;
    const existentes = new Set((campo.opcoes ?? []).map((opcao) => opcao.value));
    const faltam = novas.filter((nova) => !existentes.has(nova.value));
    return faltam.length === 0 ? campo : { ...campo, opcoes: [...(campo.opcoes ?? []), ...faltam] };
  });
}
