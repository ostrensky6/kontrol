import { expect, test } from "@playwright/test";

const HISTORICAL_CODES = [
  "Eletrof_vir_hem",
  "Eletrof_vir_tec",
  "Illumina_16S_AC",
  "Illumina_Sh",
  "Illumina_Sh_qPCR",
  "RTqPCR_RNA_virus_H",
  "RTqPCR_RNA_virus_T",
  "Sanger",
  "qPCR_F",
  "qPCR_SF",
];

test("admin acessa itens de Governança incluindo Privilégios", async ({ page }) => {
  await page.goto("/governanca/privilegios");
  await expect(page.getByRole("heading", { name: "Privilégios", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Privilégios por função" })).toBeVisible();
  // 06/11: uma caixinha por função e privilégio (o admin fica travado em "pode").
  for (const funcao of ["Laboratório", "Coordenador", "Gestor", "Administrador"]) {
    await expect(page.getByRole("columnheader", { name: funcao, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("checkbox", { name: "Administrador: Ver auditoria" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Administrador: Ver auditoria" })).toBeDisabled();
  await expect(page.getByText(/^(Sim|Não)$/)).toHaveCount(0);
  // módulos em faixas: um bloco por módulo
  await expect(page.locator("tbody[data-modulo]")).toHaveCount(5);
  // UI2-13: a tabela de engenharia "Papéis antigos" saiu da tela.
  await expect(page.getByRole("heading", { name: /Papéis antigos/ })).toHaveCount(0);

  await expect(page.getByRole("navigation", { name: "Navegação de Governança" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Auditoria" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Backups" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Erros do app" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Usuários", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privilégios" })).toBeVisible();

  await page.goto("/auditoria");
  await expect(page.getByRole("heading", { name: "Auditoria" })).toBeVisible();
  await page.goto("/governanca/backups");
  await expect(page.getByRole("heading", { name: "Backups", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Registro dos backups" })).toBeVisible();
  await page.goto("/governanca/erros");
  await expect(page.getByRole("heading", { name: "Erros do app" })).toBeVisible();
  await page.goto("/usuarios");
  await expect(page.getByRole("heading", { name: "Usuários", exact: true })).toBeVisible();
  // a matriz por função saiu de Usuários: fica só em Privilégios
  await expect(page.getByRole("heading", { name: /Tabela de permissões/ })).toHaveCount(0);
});

test("tela administrativa lista as 10 análises históricas", async ({ page }) => {
  await page.goto("/analises");
  await expect(page.getByRole("heading", { name: /An[aá]lises/, exact: true })).toBeVisible();

  const catalogo = page.getByRole("table");
  for (const codigo of HISTORICAL_CODES) {
    await expect(catalogo).toContainText(codigo);
  }
  await expect(catalogo).toContainText("Shotgun com qPCR");
});

test("orçamento mostra ofertáveis e oculta análise não ofertável", async ({ page }) => {
  await page.goto("/orcamento/demandas/nova");
  await page.waitForLoadState("networkidle");
  const abrirCatalogo = page.getByRole("button", { name: "Selecionar análises" });
  await expect(abrirCatalogo).toBeEnabled();
  await abrirCatalogo.click();
  // a contagem fica no catálogo, junto da busca (28/09: sem frase ao lado do "?")
  await expect(page.getByText("9 análise(s) oficial(is) disponível(is).")).toBeVisible();
  const catalogo = page.getByLabel("Catálogo de análises filtradas");
  await expect(catalogo).toBeVisible();

  for (const codigo of HISTORICAL_CODES.filter((codigo) => codigo !== "Illumina_Sh_qPCR")) {
    await expect(catalogo.getByText(new RegExp(`^${codigo} ·`))).toBeVisible();
  }
  await expect(catalogo.getByText("Illumina_Sh_qPCR")).toHaveCount(0);
});
