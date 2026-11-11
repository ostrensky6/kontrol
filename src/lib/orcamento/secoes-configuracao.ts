/**
 * Telas de configuração dos orçamentos (revisão de 11/11, L5): antes só a
 * busca alcançava as três. Ficam nas abas de "Configurações", na barra de
 * Orçamentos.
 */
export const SECOES_CONFIGURACAO_ORCAMENTO = [
  { href: "/orcamento/parametros", label: "Parâmetros econômicos", desc: "impostos, índices e premissas financeiras" },
  { href: "/orcamento/documento-proposta", label: "Documento da proposta", desc: "empresas emissoras e textos padrão" },
  { href: "/orcamento/modelos", label: "Modelos e catálogo", desc: "modelos de orçamento e catálogo de custos" },
] as const;

export function rotaDeConfiguracaoDoOrcamento(pathname: string) {
  return SECOES_CONFIGURACAO_ORCAMENTO.some(
    (secao) => pathname === secao.href || pathname.startsWith(secao.href + "/"),
  );
}
