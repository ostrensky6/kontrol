import { expect, test } from "@playwright/test";

// Rodada 5 de layout e usabilidade (25/11/2026): análises e custeio falam o
// nome que a equipe usa, com o código do sistema ao lado.

test("custeio mostra o nome da análise, com o código embaixo, e leva à ficha", async ({ page }) => {
  await page.goto("/custeio");
  const tabela = page.getByRole("table").first();
  const link = tabela.getByRole("link", { name: "Eletroforese hemolinfa" });
  await expect(link).toHaveAttribute("href", "/analises/Eletrof_vir_hem");
  await expect(tabela.getByText("Eletrof_vir_hem", { exact: true })).toBeVisible();
  // a busca acha pelo nome
  await page.getByPlaceholder("Buscar análise...").fill("hemolinfa");
  await expect(tabela.getByRole("link", { name: "Eletroforese tecido" })).toHaveCount(0);
  await expect(tabela.getByRole("link", { name: "RT-qPCR virus hemolinfa" })).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/analises\/Eletrof_vir_hem$/);
});

test("gráfico do custeio tem poucas marcas redondas no eixo das amostras", async ({ page }) => {
  await page.goto("/custeio");
  const eixoX = page.locator(".recharts-xAxis-tick-labels text");
  await expect(eixoX.first()).toBeVisible();
  const marcas = await eixoX.allTextContents();
  expect(marcas.length).toBeLessThanOrEqual(12);
  expect(marcas).toContain("96");
  // as análises do gráfico aparecem pelo nome
  await expect(page.getByRole("checkbox", { name: "Eletroforese hemolinfa" })).toBeChecked();
  await expect(page.getByRole("combobox", { name: "Análise" })).toContainText("Eletroforese hemolinfa (Eletrof_vir_hem)");
});

test("ficha da análise tem o nome como título e não repete números", async ({ page }) => {
  await page.goto("/analises/Eletrof_vir_hem");
  await expect(page.getByRole("heading", { level: 1, name: "Eletroforese hemolinfa" })).toBeVisible();
  await expect(page.getByText("Eletrof_vir_hem", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: /trilha|breadcrumb/i }).getByText("Eletroforese hemolinfa")).toBeVisible();
  // Preço, Insumos e Equip. ficam só nos números do alto
  await expect(page.getByText("Preço atual", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Custo total", { exact: true })).toBeVisible();
});

test("lista de análises usa avisos em frase simples e diz quando não há alerta", async ({ page }) => {
  await page.goto("/analises");
  const tabela = page.getByRole("table");
  await expect(tabela.getByText("status textual")).toHaveCount(0);
  await expect(tabela.getByText("status diz que está em revisão")).toBeVisible();
  await expect(tabela.getByText("Sem alertas").first()).toBeVisible();
});

test("insumos por análise escolhe a análise pelo nome e liga à ficha", async ({ page }) => {
  await page.goto("/insumos");
  const escolha = page.getByRole("navigation", { name: "Escolher a análise" });
  await expect(escolha.getByRole("link", { name: "Eletroforese hemolinfa" })).toHaveAttribute("aria-current", "page");
  await escolha.getByRole("link", { name: "Sanger" }).click();
  await expect(page).toHaveURL(/analise=Sanger$/);
  await expect(page.getByRole("link", { name: "Sanger" }).last()).toHaveAttribute("href", "/analises/Sanger");
  // a cobrança aparece uma vez só, no seletor da linha
  await expect(page.getByRole("columnheader", { name: "Grupo e cobrança" })).toBeVisible();
});
