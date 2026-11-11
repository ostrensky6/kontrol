import { expect, test } from "@playwright/test";

test("disputa de reserva: plano com falta pede, Coordenador transfere do outro plano", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (erro) => erros.push(erro.message));
  await page.goto("/planejamento/902");
  const secao = page.getByRole("region", { name: "Falta na reserva: pedir de outro plano" });
  await expect(secao).toBeVisible();
  const falta = secao.getByTestId("falta-reserva");
  await expect(falta).toContainText("falta 4");
  await falta.getByRole("textbox").fill("Começa antes e a amostra é perecível");
  await falta.getByRole("button", { name: "Pedir reserva de outro plano" }).click();
  // O formulário dá lugar ao aviso de pedido aberto (um por plano e insumo).
  await expect(secao.getByText("Pedido aguardando decisão.")).toBeVisible();

  // quem decide chega pela aba de Planejamento, que conta o que espera decisão (revisão de 11/11, L12)
  await page.goto("/planejamento");
  const abas = page.getByRole("navigation", { name: "Seções do planejamento" });
  await expect(abas.getByRole("link")).toHaveText(["Planos", /^Disputas de reserva\s*1$/]);
  await abas.getByRole("link", { name: /Disputas de reserva/ }).click();
  await expect(page).toHaveURL(/\/planejamento\/disputas$/);
  await expect(abas.locator("a[aria-current]")).toHaveText([/^Disputas de reserva/]);
  const pedido = page.getByTestId("disputa-reserva").filter({ hasText: "Plano B disputa E2E" });
  await expect(pedido).toContainText("Aguardando decisão");
  await expect(pedido.getByRole("combobox").nth(1)).toContainText("Plano A disputa E2E");
  await pedido.getByRole("textbox").fill("B entrega antes ao cliente");
  await pedido.getByRole("button", { name: "Registrar decisão" }).click();
  // Decidido, o formulário some e o pedido mostra o resultado.
  await expect(pedido.getByRole("button", { name: "Registrar decisão" })).toHaveCount(0);
  await page.reload();
  const decidido = page.getByTestId("disputa-reserva").filter({ hasText: "Plano B disputa E2E" });
  await expect(decidido).toContainText("Transferida");
  await expect(decidido).toContainText("Plano A disputa E2E");
  await expect(decidido.getByRole("button", { name: "Registrar decisão" })).toHaveCount(0);
  // decidida, a disputa sai do contador da aba
  await expect(page.getByRole("navigation", { name: "Seções do planejamento" }).getByRole("link")).toHaveText(["Planos", "Disputas de reserva"]);

  // O plano que cedeu passa a mostrar a falta.
  await page.goto("/planejamento/901");
  await expect(page.getByRole("region", { name: "Falta na reserva: pedir de outro plano" }).getByTestId("falta-reserva")).toContainText("falta 4");
  expect(erros).toEqual([]);
});
