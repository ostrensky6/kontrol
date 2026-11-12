import { PERMISSOES, type PermissaoUsuario } from "@/lib/auth/permissions";

/**
 * Por que o cadastro está em "Somente consulta" e a quem pedir. Sem isso a
 * pessoa só via os campos travados e achava que era defeito (12/11/2026).
 */
export function motivoSomenteConsulta(slug: string, permissao: PermissaoUsuario): string {
  if (slug === "coordenacoes") {
    return "Somente consulta: só o Administrador define quem coordena e aprova cada laboratório ou área. Peça a ele para indicar a coordenação.";
  }
  if (slug === "responsaveis") {
    return "Somente consulta: só o Administrador define quem responde por cada etapa. Peça a ele.";
  }
  const rotulo = PERMISSOES.find((p) => p.key === permissao)?.label;
  return rotulo
    ? `Somente consulta: editar pede a permissão “${rotulo}”. Peça ao Administrador.`
    : "Somente consulta: editar pede uma permissão que você não tem. Peça ao Administrador.";
}
