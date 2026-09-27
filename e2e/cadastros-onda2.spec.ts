import { expect, test } from "@playwright/test";

// Auditoria de 26/09, onda 2: cadastros e componentes comuns.

test("novo insumo: unidade da embalagem, estoque inicial visível e campos sem uso fora do formulário", async ({ page }) => {
  await page.goto("/cadastros/insumos");
  await page.getByRole("button", { name: "Novo insumo" }).click();

  const formulario = page.getByRole("dialog");
  await expect(formulario.getByRole("textbox", { name: /^Unidade da embalagem/ })).toBeVisible();
  await expect(formulario.getByRole("spinbutton", { name: /^Quantidade na embalagem/ })).toBeVisible();
  await expect(formulario.getByText("Entra direto no estoque, sem quarentena.")).toBeVisible();
  await expect(formulario.getByRole("textbox", { name: "Lote do fabricante" })).toBeVisible();
  // dados do lote ficam no bloco "Estoque inicial"; campos sem uso saem do formulário
  await expect(formulario.getByLabel("Data de validade", { exact: true })).toBeVisible();
  await expect(formulario.getByLabel("Código interno")).toHaveCount(0);
  await expect(formulario.getByLabel("Ficha de segurança (URL do SDS)")).toHaveCount(0);
  await expect(formulario.getByLabel("Fornecedor alternativo")).toHaveCount(0);
});

test('ajuda "?" tem área de toque de 44 px, nome acessível e Esc devolve o foco', async ({ page }) => {
  await page.goto("/cadastros/insumos");
  await page.getByRole("button", { name: "Novo insumo" }).click();

  const ajuda = page.getByRole("button", { name: "Ajuda: Quantidade na embalagem" });
  const toque = await ajuda.evaluate((el) => {
    const antes = getComputedStyle(el, "::before");
    return { largura: parseFloat(antes.width), altura: parseFloat(antes.height) };
  });
  expect(toque.largura).toBeGreaterThanOrEqual(44);
  expect(toque.altura).toBeGreaterThanOrEqual(44);

  await ajuda.focus();
  await page.keyboard.press("Enter");
  const caixa = page.getByRole("dialog", { name: "Quantidade na embalagem" });
  await expect(caixa).toBeVisible();
  await expect(caixa).toContainText("Frasco de 500 mL → 500.");
  await expect(caixa.locator("div").first()).toHaveCSS("text-align", "left");

  await page.keyboard.press("Escape");
  await expect(caixa).toBeHidden();
  await expect(ajuda).toBeFocused();
});

test("parâmetros de custeio: fatores versionados só para consulta", async ({ page }) => {
  await page.goto("/parametros");
  await expect(page.getByText("Vale para novos cálculos. Propostas emitidas não mudam.")).toBeVisible();
  await expect(page.getByLabel(/^Impostos/)).toBeDisabled();
  await expect(page.getByLabel(/^Dias úteis por ano/)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Salvar parâmetros" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Alterar em Parâmetros econômicos" })).toHaveAttribute(
    "href",
    "/orcamento/parametros",
  );
});
