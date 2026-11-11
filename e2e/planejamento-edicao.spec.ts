import { expect, test, type Page } from "@playwright/test";

async function criarPlano(page: Page, nome: string) {
  await page.goto("/planejamento");
  // o formulário de criação fica atrás do botão (revisão de 11/11, L14)
  await page.getByRole("button", { name: "Novo plano" }).click();
  await expect(page.getByLabel("Nome do plano")).toBeFocused();
  await page.getByLabel("Nome do plano").fill(nome);
  await page.getByRole("button", { name: "Criar plano" }).click();
  await expect(page).toHaveURL(/\/planejamento\/\d+$/);
  await expect(page.getByRole("heading", { level: 1, name: nome })).toBeVisible();
}

test("edita contexto e item do plano e exclui pelo cabeçalho", async ({ page }) => {
  const nome = `Plano E2E edição ${Date.now()}`;
  await criarPlano(page, nome);

  // Contexto operacional: o formulário mostra o resultado ao lado do botão.
  const editado = `${nome} (editado)`;
  await page.getByRole("link", { name: "Editar", exact: true }).click();
  await expect(page.getByLabel("Nome", { exact: true })).toBeFocused();
  await page.getByLabel("Nome", { exact: true }).fill(editado);
  await page.getByLabel("Início previsto").fill("2026-07-01");
  await page.getByLabel("Fim previsto").fill("2026-07-15");
  await page.getByRole("button", { name: "Salvar contexto" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Contexto salvo." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: editado })).toBeVisible();

  // Adiciona e edita uma análise no próprio item.
  const adicionar = page.getByRole("form", { name: "Adicionar análise" });
  await adicionar.getByLabel("Análise").click();
  await page.getByRole("option", { name: /qPCR_F/ }).click();
  await adicionar.getByLabel("Amostras").fill("4");
  await adicionar.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Análise adicionada." })).toBeVisible();

  const itens = page.getByRole("list", { name: "Análises do plano" });
  await expect(itens).toContainText("4 amostras");
  await itens.getByRole("button", { name: "Editar qPCR_F" }).click();
  const edicao = page.getByRole("form", { name: "Editar qPCR_F" });
  await edicao.getByLabel("Amostras").fill("9");
  await edicao.getByLabel("Controles").fill("2");
  await edicao.getByRole("button", { name: "Salvar item" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Item salvo." })).toBeVisible();
  await expect(itens).toContainText("9 amostras + 2 controles");

  // Excluir pelo cabeçalho exige motivo e volta para a lista.
  await page.getByRole("button", { name: "Excluir plano" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByLabel("Motivo").fill("Plano de teste E2E");
  await dialogo.getByRole("button", { name: "Excluir plano" }).click();
  await expect(page).toHaveURL(/\/planejamento\?excluido=\d+$/);
  await expect(page.getByRole("status").filter({ hasText: /Plano #\d+ excluído/ })).toBeVisible();
  await expect(page.getByRole("link", { name: editado })).toHaveCount(0);
});

test("exclui plano sem baixa pela ação da lista", async ({ page }) => {
  const nome = `Plano E2E lista ${Date.now()}`;
  await criarPlano(page, nome);
  await page.goto("/planejamento");

  await expect(page.getByRole("link", { name: `Editar ${nome}` })).toHaveAttribute("href", /#editar$/);
  // Excluir saiu do lado de "Ver": fica no menu "…" da linha (revisão de 11/11, L15)
  await expect(page.getByRole("button", { name: `Excluir ${nome}` })).toHaveCount(0);
  await page.getByRole("button", { name: `Mais ações de ${nome}` }).click();
  await page.getByRole("menuitem", { name: "Excluir plano" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toContainText("Reservas ativas são liberadas");
  await dialogo.getByLabel("Motivo").fill("Duplicado");
  await dialogo.getByRole("button", { name: "Excluir plano" }).click();
  await expect(dialogo).toBeHidden();
  await expect(page.getByRole("link", { name: nome, exact: true })).toHaveCount(0);
});

test("plano com baixa de material só oferece cancelar", async ({ page }) => {
  await page.goto("/planejamento/900");
  await expect(page.getByRole("heading", { level: 1, name: "Plano com baixa E2E" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Excluir plano" })).toHaveCount(0);
  await expect(page.getByText("Já houve baixa de material — só é possível cancelar.")).toBeVisible();
  await expect(page.getByLabel("Nome", { exact: true })).toBeDisabled();
  await expect(page.getByText("Plano em execução: só é possível editar em rascunho ou reservado.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Editar qPCR_F" })).toHaveCount(0);

  await page.getByRole("button", { name: "Cancelar plano" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByRole("button", { name: "Cancelar plano" }).click();
  // Motivo obrigatório: a validação nativa impede o envio sem ele.
  await expect(dialogo).toBeVisible();
  await dialogo.getByLabel("Motivo").fill("Cliente interrompeu a análise");
  await dialogo.getByRole("button", { name: "Cancelar plano" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Plano cancelado. O histórico foi preservado." })).toBeVisible();
  await expect(page.getByText("Cancelado", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancelar plano" })).toHaveCount(0);
});
