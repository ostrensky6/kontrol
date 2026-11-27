import { expect, test } from "@playwright/test";

// Rodada 7 de layout e usabilidade (25/11/2026, tarde): escolhas à vista, em
// cartões e botões, no lugar de listas suspensas. O formulário continua
// enviando o mesmo campo: cada cartão é um botão de opção de verdade.

test("Novo pedido: tipo, objetivo e uso em cartões e botões", async ({ page }) => {
  await page.goto("/pedido");
  await page.getByRole("button", { name: "Novo pedido" }).first().click();
  const dialogo = page.getByRole("dialog");
  const tipo = dialogo.getByRole("radiogroup", { name: "Tipo de material ou despesa" });
  await expect(tipo.getByRole("radio")).toHaveCount(11);
  await expect(dialogo.getByRole("combobox", { name: "Tipo de material ou despesa" })).toHaveCount(0);
  await tipo.getByText("Material de consumo de laboratório", { exact: true }).click();
  await expect(tipo.getByRole("radio", { name: "Material de consumo de laboratório" })).toBeChecked();
  // 0188: o laboratório ou campo é a primeira aprovação, sempre à vista (o envio exige; o rascunho, não)
  await expect(dialogo.getByRole("combobox", { name: "Laboratório ou campo" })).toBeVisible();
  const uso = dialogo.getByRole("radiogroup", { name: "Onde será usado" });
  await expect(uso.getByRole("radio", { name: "Laboratório" })).toBeChecked();
  await uso.getByText("Campo", { exact: true }).click();
  await expect(uso.getByRole("radio", { name: "Campo", exact: true })).toBeChecked();
  await expect(dialogo.getByRole("radiogroup", { name: "Objetivo" }).getByRole("radio")).toHaveCount(6);
});

test("Novo orçamento: modalidade em cartões e prioridade em botões", async ({ page }) => {
  await page.goto("/orcamento/demandas/nova");
  const modalidade = page.getByRole("radiogroup", { name: "Modalidade" });
  await expect(modalidade.getByRole("radio", { name: "Análises laboratoriais" })).toBeChecked();
  await modalidade.getByText("Projeto sem análises", { exact: true }).click();
  await expect(modalidade.getByRole("radio", { name: "Projeto sem análises" })).toBeChecked();
  const prioridade = page.getByRole("radiogroup", { name: "Prioridade" });
  await expect(prioridade.getByRole("radio", { name: "Normal" })).toBeChecked();
});

test("Custeio: métrica em botões e análises marcadas com a cor da linha", async ({ page }) => {
  await page.goto("/custeio");
  const metrica = page.getByRole("radiogroup", { name: "Métrica" });
  await metrica.getByText("Custo total", { exact: true }).click();
  await expect(metrica.getByRole("radio", { name: "Custo total" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Eletroforese hemolinfa" })).toBeChecked();
});
