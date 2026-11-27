import type { Locator } from "@playwright/test";

/**
 * 0188 (ordem nova das aprovações, 27/11/2026): todo pedido escolhe o
 * laboratório ou o campo e vai com 3 orçamentos de fornecedores diferentes,
 * cada um com o documento. Ajuda dos roteiros que enviam pelo "Novo pedido".
 */
export async function escolherLaboratorioOuCampo(form: Locator, rotulo = "Genética · Coordenação E2E") {
  await form.getByLabel("Laboratório ou campo").selectOption({ label: rotulo });
}

export async function preencherTresOrcamentos(
  form: Locator,
  valores: [string, string, string] = ["120,00", "150,00", "180,00"],
  fornecedores: [string, string, string] = ["Loja Alfa E2E", "Loja Beta E2E", "Loja Gama E2E"],
) {
  for (const [i, valor] of valores.entries()) {
    const grupo = form.getByRole("group", { name: `Orçamento ${i + 1}` });
    await grupo.getByLabel(`Fornecedor do orçamento ${i + 1}`).fill(fornecedores[i]);
    await grupo.getByLabel("Valor total (R$)").fill(valor);
    await grupo.getByLabel(`Documento do orçamento ${i + 1}`).setInputFiles({
      name: `orcamento-${i + 1}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(`%PDF-1.4 orçamento ${i + 1}`),
    });
  }
}

/** Laboratório ou campo e os 3 orçamentos: o que a ordem nova pede além do que já se preenchia. */
export async function completarParaOrdemNova(form: Locator) {
  await escolherLaboratorioOuCampo(form);
  await preencherTresOrcamentos(form);
}
