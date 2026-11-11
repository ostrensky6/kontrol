import Link from "next/link";
import { getCadastrosOrdenados } from "@/lib/cadastros/config";
import { CadastrosCards } from "@/components/cadastros/CadastrosCards";
import {
  BotoesPlanilhaCadastros,
  ImportacaoCadastrosProvider,
  ResultadoImportacaoCadastros,
} from "@/components/cadastros/CadastrosWorkbookPanel";
import { CartaoSituacaoEstoque } from "@/components/estoque/CartaoSituacaoEstoque";
import { PageHeader } from "@/components/app/PageHeader";
import { HelpTip } from "@/components/common/HelpTip";
import { pode } from "@/lib/auth/permissao-efetiva";
import { createClientUntyped } from "@/lib/supabase/server";
import { hojeIso } from "@/lib/estoque/baixa";
import { contarSituacaoEstoque } from "@/lib/estoque/situacao-dados";
import { contarPendenciasDeQualidade } from "@/lib/cadastros/qualidade";

export const dynamic = "force-dynamic";

export default async function CadastrosIndex() {
  const cadastros = getCadastrosOrdenados();
  const supabase = await createClientUntyped();
  // a importação grava em vários cadastros; cada linha ainda passa pelo RLS da tabela
  const [pendenciasDeQualidade, podeVerEstoque, ...permissoes] = await Promise.all([
    contarPendenciasDeQualidade(supabase),
    pode("estoque.ver"),
    pode("cadastros.editar"),
    pode("insumos.editar"),
    pode("projetos.editar"),
  ]);
  // o painel de alertas saiu daqui (L1): fica em Estoque › Situação do estoque; aqui, só a contagem
  const situacao = podeVerEstoque ? await contarSituacaoEstoque(supabase, hojeIso()) : null;
  const podeImportar = permissoes.some(Boolean);
  const podeCadastrarInsumo = permissoes[1];

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <ImportacaoCadastrosProvider>
          <PageHeader
            title="Cadastros"
            description="Os dados que o resto do app usa: materiais, pessoas e áreas, comercial e custos."
            help={
              <HelpTip title="Cadastros">
                <p>
                  Escolha um cadastro abaixo ou um grupo na barra de cima. A busca (Ctrl+K) abre qualquer cadastro
                  pelo nome.
                </p>
                <p>
                  <b>Qualidade dos cadastros</b> mostra o que falta preencher. <b>Situação do estoque</b> abre o
                  painel de alertas, que agora fica em Estoque › Situação do estoque.
                </p>
              </HelpTip>
            }
            actions={
              <>
                {podeCadastrarInsumo ? (
                  <Link
                    href="/cadastros/insumos?novo=1"
                    className="inline-flex rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    + Cadastrar insumo
                  </Link>
                ) : null}
                <BotoesPlanilhaCadastros podeImportar={podeImportar} />
              </>
            }
          />

          <ResultadoImportacaoCadastros />

          <div className="mt-4 space-y-2">
            {/* L8: o que falta preencher vem primeiro, com o número */}
            <Link
              href="/cadastros/qualidade"
              data-testid="cartao-qualidade"
              className="group flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-4 py-3 outline-none transition-colors hover:border-primary/60 focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="text-sm font-semibold text-foreground">Qualidade dos cadastros</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  pendenciasDeQualidade === null
                    ? "bg-muted text-muted-foreground"
                    : pendenciasDeQualidade > 0
                      ? "bg-warning-soft text-warning-strong"
                      : "bg-success-soft text-success-strong"
                }`}
              >
                {pendenciasDeQualidade === null
                  ? "sem dado"
                  : pendenciasDeQualidade === 0
                    ? "nada pendente"
                    : pendenciasDeQualidade === 1
                      ? "1 pendência"
                      : `${pendenciasDeQualidade} pendências`}
              </span>
              <span className="text-sm text-muted-foreground">
                O que falta preencher e pode distorcer custo, compra ou proposta.
              </span>
              <span className="ml-auto text-sm font-medium text-primary group-hover:underline">Revisar</span>
            </Link>
            {situacao && <CartaoSituacaoEstoque resumo={situacao.resumo} />}
          </div>

          <section aria-labelledby="todos-os-cadastros-titulo" className="mt-6">
            <h2 id="todos-os-cadastros-titulo" className="text-base font-semibold tracking-tight">
              Todos os cadastros
            </h2>
            <CadastrosCards cadastros={cadastros} />
          </section>
        </ImportacaoCadastrosProvider>
      </main>
    </div>
  );
}
