/**
 * Catálogo vivo de custos de projeto (Fase B): leitura da prévia devolvida por
 * `previa_catalogo_revisao_projeto` e textos da tela. A regra (identidade do
 * item, vale a última conclusão, só o que foi digitado grava, pessoal com
 * permissão) mora só no banco (migration 0137); aqui nada é recalculado.
 */
import { formatCurrency as brl } from "@/lib/formatters";

export const ACOES_CATALOGO = ["novo", "atualizar", "vincular", "inalterado", "repetido", "pendente_permissao"] as const;
export type AcaoCatalogo = (typeof ACOES_CATALOGO)[number];

export type LinhaPlanoCatalogo = {
  linhaId: number;
  rubrica: string;
  descricao: string;
  unidade: string | null;
  valor: number;
  catalogoItemId: string | null;
  acao: AcaoCatalogo;
  valorCatalogo: number | null;
  valorCatalogoEm: string | null;
};

function numeroOuNull(valor: unknown) {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function ehAcao(valor: string): valor is AcaoCatalogo {
  return (ACOES_CATALOGO as readonly string[]).includes(valor);
}

/** Converte as linhas cruas da RPC. Linha com ação desconhecida é descartada. */
export function lerPlanoCatalogo(dados: unknown): LinhaPlanoCatalogo[] {
  if (!Array.isArray(dados)) return [];
  return dados.flatMap((bruto) => {
    const linha = (bruto ?? {}) as Record<string, unknown>;
    const acao = String(linha.acao ?? "");
    const linhaId = Number(linha.linha_id);
    if (!ehAcao(acao) || !Number.isInteger(linhaId)) return [];
    return [
      {
        linhaId,
        rubrica: String(linha.rubrica ?? "OU"),
        descricao: String(linha.descricao ?? ""),
        unidade: linha.unidade == null ? null : String(linha.unidade),
        valor: Number(linha.valor ?? 0),
        catalogoItemId: linha.catalogo_item_id == null ? null : String(linha.catalogo_item_id),
        acao,
        valorCatalogo: numeroOuNull(linha.valor_catalogo),
        valorCatalogoEm: linha.valor_catalogo_em == null ? null : String(linha.valor_catalogo_em),
      },
    ];
  });
}

const diferente = (a: number, b: number) => Math.abs(a - b) >= 0.005;

/** Linha que não grava, mas cujo catálogo já tem valor diferente (outra proposta atualizou). */
function desatualizada(linha: LinhaPlanoCatalogo) {
  return (linha.acao === "inalterado" || linha.acao === "vincular")
    && linha.valorCatalogo != null
    && diferente(linha.valorCatalogo, linha.valor);
}

export type SeloCatalogo = { rotulo: string; tom: "novo" | "atualiza" | "aviso"; detalhe: string };

/** Selo da linha no editor. `null` = linha igual ao catálogo. */
export function seloLinhaCatalogo(linha: LinhaPlanoCatalogo): SeloCatalogo | null {
  switch (linha.acao) {
    case "novo":
      return { rotulo: "Novo no catálogo", tom: "novo", detalhe: "Entra no catálogo ao concluir a revisão dos custos." };
    case "atualizar":
      return {
        rotulo: "Atualiza o catálogo",
        tom: "atualiza",
        detalhe:
          linha.valorCatalogo == null
            ? "Ao concluir, este valor passa a ser o do catálogo."
            : `Catálogo: ${brl(linha.valorCatalogo)} → ${brl(linha.valor)} ao concluir.`,
      };
    case "repetido":
      return {
        rotulo: "Repetido neste orçamento",
        tom: "aviso",
        detalhe: "Outra linha com o mesmo item e unidade define o valor do catálogo (vale a última lançada).",
      };
    case "pendente_permissao":
      return {
        rotulo: "Pessoal: aguarda permissão",
        tom: "aviso",
        detalhe: "Sem a permissão “Valores de pessoal no orçamento”, este valor fica pendente para quem a tem confirmar.",
      };
    default:
      return desatualizada(linha) && linha.valorCatalogo != null
        ? {
            // DC5: só informa; cada orçamento vale o valor que foi colocado nele.
            rotulo: `Catálogo hoje: ${brl(linha.valorCatalogo)}`,
            tom: "aviso",
            detalhe: "Outra proposta atualizou este item no catálogo. Este orçamento mantém o valor que foi colocado nele; mude aqui só se quiser.",
          }
        : null;
  }
}

export type ResumoPlanoCatalogo = {
  novos: LinhaPlanoCatalogo[];
  atualizados: LinhaPlanoCatalogo[];
  pendentes: LinhaPlanoCatalogo[];
  repetidos: LinhaPlanoCatalogo[];
  desatualizados: LinhaPlanoCatalogo[];
};

export function resumirPlanoCatalogo(linhas: LinhaPlanoCatalogo[]): ResumoPlanoCatalogo {
  return {
    novos: linhas.filter((l) => l.acao === "novo"),
    atualizados: linhas.filter((l) => l.acao === "atualizar"),
    pendentes: linhas.filter((l) => l.acao === "pendente_permissao"),
    repetidos: linhas.filter((l) => l.acao === "repetido"),
    desatualizados: linhas.filter(desatualizada),
  };
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Frases da confirmação de "Concluir revisão". Lista vazia = o catálogo não muda. */
export function frasesPreviaCatalogo(resumo: ResumoPlanoCatalogo): string[] {
  const frases: string[] = [];
  if (resumo.novos.length) {
    frases.push(
      `${plural(resumo.novos.length, "item novo entra", "itens novos entram")} no catálogo: ${resumo.novos.map((l) => l.descricao).join(", ")}.`,
    );
  }
  if (resumo.atualizados.length) {
    const itens = resumo.atualizados
      .map((l) => (l.valorCatalogo == null ? l.descricao : `${l.descricao} ${brl(l.valorCatalogo)} → ${brl(l.valor)}`))
      .join("; ");
    frases.push(`${plural(resumo.atualizados.length, "valor é atualizado", "valores são atualizados")}: ${itens}.`);
  }
  if (resumo.pendentes.length) {
    frases.push(
      `${plural(resumo.pendentes.length, "valor de pessoal fica pendente", "valores de pessoal ficam pendentes")} para quem tem a permissão de valores de pessoal.`,
    );
  }
  if (resumo.desatualizados.length) {
    frases.push(
      `${plural(resumo.desatualizados.length, "linha está", "linhas estão")} com valor diferente do catálogo atual e não ${resumo.desatualizados.length === 1 ? "muda" : "mudam"} o catálogo: ${resumo.desatualizados.map((l) => l.descricao).join(", ")}.`,
    );
  }
  return frases;
}

/** Mensagem depois de concluir, a partir do retorno de `concluir_revisao_custos_projeto`. */
export function mensagemConclusaoCatalogo(retorno: unknown): string {
  const r = (retorno ?? {}) as Record<string, unknown>;
  const novos = Number(r.novos ?? 0) || 0;
  const atualizados = Number(r.atualizados ?? 0) || 0;
  const pendentes = Number(r.pendentes ?? 0) || 0;
  const partes = [
    novos ? plural(novos, "item novo", "itens novos") : null,
    atualizados ? plural(atualizados, "valor atualizado", "valores atualizados") : null,
    pendentes ? `${plural(pendentes, "valor de pessoal pendente", "valores de pessoal pendentes")} de permissão` : null,
  ].filter(Boolean);
  return partes.length
    ? `Revisão dos custos concluída. Catálogo: ${partes.join(", ")}.`
    : "Revisão dos custos concluída. O catálogo não mudou.";
}
