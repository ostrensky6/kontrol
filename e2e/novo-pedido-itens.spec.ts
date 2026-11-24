import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Relatório de ajustes de Compras (17/11/2026), ajuste 4: o "Novo pedido" já
 * tem o espaço dos itens e "Enviar para aprovação" grava o pedido e o envia,
 * sem passar pelo rascunho. Fechar com algo preenchido pede confirmação; se o
 * envio não sair, o pedido fica como rascunho, com o aviso. O roteiro contra o
 * banco real (e2e-real) prova a gravação e a etapa.
 */

async function abrirNovoPedido(page: Page): Promise<Locator> {
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const form = page.getByRole("dialog", { name: "Novo pedido" });
  await expect(form).toBeVisible();
  // a lista de insumos carrega quando o formulário abre
  await expect(form.getByTestId("novo-pedido-item-campos")).toBeVisible();
  return form;
}

async function identificar(form: Locator, titulo: string, projeto: string) {
  await form.getByLabel("Título do pedido").fill(titulo);
  await form.getByLabel("Projeto").selectOption({ label: projeto });
  await form.getByLabel("Tipo de material ou despesa").selectOption("material_consumo_geral");
  await form.getByLabel("Objetivo").selectOption("projeto");
  await form.getByLabel("Justificativa técnica").fill("Reposição para a campanha de campo de dezembro.");
}

async function preencherItem(form: Locator, item: { especificacao: string; quantidade: string; unidade?: string; preco?: string }) {
  const campos = form.getByTestId("novo-pedido-item-campos");
  await campos.getByLabel("Especificação", { exact: true }).fill(item.especificacao);
  await campos.getByLabel("Qtd").fill(item.quantidade);
  if (item.unidade) await campos.getByLabel("Unidade").fill(item.unidade);
  if (item.preco) await campos.getByLabel("Preço estimado (un.)").fill(item.preco);
}

test("Novo pedido com itens segue direto para aprovação, sem rascunho", async ({ page }) => {
  const titulo = `Luvas e ponteiras para a campanha de campo ${Date.now()}`;
  const form = await abrirNovoPedido(page);
  await expect(form.getByTestId("novo-pedido-itens")).toContainText("Nenhum item ainda.");
  await identificar(form, titulo, "Projeto com coordenação E2E · Coordenação E2E");

  // sem item, o envio não sai e nada do que foi digitado se perde
  await form.getByRole("button", { name: "Enviar para aprovação" }).click();
  await expect(form.getByText("Inclua ao menos um material, serviço ou equipamento antes de enviar.")).toBeVisible();
  await expect(form.getByLabel("Título do pedido")).toHaveValue(titulo);
  await expect(page).toHaveURL(/\/pedido$/);

  // item sem unidade não entra na lista
  await preencherItem(form, { especificacao: "Luva nitrílica M", quantidade: "3" });
  await form.getByRole("button", { name: "Adicionar item" }).click();
  await expect(form.getByRole("alert").filter({ hasText: "Informe a unidade do item" })).toBeVisible();
  await preencherItem(form, { especificacao: "Luva nitrílica M", quantidade: "3", unidade: "cx", preco: "45.50" });
  await form.getByRole("button", { name: "Adicionar item" }).click();

  const lista = form.getByTestId("novo-pedido-itens");
  await expect(lista.getByRole("row", { name: /Luva nitrílica M/ })).toContainText("3 cx");
  await expect(lista).toContainText("Total estimado: R$ 136,50");
  // os campos do item voltam vazios para o próximo
  await expect(form.getByTestId("novo-pedido-item-campos").getByLabel("Especificação", { exact: true })).toHaveValue("");

  // segundo item: entra, é editado e depois removido
  await preencherItem(form, { especificacao: "Ponteira 200 uL", quantidade: "2", unidade: "rack" });
  await form.getByRole("button", { name: "Adicionar item" }).click();
  await expect(lista.getByRole("row", { name: /Ponteira 200 uL/ })).toContainText("2 rack");
  await lista.getByRole("button", { name: "Editar Ponteira 200 uL" }).click();
  await expect(form.getByTestId("novo-pedido-item-campos").getByLabel("Especificação", { exact: true })).toHaveValue("Ponteira 200 uL");
  await form.getByTestId("novo-pedido-item-campos").getByLabel("Qtd").fill("5");
  await form.getByRole("button", { name: "Adicionar item" }).click();
  await expect(lista.getByRole("row", { name: /Ponteira 200 uL/ })).toContainText("5 rack");
  await lista.getByRole("button", { name: "Remover Ponteira 200 uL" }).click();
  await expect(lista.getByRole("row", { name: /Ponteira 200 uL/ })).toHaveCount(0);

  await form.getByRole("button", { name: "Enviar para aprovação" }).click();

  // cai no pedido já enviado: sem aviso, sem rascunho, com o item gravado
  await expect(page).toHaveURL(/\/pedido\/\d+$/);
  await expect(page.getByRole("heading", { name: titulo })).toBeVisible();
  await expect(page.getByText("Aguardando coordenador").first()).toBeVisible();
  await expect(page.getByTestId("aviso-novo-pedido")).toHaveCount(0);
  await expect(page.getByText("Luva nitrílica M").first()).toBeVisible();
  await expect(page.getByText("Ponteira 200 uL")).toHaveCount(0);

  // o pedido enviado entra em "Aguardando você"; no celular, o título comprido não alarga a página
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/pedido");
  await expect(page.getByRole("heading", { level: 1, name: "Pedidos" })).toBeVisible();
  await expect(page.getByText("Pedidos para você aprovar")).toBeVisible();
  expect(await page.locator("html").evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(375);
});

test("item preenchido sem apertar Adicionar item também segue com o pedido", async ({ page }) => {
  const titulo = `Kit de extração ${Date.now()}`;
  const form = await abrirNovoPedido(page);
  await identificar(form, titulo, "Projeto com coordenação E2E · Coordenação E2E");
  await preencherItem(form, { especificacao: "Kit de extração de DNA", quantidade: "1", unidade: "kit" });
  await form.getByRole("button", { name: "Enviar para aprovação" }).click();

  await expect(page).toHaveURL(/\/pedido\/\d+$/);
  await expect(page.getByText("Aguardando coordenador").first()).toBeVisible();
  await expect(page.getByText("Kit de extração de DNA").first()).toBeVisible();
});

test("envio que não sai guarda o pedido como rascunho e avisa o que falta", async ({ page }) => {
  // 0184: o Administrador e quem tem "Conduzir a compra inteira" enviam mesmo
  // sem coordenador (aprovam como substitutos); o Gestor não tem a caixinha
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL ausente na configuração do Playwright");
  await page.context().addCookies([{ name: "kontrol_e2e_papel", value: "gestor", url: baseURL }]);
  const titulo = `Reagentes sem coordenador ${Date.now()}`;
  const form = await abrirNovoPedido(page);
  // o Projeto E2E não tem coordenador cadastrado: o envio trava
  await identificar(form, titulo, "Projeto E2E");
  await preencherItem(form, { especificacao: "Etanol absoluto", quantidade: "4", unidade: "L" });
  await form.getByRole("button", { name: "Adicionar item" }).click();
  await form.getByRole("button", { name: "Enviar para aprovação" }).click();

  await expect(page).toHaveURL(/\/pedido\/\d+\?aviso=envio$/);
  await expect(page.getByRole("heading", { name: titulo })).toBeVisible();
  const aviso = page.getByTestId("aviso-novo-pedido");
  await expect(aviso).toContainText("O pedido foi guardado como rascunho, mas não seguiu para aprovação.");
  await expect(aviso).toContainText("não tem coordenador cadastrado");
  await expect(page.getByText("Rascunho").first()).toBeVisible();
  // o item não se perdeu
  await expect(page.getByText("Etanol absoluto").first()).toBeVisible();
  await page.context().clearCookies();
});

test("fechar o Novo pedido com algo preenchido pede confirmação", async ({ page }) => {
  const form = await abrirNovoPedido(page);

  // nada preenchido: fecha direto
  await form.getByRole("button", { name: "Cancelar" }).click();
  await expect(form).toBeHidden();

  await page.getByRole("button", { name: "Novo pedido" }).click();
  await expect(form).toBeVisible();
  await form.getByLabel("Título do pedido").fill("Pedido que eu quase perdi");
  await page.keyboard.press("Escape");

  const descartar = form.getByTestId("novo-pedido-descartar");
  await expect(descartar).toContainText("Descartar este pedido?");
  await descartar.getByRole("button", { name: "Continuar preenchendo" }).click();
  await expect(descartar).toHaveCount(0);
  await expect(form.getByLabel("Título do pedido")).toHaveValue("Pedido que eu quase perdi");

  await form.getByRole("button", { name: "Cancelar" }).click();
  await form.getByTestId("novo-pedido-descartar").getByRole("button", { name: "Descartar pedido" }).click();
  await expect(form).toBeHidden();

  // reabre vazio
  await page.getByRole("button", { name: "Novo pedido" }).click();
  await expect(form.getByLabel("Título do pedido")).toHaveValue("");
  await expect(form.getByTestId("novo-pedido-descartar")).toHaveCount(0);
});
