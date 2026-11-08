import { expect, test } from "@playwright/test";

// Avaliação externa de 08/11, prioridade 5 (complemento de ajuda.spec.ts):
// menu lateral anuncia a página aberta e a Ajuda tem alvos de toque de 44 px no celular.

test("menu lateral marca a página aberta com aria-current", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/estoque");
  const principal = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(principal.locator("a[aria-current]")).toHaveCount(1);
});

test("ajuda no celular: tópicos e voltar com alvo de toque de 44 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/ajuda");
  const lista = page.getByRole("navigation", { name: "Tópicos da ajuda" });
  const topico = lista.getByRole("button", { name: "Custeio", exact: true });
  expect((await topico.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await topico.click();
  const voltar = page.getByRole("button", { name: "Voltar à lista" });
  expect((await voltar.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
});
