import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/pedidos-internos", () => ({
  aprovarAnaliseAdministrativa: vi.fn(),
  aprovarCompraFinal: vi.fn(),
  cancelarPedidoInterno: vi.fn(),
  concluirCompra: vi.fn(),
  confirmarEntregaPedidoInterno: vi.fn(),
  decidirCoordenacaoLaboratorio: vi.fn(),
  devolverParaCompras: vi.fn(),
  devolverParaSolicitante: vi.fn(),
  encaminharInstituicao: vi.fn(),
  enviarParaValidacao: vi.fn(),
  enviarAprovacaoFinal: vi.fn(),
  fecharComFornecedor: vi.fn(),
  formalizarPedidoInterno: vi.fn(),
  marcarAguardandoPagamentoNf: vi.fn(),
  marcarOrcamentosRecebidos: vi.fn(),
  registrarExcecaoPagamento: vi.fn(),
  registrarLevantamentoOrcamentos: vi.fn(),
  validarInformacoes: vi.fn(),
}));
vi.mock("@/components/common/SubmitButton", () => ({
  SubmitButton: ({ children, disabled, title }: { children: string; disabled?: boolean; title?: string }) =>
    createElement("button", { disabled, title }, children),
}));

import { PedidoInternoAcoes } from "./PedidoInternoAcoes";

const pendencia = "Pagamento só depois do recebimento: registre a chegada de todos os materiais e equipamentos do pedido.";

function render(props: Partial<Parameters<typeof PedidoInternoAcoes>[0]>) {
  return renderToStaticMarkup(
    createElement(PedidoInternoAcoes, { pedidoId: 7, status: "compra_fechada", podeGerir: true, ...props }),
  );
}

describe("PedidoInternoAcoes: entrega antes do pagamento (0170)", () => {
  it("trava o pagamento com a explicação e oferece a exceção com acordo", () => {
    const html = render({ pendenciaPagamento: pendencia });
    expect(html).toMatch(/<button disabled="" title="Pagamento só depois do recebimento[^"]*">Aguardar pagamento\/NF<\/button>/);
    expect(html).toContain("Registrar exceção (pagar antes)");
    expect(html).toContain("Acordo: com quem, o quê e por quê");
  });

  it("libera o pagamento sem pendência e confirma serviço prestado", () => {
    const html = render({ pendenciaPagamento: null, podeConfirmarEntrega: true });
    expect(html).toMatch(/<button>Aguardar pagamento\/NF<\/button>/);
    expect(html).not.toContain("Registrar exceção");
    expect(html).toContain("Confirmar entrega (serviço prestado)");
    expect(html).toContain('name="observacao"');
  });

  it("sem permissão de gerir não mostra pagamento nem exceção", () => {
    const html = render({ podeGerir: false, pendenciaPagamento: pendencia });
    expect(html).not.toContain("Aguardar pagamento/NF");
    expect(html).not.toContain("Registrar exceção");
  });
});
