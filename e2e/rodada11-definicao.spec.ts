import { expect, test, type Locator } from "@playwright/test";

// Rodada 11 de layout e usabilidade (26/11/2026): definição e acabamento.
// Etiquetas numa forma só, estados vazios com ícone, contagens em português
// corrente, linhas de tabela mais baixas e o que estava apertado no celular.

const estilo = (alvo: Locator, propriedade: string) =>
  alvo.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), propriedade);

test.describe("rodada 11: definição (computador)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("lista de Pedidos: status em ponto e nome, sem coluna de ações vazia e contagem por extenso", async ({ page }) => {
    await page.goto("/pedido");
    const tabela = page.locator("main table").first();
    const status = tabela.getByText("Aguardando coordenador", { exact: true }).first();
    await expect(status).toBeVisible();
    // é texto com um ponto colorido ao lado, não um bloco com fundo
    expect(await estilo(status, "background-color")).toBe("rgba(0, 0, 0, 0)");
    expect(await estilo(status.locator(".."), "background-color")).toBe("rgba(0, 0, 0, 0)");
    // a coluna de ações só existe quando algum pedido da lista dá para apagar (0186: qualquer etapa)
    const excluiveis = await tabela.getByRole("button", { name: /^Apagar/ }).count();
    await expect(tabela.getByRole("columnheader", { name: "Ações" })).toHaveCount(excluiveis > 0 ? 1 : 0);
    await expect(page.getByRole("status").filter({ hasText: /^\d+ registros$/ })).toBeVisible();
    await expect(page.getByText("registro(s)")).toHaveCount(0);
  });

  test("etapas do pedido: o número fica numa bolinha e a caixa não corta o nome", async ({ page }) => {
    await page.goto("/pedido");
    const etapas = page.getByRole("navigation", { name: "Etapas do pedido" }).getByRole("button");
    await expect(etapas).toHaveCount(6);
    const administrativo = etapas.filter({ hasText: "Administrativo" });
    await expect(administrativo).toHaveAccessibleName(/^Etapa 3/);
    const nome = administrativo.getByText("Administrativo", { exact: true });
    const caixa = (await administrativo.boundingBox())!;
    const rotulo = (await nome.boundingBox())!;
    expect(rotulo.x + rotulo.width).toBeLessThanOrEqual(caixa.x + caixa.width);
  });

  test("pedido: seções vazias mostram o ícone do assunto e os anexos são contados por extenso", async ({ page }) => {
    await page.goto("/pedido/501");
    for (const texto of [
      "Nenhum documento registrado.",
      "Nenhuma comunicação registrada.",
      "Nenhuma aprovação formal registrada ainda.",
      "Sem eventos registrados ainda.",
    ]) {
      const vazio = page.locator("[data-vazio]").filter({ hasText: texto });
      await expect(vazio, texto).toBeVisible();
      await expect(vazio.locator("svg"), texto).toHaveCount(1);
    }
    await expect(page.getByText("0 anexos", { exact: true })).toBeVisible();
    // os títulos das seções têm o mesmo peso e a mesma cor
    const cores = new Set<string>();
    for (const titulo of ["Documentos", "Comunicações", "Aprovações e decisões", "Linha do tempo", "Materiais, serviços e equipamentos"]) {
      cores.add(await estilo(page.getByRole("heading", { name: titulo, exact: true }), "color"));
    }
    expect([...cores]).toHaveLength(1);
  });

  test("etiquetas de situação têm uma forma só: pílula sem borda", async ({ page }) => {
    // Início (situação da linha), pedido (aprovações e anexos) e análises (ofertável)
    for (const url of ["/", "/pedido/501", "/analises"]) {
      await page.goto(url);
      const etiqueta = page.locator("main [data-etiqueta]").filter({ visible: true }).first();
      await expect(etiqueta, url).toBeVisible();
      expect(await estilo(etiqueta, "border-top-width"), url).toBe("0px");
      expect(parseFloat(await estilo(etiqueta, "border-top-left-radius")), url).toBeGreaterThan(100);
      expect(await estilo(etiqueta, "font-size"), url).toBe("12px");
      expect(await estilo(etiqueta, "white-space"), url).toBe("nowrap");
    }
  });

  test("análises: as duas etiquetas ficam lado a lado e a tabela cabe em 1280 px", async ({ page }) => {
    await page.goto("/analises");
    const linha = page.locator("main table tbody tr").first();
    // a primeira linha muda conforme o que os outros testes gravaram: vale para qualquer situação
    const etiquetaAtiva = linha.getByText(/^(Ativa|Inativa)$/);
    const etiquetaOfertavel = linha.getByText(/^(Ofertável|Não ofertável)$/);
    await expect(etiquetaAtiva).toBeVisible();
    await expect(etiquetaOfertavel).toBeVisible();
    const ativa = (await etiquetaAtiva.boundingBox())!;
    const ofertavel = (await etiquetaOfertavel.boundingBox())!;
    expect(Math.abs(ativa.y - ofertavel.y)).toBeLessThan(2);
    const sobra = await page
      .locator("main table")
      .first()
      .evaluate((el) => {
        const caixa = el.parentElement!;
        return caixa.scrollWidth - caixa.clientWidth;
      });
    expect(sobra).toBeLessThanOrEqual(1);
  });

  test("saldo do estoque: entrada e baixa são botões com contorno e a tabela não rola para o lado", async ({ page }) => {
    await page.goto("/estoque");
    const linha = page.locator("main table tbody tr").filter({ hasText: "Kit extração E2E" });
    const chegada = linha.getByRole("button", { name: "Registrar chegada" });
    const baixa = linha.getByRole("button", { name: "Dar baixa" });
    for (const botao of [chegada, baixa]) {
      await expect(botao).toBeVisible();
      expect(await estilo(botao, "border-top-width")).toBe("1px");
    }
    // em 1280 px ficam um sobre o outro, com a mesma largura
    const a = (await chegada.boundingBox())!;
    const b = (await baixa.boundingBox())!;
    expect(Math.abs(a.width - b.width)).toBeLessThan(2);
    const sobra = await linha.evaluate((el) => {
      const caixa = el.closest("table")!.parentElement!;
      return caixa.scrollWidth - caixa.clientWidth;
    });
    expect(sobra).toBeLessThanOrEqual(1);
  });
});

test.describe("rodada 11: definição (celular)", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("cabeçalho do pedido usa a largura toda e as ações ficam embaixo", async ({ page }) => {
    await page.goto("/pedido/501");
    const titulo = page.getByRole("heading", { level: 1 });
    const caixaTitulo = (await titulo.boundingBox())!;
    expect(caixaTitulo.width).toBeGreaterThan(300);
    const editar = page.getByRole("button", { name: "Editar" }).first();
    const fatos = page.getByTestId("pedido-fatos");
    const yFatos = (await fatos.boundingBox())!;
    const yEditar = (await editar.boundingBox())!;
    expect(yEditar.y).toBeGreaterThan(yFatos.y + yFatos.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test("custos do projeto do orçamento cabem na tela, sem rolar para o lado", async ({ page }) => {
    await page.goto("/orcamento/demandas/1?etapa=projeto");
    await expect(page.getByRole("heading", { name: "Exportar custos do projeto" })).toBeVisible();
    const largura = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(largura).toBeLessThanOrEqual(390);
  });

  test("Novo orçamento: os cartões de modalidade ficam baixos, com o ícone ao lado do nome", async ({ page }) => {
    await page.goto("/orcamento/demandas/nova");
    const cartao = page.getByRole("radiogroup", { name: /Modalidade/ }).locator("label").first();
    await expect(cartao).toBeVisible();
    expect((await cartao.boundingBox())!.height).toBeLessThan(64);
  });
});
