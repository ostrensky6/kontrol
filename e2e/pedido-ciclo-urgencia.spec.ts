import { expect, test, type Page } from "@playwright/test";

/**
 * 0172 e 0183 (relatório de ajustes de Compras de 17/11/2026, ajuste 2): o
 * pedido explica em que ciclo de compras entra (dia 10). Quem pede não define
 * a urgência: o formulário não tem o campo e o pedido nasce Normal. Só quem
 * tem a permissão "Definir urgência do pedido" muda, com justificativa, pelo
 * botão "Definir urgência" do pedido. O banco real prova a recusa e o ciclo
 * (supabase/tests/urgencia_por_permissao_0183.sql).
 */

async function comoCategoria(page: Page, papel: string) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL ausente na configuração do Playwright");
  await page.context().addCookies([{ name: "kontrol_e2e_papel", value: papel, url: baseURL }]);
}

test.afterEach(async ({ page }) => {
  await page.context().clearCookies();
});

test("quem pede não define a urgência; quem tem a permissão define, com justificativa", async ({ page }) => {
  const titulo = `Reagente urgente ${Date.now()}`;
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const form = page.getByRole("dialog");
  await expect(form.getByTestId("ciclo-pedido")).toContainText("ciclo");
  await expect(form.getByTestId("ciclo-pedido")).toContainText("A urgência é definida pelo administrativo, não por quem pede");
  // ajustes 2 e 3: o formulário não pede urgência nem fonte do recurso
  await expect(form.getByLabel("Urgência")).toHaveCount(0);
  await expect(form.getByLabel(/Fonte sugerida/)).toHaveCount(0);
  await expect(form.locator('[name="urgencia"], [name="urgencia_justificativa"], [name="fonte_recurso"]')).toHaveCount(0);

  await form.getByLabel("Título do pedido").fill(titulo);
  await form.getByRole("combobox", { name: "Projeto", exact: true }).selectOption({ label: "Projeto E2E" });
  await form.getByRole("radiogroup", { name: "Tipo de material ou despesa" }).getByText("Material de consumo geral (campo, coleta)", { exact: true }).click();
  await form.getByRole("radiogroup", { name: "Objetivo" }).getByText("Projeto", { exact: true }).click();
  await form.getByLabel("Justificativa técnica").fill("Coleta de campo da próxima semana.");
  await form.getByRole("button", { name: "Guardar rascunho" }).click();

  await expect(page).toHaveURL(/\/pedido\/\d+$/);
  await expect(page.getByRole("heading", { name: titulo })).toBeVisible();
  await expect(page.getByText("Urgência: Normal")).toBeVisible();
  // "Urgência definida" saiu do "Conferir e enviar": não é mais tarefa de quem pede
  await expect(page.getByText("Urgência definida", { exact: true })).toHaveCount(0);

  // Editar não oferece a urgência; aponta para o botão de quem define
  await page.getByRole("button", { name: "Editar" }).first().click();
  const editar = page.getByRole("dialog");
  await expect(editar.getByTestId("urgencia-fixa")).toContainText("Urgência: Normal. Quem define é o administrativo");
  await expect(editar.getByLabel("Urgência")).toHaveCount(0);
  await expect(editar.getByLabel(/Fonte sugerida/)).toHaveCount(0);
  await editar.getByRole("button", { name: "Cancelar" }).click();
  await expect(editar).toBeHidden();

  // o Administrador (tem todas as permissões) define a urgência
  await page.getByRole("button", { name: "Definir urgência" }).click();
  const urgencia = page.getByRole("dialog");
  await expect(urgencia.getByRole("heading", { name: /Urgência do pedido/ })).toBeVisible();
  await urgencia.getByLabel("Urgência").selectOption("alta");
  const motivo = urgencia.getByLabel("Por que é urgente? (obrigatório)");
  await expect(motivo).toBeVisible();
  await motivo.fill("Amostras chegam dia 15 e o reagente acabou");
  await urgencia.getByRole("button", { name: "Salvar urgência" }).click();
  await expect(urgencia).toBeHidden();

  await expect(page.getByText("Urgência: Alta")).toBeVisible();
  await expect(page.getByText("Urgente: Amostras chegam dia 15 e o reagente acabou")).toBeVisible();
  await expect(page.getByTestId("ciclo-pagamento")).toContainText("fura o ciclo do dia 10");
  // fica na linha do tempo, com o motivo
  await expect(page.getByText("Urgência: Normal → Alta. Motivo: Amostras chegam dia 15 e o reagente acabou")).toBeVisible();
});

test("Definir urgência só aparece para quem tem a permissão", async ({ page }) => {
  // Laboratório e Coordenador pedem e aprovam, mas não definem a urgência
  for (const papel of ["laboratorio", "coordenador"]) {
    await comoCategoria(page, papel);
    await page.goto("/pedido/501");
    await expect(page.getByRole("heading", { name: "Reagente do ciclo seguinte E2E" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Definir urgência" }), papel).toHaveCount(0);
  }
  // a função Administrativo nasce com a permissão (0183)
  await comoCategoria(page, "administrativo");
  await page.goto("/pedido/501");
  await expect(page.getByRole("button", { name: "Definir urgência" })).toBeVisible();
});
