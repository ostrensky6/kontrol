import { expect, test } from "@playwright/test";

// Acabamentos da auditoria de 27/09/2026: rótulos, avisos lidos pelo leitor de
// tela e filtros que sobrevivem ao recarregar.

test("busca da tabela tem nome acessível e sobrevive ao recarregar", async ({ page }) => {
  await page.goto("/orcamento/demandas");
  const busca = page.getByRole("searchbox", { name: "Buscar orçamento, cliente ou projeto" });
  await expect(busca).toBeVisible();

  await busca.fill("Demo");
  const contagem = page.getByRole("status").filter({ hasText: / de \d+/ });
  await expect(contagem).toBeVisible();

  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Buscar orçamento, cliente ou projeto" })).toHaveValue("Demo");
  await expect(page.getByRole("status").filter({ hasText: / de \d+/ })).toBeVisible();

  // limpar a busca também é lembrado
  await page.getByRole("searchbox", { name: "Buscar orçamento, cliente ou projeto" }).fill("");
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Buscar orçamento, cliente ou projeto" })).toHaveValue("");
});
