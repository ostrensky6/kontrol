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
