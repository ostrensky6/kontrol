import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 0188 (ordem nova das aprovações, 27/11/2026): todo pedido escolhe o
 * laboratório ou o campo. 0189 (relatório da Rafaela, 28/11/2026): o "Novo
 * pedido" leva só o orçamento prévio; os 3 orçamentos de fornecedores
 * diferentes, cada um com o documento, entram na cotação, depois da aprovação
 * financeira. Ajuda dos roteiros que enviam pelo "Novo pedido".
 */
export async function escolherLaboratorioOuCampo(form: Locator, rotulo = "Genética · Coordenação E2E") {
  await form.getByLabel("Laboratório ou campo").selectOption({ label: rotulo });
}

/** O que a ordem nova pede no "Novo pedido" além do que já se preenchia. */
export async function completarParaOrdemNova(form: Locator) {
  await escolherLaboratorioOuCampo(form);
}

/**
 * Cotação na página do pedido (status "Cotação com o solicitante"): registra os
 * 3 orçamentos, cada um com o documento, pelo quadro "Cotação: 3 orçamentos".
 * Não envia: o roteiro aperta "Enviar cotação ao coordenador do projeto".
 */
export async function registrarTresOrcamentos(
  page: Page,
  valores: [string, string, string] = ["120.00", "150.00", "180.00"],
  fornecedores: [string, string, string] = ["Loja Alfa E2E", "Loja Beta E2E", "Loja Gama E2E"],
) {
  const quadro = page.getByTestId("orcamentos-pedido");
  for (const [i, valor] of valores.entries()) {
    const form = quadro.locator("form").filter({ has: page.getByRole("button", { name: "Registrar orçamento" }) });
    await form.getByLabel("Ou nome do fornecedor").fill(fornecedores[i]);
    await form.getByLabel("Valor total (R$)").fill(valor);
    await form.getByLabel("Documento do orçamento (PDF do fornecedor)").setInputFiles({
      name: `orcamento-${i + 1}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(`%PDF-1.4 orçamento ${i + 1}`),
    });
    await form.getByRole("button", { name: "Registrar orçamento" }).click();
    await expect(quadro.getByRole("listitem").filter({ hasText: fornecedores[i] })).toBeVisible();
  }
}
