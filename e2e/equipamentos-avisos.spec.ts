import { expect, test } from "@playwright/test";

test("equipamentos: seção de avisos e cadastro de unidade pela tela", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (erro) => erros.push(erro.message));
  await page.goto("/estoque/equipamentos");
  const avisos = page.getByRole("region", { name: "Avisos de manutenção e calibração" });
  await expect(avisos).toBeVisible();
  await expect(avisos.getByText(/Nenhum aviso|Vence|Venceu|Nenhuma realizada/).first()).toBeVisible();
  await page.getByText("+ Cadastrar unidade física").click();
  await expect(page.getByRole("combobox", { name: /^Equipamento/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cadastrar unidade" })).toBeVisible();
  expect(erros).toEqual([]);
});
