import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ListaParcial } from "./ListaParcial";

function html(props: Parameters<typeof ListaParcial>[0]) {
  return renderToStaticMarkup(createElement(ListaParcial, props));
}

describe("ListaParcial", () => {
  it("não aparece quando a lista está completa", () => {
    expect(html({ mostrados: 12, total: 12, oQue: "pedidos concluídos ou cancelados", hrefTodos: "/pedido?encerrados=todos" })).toBe("");
  });

  it("diz quantos vieram, quantos existem e oferece trazer todos", () => {
    const saida = html({
      mostrados: 300,
      total: 1240,
      oQue: "pedidos concluídos ou cancelados",
      hrefTodos: "/pedido?encerrados=todos",
    });
    expect(saida).toContain("Mostrando os 300 pedidos concluídos ou cancelados mais recentes, de 1.240.");
    expect(saida).toContain('href="/pedido?encerrados=todos"');
    expect(saida).toContain("Mostrar todos");
  });

  it("concorda no feminino", () => {
    const saida = html({
      mostrados: 300,
      total: 301,
      oQue: "compras recebidas ou canceladas",
      feminino: true,
      hrefTodos: "/compras?encerradas=todas",
    });
    expect(saida).toContain("Mostrando as 300 compras recebidas ou canceladas mais recentes, de 301.");
    expect(saida).toContain("Mostrar todas");
  });

  it("com todos na tela, oferece voltar aos mais recentes só quando a lista curta cortaria", () => {
    const base = { oQue: "pedidos concluídos ou cancelados", hrefTodos: "/pedido?encerrados=todos", hrefRecentes: "/pedido" };
    const longa = html({ ...base, mostrados: 1240, total: 1240 });
    expect(longa).toContain("Mostrando todos os 1.240 pedidos concluídos ou cancelados.");
    expect(longa).toContain("Mostrar só os mais recentes");
    expect(html({ ...base, mostrados: 12, total: 12 })).toBe("");
  });
});
