import { expect, test } from "@playwright/test";

/**
 * Organização de 11/11/2026: Compras e Estoque são módulos próprios. A barra de
 * Compras vai do pedido ao recebimento; a visão geral mostra o que espera você
 * e o andamento dos pedidos; a tabela do estoque disponível é a de Saldo e lotes.
 */
const BARRA_DE_COMPRAS = ["Visão geral", "Pedidos", "Compras com fornecedor", "Recebimento", "Prazos de compra"];
const BARRA_DO_ESTOQUE = [
  "Saldo e lotes",
  "Situação do estoque",
  "Entrada e saída por leitura",
  "Inventário",
  "Etiquetas",
  "Custo do estoque",
  "Equipamentos",
];

test("barra de Compras tem um link por tarefa e a visão geral mostra o que espera você e o andamento", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (erro) => erros.push(erro.message));
  await page.goto("/suprimentos");

  await expect(page.getByRole("heading", { level: 1, name: "Compras" })).toBeVisible();
  const barra = page.getByRole("navigation", { name: "Navegação de Compras" });
  await expect(barra.getByRole("link")).toHaveText(BARRA_DE_COMPRAS);
  await expect(barra.getByRole("link", { name: "Visão geral" })).toHaveAttribute("aria-current", "page");
  // uma barra só: nada de segunda fileira de abas repetindo os mesmos links
  for (const fileira of ["Seções de suprimentos", "Seções de pedidos", "Ferramentas de estoque", "Navegação de Suprimentos"]) {
    await expect(page.getByRole("navigation", { name: fileira }), fileira).toHaveCount(0);
  }

  // os dois quadros da visão geral, inteiros
  await expect(page.getByRole("heading", { name: "Aguardando você" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Andamento dos pedidos" })).toBeVisible();

  // a tabela do estoque não se repete aqui: a visão geral leva ao Estoque
  await expect(page.getByPlaceholder("Buscar insumo...")).toHaveCount(0);
  const paraEstoque = page.getByTestId("compras-para-estoque");
  await expect(paraEstoque.getByRole("link", { name: "Ver o saldo e os lotes" })).toHaveAttribute("href", "/estoque");
  await expect(paraEstoque.getByRole("link", { name: "Ver o que precisa repor" })).toHaveAttribute("href", "/estoque/situacao");
  expect(erros).toEqual([]);
});

test("o estoque disponível fica em Saldo e lotes, com filtro por situação e a validade mais próxima", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (erro) => erros.push(erro.message));
  await page.goto("/estoque");
  await expect(page.getByRole("heading", { level: 1, name: "Saldo e lotes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saldo por insumo" })).toBeVisible();

  const filtros = page.getByRole("group", { name: "Filtrar por situação" });
  const linhas = page.locator("main tbody tr");
  // a lista abre inteira; a coluna que só a visão geral mostrava veio junto
  await expect(filtros.getByRole("button", { name: /^Todos/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("columnheader", { name: /Validade mais próxima/ })).toBeVisible();
  // a lista abre curta (10 linhas): a busca acha o insumo
  const busca = page.getByPlaceholder("Buscar insumo...");
  await busca.fill("Kit extração E2E");
  await expect(page.getByRole("row", { name: /Kit extração E2E/ })).toBeVisible();
  await busca.fill("Mix PCR");
  await expect(page.getByRole("row", { name: /Mix PCR/ })).toBeVisible();
  await busca.fill("");

  // cada filtro mostra só as linhas daquela situação (outros testes mexem no saldo do mock)
  await filtros.getByRole("button", { name: /^Em dia/ }).click();
  await expect(filtros.getByRole("button", { name: /^Em dia/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/situacao=ok/);
  await expect.poll(async () => (await linhas.allInnerTexts()).every((t) => t.includes("Em dia") || t.includes("Nenhum insumo"))).toBe(true);
  await filtros.getByRole("button", { name: /^Precisa de atenção/ }).click();
  await expect(page).toHaveURL(/situacao=atencao/);
  await expect.poll(async () => (await linhas.allInnerTexts()).every((t) => !t.includes("Em dia"))).toBe(true);
  await filtros.getByRole("button", { name: /^Todos/ }).click();
  await expect(page).not.toHaveURL(/situacao=/);

  // o endereço antigo da visão geral, com filtro, leva à mesma tabela já filtrada
  await page.goto("/suprimentos?situacao=sem_disponivel#estoque-disponivel");
  await expect(page).toHaveURL(/\/estoque\?situacao=sem_disponivel/);
  await expect(filtros.getByRole("button", { name: /^Sem estoque/ })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await linhas.allInnerTexts()).every((t) => t.includes("Sem estoque") || t.includes("Nenhum insumo"))).toBe(true);
  expect(erros).toEqual([]);
});

test("ferramentas do estoque ficam na barra do Estoque, marcando a seção certa", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/estoque/inventario");
  const barra = page.getByRole("navigation", { name: "Navegação de Estoque" });
  await expect(barra.getByRole("link")).toHaveText(BARRA_DO_ESTOQUE);
  await expect(barra.locator("a[aria-current]")).toHaveText(["Inventário"]);
  // os sete lugares aparecem inteiros, sem rolagem escondendo o último
  for (const lugar of BARRA_DO_ESTOQUE) {
    await expect(barra.getByRole("link", { name: lugar, exact: true }), lugar).toBeInViewport({ ratio: 1 });
  }
  await expect(page.getByRole("navigation", { name: "Seções do estoque" })).toHaveCount(0);

  await barra.getByRole("link", { name: "Situação do estoque" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Situação do estoque" })).toBeVisible();
  await expect(barra.locator("a[aria-current]")).toHaveText(["Situação do estoque"]);

  // Equipamentos é um lugar do Estoque
  await page.goto("/estoque/equipamentos");
  await expect(barra.locator("a[aria-current]")).toHaveText(["Equipamentos"]);
  // etiquetas e a triagem dos códigos lidos também ficam no Estoque
  await page.goto("/etiquetas");
  await expect(barra.locator("a[aria-current]")).toHaveText(["Etiquetas"]);
  await page.goto("/scanner/triagem");
  await expect(barra.locator("a[aria-current]")).toHaveText(["Entrada e saída por leitura"]);
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

  // compras com fornecedor, recebimento e prazos são lugares da barra de Compras
  await page.goto("/pedido");
  const barra = page.getByRole("navigation", { name: "Navegação de Compras" });
  await expect(barra.locator("a[aria-current]")).toHaveText(["Pedidos"]);
  await barra.getByRole("link", { name: "Compras com fornecedor" }).click();
  await expect(page).toHaveURL(/\/compras$/);
  await expect(page.getByRole("heading", { level: 1, name: "Compras com fornecedor" })).toBeVisible();
  await expect(barra.locator("a[aria-current]")).toHaveText(["Compras com fornecedor"]);
  await barra.getByRole("link", { name: "Recebimento" }).click();
  await expect(page).toHaveURL(/\/recebimento$/);
  await expect(barra.locator("a[aria-current]")).toHaveText(["Recebimento"]);
});

test("Novo pedido da visão geral abre o formulário em Pedidos", async ({ page }) => {
  await page.goto("/suprimentos");
  await page.getByRole("link", { name: "Novo pedido" }).click();
  await expect(page).toHaveURL(/\/pedido\?novo=1$/);
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Novo pedido" })).toBeVisible();
});

/**
 * 1.7.2: o caminho da aprovação fica evidente. Na organização de 11/11/2026 a
 * visão geral de Compras voltou a ter o quadro "Aguardando você" e as caixas
 * das seis etapas; em Pedidos o quadro "Aguardando você" voltou inteiro (etapa 3)
 * e leva direto ao pedido.
 * Na página do pedido o botão de aprovar fica no topo, em "O que falta agora".
 */
test("coordenador acha o pedido para aprovar e o botão fica no topo da página", async ({ page }) => {
  await page.goto("/suprimentos");
  const aguardando = page.locator("section").filter({ has: page.getByRole("heading", { name: "Aguardando você" }) });
  await expect(aguardando.getByRole("link", { name: /Pedidos para você aprovar: \d+\. Ver a lista/ })).toHaveAttribute(
    "href",
    "/pedido?etapa=aprovacao",
  );
  await expect(aguardando.getByRole("link", { name: /Primers para aprovar E2E/ })).toHaveAttribute("href", "/pedido/502");

  // andamento: as seis etapas, na ordem, cada uma abrindo a lista filtrada
  const andamento = page.getByRole("region", { name: "Andamento dos pedidos" });
  await expect(andamento.getByRole("link", { name: /^Etapa \d/ })).toHaveCount(6);
  await expect(andamento.getByRole("link", { name: /^Etapa 2, Aprovação: \d+ pedidos?$/ })).toHaveAttribute(
    "href",
    "/pedido?etapa=aprovacao",
  );
  await expect(andamento.getByRole("link", { name: /^A receber: / })).toHaveAttribute("href", "/recebimento");
  await expect(andamento.getByRole("link", { name: "Ver todos os pedidos" })).toHaveAttribute("href", "/pedido");

  // a lista de Pedidos tem as etapas e o quadro "Aguardando você", que leva direto ao pedido
  await page.goto("/pedido");
  const emPedidos = page.locator("section").filter({ has: page.getByRole("heading", { name: "Aguardando você" }) });
  await expect(emPedidos.getByRole("link", { name: /Pedidos para você aprovar: \d+\. Ver a lista/ })).toHaveAttribute(
    "href",
    "/pedido?etapa=aprovacao",
  );
  // o quadro de Pedidos só traz pendências de pedidos: lote em quarentena e manutenção ficam no Início
  await expect(emPedidos.locator('a[href^="/estoque"], a[href^="/equipamentos"], a[href^="/planejamento"]')).toHaveCount(0);
  // a linha resumida "Sua vez" deu lugar ao quadro: não ficam os dois
  await expect(page.getByRole("status", { name: "Sua vez" })).toHaveCount(0);
  await emPedidos.getByRole("link", { name: /Primers para aprovar E2E/ }).click();
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

  // custo é relatório próprio, na barra do Estoque; endereços antigos levam ao novo lugar
  await page.getByRole("navigation", { name: "Navegação de Estoque" }).getByRole("link", { name: "Custo do estoque" }).click();
  await expect(page).toHaveURL(/\/estoque\/custos$/);
  await expect(page.getByRole("heading", { level: 1, name: "Custo do estoque" })).toBeVisible();
  await page.goto("/estoque?ver=custos");
  await expect(page).toHaveURL(/\/estoque\/custos$/);
  await page.goto("/estoque?alerta=vencido");
  await expect(page).toHaveURL(/\/estoque\/situacao$/);
});
