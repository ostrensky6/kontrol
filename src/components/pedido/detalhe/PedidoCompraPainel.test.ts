import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/compras", () => ({
  aprovarPedido: vi.fn(),
  cancelarPedido: vi.fn(),
  definirFornecedorCompra: vi.fn(),
  encerrarPedidoComPendencia: vi.fn(),
  marcarEnviado: vi.fn(),
}));

import { PedidoCompraPainel } from "./PedidoCompraPainel";

type Props = Parameters<typeof PedidoCompraPainel>[0];

const FORNECEDORES = [
  { id: 71, nome: "Sigma Aldrich" },
  { id: 72, nome: "Thermo Fisher" },
];

function html(props: Partial<Props> = {}) {
  return renderToStaticMarkup(
    createElement(PedidoCompraPainel, {
      pedidoId: 504,
      pedidoStatus: "compra_fechada",
      compra: { id: 9401, status: "enviado", fornecedor_id: 71, data_prevista_entrega: "2026-12-01", fornecedores: { nome: "Sigma Aldrich" } },
      chegada: { itens: 2, completos: 0, temRecebimento: false },
      orcamentoEscolhido: { fornecedor_id: 71, fornecedor_nome: "Sigma Aldrich" },
      fornecedores: FORNECEDORES,
      podeAprovarCompra: true,
      hoje: "2026-11-17",
      ...props,
    }),
  );
}

/** Texto do botão de cada formulário que o painel oferece. */
function botoes(saida: string) {
  return [...saida.matchAll(/<button[^>]*type="submit"[^>]*>(.*?)<\/button>/g)].map((achado) => achado[1].replace(/<[^>]+>/g, "").trim());
}

describe("PedidoCompraPainel (compra única na tela)", () => {
  it("compra enviada e com fornecedor: mostra tudo e não pede nada", () => {
    const saida = html();
    expect(saida).toContain('id="compra"');
    expect(saida).toContain("Compra #9401</h2>");
    expect(saida).toContain("Sigma Aldrich");
    expect(saida).toContain("01/12/2026");
    expect(saida).toContain("0 de 2 itens recebidos");
    expect(saida).toContain("Registre a chegada na linha do item, na tabela abaixo.");
    expect(saida).toContain('href="/compras/9401/imprimir"');
    expect(saida).toContain('href="/compras/9401"');
    expect(saida).not.toContain("Atrasada");
    for (const marca of ["painel-compra-sem-fornecedor", "painel-compra-envio", "painel-compra-pendencia", "painel-compra-aprovacao"]) {
      expect(saida).not.toContain(marca);
    }
  });

  it("previsão vencida com a compra em andamento aparece como atrasada; recebida, não", () => {
    const compra = { id: 9401, status: "enviado", fornecedor_id: 71, data_prevista_entrega: "2026-11-10", fornecedores: { nome: "Sigma Aldrich" } };
    expect(html({ compra })).toContain("Atrasada");
    expect(html({ compra: { ...compra, status: "recebido" } })).not.toContain("Atrasada");
    expect(html({ compra: { ...compra, data_prevista_entrega: null } })).toContain("sem previsão");
  });

  it("antes de fechar, o painel explica que 'Fechar com fornecedor' envia a compra", () => {
    const saida = html({
      pedidoStatus: "aprovado_para_compra",
      compra: { id: 9401, status: "aprovado", fornecedor_id: 71, data_prevista_entrega: null, fornecedores: { nome: "Sigma Aldrich" } },
    });
    expect(saida).toContain("“Fechar com fornecedor” já marca esta compra como enviada");
    expect(botoes(saida)).toEqual([]);
  });

  it("pela instituição, o envio ao fornecedor é registrado no painel", () => {
    const compra = { id: 9401, status: "aprovado", fornecedor_id: 71, data_prevista_entrega: null, fornecedores: { nome: "Sigma Aldrich" } };
    const saida = html({ pedidoStatus: "encaminhado_instituicao", compra });
    expect(botoes(saida)).toEqual(["Instituição enviou ao fornecedor"]);
    // pedido fechado antes da 0182, com a compra ainda aprovada
    expect(botoes(html({ pedidoStatus: "compra_fechada", compra }))).toEqual(["Marcar compra como enviada"]);
    // sem a permissão, o painel diz o que falta em vez de esconder
    const semPermissao = html({ pedidoStatus: "encaminhado_instituicao", compra, podeAprovarCompra: false });
    expect(botoes(semPermissao)).toEqual([]);
    expect(semPermissao).toContain("Registrar o envio exige a permissão “Aprovar compras”.");
  });

  it("compra sem fornecedor: aponta o cadastro de mesmo nome ou oferece cadastrar", () => {
    const compra = { id: 9403, status: "aprovado", fornecedor_id: null, data_prevista_entrega: null, fornecedores: null };
    const comCadastro = html({ pedidoStatus: "aprovado_para_compra", compra, orcamentoEscolhido: { fornecedor_id: null, fornecedor_nome: " sigma aldrich " } });
    expect(comCadastro).toContain("Falta definir");
    expect(comCadastro).toContain("O orçamento escolhido traz o nome “sigma aldrich”, que está no cadastro.");
    expect(comCadastro).toMatch(/<option value="71" selected="">Sigma Aldrich<\/option>/);
    expect(comCadastro).not.toContain("Cadastrar fornecedor");
    expect(botoes(comCadastro)).toEqual(["Definir fornecedor"]);

    const semCadastro = html({ pedidoStatus: "aprovado_para_compra", compra, orcamentoEscolhido: { fornecedor_id: null, fornecedor_nome: "Loja Nova" } });
    expect(semCadastro).toContain("traz só o nome “Loja Nova”, que não está no cadastro de fornecedores.");
    expect(semCadastro).toContain('href="/cadastros/fornecedores"');

    const semOrcamento = html({ pedidoStatus: "aprovado_para_compra", compra, orcamentoEscolhido: null });
    expect(semOrcamento).toContain("Esta compra está sem fornecedor");

    const semPermissao = html({ pedidoStatus: "aprovado_para_compra", compra, podeAprovarCompra: false });
    expect(botoes(semPermissao)).toEqual([]);
    expect(semPermissao).toContain("Definir o fornecedor exige a permissão “Aprovar compras”.");

    // compra encerrada sem fornecedor não pede mais nada
    const recebida = html({ compra: { ...compra, status: "recebido" } });
    expect(recebida).not.toContain("painel-compra-sem-fornecedor");
    expect(recebida).not.toContain("Falta definir");
  });

  it("chegou parte: 'Encerrar com pendência' fica no painel, com os três destinos", () => {
    const saida = html({ chegada: { itens: 2, completos: 1, temRecebimento: true } });
    expect(saida).toContain("Faltou item?");
    expect(saida).toContain("1 de 2 itens recebidos");
    expect(saida.match(/type="radio"/g)).toHaveLength(3);
    expect(botoes(saida)).toEqual(["Encerrar com pendência"]);
    const semPermissao = html({ chegada: { itens: 2, completos: 1, temRecebimento: true }, podeAprovarCompra: false });
    expect(botoes(semPermissao)).toEqual([]);
    expect(semPermissao).toContain("Encerrar com pendência exige a permissão “Aprovar compras”.");
    // compra já recebida inteira: nada a encerrar
    expect(html({
      compra: { id: 9401, status: "recebido", fornecedor_id: 71, data_prevista_entrega: null, fornecedores: { nome: "Sigma Aldrich" } },
      chegada: { itens: 2, completos: 2, temRecebimento: true },
    })).not.toContain("Faltou item?");
  });

  it("compra que ficou solicitada depois da aprovação final ainda pode ser aprovada, pelo painel", () => {
    const compra = { id: 9404, status: "solicitado", fornecedor_id: 71, data_prevista_entrega: null, fornecedores: { nome: "Sigma Aldrich" } };
    const saida = html({ pedidoStatus: "aprovado_para_compra", compra });
    expect(saida).toContain("painel-compra-aprovacao");
    expect(saida).toContain("Ajuda: Por que a compra segue solicitada");
    expect(botoes(saida)).toEqual(["Aprovar compra"]);
    // solicitada não tem envio a registrar ainda
    expect(saida).not.toContain("painel-compra-envio");
    const semPermissao = html({ pedidoStatus: "aprovado_para_compra", compra, podeAprovarCompra: false });
    expect(botoes(semPermissao)).toEqual([]);
    expect(semPermissao).toContain("Aprovar a compra exige a permissão “Aprovar compras”.");
  });

  it("a leitura dos itens falhou: a chegada aparece como 'sem dado', sem inventar número", () => {
    const saida = html({ chegada: null });
    expect(saida).toContain("sem dado");
    expect(saida).not.toContain("Registre a chegada na linha do item");
    expect(saida).not.toContain("Faltou item?");
  });
});
