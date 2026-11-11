import { expect, test } from "@playwright/test";

/**
 * O campo de coordenador só lista quem já tem usuário. Quem ainda não tem
 * (a coordenação de um laboratório novo, por exemplo) é cadastrado ali mesmo,
 * sem sair do formulário, e já vem escolhido no campo.
 */
test("coordenação de laboratório: cadastra uma pessoa nova no próprio campo e já a escolhe", async ({ page }) => {
  await page.goto("/cadastros/coordenacoes");
  await page.getByRole("row", { name: /LQA/ }).getByRole("button", { name: "Abrir ações do registro" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const gaveta = page.getByRole("dialog", { name: /Editar laboratório ou área/ });
  const coordenacao = gaveta.getByLabel("Coordenação (usuário)", { exact: true });

  // a saída está debaixo do campo, nos dois campos de usuário do formulário
  const cadastrar = gaveta.getByRole("button", { name: /Cadastrar nova pessoa/ });
  await expect(cadastrar).toHaveCount(2);
  await cadastrar.first().click();

  const dialogo = page.getByRole("dialog", { name: "Cadastrar nova pessoa" });
  // para coordenação a função sugerida é Coordenador
  await expect(dialogo.getByLabel("Função")).toHaveValue("coordenador");
  // teste negativo: sem e-mail a conta não é criada
  await dialogo.getByLabel("Nome").fill("Vilmar da Silva E2E");
  await dialogo.getByRole("button", { name: "Cadastrar pessoa" }).click();
  await expect(dialogo.getByTestId("senha-provisoria-gerada")).toHaveCount(0);
  await expect(dialogo.getByLabel("E-mail")).toBeVisible();

  await dialogo.getByLabel("E-mail").fill(`vilmar.${Date.now()}@example.com`);
  // a função deste teste é Laboratório, para não entrar em "Quem atua neste projeto" dos outros testes
  await dialogo.getByLabel("Função").selectOption("laboratorio");
  await dialogo.getByRole("button", { name: "Cadastrar pessoa" }).click();

  await expect(dialogo.getByTestId("senha-provisoria-gerada")).toBeVisible();
  await expect(dialogo.getByText("Vilmar da Silva E2E")).toBeVisible();
  await dialogo.getByRole("button", { name: /Usar em/ }).click();
  await expect(dialogo).toHaveCount(0);

  // a pessoa nova já está escolhida no campo que pediu o cadastro...
  await expect(coordenacao.locator("option:checked")).toHaveText("Vilmar da Silva E2E");
  // ...e disponível no outro campo de usuário, sem escolher nada nele
  const substituto = gaveta.getByLabel("Substituto (usuário)", { exact: true });
  await expect(substituto.locator("option", { hasText: "Vilmar da Silva E2E" })).toHaveCount(1);
  await expect(substituto.locator("option:checked")).toHaveText("—");

  // sair sem salvar não muda o laboratório
  await page.keyboard.press("Escape");
  await expect(page.getByRole("row", { name: /LQA/ })).toContainText("Sem coordenador: o pedido trava");
});

test("coordenação de laboratório: voltar do cadastro de pessoa não cria nem escolhe ninguém", async ({ page }) => {
  await page.goto("/cadastros/coordenacoes");
  await page.getByRole("row", { name: /LQA/ }).getByRole("button", { name: "Abrir ações do registro" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const gaveta = page.getByRole("dialog", { name: /Editar laboratório ou área/ });
  await gaveta.getByRole("button", { name: /Cadastrar nova pessoa/ }).first().click();
  const dialogo = page.getByRole("dialog", { name: "Cadastrar nova pessoa" });
  await dialogo.getByLabel("Nome").fill("Desistência E2E");
  await dialogo.getByRole("button", { name: "Voltar" }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(gaveta.getByLabel("Coordenação (usuário)", { exact: true }).locator("option:checked")).toHaveText("—");
  await expect(gaveta.getByLabel("Coordenação (usuário)", { exact: true }).locator("option", { hasText: "Desistência E2E" })).toHaveCount(0);
});

test("projeto: o campo de coordenador também oferece o cadastro, com Coordenador como função", async ({ page }) => {
  await page.goto("/cadastros/projetos");
  await page.getByRole("button", { name: /Novo projeto/ }).click();
  const gaveta = page.getByRole("dialog", { name: /Novo projeto/ });
  await gaveta.getByRole("button", { name: /Cadastrar nova pessoa/ }).click();
  const dialogo = page.getByRole("dialog", { name: "Cadastrar nova pessoa" });
  await expect(dialogo.getByLabel("Função")).toHaveValue("coordenador");
  // Administrador não é oferecido como função de uma pessoa nova
  await expect(dialogo.getByLabel("Função").locator("option", { hasText: "Administrador" })).toHaveCount(0);
});

test("responsáveis por etapa: a pessoa nova sugere a função Compra", async ({ page }) => {
  await page.goto("/cadastros/responsaveis");
  await page.getByRole("row", { name: /Administrativo: autorização/ }).getByRole("button", { name: "Abrir ações do registro" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const gaveta = page.getByRole("dialog", { name: /Editar responsável/ });
  await gaveta.getByRole("button", { name: /Cadastrar nova pessoa/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Cadastrar nova pessoa" }).getByLabel("Função")).toHaveValue("compra");
});
