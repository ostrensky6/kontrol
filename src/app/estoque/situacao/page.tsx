import { PageHeader } from "@/components/app/PageHeader";
import { HelpTip } from "@/components/common/HelpTip";
import { ACaminhoInsumos } from "@/components/estoque/ACaminhoInsumos";
import { PainelSituacaoEstoque } from "@/components/estoque/PainelSituacaoEstoque";
import { GerarPedidoReposicaoButton } from "@/components/pedido/GerarPedidoReposicaoButton";
import { pode } from "@/lib/auth/permissao-efetiva";
import { hojeIso } from "@/lib/estoque/baixa";
import { carregarSituacaoEstoque } from "@/lib/estoque/situacao-dados";
import { createClientUntyped } from "@/lib/supabase/server";
import { lerACaminho } from "@/lib/suprimentos/a-caminho";

export const dynamic = "force-dynamic";

/**
 * Situação do estoque: o painel único de alertas (D1, L1). Antes a mesma
 * pergunta ("o que está em falta, vencendo ou abaixo do mínimo?") era
 * respondida em cinco telas, com palavras diferentes.
 */
export default async function SituacaoDoEstoquePage() {
  const hoje = hojeIso();
  const supabase = await createClientUntyped();
  const [painel, podeCriarPedido, aCaminho] = await Promise.all([
    carregarSituacaoEstoque(supabase, hoje),
    pode("pedido.criar"),
    // L9: "a caminho" é assunto de estoque e fica junto dos alertas; a lista segue a permissão de Compras
    pode("compras.ver").then((ok) => (ok ? lerACaminho(supabase, hoje) : null)),
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
                Cada quadro mostra quais insumos ou lotes pedem atenção e por quê. Clique no nome para abrir a
                ficha do insumo ou a página do lote.
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

        <PainelSituacaoEstoque
          insumos={painel.insumos}
          lotesVencendo={painel.lotesVencendo}
          lotes={painel.lotes}
          movimentos={painel.movimentos}
          movimentosCompletos={painel.movimentosCompletos}
          graficosIncompletos={painel.graficosIncompletos}
          hojeIso={hoje}
          erro={painel.erro}
        />

        <ACaminhoInsumos itens={aCaminho?.itens ?? []} erro={aCaminho?.erro} semAcesso={!aCaminho} />
      </main>
    </div>
  );
}
