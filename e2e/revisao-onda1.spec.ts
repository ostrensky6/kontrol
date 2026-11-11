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
  await expect(aguardando.getByRole("link", { name: /Códigos lidos sem cadastro: 1\. Ver a lista/ })).toHaveAttribute(
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
  await expect(aguardando.getByRole("link", { name: /Códigos lidos sem cadastro/ })).toHaveCount(0);
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
