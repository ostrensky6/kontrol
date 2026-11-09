import { expect, test } from "@playwright/test";

/**
 * 0169: o pedido mostra quem aprova cada etapa, por escrito, e o envio trava
 * com explicação quando o projeto não tem coordenador cadastrado.
 */
test("pedido de material de laboratório mostra quem aprova e trava sem coordenador", async ({ page }) => {
  const titulo = `Reagentes quem aprova ${Date.now()}`;
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Título do pedido").fill(titulo);
  await form.getByLabel("Projeto").selectOption({ label: "Projeto E2E" });
  await form.getByLabel("Tipo de material ou despesa").selectOption("material_consumo_lab");
  await expect(form.getByText("passa também pela coordenação do laboratório")).toBeVisible();
  await form.getByLabel("Objetivo").selectOption("projeto");
  await form.getByLabel(/Laboratório ou área/).selectOption({ label: "Genética · Coordenação E2E" });
  await form.getByLabel("Justificativa técnica").fill("Extração de DNA das amostras de campo.");
  await form.getByRole("button", { name: "Criar rascunho" }).click();

  await expect(page).toHaveURL(/\/pedido\/\d+$/);
  const quadro = page.getByTestId("quem-aprova");
  await expect(quadro).toBeVisible();
  await expect(quadro).toContainText("Validação pelo coordenador do projeto");
  await expect(quadro).toContainText("Trava o envio");
  await expect(quadro).toContainText("não tem coordenador cadastrado");
  await expect(quadro).toContainText("Coordenação do laboratório (Genética)");
  await expect(quadro).toContainText("Coordenação E2E");
  await expect(page.getByRole("button", { name: "Enviar para validação" }).first()).toBeDisabled();
});

test("cadastro de laboratórios mostra quem coordena e onde falta", async ({ page }) => {
  await page.goto("/cadastros/coordenacoes");
  await expect(page.getByRole("heading", { name: "Laboratórios e áreas" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Genética/ })).toContainText("Coordenação E2E");
  await expect(page.getByRole("row", { name: /LQA/ })).toContainText("Sem coordenador: o pedido trava");
});
