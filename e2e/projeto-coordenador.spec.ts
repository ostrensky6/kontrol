import { expect, test } from "@playwright/test";

/**
 * 1.7.3: quem aprova os pedidos do projeto é o usuário coordenador. As telas
 * de Projetos mostram esse usuário (não o nome escrito à mão) e avisam quando
 * falta, com o caminho para indicar.
 */
test("Projetos mostra o coordenador que aprova e avisa onde falta", async ({ page }) => {
  await page.goto("/projetos");
  await expect(page.getByTestId("projetos-sem-coordenador")).toContainText("sem coordenador");
  const comCoordenador = page.getByRole("row", { name: /Projeto com coordenação E2E/ });
  await expect(comCoordenador).toContainText("Coordenação E2E");
  const semCoordenador = page.getByRole("row", { name: /^Projeto E2E/ });
  await expect(semCoordenador).toContainText("Sem coordenador");

  // o aviso leva ao cadastro, já com o projeto aberto para edição
  await semCoordenador.getByRole("link", { name: /Sem coordenador/ }).click();
  await expect(page).toHaveURL(/\/cadastros\/projetos\?focus=1$/);
  const form = page.getByRole("dialog");
  await expect(form.getByLabel("Coordenador do projeto", { exact: true })).toBeVisible();
  await expect(form.getByLabel("Responsável técnico (opcional)", { exact: true })).toBeVisible();
});

test("página do projeto avisa que sem coordenador os pedidos não seguem", async ({ page }) => {
  await page.goto("/projetos/1");
  const aviso = page.getByTestId("projeto-sem-coordenador");
  await expect(aviso).toContainText("Este projeto está sem coordenador.");
  await expect(aviso.getByRole("link", { name: "Indicar coordenador" })).toHaveAttribute("href", "/cadastros/projetos?focus=1");

  await page.goto("/projetos/2");
  await expect(page.getByTestId("projeto-sem-coordenador")).toHaveCount(0);
  await expect(page.getByText("Coordenador: Coordenação E2E")).toBeVisible();
});
