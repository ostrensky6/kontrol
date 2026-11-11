import { expect, test, type Page } from "@playwright/test";

// Organização do app de 11/11/2026, etapa 3: o que era processo e tinha saído
// voltou. O Controle de Estoque fica dentro de Estoque → Situação, em três
// visões (por insumo, por lote e gráficos), com os números do estoque no topo.
// O servidor de teste é compartilhado: outros testes mexem no saldo e nos
// avisos, por isso os números são comparados entre si, não com valores fixos.

async function comoCategoria(page: Page, papel: string) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL ausente na configuração do Playwright");
  await page.context().addCookies([{ name: "kontrol_e2e_papel", value: papel, url: baseURL }]);
}

test.afterEach(async ({ page }) => {
  await page.context().clearCookies();
});

const NUMEROS = [
  ["Sem estoque", "sem_disponivel"],
  ["Repor", "reposicao"],
  ["Vencidos ou vencendo", "vencido_vencendo"],
  ["Compra atrasada", "compra_atrasada"],
] as const;

const GRAFICOS = [
  "Cobertura estimada do estoque",
  "Situação por categoria curta",
  "Onde está o valor em estoque",
  "Entradas e saídas por mês",
  "Insumos por situação",
  "Notas de controle",
];

/** O número de um cartão, lido do nome dele ("Sem estoque: 2. …"). */
async function numeroDoCartao(page: Page, rotulo: string) {
  const cartao = page.getByRole("region", { name: "Números do estoque" }).getByRole("link", { name: new RegExp(`^${rotulo}: \\d+\\.`) });
  const nome = (await cartao.getAttribute("aria-label")) ?? "";
  return Number(/: (\d+)\./.exec(nome)?.[1]);
}

test("Situação do estoque tem três visões: por insumo, por lote e gráficos", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/estoque/situacao");
  const visoes = page.getByRole("navigation", { name: "Como ver a situação do estoque" });
  await expect(visoes.getByRole("link")).toHaveText([/^Por insumo/, /^Por lote/, /^Gráficos/]);
  await expect(visoes.locator('a[aria-current="page"]')).toHaveText(/^Por insumo/);

  // por insumo: os quadros de alerta, a lista para tratar e o que está a caminho; sem gráfico
  await expect(page.getByRole("region", { name: "Números do estoque" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Alertas do estoque" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tratar por insumo" })).toBeVisible();
  await expect(page.getByTestId("painel-a-caminho")).toBeVisible();
  await expect(page.locator("main").getByRole("application")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Lotes que pedem atenção" })).toHaveCount(0);

  // por lote: só os lotes, com filtro pela validade e as ações de cada lote
  await visoes.getByRole("link", { name: /^Por lote/ }).click();
  await expect(page).toHaveURL(/\/estoque\/situacao\?ver=lote$/);
  await expect(visoes.locator('a[aria-current="page"]')).toHaveText(/^Por lote/);
  const lotes = page.getByRole("region", { name: "Lotes que pedem atenção" });
  const filtroLotes = lotes.getByRole("group", { name: "Filtrar lotes pela validade" });
  await expect(filtroLotes.getByRole("button")).toHaveText([/^Precisa de atenção/, /^Vencido/, /^Vence em breve/, /^Sem validade/, /^Todos/]);
  await expect(filtroLotes.getByRole("button", { name: /^Precisa de atenção/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Números do estoque" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tratar por insumo" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Alertas do estoque" })).toHaveCount(0);
  // a contagem de cada botão é a quantidade de linhas que ele mostra
  const todos = filtroLotes.getByRole("button", { name: /^Todos/ });
  const quantos = Number(/(\d+)$/.exec(((await todos.textContent()) ?? "").trim())?.[1]);
  expect(quantos).toBeGreaterThan(0);
  await todos.click();
  await expect(lotes.locator("tbody tr")).toHaveCount(quantos);
  const loteA = lotes.getByRole("row").filter({ hasText: "EMB-E2E-A" });
  await expect(loteA.getByRole("link", { name: "EMB-E2E-A" })).toHaveAttribute("href", "/estoque/lotes/1");
  await expect(loteA.getByRole("button", { name: "Mais ações do lote EMB-E2E-A" })).toBeVisible();
  // prova negativa: lote em dia não entra em "Vencido"
  await filtroLotes.getByRole("button", { name: /^Vencido/ }).click();
  await expect(lotes.getByRole("row").filter({ hasText: "EMB-E2E-A" })).toHaveCount(0);

  // gráficos: os quatro gráficos do painel, insumos por situação, notas de controle e a saúde
  await visoes.getByRole("link", { name: /^Gráficos/ }).click();
  await expect(page).toHaveURL(/\/estoque\/situacao\?ver=graficos$/);
  const main = page.locator("main");
  for (const titulo of GRAFICOS) {
    await expect(main.getByRole("heading", { level: 3, name: titulo, exact: true }), titulo).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Números do estoque" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tratar por insumo" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Sem mínimo definido" })).toHaveCount(0);
  await expect(page.getByTestId("painel-a-caminho")).toHaveCount(0);

  // prova negativa: visão que não existe abre a visão por insumo
  await page.goto("/estoque/situacao?ver=inventada");
  await expect(visoes.locator('a[aria-current="page"]')).toHaveText(/^Por insumo/);
  await expect(page.getByRole("region", { name: "Tratar por insumo" })).toBeVisible();
});

test("os números do estoque abrem a lista filtrada, e a saúde é a conta dos insumos em dia", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/estoque/situacao");
  const numeros = page.getByRole("region", { name: "Números do estoque" });
  await expect(numeros.getByRole("link")).toHaveCount(NUMEROS.length);
  const lista = page.getByRole("region", { name: "Tratar por insumo" });

  for (const [rotulo, filtro] of NUMEROS) {
    const valor = await numeroDoCartao(page, rotulo);
    expect(Number.isInteger(valor), rotulo).toBe(true);
    const cartao = numeros.getByRole("link", { name: new RegExp(`^${rotulo}: `) });
    await expect(cartao, rotulo).toHaveAttribute("href", `/estoque/situacao?alerta=${filtro}#controle-por-insumo`);
    // o número é a quantidade de insumos que a lista mostra com aquele filtro
    await page.goto(`/estoque/situacao?alerta=${filtro}`);
    await expect(lista.getByLabel("Situação"), rotulo).toHaveValue(filtro);
    await expect(lista.getByTestId("controle-contagem"), rotulo).toHaveText(new RegExp(`^${valor} de \\d+ insumos$`));
    if (valor === 0) await expect(lista.getByText("Nenhum insumo com estes filtros."), rotulo).toBeVisible();
  }

  // quem está sem estoque aparece com o selo "Sem estoque"; nenhum outro entra na lista
  await page.goto("/estoque/situacao");
  await numeros.getByRole("link", { name: /^Sem estoque: / }).click();
  await expect(page).toHaveURL(/\/estoque\/situacao\?alerta=sem_disponivel#controle-por-insumo$/);
  const cartoes = lista.getByRole("list", { name: "Insumos" }).getByRole("article");
  for (const cartao of await cartoes.all()) {
    await expect(cartao.getByText("Sem estoque", { exact: true })).toBeVisible();
  }

  // saúde = insumos sem nenhum sinal sobre o total, e bate com a lista "Em dia"
  const saude = ((await page.getByTestId("saude-do-estoque").textContent()) ?? "").replace(/\s+/g, " ");
  const [, pct] = /(\d+)%/.exec(saude) ?? [];
  const [, emDia, total] = /(\d+) de (\d+) insumos em dia/.exec(saude) ?? [];
  expect(Number(total)).toBeGreaterThan(0);
  expect(Number(pct)).toBe(Math.round((Number(emDia) / Number(total)) * 100));
  await lista.getByLabel("Situação").selectOption("ok");
  await expect(page).toHaveURL(/alerta=ok/);
  await expect(lista.getByTestId("controle-contagem")).toHaveText(`${emDia} de ${total} insumos`);
  // a taxa da visão em gráficos é a mesma do topo, e as barras somam o total de insumos
  await page.goto("/estoque/situacao?ver=graficos");
  const taxa = page.getByTestId("taxa-de-saude");
  await expect(taxa.getByRole("progressbar", { name: "Saúde do estoque" })).toHaveAttribute("aria-valuenow", String(pct));
  await expect(taxa).toContainText(`${emDia} de ${total} insumos ativos sem nenhum sinal.`);
  const barras = page.getByRole("table", { name: "Insumos por situação" }).locator("tbody td");
  const soma = (await barras.allTextContents()).reduce((s, texto) => s + Number(texto.replace(/\D/g, "")), 0);
  expect(soma).toBe(Number(total));

  // prova negativa: filtro que não existe na URL abre em "Precisa de atenção"
  await page.goto("/estoque/situacao?alerta=inventado");
  await expect(lista.getByLabel("Situação")).toHaveValue("atencao");
});

test("tratar por insumo: situação, criticidade e avisos filtram; o aviso é tratado no próprio insumo", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/estoque/situacao?alerta=todos");
  const lista = page.getByRole("region", { name: "Tratar por insumo" });
  const contagem = lista.getByTestId("controle-contagem");
  const [, total] = /^(\d+) de \d+ insumos$/.exec(((await contagem.textContent()) ?? "").trim()) ?? [];
  expect(Number(total)).toBeGreaterThan(1);
  await expect(contagem).toHaveText(`${total} de ${total} insumos`);

  // criticidade: as três categorias de compra do cadastro
  await expect(lista.getByLabel("Criticidade").locator("option")).toHaveText(["Todas", "Crítico", "Operacional", "Eventual"]);
  await expect(lista.getByLabel("Avisos do sistema").locator("option")).toHaveText([
    "Todos",
    "Com aviso pendente",
    "Com avisos tratados",
    "Sem aviso",
  ]);

  // busca pelo nome; o insumo traz o aviso que o sistema gerou para ele
  await lista.getByLabel("Buscar insumo").fill("mix pcr");
  await expect(contagem).toHaveText(`1 de ${total} insumos`);
  const mix = lista.getByRole("article", { name: "Mix PCR" });
  await expect(mix.getByRole("link", { name: "Abrir a ficha" })).toHaveAttribute("href", /^\/estoque\/insumos\/\d+$/);
  const avisos = mix.getByRole("list", { name: "Avisos de Mix PCR" });
  await expect(avisos).toContainText("Falta de estoque no planejamento");
  await expect(avisos.getByRole("button", { name: "Arquivar" })).toBeEnabled();

  // "Tratar alerta" marca o aviso como tratado (outro teste pode já ter marcado: o estado é compartilhado)
  const tratar = avisos.getByRole("button", { name: "Tratar alerta" });
  if ((await tratar.count()) > 0) {
    await expect(avisos.getByText("Pendente", { exact: true })).toBeVisible();
    await tratar.click();
  }
  await expect(avisos.getByText("Tratado", { exact: true })).toBeVisible();
  await expect(avisos.getByRole("button", { name: "Tratar alerta" })).toHaveCount(0);
  await expect(avisos.getByText("Pendente", { exact: true })).toHaveCount(0);

  // o filtro de avisos separa tratado, pendente e sem aviso: cada insumo em um só
  await lista.getByLabel("Avisos do sistema").selectOption("tratados");
  await expect(lista.getByRole("article", { name: "Mix PCR" })).toBeVisible();
  await lista.getByLabel("Avisos do sistema").selectOption("pendentes");
  await expect(lista.getByRole("article", { name: "Mix PCR" })).toHaveCount(0);
  await lista.getByLabel("Avisos do sistema").selectOption("sem_aviso");
  await expect(lista.getByRole("article", { name: "Mix PCR" })).toHaveCount(0);
  await lista.getByLabel("Buscar insumo").fill("kit extração");
  const kit = lista.getByRole("article", { name: "Kit extração E2E" });
  await expect(kit).toContainText("Sem aviso do sistema para este insumo.");
  // quem dá baixa faz isso do próprio insumo
  await expect(kit.getByRole("button", { name: "Dar baixa" })).toBeVisible();
  // prova negativa: insumo sem aviso não aparece como tratado
  await lista.getByLabel("Avisos do sistema").selectOption("tratados");
  await expect(lista.getByRole("article", { name: "Kit extração E2E" })).toHaveCount(0);

  // "Limpar filtros da lista" volta ao padrão: precisa de atenção, sem busca
  await lista.getByRole("button", { name: "Limpar filtros da lista" }).click();
  await expect(lista.getByLabel("Situação")).toHaveValue("atencao");
  await expect(lista.getByLabel("Buscar insumo")).toHaveValue("");
  await expect(lista.getByLabel("Avisos do sistema")).toHaveValue("todos");
  await expect(page).not.toHaveURL(/alerta=/);
  await expect(lista.getByRole("button", { name: "Limpar filtros da lista" })).toHaveCount(0);
});

test("prova negativa: sem movimentar estoque e sem criar pedido, a lista não oferece baixa nem pedido", async ({ page }) => {
  // categoria sem nenhuma permissão no banco de teste
  await comoCategoria(page, "cadastro");
  await page.goto("/estoque/situacao?alerta=todos");
  const lista = page.getByRole("region", { name: "Tratar por insumo" });
  await expect(lista.getByRole("article").first()).toBeVisible();
  await expect(lista.getByRole("link", { name: "Abrir a ficha" }).first()).toBeVisible();
  await expect(lista.getByRole("button", { name: "Dar baixa" })).toHaveCount(0);
  await expect(lista.getByRole("button", { name: /Pedir reposição|Gerar pedido/ })).toHaveCount(0);
  await page.goto("/estoque/situacao?ver=lote");
  const lotes = page.getByRole("region", { name: "Lotes que pedem atenção" });
  await lotes.getByRole("group", { name: "Filtrar lotes pela validade" }).getByRole("button", { name: /^Todos/ }).click();
  await expect(lotes.locator("tbody tr").first()).toBeVisible();
  await expect(lotes.getByRole("button", { name: "Dar baixa" })).toHaveCount(0);

  // quem movimenta o estoque vê a baixa nos dois lugares
  await comoCategoria(page, "laboratorio");
  await page.goto("/estoque/situacao?ver=lote");
  await lotes.getByRole("group", { name: "Filtrar lotes pela validade" }).getByRole("button", { name: /^Todos/ }).click();
  await expect(lotes.getByRole("button", { name: "Dar baixa" }).first()).toBeVisible();
});

test("as três visões cabem no celular, sem rolagem para o lado", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const endereco of ["/estoque/situacao?alerta=todos", "/estoque/situacao?ver=lote", "/estoque/situacao?ver=graficos", "/pedido", "/"]) {
    await page.goto(endereco);
    await expect(page.getByRole("heading", { level: 1 }), endereco).toBeVisible();
    expect(await page.locator("html").evaluate((el) => el.scrollWidth), endereco).toBeLessThanOrEqual(375);
  }
});
