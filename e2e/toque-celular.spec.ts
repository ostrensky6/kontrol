import { expect, test } from "@playwright/test";

/**
 * Alvo de toque no celular (auditoria de 16/11, item 8).
 *
 * Em tela de toque, todo controle das telas principais tem pelo menos 32px de
 * área de toque nos dois sentidos. Caixa de marcar, opção e controle deslizante
 * nativos ficam no mínimo do WCAG 2.5.8 (24px). A área conta o tamanho do
 * controle, o rótulo que o envolve e a área invisível de toque (::before ou
 * ::after com recuo negativo). Link dentro de frase fica de fora (exceção do
 * próprio critério).
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const TELAS = [
  "/",
  "/estoque",
  "/estoque/situacao",
  "/estoque/lotes/1",
  "/pedido",
  "/pedido/502",
  "/compras",
  "/planejamento",
  "/insumos",
  "/auditoria",
  "/cadastros",
  "/cadastros/insumos",
  "/notificacoes",
  "/orcamento/1",
  "/orcamento/modelos",
];

for (const tela of TELAS) {
  test(`toque no celular: ${tela}`, async ({ page }) => {
    await page.goto(tela);
    await page.locator("main").first().waitFor();
    await expect(page.locator("main h1").first()).toBeVisible();

    const pequenos = await page.evaluate(() => {
      const seletor =
        'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="menuitem"]';
      const achados: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(seletor)) {
        const caixa = el.getBoundingClientRect();
        if (caixa.width === 0 || caixa.height === 0) continue;
        const estilo = getComputedStyle(el);
        if (estilo.visibility === "hidden" || estilo.display === "none") continue;
        if (el.closest("[hidden], [aria-hidden='true']")) continue;
        if (el.classList.contains("sr-only")) continue; // campo escondido atrás de um botão ou rótulo
        if (el.tagName === "A" && estilo.display === "inline" && !/underline/.test(el.className)) continue; // link em frase

        let largura = caixa.width;
        let altura = caixa.height;
        const rotulo = el.closest("label");
        if (rotulo) {
          const r = rotulo.getBoundingClientRect();
          largura = Math.max(largura, r.width);
          altura = Math.max(altura, r.height);
        }
        for (const pseudo of ["::before", "::after"]) {
          const p = getComputedStyle(el, pseudo);
          if (p.content === "none" || p.position !== "absolute") continue;
          const [topo, base, esquerda, direita] = [p.top, p.bottom, p.left, p.right].map((v) => parseFloat(v));
          if (topo < 0 && base < 0) altura = Math.max(altura, caixa.height - topo - base);
          if (esquerda < 0 && direita < 0) largura = Math.max(largura, caixa.width - esquerda - direita);
        }

        const tipo = el.getAttribute("type") ?? "";
        const minimo = ["checkbox", "radio", "range"].includes(tipo) ? 24 : 32;
        if (largura < minimo || altura < minimo) {
          const nome = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 40);
          achados.push(`${el.tagName.toLowerCase()} ${Math.round(largura)}x${Math.round(altura)} "${nome}"`);
        }
      }
      return achados;
    });

    expect(pequenos, `Controles com área de toque pequena em ${tela}:\n${pequenos.join("\n")}`).toEqual([]);
  });
}
