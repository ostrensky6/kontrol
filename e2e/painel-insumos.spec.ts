import { expect, test } from "@playwright/test";

test("painel de insumos: alertas com os itens que os disparam, filtro na URL", async ({ page }) => {
  await page.goto("/cadastros");
  await expect(page.getByRole("heading", { name: "Painel de insumos", level: 1 })).toBeVisible();
  // a lista completa saiu do painel: ela fica em Cadastros → Insumos
  await expect(page.getByRole("link", { name: "Cadastros → Insumos" })).toHaveAttribute("href", "/cadastros/insumos");
  // importar e baixar a planilha ficam no topo, ao lado de "Cadastrar insumo"
  await expect(page.getByText("Importar XLSX")).toBeVisible();
  await expect(page.getByRole("button", { name: "Baixar XLSX" })).toBeVisible();

  // no mock, os insumos não têm ponto de reposição: o alerta lista quais são
  const semMinimo = page.getByRole("region", { name: "Sem mínimo definido" });
  await expect(semMinimo).toBeVisible();
  await expect(semMinimo.getByRole("link").first()).toHaveAttribute("href", /\/cadastros\/insumos\?focus=\d+/);
  await semMinimo.getByRole("button", { name: /Ver todos/ }).click();
  await expect(semMinimo.getByRole("button", { name: "Mostrar menos" })).toBeVisible();

  // alerta sem itens aparece como "sem alerta agora"
  await expect(page.getByRole("region", { name: "Sem alerta agora" })).toContainText("Aberto fora da ordem de validade");

  await page.getByLabel("Categoria de compra").selectOption({ index: 1 });
  await expect(page).toHaveURL(/compra=/);
  await page.reload();
  await expect(page.getByLabel("Categoria de compra")).not.toHaveValue("");
});
