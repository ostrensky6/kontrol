import { expect, test } from "@playwright/test";
import { escolherLaboratorioOuCampo } from "./ajudas/novo-pedido";

/**
 * 0169 e 0188: o pedido mostra quem aprova cada etapa, por escrito, na ordem
 * nova (laboratório ou campo, financeiro, coordenador do projeto), e o envio
 * trava com explicação quando o projeto não tem coordenador cadastrado.
 */
test("pedido mostra quem aprova na ordem nova e trava sem coordenador do projeto", async ({ page }) => {
  const titulo = `Reagentes quem aprova ${Date.now()}`;
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Título do pedido").fill(titulo);
  await form.getByRole("combobox", { name: "Projeto", exact: true }).selectOption({ label: "Projeto E2E" });
  await form.getByRole("radiogroup", { name: "Tipo de material ou despesa" }).getByText("Material de consumo de laboratório", { exact: true }).click();
  await form.getByRole("button", { name: "Ajuda: Primeira aprovação" }).click();
  await expect(page.getByRole("dialog", { name: "Primeira aprovação" })).toContainText("aprovado primeiro pela coordenação do laboratório");
  await page.keyboard.press("Escape");
  await form.getByRole("radiogroup", { name: "Objetivo" }).getByText("Projeto", { exact: true }).click();
  await escolherLaboratorioOuCampo(form);
  await form.getByLabel("Justificativa técnica").fill("Extração de DNA das amostras de campo.");
  await form.getByRole("button", { name: "Guardar rascunho" }).click();

  await expect(page).toHaveURL(/\/pedido\/\d+$/);
  const quadro = page.getByTestId("quem-aprova");
  await expect(quadro).toBeVisible();
  // a ordem: laboratório ou campo, financeiro e, por último, o coordenador do projeto
  await expect(quadro).toHaveText(/Laboratório ou campo \(Genética\)[\s\S]*Financeiro \(fonte de pagamento\)[\s\S]*Coordenador do projeto/);
  await expect(quadro).toContainText("Coordenação E2E");
  await expect(quadro).toContainText("Trava o envio");
  await expect(quadro).toContainText("não tem coordenador cadastrado");
  await expect(page.getByRole("button", { name: "Enviar para aprovação" }).first()).toBeDisabled();
});

test("cadastro de laboratórios mostra quem coordena e onde falta", async ({ page }) => {
  await page.goto("/cadastros/coordenacoes");
  await expect(page.getByRole("heading", { name: "Laboratórios e áreas" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Genética/ })).toContainText("Coordenação E2E");
  await expect(page.getByRole("row", { name: /LQA/ })).toContainText("Sem coordenador: o pedido trava");
});
