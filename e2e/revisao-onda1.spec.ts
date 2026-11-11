import { expect, test, type Page } from "@playwright/test";

// Onda 1 da revisão de usabilidade de 11/11/2026 (navegação e base visual).
// Cada teste cita o achado do documento que ele prova.

async function comoCategoria(page: Page, papel: string) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL ausente na configuração do Playwright");
  await page.context().addCookies([{ name: "kontrol_e2e_papel", value: papel, url: baseURL }]);
}

test.afterEach(async ({ page }) => {
  await page.context().clearCookies();
});

test("barra lateral: Início primeiro, Projetos com item próprio e Análises e custeio (L3, L4, decisões 3 e 4)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/");
  const principal = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(principal.getByRole("link")).toHaveText([
    "Início",
    "Orçamentos",
    "Projetos",
    "Suprimentos",
    "Análises e custeio",
    "Cadastros",
    "Governança",
    "Ajuda",
  ]);
  await expect(principal.getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
  await expect(principal.getByRole("link", { name: "Operação" })).toHaveCount(0);

  await principal.getByRole("link", { name: "Projetos" }).click();
  await expect(page).toHaveURL(/\/projetos$/);
  await expect(page.getByRole("heading", { level: 1, name: "Projetos" })).toBeVisible();
  await expect(principal.locator("a[aria-current]")).toHaveText(["Projetos"]);
  // Projetos não é de Orçamentos: a barra de Orçamentos não aparece na tela
  await expect(page.getByRole("navigation", { name: "Navegação de Orçamentos" })).toHaveCount(0);

  await page.goto("/projetos/1");
  await expect(principal.locator("a[aria-current]")).toHaveText(["Projetos"]);
});

test("Orçamentos: Configurações reúne as três telas que só a busca alcançava (L5)", async ({ page }) => {
  await page.goto("/orcamento/demandas");
  const barra = page.getByRole("navigation", { name: "Navegação de Orçamentos" });
  await expect(barra.getByRole("link")).toHaveText(["Orçamentos", "Histórico de orçamentos", "Fundos e taxas", "Configurações"]);
  // as abas de configuração só aparecem dentro de Configurações
  await expect(page.getByRole("navigation", { name: "Configurações dos orçamentos" })).toHaveCount(0);

  await barra.getByRole("link", { name: "Configurações" }).click();
  await expect(page).toHaveURL(/\/orcamento\/parametros$/);
  await expect(barra.getByRole("link", { name: "Configurações" })).toHaveAttribute("aria-current", "page");
  const abas = page.getByRole("navigation", { name: "Configurações dos orçamentos" });
  await expect(abas.getByRole("link")).toHaveText(["Parâmetros econômicos", "Documento da proposta", "Modelos e catálogo"]);
  await expect(abas.getByRole("link", { name: "Parâmetros econômicos" })).toHaveAttribute("aria-current", "page");

  await abas.getByRole("link", { name: "Modelos e catálogo" }).click();
  await expect(page).toHaveURL(/\/orcamento\/modelos$/);
  await expect(page.getByRole("heading", { level: 1, name: "Modelos e catálogo" })).toBeVisible();
  await expect(barra.getByRole("link", { name: "Configurações" })).toHaveAttribute("aria-current", "page");
  await expect(abas.locator("a[aria-current]")).toHaveText(["Modelos e catálogo"]);

  await abas.getByRole("link", { name: "Documento da proposta" }).click();
  await expect(page).toHaveURL(/\/orcamento\/documento-proposta$/);
  await expect(abas.locator("a[aria-current]")).toHaveText(["Documento da proposta"]);
});

test("Configurações mostra só as telas que a pessoa pode abrir (L5, prova negativa)", async ({ page }) => {
  await comoCategoria(page, "laboratorio");
  await page.goto("/orcamento/parametros");
  const abas = page.getByRole("navigation", { name: "Configurações dos orçamentos" });
  await expect(abas.getByRole("link")).toHaveText(["Parâmetros econômicos", "Documento da proposta"]);
  await expect(abas.getByRole("link", { name: "Modelos e catálogo" })).toHaveCount(0);
});

test("Regras do orçamento fica na Governança; o endereço antigo continua valendo (L6)", async ({ page }) => {
  await page.goto("/orcamento/governanca");
  await expect(page).toHaveURL(/\/governanca\/regras$/);
  await expect(page.getByRole("heading", { level: 1, name: "Regras do orçamento" })).toBeVisible();
  const governanca = page.getByRole("navigation", { name: "Navegação de Governança" });
  await expect(governanca.getByRole("link", { name: "Regras do orçamento" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Navegação de Orçamentos" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Navegação principal" }).locator("a[aria-current]")).toHaveText(["Governança"]);
});

test("sem Ver auditoria, Regras do orçamento some da barra e a rota não abre (L6, prova negativa)", async ({ page }) => {
  await comoCategoria(page, "laboratorio");
  await page.goto("/governanca/incidentes");
  const governanca = page.getByRole("navigation", { name: "Navegação de Governança" });
  await expect(governanca.getByRole("link", { name: "Incidentes" })).toBeVisible();
  await expect(governanca.getByRole("link", { name: "Regras do orçamento" })).toHaveCount(0);

  // no modo de teste o bloqueio por rota (middleware) não roda; a própria tela recusa
  await page.goto("/governanca/regras");
  await expect(page.getByText("Acesso restrito. As regras do orçamento aparecem para quem tem a permissão")).toBeVisible();
  await expect(page.getByRole("link", { name: "Voltar para Governança" })).toHaveAttribute("href", "/governanca");
  await expect(page.getByRole("heading", { level: 1, name: "Regras do orçamento" })).toHaveCount(0);
});

// ───────── Onda 1b: barra única do topo, sino e ajuda ─────────

test("barra do topo é a mesma em todas as telas: lugares do módulo, busca, sino e ajuda (10.2)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  for (const rota of ["/", "/orcamento/demandas", "/estoque", "/projetos", "/ajuda", "/cadastros", "/governanca/incidentes"]) {
    await page.goto(rota);
    const acoes = page.getByRole("group", { name: "Busca, avisos e ajuda" });
    await expect(acoes.getByRole("button", { name: "Buscar ou executar" }), rota).toBeVisible();
    await expect(acoes.getByRole("button", { name: /^Avisos: / }), rota).toBeVisible();
    await expect(acoes.getByRole("button", { name: "Ajuda contextual" }), rota).toBeVisible();
    // uma barra só: nenhuma tela monta a sua
    await expect(page.getByTestId("barra-superior"), rota).toHaveCount(1);
  }
  // telas de um lugar só não ganham barra de lugares
  await page.goto("/");
  await expect(page.getByTestId("barra-superior").getByRole("navigation")).toHaveCount(0);
  // a busca saiu da barra lateral e abre pela barra do topo
  await expect(page.locator("aside").getByRole("button", { name: /Buscar/ })).toHaveCount(0);
  await page.getByRole("group", { name: "Busca, avisos e ajuda" }).getByRole("button", { name: "Buscar ou executar" }).click();
  await expect(page.getByRole("dialog").getByRole("combobox")).toBeVisible();
});

test("botão flutuante de ajuda não existe mais; a ajuda abre pelo ? da barra (8.6, 10.2)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/orcamento/demandas/nova");
  // nada fixo no canto inferior direito cobrindo a barra de salvar
  const fixosNoCanto = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
      const estilo = getComputedStyle(el);
      if (estilo.position !== "fixed" || estilo.display === "none") return false;
      const caixa = el.getBoundingClientRect();
      return caixa.width > 0 && caixa.width < 80 && caixa.bottom > window.innerHeight - 80 && caixa.right > window.innerWidth - 80;
    }).length,
  );
  expect(fixosNoCanto).toBe(0);
  await expect(page.getByRole("button", { name: "Ajuda contextual" })).toHaveCount(1);
  await page.getByRole("button", { name: "Ajuda contextual" }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Ver tudo sobre esta tela na Ajuda" })).toBeVisible();
});

test("sino junta Aguardando você e Notificações e aparece fora de Suprimentos (L2, F8, F9)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  // o estado das notificações é compartilhado entre os testes: o sino tem de bater com a tela de Notificações
  await page.goto("/notificacoes");
  const linha = page.locator("article").filter({ hasText: "Falta de estoque no planejamento" });
  await expect(linha).toBeVisible();
  const naoLida = (await linha.getByRole("button", { name: "Lida" }).count()) > 0;

  // quem trabalha em Orçamentos também vê que tem aviso
  await page.goto("/orcamento/demandas");
  const sino = page.getByRole("button", { name: /^Avisos: \d+ pendências? e \d+ notificaç(ão|ões) não lidas?$/ });
  await expect(sino).toBeVisible();
  await expect(sino.getByTestId("sino-contador")).toHaveText(/^\d+$/);
  await sino.click();

  const painel = page.getByRole("dialog");
  const aguardando = painel.getByRole("region", { name: "Aguardando você" });
  await expect(aguardando.getByRole("link", { name: /Pedidos para você aprovar: \d+\. Ver a lista/ })).toHaveAttribute(
    "href",
    "/pedido?etapa=aprovacao",
  );
  // F8: pendência que a função do banco não cobria
  await expect(aguardando.getByRole("link", { name: /Códigos não reconhecidos: 1\. Ver a lista/ })).toHaveAttribute(
    "href",
    "/scanner/triagem",
  );
  const notificacoes = painel.getByRole("region", { name: "Notificações" });
  const avisoNoSino = notificacoes.getByRole("link", { name: /Falta de estoque no planejamento/ });
  if (naoLida) {
    await expect(avisoNoSino).toHaveAttribute("href", "/planejamento/1");
  } else {
    await expect(avisoNoSino).toHaveCount(0);
    await expect(notificacoes.getByText("Nenhum aviso novo.")).toBeVisible();
  }
  await expect(notificacoes.getByRole("link", { name: "Ver todas as notificações" })).toHaveAttribute("href", "/notificacoes");

  // o item abre o registro e fecha o painel
  await aguardando.getByRole("link", { name: /Primers para aprovar E2E/ }).click();
  await expect(page).toHaveURL(/\/pedido\/502$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Notificações saiu da barra de Suprimentos; a tela continua e marca Início na barra lateral
  await page.goto("/notificacoes");
  await expect(page.getByRole("heading", { level: 1, name: "Notificações" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navegação de Suprimentos" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Navegação principal" }).locator("a[aria-current]")).toHaveText(["Início"]);

  // aviso marcado como lido some do sino sem recarregar a página (o sino relê ao abrir)
  const marcarLida = linha.getByRole("button", { name: "Lida" });
  if ((await marcarLida.count()) > 0) await marcarLida.click();
  await expect(linha.getByText("lida", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Avisos: / }).click();
  const depois = page.getByRole("dialog").getByRole("region", { name: "Notificações" });
  await expect(depois.getByRole("link", { name: /Falta de estoque no planejamento/ })).toHaveCount(0);
});

test("sino mostra só o que a pessoa pode resolver (F8, prova negativa)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await comoCategoria(page, "laboratorio");
  await page.goto("/estoque");
  await page.getByRole("button", { name: /^Avisos: / }).click();
  const aguardando = page.getByRole("dialog").getByRole("region", { name: "Aguardando você" });
  // Laboratório não aprova pedido nem cadastra insumo: nenhuma das duas pendências é dele
  await expect(aguardando.getByRole("link", { name: /Pedidos para você aprovar/ })).toHaveCount(0);
  await expect(aguardando.getByRole("link", { name: /Códigos não reconhecidos/ })).toHaveCount(0);
});

test("no celular o sino, a ajuda e a busca ficam na barra do logotipo (10.6)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pedido");
  await expect(page.getByRole("group", { name: "Busca, avisos e ajuda" })).toBeHidden();
  await expect(page.getByRole("button", { name: /^Avisos: / })).toHaveCount(1);
  await page.getByRole("button", { name: /^Avisos: / }).click();
  const painel = page.getByRole("dialog");
  await expect(painel.getByRole("region", { name: "Aguardando você" })).toBeVisible();
  // o painel cabe na tela
  const caixa = await painel.boundingBox();
  expect(caixa && caixa.x >= 0 && caixa.x + caixa.width <= 390).toBe(true);
  await page.keyboard.press("Escape");
  // sem rolagem lateral da página por causa da barra
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Cadastros: a barra tem 4 grupos e as abas levam a cada cadastro (8.8)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/cadastros");
  const barra = page.getByRole("navigation", { name: "Navegação de Cadastros" });
  await expect(barra.getByRole("link")).toHaveText(["Painel de insumos", "Materiais", "Pessoas e áreas", "Comercial", "Custos"]);
  // antes eram 13 itens que rolavam para o lado: agora a barra cabe em 1366 px
  expect(await barra.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(barra.getByRole("link", { name: "Painel de insumos" })).toHaveAttribute("aria-current", "page");

  await barra.getByRole("link", { name: "Pessoas e áreas" }).click();
  await expect(page).toHaveURL(/\/cadastros\/tecnicos$/);
  await expect(barra.locator("a[aria-current]")).toHaveText(["Pessoas e áreas"]);
  const abas = page.getByRole("navigation", { name: "Cadastros de Pessoas e áreas" });
  await expect(abas.getByRole("link")).toHaveText(["Técnicos", "Laboratórios e áreas", "Responsáveis por etapa"]);
  await expect(abas.locator("a[aria-current]")).toHaveText(["Técnicos"]);

  await abas.getByRole("link", { name: "Responsáveis por etapa" }).click();
  await expect(page).toHaveURL(/\/cadastros\/responsaveis$/);
  await expect(page.getByRole("heading", { level: 1, name: "Responsáveis por etapa" })).toBeVisible();
  await expect(barra.locator("a[aria-current]")).toHaveText(["Pessoas e áreas"]);

  await barra.getByRole("link", { name: "Materiais" }).click();
  await expect(page).toHaveURL(/\/cadastros\/insumos$/);
  await expect(page.getByRole("navigation", { name: "Cadastros de Materiais" }).getByRole("link")).toHaveText([
    "Insumos",
    "Tipos técnicos",
    "Equipamentos",
    "Previsão de equipamentos",
    "Locais",
  ]);

  // grupo de um cadastro só não ganha abas; a página inicial também não
  await page.goto("/cadastros/overhead");
  await expect(barra.locator("a[aria-current]")).toHaveText(["Custos"]);
  await expect(page.getByRole("navigation", { name: /^Cadastros de / })).toHaveCount(0);
  await page.goto("/cadastros");
  await expect(page.getByRole("navigation", { name: /^Cadastros de / })).toHaveCount(0);

  // a busca continua abrindo cada cadastro pelo nome
  await page.getByRole("button", { name: "Buscar ou executar" }).click();
  await page.getByRole("combobox").fill("Fornecedores");
  await page.getByRole("option", { name: /Fornecedores/ }).first().click();
  await expect(page).toHaveURL(/\/cadastros\/fornecedores$/);
  await expect(barra.locator("a[aria-current]")).toHaveText(["Comercial"]);
});

test("grupo de cadastros que não existe não abre nada (8.8, prova negativa)", async ({ page }) => {
  await page.goto("/cadastros/grupo/inexistente");
  await expect(page.getByRole("heading", { level: 1, name: "Página não encontrada" })).toBeVisible();
  await expect(page).toHaveURL(/\/cadastros\/grupo\/inexistente$/);
  await expect(page.getByRole("navigation", { name: /^Cadastros de / })).toHaveCount(0);
});

test("Qualidade dos cadastros é o primeiro cartão de Cadastros, com o número de pendências (L8)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/cadastros");
  const cartao = page.getByTestId("cartao-qualidade");
  await expect(cartao).toBeVisible();
  await expect(cartao).toContainText("Qualidade dos cadastros");
  await expect(cartao).toContainText(/\d+ pendências?|nada pendente/);
  const texto = (await cartao.innerText()).replace(/\s+/g, " ");
  const total = Number(/(\d+) pendência/.exec(texto)?.[1] ?? 0);
  // vem antes dos gráficos do painel, e o botão do fim da página saiu
  const yCartao = (await cartao.boundingBox())!.y;
  const yPainel = (await page.getByRole("region", { name: "Painel de insumos" }).boundingBox())!.y;
  expect(yCartao).toBeLessThan(yPainel);
  await expect(page.getByRole("link", { name: "Revisar qualidade dos cadastros" })).toHaveCount(0);

  // o número do cartão é o mesmo da tela
  await cartao.click();
  await expect(page).toHaveURL(/\/cadastros\/qualidade$/);
  await expect(page.getByRole("heading", { level: 1, name: "Qualidade dos cadastros" })).toBeVisible();
  await expect(page.getByText(`${total} pendência(s)`, { exact: true })).toBeVisible();
});

test("Códigos não reconhecidos fica dentro de Entrada e saída por leitura, com contador (L11)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/estoque/leitura");
  const secoes = page.getByRole("navigation", { name: "Seções do estoque" });
  await expect(secoes.getByRole("link")).toHaveText([
    "Saldo e lotes",
    "Controle de Estoque",
    "Entrada e saída por leitura",
    "Inventário",
    "Etiquetas",
  ]);
  const atalho = page.getByTestId("link-codigos-nao-reconhecidos");
  await expect(atalho).toHaveText(/^Códigos não reconhecidos\s*\d+$/);
  const esperando = Number(/(\d+)$/.exec((await atalho.innerText()).trim())?.[1]);
  expect(esperando).toBeGreaterThan(0);

  await atalho.click();
  await expect(page).toHaveURL(/\/scanner\/triagem$/);
  await expect(page.getByRole("heading", { level: 1, name: "Códigos não reconhecidos" })).toBeVisible();
  // a tela continua dentro de Leitura na barra do Estoque, e o número bate com a lista
  await expect(secoes.locator("a[aria-current]")).toHaveText(["Entrada e saída por leitura"]);
  await expect(page.getByTestId("triagem-codigo")).toHaveCount(esperando);
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Entrada e saída por leitura" }).click();
  await expect(page).toHaveURL(/\/estoque\/leitura$/);
});

test("criar fica atrás de um botão: Planejamento, Compras, Usuários e Inventário (L14)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  const telas = [
    { url: "/planejamento", botao: "Novo plano", campo: () => page.getByLabel("Nome do plano") },
    { url: "/compras", botao: "Nova compra", campo: () => page.getByLabel("Fornecedor", { exact: true }) },
    { url: "/usuarios", botao: "Novo usuário", campo: () => page.locator("#novo-usuario-nome") },
    { url: "/estoque/inventario", botao: "Nova campanha", campo: () => page.getByPlaceholder("Inventário semanal") },
  ];
  for (const tela of telas) {
    await page.goto(tela.url);
    const botao = page.getByRole("button", { name: tela.botao, exact: true });
    await expect(botao, tela.url).toHaveAttribute("aria-expanded", "false");
    // a lista aparece sem o formulário na frente
    await expect(tela.campo(), tela.url).toBeHidden();
    await botao.click();
    await expect(tela.campo(), tela.url).toBeVisible();
    await expect(tela.campo(), tela.url).toBeFocused();
    const fechar = page.getByRole("button", { name: `Fechar: ${tela.botao}` });
    await expect(fechar).toHaveAttribute("aria-expanded", "true");
    await fechar.click();
    await expect(tela.campo(), tela.url).toBeHidden();
  }
});

test("Excluir e Cancelar do plano saem da linha e vão para o menu (L15)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/planejamento");
  const tabela = page.getByRole("table").first();
  await expect(tabela).toBeVisible();
  await expect(tabela.getByRole("link", { name: /^Ver / }).first()).toBeVisible();
  // nenhuma ação destrutiva à vista na linha
  await expect(tabela.getByRole("button", { name: /^(Excluir|Cancelar) / })).toHaveCount(0);
  const menu = tabela.getByRole("button", { name: /^Mais ações de / }).first();
  await menu.click();
  await expect(page.getByRole("menuitem", { name: /^(Excluir|Cancelar) plano$/ })).toBeVisible();
  // negativa: abrir o menu e sair não muda nada
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Planejamento e Pedidos ganham abas; na página de um registro elas não aparecem (L12, L13)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/planejamento");
  const planejamento = page.getByRole("navigation", { name: "Seções do planejamento" });
  await expect(planejamento.getByRole("link")).toHaveText(["Planos", /^Disputas de reserva/]);
  await expect(planejamento.locator("a[aria-current]")).toHaveText(["Planos"]);
  await planejamento.getByRole("link", { name: /Disputas de reserva/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Disputas de reserva/ })).toBeVisible();
  await expect(planejamento.locator("a[aria-current]")).toHaveText([/^Disputas de reserva/]);
  await page.goto("/planejamento/900");
  await expect(page.getByRole("heading", { level: 1, name: "Plano com baixa E2E" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Seções do planejamento" })).toHaveCount(0);

  await page.goto("/pedido");
  const pedidos = page.getByRole("navigation", { name: "Seções de pedidos" });
  await expect(pedidos.getByRole("link")).toHaveText(["Pedidos", "Compras formais", "Prazos de compra"]);
  // os links de texto sob o título saíram
  await expect(page.getByRole("navigation", { name: "Compras e prazos" })).toHaveCount(0);
  await pedidos.getByRole("link", { name: "Prazos de compra" }).click();
  await expect(page).toHaveURL(/\/suprimentos\/prazos$/);
  await expect(pedidos.locator("a[aria-current]")).toHaveText(["Prazos de compra"]);
  await expect(
    page.getByRole("navigation", { name: "Navegação de Suprimentos" }).getByRole("link", { name: "Pedidos" }),
  ).toHaveAttribute("aria-current", "page");
  await page.goto("/pedido/502");
  await expect(page.getByRole("navigation", { name: "Seções de pedidos" })).toHaveCount(0);
});

test("abas de Pedidos mostram só as telas que a pessoa pode abrir (L13, prova negativa)", async ({ page }) => {
  // Cadastro não acessa Pedidos nem Compras: sem duas telas para alternar, não há abas
  await comoCategoria(page, "cadastro");
  await page.goto("/pedido");
  await expect(page.getByRole("heading", { level: 1, name: "Pedidos" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Seções de pedidos" })).toHaveCount(0);
});

test("cabeçalho padrão: título de 20 px e mesma margem nas telas que fugiam do padrão (10.2)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  const titulo = () => page.getByRole("heading", { level: 1 });
  const telas = [
    "/planejamento/disputas",
    "/suprimentos/prazos",
    "/governanca/incidentes",
    "/notificacoes",
    "/scanner/triagem",
    "/cadastros/qualidade",
  ];
  for (const tela of telas) {
    await page.goto(tela);
    await expect(titulo(), tela).toBeVisible();
    expect(await titulo().evaluate((el) => getComputedStyle(el).fontSize), tela).toBe("20px");
  }
  // trocar de aba não desloca o título para o lado
  const xDoTitulo = async (rota: string) => {
    await page.goto(rota);
    await expect(titulo()).toBeVisible();
    return (await titulo().boundingBox())!.x;
  };
  expect(Math.abs((await xDoTitulo("/planejamento")) - (await xDoTitulo("/planejamento/disputas")))).toBeLessThanOrEqual(1);
  expect(Math.abs((await xDoTitulo("/pedido")) - (await xDoTitulo("/suprimentos/prazos")))).toBeLessThanOrEqual(1);
});

test("campo padrão nos formulários de criação: rótulo de 12 px em frase normal (10.4)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  const formularios = [
    { url: "/planejamento", botao: "Novo plano", rotulo: "Nome do plano" },
    { url: "/compras", botao: "Nova compra", rotulo: "Fornecedor" },
    { url: "/usuarios", botao: "Novo usuário", rotulo: "E-mail" },
    { url: "/estoque/inventario", botao: "Nova campanha", rotulo: "Campanha" },
  ];
  for (const formulario of formularios) {
    await page.goto(formulario.url);
    await page.getByRole("button", { name: formulario.botao, exact: true }).click();
    const rotulo = page.locator("label", { hasText: new RegExp(`^${formulario.rotulo}$`) }).first();
    await expect(rotulo, formulario.url).toBeVisible();
    const estilo = await rotulo.evaluate((el) => {
      const css = getComputedStyle(el);
      return { tamanho: css.fontSize, caixa: css.textTransform };
    });
    expect(estilo, formulario.url).toEqual({ tamanho: "12px", caixa: "none" });
    // o rótulo está ligado ao campo: clicar nele leva o foco ao controle
    const campo = page.locator(`#${await rotulo.getAttribute("for")}`);
    await rotulo.click();
    await expect(campo, formulario.url).toBeFocused();
    expect(await campo.evaluate((el) => getComputedStyle(el).height), formulario.url).toBe("36px");
  }
});

test("tabela padrão: título de coluna em frase normal e primeira coluna fixa ao rolar (10.3, 10.4)", async ({ page }) => {
  // largura em que a tabela de Pedidos não cabe e precisa rolar para o lado
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/pedido");
  const tabela = page.getByRole("table").first();
  await expect(tabela).toBeVisible();
  const titulos = tabela.getByRole("columnheader");
  expect(await titulos.first().evaluate((el) => getComputedStyle(el).textTransform)).toBe("none");

  const area = tabela.locator("xpath=..");
  expect(await area.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const primeira = tabela.locator("tbody tr").first().locator("td").first();
  const segunda = tabela.locator("tbody tr").first().locator("td").nth(1);
  const antes = { primeira: (await primeira.boundingBox())!.x, segunda: (await segunda.boundingBox())!.x };
  await expect(area).not.toHaveAttribute("data-rolado", "true");
  await area.evaluate((el) => {
    el.scrollLeft = 160;
  });
  await expect(area).toHaveAttribute("data-rolado", "true");
  const depois = { primeira: (await primeira.boundingBox())!.x, segunda: (await segunda.boundingBox())!.x };
  // a coluna com o número do pedido não sai do lugar; as outras rolam por baixo
  expect(Math.abs(depois.primeira - antes.primeira)).toBeLessThanOrEqual(1);
  expect(antes.segunda - depois.segunda).toBeGreaterThan(100);
  // negativa: voltando ao início, a sombra some
  await area.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await expect(area).not.toHaveAttribute("data-rolado", "true");
});
