/**
 * 0188: de quem é a vez no pedido da ordem nova (laboratório ou campo →
 * financeiro → coordenador do projeto), para a página do pedido. A regra de
 * quem decide é a do banco (kontrol_private.pode_decidir_fluxo2); aqui só se
 * escreve o texto. 0189: entre o financeiro e o coordenador, a cotação é de
 * quem pediu (na ausência, o Administrador ou quem conduz a compra inteira).
 */
import { idsDaVezFluxoNovo, usuarioDecide, type AprovadoresPedido } from "./aprovadores";
import { emAprovacaoFluxoNovo, naCotacaoFluxoNovo, pedidoDoFluxoNovo } from "./status";

export type VezDoPedido = { tom: "sua" | "espera" | "neutro"; rotulo: string; texto: string | null };

export function vezFluxoNovo({
  aprovadores,
  pedido,
  usuarioId,
  substituto,
  comoSubstituto,
  podeGerir,
  rotuloStatus,
  emailUsuario = null,
}: {
  aprovadores: AprovadoresPedido | null;
  pedido: { status: string; fluxo?: number | null; solicitante?: string | null };
  usuarioId: string | null | undefined;
  /** 0189: a cotação é de quem pediu (comparado pelo e-mail, como no banco) */
  emailUsuario?: string | null;
  /** Administrador ou quem conduz a compra inteira */
  substituto: boolean;
  comoSubstituto: string;
  /** "Aprovar pedidos": vê o motivo quando a vez é de outra pessoa */
  podeGerir: boolean;
  rotuloStatus: string;
}) {
  const fluxoNovo = pedidoDoFluxoNovo(pedido);
  const emAprovacao = fluxoNovo && emAprovacaoFluxoNovo(pedido.status);
  const ids = idsDaVezFluxoNovo(aprovadores, pedido.status);
  const podeDecidir = emAprovacao && usuarioDecide(ids, usuarioId, substituto);
  const titular = Boolean(usuarioId && ids.includes(usuarioId));
  const quem =
    pedido.status === "aguardando_area"
      ? aprovadores?.laboratorio
        ? `${aprovadores.laboratorio.nome ?? "a coordenação"} (${aprovadores.laboratorio.area})`
        : "a coordenação do laboratório ou do campo"
      : pedido.status === "aguardando_financeiro"
        ? aprovadores?.financeiro?.nome ?? "o financeiro (função Administrativo)"
        : aprovadores?.coordenador?.nome ?? "o coordenador do projeto";
  // 0189: a cotação, entre o financeiro e o coordenador do projeto
  const naCotacao = fluxoNovo && naCotacaoFluxoNovo(pedido.status);
  const quemPediu = (pedido.solicitante ?? "").trim().toLowerCase();
  const ehSolicitante = Boolean(quemPediu && quemPediu === (emailUsuario ?? "").trim().toLowerCase());
  const podeCotar = naCotacao && (ehSolicitante || substituto);
  if (naCotacao) {
    const vez: VezDoPedido = podeCotar
      ? {
          tom: "sua",
          rotulo: "Sua vez",
          texto: ehSolicitante
            ? "O financeiro aprovou. Faça a cotação: registre 3 orçamentos de fornecedores diferentes, cada um com o documento, e envie ao coordenador do projeto."
            : `Você pode fazer a cotação ${comoSubstituto}, na ausência de quem pediu (${pedido.solicitante ?? "solicitante"}).`,
        }
      : { tom: "espera", rotulo: rotuloStatus, texto: null };
    return { fluxoNovo, emAprovacao: false, podeDecidir: false, podeCotar, motivoSemDecisao: null, vez };
  }
  const motivoSemDecisao =
    emAprovacao && !podeDecidir && podeGerir
      ? `A vez é de ${quem}. Na ausência, o Administrador ou quem tem “Conduzir a compra inteira” decide.`
      : null;
  const vez: VezDoPedido | null = !emAprovacao
    ? null
    : podeDecidir
      ? {
          tom: "sua",
          rotulo: "Sua vez",
          texto: titular
            ? pedido.status === "aguardando_financeiro"
              ? "Você responde pelo financeiro. Confira os itens e o orçamento prévio, escolha a fonte de pagamento e aprove ou devolva. Depois, quem pediu faz a cotação."
              : pedido.status === "aguardando_projeto"
                ? "Você aprova por último. Confira os itens e os 3 orçamentos da cotação abaixo e aprove ou devolva."
                : "Você é quem aprova esta etapa. Confira os itens e o orçamento prévio abaixo e aprove ou devolva."
            : `Você pode decidir ${comoSubstituto}, na ausência de ${quem}.`,
        }
      : { tom: "espera", rotulo: rotuloStatus, texto: null };
  return { fluxoNovo, emAprovacao, podeDecidir, podeCotar: false, motivoSemDecisao, vez };
}
