import { PAPEIS, PERMISSOES, normalizePermissions, type PapelUsuario, type PermissaoUsuario } from "@/lib/auth/permissions";

export type PermissoesPorCategoria = Record<PapelUsuario, Record<PermissaoUsuario, boolean>>;

export function buildPermissoesPorCategoria(rows: Array<{ papel: string; permissoes: unknown }>): PermissoesPorCategoria {
  return Object.fromEntries(
    PAPEIS.map((papel) => {
      const row = rows.find((item) => item.papel === papel.value);
      return [papel.value, normalizePermissions(papel.value, row?.permissoes)];
    }),
  ) as PermissoesPorCategoria;
}

/** Privilégios agrupados por módulo, na ordem do catálogo (Cadastros, Análises e custeio…). */
export function gruposDePermissoes(): Array<[modulo: string, permissoes: typeof PERMISSOES]> {
  const modulos = new Map<string, typeof PERMISSOES>();
  for (const permissao of PERMISSOES) {
    modulos.set(permissao.modulo, [...(modulos.get(permissao.modulo) ?? []), permissao]);
  }
  return Array.from(modulos.entries());
}
