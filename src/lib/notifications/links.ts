import { PAPEIS, PERMISSOES } from "@/lib/auth/permissions";

/** Caminho da tela ligada a um aviso (sem domínio). */
export function caminhoNotificacao(entidadeTipo: string | null, entidadeId: number | null): string | null {
  if (!entidadeTipo) return null;
  const id = entidadeId ?? null;
  switch (entidadeTipo) {
    case "planejamento":
      return id ? `/planejamento/${id}` : "/planejamento";
    case "pedido_compra":
      return id ? `/compras/${id}` : "/compras";
    case "pedido_interno":
      return id ? `/pedido/${id}` : "/pedido";
    case "lote":
      return id ? `/estoque/lotes/${id}` : "/estoque";
    case "demanda":
      return id ? `/orcamento/demandas/${id}` : "/orcamento/demandas";
    case "orcamento":
      return id ? `/orcamento/${id}` : "/orcamento";
    case "insumo":
      return "/cadastros/insumos";
    default:
      return null;
  }
}

/** Texto curto de "para quem" é o aviso. */
export function destinoNotificacao(item: {
  usuario_destino?: string | null;
  permissao_destino?: string | null;
  papel_destino?: string | null;
}): string {
  if (item.usuario_destino) return "você";
  if (item.permissao_destino) {
    const rotulo = PERMISSOES.find((p) => p.key === item.permissao_destino)?.label;
    return rotulo ? `quem pode “${rotulo}”` : "quem tem a permissão correspondente";
  }
  if (item.papel_destino) {
    const rotulo = PAPEIS.find((p) => p.value === item.papel_destino)?.label;
    return rotulo ? `${rotulo.toLowerCase()} ou acima` : item.papel_destino;
  }
  return "toda a equipe";
}

const TIPOS: Record<string, string> = {
  reposicao: "Reposição",
  vencimento: "Vencimento",
  falta_plano: "Falta no plano",
  aprovacao_pendente: "Aguardando ação",
  sistema: "Aviso",
};

export function rotuloTipoNotificacao(tipo: string): string {
  return TIPOS[tipo] ?? tipo.replaceAll("_", " ");
}
