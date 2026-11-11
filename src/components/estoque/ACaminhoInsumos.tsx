import { HelpTip } from "@/components/common/HelpTip";
import Link from "next/link";

import { hrefFichaInsumo } from "@/lib/estoque/ficha-insumo-rota";
import { formatDate } from "@/lib/formatters";
import { pedidoInternoNumero } from "@/lib/pedido/status";
import { resumirACaminho, type ItemACaminho } from "@/lib/suprimentos/a-caminho";

const VISIVEIS = 8;

function Previsao({ item }: { item: ItemACaminho }) {
  if (!item.previsao) return <span className="text-muted-foreground">Sem previsão</span>;
  return (
    <span>
      {formatDate(item.previsao)}
      {item.previsaoInformada ? null : (
        <span className="ml-1 text-xs text-muted-foreground" title="Sem data informada na compra: estimada pelo prazo do insumo ou do fornecedor">
          (estimada)
        </span>
      )}
    </span>
  );
}

function Situacao({ item }: { item: ItemACaminho }) {
  // sem aprovação não há compra feita: o "atraso" seria de uma expectativa, não do fornecedor
  if (item.aguardaAprovacao) {
    return (
      <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-strong">
        {item.situacao}
      </span>
    );
  }
  if (item.diasAtraso != null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger-strong">
        <span aria-hidden="true">!</span>
        {`Atrasado há ${item.diasAtraso} ${item.diasAtraso === 1 ? "dia" : "dias"}`}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-info-soft px-2 py-0.5 text-xs font-medium text-info-strong">
      {item.situacao}
    </span>
  );
}

function Origem({ item }: { item: ItemACaminho }) {
  return (
    <span className="flex flex-wrap gap-x-2 whitespace-nowrap">
      <Link href={`/compras/${item.compraId}`} className="font-medium text-primary hover:underline">
        Compra #{item.compraId}
      </Link>
      {item.pedidoInternoId != null ? (
        <Link href={`/pedido/${item.pedidoInternoId}`} className="text-primary hover:underline">
          Pedido {pedidoInternoNumero(item.pedidoInternoId)}
        </Link>
      ) : null}
    </span>
  );
}

function Linhas({ itens }: { itens: ItemACaminho[] }) {
  return (
    <>
      <ul className="space-y-2 md:hidden">
        {itens.map((item) => (
          <li key={item.itemId} className="rounded-md border border-border bg-card p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="font-medium">{item.especificacao}</span>
              <Situacao item={item} />
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-muted-foreground">Pedido</dt><dd>{item.solicitado}</dd></div>
              <div><dt className="text-muted-foreground">Recebido</dt><dd>{item.recebido}</dd></div>
              <div><dt className="text-muted-foreground">Falta</dt><dd className="font-semibold">{item.pendente}</dd></div>
            </dl>
            <p className="mt-2 text-xs">Previsão: <Previsao item={item} /></p>
            <p className="mt-1 text-xs text-muted-foreground">
              {[item.fornecedor, item.caminho].filter(Boolean).join(" · ") || "Fornecedor não informado"}
            </p>
            <div className="mt-2 text-xs"><Origem item={item} /></div>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">Insumo</th>
              <th scope="col" className="py-2 pr-3 font-medium">Pedido</th>
              <th scope="col" className="py-2 pr-3 font-medium">Recebido</th>
              <th scope="col" className="py-2 pr-3 font-medium">Falta receber</th>
              <th scope="col" className="py-2 pr-3 font-medium">Previsão</th>
              <th scope="col" className="py-2 pr-3 font-medium">Situação</th>
              <th scope="col" className="py-2 pr-3 font-medium">Fornecedor / caminho</th>
              <th scope="col" className="py-2 font-medium">Origem</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => (
              <tr key={item.itemId} className="border-b border-border/60 align-top">
                <td className="py-2 pr-3 font-medium">
                  {item.insumoId != null ? (
                    <Link href={hrefFichaInsumo(item.insumoId) ?? "/estoque"} className="hover:underline">{item.especificacao}</Link>
                  ) : item.especificacao}
                </td>
                <td className="py-2 pr-3 tabular-nums">{item.solicitado}</td>
                <td className="py-2 pr-3 tabular-nums">{item.recebido}</td>
                <td className="py-2 pr-3 font-semibold tabular-nums">{item.pendente}</td>
                <td className="py-2 pr-3"><Previsao item={item} /></td>
                <td className="py-2 pr-3"><Situacao item={item} /></td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {[item.fornecedor, item.caminho].filter(Boolean).join(" · ") || "Não informado"}
                </td>
                <td className="py-2"><Origem item={item} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * Quadro "A caminho" da Situação do estoque: compras feitas e ainda não
 * recebidas por inteiro. Mostra só o que falta receber; o que chegou já está
 * no saldo do estoque.
 */
export function ACaminhoInsumos({
  itens,
  erro,
  semAcesso = false,
}: {
  itens: ItemACaminho[];
  erro?: string | null;
  /** Sem a caixinha "Acessar Compras" a lista viria vazia; diz isso em vez de "nada a caminho". */
  semAcesso?: boolean;
}) {
  const resumo = resumirACaminho(itens);
  // fato e expectativa separados: compra sem aprovação não é "a caminho"
  const confirmados = itens.filter((item) => !item.aguardaAprovacao);
  const esperando = itens.filter((item) => item.aguardaAprovacao);
  const primeiros = confirmados.slice(0, VISIVEIS);
  const demais = confirmados.slice(VISIVEIS);
  return (
    <section aria-labelledby="a-caminho-titulo" className="rounded-lg border border-border bg-card p-4" data-testid="painel-a-caminho">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-1">
          <h2 id="a-caminho-titulo" className="text-base font-semibold">A caminho: compras ainda não recebidas</h2>
          <HelpTip title="A caminho">
            <p>
              Confira aqui antes de pedir de novo. Só aparece o que falta receber do que já foi comprado ou
              autorizado; o que já chegou está no saldo do estoque.
            </p>
            <p>Compra que ainda espera aprovação fica à parte, logo abaixo: ela não garante entrega.</p>
          </HelpTip>
        </div>
        <Link href="/recebimento" className="text-sm font-medium text-primary hover:underline">Registrar recebimento</Link>
      </div>
      {semAcesso ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Para ver as compras a caminho é preciso a permissão &quot;Acessar Compras&quot;. Peça ao administrador.
        </p>
      ) : null}
      {erro ? (
        <p role="alert" className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-strong">
          Não foi possível ler todos os pedidos a caminho ({erro}). A lista pode estar incompleta.
        </p>
      ) : null}
      {confirmados.length === 0 && !erro && !semAcesso ? (
        <p className="mt-3 text-sm">Nenhuma compra aprovada aguardando entrega.</p>
      ) : null}
      {confirmados.length > 0 ? (
        <>
          <p className="mt-3 text-sm" data-testid="resumo-a-caminho">
            {`${resumo.itens} ${resumo.itens === 1 ? "item" : "itens"} em ${resumo.compras} ${resumo.compras === 1 ? "compra" : "compras"}`}
            {resumo.atrasados > 0 ? (
              <span className="font-semibold text-danger-strong">{` · ${resumo.atrasados} ${resumo.atrasados === 1 ? "atrasado" : "atrasados"}`}</span>
            ) : null}
            {resumo.semPrevisaoInformada > 0 ? (
              <span className="text-muted-foreground">{` · ${resumo.semPrevisaoInformada} com previsão só estimada`}</span>
            ) : null}
          </p>
          <div className="mt-3">
            <Linhas itens={primeiros} />
          </div>
          {demais.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-primary">{`Ver mais ${demais.length}`}</summary>
              <div className="mt-3"><Linhas itens={demais} /></div>
            </details>
          ) : null}
        </>
      ) : null}
      {esperando.length > 0 ? (
        <details className="mt-4 rounded-md border border-dashed border-border p-3" data-testid="a-caminho-sem-aprovacao" open={confirmados.length === 0}>
          <summary className="cursor-pointer text-sm font-medium">
            {`${esperando.length} ${esperando.length === 1 ? "item pedido aguarda" : "itens pedidos aguardam"} aprovação`}
            <span className="font-normal text-muted-foreground"> · ainda não é compra, não garante entrega</span>
          </summary>
          <div className="mt-3"><Linhas itens={esperando} /></div>
        </details>
      ) : null}
    </section>
  );
}
