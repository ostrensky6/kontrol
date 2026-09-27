import { expect, test } from "@playwright/test";

test("ciclo de estoque: receber lote (entra disponível), ajustar consumo e bloquear", async ({ page }) => {
  const loteCodigo = `LOTE-E2E-${Date.now()}`;

  await page.goto("/estoque");

  await page.getByRole("button", { name: "+ Entrada" }).first().click();
  await expect(page.getByRole("heading", { name: "Entrada de inventário" })).toBeVisible();
  await page.locator('input[name="quantidade"]').fill("25");
  await page.locator('input[name="validade"]').fill("2026-12-31");
  await page.locator('input[name="codigo"]').fill(loteCodigo);
  await page.locator('input[name="fornecedor"]').fill("Fornecedor E2E");
  await page.locator('input[name="motivo"]').fill("Entrada E2E");
  await page.getByRole("button", { name: "Registrar entrada" }).click();

  const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: loteCodigo }) });
  await expect(row).toBeVisible();
  // 0130: sem quarentena nem aceite; o lote já entra disponível.
  await expect(row.getByText("Disponível")).toBeVisible();
  await expect(row.getByRole("button", { name: "Aceitar" })).toHaveCount(0);

  await row.getByRole("button", { name: "Baixa" }).click();
  const baixa = page.getByRole("dialog");
  await expect(baixa.getByRole("heading", { name: "Dar baixa" })).toBeVisible();
  await baixa.getByLabel(/Quantidade a baixar/).fill("5");
  await baixa.getByLabel("Motivo").selectOption("Consumo em análise");
  await baixa.locator("textarea").fill("Consumo extra E2E");
  await page.getByRole("button", { name: "Registrar baixa" }).click();
  await expect(row.getByText("Em uso")).toBeVisible();
  await expect(row.getByText("20 uL")).toBeVisible();

  await row.getByRole("button", { name: "Ajustar" }).click();
  await expect(page.getByRole("heading", { name: "Ajustar saldo" })).toBeVisible();
  await page.locator('input[type="number"]').fill("18");
  await page.locator("textarea").fill("Contagem E2E");
  await page.getByRole("button", { name: "Ajustar saldo" }).click();
  await expect(row.getByText("18 uL")).toBeVisible();

  await row.getByRole("button", { name: "Bloquear" }).click();
  await page.locator("textarea").fill("Nao conformidade E2E");
  await page.getByRole("button", { name: "Bloquear" }).last().click();
  await expect(row.getByText("Bloqueado")).toBeVisible();
});

test("notificacoes de suprimentos podem ser tratadas", async ({ page }) => {
  await page.goto("/notificacoes");

  await expect(page.getByRole("heading", { name: "Notificações" })).toBeVisible();
  const row = page.locator("article").filter({ hasText: "Falta de estoque no planejamento" });
  await expect(row).toBeVisible();

  const marcarLida = row.getByRole("button", { name: "Lida" });
  if ((await marcarLida.count()) > 0) {
    await marcarLida.click();
  }
  await expect(row.getByText("lida", { exact: true })).toBeVisible();
});
