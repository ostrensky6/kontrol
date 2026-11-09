import type { PermissaoUsuario } from "@/lib/auth/permissions";

/**
 * Permissão "Acessar …" exigida por cada área (migration 0124: a caixinha
 * manda). Sem ela, a área some do menu e a rota responde "Sem acesso". O
 * prefixo mais longo vence (ex.: /orcamento/fundos antes de /orcamento).
 * Usuários, privilégios e backups continuam só do admin (minRole no menu).
 */
const ACESSO_POR_ROTA: Array<[prefixo: string, chave: PermissaoUsuario, area: string]> = [
  ["/cadastros", "cadastros.ver", "Cadastros"],
  ["/analises", "analises.ver", "Análises"],
  ["/insumos", "insumos.ver", "Insumos por análise"],
  ["/custeio", "custeio.ver", "Custeio"],
  ["/parametros", "configuracoes.ver", "Parâmetros de custeio"],
  ["/estoque", "estoque.ver", "Estoque"],
  ["/etiquetas", "estoque.ver", "Estoque"],
  ["/scanner", "estoque.ver", "Estoque"],
  ["/planejamento", "planejamento.ver", "Planejamento"],
  ["/pedido", "pedido.ver", "Pedidos internos"],
  ["/compras", "compras.ver", "Compras"],
  // a visão geral mostra o estoque (leitura aberta do estoque, decisão de 08/11);
  // prazos de compra continuam de quem vê compras
  ["/suprimentos", "estoque.ver", "Suprimentos"],
  ["/suprimentos/prazos", "compras.ver", "Prazos de compra"],
  ["/recebimento", "recebimento.ver", "Recebimento"],
  ["/orcamento/fundos", "orcamentos.fundos", "Fundos e taxas"],
  ["/orcamento/modelos", "orcamentos.modelos", "Modelos e catálogos"],
  ["/orcamento/governanca", "auditoria.visualizar", "Governança de orçamentos"],
  ["/orcamento", "orcamentos.visualizar", "Orçamentos"],
  ["/projetos", "projetos.ver", "Projetos"],
  ["/auditoria", "auditoria.visualizar", "Auditoria"],
];

export function acessoDaRota(path: string) {
  let melhor: { chave: PermissaoUsuario; area: string; tamanho: number } | null = null;
  for (const [prefixo, chave, area] of ACESSO_POR_ROTA) {
    const casa = path === prefixo || path.startsWith(prefixo + "/");
    if (casa && (!melhor || prefixo.length > melhor.tamanho)) {
      melhor = { chave, area, tamanho: prefixo.length };
    }
  }
  return melhor ? { chave: melhor.chave, area: melhor.area } : null;
}
