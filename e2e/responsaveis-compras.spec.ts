import { expect, test } from "@playwright/test";

/**
 * 0173: o Administrador escolhe quem recebe os avisos do administrativo e do
 * pagamento. As duas linhas são fixas: a tela só edita (sem Novo nem Excluir).
 */
test("responsáveis do administrativo e do pagamento: só editar, sem responsável vai ao Administrador", async ({ page }) => {
  await page.goto("/cadastros/responsaveis");
  await expect(page.getByRole("heading", { name: "Responsáveis por etapa" })).toBeVisible();
  const administrativo = page.getByRole("row", { name: /Administrativo: autorização/ });
  await expect(administrativo).toContainText("Sem responsável: avisos vão ao Administrador");
  await expect(page.getByRole("row", { name: /Pagamento e nota fiscal/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Novo responsável/ })).toHaveCount(0);

  await administrativo.getByRole("button", { name: "Abrir ações do registro" }).click();
  await expect(page.getByRole("menuitem", { name: "Excluir" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Responsável (usuário)", { exact: true })).toBeVisible();
});
