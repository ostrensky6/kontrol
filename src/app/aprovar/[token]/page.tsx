import { aprovarOrcamentoPublico } from "@/lib/actions/orcamento-projetos";
import { SubmitButton } from "@/components/common/SubmitButton";
import type { Metadata } from "next";
import { DocumentoProposta } from "@/components/orcamento/documento/DocumentoProposta";
import { formatCurrency as brl, formatDate, formatDateTime } from "@/lib/formatters";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { montarDocumentoProposta } from "@/lib/orcamento/documento-proposta";
import { empresaDoSnapshot, empresaPadrao } from "@/lib/orcamento/empresas-emissoras";
import { resolverIdentidadeComAviso } from "@/lib/orcamento/identidade-institucional";
import { textosDaVersao } from "@/lib/orcamento/textos-proposta";
import { entradaDoSnapshot, montarVisaoInterna } from "@/lib/orcamento/visao-interna";

export const dynamic = "force-dynamic";

type SnapshotParametro = {
  key?: string;
  label?: string;
  nominalRate?: number;
  amount?: number;
};

type SnapshotPublico = {
  demanda?: {
    titulo?: string | null;
    instituicao?: string | null;
    modalidade?: string | null;
    cliente_nome?: string | null;
    responsavel_interno?: string | null;
    escopo_preliminar?: string | null;
    descricao?: string | null;
    observacoes?: string | null;
  };
  orcamentos_analises?: Array<{
    orcamento_itens?: Array<{ id?: number }>;
  }>;
  orcamentos_projeto?: Array<{
    orcamento_projeto_analises?: Array<{ id?: number }>;
    orcamento_projeto_custos?: Array<{ id?: number }>;
  }>;
  consolidado?: {
    totalLaboratorioCusto?: number;
    totalProjetoCusto?: number;
    totalFinal?: number;
    parametrosProjeto?: SnapshotParametro[];
  };
};

type PayloadPublico = {
  snapshot: SnapshotPublico;
  versao: {
    id: number;
    numero: string;
    versao: number;
    status: string;
    valido_ate: string | null;
    total_final: number;
    textos_proposta?: unknown;
  };
  vencida?: boolean;
  aprovado_em: string | null;
  aprovado_por: string | null;
};

const MENSAGEM_ERRO: Record<string, string> = {
  vencida: "Esta proposta venceu e não pode mais ser aprovada. Peça uma nova versão ao responsável.",
  outra_aprovada: "Outra versão desta proposta já foi aprovada. Fale com o responsável.",
  versao_nova: "Existe uma versão mais nova desta proposta. Peça o link atualizado ao responsável.",
  link_indisponivel: "Não foi possível concluir a aprovação. O link está indisponível.",
};

/**
 * O snapshot traz custos e parâmetros internos: desde a 0132 só o servidor lê
 * (service_role) e a página entrega ao navegador apenas o que o cliente vê.
 */
async function lerPropostaPublica(token: string): Promise<PayloadPublico | null> {
  try {
    const supabase =
      process.env.PLAYWRIGHT_MOCK_SUPABASE === "1" ? await createClient() : createAdminClient();
    const { data, error } = await supabase.rpc("ler_orcamento_publico", { p_token: token });
    if (error) {
      console.error("Leitura do link público falhou:", error.message);
      return null;
    }
    return data as PayloadPublico | null;
  } catch (error) {
    console.error("Leitura do link público falhou:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Título da aba: a empresa emissora, nunca o Kontrol (ferramenta interna). */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const payload = await lerPropostaPublica(token);
  if (!payload?.versao) return { title: "Proposta comercial" };
  const { identidade } = resolverIdentidadeComAviso(payload.snapshot?.demanda?.instituicao);
  return { title: `Proposta ${payload.versao.numero} · ${identidade.nomeLegal}` };
}

export default async function AprovacaoPublicaPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const payload = await lerPropostaPublica(token);

  if (!payload?.snapshot || !payload.versao) {
    return <LinkIndisponivel />;
  }

  const snapshot = payload.snapshot;
  const demanda = snapshot.demanda;
  const totalFinal = Number(payload.versao.total_final ?? snapshot.consolidado?.totalFinal ?? 0);
  const { identidade } = resolverIdentidadeComAviso(demanda?.instituicao);
  // Página do cliente: o mesmo documento da proposta impressa. Custos internos,
  // lucro, reserva e demais parâmetros não aparecem aqui.
  const visao = montarVisaoInterna(entradaDoSnapshot(snapshot, totalFinal));
  const documento = montarDocumentoProposta({
    versao: payload.versao,
    demanda: demanda ?? null,
    visao,
    textos: textosDaVersao({
      coluna: payload.versao.textos_proposta,
      snapshot,
      escopoLegado: demanda?.escopo_preliminar || demanda?.descricao || null,
      validadeTexto: `Valores válidos até ${formatDate(payload.versao.valido_ate)}.`,
    }),
    empresa: empresaDoSnapshot(snapshot, identidade) ?? empresaPadrao(identidade),
  });
  const aprovado = Boolean(payload.aprovado_em);
  const vencida = Boolean(payload.vencida) && !aprovado;
  const aprovadaPelaEquipe = !aprovado && payload.versao.status === "aprovado";

  return (
    <main className="mx-auto max-w-[230mm] px-3 py-6 font-sans text-foreground sm:px-6 sm:py-8">
      <DocumentoProposta modelo={documento} />

      <section
        aria-label="Aprovação da proposta"
        className="no-print mx-auto mt-4 w-full max-w-[210mm] rounded-lg border border-border bg-card p-5 shadow-sm"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Aprovação</h2>
          <p className="text-sm tabular-nums">
            Valor total <b>{brl(totalFinal)}</b> · válida até {formatDate(payload.versao.valido_ate)}
          </p>
        </div>
        <div className="mt-3">
          {query.erro && (
            <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger-strong">
              {MENSAGEM_ERRO[query.erro] ?? MENSAGEM_ERRO.link_indisponivel}
            </p>
          )}
          {vencida ? (
            <div className="rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning-strong">
              Esta proposta venceu em {formatDate(payload.versao.valido_ate)} e não pode mais ser aprovada. Peça uma nova versão ao responsável.
            </div>
          ) : aprovadaPelaEquipe ? (
            <div className="rounded-lg bg-leaf-50 px-4 py-3 text-sm text-leaf-800 dark:bg-leaf-950/40 dark:text-leaf-200">
              Esta proposta já está aprovada.
            </div>
          ) : aprovado ? (
            <div className="rounded-lg bg-leaf-50 px-4 py-3 text-sm text-leaf-800 dark:bg-leaf-950/40 dark:text-leaf-200">
              ✓ Proposta aprovada{payload.aprovado_por ? ` por ${payload.aprovado_por}` : ""}
              {payload.aprovado_em ? ` em ${formatDateTime(payload.aprovado_em)}` : ""}.
            </div>
          ) : (
            <form action={aprovarOrcamentoPublico} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="token" value={token} />
              <div className="min-w-56 flex-1">
                <label htmlFor="nome-aprovador" className="block text-xs font-medium text-muted-foreground">
                  Seu nome (para registro da aprovação)
                </label>
                <input
                  id="nome-aprovador"
                  name="nome"
                  required
                  placeholder="Nome de quem aprova"
                  className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                />
              </div>
              <SubmitButton pendingLabel="Aprovando…" className="min-h-11 bg-brand-600 px-5 text-white hover:bg-brand-500">
                Aprovar proposta
              </SubmitButton>
            </form>
          )}
        </div>
      </section>
      <p className="no-print mt-4 text-center text-xs text-muted-foreground/80">
        {documento.empresa.nomeLegal} · valores em reais (BRL).
      </p>
    </main>
  );
}

function LinkIndisponivel() {
  return (
    <main className="mx-auto max-w-lg px-6 py-24 text-center font-sans">
      <h1 className="text-xl font-semibold text-foreground">Link indisponível</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Este link de aprovação é inválido, expirou ou foi revogado. Solicite um
        novo link ao responsável pela proposta.
      </p>
    </main>
  );
}
