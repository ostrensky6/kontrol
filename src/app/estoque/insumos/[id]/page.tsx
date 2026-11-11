import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/app/PageHeader";
import { HelpTip } from "@/components/common/HelpTip";
import { ConsumoMensalPainel } from "@/components/estoque/ConsumoMensalPainel";
import { GerarPedidoInsumoButton } from "@/components/pedido/GerarPedidoInsumoButton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lerConsumoMensal, lerPrevisaoInsumo } from "@/lib/estoque/consumo-mensal";
import type { FichaInsumo } from "@/lib/estoque/ficha-insumo";
import { idDaFicha } from "@/lib/estoque/ficha-insumo-rota";
import { lerFichaInsumo } from "@/lib/estoque/ficha-insumo-dados";
import { META_SINAL, ROTULO_ESTOQUE_OK, type TomSinal } from "@/lib/estoque/situacao-insumo";
import { formatDate, formatNumber } from "@/lib/formatters";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TOM: Record<TomSinal | "slate", string> = {
  red: "bg-danger-soft text-danger-strong",
  amber: "bg-warning-soft text-warning-strong",
  slate: "bg-success-soft text-success-strong",
};

const SEM_DADO = <span className="text-muted-foreground">sem dado</span>;

function Selo({ tom, children }: { tom: TomSinal | "slate" | "neutro"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
        tom === "neutro" ? "bg-muted text-muted-foreground" : TOM[tom],
      )}
    >
      {children}
    </span>
  );
}

function Numero({
  rotulo,
  valor,
  unidade,
  nota,
}: {
  rotulo: string;
  valor: React.ReactNode;
  unidade?: string;
  nota?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <dt className="text-xs font-medium text-muted-foreground">{rotulo}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
        {valor}
        {unidade ? <span className="ml-1.5 text-sm font-normal text-muted-foreground">{unidade}</span> : null}
      </dd>
      {nota ? <dd className="mt-1 text-xs text-muted-foreground">{nota}</dd> : null}
    </div>
  );
}

function Bloco({
  id,
  titulo,
  resumo,
  children,
}: {
  id: string;
  titulo: string;
  resumo?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-4 pb-2">
        <h2 id={id} className="text-base font-semibold">{titulo}</h2>
        {resumo ? <p className="text-xs text-muted-foreground">{resumo}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Estado vazio e leitura que falhou: uma linha, sem tabela vazia. */
function Linha({ children }: { children: React.ReactNode }) {
  return <p className="px-4 pb-4 text-sm text-muted-foreground">{children}</p>;
}

function Previsao({ linha }: { linha: FichaInsumo["andamento"][number] }) {
  if (!linha.previsao) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("tabular-nums", linha.diasAtraso != null && "font-semibold text-danger-strong")}>
      {formatDate(linha.previsao)}
      {linha.previsaoInformada ? "" : " (estimada)"}
      {linha.diasAtraso != null ? ` · ${linha.diasAtraso} dia${linha.diasAtraso === 1 ? "" : "s"} de atraso` : ""}
    </span>
  );
}

export default async function FichaDoInsumoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idRaw } = await params;
  const id = idDaFicha(idRaw);
  if (id === null) notFound();

  const [dados, consumo, previsaoConsumo] = await Promise.all([
    lerFichaInsumo(id),
    lerConsumoMensal(id),
    lerPrevisaoInsumo(id),
  ]);
  if (!dados) notFound();

  const { insumo, ficha, semDado, pode } = dados;
  const estoque = ficha.estoque;
  const unidade = estoque?.unidade || insumo.unidade || "";
  const identificacao = [
    insumo.codigoInterno ? `Código ${insumo.codigoInterno}` : null,
    insumo.nomeItem && insumo.nomeItem !== insumo.especificacao ? insumo.nomeItem : null,
    insumo.fabricante,
  ].filter(Boolean);
  const verAndamento = pode.pedidos || pode.compras;
  const andamentoSemDado = (pode.pedidos && semDado.pedidos) || (pode.compras && semDado.compras);
  const aCaminhoFato = ficha.andamento.filter((linha) => linha.confirmado).length;
  const podePedirReposicao = insumo.ativo && Boolean(estoque && estoque.sugerido > 0);

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container space-y-5">
        <PageHeader
          breadcrumbs={[
            { label: "Estoque", href: "/estoque" },
            { label: insumo.especificacao },
          ]}
          title={insumo.especificacao}
          description={identificacao.length ? identificacao.join(" · ") : undefined}
          meta={
            <div className="flex flex-wrap items-center gap-1.5" data-testid="ficha-situacao">
              {estoque ? (
                estoque.sinais.length ? (
                  estoque.sinais.map((sinal) => (
                    <Selo key={sinal} tom={META_SINAL[sinal].tom}>{META_SINAL[sinal].rotulo}</Selo>
                  ))
                ) : (
                  <Selo tom="slate">{ROTULO_ESTOQUE_OK}</Selo>
                )
              ) : (
                <Selo tom="neutro">Situação: sem dado</Selo>
              )}
              {!insumo.ativo && <Selo tom="neutro">Inativo</Selo>}
            </div>
          }
          help={
            <HelpTip title="Ficha do insumo">
              <p>
                Tudo sobre este insumo numa página: quanto há para usar, os lotes, o que foi pedido, o que
                está reservado para os planos, o consumo e as análises que o usam.
              </p>
              <p>
                <b>Disponível</b> é o que pode ser usado agora. <b>A caminho</b> conta só o que já foi comprado
                ou autorizado e ainda não chegou; pedido em aprovação ou cotação aparece na lista, mas não entra
                nesse número.
              </p>
              <p>Quando o Kontrol não consegue ler um número, a tela mostra “sem dado” em vez de zero.</p>
            </HelpTip>
          }
          actions={
            pode.cadastro || (pode.criarPedido && podePedirReposicao) ? (
              <>
                {/* veio do cartão do Controle de Estoque: pedido de um insumo só, quando a previsão sugere repor */}
                {pode.criarPedido && podePedirReposicao && <GerarPedidoInsumoButton insumoId={insumo.id} />}
                {pode.cadastro && (
                  <Link
                    href={`/cadastros/insumos?focus=${insumo.id}`}
                    className="inline-flex min-h-10 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-muted"
                  >
                    Abrir cadastro
                  </Link>
                )}
              </>
            ) : undefined
          }
        />

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="ficha-numeros">
          <Numero
            rotulo="Disponível"
            valor={estoque ? formatNumber(estoque.disponivel) : SEM_DADO}
            unidade={estoque ? unidade : undefined}
            nota={
              estoque
                ? [
                    `Em mãos ${formatNumber(estoque.emMaos)}`,
                    ficha.emQuarentena > 0 ? `em quarentena ${formatNumber(ficha.emQuarentena)}` : null,
                    ficha.bloqueado > 0 ? `bloqueado ${formatNumber(ficha.bloqueado)}` : null,
                  ].filter(Boolean).join(" · ")
                : "O saldo deste insumo não foi lido."
            }
          />
          <Numero
            rotulo="Reservado"
            valor={estoque ? formatNumber(estoque.reservado) : SEM_DADO}
            unidade={estoque ? unidade : undefined}
            nota={
              semDado.reservas
                ? "Reservas: sem dado."
                : ficha.reservas.length
                  ? `Em ${ficha.reservas.length} plano${ficha.reservas.length === 1 ? "" : "s"}`
                  : estoque
                    ? "Nenhuma reserva ativa"
                    : undefined
            }
          />
          <Numero
            rotulo="A caminho"
            valor={estoque && estoque.aCaminho !== null ? formatNumber(estoque.aCaminho) : SEM_DADO}
            unidade={estoque && estoque.aCaminho !== null ? unidade : undefined}
            nota={
              estoque && estoque.aCaminho !== null
                ? (estoque.aguardandoAprovacao ?? 0) > 0
                  ? `+${formatNumber(estoque.aguardandoAprovacao ?? 0)} aguardando aprovação`
                  : "Comprado ou autorizado, ainda não recebido"
                : "A previsão deste insumo não foi lida."
            }
          />
          <Numero
            rotulo="Mínimo"
            valor={estoque ? (estoque.minimo > 0 ? formatNumber(estoque.minimo) : "—") : SEM_DADO}
            unidade={estoque && estoque.minimo > 0 ? unidade : undefined}
            nota={
              estoque
                ? estoque.sugerido > 0
                  ? `Pedir cerca de ${formatNumber(estoque.sugerido)} ${unidade}`.trim()
                  : estoque.minimo > 0
                    ? "Abaixo disso é hora de repor"
                    : "Sem mínimo definido"
                : undefined
            }
          />
        </dl>

        <p className="text-sm text-muted-foreground" data-testid="ficha-prazos">
          Prazo de compra:{" "}
          <span className="font-medium text-foreground">
            {ficha.prazoCompraDias === null ? "sem dado" : `${formatNumber(ficha.prazoCompraDias)} dias`}
          </span>
          {" · "}O disponível cobre:{" "}
          <span className="font-medium text-foreground">
            {ficha.coberturaDias === null ? "sem dado" : `${formatNumber(Math.floor(ficha.coberturaDias))} dias de consumo`}
          </span>
          {estoque?.validade ? (
            <>
              {" · "}Validade mais próxima:{" "}
              <span
                className={cn(
                  "font-medium text-foreground",
                  estoque.validadeEstado === "vencido" && "text-danger-strong",
                  estoque.validadeEstado === "vencendo" && "text-warning-strong",
                )}
              >
                {formatDate(estoque.validade)}
                {estoque.validadeEstado === "vencido" ? " (vencido)" : ""}
              </span>
            </>
          ) : null}
        </p>

        <Bloco
          id="ficha-lotes"
          titulo="Lotes"
          resumo={ficha.lotes.length > 1 ? "O que vence primeiro aparece primeiro." : undefined}
        >
          {semDado.lotes ? (
            <Linha>Sem dado: os lotes ou as reservas deste insumo não foram lidos.</Linha>
          ) : ficha.lotes.length === 0 ? (
            <Linha>Nenhum lote com saldo.</Linha>
          ) : (
            <div className="overflow-x-auto pb-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lote</TableHead>
                    <TableHead>Validade</TableHead>
                    <TableHead className="text-right">Quantidade</TableHead>
                    <TableHead className="text-right">Reservado</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Fornecedor e nota</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ficha.lotes.map((lote) => (
                    <TableRow key={lote.id}>
                      <TableCell className="whitespace-nowrap font-medium">
                        <Link href={`/estoque/lotes/${lote.id}`} className="underline-offset-2 hover:underline">
                          {lote.codigo}
                        </Link>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "tabular-nums",
                          lote.validadeEstado === "vencido" && "font-semibold text-danger-strong",
                          lote.validadeEstado === "vencendo" && "font-medium text-warning-strong",
                        )}
                      >
                        {lote.validade ? formatDate(lote.validade) : "—"}
                        {lote.validadeEstado === "vencido" ? " · vencido" : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(lote.quantidade)}
                        {unidade ? <span className="ml-1 text-xs text-muted-foreground">{unidade}</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {lote.reservado > 0 ? formatNumber(lote.reservado) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>{lote.statusRotulo}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {[lote.fornecedor, lote.notaFiscal ? `NF ${lote.notaFiscal}` : null].filter(Boolean).join(" · ") || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Bloco>

        {verAndamento && (
          <Bloco
            id="ficha-andamento"
            titulo="Pedidos e compras em andamento"
            resumo={
              ficha.andamento.length
                ? `${aCaminhoFato} a caminho · ${ficha.andamento.length - aCaminhoFato} ainda não comprado${ficha.andamento.length - aCaminhoFato === 1 ? "" : "s"}`
                : undefined
            }
          >
            {andamentoSemDado && (
              <Linha>Sem dado: parte dos pedidos ou das compras deste insumo não foi lida.</Linha>
            )}
            {ficha.andamento.length === 0 ? (
              andamentoSemDado ? null : <Linha>Nenhum pedido ou compra em andamento com este insumo.</Linha>
            ) : (
              <div className="overflow-x-auto pb-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pedido ou compra</TableHead>
                      <TableHead>Etapa</TableHead>
                      <TableHead className="text-right">Quantidade</TableHead>
                      <TableHead>Previsão de chegada</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ficha.andamento.map((linha) => (
                      <TableRow key={linha.chave}>
                        <TableCell className="font-medium">
                          <Link href={linha.href} className="underline-offset-2 hover:underline">
                            {linha.rotulo}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>{linha.situacao}</span>
                            <Selo tom={linha.confirmado ? "slate" : "neutro"}>
                              {linha.confirmado ? "A caminho" : "Ainda não comprado"}
                            </Selo>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{linha.quantidade}</TableCell>
                        <TableCell><Previsao linha={linha} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Bloco>
        )}

        <Bloco id="ficha-reservas" titulo="Reservas em planos">
          {semDado.reservas ? (
            <Linha>Sem dado: as reservas deste insumo não foram lidas.</Linha>
          ) : ficha.reservas.length === 0 ? (
            <Linha>Nenhuma reserva ativa.</Linha>
          ) : (
            <div className="overflow-x-auto pb-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plano</TableHead>
                    <TableHead className="text-right">Reservado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ficha.reservas.map((reserva) => (
                    <TableRow key={reserva.planejamentoId ?? "sem-plano"}>
                      <TableCell className="font-medium">
                        {pode.planos && reserva.planejamentoId != null ? (
                          <Link href={`/planejamento/${reserva.planejamentoId}`} className="underline-offset-2 hover:underline">
                            {reserva.plano}
                          </Link>
                        ) : (
                          reserva.plano
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(reserva.quantidade)}
                        {unidade ? <span className="ml-1 text-xs text-muted-foreground">{unidade}</span> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Bloco>

        <div className="rounded-lg border border-border bg-card p-4">
          <ConsumoMensalPainel leitura={consumo} especificacao={insumo.especificacao} previsao={previsaoConsumo} naFicha />
          <p className="mt-3 text-sm">
            <Link
              prefetch={false}
              href={`/estoque?consumo_insumo=${insumo.id}#consumo-manual`}
              className="font-medium underline underline-offset-2"
            >
              Estimativa manual e histórico de revisões
            </Link>
          </p>
        </div>

        {pode.analises && (
          <Bloco id="ficha-analises" titulo="Análises que usam este insumo">
            {semDado.analises ? (
              <Linha>Sem dado: as análises deste insumo não foram lidas.</Linha>
            ) : ficha.analises.length === 0 ? (
              <Linha>Nenhuma análise usa este insumo.</Linha>
            ) : (
              <div className="overflow-x-auto pb-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Análise</TableHead>
                      <TableHead>Etapa</TableHead>
                      <TableHead className="text-right">Por amostra</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ficha.analises.map((analise) => (
                      <TableRow key={analise.chave}>
                        <TableCell className="font-medium">
                          <Link href={`/analises/${encodeURIComponent(analise.codigo)}`} className="underline-offset-2 hover:underline">
                            {analise.codigo}
                          </Link>
                        </TableCell>
                        <TableCell>{analise.etapa}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {analise.quantidade === null ? "—" : `${formatNumber(analise.quantidade)} ${analise.unidade}`.trim()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Bloco>
        )}

        <Bloco id="ficha-movimentos" titulo="Últimas movimentações">
          {semDado.movimentos ? (
            <Linha>Sem dado: as movimentações deste insumo não foram lidas.</Linha>
          ) : ficha.movimentos.length === 0 ? (
            <Linha>Nenhuma movimentação registrada.</Linha>
          ) : (
            <div className="overflow-x-auto pb-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Quantidade</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Lote</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ficha.movimentos.map((movimento) => (
                    <TableRow key={movimento.id}>
                      <TableCell className="tabular-nums">{movimento.data ? formatDate(movimento.data) : "—"}</TableCell>
                      <TableCell>{movimento.tipo}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(movimento.quantidade)}</TableCell>
                      <TableCell className="text-muted-foreground">{movimento.motivo ?? "—"}</TableCell>
                      <TableCell>
                        {movimento.loteId != null ? (
                          <Link href={`/estoque/lotes/${movimento.loteId}`} className="underline-offset-2 hover:underline">
                            Lote #{movimento.loteId}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Bloco>
      </main>
    </div>
  );
}
