import { expect, test } from "@playwright/test";
import { ADMIN, clienteDoUsuario, entrarComo } from "./apoio";

/**
 * Roteiro inteiro de Orçamentos contra o Postgres de verdade (auditoria de
 * 16/11, item 11): o orçamento nasce na tela, recebe os custos do projeto, a
 * revisão é concluída, entram os percentuais e a proposta é emitida com o
 * documento do cliente.
 *
 * Tudo pelos botões da tela. As RPCs de custos, de revisão e de emissão só
 * existem no banco; o modo simulado não prova que elas gravam.
 */
test("orçamento de projeto vira proposta emitida, com o documento do cliente", async ({ page }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(30_000);
  const sufixo = Date.now();
  const titulo = `Orçamento roteiro E2E ${sufixo}`;
  const cliente = `Cliente roteiro E2E ${sufixo}`;

  await entrarComo(page, ADMIN);

  // ---- 1. dados do orçamento (modalidade só de projeto: não depende do catálogo de análises)
  await page.goto("/orcamento/demandas/nova");
  await page.getByLabel(/^Título/).fill(titulo);
  await page.getByLabel(/^Modalidade/).selectOption("projeto");
  await page.getByLabel("Nome do cliente").fill(cliente);
  await page.getByLabel(/^Descrição do orçamento/).fill("Levantamento de campo do roteiro automático.");
  await page.getByRole("button", { name: "Criar orçamento" }).click();
  await expect(page).toHaveURL(/\/orcamento\/demandas\/\d+$/);
  const demandaId = Number(page.url().split("/").pop());
  expect(demandaId).toBeGreaterThan(0);

  const banco = await clienteDoUsuario(ADMIN);
  const { data: demanda, error: erroDemanda } = await banco
    .from("demandas_propostas")
    .select("id, titulo, modalidade, cliente_nome")
    .eq("id", demandaId)
    .single();
  expect(erroDemanda).toBeNull();
  expect(demanda).toMatchObject({ titulo, modalidade: "projeto", cliente_nome: cliente });

  // ---- 2. custos do projeto: uma linha de serviço de terceiros (2 x R$ 1.500,00)
  await page.getByRole("link", { name: /^3\. Custos do projeto/ }).click();
  await expect(page).toHaveURL(/etapa=projeto/);
  const projeto = page.locator("#projeto");
  await projeto.getByRole("button", { name: "Criar orçamento de projeto" }).click();
  await projeto.getByRole("tab", { name: /^ST · Serviços de Terceiros/ }).click();
  await projeto.getByLabel(/^Descrição/).fill("Transporte das amostras");
  await projeto.getByLabel("Quantidade", { exact: true }).fill("2");
  await projeto.getByLabel(/^Valor unitário/).fill("1500");
  await projeto.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(projeto.getByRole("tab", { name: /^ST · Serviços de Terceiros \(1\)/ })).toBeVisible();

  // ---- 3. revisão dos custos concluída: os custos travam e liberam os parâmetros
  await projeto.getByRole("button", { name: "Concluir revisão dos custos" }).click();
  const revisao = page.getByRole("dialog");
  await expect(revisao).toContainText("R$ 3.000,00");
  await revisao.getByRole("button", { name: "Concluir revisão", exact: true }).click();
  await expect(page).toHaveURL(/etapa=parametros/);

  // ---- 4. percentuais do projeto: 10% de impostos e 20% de lucro, por dentro do preço
  await page.getByLabel("Impostos (%)").fill("10");
  await page.getByLabel("Lucro (%)").fill("20");
  await page.getByRole("button", { name: /^Salvar e ir para a proposta/ }).click();
  await expect(page).toHaveURL(/etapa=final/);

  // ---- 5. emissão: o total é o custo dividido por (1 - 30%)
  await page.getByRole("button", { name: "Emitir versão final" }).click();
  const confirmacao = page.getByRole("dialog", { name: "Emitir versão final?" });
  await expect(confirmacao).toContainText("R$ 4.285,71");
  await confirmacao.getByRole("button", { name: "Emitir", exact: true }).click();
  const abrir = page.getByRole("link", { name: /Abrir versão emitida/ });
  await expect(abrir).toBeVisible();

  const { data: versoes, error: erroVersoes } = await banco
    .from("orcamento_final_versoes")
    .select("id, numero, versao, status, total_final, total_projeto_custo")
    .eq("demanda_id", demandaId);
  expect(erroVersoes).toBeNull();
  expect(versoes).toHaveLength(1);
  const versao = versoes![0] as { id: number; numero: string; versao: number; status: string; total_final: number; total_projeto_custo: number };
  expect(versao.status).toBe("emitido");
  expect(versao.versao).toBe(1);
  expect(Number(versao.total_projeto_custo)).toBeCloseTo(3000, 2);
  expect(Number(versao.total_final)).toBeCloseTo(4285.71, 2);

  // ---- 6. a versão emitida abre com o número gravado e o documento do cliente
  await abrir.click();
  await expect(page).toHaveURL(new RegExp(`/orcamento/final/${versao.id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(versao.numero);
  await page.getByRole("link", { name: "Documento do cliente" }).click();
  await expect(page).toHaveURL(/aba=documento/);
  const folha = page.getByRole("article");
  await expect(folha.getByRole("heading", { name: "Proposta comercial" })).toBeVisible();
  await expect(folha).toContainText(versao.numero);
  await expect(folha).toContainText(cliente);
  await expect(folha).toContainText("Transporte das amostras");
  await expect(folha).toContainText("R$ 4.285,71");
  // o documento é do cliente: custo, gross-up e lucro não aparecem
  await expect(folha).not.toContainText(/custo unit|gross-up|lucro/i);

  // ---- 7. a lista de orçamentos mostra a fase e o valor da proposta emitida
  await page.goto("/orcamento/demandas");
  await page.getByLabel("Buscar orçamento, cliente ou projeto").fill(titulo);
  const linha = page.getByRole("row").filter({ hasText: titulo });
  await expect(linha).toContainText("Emitida");
  await expect(linha).toContainText("R$ 4.285,71");
});
