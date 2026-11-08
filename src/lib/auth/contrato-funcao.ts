import type { PapelUsuario } from "./permissions";

// Hierarquia de nomeação, não um substituto da permissão efetiva do banco.
const NIVEL_NOMEACAO: Partial<Record<PapelUsuario, number>> = {
  gestor: 0, coordenador: 1, supervisor: 2, admin: 3,
};

export function avaliarTrocaDeFuncao(
  ator: string,
  alvo: string,
  papelAtor: PapelUsuario,
  atual: PapelUsuario,
  destino: PapelUsuario,
) {
  if (ator === alvo || atual === destino || atual === "admin") return false;
  const nivelAtual = NIVEL_NOMEACAO[atual];
  const nivelDestino = NIVEL_NOMEACAO[destino];
  if (papelAtor === "admin") {
    // Só Admin retira Supervisor; não inferir destino operacional como inferior.
    return atual !== "supervisor" ||
      (nivelDestino !== undefined && nivelAtual !== undefined && nivelDestino < nivelAtual);
  }
  if (papelAtor !== "supervisor" && papelAtor !== "coordenador") return false;
  const nivelAtor = NIVEL_NOMEACAO[papelAtor]!;
  return nivelAtual !== undefined && nivelDestino !== undefined &&
    nivelAtual < nivelAtor && nivelDestino < nivelAtor;
}
