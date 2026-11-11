import { expect, test } from "@playwright/test";

async function alternarTema(page: import("@playwright/test").Page, tema: "light" | "dark") {
  await page.evaluate((nextTheme) => {
    window.localStorage.setItem("theme", nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
  }, tema);
}

test("shell modular preserva sidebar, top-nav, collapse e temas nas telas principais", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kontrol App" })).toBeVisible();

  await page.getByRole("button", { name: "Colapsar menu" }).click();
  await expect(page.getByRole("navigation", { name: "Navegação compacta" })).toBeVisible();
  await page.getByRole("button", { name: "Expandir menu" }).click();
  await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();

  for (const tema of ["light", "dark"] as const) {
    await alternarTema(page, tema);
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(tema === "dark" ? /dark/ : /^(?!.*dark).*$/);
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();

    await page.goto("/orcamento/demandas");
    await expect(page.getByRole("navigation", { name: "Navegação de Orçamentos" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Demandas|Propostas|Orçamentos/i })).toBeVisible();

    await page.goto("/pedido");
    await expect(page.getByRole("navigation", { name: "Navegação de Suprimentos" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Pedidos" })).toBeVisible();
  }
});

test("drawer mobile abre navegação modular sem perder ações do shell", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/orcamento/demandas");

  // busca, sino e ajuda ficam na barra do logotipo, à mão sem abrir o menu (revisão de 11/11)
  await expect(page.getByRole("button", { name: "Buscar ou executar ação" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Avisos: / })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajuda contextual" })).toBeVisible();

  await page.getByRole("button", { name: "Abrir menu" }).click();
  await expect(page.getByRole("heading", { name: "Menu de navegação" })).toBeAttached();
  await expect(page.getByRole("button", { name: "Alternar tema claro/escuro" })).toBeVisible();
  await page.getByRole("link", { name: "Suprimentos" }).click();
  await expect(page).toHaveURL(/\/suprimentos$/);
});
