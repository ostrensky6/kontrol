import Link from "next/link";
import { createClientUntyped } from "@/lib/supabase/server";
import { pode } from "@/lib/auth/permissao-efetiva";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { LeituraEstoquePanel, type ModoLeitura } from "@/components/estoque/LeituraEstoquePanel";

export const dynamic = "force-dynamic";

/**
 * Entrada e saída pela leitura do código de barras do fabricante (relatório de
 * bugs, item 18). Leitor USB ou câmera; o lote é interno.
 */
export default async function LeituraEstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ modo?: string }>;
}) {
  const { modo } = await searchParams;
  const modoInicial: ModoLeitura = modo === "saida" ? "saida" : "entrada";
  const supabase = await createClientUntyped();
  const [podeMovimentar, podeReceber, podeVincular, { data: insumos }, { data: locais }, triagem] = await Promise.all([
    pode("estoque.movimentar"),
    pode("compras.receber"),
    pode("insumos.editar"),
    supabase.from("insumos").select("id, especificacao").eq("ativo", true).order("especificacao"),
    supabase.from("locais").select("id, nome").order("nome"),
    // códigos lidos que ainda não têm cadastro: a triagem mora aqui dentro (revisão de 11/11, L11)
    supabase.from("cadastros_triagem").select("id").in("status", ["pendente", "em_analise"]),
  ]);
  const codigosSemCadastro = triagem.error ? null : (triagem.data ?? []).length;

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-1">
            <h1 className="text-xl font-semibold tracking-tight">Entrada e saída por leitura</h1>
            <HelpTip title="Leitura de código de barras">
              <p>
                <b>Entrada</b>: leia o código do fabricante, confira a quantidade de embalagens (1 por
                padrão) e a validade e confirme. O lote é criado sozinho. Se houver pedido de compra em
                aberto, a entrada pode ser feita pelo pedido, sem lançar em dobro.
              </p>
              <p>
                <b>Saída</b>: cada leitura registra a abertura de 1 embalagem fechada. Sai primeiro o
                lote que vence antes; sem validade, o mais antigo.
              </p>
              <p>
                Código desconhecido: vincule a um insumo existente ou cadastre um novo; a próxima
                leitura já é reconhecida. O que ficar para depois aparece em <b>Códigos não reconhecidos</b>,
                no botão ao lado do título.
              </p>
              <HelpExample>Leu a caixa de ponteiras: “Abrir 1 embalagem do lote LEIT-…” e confirmar.</HelpExample>
            </HelpTip>
          </div>
          <Link
            href="/scanner/triagem"
            data-testid="link-codigos-nao-reconhecidos"
            className="inline-flex min-h-9 items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            Códigos não reconhecidos
            {codigosSemCadastro === null ? (
              <span className="text-xs font-normal text-muted-foreground">sem dado</span>
            ) : codigosSemCadastro > 0 ? (
              <span className="rounded-full bg-warning-soft px-1.5 text-xs font-semibold text-warning-strong">
                {codigosSemCadastro}
              </span>
            ) : null}
          </Link>
        </div>

        <div className="mt-6">
          <LeituraEstoquePanel
            modoInicial={modoInicial}
            insumos={(insumos ?? []).map((i) => ({
              id: Number(i.id),
              nome: i.especificacao ? String(i.especificacao) : `Insumo #${i.id}`,
            }))}
            locais={(locais ?? []).map((l) => ({ id: Number(l.id), nome: l.nome ? String(l.nome) : `Local #${l.id}` }))}
            podeMovimentar={podeMovimentar}
            podeReceber={podeReceber}
            podeVincular={podeVincular}
          />
        </div>
      </main>
    </div>
  );
}
