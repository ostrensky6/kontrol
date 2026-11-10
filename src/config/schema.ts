/**
 * Última migration que esta versão do app espera encontrar no banco.
 * O teste schema.test.ts falha se um PR traz migration nova sem atualizar
 * este número, então a publicação sempre diz com qual banco foi feita.
 */
export const MIGRATION_ESPERADA = "0178";
