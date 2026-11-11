import { expect, test, type Page } from "@playwright/test";

// Onda 2 da revisão de usabilidade de 11/11/2026 (estoque único e ficha do insumo).
// Cada teste cita o achado do documento que ele prova. O servidor de teste é
// compartilhado: outros testes mexem no saldo, por isso aqui os números são
// comparados entre telas, não com valores fixos.

async function comoCategoria(page: Page, papel: string) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL ausente na configuração do Playwright");
  await page.context().addCookies([{ name: "kontrol_e2e_papel", value: papel, url: baseURL }]);
}

test.afterEach(async ({ page }) => {
  await page.context().clearCookies();
});

const BLOCOS_DA_FICHA = [
  "Lotes",
  "Pedidos e compras em andamento",
  "Reservas em planos",
  "Consumo mensal",
  "Análises que usam este insumo",
  "Últimas movimentações",
];

function dataIso(texto: string) {
  const [, dia, mes, ano] = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/) ?? [];
  return ano ? `${ano}-${mes}-${dia}` : "9999-99-99";
}

test("ficha do insumo: saldo, lotes, pedidos, reservas, consumo, análises e movimentações numa página (F5)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/estoque/insumos/900");
  await expect(page.getByRole("heading", { level: 1, name: "Kit extração E2E" })).toBeVisible();

  // a ficha fica dentro do Estoque e tem caminho de volta
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Estoque" })).toHaveAttribute("href", "/estoque");
  await expect(page.getByRole("navigation", { name: "Seções do estoque" }).locator("a[aria-current]")).toHaveText(["Saldo e lotes"]);

  await expect(page.getByTestId("ficha-numeros").locator("dt")).toHaveText(["Disponível", "Reservado", "A caminho", "Mínimo"]);
  await expect(page.locator("main").getByRole("heading", { level: 2 })).toHaveText(BLOCOS_DA_FICHA);

  // lotes: cada um abre a sua página, e o que vence primeiro aparece primeiro
  const lotes = page.getByRole("region", { name: "Lotes", exact: true });
  const linhasDeLote = lotes.getByRole("row").filter({ has: page.getByRole("cell") });
  await expect(linhasDeLote.first()).toBeVisible();
  for (const link of await linhasDeLote.getByRole("link").all()) {
    await expect(link).toHaveAttribute("href", /^\/estoque\/lotes\/\d+$/);
  }
  const validades = (await linhasDeLote.locator("td:nth-child(2)").allTextContents()).map(dataIso);
  expect(validades).toEqual([...validades].sort());

  // o pedido em andamento que tem este insumo aparece com a etapa, e leva ao pedido
  const andamento = page.getByRole("region", { name: "Pedidos e compras em andamento" });
  const pedido = andamento.getByRole("row").filter({ has: page.getByRole("link", { name: /Reagente do ciclo seguinte E2E/ }) });
  await expect(pedido.getByRole("link")).toHaveAttribute("href", "/pedido/501");
  await expect(pedido).toContainText(/Ainda não comprado|A caminho/);

  // reserva: o plano que segura o material
  await expect(page.getByRole("region", { name: "Reservas em planos" })).toBeVisible();
  // consumo: a estimativa manual continua a um clique
  await expect(page.getByRole("link", { name: "Estimativa manual e histórico de revisões" })).toHaveAttribute(
    "href",
    "/estoque?consumo_insumo=900#consumo-manual",
  );
  await expect(page.getByRole("link", { name: "Abrir cadastro" })).toHaveAttribute("href", "/cadastros/insumos?focus=900");
});

test("o nome do insumo abre a ficha, com o mesmo disponível e a mesma situação da lista (F5, D1)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/suprimentos?situacao=todos");
  const linha = page.getByRole("row").filter({ has: page.getByRole("link", { name: "Kit extração E2E" }) });
  await expect(linha).toBeVisible();
  const disponivel = ((await linha.getByRole("cell").nth(1).textContent()) ?? "").match(/[\d.,]+/)?.[0];
  const situacao = ((await linha.getByRole("cell").last().locator("span").first().textContent()) ?? "").trim();
  expect(disponivel).toBeTruthy();
  expect(situacao).not.toBe("");

  await linha.getByRole("link", { name: "Kit extração E2E" }).click();
  await expect(page).toHaveURL(/\/estoque\/insumos\/900$/);
  await expect(page.getByRole("heading", { level: 1, name: "Kit extração E2E" })).toBeVisible();
  const numero = page.getByTestId("ficha-numeros").locator("dd").first();
  await expect(numero).toBeVisible();
  expect(((await numero.textContent()) ?? "").match(/[\d.,]+/)?.[0]).toBe(disponivel);
  await expect(page.getByTestId("ficha-situacao")).toContainText(situacao);
});

test("Ficha no Controle de Estoque, nome em Saldo e lotes e a página do lote levam à ficha (F5)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/estoque/controle");
  const fichas = page.getByRole("link", { name: "Ficha" });
  await expect(fichas.first()).toBeVisible();
  // antes o botão abria a lista de cadastros
  for (const link of await fichas.all()) {
    await expect(link).toHaveAttribute("href", /^\/estoque\/insumos\/\d+$/);
  }
  await fichas.first().click();
  await expect(page).toHaveURL(/\/estoque\/insumos\/\d+$/);
  await expect(page.getByTestId("ficha-numeros")).toBeVisible();

  await page.goto("/estoque");
  await expect(page.getByRole("link", { name: "Kit extração E2E" }).first()).toHaveAttribute("href", "/estoque/insumos/900");

  await page.goto("/estoque/lotes/1");
  await expect(page.getByRole("heading", { level: 1, name: /^Lote / })).toBeVisible();
  await page.getByRole("link", { name: "Kit extração E2E" }).click();
  await expect(page).toHaveURL(/\/estoque\/insumos\/900$/);
});

test("alerta de estoque do painel abre a ficha; a análise que usa o insumo aparece na ficha (F5)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/estoque/insumos/1");
  const analises = page.getByRole("region", { name: "Análises que usam este insumo" });
  await expect(analises.getByRole("link").first()).toHaveAttribute("href", /^\/analises\/.+/);

  await page.goto("/estoque/situacao");
  const semDado = page.getByRole("region", { name: "Saldo não conferido" });
  const alerta = semDado.getByRole("link").first();
  await expect(alerta).toHaveAttribute("href", /^\/estoque\/insumos\/\d+$/);
  await alerta.click();
  await expect(page).toHaveURL(/\/estoque\/insumos\/\d+$/);
  await expect(page.getByTestId("ficha-numeros")).toBeVisible();
});

test("ficha sem leitura de saldo mostra “sem dado”, nunca zero", async ({ page }) => {
  // insumo cadastrado sem linha na visão de saldo
  await page.goto("/estoque/insumos/5");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("ficha-situacao")).toHaveText("Situação: sem dado");
  const numeros = page.getByTestId("ficha-numeros").locator("dd.text-2xl");
  await expect(numeros).toHaveText(["sem dado", "sem dado", "sem dado", "sem dado"]);
  await expect(page.getByTestId("ficha-prazos")).toContainText("Prazo de compra: sem dado");
  await expect(page.getByRole("region", { name: "Consumo mensal" })).toContainText("Sem dado.");
});

test("prova negativa: endereço de ficha que não existe não mostra ficha", async ({ page }) => {
  for (const endereco of ["/estoque/insumos/999999", "/estoque/insumos/abc", "/estoque/insumos/0", "/estoque/insumos/1.5"]) {
    await page.goto(endereco);
    await expect(page.getByRole("heading", { level: 1, name: "Página não encontrada" }), endereco).toBeVisible();
    await expect(page.getByTestId("ficha-numeros")).toHaveCount(0);
  }
});

test("prova negativa: sem acesso a pedidos, compras, análises e cadastros, a ficha não mostra esses blocos", async ({ page }) => {
  // categoria sem nenhuma permissão no banco de teste
  await comoCategoria(page, "cadastro");
  await page.goto("/estoque/insumos/900");
  await expect(page.getByRole("heading", { level: 1, name: "Kit extração E2E" })).toBeVisible();
  await expect(page.getByTestId("ficha-numeros").locator("dt")).toHaveText(["Disponível", "Reservado", "A caminho", "Mínimo"]);
  await expect(page.locator("main").getByRole("heading", { level: 2 })).toHaveText([
    "Lotes",
    "Reservas em planos",
    "Consumo mensal",
    "Últimas movimentações",
  ]);
  await expect(page.getByText("Reagente do ciclo seguinte E2E")).toHaveCount(0);
  await expect(page.locator('main a[href^="/pedido/"], main a[href^="/compras/"], main a[href^="/analises/"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Abrir cadastro" })).toHaveCount(0);
  // sem acesso ao Planejamento, a reserva aparece, mas o plano não vira link
  await expect(page.locator('main a[href^="/planejamento/"]')).toHaveCount(0);

  // quem tem acesso vê os blocos todos
  await comoCategoria(page, "laboratorio");
  await page.goto("/estoque/insumos/900");
  await expect(page.locator("main").getByRole("heading", { level: 2 })).toHaveText(BLOCOS_DA_FICHA);
  await expect(page.getByRole("link", { name: /Reagente do ciclo seguinte E2E/ })).toHaveAttribute("href", "/pedido/501");
});

test("leitor: código de um insumo abre a ficha dele (F5)", async ({ page }) => {
  await page.goto("/s/insumo/900");
  await expect(page).toHaveURL(/\/estoque\/insumos\/900$/);
  await expect(page.getByRole("heading", { level: 1, name: "Kit extração E2E" })).toBeVisible();
});

// Onda 2b: painel único de situação do estoque (D1, L1, L9, D6).

const SECOES_DO_ESTOQUE = [
  "Saldo e lotes",
  "Situação",
  "Controle de Estoque",
  "Entrada e saída por leitura",
  "Inventário",
  "Etiquetas",
];

test("Situação é uma seção do Estoque e o único lugar dos alertas, do “a caminho” e da reposição (D1, L1, L9, D6)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/estoque/situacao");
  await expect(page.getByRole("heading", { level: 1, name: "Situação do estoque" })).toBeVisible();
  const secoes = page.getByRole("navigation", { name: "Seções do estoque" });
  await expect(secoes.getByRole("link")).toHaveText(SECOES_DO_ESTOQUE);
  await expect(secoes.getByRole("link", { name: "Situação" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Navegação de Suprimentos" }).getByRole("link", { name: "Estoque" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("region", { name: "Alertas do estoque" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gerar pedidos de reposição" })).toBeVisible();
  // L9: as compras a caminho ficam junto dos alertas, e não mais em Cadastros
  await expect(page.getByTestId("painel-a-caminho")).toBeVisible();

  // prova negativa: o painel, o "a caminho" e o botão de reposição não se repetem em outras telas
  await page.goto("/cadastros");
  await expect(page.getByRole("heading", { level: 1, name: "Cadastros" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Alertas do estoque" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Saldo não conferido" })).toHaveCount(0);
  await expect(page.getByTestId("painel-a-caminho")).toHaveCount(0);
  for (const tela of ["/cadastros", "/suprimentos", "/compras", "/estoque/controle", "/estoque"]) {
    await page.goto(tela);
    await expect(page.getByRole("heading", { level: 1 }), tela).toBeVisible();
    await expect(page.getByRole("button", { name: "Gerar pedidos de reposição" }), tela).toHaveCount(0);
  }
  // a visão geral de Suprimentos leva ao painel
  await page.goto("/suprimentos");
  await page.getByRole("link", { name: "Ver a situação do estoque" }).click();
  await expect(page).toHaveURL(/\/estoque\/situacao$/);
});

test("Cadastros e Início mostram a contagem do painel, com o mesmo número, e levam até ele (D1)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/estoque/situacao");
  const resumo = ((await page.getByTestId("resumo-situacao").textContent()) ?? "").trim();
  expect(resumo).toMatch(/^(\d+ urgentes? · \d+ de atenção|\d+ urgentes?|\d+ de atenção|nada urgente)$/);
  const total = [...resumo.matchAll(/(\d+)/g)].reduce((soma, [n]) => soma + Number(n), 0);

  await page.goto("/cadastros");
  const cartao = page.getByTestId("cartao-situacao-estoque");
  await expect(cartao).toContainText("Situação do estoque");
  await expect(cartao).toContainText(resumo);
  await cartao.click();
  await expect(page).toHaveURL(/\/estoque\/situacao$/);

  await page.goto("/");
  const indicadores = page.getByRole("region", { name: "Indicadores" });
  const situacao = indicadores.getByRole("link", { name: /^Situação do estoque:/ });
  await expect(situacao).toHaveAttribute("href", "/estoque/situacao");
  await expect(situacao).toContainText(String(total));
  await expect(situacao).toContainText(resumo);
  // os três números de estoque, cada um com uma regra própria, viraram um
  await expect(indicadores.getByRole("link", { name: /^(Comprar agora|Vencidos|Sem disponível):/ })).toHaveCount(0);
  // cada linha de "Precisa de atenção hoje" abre a ficha do insumo ou o lote, nunca uma lista genérica
  const linhas = page.getByRole("list", { name: "Precisa de atenção hoje" }).getByRole("link");
  if (total > 0) await expect(linhas.first()).toBeVisible();
  for (const linha of await linhas.all()) {
    await expect(linha).toHaveAttribute("href", /^\/(estoque\/insumos|estoque\/lotes|cadastros\/insumos)/);
  }
  await situacao.click();
  await expect(page).toHaveURL(/\/estoque\/situacao$/);
});

test("prova negativa: sem acesso ao Estoque e sem criar pedido, nem contagem nem botão de reposição", async ({ page }) => {
  // categoria sem nenhuma permissão no banco de teste
  await comoCategoria(page, "cadastro");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Situação do estoque:/ })).toHaveCount(0);
  await page.goto("/cadastros");
  await expect(page.getByRole("heading", { level: 1, name: "Cadastros" })).toBeVisible();
  await expect(page.getByTestId("cartao-situacao-estoque")).toHaveCount(0);
  await page.goto("/estoque/situacao");
  await expect(page.getByRole("heading", { level: 1, name: "Situação do estoque" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gerar pedidos de reposição" })).toHaveCount(0);
  // sem acesso a Compras, o "a caminho" diz isso em vez de mostrar uma lista vazia
  await expect(page.getByTestId("painel-a-caminho")).toContainText("Acessar Compras");
  await expect(page.getByTestId("painel-a-caminho").locator('a[href^="/compras/"]')).toHaveCount(0);

  // quem cria pedido vê o botão
  await comoCategoria(page, "laboratorio");
  await page.goto("/estoque/situacao");
  await expect(page.getByRole("button", { name: "Gerar pedidos de reposição" })).toBeVisible();
});
