import Link from "next/link";
import { adicionarItemPedidoInterno, removerItemPedidoInterno } from "@/lib/actions/pedidos-internos";
import { PedidoInternoAcoes } from "@/components/pedido/PedidoInternoAcoes";
import { ItemRecebimentoCell } from "@/components/pedido/ItemRecebimentoCell";
import { PedidoItemEditar } from "@/components/pedido/PedidoItemEditar";
import { PedidoItemCadastrarInsumo } from "@/components/pedido/PedidoItemCadastrarInsumo";
import {
  PedidoItemCamposAssistidos,
  type PedidoItemCatalogo,
} from "@/components/pedido/PedidoItemCamposAssistidos";
import { HelpTip } from "@/components/common/HelpTip";
import { FormComMensagem } from "@/components/pedido/FormComMensagem";
import { formatCurrency as brl, formatNumber as fmt } from "@/lib/formatters";
import {
  type PedidoInternoItem,
  catalogoComVinculoAtual,
  itemTipoLabel,
  type PedidoDetalhe,
} from "@/lib/pedido/detalhe";
import { ehItemNovo, insumosParecidos, STATUS_CADASTRA_ITEM_NOVO } from "@/lib/pedido/item-novo";
import type { Equivalente } from "@/lib/estoque/equivalentes";
import type { ItemCompraRecebivel } from "@/components/compras/ScannerRecebimentoCompra";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Props = {
  total: number;
  podeEditarItens: boolean;
  linhas: PedidoInternoItem[];
  equivalentes: Map<number, Equivalente[]>;
  pedidoId: number;
  compraFormal: { id: number; status: string; } | null;
  /** por item do pedido, o item da compra que já pode chegar (chegada única) */
  chegadasCompra: Map<number, ItemCompraRecebivel>;
  locais: { id: number; nome: string }[];
  catalogoItens: PedidoItemCatalogo[];
  aguardandoChegada: boolean;
  podeRegistrarRecebimento: boolean;
  /** "Corrigir estoque": a mesma permissão que o banco exige para estornar uma chegada */
  podeEstornar?: boolean;
  fornecedoresPedido: string[];
  editavel: boolean;
  pendencias: { label: string; ok: boolean; }[];
  avisoReenvio: string | null;
  pedido: PedidoDetalhe;
  podeGerir: boolean;
  podeCancelar: boolean;
  rascunhoCompleto: boolean;
  travaEnvio: string | null;
  /** "Editar insumos": quem pode cadastrar o item novo pelo pedido */
  podeCadastrarInsumo?: boolean;
};

function chegadaDoItem(
  chegadas: Map<number, ItemCompraRecebivel>,
  itemId: number,
  locais: { id: number; nome: string }[],
) {
  const item = chegadas.get(itemId);
  return item ? { item, locais } : null;
}

/** Materiais, serviços e equipamentos do pedido: tabela, inclusão de item e envio. */
export function PedidoItens({
  total,
  podeEditarItens,
  linhas,
  equivalentes,
  pedidoId,
  compraFormal,
  chegadasCompra,
  locais,
  catalogoItens,
  aguardandoChegada,
  podeRegistrarRecebimento,
  podeEstornar = false,
  fornecedoresPedido,
  editavel,
  pendencias,
  avisoReenvio,
  pedido,
  podeGerir,
  podeCancelar,
  rascunhoCompleto,
  travaEnvio,
  podeCadastrarInsumo = false,
}: Props) {
  // item novo (nunca comprado) só é assunto enquanto os itens ainda mudam
  const etapaDeItemNovo = STATUS_CADASTRA_ITEM_NOVO.includes(String(pedido.status));
  return (
    <section className="mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-1">
            <h2 className="text-sm font-semibold">Materiais, serviços e equipamentos</h2>
            <HelpTip title="Itens do pedido">
              <p>
                Monte a lista antes de enviar para aprovação. O valor <b>prévio</b> é uma estimativa;
                o preço final vem da cotação.
              </p>
            </HelpTip>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">Total prévio: <b>{brl(total)}</b></p>
      </div>

      <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Item</TableHead>
              <TableHead>Modelo/volume</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
              <TableHead className="text-right">Prévio un.</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Recebimento</TableHead>
              {podeEditarItens && <TableHead className="text-right">Ação</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="max-w-sm">
                  <p className="font-medium">{item.especificacao}</p>
                  <p className="text-xs text-muted-foreground">
                    {itemTipoLabel(item.tipo)}
                    {item.insumos?.especificacao ? ` · vinculado: ${item.insumos.especificacao}` : ""}
                  </p>
                  {etapaDeItemNovo && ehItemNovo(item) ? (
                    <p className="text-xs text-warning-strong" data-testid="item-novo">
                      <span className="font-medium">Item novo:</span>{" "}
                      {editavel
                        ? "ainda sem cadastro. Quem conduz a compra cadastra o insumo antes de formalizar."
                        : "falta cadastrar o insumo antes de formalizar."}
                    </p>
                  ) : null}
                  {item.insumos?.codigo_fabricante ? (
                    <p className="text-xs" data-testid="item-codigo-fabricante">
                      <span className="font-medium">Código do fabricante:</span> <span className="font-mono">{item.insumos.codigo_fabricante}</span>
                    </p>
                  ) : null}
                  {item.caracteristicas ? (
                    <p className="text-xs"><span className="font-medium">Indispensável:</span> {item.caracteristicas}</p>
                  ) : null}
                  {item.exigencia_tecnica ? (
                    <p className="text-xs"><span className="font-medium">Exigido por protocolo:</span> {item.exigencia_tecnica}</p>
                  ) : null}
                  {item.exclusividade ? (
                    <p className="text-xs"><span className="font-medium">Exclusividade:</span> {item.exclusividade}</p>
                  ) : null}
                  {item.insumo_id != null && (equivalentes.get(item.insumo_id) ?? []).slice(0, 2).map((eq) => (
                    <p key={eq.insumo_id} className="text-xs text-info-strong" data-testid="equivalente-com-saldo">
                      Já há no estoque, mesmo tipo: {eq.especificacao}{eq.fabricante ? ` (${eq.fabricante})` : ""} · {fmt(eq.disponivel)} {eq.unidade ?? ""}
                    </p>
                  ))}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {[item.modelo, item.volume].filter(Boolean).join(" · ") || "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {item.quantidade_em === "embalagem" && item.conteudo_embalagem
                    ? `${fmt(item.quantidade)} ${Number(item.quantidade) === 1 ? "frasco" : "frascos"} de ${fmt(item.conteudo_embalagem)} ${item.insumos?.unidade ?? ""}`.trim()
                    : `${fmt(item.quantidade)} ${item.unidade ?? item.insumos?.unidade ?? ""}`}
                </TableCell>
                <TableCell className="text-right tabular-nums">{brl(item.orcamento_previo)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {item.fornecedor_sugerido ?? "—"}
                  {item.outros_fornecedores ? <span className="block text-xs">Outros: {item.outros_fornecedores}</span> : null}
                </TableCell>
                <TableCell>
                  <ItemRecebimentoCell
                    item={{
                      id: item.id,
                      pedidoId,
                      especificacao: item.especificacao,
                      quantidade: Number(item.quantidade),
                      quantidadeRecebida: item.quantidade_recebida,
                      compraFormalId: compraFormal?.id ?? null,
                      unidade: item.unidade ?? item.insumos?.unidade ?? null,
                    }}
                    semCompra={aguardandoChegada && !compraFormal && podeRegistrarRecebimento}
                    podeEstornar={podeEstornar}
                    chegadaPelaCompra={chegadaDoItem(chegadasCompra, item.id, locais)}
                    recebidoEm={item.recebido_em}
                    recebidoPor={item.recebido_por}
                    recebimentos={(item.pedidos_internos_item_recebimentos ?? [])
                      .map((recebimento) => ({
                        id: recebimento.id,
                        loteId: recebimento.lote_id,
                        quantidade: Number(recebimento.quantidade),
                        codigoLote: recebimento.codigo_lote,
                        fornecedor: recebimento.fornecedor,
                        validade: recebimento.validade,
                        responsavel: recebimento.responsavel,
                        recebidoEm: recebimento.recebido_em,
                      }))
                      .sort((a, b) => Date.parse(b.recebidoEm) - Date.parse(a.recebidoEm))}
                  />
                  {item.lote_id && (
                    <Link href={`/estoque/lotes/${item.lote_id}`} className="mt-1 block text-xs text-primary hover:underline">
                      Lote #{item.lote_id}
                    </Link>
                  )}
                  {item.divergencia_recebimento && (
                    <p className="mt-1 text-[11px] text-warning-strong">{item.divergencia_recebimento}</p>
                  )}
                  {aguardandoChegada && compraFormal && !item.recebido_em && !chegadasCompra.has(item.id) && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Registrar a chegada pela <Link href={`/compras/${compraFormal.id}`} className="text-primary hover:underline">compra</Link>.
                    </p>
                  )}
                </TableCell>
                {podeEditarItens && (
                  <TableCell className="text-right">
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      {podeCadastrarInsumo && ehItemNovo(item) && (
                        <PedidoItemCadastrarInsumo
                          pedidoId={pedidoId}
                          item={{
                            id: item.id,
                            especificacao: item.especificacao,
                            modelo: item.modelo,
                            volume: item.volume,
                            quantidade: Number(item.quantidade),
                            unidade: item.unidade,
                            orcamento_previo: item.orcamento_previo,
                          }}
                          parecidos={insumosParecidos({ especificacao: item.especificacao }, catalogoItens).map((insumo) => ({
                            id: insumo.id,
                            especificacao: insumo.especificacao ?? insumo.nomeItem ?? `Insumo #${insumo.id}`,
                            fabricante: insumo.fabricante ?? null,
                            codigoFabricante: insumo.codigoFabricante ?? null,
                          }))}
                        />
                      )}
                      <PedidoItemEditar pedidoId={pedidoId} item={item} catalogo={catalogoComVinculoAtual(catalogoItens, item)} fornecedores={fornecedoresPedido} />
                      <FormComMensagem action={removerItemPedidoInterno} className="flex flex-col items-end">
                        <input type="hidden" name="item_id" value={item.id} />
                        <input type="hidden" name="pedido_interno_id" value={pedidoId} />
                        <button className="text-xs text-danger-strong hover:underline">Remover</button>
                      </FormComMensagem>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {linhas.length === 0 && (
              <TableRow>
                <TableCell colSpan={podeEditarItens ? 7 : 6} className="py-6 text-center text-muted-foreground/80">
                  Nenhum material, serviço ou equipamento informado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {editavel && (
        <FormComMensagem action={adicionarItemPedidoInterno} className="mt-3 grid gap-2 rounded-lg border border-border bg-card p-3 shadow-sm">
          <input type="hidden" name="pedido_interno_id" value={pedidoId} />
          <div className="grid gap-3 md:grid-cols-12">
            <PedidoItemCamposAssistidos catalogo={catalogoItens} fornecedores={fornecedoresPedido} idPrefix="novo-item" />
            <div className="flex items-end md:col-span-4 xl:col-span-2">
              <button className="h-9 w-full rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Adicionar item
              </button>
            </div>
          </div>
        </FormComMensagem>
      )}
      {editavel && (
        <div id="envio" className="mt-3 scroll-mt-20 rounded-lg border border-border bg-card p-3 shadow-sm">
          {/* Em larguras médias (~1024 px com a barra lateral) a lista e as ações não cabem lado a lado: empilham. */}
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-muted-foreground">Conferir e enviar</h3>
              <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {pendencias.map((item) => (
                  <div key={item.label} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${item.ok ? "bg-brand-500" : "bg-warning-strong"}`} />
                    <span className={item.ok ? "text-muted-foreground" : "font-medium text-warning-strong"}>
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
              {avisoReenvio && (
                <p className="mt-2 text-xs text-muted-foreground" data-testid="aviso-reenvio">
                  <span aria-hidden="true">↺ </span>
                  {avisoReenvio}
                </p>
              )}
            </div>
            <div className="flex justify-start border-t border-border/70 pt-3 xl:justify-end xl:border-t-0 xl:pt-0">
              <PedidoInternoAcoes
                pedidoId={pedidoId}
                status={pedido.status}
                podeGerir={podeGerir}
                podeCancelar={podeCancelar}
                temCompraFormal={Boolean(compraFormal)}
                podeEnviarValidacao={rascunhoCompleto}
                motivoSemEnvio={travaEnvio ?? undefined}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
