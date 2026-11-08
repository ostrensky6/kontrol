import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Auditoria de acessibilidade (WCAG 2.0/2.1, níveis A e AA).
 * Varre as telas principais com axe-core nos temas claro e escuro e REPROVA
 * violações sérias e críticas. Rodando sob PLAYWRIGHT_MOCK_SUPABASE: o gestor
 * já está "logado".
 *
 * Inventário de 06/11/2026 (1.3.5): nenhuma violação séria ou crítica nas
 * telas abaixo, nos dois temas. Uma exceção só entra em EXCECOES com o
 * motivo escrito; qualquer outra violação séria nova reprova a CI.
 */

const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const TEMAS = ["light", "dark"] as const;

const PAGINAS: { nome: string; url: string }[] = [
  { nome: "Home / dashboard", url: "/" },
  { nome: "Ajuda", url: "/ajuda" },
  { nome: "Custeio", url: "/custeio" },
  { nome: "Análises/Lab.", url: "/orcamento/demandas" },
  { nome: "Orçamento (detalhe)", url: "/orcamento/1" },
  { nome: "Estoque", url: "/estoque" },
  { nome: "Compras", url: "/compras" },
  { nome: "Análises", url: "/analises" },
  { nome: "Projetos", url: "/projetos" },
  { nome: "Parâmetros (custeio)", url: "/parametros" },
  { nome: "Parâmetros (econômicos)", url: "/orcamento/parametros" },
  { nome: "Cadastros", url: "/cadastros" },
  { nome: "Qualidade dos cadastros", url: "/cadastros/qualidade" },
  // telas novas de 07–08/11/2026 (auditoria de 08/11)
  { nome: "Leitura de código de barras", url: "/estoque/leitura" },
  { nome: "Equipamentos", url: "/estoque/equipamentos" },
  { nome: "Prazos de compra", url: "/suprimentos/prazos" },
  { nome: "Disputas de reserva", url: "/planejamento/disputas" },
  { nome: "Incidentes", url: "/governanca/incidentes" },
  { nome: "Privilégios", url: "/governanca/privilegios" },
];

/** Exceções conhecidas e justificadas: `${url}|${tema}|${regra}` → motivo. Hoje, nenhuma. */
const EXCECOES: Record<string, string> = {};

type Violacao = { id: string; impact?: string | null; help: string; nodes: unknown[] };

/** Violações sérias/críticas que não estão nas exceções (o que reprova). */
function violacoesQueReprovam(violacoes: Violacao[], url: string, tema: string): Violacao[] {
  return violacoes.filter(
    (v) => (v.impact === "serious" || v.impact === "critical") && !EXCECOES[`${url}|${tema}|${v.id}`],
  );
}

async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
}

function resumo(violacoes: Violacao[]) {
  return violacoes.map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nó(s))`).join("\n");
}

for (const tema of TEMAS) {
  for (const { nome, url } of PAGINAS) {
    test(`a11y AA (${tema === "light" ? "claro" : "escuro"}): ${nome}`, async ({ page }) => {
      // next-themes lê o tema do localStorage antes de pintar
      await page.addInitScript((valor) => {
        try {
          window.localStorage.setItem("theme", valor);
        } catch {
          // sem storage, fica no tema padrão
        }
      }, tema);
      await page.goto(url);
      await page.locator("main, body").first().waitFor();
      if (tema === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      const resultado = await scan(page);
      const reprovam = violacoesQueReprovam(resultado.violations, url, tema);
      expect(reprovam, `Violações sérias/críticas em ${url} (${tema}):\n${resumo(reprovam)}`).toEqual([]);
    });
  }
}

test("a11y: o gate reprova uma regressão séria introduzida numa fixture", async ({ page }) => {
  // texto cinza-claro sobre branco (contraste ~2:1) é violação "serious" de color-contrast
  await page.setContent(
    `<!doctype html><html lang="pt-BR"><head><title>Fixture</title></head><body><main><h1>Fixture</h1><p style="color:#bbbbbb;background:#ffffff">Texto com pouco contraste</p></main></body></html>`,
  );
  const resultado = await scan(page);
  const reprovam = violacoesQueReprovam(resultado.violations, "/fixture", "light");
  expect(reprovam.map((v) => [v.id, v.impact])).toContainEqual(["color-contrast", "serious"]);
});
