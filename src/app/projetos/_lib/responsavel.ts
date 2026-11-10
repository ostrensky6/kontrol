/**
 * Quem responde pelo projeto.
 *
 * O projeto tem duas informações parecidas, e só uma vale para aprovar pedidos:
 * - `coordenador_id`: o usuário que coordena o projeto. É ele que aprova os
 *   pedidos (0136/0169). Esta é a informação que as telas mostram.
 * - `responsavel` (e os antigos `coordenador_nome`/`coordenador`): nome
 *   escrito à mão, só informativo. Não aprova nada.
 */
type ProjetoResponsavel = {
  responsavel?: string | null;
  coordenador_nome?: string | null;
  coordenador?: string | null;
};

/** Nome escrito à mão no cadastro (informativo). */
export function responsavelDoProjeto(projeto: ProjetoResponsavel): string | null {
  for (const valor of [projeto.responsavel, projeto.coordenador_nome, projeto.coordenador]) {
    const texto = valor?.trim();
    if (texto) return texto;
  }
  return null;
}

export type UsuarioCoordenador = { id: string; nome: string | null; email?: string | null; suspenso?: boolean | null };

export type CoordenadorDoProjeto =
  | { situacao: "ok"; nome: string }
  /** há usuário indicado, mas ele está suspenso: o pedido trava */
  | { situacao: "suspenso"; nome: string }
  /** ninguém indicado; `escrito` é o nome à mão, se houver */
  | { situacao: "falta"; escrito: string | null };

/** Coordenador que aprova os pedidos do projeto, pela mesma regra do banco (usuário ativo). */
export function coordenadorDoProjeto(
  projeto: ProjetoResponsavel & { coordenador_id?: string | null },
  usuarios: readonly UsuarioCoordenador[],
): CoordenadorDoProjeto {
  const usuario = projeto.coordenador_id ? usuarios.find((u) => u.id === projeto.coordenador_id) : null;
  if (!usuario) return { situacao: "falta", escrito: responsavelDoProjeto(projeto) };
  const nome = usuario.nome?.trim() || usuario.email || "usuário sem nome";
  return usuario.suspenso ? { situacao: "suspenso", nome } : { situacao: "ok", nome };
}

/** Texto curto para listas: o nome, ou o aviso de que falta coordenador. */
export function rotuloCoordenador(coordenador: CoordenadorDoProjeto): string {
  if (coordenador.situacao === "ok") return coordenador.nome;
  if (coordenador.situacao === "suspenso") return `${coordenador.nome} (usuário suspenso)`;
  return coordenador.escrito ? `Sem coordenador (escrito: ${coordenador.escrito})` : "Sem coordenador";
}
