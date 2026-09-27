import { expect, test, type Locator } from "@playwright/test";

// Lotes semeados no mock (src/lib/testing/mock-supabase.ts): insumo 900
// "Kit extração E2E", embalagens fechadas, lote 1 (EMB-E2E-A, vence antes)
// e lote 2 (EMB-E2E-B). O mock mantém estado entre execuções no mesmo
// servidor, por isso as asserções comparam com o saldo lido antes da baixa.

function numero(texto: string | null) {
  const match = /-?[\d.]+(?:,\d+)?/.exec(texto ?? "");
  if (!match) throw new Error(`Sem número em "${texto}"`);
  return Number(match[0].replace(/\./g, "").replace(",", "."));
}

async function saldoAtualDoLote(page: import("@playwright/test").Page) {
  const dd = page.locator("dt", { hasText: "Saldo atual" }).locator("xpath=following-sibling::dd");
  return numero(await dd.textContent());
}

async function emMaosDaLinha(linha: Locator) {
  return numero(await linha.getByRole("cell").nth(2).textContent());
}

test("dar baixa pela página do lote exige motivo e reduz o saldo", async ({ page }) => {
  await page.goto("/estoque/lotes/1");
  await expect(page.getByRole("heading", { name: "Lote EMB-E2E-A" })).toBeVisible();
  const antes = await saldoAtualDoLote(page);

  await page.getByRole("button", { name: "Dar baixa" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByRole("heading", { name: "Dar baixa" })).toBeVisible();
  await expect(dialogo).toContainText("EMB-E2E-A");

  await dialogo.getByLabel("Frascos a baixar").fill("1");
  await dialogo.getByRole("button", { name: "Registrar baixa" }).click();
  await expect(dialogo.getByText("Selecione o motivo.")).toBeVisible();
  await expect(dialogo).toBeVisible();

  await dialogo.getByLabel("Motivo").selectOption("Perda/quebra");
  await dialogo.getByLabel(/Detalhe/).fill("Frasco trincado E2E");
  await dialogo.getByRole("button", { name: "Registrar baixa" }).click();

  await expect(dialogo).toBeHidden();
  await expect.poll(() => saldoAtualDoLote(page)).toBe(antes - 1);
  await expect(page.getByRole("cell", { name: "baixa manual: Perda/quebra: Frasco trincado E2E" }).first()).toBeVisible();
});

test("dar baixa pela linha do insumo sugere o lote FEFO e reduz o saldo em mãos", async ({ page }) => {
  await page.goto("/estoque");
  const linha = page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: "+ Entrada" }) })
    .filter({ hasText: "Kit extração E2E" });
  await expect(linha).toBeVisible();
  const antes = await emMaosDaLinha(linha);

  await linha.getByRole("button", { name: "Dar baixa" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByLabel("Lote")).toHaveValue("1");
  await expect(dialogo).toContainText("Sugerido: o lote que vence primeiro (FEFO).");

  // trocar de lote é permitido, com aviso de FEFO; volta para o sugerido
  await dialogo.getByLabel("Lote").selectOption("2");
  await expect(dialogo).toContainText("o lote EMB-E2E-A vence antes (FEFO)");
  await dialogo.getByLabel("Lote").selectOption("1");

  await dialogo.getByLabel("Frascos a baixar").fill("2");
  await dialogo.getByLabel("Motivo").selectOption("Consumo em análise");
  await dialogo.getByRole("button", { name: "Registrar baixa" }).click();

  await expect(dialogo).toBeHidden();
  await expect.poll(() => emMaosDaLinha(linha)).toBe(antes - 2);
});

test("controle de estoque oferece dar baixa no cartão do insumo", async ({ page }) => {
  await page.goto("/estoque/controle");
  const cartao = page.locator("article").filter({ hasText: "Kit extração E2E" });
  await expect(cartao.getByRole("button", { name: "Dar baixa" })).toBeVisible();
  await cartao.getByRole("button", { name: "Dar baixa" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByLabel("Lote")).toHaveValue("1");
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialogo).toBeHidden();
});
