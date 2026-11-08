import { expect, test } from "@playwright/test";

test("incidentes: registrar avisa no topo; resolver tira o aviso", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (erro) => erros.push(erro.message));
  await page.goto("/governanca/incidentes");
  await expect(page.getByRole("heading", { level: 1, name: /Incidentes/ })).toBeVisible();

  const form = page.getByTestId("novo-incidente");
  await form.getByLabel("Título").fill("Freezer E2E parado");
  await form.getByLabel("O que aconteceu").fill("O freezer -80 desligou à noite.");
  await form.getByLabel("Quem ou o que foi afetado").fill("Amostras do freezer 2");
  await form.getByLabel("O que fazer enquanto isso").fill("Não abra o freezer; use o reserva.");
  await form.getByRole("button", { name: "Registrar e avisar" }).click();
  await expect(form.getByText("Incidente registrado e aviso enviado.")).toBeVisible();

  await page.reload();
  const card = page.getByTestId("incidente").filter({ hasText: "Freezer E2E parado" });
  await expect(card.getByText("Causa ainda desconhecida")).toBeVisible();
  const faixa = page.getByRole("complementary", { name: "Incidente em aberto" });
  await expect(faixa).toContainText("Freezer E2E parado");
  await expect(faixa).toContainText("use o reserva");

  await card.getByLabel("Nova situação de Freezer E2E parado").selectOption("resolvido");
  await card.getByLabel("O que mudou em Freezer E2E parado").fill("Freezer religado.");
  await card.getByLabel("Causa de Freezer E2E parado").fill("Disjuntor desarmou.");
  await card.getByRole("button", { name: "Registrar passo" }).click();
  await expect(card.getByText("Incidente marcado como resolvido.")).toBeVisible();

  await page.reload();
  const resolvido = page.getByTestId("incidente").filter({ hasText: "Freezer E2E parado" });
  await expect(resolvido.getByText("Disjuntor desarmou.")).toBeVisible();
  await expect(resolvido.getByText("Freezer religado.")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Incidente em aberto" })).toHaveCount(0);
  expect(erros).toEqual([]);
});
