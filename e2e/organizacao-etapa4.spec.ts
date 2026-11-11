import { expect, test, type Page } from "@playwright/test";

// Organização do app de 11/11/2026, etapa 4: o Início abre com o que espera
// você, depois cinco números, depois a tabela "Precisa de atenção hoje" e, por
// último, os gráficos. A tabela junta as quatro listas que o Início tinha
// (prioridade de compra, validade, compras em andamento e avisos).
// O servidor de teste é compartilhado: outros testes mexem no saldo, nas
// compras e nos avisos, por isso os números são comparados entre si.

async function comoCategoria(page: Page, papel: string) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL ausente na configuração do Playwright");
  await page.context().addCookies([{ name: "kontrol_e2e_papel", value: papel, url: baseURL }]);
}

test.afterEach(async ({ page }) => {
  await page.context().clearCookies();
});

const GRAVIDADE = ["urgente", "atencao", "andamento"];

test("Início: Aguardando você, cinco números, tabela e gráficos, nessa ordem", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");
  const main = page.getByRole("main");
  const topo = async (alvo: ReturnType<Page["locator"]>) => (await alvo.boundingBox())!.y;
  const aguardando = main.getByRole("heading", { name: "Aguardando você" });
  const numeros = main.getByRole("region", { name: "Indicadores" });
  const atencao = main.getByRole("heading", { name: "Precisa de atenção hoje" });
  const graficos = main.getByRole("heading", { name: "Dashboard executivo" });
  expect(await topo(aguardando)).toBeLessThan(await topo(numeros));
  expect(await topo(numeros)).toBeLessThan(await topo(atencao));
  expect(await topo(atencao)).toBeLessThan(await topo(graficos));

  // cinco números, cada um com a lista que o explica
  const links = numeros.getByRole("link");
  await expect(links).toHaveCount(5);
  const nomes = await links.evaluateAll((els) => els.map((el) => (el.getAttribute("aria-label") ?? "").split(":")[0]));
  expect(nomes).toEqual(["Sem estoque", "Vencidos ou vencendo", "Repor", "Compras abertas", "Propostas com o cliente"]);
  await expect(numeros.getByRole("link", { name: /^Compras abertas: / })).toHaveAttribute("href", "/compras");
  await expect(numeros.getByRole("link", { name: /^Propostas com o cliente: / })).toHaveAttribute("href", "/orcamento/emitidos");
  // o rótulo comprido aparece inteiro, sem reticências
  const rotulo = numeros.getByText("Propostas com o cliente", { exact: true });
  expect(await rotulo.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  // a tabela tem as cinco colunas do documento
  const tabela = main.getByRole("table", { name: /Precisa de atenção hoje/ });
  await expect(tabela.getByRole("columnheader")).toHaveText(["Origem", "Item", "Situação", "Prazo", "Ação"]);
  // as listas separadas e o cartão de Notificações deram lugar à tabela
  await expect(main.getByRole("list", { name: "Precisa de atenção hoje" })).toHaveCount(0);
  await expect(main.getByRole("heading", { name: /^(Notificações|Prioridade de compra|Validade e uso|Compras em andamento)$/ })).toHaveCount(0);
  // as listas completas continuam a um clique
  await expect(main.getByRole("link", { name: "Situação do estoque", exact: true })).toHaveAttribute("href", "/estoque/situacao");
  await expect(main.getByRole("link", { name: "Notificações", exact: true })).toHaveAttribute("href", "/notificacoes");
});

test("a tabela vai do mais grave para o menos grave, mostra 10 linhas e abre o resto em Ver todos", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");
  const main = page.getByRole("main");
  const tabela = main.getByRole("table", { name: /Precisa de atenção hoje/ });
  const linhas = tabela.locator("tbody tr");
  const origens = main.getByRole("group", { name: "Filtrar por origem" });
  await expect(origens.getByRole("button")).toHaveText([/^Todas/, /^Estoque/, /^Validade/, /^Compras/, /^Avisos/]);
  const quantos = async (nome: string) =>
    Number(/(\d+)$/.exec(((await origens.getByRole("button", { name: new RegExp(`^${nome}`) }).textContent()) ?? "").trim())?.[1]);
  const total = await quantos("Todas");
  expect(total).toBeGreaterThan(0);
  // "Todas" é a soma das quatro origens: nenhuma linha fica de fora nem conta duas vezes
  expect((await quantos("Estoque")) + (await quantos("Validade")) + (await quantos("Compras")) + (await quantos("Avisos"))).toBe(total);

  await expect(linhas).toHaveCount(Math.min(total, 10));
  const ordem = async () => (await linhas.evaluateAll((els) => els.map((el) => el.getAttribute("data-gravidade") ?? ""))).map((g) => GRAVIDADE.indexOf(g));
  const emOrdem = (lista: number[]) => lista.every((valor, i) => valor >= 0 && (i === 0 || lista[i - 1] <= valor));
  expect(emOrdem(await ordem())).toBe(true);
  // cada linha tem origem, item, situação, prazo e uma ação que leva a algum lugar
  for (const linha of await linhas.all()) {
    await expect(linha.getByRole("cell")).toHaveCount(5);
    await expect(linha.getByRole("cell").nth(3)).toHaveText(/\S/);
    await expect(linha.getByRole("link")).toHaveAttribute("href", /^\/(estoque|cadastros|compras|planejamento|pedido|notificacoes|orcamento|governanca)/);
  }

  const verTodos = main.getByRole("button", { name: /^Ver todos \(\d+\)$/ });
  if (total > 10) {
    await expect(verTodos).toHaveText(`Ver todos (${total})`);
    await verTodos.click();
    await expect(linhas).toHaveCount(total);
    expect(emOrdem(await ordem())).toBe(true);
    await main.getByRole("button", { name: "Mostrar só os 10 primeiros" }).click();
    await expect(linhas).toHaveCount(10);
  } else {
    // prova negativa: com 10 linhas ou menos não há o que abrir
    await expect(verTodos).toHaveCount(0);
  }

  // filtro por origem: só as linhas daquela origem, na quantidade do botão
  for (const [nome, origem] of [["Estoque", "Estoque"], ["Validade", "Validade"], ["Compras", "Compras"], ["Avisos", "Aviso"]] as const) {
    const n = await quantos(nome);
    await origens.getByRole("button", { name: new RegExp(`^${nome}`) }).click();
    if (n === 0) {
      await expect(main.getByTestId("atencao-vazia"), nome).toHaveText(`Nada em ${nome} precisa de atenção agora.`);
      await expect(tabela, nome).toHaveCount(0);
    } else {
      await expect(linhas, nome).toHaveCount(Math.min(n, 10));
      const celulas = await linhas.locator("td:first-child").allTextContents();
      expect(new Set(celulas), nome).toEqual(new Set([origem]));
    }
  }
  await origens.getByRole("button", { name: /^Todas/ }).click();
  await expect(linhas).toHaveCount(Math.min(total, 10));
});

test("aviso não lido entra na tabela e abre a tela a que se refere; aviso lido não entra", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  // o estado dos avisos é compartilhado entre os testes: a tabela tem de bater com a tela de Notificações
  await page.goto("/notificacoes");
  const aviso = page.locator("article").filter({ hasText: "Falta de estoque no planejamento" });
  await expect(aviso).toBeVisible();
  const naoLido = (await aviso.getByRole("button", { name: "Lida" }).count()) > 0;

  await page.goto("/");
  const main = page.getByRole("main");
  await main.getByRole("group", { name: "Filtrar por origem" }).getByRole("button", { name: /^Avisos/ }).click();
  const linha = main.getByRole("table", { name: /Precisa de atenção hoje/ }).locator("tbody tr").filter({ hasText: "Falta de estoque no planejamento" });
  if (naoLido) {
    await expect(linha.getByRole("cell").first()).toHaveText("Aviso");
    await expect(linha).toContainText("Falta no plano");
    await expect(linha).toContainText("Mix PCR: falta 10 uL no planejamento #1.");
    await expect(linha.getByRole("cell").nth(3)).toHaveText(/^desde \d{2}\/\d{2}\/\d{4}$/);
    await expect(linha.getByRole("link", { name: /^Abrir o plano/ })).toHaveAttribute("href", "/planejamento/1");
  } else {
    await expect(linha).toHaveCount(0);
  }
});

test("prova negativa: sem acesso a Estoque e Compras, a tabela só traz os avisos e não há número de estoque", async ({ page }) => {
  // categoria sem nenhuma permissão no banco de teste
  await comoCategoria(page, "cadastro");
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Precisa de atenção hoje" })).toBeVisible();
  await expect(main.getByRole("region", { name: "Indicadores" })).toHaveCount(0);
  // uma origem só: não há o que filtrar
  await expect(main.getByRole("group", { name: "Filtrar por origem" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Situação do estoque", exact: true })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Compras", exact: true })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Notificações", exact: true })).toHaveAttribute("href", "/notificacoes");
  const origens = await main.locator("table tbody tr td:first-child").allTextContents();
  expect(origens.every((origem) => origem === "Aviso")).toBe(true);
  await expect(main.locator('a[href^="/estoque"], a[href^="/compras"]')).toHaveCount(0);
});

test("no celular cada item vira um cartão com as mesmas informações, e a página não rola para o lado", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");
  const main = page.getByRole("main");
  const naTabela = await main.getByRole("table", { name: /Precisa de atenção hoje/ }).locator("tbody tr").count();
  expect(naTabela).toBeGreaterThan(0);

  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
  expect(await page.locator("html").evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(375);
  // a tabela dá lugar à lista de cartões, com a mesma quantidade e a mesma ordem de gravidade
  await expect(main.getByRole("table", { name: /Precisa de atenção hoje/ })).toHaveCount(0);
  const cartoes = main.getByRole("list", { name: "Precisa de atenção hoje" }).getByRole("listitem");
  await expect(cartoes).toHaveCount(naTabela);
  const ordem = (await cartoes.evaluateAll((els) => els.map((el) => el.getAttribute("data-gravidade") ?? ""))).map((g) => GRAVIDADE.indexOf(g));
  expect(ordem.every((valor, i) => valor >= 0 && (i === 0 || ordem[i - 1] <= valor))).toBe(true);
  const primeiro = cartoes.first();
  await expect(primeiro).toContainText(/^(Estoque|Validade|Compras|Aviso)/);
  await expect(primeiro).toContainText("Prazo:");
  // o nome do item aparece inteiro, sem corte
  const nome = primeiro.locator("p").first();
  expect(await nome.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(primeiro.getByRole("link")).toBeVisible();
});
