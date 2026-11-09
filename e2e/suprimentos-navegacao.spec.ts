import { expect, test } from "@playwright/test";

/**
 * Suprimentos reorganizado (1.7.1): uma barra só, sem link repetido; a visão
 * geral mostra o estoque disponível; Pedidos mostra cada pedido pela etapa.
 */
test("barra de Suprimentos tem um link por tarefa e a visão geral mostra o estoque disponível", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (erro) => erros.push(erro.message));
  await page.goto("/suprimentos");

  const barra = page.getByRole("navigation", { name: "Navegação de Suprimentos" });
  await expect(barra.getByRole("link")).toHaveText([
    "Visão geral",
    "Estoque",
    "Planejamento",
    "Pedidos",
    "Recebimento",
    "Equipamentos",
    "Notificações",
  ]);
  await expect(barra.getByRole("link", { name: "Visão geral" })).toHaveAttribute("aria-current", "page");
  // nada de segunda fileira de abas ou de "Ferramentas" repetindo a barra
  await expect(page.getByRole("navigation", { name: "Seções de suprimentos" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Ferramentas de estoque" })).toHaveCount(0);

  const secao = page.getByRole("region", { name: "Estoque disponível" });
  await expect(secao.getByRole("row", { name: /Kit extração E2E/ })).toBeVisible();
  await expect(secao.getByRole("row", { name: /Mix PCR/ })).toBeVisible();

  // cada filtro mostra só as linhas daquela situação (outros testes mexem no saldo do mock)
  const linhas = secao.locator("tbody tr");
  await secao.getByRole("button", { name: /^Em dia/ }).click();
  await expect(secao.getByRole("button", { name: /^Em dia/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/situacao=ok/);
  await expect.poll(async () => (await linhas.allInnerTexts()).every((t) => t.includes("Estoque OK") || t.includes("Nenhum insumo"))).toBe(true);

  // o filtro também vem pela URL (avisos da visão geral e da página inicial)
  await page.goto("/suprimentos?situacao=sem_disponivel#estoque-disponivel");
  await expect(secao.getByRole("button", { name: /^Sem estoque/ })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await linhas.allInnerTexts()).every((t) => t.includes("Sem estoque") || t.includes("Nenhum insumo"))).toBe(true);
  await secao.getByRole("button", { name: /^Todos/ }).click();
  await expect(page).not.toHaveURL(/situacao=/);
  await expect(secao.getByRole("row", { name: /Kit extração E2E/ })).toBeVisible();
  expect(erros).toEqual([]);
});

test("ferramentas do estoque ficam na barra do Estoque, marcando a seção certa", async ({ page }) => {
  await page.goto("/estoque/inventario");
  const barra = page.getByRole("navigation", { name: "Navegação de Suprimentos" });
  await expect(barra.getByRole("link", { name: "Estoque" })).toHaveAttribute("aria-current", "page");
  const secoes = page.getByRole("navigation", { name: "Seções do estoque" });
  await expect(secoes.getByRole("link", { name: "Inventário" })).toHaveAttribute("aria-current", "page");
  await secoes.getByRole("link", { name: "Controle de Estoque" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Controle de Estoque" })).toBeVisible();
  await expect(barra.getByRole("link", { name: "Estoque" })).toHaveAttribute("aria-current", "page");

  // Equipamentos tem item próprio: a barra do Estoque some
  await page.goto("/estoque/equipamentos");
  await expect(barra.getByRole("link", { name: "Equipamentos" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Seções do estoque" })).toHaveCount(0);
});

test("pedidos aparecem pela etapa, da solicitação ao pagamento", async ({ page }) => {
  await page.goto("/pedido");
  await expect(page.getByRole("heading", { level: 1, name: "Pedidos" })).toBeVisible();
  const etapas = page.getByRole("navigation", { name: "Etapas do pedido" }).getByRole("button");
  await expect(etapas).toHaveCount(6);

  await page.getByRole("navigation", { name: "Etapas do pedido" }).getByRole("button", { name: /Administrativo/ }).click();
  await expect(page).toHaveURL(/etapa=administrativo/);
  const linha = page.getByRole("row", { name: /Reagente do ciclo seguinte E2E/ });
  await expect(linha.getByRole("img", { name: "Etapa 3 de 6: Administrativo" })).toBeVisible();
  await expect(linha).toContainText("Aguardar o ciclo");

  // compras formais e prazos ficam dentro de Pedidos
  await page.getByRole("navigation", { name: "Compras e prazos" }).getByRole("link", { name: "Compras formais" }).click();
  await expect(page).toHaveURL(/\/compras$/);
  await expect(
    page.getByRole("navigation", { name: "Navegação de Suprimentos" }).getByRole("link", { name: "Pedidos" }),
  ).toHaveAttribute("aria-current", "page");
});

test("Novo pedido da visão geral abre o formulário em Pedidos", async ({ page }) => {
  await page.goto("/suprimentos");
  await page.getByRole("link", { name: "Novo pedido" }).click();
  await expect(page).toHaveURL(/\/pedido\?novo=1$/);
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Novo pedido" })).toBeVisible();
});
