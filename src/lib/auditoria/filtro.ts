import { fimDoDiaIso, inicioDoDiaIso } from "@/lib/formatters";

/** Registros por página na trilha de auditoria. */
export const LIMITE_AUDITORIA = 200;

export type FiltroAuditoria = {
  /** tabela do registro; "" = todas */
  tabela: string;
  /** primeiro dia (aaaa-mm-dd, dia de Brasília); "" = sem limite */
  de: string;
  /** último dia, inclusive; "" = sem limite */
  ate: string;
  /** só registros com id menor que este: é como a tela anda para os mais antigos */
  antes: number | null;
};

type Parametros = Record<string, string | string[] | undefined>;

function um(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? "";
}

/**
 * Lê o filtro da URL. Tabela desconhecida, dia que não existe e cursor que não
 * é número são ignorados; período invertido (de depois de até) é desvirado.
 */
export function lerFiltroAuditoria(parametros: Parametros, tabelas: readonly string[]): FiltroAuditoria {
  const tabela = um(parametros.tabela);
  let de = inicioDoDiaIso(um(parametros.de)) ? um(parametros.de) : "";
  let ate = inicioDoDiaIso(um(parametros.ate)) ? um(parametros.ate) : "";
  if (de && ate && de > ate) [de, ate] = [ate, de];
  const antes = Number(um(parametros.antes));
  return {
    tabela: tabela && tabelas.includes(tabela) ? tabela : "",
    de,
    ate,
    antes: Number.isSafeInteger(antes) && antes > 0 ? antes : null,
  };
}

/** Limites do período em data e hora (UTC): `desde` inclusive, `antesDe` exclusivo. */
export function periodoAuditoria(filtro: Pick<FiltroAuditoria, "de" | "ate">): {
  desde: string | null;
  antesDe: string | null;
} {
  return {
    desde: filtro.de ? inicioDoDiaIso(filtro.de) : null,
    antesDe: filtro.ate ? fimDoDiaIso(filtro.ate) : null,
  };
}

/** Endereço da trilha com o filtro dado (sem os parâmetros vazios). */
export function hrefAuditoria(filtro: Partial<FiltroAuditoria>): string {
  const query = new URLSearchParams();
  if (filtro.tabela) query.set("tabela", filtro.tabela);
  if (filtro.de) query.set("de", filtro.de);
  if (filtro.ate) query.set("ate", filtro.ate);
  if (filtro.antes) query.set("antes", String(filtro.antes));
  const texto = query.toString();
  return texto ? `/auditoria?${texto}` : "/auditoria";
}
