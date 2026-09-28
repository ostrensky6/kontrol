import { expect, test, type Locator } from "@playwright/test";

test("emissão configurada salva proposta final no histórico", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/orcamento/demandas/1?etapa=final");

  const propostaFinal = page.locator("#final");
  await expect(propostaFinal.getByText("Total da proposta").first()).toBeVisible();
  // etapa Proposta (28/09): mesmas abas da proposta emitida, com valores vivos
  await expect(propostaFinal.getByRole("link", { name: "Interno" })).toBeVisible();
  await expect(propostaFinal.getByRole("link", { name: "Documento do cliente (prévia)" })).toBeVisible();
  await expect(propostaFinal.getByText("Custos efetivos").first()).toBeVisible();
  await expect(propostaFinal.getByText("Custos operacionais").first()).toBeVisible();
  const versoesAntes = await lerTotalVersoesEmitidas(propostaFinal);

  const emitir = page.getByRole("button", { name: "Emitir versão final" });
  await expect(emitir).toBeEnabled();
  await emitir.click();
  const confirmacao = page.getByRole("dialog", { name: "Emitir versão final?" });
  await expect(confirmacao).toBeVisible();
  await confirmacao.getByRole("button", { name: "Emitir", exact: true }).click();

  await expect(page).toHaveURL(/\/orcamento\/demandas\/1\?etapa=final/);
  await expect(page.getByRole("link", { name: /Abrir versão emitida \(OF-2026-0001-v\d+\)/ })).toBeVisible();
  await expect
    .poll(() => lerTotalVersoesEmitidas(propostaFinal), {
      message: "histórico deve registrar exatamente uma nova versão emitida",
    })
    .toBe(versoesAntes + 1);

  // Proposta emitida: aba Interno primeiro, documento do cliente na outra.
  await page.getByRole("link", { name: /Abrir versão emitida/ }).click();
  await expect(page).toHaveURL(/\/orcamento\/final\/\d+$/);
  await expect(page).toHaveTitle(/^Proposta OF-2026-0001-v\d+ · /);
  await expect(page.getByRole("link", { name: "Interno" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Totais da proposta" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Laboratório" })).toBeVisible();
  await page.getByRole("tab", { name: "Impostos, taxas e margem" }).click();
  await expect(page.getByText("% sobre o preço")).toBeVisible();

  await page.getByRole("link", { name: "Documento do cliente" }).click();
  await expect(page).toHaveURL(/aba=documento/);
  const folha = page.getByRole("article", { name: /Proposta comercial OF-2026-0001-v\d+/ });
  await expect(folha.getByRole("heading", { name: "Proposta comercial" })).toBeVisible();
  await expect(folha.getByText("Serviços e valores")).toBeVisible();
  await expect(folha.getByText("Total (impostos inclusos)")).toBeVisible();
  // O documento é da empresa emissora: o Kontrol é ferramenta interna.
  await expect(folha).not.toContainText(/kontrol/i);
  await expect(folha).not.toContainText(/custo unit|gross-up|lucro/i);
});

async function lerTotalVersoesEmitidas(propostaFinal: Locator) {
  const texto = await propostaFinal.locator("text=/\\d+ versão\\(ões\\)/").first().textContent();
  const match = texto?.match(/(\d+) versão\(ões\)/);
  return match ? Number(match[1]) : 0;
}
