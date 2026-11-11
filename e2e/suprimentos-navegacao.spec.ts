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
  ]);
  await expect(barra.getByRole("link", { name: "Visão geral" })).toHaveAttribute("aria-current", "page");
  // nada de segunda fileira de abas ou de "Ferramentas" repetindo a barra
  await expect(page.getByRole("navigation", { name: "Seções de suprimentos" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Ferramentas de estoque" })).toHaveCount(0);

  const secao = page.getByRole("region", { name: "Estoque disponível" });
  const linhas = secao.locator("tbody tr");
  // a tabela abre só com o que precisa de atenção; a lista inteira aparece quando pedida
  await expect(secao.getByRole("button", { name: /^Precisa de atenção/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page).not.toHaveURL(/situacao=/);
  await expect.poll(async () => (await linhas.allInnerTexts()).every((t) => !t.includes("Em dia"))).toBe(true);
  await secao.getByRole("button", { name: /^Todos/ }).click();
  await expect(page).toHaveURL(/situacao=todos/);
  // a lista abre curta (10 linhas): a busca acha o insumo
  const busca = secao.getByPlaceholder("Buscar insumo...");
  await busca.fill("Kit extração E2E");
  await expect(secao.getByRole("row", { name: /Kit extração E2E/ })).toBeVisible();
  await busca.fill("Mix PCR");
  await expect(secao.getByRole("row", { name: /Mix PCR/ })).toBeVisible();
  await busca.fill("");

  // cada filtro mostra só as linhas daquela situação (outros testes mexem no saldo do mock)
  await secao.getByRole("button", { name: /^Em dia/ }).click();
  await expect(secao.getByRole("button", { name: /^Em dia/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/situacao=ok/);
  await expect.poll(async () => (await linhas.allInnerTexts()).every((t) => t.includes("Em dia") || t.includes("Nenhum insumo"))).toBe(true);

  // o filtro também vem pela URL (avisos da visão geral e da página inicial)
  await page.goto("/suprimentos?situacao=sem_disponivel#estoque-disponivel");
  await expect(secao.getByRole("button", { name: /^Sem estoque/ })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await linhas.allInnerTexts()).every((t) => t.includes("Sem estoque") || t.includes("Nenhum insumo"))).toBe(true);
  await secao.getByRole("button", { name: /^Precisa de atenção/ }).click();
  await expect(page).not.toHaveURL(/situacao=/);
  expect(erros).toEqual([]);
});

test("ferramentas do estoque ficam na barra do Estoque, marcando a seção certa", async ({ page }) => {
  await page.goto("/estoque/inventario");
  const barra = page.getByRole("navigation", { name: "Navegação de Suprimentos" });
  await expect(barra.getByRole("link", { name: "Estoque" })).toHaveAttribute("aria-current", "page");
  const secoes = page.getByRole("navigation", { name: "Seções do estoque" });
  await expect(secoes.getByRole("link", { name: "Inventário" })).toHaveAttribute("aria-current", "page");
  await secoes.getByRole("link", { name: "Situação" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Situação do estoque" })).toBeVisible();
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

  // compras formais e prazos ficam dentro de Pedidos, em abas
  await page.goto("/pedido");
  await page.getByRole("navigation", { name: "Seções de pedidos" }).getByRole("link", { name: "Compras formais" }).click();
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

/**
 * 1.7.2: o caminho da aprovação fica evidente. Desde a revisão de 11/11 (D4 e
 * D5) o quadro completo de "Aguardando você" fica só no Início e no sino: a
 * visão geral e Pedidos mostram a linha "Sua vez", que leva direto ao pedido,
 * e as caixas das seis etapas ficam só em Pedidos. Na página do pedido o
 * botão de aprovar fica no topo, no quadro "O que falta agora".
 */
test("coordenador acha o pedido para aprovar e o botão fica no topo da página", async ({ page }) => {
  await page.goto("/suprimentos");
  const suaVez = page.getByRole("status", { name: "Sua vez" });
  await expect(suaVez.getByRole("link", { name: "1 pedido espera a sua aprovação" })).toHaveAttribute("href", "/pedido/502");
  // o quadro inteiro e as caixas das etapas não se repetem aqui
  await expect(page.getByRole("heading", { name: "Aguardando você" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Andamento dos pedidos" })).toHaveCount(0);
  await expect(page.getByTestId("andamento-resumo").getByRole("link", { name: /^\d+ pedidos? em andamento$/ })).toHaveAttribute(
    "href",
    "/pedido",
  );

  // a lista de Pedidos tem as etapas e a mesma linha, que leva direto ao pedido
  await page.goto("/pedido");
  await expect(page.getByRole("heading", { name: "Aguardando você" })).toHaveCount(0);
  await page.getByRole("status", { name: "Sua vez" }).getByRole("link", { name: "1 pedido espera a sua aprovação" }).click();
  await expect(page).toHaveURL(/\/pedido\/502$/);

  // trilha das seis etapas, com a atual marcada
  const trilha = page.getByRole("list", { name: "Etapas do pedido" });
  await expect(trilha.getByRole("listitem")).toHaveCount(6);
  await expect(trilha.locator('[aria-current="step"]')).toContainText("Aprovação");

  // o quadro diz o que falta, com quem está, de quem é a vez e o que vem depois
  const painel = page.getByTestId("painel-agora");
  await expect(painel.getByRole("heading", { name: "Aprovar pedido" })).toBeVisible();
  await expect(painel).toContainText("Com: Coordenação E2E");
  await expect(painel.getByTestId("vez")).toHaveText("Sua vez");
  await expect(painel.getByTestId("depois")).toContainText("o Administrativo formaliza a compra");
  await expect(painel.getByRole("button", { name: "Devolver ao solicitante" })).toBeVisible();

  // o quadro vem antes da lista de itens
  const yPainel = (await painel.boundingBox())!.y;
  const yItens = (await page.getByRole("heading", { name: "Materiais, serviços e equipamentos" }).boundingBox())!.y;
  expect(yPainel).toBeLessThan(yItens);

  // o botão está liberado para quem decide (a gravação é coberta pelos testes com banco real)
  await expect(painel.getByRole("button", { name: "Aprovar pedido" })).toBeEnabled();
});

test("Estoque mostra uma visão por vez: saldo ou lotes; alertas, consumo e custos ficam em outro lugar (D1, L10)", async ({ page }) => {
  await page.goto("/estoque");
  const visoes = page.getByRole("navigation", { name: "O que mostrar do estoque" });
  await expect(visoes.getByRole("link")).toHaveText([/Saldo por insumo/, /Lotes em estoque/]);
  await expect(visoes.getByRole("link", { name: /Saldo por insumo/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Saldo por insumo" })).toBeVisible();
  // nada de lotes, custos, consumo ou cartões de alerta empilhados na mesma página
  await expect(page.getByRole("heading", { name: "Lotes em estoque" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Custo de estoque vigente" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Consumo mensal" })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Alertas do estoque" })).toHaveCount(0);

  await visoes.getByRole("link", { name: /Lotes em estoque/ }).click();
  await expect(page).toHaveURL(/ver=lotes/);
  await expect(page.getByRole("heading", { name: "Lotes em estoque" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saldo por insumo" })).toHaveCount(0);

  // custo é relatório próprio; endereços antigos levam ao novo lugar
  await page.getByRole("link", { name: "Custo do estoque" }).click();
  await expect(page).toHaveURL(/\/estoque\/custos$/);
  await expect(page.getByRole("heading", { level: 1, name: "Custo do estoque" })).toBeVisible();
  await page.goto("/estoque?ver=custos");
  await expect(page).toHaveURL(/\/estoque\/custos$/);
  await page.goto("/estoque?alerta=vencido");
  await expect(page).toHaveURL(/\/estoque\/situacao$/);
});
