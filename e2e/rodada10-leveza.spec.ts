import { expect, test, type Locator } from "@playwright/test";

// Rodada 10 de layout e usabilidade (26/11/2026): leveza visual. O azul cheio
// fica para a ação principal; navegação e filtros usam azul claro; os campos
// são brancos com contorno nítido; toda tabela tem a mesma faixa no cabeçalho.

const estilo = (alvo: Locator, propriedade: string) =>
  alvo.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), propriedade);

const BRANCO = "rgb(255, 255, 255)";
const AZUL_DA_MARCA = "rgb(1, 72, 157)";

test.describe("rodada 10: leveza visual", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("lugares do módulo ficam sem moldura e o aberto em azul claro, não em azul cheio", async ({ page }) => {
    await page.goto("/pedido");
    const barra = page.getByRole("navigation", { name: "Navegação de Compras" });
    const aberto = barra.getByRole("link", { name: "Pedidos", exact: true });
    const outro = barra.getByRole("link", { name: "Recebimento", exact: true });
    await expect(aberto).toHaveAttribute("aria-current", "page");
    await expect(outro).not.toHaveAttribute("aria-current", "page");
    for (const link of [aberto, outro]) {
      expect(await estilo(link, "border-top-width")).toBe("0px");
      expect(await estilo(link, "box-shadow")).toBe("none");
    }
    expect(await estilo(aberto, "color")).toBe(AZUL_DA_MARCA);
    expect(await estilo(aberto, "background-color")).not.toBe(AZUL_DA_MARCA);
    // o lugar fechado não tem fundo: é só o nome
    expect(await estilo(outro, "background-color")).toBe("rgba(0, 0, 0, 0)");
  });

  test("menu lateral: ícone sem caixinha e módulo aberto com a barrinha azul", async ({ page }) => {
    await page.goto("/estoque");
    const menu = page.getByRole("navigation", { name: "Navegação principal" });
    const aberto = menu.getByRole("link", { name: "Estoque", exact: true });
    const fechado = menu.getByRole("link", { name: "Projetos", exact: true });
    await expect(aberto).toHaveAttribute("aria-current", /page|location/);
    for (const link of [aberto, fechado]) {
      // o ícone é filho direto do link, sem um quadro com borda em volta
      const icone = link.locator("svg").first();
      expect(await icone.evaluate((el) => el.parentElement?.tagName)).toBe("A");
    }
    expect(await aberto.locator("span[aria-hidden='true']").count()).toBe(1);
    expect(await fechado.locator("span[aria-hidden='true']").count()).toBe(0);
  });

  test("campo de busca e botão de contorno são brancos, com borda mais nítida que a da caixa", async ({ page }) => {
    await page.goto("/pedido");
    const busca = page.getByPlaceholder(/Buscar pedido/);
    await expect(busca).toBeVisible();
    expect(await estilo(busca, "background-color")).toBe(BRANCO);
    expect(await estilo(busca, "border-top-color")).toBe("rgb(203, 213, 225)");
    const densidade = page.getByRole("button", { name: /^Usar densidade/ });
    expect(await estilo(densidade, "background-color")).toBe(BRANCO);
  });

  test("filtro ligado fica em azul claro com contorno, sem competir com o botão principal", async ({ page }) => {
    await page.goto("/pedido");
    const ligado = page.getByRole("button", { name: /^Em andamento/, pressed: true });
    await expect(ligado).toBeVisible();
    expect(await estilo(ligado, "color")).toBe(AZUL_DA_MARCA);
    expect(await estilo(ligado, "background-color")).not.toBe(AZUL_DA_MARCA);
    expect(await estilo(ligado, "border-top-color")).toBe(AZUL_DA_MARCA);
    const principal = page.getByRole("button", { name: "Novo pedido" }).first();
    expect(await estilo(principal, "background-color")).toBe(AZUL_DA_MARCA);
  });

  test("toda tabela tem a mesma faixa clara no cabeçalho", async ({ page }) => {
    const faixas = new Set<string>();
    // a lista de Pedidos já tinha a faixa; o Início, a ficha do projeto e a lista de projetos, não
    for (const url of ["/pedido", "/", "/projetos/1", "/projetos"]) {
      await page.goto(url);
      const cabecalho = page.locator("main table thead").first();
      await expect(cabecalho, url).toBeVisible();
      const fundo = await estilo(cabecalho, "background-color");
      expect(fundo, url).not.toBe("rgba(0, 0, 0, 0)");
      faixas.add(fundo);
    }
    expect([...faixas]).toHaveLength(1);
  });

  test("o foco pelo teclado continua visível, com contorno fino", async ({ page }) => {
    await page.goto("/pedido");
    const principal = page.getByRole("button", { name: "Novo pedido" }).first();
    await principal.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(principal).toBeFocused();
    expect(await estilo(principal, "outline-style")).toBe("solid");
    expect(await estilo(principal, "outline-width")).toBe("2px");
  });
});
