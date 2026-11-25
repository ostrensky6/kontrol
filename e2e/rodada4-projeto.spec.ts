import { expect, test } from "@playwright/test";

// Rodada 4 de layout e usabilidade (25/11/2026): a ficha do projeto reúne
// orçamentos, pedidos e compras ligados a ele, sem se contradizer.

test("ficha do projeto mostra os orçamentos ligados no alto, sem dizer que não há nenhum", async ({ page }) => {
  await page.goto("/projetos/1");
  const orcamentos = page.getByRole("region", { name: "Orçamentos" });
  await expect(orcamentos.getByRole("link", { name: "Demanda Demo — Projeto + Análises" })).toHaveAttribute("href", /\/orcamento\/demandas\/\d+$/);
  await expect(orcamentos.getByText("Nenhum orçamento ligado a este projeto.")).toHaveCount(0);
  // a seção antiga do pé da página saiu: o conteúdo subiu para cá
  await expect(page.getByRole("heading", { name: "Orçamentos e propostas" })).toHaveCount(0);
});

test("ficha do projeto lista os pedidos do projeto com a etapa e o link para cada um", async ({ page }) => {
  await page.goto("/projetos/1");
  const pedidos = page.getByRole("region", { name: "Pedidos" });
  await expect(pedidos).toBeVisible();
  const link = pedidos.getByRole("link", { name: "Reagente do ciclo seguinte E2E" });
  await expect(link).toHaveAttribute("href", "/pedido/501");
  await expect(pedidos.getByText("Nº 0501")).toBeVisible();
  await expect(pedidos.getByText(/3\/6/).first()).toBeVisible();
  await expect(pedidos.getByRole("link", { name: "Ver todos" })).toHaveAttribute("href", /\/pedido/);
});

test("compras do projeto aparecem como compra, não como pedido", async ({ page }) => {
  await page.goto("/projetos/1");
  const compras = page.getByRole("region", { name: "Compras" });
  await expect(compras.getByRole("link", { name: "Compra #9401" })).toHaveAttribute("href", "/compras/9401");
  await expect(compras.getByRole("link", { name: /^Pedido 94/ })).toHaveCount(0);
  await expect(page.getByText(/compra\(s\) com fornecedor/)).toBeVisible();
});

test("lista de projetos mostra o que está em andamento em cada um e leva à ficha", async ({ page }) => {
  await page.goto("/projetos");
  await expect(page.getByRole("columnheader", { name: "Em andamento" })).toBeVisible();
  const linha = page.getByRole("row").filter({ has: page.getByRole("link", { name: "Projeto E2E", exact: true }) });
  const andamento = linha.getByRole("link", { name: /\d+ pedidos? · \d+ compras?/ });
  await expect(andamento).toHaveAttribute("href", "/projetos/1#projeto-pedidos");
  await andamento.click();
  await expect(page).toHaveURL(/\/projetos\/1#projeto-pedidos$/);
  await expect(page.getByRole("region", { name: "Pedidos" })).toBeVisible();
});
