import { expect, test } from "@playwright/test";
import { ADMIN, COMPRA, clienteDoUsuario, entrar, entrarComo } from "./apoio";

test("sem sessão, qualquer área manda para o login", async ({ page }) => {
  await page.goto("/estoque");
  await expect(page).toHaveURL(/\/login/);
});

test("senha errada mostra erro e não entra", async ({ page }) => {
  await entrar(page, ADMIN, "senha-errada-de-proposito");
  await expect(page.getByRole("alert").filter({ hasText: "E-mail ou senha inválidos." })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("administrador entra, abre as áreas principais e sai", async ({ page }) => {
  await entrarComo(page, ADMIN);
  for (const rota of ["/", "/cadastros", "/cadastros/insumos", "/estoque", "/compras", "/orcamento", "/auditoria", "/usuarios"]) {
    const resposta = await page.goto(rota);
    expect(resposta?.status(), rota).toBeLessThan(400);
    await expect(page, rota).not.toHaveURL(/\/(login|sem-acesso)/);
    await expect(page.getByText(/Application error|Algo deu errado/i), rota).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Sair" }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/login/);
});

test("função Compra não abre a Auditoria (a caixinha vale no servidor)", async ({ page }) => {
  await entrarComo(page, COMPRA);
  await page.goto("/auditoria");
  await expect(page).toHaveURL(/\/sem-acesso/);
  await expect(page.getByRole("heading", { name: "Sem acesso" })).toBeVisible();
});

test("função Compra não grava insumo direto no banco (RLS)", async () => {
  const cliente = await clienteDoUsuario(COMPRA);
  const { data, error } = await cliente
    .from("insumos")
    .insert({ especificacao: `Forjado E2E ${Date.now()}`, unidade: "un" })
    .select("id");
  // Ou o RLS recusa com erro, ou não devolve linha nenhuma: nunca grava.
  expect(error !== null || (data ?? []).length === 0).toBe(true);
});
