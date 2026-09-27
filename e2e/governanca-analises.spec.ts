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
  await expect(page.getByRole("heading", { name: "Privilégios por papel" })).toBeVisible();
  // UI2-13: a tabela de engenharia "Papéis antigos" saiu da tela.
  await expect(page.getByRole("heading", { name: /Papéis antigos/ })).toHaveCount(0);

  await expect(page.getByRole("navigation", { name: "Navegação de Governança" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Auditoria" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Backups" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Usuários e permissões" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privilégios" })).toBeVisible();

  await page.goto("/auditoria");
  await expect(page.getByRole("heading", { name: "Auditoria" })).toBeVisible();
  await page.goto("/governanca/backups");
  await expect(page.getByRole("heading", { name: "Backups" })).toBeVisible();
  await page.goto("/usuarios");
  await expect(page.getByRole("heading", { name: "Usuários e permissões" })).toBeVisible();
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
  await expect(page.getByText("9 análise(s) oficial(is) disponível(is).")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const abrirCatalogo = page.getByRole("button", { name: "Selecionar análises" });
  await expect(abrirCatalogo).toBeEnabled();
  await abrirCatalogo.click();
  const catalogo = page.getByLabel("Catálogo de análises filtradas");
  await expect(catalogo).toBeVisible();

  for (const codigo of HISTORICAL_CODES.filter((codigo) => codigo !== "Illumina_Sh_qPCR")) {
    await expect(catalogo.getByText(new RegExp(`^${codigo} ·`))).toBeVisible();
  }
  await expect(catalogo.getByText("Illumina_Sh_qPCR")).toHaveCount(0);
});
