import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/pedidos-internos", () => ({
  escolherOrcamento: vi.fn(),
  registrarOrcamento: vi.fn(),
  removerOrcamento: vi.fn(),
}));
vi.mock("@/components/pedido/FormComMensagem", () => ({
  FormComMensagem: ({ children }: { children: React.ReactNode }) => createElement("form", null, children),
}));
vi.mock("@/components/common/SubmitButton", () => ({
  SubmitButton: ({ children }: { children: string }) => createElement("button", null, children),
}));

import { PedidoOrcamentos } from "./PedidoOrcamentos";
import { normalizarOrcamentos } from "@/lib/pedido/orcamentos";

const orcamentos = normalizarOrcamentos([
  { id: 1, fornecedor_nome: "Loja A", valor_total: 100, prazo_entrega_dias: 5, anexo_id: 9 },
  { id: 2, fornecedor_nome: "Loja B", valor_total: 150, prazo_entrega_dias: 2 },
  { id: 3, fornecedor_nome: "Loja C", valor_total: 120 },
]);

function render(props: Partial<Parameters<typeof PedidoOrcamentos>[0]>) {
  return renderToStaticMarkup(
    createElement(PedidoOrcamentos, {
      pedidoId: 7,
      status: "orcamentos_recebidos",
      orcamentos,
      podeGerir: true,
      fornecedores: [{ id: 4, nome: "Fornecedor Cadastrado" }],
      anexos: [{ id: 9, titulo: "Proposta Loja A.pdf" }],
      ...props,
    }),
  );
}

describe("PedidoOrcamentos (0171)", () => {
  it("mostra a situação por escrito, o menor valor e pede justificativa fora dele", () => {
    const html = render({});
    expect(html).toContain("3 de 3: falta escolher");
    expect(html).toContain("Menor valor");
    expect(html).toContain("documento: Proposta Loja A.pdf");
    expect(html.match(/>Escolher</g)).toHaveLength(3);
    // só os dois mais caros pedem justificativa
    expect(html.match(/name="justificativa"/g)).toHaveLength(2);
    expect(html).toContain("Registrar orçamento");
    expect(html).toContain("Fornecedor Cadastrado");
  });

  it("com menos de 3 diz quantos faltam e ainda não oferece a escolha", () => {
    const html = render({ status: "orcamentos", orcamentos: orcamentos.slice(0, 2) });
    expect(html).toContain("2 de 3: falta 1");
    expect(html).not.toContain(">Escolher<");
    expect(html).toContain("Remover");
  });

  it("depois da escolha só consulta e mostra quem escolheu e por quê", () => {
    const escolhidos = orcamentos.map((o) =>
      o.id === 2 ? { ...o, escolhida: true, escolhida_por: "nathieli@x", justificativa_escolha: "Entrega em 2 dias" } : o,
    );
    const html = render({ status: "aguardando_aprovacao_final", orcamentos: escolhidos });
    expect(html).toContain("escolhido: Loja B");
    expect(html).toContain("Escolhido por nathieli@x");
    expect(html).toContain("Justificativa: Entrega em 2 dias");
    expect(html).not.toContain("Registrar orçamento");
    expect(html).not.toContain("Remover");
  });

  it("leitura falha vira aviso, não lista vazia", () => {
    expect(render({ orcamentos: null })).toContain("Não foi possível ler os orçamentos");
  });
});
