import { expect, test } from "@playwright/test";
import { ADMIN, clienteDoUsuario, entrarComo } from "./apoio";

/**
 * Compra pedida e não recebida aparece no quadro "A caminho" do painel de
 * insumos, só com o que falta receber e com o atraso pela data informada. Sem
 * aprovação ela fica à parte: pedido em aprovação não é compra a caminho.
 */
test("compra aberta aparece em A caminho com quantidade pendente e atraso", async ({ page }) => {
  const nome = `Kit a caminho E2E ${Date.now()}`;

  await entrarComo(page, ADMIN);
  await page.goto("/cadastros/insumos");
  await page.getByRole("button", { name: "Novo insumo" }).click();
  const form = page.getByRole("dialog");
  await form.locator('[name="especificacao"]').fill(nome);
  await form.locator('[name="custo_total_embalagem"]').fill("80");
  await form.locator('[name="quantidade_embalagem"]').fill("1");
  await form.locator('[name="unidade"]').fill("kit");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(form).toBeHidden();

  const cliente = await clienteDoUsuario(ADMIN);
  const { data: insumo, error: erroInsumo } = await cliente
    .from("insumos")
    .select("id, quantidade_embalagem")
    .eq("especificacao", nome)
    .single();
  expect(erroInsumo).toBeNull();
  const { data: compra, error: erroCompra } = await cliente
    .from("pedidos_compra")
    .insert({ status: "solicitado", solicitante: ADMIN, data_prevista_entrega: "2026-01-05" })
    .select("id")
    .single();
  expect(erroCompra).toBeNull();
  const conteudo = Number(insumo!.quantidade_embalagem) > 0 ? Number(insumo!.quantidade_embalagem) : null;
  const { error: erroItem } = await cliente.from("pedidos_compra_itens").insert({
    pedido_id: compra!.id,
    insumo_id: insumo!.id,
    quantidade: 4,
    quantidade_em: conteudo ? "embalagem" : "unidade",
    conteudo_embalagem: conteudo,
  });
  expect(erroItem).toBeNull();

  await page.goto("/cadastros");
  const quadro = page.getByTestId("painel-a-caminho");
  await expect(quadro).toBeVisible();
  // compra só solicitada ainda não é "a caminho": fica no bloco "aguardam aprovação"
  const semAprovacao = quadro.getByTestId("a-caminho-sem-aprovacao");
  await expect(semAprovacao).toBeVisible();
  if (!(await semAprovacao.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await semAprovacao.locator("summary").click();
  }
  const linha = semAprovacao.locator("tr", { hasText: nome });
  await expect(linha).toBeVisible();
  await expect(linha).toContainText("Compra aguardando aprovação");
  // sem aprovação não há atraso de fornecedor a cobrar
  await expect(linha).not.toContainText("Atrasado há");
  await expect(linha.getByRole("link", { name: `Compra #${compra!.id}` })).toBeVisible();
});
