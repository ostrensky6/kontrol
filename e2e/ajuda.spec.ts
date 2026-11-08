import { expect, test } from "@playwright/test";

// Relatório do Codex de 08/11, prioridade 5: busca identificada, tópico
// selecionado anunciado e foco levado ao conteúdo e de volta à lista.

test("ajuda: busca com nome, tópico atual marcado e foco no conteúdo", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/ajuda");
  const busca = page.getByRole("searchbox", { name: "Buscar na ajuda" });
  await expect(busca).toBeVisible();
  const lista = page.getByRole("navigation", { name: "Tópicos da ajuda" });

  await lista.getByRole("button", { name: "Custeio", exact: true }).click();
  await expect(lista.getByRole("button", { name: "Custeio", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("heading", { level: 2, name: "Custeio" })).toBeFocused();

  await busca.fill("estoque");
  await expect(page.getByText(/tópico\(s\) encontrado\(s\)/)).toBeAttached();
});

test("ajuda no celular: voltar à lista devolve o foco ao tópico escolhido", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/ajuda");
  const lista = page.getByRole("navigation", { name: "Tópicos da ajuda" });
  await lista.getByRole("button", { name: "Custeio", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Custeio" })).toBeFocused();
  await page.getByRole("button", { name: "Voltar à lista" }).click();
  await expect(lista.getByRole("button", { name: "Custeio", exact: true })).toBeFocused();
});
