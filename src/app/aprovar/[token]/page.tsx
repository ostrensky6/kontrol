import { aprovarOrcamentoPublico } from "@/lib/actions/orcamento-projetos";
import { formatCurrency as brl, formatDate, formatDateTime } from "@/lib/formatters";
import { createClient } from "@/lib/supabase/server";
import { montarPropostaFinalExport } from "@/lib/orcamento/proposta-final-export";
import { rotuloStatusVersaoFinal, statusEfetivoVersaoFinal } from "@/lib/orcamento/rotulos-status";

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

export default async function AprovacaoPublicaPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ler_orcamento_publico", {
    p_token: token,
  });
  const payload = !error ? (data as PayloadPublico | null) : null;

  if (!payload?.snapshot || !payload.versao) {
    return <LinkIndisponivel />;
  }

  const snapshot = payload.snapshot;
  const demanda = snapshot.demanda;
  const consolidado = snapshot.consolidado;
  const totalFinal = Number(payload.versao.total_final ?? consolidado?.totalFinal ?? 0);
  // Página do cliente: só itens com valor comercial e total. Custos internos,
  // lucro, reserva e demais parâmetros não aparecem aqui.
  const proposta = montarPropostaFinalExport({
    versao: payload.versao,
    snapshot,
    demanda: demanda ?? null,
  });
  const identidade = proposta.info.identidade;
  const itens = proposta.composicaoComercial;
  const status = rotuloStatusVersaoFinal(statusEfetivoVersaoFinal(payload.versao));
  const escopo = demanda?.escopo_preliminar || demanda?.descricao || demanda?.observacoes;
  const aprovado = Boolean(payload.aprovado_em);
  const vencida = Boolean(payload.vencida) && !aprovado;
  const aprovadaPelaEquipe = !aprovado && payload.versao.status === "aprovado";

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 font-sans text-foreground sm:px-6 sm:py-8">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-400">
          Proposta comercial — {identidade.nomeCurto}
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          {demanda?.titulo ?? payload.versao.numero}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {payload.versao.numero} · versão {payload.versao.versao}
        </p>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Linha rotulo="Cliente" valor={demanda?.cliente_nome} />
          <Linha rotulo="Responsável" valor={demanda?.responsavel_interno} />
          <Linha rotulo="Válida até" valor={formatDate(payload.versao.valido_ate)} />
          <Linha rotulo="Situação" valor={status} />
        </dl>

        <div className="mt-6">
          <Resumo rotulo="Valor total da proposta" valor={totalFinal} destaque />
        </div>

        {itens.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Itens da proposta
            </h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-right text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2">Qtd.</th>
                    <th className="px-3 py-2">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {itens.map((item, index) => (
                    <tr key={`${item.componente}-${item.descricao}-${index}`}>
                      <td className="px-3 py-2 text-left">
                        <span className="font-medium">{item.descricao}</span>
                        <span className="block text-xs text-muted-foreground">{item.componente}</span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{item.quantidade}</td>
                      <td className="px-3 py-2 tabular-nums">{brl(item.valorComercial)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {escopo && (
          <section className="mt-6 text-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Escopo e observações
            </h2>
            <p className="mt-1 whitespace-pre-wrap leading-6 text-foreground">{escopo}</p>
          </section>
        )}

        <section className="mt-6 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Condições
          </h2>
          <p className="mt-1 leading-6 text-foreground">
            Valores válidos até {formatDate(payload.versao.valido_ate)}. Mudanças de escopo, quantidade de amostras ou prazo podem exigir nova versão da proposta.
          </p>
        </section>

        <div className="mt-8 border-t border-border pt-6">
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
              {payload.aprovado_em
                ? ` em ${formatDateTime(payload.aprovado_em)}`
                : ""}
              .
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
              <button className="rounded-md bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-500">
                Aprovar proposta
              </button>
            </form>
          )}
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground/80">
        Documento gerado pelo Kontrol — {identidade.nomeCurto}. Valores em reais (BRL).
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

function Resumo({
  rotulo,
  valor,
  destaque = false,
}: {
  rotulo: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <div
      className={
        destaque
          ? "rounded-lg border border-brand-200 bg-brand-50 p-4 dark:border-brand-900 dark:bg-brand-950/30"
          : "rounded-lg border border-border bg-muted/50 p-4"
      }
    >
      <p className="text-xs font-medium text-muted-foreground">{rotulo}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{brl(valor)}</p>
    </div>
  );
}

function Linha({
  rotulo,
  valor,
}: {
  rotulo: string;
  valor: string | null | undefined;
}) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{rotulo}:</dt>
      <dd className="font-medium">{valor ?? "—"}</dd>
    </div>
  );
}
