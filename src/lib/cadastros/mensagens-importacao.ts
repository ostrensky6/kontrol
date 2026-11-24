/**
 * Junta as mensagens da importação que só mudam pelo número da linha.
 * Uma planilha com a mesma coluna errada em 90 linhas vira uma mensagem só,
 * com as linhas listadas, em vez de 90 mensagens cortadas em "… e mais".
 *
 * Formatos aceitos (com prefixo opcional, ex.: "Insumos · "):
 * - "Linha 12, Categoria de compra: valor inválido …"
 * - "Linha 12: sem Quantidade na embalagem; considerado 1."
 */
const PADRAO = /^([^]*?)Linha (\d+)(?:, |: )([^]*)$/;

/** Quantos números de linha aparecem antes do "e mais N". */
export const LINHAS_POR_MENSAGEM = 12;

export type MensagemAgrupada = { texto: string; linhas: number[] };

export function agruparMensagensPorLinha(mensagens: string[]): MensagemAgrupada[] {
  const grupos = new Map<string, { prefixo: string; resto: string; linhas: number[]; original: string }>();
  const ordem: string[] = [];
  for (const mensagem of mensagens) {
    const achado = PADRAO.exec(mensagem);
    const chave = achado ? `${achado[1]}\u0000${achado[3]}` : `\u0001${mensagem}`;
    let grupo = grupos.get(chave);
    if (!grupo) {
      grupo = achado
        ? { prefixo: achado[1], resto: achado[3], linhas: [], original: mensagem }
        : { prefixo: "", resto: mensagem, linhas: [], original: mensagem };
      grupos.set(chave, grupo);
      ordem.push(chave);
    }
    if (achado) grupo.linhas.push(Number(achado[2]));
  }
  return ordem.map((chave) => {
    const grupo = grupos.get(chave)!;
    if (grupo.linhas.length <= 1) return { texto: grupo.original, linhas: grupo.linhas };
    const linhas = [...new Set(grupo.linhas)].sort((a, b) => a - b);
    const mostradas = linhas.slice(0, LINHAS_POR_MENSAGEM).join(", ");
    const resto = linhas.length > LINHAS_POR_MENSAGEM ? ` e mais ${linhas.length - LINHAS_POR_MENSAGEM}` : "";
    return {
      texto: `${grupo.prefixo}${linhas.length} linhas (${mostradas}${resto}), ${grupo.resto}`,
      linhas,
    };
  });
}
