import { expect, test } from "@playwright/test";

/**
 * 12/11/2026: em Laboratórios e áreas, quem não é Administrador só via os
 * campos travados e achava que era defeito. A tela diz o motivo e a quem pedir.
 */
test.afterEach(async ({ page }) => {
  await page.context().clearCookies();
});

test("Laboratórios e áreas: quem não é Administrador vê por que é só consulta", async ({ page }) => {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL ausente na configuração do Playwright");
  await page.context().addCookies([{ name: "kontrol_e2e_papel", value: "gestor", url: baseURL }]);
  await page.goto("/cadastros/coordenacoes");
  await expect(page.getByTestId("motivo-somente-consulta")).toHaveText(
    "Somente consulta: só o Administrador define quem coordena e aprova cada laboratório ou área. Peça a ele para indicar a coordenação.",
  );
  await expect(page.getByRole("button", { name: "Abrir ações do registro" })).toHaveCount(0);
});

test("Laboratórios e áreas: o Administrador edita e não vê o aviso", async ({ page }) => {
  await page.goto("/cadastros/coordenacoes");
  await expect(page.getByTestId("motivo-somente-consulta")).toHaveCount(0);
  await expect(page.getByRole("row", { name: /LQA/ }).getByRole("button", { name: "Abrir ações do registro" })).toBeVisible();
});
