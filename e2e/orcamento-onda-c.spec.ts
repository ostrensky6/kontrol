import { expect, test, type Page } from "@playwright/test";

// Onda C do módulo Orçamentos: lista com funil que filtra, histórico enxuto e
// catálogo de análises que cabe no celular.

async function semRolagemLateral(page: Page) {
  const larguras = await page.evaluate(() => ({
    documento: document.documentElement.scrollWidth,
    janela: window.innerWidth,
  }));
  expect(larguras.documento, "a página não pode rolar para o lado").toBeLessThanOrEqual(larguras.janela);
}

/** O bloco inteiro cabe na tela: nem a página nem ele rolam para o lado. */
async function cabeNaTela(page: Page, seletor: string) {
  const medidas = await page.locator(seletor).first().evaluate((el) => ({
    largura: Math.ceil(el.getBoundingClientRect().width),
    conteudo: el.scrollWidth,
    janela: window.innerWidth,
  }));
  expect(medidas.largura, `${seletor} mais largo que a tela`).toBeLessThanOrEqual(medidas.janela);
  expect(medidas.conteudo, `${seletor} rola para o lado por dentro`).toBeLessThanOrEqual(medidas.largura + 1);
}

test("funil da lista filtra os orçamentos e soma as linhas", async ({ page }) => {
  await page.goto("/orcamento/demandas");
  await expect(page.getByRole("link", { name: "Novo orçamento" }).first()).toBeVisible();

  const fases = page.getByRole("navigation", { name: "Fases dos orçamentos" });
  const todos = fases.getByRole("link", { name: /^Todos/ });
  await expect(todos).toHaveAttribute("aria-current", "true");
  const total = Number((await todos.innerText()).replace(/\D/g, ""));

  // soma das fases = total da lista
  let soma = 0;
  for (const link of await fases.getByRole("link").all()) {
    const texto = await link.innerText();
    if (!/^Todos/.test(texto)) soma += Number(texto.replace(/\D/g, ""));
  }
  expect(soma).toBe(total);

  const elaboracao = fases.getByRole("link", { name: /^Em elaboração/ });
  const naFase = Number((await elaboracao.innerText()).replace(/\D/g, ""));
  await elaboracao.click();
  await expect(page).toHaveURL(/fase=em_elaboracao/);
  await expect(fases.getByRole("link", { name: /^Em elaboração/ })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("status").filter({ hasText: /registro\(s\)| de / }).first()).toContainText(String(naFase));
});

test("histórico mostra o essencial e o detalhe sob demanda, sem rolar para o lado no celular", async ({ page }) => {
  // garante uma versão emitida no banco simulado
  await page.goto("/orcamento/demandas/1?etapa=final");
  await page.getByRole("button", { name: "Emitir versão final" }).click();
  await page.getByRole("dialog", { name: "Emitir versão final?" }).getByRole("button", { name: "Emitir", exact: true }).click();
  await expect(page.getByRole("link", { name: /Abrir versão emitida/ })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/orcamento/historico");
  const versoes = page.getByRole("region", { name: "Versões emitidas" });
  await expect(versoes.getByRole("listitem").first()).toBeVisible();
  await semRolagemLateral(page);
  await cabeNaTela(page, 'section[aria-label="Versões emitidas"]');

  const detalhes = versoes.getByText("Ver detalhes").first();
  await expect(versoes.getByText("Margem/lucro").first()).toBeHidden();
  await detalhes.click();
  await expect(versoes.getByText("Margem/lucro").first()).toBeVisible();
  await semRolagemLateral(page);
  await cabeNaTela(page, 'section[aria-label="Versões emitidas"]');
});

test("catálogo de análises do orçamento cabe no celular", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/orcamento/2");
  await expect(page.getByRole("heading", { name: "Catálogo de análises laboratoriais" })).toBeVisible();
  await semRolagemLateral(page);
  await cabeNaTela(page, "#identificacao-tecnica table");
});
