/**
 * 0188: de quem é a vez no pedido da ordem nova (laboratório ou campo →
 * financeiro → coordenador do projeto), para a página do pedido. A regra de
 * quem decide é a do banco (kontrol_private.pode_decidir_fluxo2); aqui só se
 * escreve o texto.
 */
import { idsDaVezFluxoNovo, usuarioDecide, type AprovadoresPedido } from "./aprovadores";
import { emAprovacaoFluxoNovo, pedidoDoFluxoNovo } from "./status";

export type VezDoPedido = { tom: "sua" | "espera" | "neutro"; rotulo: string; texto: string | null };

export function vezFluxoNovo({
  aprovadores,
  pedido,
  usuarioId,
  substituto,
  comoSubstituto,
  podeGerir,
  rotuloStatus,
}: {
  aprovadores: AprovadoresPedido | null;
  pedido: { status: string; fluxo?: number | null };
  usuarioId: string | null | undefined;
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
              ? "Você responde pelo financeiro. Confira os itens e os orçamentos, escolha a fonte de pagamento e aprove ou devolva."
              : "Você é quem aprova esta etapa. Confira os itens e os orçamentos abaixo e aprove ou devolva."
            : `Você pode decidir ${comoSubstituto}, na ausência de ${quem}.`,
        }
      : { tom: "espera", rotulo: rotuloStatus, texto: null };
  return { fluxoNovo, emAprovacao, podeDecidir, motivoSemDecisao, vez };
}
