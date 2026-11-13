import { expect, test } from "@playwright/test";

// 0180 (13/11/2026): função Administrativo, troca de função direto na lista e
// lixeira que remove quem saiu da equipe guardando o histórico.

test("troca a função na lista e remove o usuário guardando o histórico", async ({ page }) => {
  const email = `adm.${Date.now()}@example.com`;
  await page.goto("/usuarios");
  await page.getByRole("button", { name: "Novo usuário" }).click();
  await page.locator("#novo-usuario-nome").fill("Pessoa Lab E2E");
  await page.locator("#novo-usuario-email").fill(email);
  await expect(page.locator("#novo-usuario-papel option", { hasText: "Administrativo" })).toHaveCount(1);
  await page.getByRole("button", { name: "Cadastrar usuário" }).click();
  await expect(page.getByText(/senha provisória/i).first()).toBeVisible();

  await page.goto("/usuarios");
  const funcao = page.getByRole("combobox", { name: "Função de Pessoa Lab E2E" });
  await expect(funcao).toHaveValue("laboratorio");
  await funcao.selectOption("administrativo");
  const trocar = page.getByRole("dialog", { name: "Trocar a função" });
  await expect(trocar).toContainText("Laboratório");
  await trocar.getByRole("button", { name: "Passar para Administrativo" }).click();
  await expect(page.getByText("Pessoa Lab E2E agora é Administrativo.")).toBeVisible();
  await expect(funcao).toHaveValue("administrativo");

  // o próprio Administrador não tem lixeira
  await expect(page.getByRole("button", { name: "Remover Admin E2E" })).toHaveCount(0);

  await page.getByRole("button", { name: "Remover Pessoa Lab E2E" }).click();
  const remover = page.getByRole("dialog", { name: "Remover usuário" });
  await expect(remover).toContainText("continuam com o nome dele");
  await remover.getByRole("button", { name: "Remover", exact: true }).click();
  await expect(page.getByText(/Pessoa Lab E2E foi removido/)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Função de Pessoa Lab E2E" })).toHaveCount(0);

  await page.getByRole("link", { name: /Mostrar removidos/ }).click();
  await expect(page).toHaveURL(/removidos=1/);
  const linha = page.getByRole("row", { name: /Pessoa Lab E2E/ });
  await expect(linha.getByText("Removido")).toBeVisible();
});
