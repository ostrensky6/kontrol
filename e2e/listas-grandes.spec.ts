import { expect, test } from "@playwright/test";

/**
 * Listas grandes (auditoria de 16/11, item 3): Pedidos e Compras trazem tudo o
 * que está em andamento e, do que já foi encerrado, só os mais recentes; a
 * Auditoria alcança qualquer data pelo período.
 */

test("auditoria filtra por período e mantém o período ao trocar de cadastro", async ({ page }) => {
  await page.goto("/auditoria");
  await expect(page.getByRole("heading", { level: 1, name: "Auditoria" })).toBeVisible();

  await page.getByLabel("De", { exact: true }).fill("2026-11-01");
  await page.getByLabel("Até", { exact: true }).fill("2026-11-16");
  await page.getByRole("button", { name: "Filtrar período" }).click();
  await expect(page).toHaveURL(/\/auditoria\?de=2026-11-01&ate=2026-11-16$/);
  await expect(page.getByLabel("De", { exact: true })).toHaveValue("2026-11-01");
  await expect(page.getByLabel("Até", { exact: true })).toHaveValue("2026-11-16");
  await expect(page.getByRole("alert").filter({ hasText: "Parte desta tela não carregou" })).toHaveCount(0);

  // o botão do cadastro leva o período junto
  await page.getByRole("link", { name: "Lotes", exact: true }).click();
  await expect(page).toHaveURL(/tabela=lotes_estoque&de=2026-11-01&ate=2026-11-16$/);
  await expect(page.getByLabel("De", { exact: true })).toHaveValue("2026-11-01");

  // limpar o período mantém o cadastro escolhido
  await page.getByRole("link", { name: "Limpar período" }).click();
  await expect(page).toHaveURL(/\/auditoria\?tabela=lotes_estoque$/);
  await expect(page.getByLabel("De", { exact: true })).toHaveValue("");
  await expect(page.getByRole("link", { name: "Limpar período" })).toHaveCount(0);
});

test("auditoria ignora período inválido em vez de quebrar", async ({ page }) => {
  await page.goto("/auditoria?de=ontem&ate=2026-02-31&antes=abc");
  await expect(page.getByRole("heading", { level: 1, name: "Auditoria" })).toBeVisible();
  await expect(page.getByLabel("De", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Até", { exact: true })).toHaveValue("");
  await expect(page.getByRole("alert").filter({ hasText: "Parte desta tela não carregou" })).toHaveCount(0);
});

test("pedidos: em andamento e encerrados aparecem, com contagem, e a lista completa também abre", async ({ page }) => {
  await page.goto("/pedido");
  const filtros = page.getByRole("group", { name: "Mostrar pedidos" });
  // lista pequena: nada foi cortado, então todos os botões contam e não há aviso de lista parcial
  for (const rotulo of ["Em andamento", "Concluídos", "Cancelados", "Todos"]) {
    await expect(filtros.getByRole("button", { name: new RegExp(`^${rotulo}\\s*\\d+$`) })).toBeVisible();
  }
  await filtros.getByRole("button", { name: /^Todos/ }).click();
  await expect(page.getByText(/mais recentes, de/)).toHaveCount(0);
  const linhasCurta = await page.getByRole("row").count();

  await page.goto("/pedido?etapa=todos&encerrados=todos");
  await expect(page.getByRole("heading", { level: 1, name: "Pedidos" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Parte desta tela não carregou" })).toHaveCount(0);
  await expect(page.getByRole("row")).toHaveCount(linhasCurta);
});

test("compras: a lista abre curta e completa sem aviso de leitura", async ({ page }) => {
  for (const endereco of ["/compras", "/compras?encerradas=todas"]) {
    await page.goto(endereco);
    await expect(page.getByRole("heading", { level: 1, name: "Compras com fornecedor" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Parte desta tela não carregou" })).toHaveCount(0);
    await expect(page.getByText(/mais recentes, de/)).toHaveCount(0);
  }
});
