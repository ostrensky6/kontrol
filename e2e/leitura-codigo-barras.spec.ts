import { expect, test } from "@playwright/test";

// Mock (src/lib/testing/mock-supabase.ts): o código 7890000000900 está
// vinculado ao "Kit extração E2E" (insumo 900, embalagens fechadas, lote
// EMB-E2E-A vence antes). Relatório de bugs, item 18.

const CODIGO = "7890000000900";

test("saída por leitura abre 1 embalagem do lote que vence antes, pede confirmação na leitura repetida e desfaz", async ({ page }) => {
  await page.goto("/estoque/leitura?modo=saida");
  await expect(page.getByRole("heading", { name: "Entrada e saída por leitura" })).toBeVisible();

  const campo = page.getByLabel("Código de barras", { exact: true });
  await campo.fill(CODIGO);
  await campo.press("Enter");

  await expect(page.getByText("Kit extração E2E").first()).toBeVisible();
  await expect(page.getByText(/do lote EMB-E2E-A/)).toBeVisible();
  await page.getByRole("button", { name: "Confirmar abertura" }).click();

  const historico = page.getByRole("complementary", { name: "Leituras desta sessão" });
  await expect(historico).toContainText("Abertura registrada: 1 embalagem de Kit extração E2E");

  // o leitor mandou o mesmo código de novo logo em seguida
  await campo.fill(CODIGO);
  await campo.press("Enter");
  await expect(page.getByText(/Este código foi lido há \d+ s/)).toBeVisible();
  await page.getByRole("button", { name: "Não, foi leitura repetida" }).click();
  await expect(page.getByRole("button", { name: "Confirmar abertura" })).toBeHidden();

  await historico.getByRole("button", { name: "Desfazer a última" }).click();
  await expect(historico).toContainText("Abertura desfeita");
});

test("entrada por leitura cria o lote com a validade e código desconhecido oferece vínculo e cadastro", async ({ page }) => {
  await page.goto("/estoque/leitura");
  const campo = page.getByLabel("Código de barras", { exact: true });

  await campo.fill(CODIGO);
  await campo.press("Enter");
  await expect(page.getByLabel("Embalagens recebidas")).toHaveValue("1");
  await page.getByLabel("Validade").fill("2099-01-31");
  await page.getByRole("button", { name: "Confirmar entrada" }).click();
  await expect(page.getByRole("complementary", { name: "Leituras desta sessão" })).toContainText(/Entrada registrada: 1 embalagem de Kit extração E2E\. Lote LEIT-/);

  await campo.fill("1234567890128");
  await campo.press("Enter");
  await expect(page.getByText("não está vinculado a nenhum insumo")).toBeVisible();
  await expect(page.getByRole("button", { name: "Vincular código e continuar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cadastrar novo insumo com este código" })).toHaveAttribute(
    "href",
    "/cadastros/insumos?novo=1&codigo=1234567890128",
  );
});
