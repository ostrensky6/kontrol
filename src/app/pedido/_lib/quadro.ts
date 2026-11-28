import type { DecisaoNoQuadro, LinhaQuadro } from "@/components/pedido/QuadroAprovacoes";
import {
  aguardaLaboratorio,
  idsDaVezFluxoNovo,
  lerAprovadores,
  usuarioDecide,
  type AprovadoresPedido,
} from "@/lib/pedido/aprovadores";
import type { AreaPedido } from "@/lib/pedido/areas";
import { STATUS_PEDIDO_ENCERRADO } from "@/lib/pedido/etapas";
import {
  COLUNAS_QUADRO,
  colunasAprovacao,
  resumoItens,
  termoDeReferencia,
  type RegistroAprovacao,
} from "@/lib/pedido/quadro-aprovacoes";
import { emAprovacaoFluxoNovo, naCotacaoFluxoNovo, pedidoDoFluxoNovo, pedidoInternoNumero } from "@/lib/pedido/status";
import { formatDate, formatDateTime } from "@/lib/formatters";

export type PedidoParaQuadro = {
  id: number;
  titulo: string;
  status: string;
  solicitante: string | null;
  natureza?: string | null;
  area_id?: number | null;
  aprovacao_area_em?: string | null;
  aprovacao_area_por?: string | null;
  fluxo?: number | null;
  aprovacao_financeiro_em?: string | null;
  aprovacao_financeiro_por?: string | null;
  criado_em: string;
  projetoNome: string;
  pedidos_internos_itens?: Array<{ especificacao?: string | null }> | null;
  pedidos_internos_anexos?: Array<{ id: number; tipo: string; url?: string | null; storage_path?: string | null }> | null;
  pedidos_internos_aprovacoes?: RegistroAprovacao[] | null;
};

type Pessoa = { id: string; nome?: string | null; email?: string | null };

/** Link do termo: arquivo pela rota que gera o link na hora; senão, o endereço externo (só http/https). */
function linkDoTermo(pedidoId: number, anexos: PedidoParaQuadro["pedidos_internos_anexos"]): string | null {
  const termo = termoDeReferencia(anexos);
  if (!termo) return null;
  if (termo.storage_path) return `/pedido/${pedidoId}/anexo/${termo.id}`;
  const url = termo.url?.trim();
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/**
 * Linhas do quadro de aprovações. Quem decide cada pedido vem da mesma regra
 * do banco (aprovadores_pedido_interno, 0169), lida só para os pedidos que
 * esperam o coordenador do projeto ou o laboratório.
 */
export async function montarLinhasQuadro({
  supabase,
  pedidos,
  pessoas,
  areas,
  usuarioId,
  emailUsuario = null,
  substituto,
  podeAprovar,
}: {
  supabase: unknown;
  pedidos: PedidoParaQuadro[];
  pessoas: Pessoa[];
  areas: AreaPedido[];
  usuarioId: string | null;
  /** 0189: a cotação é de quem pediu (comparado pelo e-mail, como no banco) */
  emailUsuario?: string | null;
  /** Administrador ou quem conduz a compra inteira (0184) */
  substituto: boolean;
  /** "Aprovar pedidos" (pedido.aprovar): a autorização do administrativo */
  podeAprovar: boolean;
}): Promise<LinhaQuadro[]> {
  const nomePorEmail = new Map<string, string>();
  for (const p of pessoas) {
    if (p.email) nomePorEmail.set(p.email.trim().toLowerCase(), p.nome?.trim() || p.email);
  }
  const nome = (quem: string | null | undefined) => {
    const chave = (quem ?? "").trim().toLowerCase();
    return chave ? nomePorEmail.get(chave) ?? quem!.trim() : null;
  };
  const areaPorId = new Map(areas.map((a) => [a.id, a]));

  const esperando = pedidos.filter(
    (p) => p.status === "em_validacao" || aguardaLaboratorio(p) || (pedidoDoFluxoNovo(p) && emAprovacaoFluxoNovo(p.status)),
  );
  const aprovadores = new Map<number, AprovadoresPedido | null>(
    await Promise.all(
      esperando.map(async (p) => [p.id, await lerAprovadores(supabase as never, p.id)] as const),
    ),
  );

  return pedidos.map((p) => {
    const colunas = colunasAprovacao(p, p.pedidos_internos_aprovacoes);
    const ap = aprovadores.get(p.id) ?? null;
    const area = p.area_id != null ? areaPorId.get(Number(p.area_id)) : undefined;

    let decisao: DecisaoNoQuadro | null = null;
    const fluxoNovo = pedidoDoFluxoNovo(p);
    if (fluxoNovo) {
      // 0188: ordem nova — a vez de cada coordenação vem da regra do banco
      if (emAprovacaoFluxoNovo(p.status) && usuarioDecide(idsDaVezFluxoNovo(ap, p.status), usuarioId, substituto)) {
        const chave = p.status === "aguardando_area" ? "laboratorio" : p.status === "aguardando_financeiro" ? "financeiro" : "projeto";
        decisao = { chave, fluxoNovo: true };
      } else if (naCotacaoFluxoNovo(p.status)) {
        // 0189: a cotação não é decisão do quadro; quem pediu (ou o substituto) a faz no pedido
        const quemPediu = (p.solicitante ?? "").trim().toLowerCase();
        if (substituto || (quemPediu && quemPediu === (emailUsuario ?? "").trim().toLowerCase())) {
          decisao = { chave: "projeto", noPedido: `/pedido/${p.id}`, rotuloNoPedido: "Fazer a cotação (3 orçamentos)" };
        }
      }
    } else if (p.status === "em_validacao" && usuarioDecide(ap?.coordenador?.ids, usuarioId, substituto)) {
      decisao = { chave: "projeto" };
    } else if (aguardaLaboratorio(p) && usuarioDecide(ap?.laboratorio?.ids, usuarioId, substituto)) {
      decisao = { chave: "laboratorio" };
    } else if (p.status === "analise_administrativa" && podeAprovar) {
      decisao = { chave: "financeiro" };
    } else if (p.status === "formalizado" && podeAprovar) {
      decisao = { chave: "financeiro", noPedido: `/pedido/${p.id}` };
    }

    const responsavel: Record<(typeof COLUNAS_QUADRO)[number]["chave"], string | null> = {
      projeto: ap?.coordenador?.nome ?? null,
      laboratorio: ap?.laboratorio?.nome ?? area?.coordenador_nome ?? null,
      financeiro: fluxoNovo ? ap?.financeiro?.nome ?? "Administrativo" : "Administrativo",
    };

    const linha: LinhaQuadro = {
      id: p.id,
      numero: pedidoInternoNumero(p.id),
      titulo: p.titulo,
      projeto: p.projetoNome,
      solicitante: nome(p.solicitante) ?? "—",
      data: formatDate(p.criado_em),
      dataOrdem: p.criado_em,
      itens: resumoItens(p.pedidos_internos_itens),
      totalItens: (p.pedidos_internos_itens ?? []).length,
      termoHref: linkDoTermo(p.id, p.pedidos_internos_anexos),
      laboratorio: ap?.laboratorio?.area ?? area?.nome ?? null,
      colunas: Object.fromEntries(
        COLUNAS_QUADRO.map(({ chave }) => {
          const c = colunas[chave];
          return [
            chave,
            {
              situacao: c.situacao,
              rotulo: c.rotulo,
              quem: nome(c.quem),
              quando: c.quando ? formatDateTime(c.quando) : null,
              motivo: c.motivo,
              responsavel: c.situacao === "aguardando" ? responsavel[chave] : null,
            },
          ];
        }),
      ) as LinhaQuadro["colunas"],
      decisao,
      encerrado: STATUS_PEDIDO_ENCERRADO.includes(p.status),
    };
    return linha;
  });
}
