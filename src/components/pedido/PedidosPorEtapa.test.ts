import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./PedidosInternosTable", () => ({
  PedidosInternosTable: ({ rows }: { rows: unknown[] }) => createElement("div", { "data-linhas": rows.length }),
}));

import { PedidosPorEtapa } from "./PedidosPorEtapa";
import type { PedidoInternoRow } from "./PedidosInternosTable";
import type { FiltroEtapa } from "@/lib/pedido/etapas";

function linha(id: number, etapa: PedidoInternoRow["etapa"]): PedidoInternoRow {
  return { id, etapa } as PedidoInternoRow;
}

const LINHAS = [linha(1, "solicitacao"), linha(2, "compra"), linha(3, "concluido"), linha(4, "cancelado"), linha(5, "concluido")];

function html(filtroInicial: FiltroEtapa, extras: Partial<Parameters<typeof PedidosPorEtapa>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(PedidosPorEtapa, { rows: LINHAS, podeExcluir: false, filtroInicial, ...extras }),
  );
}

function contagemDoBotao(saida: string, rotulo: string): string | null {
  const botao = new RegExp(`<button[^>]*>${rotulo}(?:<span[^>]*>(\\d+)</span>)?</button>`).exec(saida);
  if (!botao) throw new Error(`botão ${rotulo} não encontrado`);
  return botao[1] ?? null;
}

describe("PedidosPorEtapa: encerrados só os mais recentes", () => {
  it("com a lista completa, os botões contam e não há aviso", () => {
    const saida = html("concluido", { encerrados: { mostrados: 3, total: 3 } });
    expect(contagemDoBotao(saida, "Em andamento")).toBe("2");
    expect(contagemDoBotao(saida, "Concluídos")).toBe("2");
    expect(contagemDoBotao(saida, "Cancelados")).toBe("1");
    expect(contagemDoBotao(saida, "Todos")).toBe("5");
    expect(saida).not.toContain("mais recentes");
  });

  it("com encerrados cortados, os botões deles ficam sem contagem e a lista oferece todos", () => {
    const saida = html("concluido", { encerrados: { mostrados: 3, total: 1240 } });
    // em andamento vem sempre inteiro: a contagem continua valendo
    expect(contagemDoBotao(saida, "Em andamento")).toBe("2");
    expect(contagemDoBotao(saida, "Concluídos")).toBeNull();
    expect(contagemDoBotao(saida, "Cancelados")).toBeNull();
    expect(contagemDoBotao(saida, "Todos")).toBeNull();
    expect(saida).toContain("Mostrando os 3 pedidos concluídos ou cancelados mais recentes, de 1.240.");
    expect(saida).toContain('href="/pedido?etapa=concluido&amp;encerrados=todos"');
  });

  it("em andamento não fala de encerrados: nada ali foi cortado", () => {
    const saida = html("andamento", { encerrados: { mostrados: 3, total: 1240 } });
    expect(saida).not.toContain("mais recentes");
    expect(saida).toContain('data-linhas="2"');
  });

  it("com todos na tela, oferece voltar à lista curta mantendo a etapa", () => {
    const saida = html("todos", { encerrados: { mostrados: 1240, total: 1240 }, todosEncerrados: true });
    expect(saida).toContain("Mostrando todos os 1.240 pedidos concluídos ou cancelados.");
    expect(saida).toContain('href="/pedido?etapa=todos"');
  });
});
