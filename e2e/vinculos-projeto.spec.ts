import { expect, test } from "@playwright/test";

test("projeto: Admin liga e desliga o Coordenador do projeto", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (erro) => erros.push(erro.message));
  await page.goto("/projetos/1");
  const secao = page.getByRole("region", { name: "Quem atua neste projeto" });
  await expect(secao).toBeVisible();
  await expect(secao.getByText("Coordenação E2E")).toBeVisible();
  await secao.getByRole("button", { name: "Ligar Coordenação E2E" }).click();
  await expect(secao.getByText("Pessoa ligada ao projeto.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Quem atua neste projeto" }).getByRole("button", { name: "Desligar Coordenação E2E" })).toBeVisible();
  expect(erros).toEqual([]);
});
