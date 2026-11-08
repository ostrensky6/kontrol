import { existsSync } from "node:fs";
import { expect, it } from "vitest";
import { AJUDA_TOPICOS, topicoCasa } from "./topics";

const topico = (id: string) => AJUDA_TOPICOS.find((t) => t.id === id)!;
const texto = (id: string) => JSON.stringify(topico(id));

it("todo tópico aponta para uma página que existe e tem id único", () => {
  expect(new Set(AJUDA_TOPICOS.map((t) => t.id)).size).toBe(AJUDA_TOPICOS.length);
  for (const t of AJUDA_TOPICOS) if (t.href) expect(existsSync(`src/app${t.href}/page.tsx`), t.href).toBe(true);
});

it("busca da Central ignora acentos e exige todas as palavras", () => {
  expect(topicoCasa(topico("estoque"), "conferir saldo fisico")).toBe(true);
  expect(topicoCasa(topico("orcamento-historico"), "proposta emitida")).toBe(true);
  expect(topicoCasa(topico("estoque"), "palavra-que-nao-existe")).toBe(false);
  expect(topicoCasa(topico("estoque"), "   ")).toBe(true);
});

it("explica zero registrado, saldo não conferido e salvamento sem confirmação", () => {
  expect(texto("estoque")).toContain("Saldo registrado zero");
  expect(texto("cadastros")).toContain("Saldo não conferido");
  expect(texto("orcamento-demandas")).toContain("Alterações não enviadas");
  expect(texto("custeio")).toContain("Resolver custo pendente");
});

it("cobre avisos e e-mails, nova versão da proposta e restauração de backup", () => {
  expect(topicoCasa(topico("notificacoes"), "resumo semanal")).toBe(true);
  expect(texto("orcamento-historico")).toContain("Ajustar taxas de uma proposta já enviada");
  expect(topicoCasa(topico("backups"), "restaurar")).toBe(true);
});
