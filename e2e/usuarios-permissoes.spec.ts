import { expect, test } from "@playwright/test";

async function abrirEdicao(page: import("@playwright/test").Page) {
  await page.goto("/usuarios");
  await page.getByRole("button", { name: "Ações de Admin E2E" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  return page.getByRole("dialog", { name: "Editar usuário" });
}

test("edição de usuário agrupa permissões e mantém ações acessíveis", async ({ page }) => {
  const dialog = await abrirEdicao(page);

  await expect(dialog.getByLabel("Nome")).toHaveValue("Admin E2E");
  await expect(dialog.getByLabel("Categoria")).toHaveValue("admin");
  // 38 desde a 0137 ("Valores de pessoal no orçamento").
  await expect(dialog.locator('input[name="permissoes"]')).toHaveCount(38);
  await expect(dialog.locator("details")).toHaveCount(5); // Cadastros, Operação, Suprimentos, Orçamentos, Governança
  await expect(dialog.getByRole("button", { name: "Salvar" })).toBeVisible();

  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.height).toBeLessThanOrEqual(viewport!.height);
  expect(box!.y).toBeGreaterThanOrEqual(0);
});

test.use({ viewport: { width: 320, height: 640 } });

test("edição de usuário cabe no mobile sem perder nome, grupos ou salvar", async ({ page }) => {
  const dialog = await abrirEdicao(page);
  const box = await dialog.boundingBox();

  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.width).toBeLessThanOrEqual(320);
  expect(box!.height).toBeLessThanOrEqual(640);
  await expect(dialog.getByLabel("Nome")).toBeVisible();
  await expect(dialog.locator("summary").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Salvar" })).toBeVisible();
});
