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

// Saldo e lotes tem 6 colunas (Insumo, Disponível, …): a baixa reduz o disponível
async function disponivelDaLinha(linha: Locator) {
  return numero(await linha.getByRole("cell").nth(1).textContent());
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

test("dar baixa pela linha do insumo sugere o lote FEFO e reduz o disponível", async ({ page }) => {
  await page.goto("/estoque");
  const linha = page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: "Registrar chegada" }) })
    .filter({ hasText: "Kit extração E2E" });
  await expect(linha).toBeVisible();
  const antes = await disponivelDaLinha(linha);

  await linha.getByRole("button", { name: "Dar baixa" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByLabel("Lote")).toHaveValue("1");
  await expect(dialogo).toContainText("Sugerido: o lote que vence primeiro (FEFO).");

  // trocar de lote é permitido, com aviso de FEFO; volta para o sugerido
  await dialogo.getByLabel("Lote").selectOption("2");
  await expect(dialogo).toContainText("o lote EMB-E2E-A vence antes (FEFO)");
  await dialogo.getByLabel("Lote").selectOption("1");

  await dialogo.getByLabel("Frascos a baixar").fill("2");
  await dialogo.getByLabel("Motivo").selectOption("Entrega ao laboratório");
  await dialogo.getByRole("button", { name: "Registrar baixa" }).click();

  await expect(dialogo).toBeHidden();
  await expect.poll(() => disponivelDaLinha(linha)).toBe(antes - 2);
});

test("lote na lista: “Dar baixa” à vista e as outras ações no menu “…” (8.3)", async ({ page }) => {
  await page.goto("/estoque?ver=lotes");
  const linha = page.getByRole("row").filter({ has: page.getByRole("link", { name: "EMB-E2E-A" }) });
  await expect(linha.getByRole("button", { name: "Dar baixa" })).toBeVisible();
  // antes eram quatro botões de texto por linha, dois em vermelho
  await expect(linha.getByRole("button", { name: /^(Bloquear|Ajustar|Descartar)$/ })).toHaveCount(0);
  await linha.getByRole("button", { name: "Mais ações do lote EMB-E2E-A" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toContainText(["Bloquear", "Ajustar", "Descartar"]);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // a página do lote continua com os botões à vista
  await page.goto("/estoque/lotes/1");
  await expect(page.getByRole("button", { name: "Bloquear" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mais ações do lote EMB-E2E-A" })).toHaveCount(0);
});
