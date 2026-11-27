/**
 * Documento que acompanha o pedido para quem paga (Antonio, 27/11/2026): a
 * fonte de pagamento escolhida pelo financeiro diz o modelo. Ineo (projeto
 * Piraupiá) recebe a Solicitação de Compras; Funpar (projetos Petrobras), o
 * Termo de Referência. ATGC e CNPq, por enquanto, sem documento.
 *
 * Os textos de cada insumo vêm da "Planilha Auxiliar Original -
 * SolicitaçãoCompras" (0187): colunas B a F na Solicitação de Compras e G a I
 * no Termo de Referência. Aqui só se monta o conteúdo; as páginas desenham.
 */

export type ModeloDocumento = "solicitacao_compras" | "termo_referencia";

export const MODELOS_DOCUMENTO: Record<ModeloDocumento, { titulo: string; fonte: string }> = {
  solicitacao_compras: { titulo: "Solicitação de Compras", fonte: "Ineo" },
  termo_referencia: { titulo: "Termo de Referência", fonte: "Funpar" },
};

export function modeloDocumento(valor: string | null | undefined): ModeloDocumento | null {
  return valor === "solicitacao_compras" || valor === "termo_referencia" ? valor : null;
}

/** As oito rubricas do formulário de Solicitação de Compras, na ordem do papel. */
export const RUBRICAS_SOLICITACAO = [
  "Móveis e equipamentos",
  "Recursos humanos",
  "Bolsas",
  "Material de Consumo",
  "Diárias nacionais",
  "Passagem nacional/Locomoção nacional",
  "Serviços de terceiros",
  "Despesas Gerais",
] as const;

const RUBRICA_DA_NATUREZA: Record<string, (typeof RUBRICAS_SOLICITACAO)[number]> = {
  equipamento: "Móveis e equipamentos",
  material_consumo_lab: "Material de Consumo",
  material_consumo_geral: "Material de Consumo",
  combustivel: "Material de Consumo",
  diaria: "Diárias nacionais",
  passagem: "Passagem nacional/Locomoção nacional",
  servico: "Serviços de terceiros",
  manutencao: "Serviços de terceiros",
  locacao: "Serviços de terceiros",
  seguro: "Serviços de terceiros",
  outro: "Despesas Gerais",
};

const RUBRICA_DO_TIPO_DE_ITEM: Record<string, (typeof RUBRICAS_SOLICITACAO)[number]> = {
  equipamento: "Móveis e equipamentos",
  servico: "Serviços de terceiros",
  material: "Material de Consumo",
};

/** Rubricas marcadas com "x": a natureza do pedido e o tipo de cada item. */
export function rubricasMarcadas(
  natureza: string | null | undefined,
  itens: ReadonlyArray<{ tipo?: string | null }>,
): Set<string> {
  const marcadas = new Set<string>();
  const daNatureza = natureza ? RUBRICA_DA_NATUREZA[natureza] : undefined;
  if (daNatureza) marcadas.add(daNatureza);
  for (const item of itens) {
    const doTipo = RUBRICA_DO_TIPO_DE_ITEM[item.tipo ?? "material"];
    // material de natureza "serviço" (ou o contrário) também marca a rubrica do item
    if (doTipo && !(doTipo === "Material de Consumo" && daNatureza && daNatureza !== "Material de Consumo")) marcadas.add(doTipo);
  }
  return marcadas;
}

export type InsumoDoDocumento = {
  especificacao?: string | null;
  descricao_detalhada?: string | null;
  fabricante?: string | null;
  codigo_fabricante?: string | null;
  justificativa_tr?: string | null;
  especificacoes_tr?: string | null;
  criterio_aceitabilidade?: string | null;
  unidade?: string | null;
};

export type ItemDoDocumento = {
  id: number;
  tipo?: string | null;
  especificacao: string;
  quantidade: number;
  unidade?: string | null;
  volume?: string | null;
  modelo?: string | null;
  orcamento_previo?: number | null;
  insumos?: InsumoDoDocumento | null;
};

export type OrcamentoDoDocumento = {
  fornecedor_nome: string;
  valor_total: number;
  escolhida: boolean;
  prazo_entrega_dias?: number | null;
};

export type LinhaDocumento = {
  numero: number;
  especificacao: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number | null;
  valorTotal: number | null;
};

function texto(valor: string | null | undefined): string {
  return String(valor ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Especificação do material: "Itens" e "Descrição detalhada do produto" da
 * planilha, com a marca de referência. Sugestão de fornecedores e observações
 * internas ficam de fora: servem para pedir orçamento, não para quem paga.
 */
export function especificacaoDoItem(item: ItemDoDocumento): string {
  const nome = texto(item.insumos?.especificacao) || texto(item.especificacao);
  const detalhe = texto(item.insumos?.descricao_detalhada);
  const medida = [texto(item.volume), texto(item.modelo)].filter(Boolean).join(", ");
  const marca = [texto(item.insumos?.fabricante), texto(item.insumos?.codigo_fabricante)].filter(Boolean).join(" ");
  let especificacao = detalhe ? (detalhe.toLowerCase().includes(nome.toLowerCase()) ? detalhe : `${nome} — ${detalhe}`) : nome;
  if (medida && !especificacao.toLowerCase().includes(medida.toLowerCase())) especificacao += ` (${medida})`;
  // a marca só entra quando ainda não está no nome (o cadastro às vezes já traz "Fabricante · cód.")
  const so = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (marca && !so(especificacao).includes(so(marca))) especificacao += `. Referência: ${marca}`;
  return especificacao;
}

const arredondar = (valor: number) => Math.round(valor * 100) / 100;

/**
 * Linhas da tabela de itens. `base` diz de onde vem o valor: na Solicitação, o
 * orçamento escolhido; no Termo de Referência, a média dos orçamentos (o "Mapa
 * de pesquisa de preços"). Com um item só, o valor do orçamento é do item;
 * com vários, cada item fica com o preço estimado e o total segue o orçamento.
 */
export function linhasDoDocumento(
  itens: readonly ItemDoDocumento[],
  orcamentos: readonly OrcamentoDoDocumento[],
  base: "escolhido" | "media",
): { linhas: LinhaDocumento[]; total: number | null; valorDoOrcamento: number | null } {
  const valores = orcamentos.map((o) => Number(o.valor_total)).filter((v) => Number.isFinite(v) && v > 0);
  const escolhido = orcamentos.find((o) => o.escolhida);
  const valorDoOrcamento =
    base === "media"
      ? valores.length
        ? arredondar(valores.reduce((t, v) => t + v, 0) / valores.length)
        : null
      : escolhido
        ? Number(escolhido.valor_total)
        : null;

  const linhas = itens.map((item, indice) => {
    const quantidade = Number(item.quantidade) || 0;
    let unitario: number | null = null;
    if (itens.length === 1 && valorDoOrcamento != null && quantidade > 0) unitario = arredondar(valorDoOrcamento / quantidade);
    else if (item.orcamento_previo != null && Number(item.orcamento_previo) > 0) unitario = Number(item.orcamento_previo);
    return {
      numero: indice + 1,
      especificacao: especificacaoDoItem(item),
      unidade: texto(item.unidade) || texto(item.insumos?.unidade) || "un.",
      quantidade,
      valorUnitario: unitario,
      valorTotal: itens.length === 1 && valorDoOrcamento != null ? valorDoOrcamento : unitario != null ? arredondar(unitario * quantidade) : null,
    };
  });
  const soma = linhas.every((l) => l.valorTotal != null) ? arredondar(linhas.reduce((t, l) => t + (l.valorTotal ?? 0), 0)) : null;
  return { linhas, total: valorDoOrcamento ?? soma, valorDoOrcamento };
}

/**
 * Um texto por item (justificativa, especificações, critério), sem repetir o
 * mesmo texto de dois insumos; sem nada nos insumos, vale o texto do pedido.
 */
export function textosDosItens(
  itens: readonly ItemDoDocumento[],
  campo: "justificativa_tr" | "especificacoes_tr" | "criterio_aceitabilidade",
  doPedido?: string | null,
): string[] {
  const vistos = new Set<string>();
  const textos: string[] = [];
  for (const item of itens) {
    const valor = String(item.insumos?.[campo] ?? "").trim();
    if (!valor || vistos.has(valor)) continue;
    vistos.add(valor);
    textos.push(valor);
  }
  const reserva = String(doPedido ?? "").trim();
  return textos.length ? textos : reserva ? [reserva] : [];
}

/** Sem o texto da planilha (coluna H), o quantitativo sai da lista de itens. */
export function quantitativoDosItens(linhas: readonly LinhaDocumento[]): string {
  if (!linhas.length) return "";
  const partes = linhas.map((l) => `${l.quantidade.toLocaleString("pt-BR")} ${l.unidade} de ${l.especificacao}`);
  return `O quantitativo total demandado é de ${partes.length === 1 ? partes[0] : partes.map((p, i) => `(${i + 1}) ${p}`).join("; ")}.`;
}

/** O prazo de entrega do orçamento escolhido (ou o menor dos três); 15 dias quando ninguém informou. */
export function prazoDeEntrega(orcamentos: readonly OrcamentoDoDocumento[]): number {
  const escolhido = orcamentos.find((o) => o.escolhida)?.prazo_entrega_dias;
  if (escolhido != null && escolhido > 0) return escolhido;
  const prazos = orcamentos.map((o) => Number(o.prazo_entrega_dias)).filter((p) => Number.isFinite(p) && p > 0);
  return prazos.length ? Math.min(...prazos) : 15;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "Curitiba, 27 de novembro de 2026." no fuso de Brasília. */
export function dataPorExtenso(quando: Date, cidade = "Curitiba"): string {
  const [ano, mes, dia] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(quando).split("-").map(Number);
  return `${cidade}, ${dia} de ${MESES[mes - 1]} de ${ano}.`;
}

/** Local de entrega do laboratório (modelo do Termo de Referência da Funpar). */
export const LOCAL_DE_ENTREGA = {
  unidade: "GIA",
  endereco: "Rua dos Funcionários 1540, Juvevê. CEP: 80035050. Campus UFPR Agrárias. Prédio: Laboratório GIA.",
};

/** Critério de aceitabilidade do modelo, quando o insumo não tem o próprio. */
export const CRITERIO_PADRAO =
  "Na aquisição de material, o recebimento provisório será feito pela conferência da quantidade solicitada, e o recebimento definitivo, no prazo de 15 dias a contar do recebimento provisório, com a análise de que todos os materiais estão em perfeitas condições de utilização.";
