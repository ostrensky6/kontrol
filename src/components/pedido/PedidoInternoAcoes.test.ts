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
  reprovarPedidoInterno: vi.fn(),
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

/** Decisão de Antonio em 19/11/2026: item novo (nunca comprado) é cadastrado por Compras antes de formalizar. */
describe("PedidoInternoAcoes: item novo sem cadastro trava a formalização", () => {
  const motivo = "Há 1 item novo, ainda sem cadastro. Use “Cadastrar insumo” na lista de itens antes de formalizar.";

  it("com item novo, “Formalizar em compras” fica desabilitado e diz o que fazer", () => {
    const html = render({ status: "validado", motivoItensSemCadastro: motivo });
    expect(html).toMatch(/<button disabled="" title="Há 1 item novo[^"]*">Formalizar em compras<\/button>/);
    expect(html).toContain(`<p class="max-w-80 text-xs text-muted-foreground">${motivo}</p>`);
  });

  it("o item novo vem antes do ciclo fechado: é o que a pessoa já pode resolver", () => {
    const html = render({ status: "validado", motivoItensSemCadastro: motivo, motivoCicloTravado: "O ciclo abre em 01/12." });
    expect(html).toContain(motivo);
    expect(html).not.toContain("O ciclo abre em 01/12.");
  });

  it("sem item novo, a formalização segue como antes", () => {
    expect(render({ status: "validado" })).toMatch(/<button>Formalizar em compras<\/button>/);
    expect(render({ status: "validado", motivoCicloTravado: "O ciclo abre em 01/12." })).toContain("O ciclo abre em 01/12.");
  });
});

/** Antonio, 27/11/2026: devolver (amarelo) deixa corrigir; reprovar (vermelho) encerra e avisa o solicitante. */
describe("PedidoInternoAcoes: reprovar ao lado de devolver (0186)", () => {
  it("quem valida o pedido vê Aprovar, Devolver e Reprovar, cada um com o motivo", () => {
    const html = render({ status: "em_validacao" });
    expect(html).toContain("<button>Aprovar pedido</button>");
    expect(html).toContain("<button>Devolver ao solicitante</button>");
    expect(html).toContain("<button>Reprovar</button>");
    expect(html).toContain('placeholder="Motivo da reprovação"');
  });

  it("quem não pode validar não vê Reprovar", () => {
    const html = render({ status: "em_validacao", motivoSemValidacao: "Só o coordenador do projeto aprova." });
    expect(html).not.toContain("<button>Reprovar</button>");
  });

  it("o administrativo reprova antes de autorizar a compra", () => {
    expect(render({ status: "analise_administrativa" })).toContain("<button>Reprovar</button>");
    expect(render({ status: "analise_administrativa", podeGerir: false })).not.toContain("<button>Reprovar</button>");
  });

  it("depois de autorizada a compra não há mais Reprovar (fica Cancelar)", () => {
    expect(render({ status: "aprovado_compra" })).not.toContain("<button>Reprovar</button>");
  });
});
