import { PageHeader } from "@/components/app/PageHeader";
import { HelpTip } from "@/components/common/HelpTip";
import { ACaminhoInsumos } from "@/components/estoque/ACaminhoInsumos";
import { ControlePorInsumo, ControlePorLote } from "@/components/estoque/ControleEstoque";
import { IndicadoresEstoque } from "@/components/estoque/IndicadoresEstoque";
import { PainelSituacaoEstoque } from "@/components/estoque/PainelSituacaoEstoque";
import { ResumoGraficoEstoque } from "@/components/estoque/ResumoGraficoEstoque";
import { VisoesSituacao } from "@/components/estoque/VisoesSituacao";
import { GerarPedidoReposicaoButton } from "@/components/pedido/GerarPedidoReposicaoButton";
import { pode } from "@/lib/auth/permissao-efetiva";
import { usuarioAtual } from "@/lib/auth/roles";
import { hojeIso } from "@/lib/estoque/baixa";
import { carregarControleEstoque } from "@/lib/estoque/controle-dados";
import {
  filtroSituacaoControleValido,
  insumosPorSituacaoPrincipal,
  loteAtendeControle,
  visaoSituacaoValida,
} from "@/lib/estoque/controle-estoque";
import { carregarSituacaoEstoque } from "@/lib/estoque/situacao-dados";
import { insumoAtendeFiltro } from "@/lib/estoque/situacao-insumo";
import { createClientUntyped } from "@/lib/supabase/server";
import { lerACaminho } from "@/lib/suprimentos/a-caminho";

export const dynamic = "force-dynamic";

const primeiro = (valor: string | string[] | undefined) => (Array.isArray(valor) ? valor[0] : valor);

/**
 * Situação do estoque: o painel único de alertas (D1, L1) e, desde a
 * organização de 11/11/2026, o que era do Controle de Estoque. Três visões:
 * por insumo (quadros de alerta, tratamento insumo a insumo e o que está a
 * caminho), por lote (validade e ações do lote) e gráficos.
 */
export default async function SituacaoDoEstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string | string[]; alerta?: string | string[] }>;
}) {
  const query = await searchParams;
  const visao = visaoSituacaoValida(primeiro(query.ver));
  const situacaoInicial = filtroSituacaoControleValido(primeiro(query.alerta));
  const hoje = hojeIso();
  const supabase = await createClientUntyped();
  const usuario = await usuarioAtual();
  const [controle, painel, aCaminho, podeCriarPedido, podeBaixar, podeAceitar, podeGerir, podeCorrigir] = await Promise.all([
    carregarControleEstoque(supabase, hoje, usuario),
    // os quadros e os gráficos saem da mesma leitura; a visão por lote não usa
    visao === "lote" ? null : carregarSituacaoEstoque(supabase, hoje),
    // L9: "a caminho" é assunto de estoque e fica junto dos alertas; a lista segue a permissão de Compras
    visao === "insumo" ? pode("compras.ver").then((ok) => (ok ? lerACaminho(supabase, hoje) : null)) : null,
    pode("pedido.criar"),
    pode("estoque.movimentar"),
    pode("estoque.lote.aceitar"),
    pode("estoque.descartar_bloquear"),
    pode("estoque.lote.gerir"),
  ]);

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container space-y-4">
        <PageHeader
          title="Situação do estoque"
          description="O que pede atenção agora: saldo, compra, validade e lotes."
          help={
            <HelpTip title="Situação do estoque">
              <p>
                Três visões: <b>Por insumo</b> (quadros de alerta e o tratamento insumo a insumo), <b>Por lote</b>{" "}
                (validade e ações de cada lote) e <b>Gráficos</b>. Clique no nome para abrir a ficha do insumo ou a
                página do lote.
              </p>
              <p>
                <b>Disponível no sistema</b> pode ser zero mesmo com material em mãos. A conferência física não é
                comprovada por esta leitura: para conferir, use o Inventário.
              </p>
              <p>
                <b>Repor</b> é uma sugestão para análise, sem compra automática. Considera consumo, prazo
                cadastrado e o que já está pedido. <b>Gerar pedidos de reposição</b> cria um pedido em rascunho
                com os insumos abaixo do mínimo.
              </p>
              <p>
                <b>Aberto fora da ordem</b>: abriram um lote enquanto outro, fechado e dentro da validade, vence
                antes. O que vence primeiro deve sair primeiro.
              </p>
            </HelpTip>
          }
          // D6: a reposição tem um lugar só, junto dos alertas de repor
          actions={podeCriarPedido ? <GerarPedidoReposicaoButton /> : undefined}
        />

        {controle.erro ? (
          <p role="alert" className="rounded-md border border-danger-strong/30 bg-danger-soft px-3 py-2 text-sm text-danger-strong">
            {controle.erro}
          </p>
        ) : null}

        <IndicadoresEstoque resumo={controle.resumo} />

        <VisoesSituacao
          visao={visao}
          contagens={{
            // leitura incompleta: sem contagem, em vez de um número menor do que o real
            insumo: controle.resumo
              ? controle.insumos.filter((insumo) => insumoAtendeFiltro(insumo.sinais, "atencao")).length
              : undefined,
            lote: controle.lotes.filter((lote) => loteAtendeControle(lote, "atencao")).length,
          }}
        />

        {visao === "insumo" && painel && (
          <>
            <PainelSituacaoEstoque
              mostrar="quadros"
              insumos={painel.insumos}
              lotesVencendo={painel.lotesVencendo}
              lotes={painel.lotes}
              movimentos={painel.movimentos}
              movimentosCompletos={painel.movimentosCompletos}
              graficosIncompletos={painel.graficosIncompletos}
              hojeIso={hoje}
              erro={painel.erro}
            />
            <ControlePorInsumo
              // o número do topo e o link de outra tela chegam pela URL: a lista abre já filtrada
              key={situacaoInicial}
              insumos={controle.insumos}
              avisosLidos={controle.avisosLidos}
              situacaoInicial={situacaoInicial}
              podeBaixar={podeBaixar}
              podeCriarPedido={podeCriarPedido}
            />
            <ACaminhoInsumos itens={aCaminho?.itens ?? []} erro={aCaminho?.erro} semAcesso={!aCaminho} />
          </>
        )}

        {visao === "lote" && (
          <ControlePorLote
            lotes={controle.lotes}
            podeAceitar={podeAceitar}
            podeGerir={podeGerir}
            podeCorrigir={podeCorrigir}
            podeBaixar={podeBaixar}
            responsavelPadrao={usuario?.nome || usuario?.email || ""}
          />
        )}

        {visao === "graficos" && painel && (
          <>
            <PainelSituacaoEstoque
              mostrar="graficos"
              insumos={painel.insumos}
              lotesVencendo={painel.lotesVencendo}
              lotes={painel.lotes}
              movimentos={painel.movimentos}
              movimentosCompletos={painel.movimentosCompletos}
              graficosIncompletos={painel.graficosIncompletos}
              hojeIso={hoje}
              erro={painel.erro}
            />
            {controle.resumo ? (
              <ResumoGraficoEstoque barras={insumosPorSituacaoPrincipal(controle.insumos)} resumo={controle.resumo} />
            ) : (
              <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground shadow-sm">
                Insumos por situação e saúde do estoque: sem dado. A leitura do estoque não respondeu por inteiro.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
