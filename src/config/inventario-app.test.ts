import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { APP_MODULES, getCommandGroups, getSidebarGroups, moduleIsActive, type AppModuleId } from "./modules";

/**
 * Inventário do app (documento "Organização do app, análise refeita", seção 2,
 * aprovado por Antonio em 11/11/2026). A regra dele: nenhuma tela, quadro,
 * ação ou campo sai do app sem estar listado e sem o sim dele. Este teste
 * confere, linha por linha, que cada item do inventário continua alcançável:
 * por um item da barra do módulo, pela busca (Ctrl K) ou dentro de uma tela.
 *
 * Para tirar ou esconder um item, primeiro é preciso o sim de Antonio; depois,
 * a linha sai daqui no mesmo PR, com a justificativa.
 */

const SRC = path.resolve(__dirname, "..");
const APP_DIR = path.join(SRC, "app");

type Onde =
  | { tipo: "barra"; modulo: AppModuleId; href: string; rotulo: string }
  | { tipo: "busca"; href: string }
  | { tipo: "tela"; arquivo: string; contem: string };

type ItemDoInventario = { area: string; item: string; onde: Onde[] };

const barra = (modulo: AppModuleId, href: string, rotulo: string): Onde => ({ tipo: "barra", modulo, href, rotulo });
const busca = (href: string): Onde => ({ tipo: "busca", href });
const tela = (arquivo: string, contem: string): Onde => ({ tipo: "tela", arquivo, contem });

const INVENTARIO: ItemDoInventario[] = [
  // ── Início ──
  { area: "Início", item: "Aguardando você", onde: [barra("inicio", "/", "Início"), tela("app/page.tsx", "<AguardandoVoce")] },
  // os três números do estoque saem da mesma regra do topo da Situação do estoque (numerosDoEstoque)
  { area: "Início", item: "Número Sem estoque", onde: [tela("app/page.tsx", "numerosDoEstoque(sinaisEstoque)"), tela("app/page.tsx", '"sem_disponivel", "vencido_vencendo", "reposicao"'), tela("lib/estoque/controle-estoque.ts", '"Sem estoque",')] },
  { area: "Início", item: "Número Vencidos ou vencendo", onde: [tela("app/page.tsx", '"sem_disponivel", "vencido_vencendo", "reposicao"'), tela("lib/estoque/controle-estoque.ts", '"Vencidos ou vencendo",')] },
  { area: "Início", item: "Número Repor", onde: [tela("app/page.tsx", '"sem_disponivel", "vencido_vencendo", "reposicao"'), tela("lib/estoque/controle-estoque.ts", '"Repor",')] },
  { area: "Início", item: "Número Compras abertas", onde: [tela("app/page.tsx", 'label: "Compras abertas"')] },
  { area: "Início", item: "Número Propostas com o cliente", onde: [tela("app/page.tsx", 'label: "Propostas com o cliente"')] },
  { area: "Início", item: "Precisa de atenção hoje", onde: [tela("app/page.tsx", "Precisa de atenção hoje"), tela("app/page.tsx", "<TabelaAtencaoHoje")] },
  // as quatro listas da 1.8.1 viraram as quatro origens da tabela (etapa 4 da organização de 11/11)
  { area: "Início", item: "Tabela: prioridade de compra (origem Estoque)", onde: [tela("app/page.tsx", "linhasDoEstoque(situacaoEstoque.linhas)"), tela("app/page.tsx", "linhasDeSugestao(comprarAgora)")] },
  { area: "Início", item: "Tabela: validade e uso (origem Validade)", onde: [tela("lib/inicio/atencao-hoje.ts", '"vencidos", "vencendo", "fora-de-ordem", "varios-abertos"')] },
  { area: "Início", item: "Tabela: compras em andamento (origem Compras)", onde: [tela("app/page.tsx", "linhasDeCompras(")] },
  { area: "Início", item: "Tabela: avisos não lidos (origem Aviso)", onde: [tela("app/page.tsx", "linhasDeAvisos("), tela("app/page.tsx", '{ rotulo: "Notificações", href: "/notificacoes" }')] },
  { area: "Início", item: "Tabela: colunas Origem, Item, Situação, Prazo e Ação", onde: [tela("components/dashboard/TabelaAtencaoHoje.tsx", "Origem\n"), tela("components/dashboard/TabelaAtencaoHoje.tsx", "Prazo\n"), tela("components/dashboard/TabelaAtencaoHoje.tsx", "Ação\n")] },
  { area: "Início", item: "Tabela: Ver todos", onde: [tela("components/dashboard/TabelaAtencaoHoje.tsx", "Ver todos (")] },
  { area: "Início", item: "Dashboard executivo (gastos por mês e funil)", onde: [tela("app/page.tsx", "<ExecutiveCharts")] },
  { area: "Início", item: "Notificações", onde: [busca("/notificacoes"), tela("components/layout/SinoAvisos.tsx", 'href="/notificacoes"')] },
  // ── Barra do topo ──
  { area: "Barra", item: "Busca (Ctrl K)", onde: [tela("components/layout/BarraSuperior.tsx", "abrirPaletaComandos")] },
  { area: "Barra", item: "Ajuda desta tela", onde: [tela("components/layout/BarraSuperior.tsx", "abrirAjudaContextual")] },
  { area: "Barra", item: "Sino de avisos", onde: [tela("components/layout/BarraSuperior.tsx", "<SinoAvisos")] },
  // ── Projetos ──
  { area: "Projetos", item: "Lista de projetos", onde: [barra("projetos", "/projetos", "Projetos")] },
  { area: "Projetos", item: "Ficha do projeto", onde: [tela("app/projetos/[id]/page.tsx", "export default")] },
  { area: "Projetos", item: "Planejamento", onde: [barra("projetos", "/planejamento", "Planejamento")] },
  {
    area: "Projetos",
    item: "Disputas de reserva",
    onde: [busca("/planejamento/disputas"), tela("components/planejamento/PlanejamentoSubnav.tsx", 'href: "/planejamento/disputas"')],
  },
  // ── Compras: do pedido ao recebimento ──
  { area: "Compras", item: "Visão geral", onde: [barra("compras", "/suprimentos", "Visão geral")] },
  { area: "Compras", item: "Visão geral: quadro Aguardando você", onde: [tela("app/suprimentos/page.tsx", "<AguardandoVoce")] },
  { area: "Compras", item: "Visão geral: andamento dos pedidos nas 6 etapas", onde: [tela("app/suprimentos/page.tsx", "<AndamentoPedidos")] },
  { area: "Compras", item: "Pedidos", onde: [barra("compras", "/pedido", "Pedidos")] },
  { area: "Compras", item: "Pedidos: quadro Aguardando você", onde: [tela("app/pedido/page.tsx", "<AguardandoVoce\n")] },
  { area: "Compras", item: "Novo pedido", onde: [tela("app/suprimentos/page.tsx", 'href="/pedido?novo=1"')] },
  { area: "Compras", item: "Compras com fornecedor", onde: [barra("compras", "/compras", "Compras com fornecedor")] },
  { area: "Compras", item: "Nova compra (sem pedido)", onde: [tela("app/compras/page.tsx", 'rotulo="Nova compra"')] },
  { area: "Compras", item: "Campo Projeto ou campanha em Nova compra", onde: [tela("app/compras/page.tsx", 'rotulo="Projeto ou campanha (texto livre)"')] },
  { area: "Compras", item: "Recebimento", onde: [barra("compras", "/recebimento", "Recebimento")] },
  { area: "Compras", item: "Prazos de compra", onde: [barra("compras", "/suprimentos/prazos", "Prazos de compra")] },
  // ── Estoque ──
  { area: "Estoque", item: "Saldo e lotes", onde: [barra("estoque", "/estoque", "Saldo e lotes")] },
  {
    area: "Estoque",
    item: "Saldo: coluna Validade mais próxima (era da visão geral de Suprimentos)",
    onde: [tela("components/suprimentos/EstoqueDisponivelTable.tsx", 'header: "Validade mais próxima"')],
  },
  { area: "Estoque", item: "Dar baixa no saldo e nos lotes", onde: [tela("components/estoque/EstoqueTables.tsx", "<DarBaixaDialog")] },
  { area: "Estoque", item: "Situação do estoque (painel de alertas)", onde: [barra("estoque", "/estoque/situacao", "Situação do estoque")] },
  { area: "Estoque", item: "Gerar pedidos de reposição", onde: [tela("app/estoque/situacao/page.tsx", "<GerarPedidoReposicaoButton")] },
  { area: "Estoque", item: "A caminho: compras ainda não recebidas", onde: [tela("app/estoque/situacao/page.tsx", "<ACaminhoInsumos")] },
  // o que era do Controle de Estoque e voltou para dentro da Situação (etapa 3 da organização de 11/11)
  { area: "Estoque", item: "Situação: visões por insumo, por lote e gráficos", onde: [tela("app/estoque/situacao/page.tsx", "<VisoesSituacao"), tela("lib/estoque/controle-estoque.ts", '{ id: "lote", rotulo: "Por lote" }')] },
  { area: "Estoque", item: "Situação: números Sem estoque, Repor, Vencidos ou vencendo e Compra atrasada", onde: [tela("app/estoque/situacao/page.tsx", "<IndicadoresEstoque"), tela("components/estoque/IndicadoresEstoque.tsx", "numerosDoEstoque(resumo)"), tela("lib/estoque/controle-estoque.ts", '"Compra atrasada",')] },
  { area: "Estoque", item: "Situação: saúde do estoque", onde: [tela("components/estoque/IndicadoresEstoque.tsx", 'label="Saúde do estoque"'), tela("components/estoque/ResumoGraficoEstoque.tsx", 'data-testid="taxa-de-saude"')] },
  { area: "Estoque", item: "Situação: quadros de alerta", onde: [tela("app/estoque/situacao/page.tsx", 'mostrar="quadros"')] },
  { area: "Estoque", item: "Situação: tratar por insumo, com os sinais de cada um", onde: [tela("app/estoque/situacao/page.tsx", "<ControlePorInsumo")] },
  { area: "Estoque", item: "Situação: filtro de criticidade", onde: [tela("components/estoque/ControleEstoque.tsx", "FILTROS_CRITICIDADE.map")] },
  { area: "Estoque", item: "Situação: filtro de avisos pendentes, tratados e sem aviso", onde: [tela("components/estoque/ControleEstoque.tsx", "FILTROS_AVISO.map")] },
  { area: "Estoque", item: "Situação: Tratar alerta (marca o aviso como lido)", onde: [tela("components/estoque/ControleEstoque.tsx", "executar(marcarNotificacaoLida)")] },
  { area: "Estoque", item: "Situação: Arquivar o aviso", onde: [tela("components/estoque/ControleEstoque.tsx", "executar(arquivarNotificacao)")] },
  { area: "Estoque", item: "Situação: Dar baixa em cada insumo", onde: [tela("components/estoque/ControleEstoque.tsx", "<DarBaixaDialog")] },
  { area: "Estoque", item: "Situação: Pedir reposição em cada insumo", onde: [tela("components/estoque/ControleEstoque.tsx", "<GerarPedidoInsumoButton")] },
  { area: "Estoque", item: "Situação: lotes pela validade, com as ações do lote", onde: [tela("app/estoque/situacao/page.tsx", "<ControlePorLote"), tela("components/estoque/ControleEstoque.tsx", "<LotesTable")] },
  { area: "Estoque", item: "Situação: gráficos de cobertura, categoria, valor e movimentos", onde: [tela("app/estoque/situacao/page.tsx", 'mostrar="graficos"')] },
  { area: "Estoque", item: "Situação: gráfico Insumos por situação e notas de controle", onde: [tela("app/estoque/situacao/page.tsx", "<ResumoGraficoEstoque"), tela("components/estoque/ResumoGraficoEstoque.tsx", "Notas de controle")] },
  { area: "Estoque", item: "Entrada e saída por leitura", onde: [barra("estoque", "/estoque/leitura", "Entrada e saída por leitura")] },
  {
    area: "Estoque",
    item: "Códigos não reconhecidos",
    onde: [busca("/scanner/triagem"), tela("app/estoque/leitura/page.tsx", 'href="/scanner/triagem"')],
  },
  { area: "Estoque", item: "Inventário", onde: [barra("estoque", "/estoque/inventario", "Inventário")] },
  { area: "Estoque", item: "Etiquetas", onde: [barra("estoque", "/etiquetas", "Etiquetas")] },
  { area: "Estoque", item: "Custo do estoque", onde: [barra("estoque", "/estoque/custos", "Custo do estoque")] },
  { area: "Estoque", item: "Equipamentos", onde: [barra("estoque", "/estoque/equipamentos", "Equipamentos")] },
  {
    area: "Estoque",
    item: "Ficha do insumo",
    onde: [tela("app/estoque/insumos/[id]/page.tsx", "export default"), tela("components/suprimentos/EstoqueDisponivelTable.tsx", "hrefFichaInsumo(")],
  },
  { area: "Estoque", item: "Página do lote", onde: [tela("app/estoque/lotes/[id]/page.tsx", "export default")] },
  // ── Análises e custeio ──
  { area: "Análises e custeio", item: "Análises", onde: [barra("operacao", "/analises", "Análises")] },
  { area: "Análises e custeio", item: "Insumos por análise", onde: [barra("operacao", "/insumos", "Insumos por análise")] },
  { area: "Análises e custeio", item: "Custeio", onde: [barra("operacao", "/custeio", "Custeio")] },
  { area: "Análises e custeio", item: "Parâmetros de custeio", onde: [busca("/parametros")] },
  // ── Orçamentos (ao cliente; depende do custo das análises) ──
  { area: "Orçamentos", item: "Orçamentos", onde: [barra("orcamentos", "/orcamento/demandas", "Orçamentos")] },
  { area: "Orçamentos", item: "Novo orçamento", onde: [busca("/orcamento/demandas/nova")] },
  { area: "Orçamentos", item: "Histórico de orçamentos", onde: [barra("orcamentos", "/orcamento/historico", "Histórico de orçamentos")] },
  { area: "Orçamentos", item: "Fundos e taxas", onde: [barra("orcamentos", "/orcamento/fundos", "Fundos e taxas")] },
  { area: "Orçamentos", item: "Configurações", onde: [barra("orcamentos", "/orcamento/configuracoes", "Configurações")] },
  { area: "Orçamentos", item: "Parâmetros econômicos", onde: [busca("/orcamento/parametros")] },
  { area: "Orçamentos", item: "Documento da proposta", onde: [busca("/orcamento/documento-proposta")] },
  { area: "Orçamentos", item: "Modelos e catálogo", onde: [busca("/orcamento/modelos")] },
  // ── Cadastros ──
  { area: "Cadastros", item: "Visão geral", onde: [barra("cadastros", "/cadastros", "Visão geral")] },
  { area: "Cadastros", item: "Grupo Materiais", onde: [barra("cadastros", "/cadastros/grupo/materiais", "Materiais")] },
  { area: "Cadastros", item: "Grupo Pessoas e áreas", onde: [barra("cadastros", "/cadastros/grupo/pessoas", "Pessoas e áreas")] },
  { area: "Cadastros", item: "Grupo Comercial", onde: [barra("cadastros", "/cadastros/grupo/comercial", "Comercial")] },
  { area: "Cadastros", item: "Grupo Custos", onde: [barra("cadastros", "/cadastros/grupo/custos", "Custos")] },
  { area: "Cadastros", item: "Qualidade dos cadastros", onde: [tela("app/cadastros/page.tsx", 'href="/cadastros/qualidade"')] },
  // ── Governança ──
  { area: "Governança", item: "Auditoria", onde: [barra("governanca", "/auditoria", "Auditoria")] },
  { area: "Governança", item: "Incidentes", onde: [barra("governanca", "/governanca/incidentes", "Incidentes")] },
  { area: "Governança", item: "Backups", onde: [barra("governanca", "/governanca/backups", "Backups")] },
  { area: "Governança", item: "Erros do app", onde: [barra("governanca", "/governanca/erros", "Erros do app")] },
  { area: "Governança", item: "Usuários", onde: [barra("governanca", "/usuarios", "Usuários")] },
  { area: "Governança", item: "Privilégios", onde: [barra("governanca", "/governanca/privilegios", "Privilégios")] },
  { area: "Governança", item: "Regras do orçamento", onde: [barra("governanca", "/governanca/regras", "Regras do orçamento")] },
  // ── Ajuda ──
  { area: "Ajuda", item: "Central de Ajuda", onde: [barra("ajuda", "/ajuda", "Central de Ajuda")] },
];

const admin = { papel: "admin", permissoes: { admin: true, permissoes: {} } };

function paginaExiste(href: string) {
  const segmentos = href.split("?")[0].split("/").filter(Boolean);
  return existsSync(path.join(APP_DIR, ...segmentos, "page.tsx"));
}

/** Por que o item não é alcançável; null quando é. */
function falha(onde: Onde): string | null {
  if (onde.tipo === "tela") {
    const arquivo = path.join(SRC, onde.arquivo);
    if (!existsSync(arquivo)) return `arquivo ${onde.arquivo} não existe`;
    return readFileSync(arquivo, "utf8").includes(onde.contem) ? null : `${onde.arquivo} não tem ${onde.contem}`;
  }
  if (!onde.href.startsWith("/cadastros/grupo/") && !paginaExiste(onde.href)) return `a página ${onde.href} não existe`;
  if (onde.tipo === "busca") {
    const naBusca = getCommandGroups(admin).flatMap((g) => g.links.map((l) => l.href));
    return naBusca.includes(onde.href) ? null : `${onde.href} não está na busca`;
  }
  const modulo = APP_MODULES.find((m) => m.id === onde.modulo);
  const filho = modulo?.children.find((c) => c.href === onde.href);
  if (!filho) return `${onde.href} não está no módulo ${onde.modulo}`;
  if (filho.showInTopNav === false) return `${onde.href} está escondido da barra de ${onde.modulo}`;
  return filho.label === onde.rotulo ? null : `${onde.href} mudou de nome: "${filho.label}" (o inventário diz "${onde.rotulo}")`;
}

describe("inventário do app: tudo o que estava na seção 2 continua alcançável", () => {
  for (const { area, item, onde } of INVENTARIO) {
    it(`${area}: ${item}`, () => {
      expect(onde.map(falha).filter(Boolean)).toEqual([]);
    });
  }

  it("a barra lateral segue a ordem do processo aprovada em 11/11/2026", () => {
    expect(getSidebarGroups(admin).map((g) => g.title)).toEqual([
      "Início",
      "Projetos",
      "Compras",
      "Estoque",
      "Análises e custeio",
      "Orçamentos",
      "Cadastros",
      "Governança",
      "Ajuda",
    ]);
  });

  it("toda tela de trabalho marca um módulo, e um só, na barra lateral", () => {
    // telas que não são de módulo: entrada, senha, textos legais, links de e-mail e de etiqueta
    const foraDosModulos = ["/login", "/trocar-senha", "/sem-acesso", "/privacidade", "/termos", "/suporte", "/aprovar", "/s"];
    const rotas = INVENTARIO.flatMap((i) => i.onde)
      .filter((o): o is Extract<Onde, { href: string }> => o.tipo !== "tela")
      .map((o) => o.href);
    for (const rota of rotas) {
      expect(APP_MODULES.filter((m) => moduleIsActive(m, rota)).map((m) => m.id), rota).toHaveLength(1);
    }
    for (const rota of foraDosModulos) {
      expect(APP_MODULES.filter((m) => moduleIsActive(m, rota)), rota).toHaveLength(0);
    }
  });

  it("prova negativa: o teste acusa item fora da barra, escondido, renomeado ou tirado da tela", () => {
    expect(falha(barra("compras", "/estoque", "Saldo e lotes"))).toBe("/estoque não está no módulo compras");
    expect(falha(barra("estoque", "/scanner/triagem", "Códigos não reconhecidos"))).toBe(
      "/scanner/triagem está escondido da barra de estoque",
    );
    expect(falha(barra("compras", "/compras", "Compras"))).toBe(
      '/compras mudou de nome: "Compras com fornecedor" (o inventário diz "Compras")',
    );
    expect(falha(busca("/orcamento/configuracoes"))).toBe("/orcamento/configuracoes não está na busca");
    expect(falha(tela("app/compras/page.tsx", 'rotulo="Campanha (texto livre)"'))).toBe(
      'app/compras/page.tsx não tem rotulo="Campanha (texto livre)"',
    );
    expect(falha(barra("estoque", "/estoque/controle-que-nao-existe", "Controle"))).toBe(
      "a página /estoque/controle-que-nao-existe não existe",
    );
  });
});
