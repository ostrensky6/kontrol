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

/** Nome para comparar: sem acento, sem diferença de maiúscula e de espaços. */
export function normalizarNomePessoa(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Pessoa pré-aprovada que ainda não entrou: não tem conta, então não pode ser escolhida direto. */
export type PreAprovadoOpcao = { id: number; nome: string; email: string };

/** Valor das opções de pré-aprovados no campo de usuário; nunca é salvo. */
export const PREFIXO_PRE_APROVADO = "pre:";

export function valorPreAprovado(pre: Pick<PreAprovadoOpcao, "id">): string {
  return `${PREFIXO_PRE_APROVADO}${pre.id}`;
}

/** Pré-aprovado escolhido no campo de usuário (valor "pre:<id>"), ou null. */
export function preAprovadoDoValor(valor: string, lista: readonly PreAprovadoOpcao[]): PreAprovadoOpcao | null {
  if (!valor.startsWith(PREFIXO_PRE_APROVADO)) return null;
  const id = Number(valor.slice(PREFIXO_PRE_APROVADO.length));
  return lista.find((pre) => pre.id === id) ?? null;
}

/**
 * Pré-aprovados que ainda não têm conta: quem já tem perfil com o mesmo
 * e-mail fica de fora (a tela de Usuários faz a mesma conta).
 */
export function preAprovadosSemConta(
  pre: readonly { id: number; nome: string | null; email: string | null }[],
  emailsComConta: Iterable<string | null | undefined>,
): PreAprovadoOpcao[] {
  const comConta = new Set([...emailsComConta].map((email) => String(email ?? "").trim().toLowerCase()).filter(Boolean));
  return pre
    .map((p) => ({ id: Number(p.id), nome: String(p.nome ?? "").trim(), email: String(p.email ?? "").trim().toLowerCase() }))
    .filter((p) => p.email && !comConta.has(p.email))
    .map((p) => ({ ...p, nome: p.nome || p.email }));
}

export type SugestaoPessoa =
  /** o nome escrito já é de um usuário ativo: basta indicá-lo */
  | { tipo: "existente"; nome: string; id: string }
  /** o nome é de alguém pré-aprovado que ainda não entrou: criar a conta e indicar */
  | { tipo: "pre_aprovado"; nome: string; email: string }
  /** ninguém com esse nome: cadastrar a pessoa já com o nome preenchido */
  | { tipo: "nova"; nome: string };

/**
 * Projeto com um nome escrito à mão (Responsável técnico) e sem usuário
 * indicado no campo: sugere indicar quem tem esse nome, criar a conta de quem
 * está pré-aprovado com ele ou cadastrá-lo. Só o nome igual conta (sem acento
 * e maiúsculas); nome parecido não é a mesma pessoa.
 */
export function sugestaoDePessoa(
  campo: Pick<Campo, "opcoesDe" | "nomeSugeridoDe" | "opcoes">,
  registro: Record<string, unknown> | null | undefined,
  valorAtual: string,
  preAprovados: readonly PreAprovadoOpcao[] = [],
): SugestaoPessoa | null {
  if (campo.opcoesDe !== "perfis" || !campo.nomeSugeridoDe || valorAtual) return null;
  const escrito = registro?.[campo.nomeSugeridoDe];
  const nome = typeof escrito === "string" ? escrito.replace(/\s+/g, " ").trim() : "";
  if (!nome) return null;
  const alvo = normalizarNomePessoa(nome);
  const usuario = (campo.opcoes ?? []).find((opcao) => !opcao.inativo && normalizarNomePessoa(opcao.label) === alvo);
  if (usuario) return { tipo: "existente", nome: usuario.label, id: usuario.value };
  const pre = preAprovados.find((p) => normalizarNomePessoa(p.nome) === alvo);
  if (pre) return { tipo: "pre_aprovado", nome: pre.nome, email: pre.email };
  return { tipo: "nova", nome };
}
