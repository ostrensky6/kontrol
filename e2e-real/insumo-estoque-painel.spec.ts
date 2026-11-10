import { expect, test, type Page } from "@playwright/test";
import { ADMIN, entrarComo } from "./apoio";

/**
 * Cadastro → estoque → painel, gravando no Postgres de verdade.
 * Este caminho é o que o mock não cobre: a RPC criar_insumo_com_quantidade
 * só existe no banco.
 */

async function abrirNovoInsumo(page: Page) {
  await page.goto("/cadastros/insumos");
  await page.getByRole("button", { name: "Novo insumo" }).click();
  return page.getByRole("dialog");
}

test("insumo cadastrado com estoque inicial aparece na lista e no estoque depois de recarregar", async ({ page }) => {
  const sufixo = Date.now();
  const nome = `Tampão E2E Real ${sufixo}`;
  const lote = `LREAL-${sufixo}`;

  await entrarComo(page, ADMIN);
  const form = await abrirNovoInsumo(page);
  await form.locator('[name="especificacao"]').fill(nome);
  await form.locator('[name="custo_total_embalagem"]').fill("120");
  await form.locator('[name="quantidade_embalagem"]').fill("500");
  await form.locator('[name="unidade"]').fill("mL");
  await form.locator('[name="quantidade"]').fill("2");
  await form.locator('[name="codigo_lote"]').fill(lote);
  await form.locator('[name="data_validade"]').fill("2030-12-31");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(form).toBeHidden();

  // persistiu: recarrega do banco, não do estado da tela
  // (as listas abrem com 10 linhas: a busca acha o registro)
  await page.reload();
  await page.getByPlaceholder("Buscar…").fill(nome);
  await expect(page.getByRole("cell", { name: nome })).toBeVisible();

  await page.goto("/estoque");
  await page.getByPlaceholder("Buscar reagente...").fill(nome);
  await expect(page.getByText(nome).first()).toBeVisible();
});

test("insumo sem estoque e com ponto de reposição entra nos alertas do painel", async ({ page }) => {
  const nome = `Reagente sem estoque E2E ${Date.now()}`;

  await entrarComo(page, ADMIN);
  const form = await abrirNovoInsumo(page);
  await form.locator('[name="especificacao"]').fill(nome);
  await form.locator('[name="custo_total_embalagem"]').fill("80");
  await form.locator('[name="quantidade_embalagem"]').fill("1");
  await form.locator('[name="unidade"]').fill("kit");
  await form.locator('[name="ponto_reposicao"]').fill("10");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(form).toBeHidden();

  // regra do painel: crítico = disponível < mínimo (ponto de reposição)
  await page.goto("/cadastros");
  await expect(page.getByText(nome).first()).toBeVisible();
});
