import Link from "next/link";
import type { ReactNode } from "react";

import { AvisoLeitura } from "@/components/common/AvisoLeitura";
import { PrintButton } from "@/components/orcamento/PrintButton";
import { SolicitacaoComprasIneo } from "@/components/pedido/documentos/SolicitacaoComprasIneo";
import { TermoReferenciaFunpar } from "@/components/pedido/documentos/TermoReferenciaFunpar";
import {
  CRITERIO_PADRAO,
  MODELOS_DOCUMENTO,
  dataPorExtenso,
  linhasDoDocumento,
  modeloDocumento,
  prazoDeEntrega,
  quantitativoDosItens,
  rubricasMarcadas,
  textosDosItens,
  type ItemDoDocumento,
  type ModeloDocumento,
  type OrcamentoDoDocumento,
} from "@/lib/pedido/documento-fonte";
import { pedidoInternoNumero } from "@/lib/pedido/status";
import { createClientUntyped } from "@/lib/supabase/server";
import { novaLeitura, semRegistro } from "@/lib/supabase/leitura";

export const dynamic = "force-dynamic";

const COLUNAS_INSUMO =
  "especificacao, descricao_detalhada, fabricante, codigo_fabricante, justificativa_tr, especificacoes_tr, criterio_aceitabilidade, unidade";

type Orcamento = OrcamentoDoDocumento & { fornecedor_id: number | null };
type Pessoa = { nome: string | null; email: string | null };

/**
 * Documento do pedido para quem paga: a fonte de pagamento escolhida pelo
 * financeiro diz o modelo (Ineo: Solicitação de Compras; Funpar: Termo de
 * Referência). `?modelo=` abre o outro modelo quando for preciso.
 */
export default async function DocumentoDaFonte({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ modelo?: string }>;
}) {
  const leitura = novaLeitura("/pedido/[id]/documento");
  const { id } = await params;
  const { modelo: modeloPedido } = await searchParams;
  const pedidoId = Number(id);
  const supabase = await createClientUntyped();

  const { data: pedido } = await leitura.de("pedido", supabase
    .from("pedidos_internos")
    .select("id, titulo, natureza, justificativa, solicitante, projeto_id, fonte_recurso")
    .eq("id", pedidoId)
    .single());
  if (!pedido) semRegistro(leitura);

  const [{ data: itens }, { data: orcamentos }, { data: projetos }, { data: fontes }, { data: pessoas }] = await Promise.all([
    leitura.de("itens do pedido", supabase
      .from("pedidos_internos_itens")
      .select(`id, tipo, especificacao, quantidade, unidade, volume, modelo, orcamento_previo, insumos(${COLUNAS_INSUMO})`)
      .eq("pedido_interno_id", pedidoId)
      .order("id")),
    leitura.de("orçamentos", supabase
      .from("pedidos_internos_cotacoes")
      .select("fornecedor_nome, fornecedor_id, valor_total, escolhida, prazo_entrega_dias")
      .eq("pedido_interno_id", pedidoId)
      .order("valor_total")),
    pedido.projeto_id != null
      ? leitura.de("projeto", supabase.from("projetos").select("nome, descricao, coordenador_nome, coordenador_email").eq("id", pedido.projeto_id))
      : Promise.resolve({ data: [] }),
    leitura.de("fontes de pagamento", supabase.from("fontes_recurso").select("nome, modelo_documento")),
    leitura.de("pessoas", supabase.from("perfis").select("nome, email")),
  ]);

  const listaOrcamentos = (orcamentos ?? []) as Orcamento[];
  const escolhido = listaOrcamentos.find((o) => o.escolhida) ?? null;
  const { data: fornecedores } = escolhido?.fornecedor_id
    ? await leitura.de("fornecedor", supabase.from("fornecedores").select("nome, cnpj").eq("id", escolhido.fornecedor_id))
    : { data: [] };

  const fonte = ((fontes ?? []) as { nome: string; modelo_documento: string | null }[]).find(
    (f) => f.nome.trim().toLowerCase() === String(pedido.fonte_recurso ?? "").trim().toLowerCase(),
  );
  const modelo: ModeloDocumento | null = modeloDocumento(modeloPedido) ?? modeloDocumento(fonte?.modelo_documento);
  const projeto = ((projetos ?? []) as { nome: string; descricao: string | null; coordenador_nome: string | null; coordenador_email: string | null }[])[0];
  const nomeDe = (email: string | null | undefined) => {
    const chave = String(email ?? "").trim().toLowerCase();
    if (!chave) return null;
    const pessoa = ((pessoas ?? []) as Pessoa[]).find((p) => String(p.email ?? "").trim().toLowerCase() === chave);
    return pessoa?.nome?.trim() || String(email).trim();
  };
  const listaItens = (itens ?? []) as ItemDoDocumento[];
  const data = dataPorExtenso(new Date());
  const numero = pedidoInternoNumero(pedidoId);

  let documento: ReactNode = null;
  if (modelo === "solicitacao_compras") {
    const { linhas, total } = linhasDoDocumento(listaItens, listaOrcamentos, "escolhido");
    const fornecedor = (fornecedores ?? [])[0] as { nome: string; cnpj: string | null } | undefined;
    documento = (
      <SolicitacaoComprasIneo
        dados={{
          projeto: projeto ? projeto.descricao?.trim() || projeto.nome : null,
          rubricas: rubricasMarcadas(pedido.natureza, listaItens),
          linhas,
          total,
          justificativas: textosDosItens(listaItens, "justificativa_tr", pedido.justificativa),
          fornecedor: escolhido ? { nome: escolhido.fornecedor_nome, cnpj: fornecedor?.cnpj ?? null } : null,
          data,
          coordenador: projeto?.coordenador_nome ?? null,
        }}
      />
    );
  } else if (modelo === "termo_referencia") {
    const { linhas, total, valorDoOrcamento } = linhasDoDocumento(listaItens, listaOrcamentos, "media");
    documento = (
      <TermoReferenciaFunpar
        dados={{
          objeto: pedido.titulo,
          justificativas: textosDosItens(listaItens, "justificativa_tr", pedido.justificativa),
          especificacoes: textosDosItens(listaItens, "especificacoes_tr", quantitativoDosItens(linhas)),
          linhas,
          total,
          orcamentos: listaOrcamentos.map((o) => ({ fornecedor: o.fornecedor_nome, valor: Number(o.valor_total), escolhido: o.escolhida })),
          media: valorDoOrcamento,
          prazoDias: prazoDeEntrega(listaOrcamentos),
          criterios: textosDosItens(listaItens, "criterio_aceitabilidade", CRITERIO_PADRAO),
          coordenador: { nome: projeto?.coordenador_nome ?? null, email: projeto?.coordenador_email ?? null },
          solicitante: nomeDe(pedido.solicitante),
          data,
        }}
      />
    );
  }

  const outro: ModeloDocumento = modelo === "solicitacao_compras" ? "termo_referencia" : "solicitacao_compras";
  return (
    <div className="min-h-dvh bg-transparent font-sans print:min-h-0">
      <main className="print-area app-page-container">
        <AvisoLeitura falhas={leitura.falhas} />
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <Link href={`/pedido/${pedidoId}`} className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted">
            Voltar ao pedido {numero}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            {modelo && (
              <Link href={`/pedido/${pedidoId}/documento?modelo=${outro}`} className="text-sm text-primary hover:underline">
                Abrir como {MODELOS_DOCUMENTO[outro].titulo} ({MODELOS_DOCUMENTO[outro].fonte})
              </Link>
            )}
            {modelo && <PrintButton destaque />}
          </div>
        </div>
        {modelo ? (
          <>
            <p className="no-print mt-3 text-sm text-muted-foreground">
              Os campos com linha pontilhada não ficam no Kontrol (convênio, matrícula, nº do orçamento): escreva neles aqui
              mesmo antes de imprimir. Os textos também podem ser corrigidos na tela.
            </p>
            <div className="folha-documento mx-auto mt-4 max-w-[210mm] rounded-lg border border-border p-[15mm] shadow-sm print:p-0">
              {documento}
            </div>
          </>
        ) : (
          <section className="mt-6 rounded-lg border border-border bg-card p-4 text-sm">
            <h1 className="text-base font-semibold">Documento para quem paga</h1>
            <p className="mt-2">
              {pedido.fonte_recurso
                ? `A fonte de pagamento deste pedido (${pedido.fonte_recurso}) não tem modelo de documento. Ineo usa a Solicitação de Compras; Funpar, o Termo de Referência. O modelo de cada fonte fica em Cadastros > Fontes de pagamento.`
                : "O financeiro ainda não escolheu a fonte de pagamento deste pedido. Quando escolher, o documento sai no modelo da fonte."}
            </p>
            <p className="mt-3 flex flex-wrap gap-4">
              {(Object.keys(MODELOS_DOCUMENTO) as ModeloDocumento[]).map((m) => (
                <Link key={m} href={`/pedido/${pedidoId}/documento?modelo=${m}`} className="text-primary hover:underline">
                  Abrir como {MODELOS_DOCUMENTO[m].titulo} ({MODELOS_DOCUMENTO[m].fonte})
                </Link>
              ))}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
