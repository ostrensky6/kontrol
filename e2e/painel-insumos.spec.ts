import { expect, test } from "@playwright/test";

test("painel de insumos: origem dos alertas e filtro na URL", async ({ page }, testInfo) => {
  const erros: string[] = [];
  page.on("pageerror", (erro) => erros.push(erro.message));
  page.on("console", (mensagem) => {
    if (mensagem.type() === "error") erros.push(mensagem.text());
  });
  await page.addInitScript(() => localStorage.setItem("theme", "system"));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/cadastros");
  await expect(page.getByRole("heading", { name: "Painel de insumos", level: 1 })).toBeVisible();
  // a lista completa saiu do painel: ela fica em Cadastros → Insumos
  await expect(page.getByRole("link", { name: "Cadastros → Insumos" })).toHaveAttribute("href", "/cadastros/insumos");
  // importar e baixar a planilha ficam no topo, ao lado de "Cadastrar insumo"
  await expect(page.getByText("Importar XLSX")).toBeVisible();
  await expect(page.getByRole("button", { name: "Baixar XLSX" })).toBeVisible();

  // Outros testes do mesmo servidor mexem no saldo do mock: aqui só a estrutura é fixa.
  const painel = page.getByRole("region", { name: "Painel de insumos" });
  const semMinimo = page.getByRole("region", { name: "Sem mínimo definido" });
  await expect(semMinimo.getByRole("link").first()).toHaveAttribute("href", /\/cadastros\/insumos\?focus=\d+/);
  // Insumo sem linha de saldo é "não conferido", nunca zero.
  const semDado = page.getByRole("region", { name: "Saldo não conferido" });
  await expect(semDado).toContainText("Sem dado de saldo nesta leitura");
  // alerta de estoque abre a ficha do insumo (F5); só o que falta preencher abre o cadastro
  await expect(semDado.getByRole("link").first()).toHaveAttribute("href", /\/estoque\/insumos\/\d+$/);
  await expect(page.getByRole("region", { name: "Saldo indisponível", exact: true })).toHaveCount(0);
  await expect(painel.getByText(/Conferência física não comprovada/)).toBeVisible();

  // alerta sem itens aparece como "sem alerta agora"
  await expect(page.getByRole("region", { name: "Sem alerta agora" })).toContainText("Aberto fora da ordem de validade");

  // As opções existem no HTML inicial; o gráfico montado confirma a hidratação.
  await expect(painel.getByRole("application").first()).toBeVisible();
  await page.getByLabel("Categoria de compra").selectOption({ label: "Sem categoria" });
  await expect(page).toHaveURL(/compra=/);
  await page.reload();
  await expect(page.getByLabel("Categoria de compra")).not.toHaveValue("");
  await page.getByRole("button", { name: "Limpar filtros" }).click();
  await expect(page).not.toHaveURL(/compra=/);

  for (const [width, theme] of [[1280, "light"], [375, "dark"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    const html = page.locator("html");
    await expect(html).toHaveClass(new RegExp(`\\b${theme}\\b`));
    expect(await html.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(width);
    const expandir = semDado.getByRole("button", { name: /Ver todos/ });
    await expandir.focus();
    await expect(expandir).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(expandir).toBeFocused();
    expect(await expandir.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
    await page.keyboard.press("Enter");
    const recolher = semDado.getByRole("button", { name: "Mostrar menos" });
    await expect(recolher).toHaveAttribute("aria-expanded", "true");
    await semDado.screenshot({ path: testInfo.outputPath(`saldo-${width}-${theme}.png`), animations: "disabled" });
    await page.keyboard.press("Enter");
    await expect(expandir).toHaveAttribute("aria-expanded", "false");
  }
  expect(erros).toEqual([]);
});
