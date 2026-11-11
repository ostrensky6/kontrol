import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient, createClientUntyped } from "@/lib/supabase/server";
import { pode } from "@/lib/auth/permissao-efetiva";
import { usuarioAtual } from "@/lib/auth/roles";
import {
  hojeIso,
  loteBaixaDeDb,
  loteVencido,
  somarReservasPorLote,
  type LoteBaixa,
  type LoteDbBaixa,
} from "@/lib/estoque/baixa";
import { janelaVencimentoDias } from "@/lib/estoque/situacao-insumo";
import {
  VISOES_ESTOQUE,
  destinoAntigoDoEstoque,
  hrefVisaoEstoque,
  visaoDoEstoque,
} from "@/lib/estoque/visao-estoque";
import { hrefFichaInsumo } from "@/lib/estoque/ficha-insumo-rota";
import {
  filtroEstoqueValido,
  montarEstoqueDisponivel,
  type AlertaDisponivelDb,
  type PrevisaoDisponivelDb,
  type SaldoDisponivelDb,
} from "@/lib/suprimentos/estoque-disponivel";
import { PageHeader } from "@/components/app/PageHeader";
import { AguardandoVoceLinha } from "@/components/dashboard/AguardandoVoceLinha";
import { PENDENCIAS_DE_ESTOQUE, pendenciasDe } from "@/components/dashboard/aguardando";
import { carregarPendencias } from "@/lib/pendencias/carregar";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { formatDate, formatDateTime, formatNumber } from "@/lib/formatters";
import { DownloadButton } from "@/components/common/DownloadButton";
import { HelpLegend, HelpTip } from "@/components/common/HelpTip";
import { LotesTable, SaldoTable, type LoteRow, type SaldoRow } from "@/components/estoque/EstoqueTables";
import { lerTudo } from "@/lib/supabase/ler-tudo";
import type { Tables } from "@/lib/supabase/database.types";
import { lerConsumoManual, type RevisaoConsumoManual } from "@/lib/actions/consumo-manual";
import { RegistrarConsumoManualForm } from "@/components/estoque/RegistrarConsumoManualForm";
import { ConsumoMensalPainel } from "@/components/estoque/ConsumoMensalPainel";
import { lerConsumoMensal, lerPrevisaoInsumo } from "@/lib/estoque/consumo-mensal";

export const dynamic = "force-dynamic";

const LOTE_STATUS: Record<string, string> = {
  quarentena: "Quarentena",
  aceito: "Disponível",
  em_uso: "Em uso",
  bloqueado: "Bloqueado",
  // saldo zerado por qualquer motivo (uso, perda, vencimento); no banco segue 'consumido'
  consumido: "Esgotado",
  descartado: "Descartado",
};

type LoteEstoqueDb = LoteDbBaixa & {
  insumo_id: number;
  conteudo_embalagem_snapshot?: number | null;
  recebido_por_id?: string | null;
  insumos: { especificacao: string | null; unidade: string | null; categoria_compra: string | null } | null;
};

const decimalConsumo = new Intl.NumberFormat("en-US", { useGrouping: false, maximumSignificantDigits: 21 });

function inteiroDaConsulta(valor: string | string[] | undefined) {
  const n = typeof valor === "string" && /^\d+$/.test(valor) ? Number(valor) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function hrefConsumo(insumoId: number, antes?: number) {
  return `/estoque?consumo_insumo=${insumoId}${antes == null ? "" : `&consumo_antes=${antes}`}#consumo-manual`;
}

function DadosRevisaoConsumo({ registro }: { registro: RevisaoConsumoManual }) {
  return (
    <>
      <p className="font-medium text-foreground">
        Revisão {registro.revisao} · {decimalConsumo.format(registro.quantidade_embalagens_mes).replace(".", ",")} embalagens/mês
      </p>
      <dl className="mt-1 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
        <div><dt className="font-medium text-foreground">Apresentação confirmada</dt><dd>{decimalConsumo.format(registro.conteudo_embalagem).replace(".", ",")} {registro.unidade_conteudo} por embalagem</dd></div>
        <div><dt className="font-medium text-foreground">Data de referência</dt><dd><time dateTime={registro.data_referencia}>{formatDate(registro.data_referencia)}</time></dd></div>
        <div className="min-w-0 break-words"><dt className="font-medium text-foreground">Fonte</dt><dd>{registro.fonte}</dd></div>
        <div className="min-w-0 break-words"><dt className="font-medium text-foreground">Motivo</dt><dd>{registro.motivo}</dd></div>
      </dl>
      <p className="mt-1 text-xs text-muted-foreground">Registrada em <time dateTime={registro.registrado_em}>{formatDateTime(registro.registrado_em)}</time></p>
    </>
  );
}

export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<{
    ver?: string | string[];
    alerta?: string | string[];
    entrada?: string | string[];
    consumo_insumo?: string | string[];
    consumo_antes?: string | string[];
    situacao?: string | string[];
  }>;
}) {
  const query = await searchParams;
  // alertas e custos mudaram de lugar (D1, L10): os links antigos levam ao novo
  const destino = destinoAntigoDoEstoque(query);
  if (destino) redirect(destino);
  const entrada = Array.isArray(query.entrada) ? query.entrada[0] : query.entrada;
  const entradaInicialInsumoId = /^\d+$/.test(entrada ?? "") ? Number(entrada) : undefined;
  const supabase = await createClient();
  // modelo_quantidade (0109) ainda não está nos tipos gerados.
  const supabaseSemTipos = await createClientUntyped();
  const [
    { data: saldo, error: saldoError },
    { data: alertas },
    { data: lotesRaw, error: lotesError },
    { data: previsao },
    { data: parametros },
    { data: vinculosCompra, error: vinculosCompraError },
    { data: vinculosInternos, error: vinculosInternosError },
    { data: reservasRaw, error: reservasError },
  ] = await Promise.all([
    // listas de estoque lidas de mil em mil (o PostgREST corta em 1.000 linhas)
    lerTudo<Tables<"v_estoque_saldo">>((de, ate) =>
      supabase.from("v_estoque_saldo").select("*").order("especificacao").order("insumo_id").range(de, ate),
    ),
    supabase.from("v_alertas_estoque").select("insumo_id, tipo"),
    lerTudo<Record<string, unknown>>((de, ate) =>
      supabaseSemTipos
        .from("lotes_estoque")
        .select("id, insumo_id, codigo_lote, validade, validade_apos_abertura, quantidade_atual, status, modelo_quantidade, conteudo_embalagem_snapshot, recebido_por_id, insumos(especificacao, unidade, categoria_compra)")
        .not("status", "in", "(consumido,descartado)")
        .order("validade", { nullsFirst: false })
        .order("id")
        .range(de, ate),
    ),
    // a mesma previsão da Situação do estoque: a caminho, aguardando aprovação e repor
    supabase.from("v_previsao_suprimentos").select("insumo_id, qtd_sugerida_compra, qtd_pedida_aberta, qtd_pedida_pendente"),
    // janela do "vence em breve": a mesma de v_alertas_estoque (padrão 60 dias)
    supabase.from("parametros").select("chave, valor").eq("chave", "janela_vencimento_dias"),
    lerTudo<{ lote_id: number | null }>((de, ate) => supabase.from("pedidos_compra_item_recebimentos").select("id, lote_id").order("id").range(de, ate)),
    lerTudo<{ lote_id: number | null }>((de, ate) => supabase.from("pedidos_internos_item_recebimentos").select("id, lote_id").order("id").range(de, ate)),
    lerTudo<Pick<Tables<"reservas_estoque">, "lote_id" | "quantidade" | "quantidade_consumida" | "status">>((de, ate) =>
      supabase
        .from("reservas_estoque")
        .select("id, lote_id, quantidade, quantidade_consumida, status")
        .in("status", ["reservado", "parcial"])
        .order("id")
        .range(de, ate),
    ),
  ]);
  const lotes = (lotesRaw ?? []) as unknown as LoteEstoqueDb[];
  // reserva não lida não pode virar "nada reservado" (o disponível ficaria maior)
  if (saldoError || lotesError) throw new Error(`Não foi possível ler o saldo do estoque: ${(saldoError ?? lotesError)!.message}`);
  if (reservasError) throw new Error(`Não foi possível ler as reservas do estoque: ${reservasError.message}`);
  const reservadoPorLote = somarReservasPorLote(reservasRaw ?? []);
  const [podeAceitar, podeGerir, podeCorrigir, podeBaixar, usuario, aguardando] = await Promise.all([
    pode("estoque.lote.aceitar"),
    pode("estoque.descartar_bloquear"),
    pode("estoque.lote.gerir"),
    pode("estoque.movimentar"),
    usuarioAtual(),
    // o que espera a pessoa no Estoque: lotes em quarentena, códigos lidos sem cadastro e manutenção vencida
    carregarPendencias(),
  ]);
  const pendencias = pendenciasDe(aguardando, PENDENCIAS_DE_ESTOQUE);

  const hoje = hojeIso();
  const origemEstornoComprovada = !vinculosCompraError && !vinculosInternosError;
  const lotesVinculados = new Set([
    ...(vinculosCompra ?? []).map((recebimento) => Number(recebimento.lote_id)),
    ...(vinculosInternos ?? []).map((recebimento) => Number(recebimento.lote_id)),
  ]);
  const lotesBaixaPorInsumo = new Map<number, LoteBaixa[]>();
  for (const l of lotes) {
    if (!(Number(l.quantidade_atual ?? 0) > 0)) continue;
    const lista = lotesBaixaPorInsumo.get(Number(l.insumo_id)) ?? [];
    lista.push(loteBaixaDeDb(l, reservadoPorLote));
    lotesBaixaPorInsumo.set(Number(l.insumo_id), lista);
  }
  // D1: as mesmas linhas, regras e palavras da Situação do estoque e da ficha do insumo
  const linhas = montarEstoqueDisponivel({
    saldo: (saldo ?? []) as SaldoDisponivelDb[],
    previsao: (previsao ?? []) as PrevisaoDisponivelDb[],
    alertas: (alertas ?? []) as AlertaDisponivelDb[],
    lotes: lotes.map((l) => ({
      insumo_id: Number(l.insumo_id),
      validade: l.validade ?? null,
      validade_apos_abertura: l.validade_apos_abertura ?? null,
      quantidade_atual: l.quantidade_atual,
      status: l.status,
    })),
    hoje,
    janelaVencimento: janelaVencimentoDias((parametros as { valor: unknown }[] | null)?.[0]?.valor),
  });
  const saldoPorInsumo = new Map((saldo ?? []).map((s) => [Number(s.insumo_id), s]));
  const saldoRows: SaldoRow[] = linhas.map((linha) => {
    const s = saldoPorInsumo.get(linha.insumoId);
    return {
      ...linha,
      unidadeFisica: s?.unidade ?? "",
      embalagemFechada: s?.modelo_quantidade === "EMBALAGEM_FECHADA",
      lotesBaixa: lotesBaixaPorInsumo.get(linha.insumoId) ?? [],
    };
  });
  const situacaoPedida = Array.isArray(query.situacao) ? query.situacao[0] : query.situacao;
  const filtroSaldo = situacaoPedida ? filtroEstoqueValido(situacaoPedida) : "todos";
  const insumoConsultado = inteiroDaConsulta(query.consumo_insumo);
  const antesDaRevisao = inteiroDaConsulta(query.consumo_antes);
  const cursorInvalido = query.consumo_antes !== undefined && antesDaRevisao === null;
  const insumosConsultaveis = saldoRows.filter(({ insumoId }) => Number.isSafeInteger(insumoId) && insumoId > 0);
  const insumoSelecionado = insumosConsultaveis.find(({ insumoId }) => insumoId === insumoConsultado);
  const [consumoManual, consumoMensal, previsaoInsumo] = insumoSelecionado && !cursorInvalido
    ? await Promise.all([
      lerConsumoManual(insumoSelecionado.insumoId, antesDaRevisao, 25),
      lerConsumoMensal(insumoSelecionado.insumoId),
      lerPrevisaoInsumo(insumoSelecionado.insumoId),
    ])
    : [null, null, null];
  const visao = visaoDoEstoque(query);
  const contagemDaVisao: Record<string, number | null> = {
    saldo: saldoRows.length,
    lotes: lotes.length,
  };
  const loteRows: LoteRow[] = lotes.map((l) => {
    const ins = l.insumos;
    const baixa = loteBaixaDeDb(l, reservadoPorLote);
    return {
      id: l.id,
      especificacao: ins?.especificacao ?? "—",
      unidade:
        baixa.modeloQuantidade === "EMBALAGEM_FECHADA"
          ? `frasco(s)${l.conteudo_embalagem_snapshot ? ` de ${formatNumber(l.conteudo_embalagem_snapshot)} ${ins?.unidade ?? ""}`.trimEnd() : ""}`
          : ins?.unidade ?? "",
      codigoLote: l.codigo_lote ?? "—",
      validade: baixa.validade ? formatDate(baixa.validade) : "—",
      validadeIso: baixa.validade,
      quantidadeAtual: baixa.quantidadeAtual,
      reservado: baixa.reservado,
      modeloQuantidade: baixa.modeloQuantidade,
      status: l.status,
      statusLabel: LOTE_STATUS[l.status] ?? l.status,
      vencido: loteVencido(baixa.validade, hoje),
      critico: ins?.categoria_compra === "critico",
      estornoDiretoPermitido:
        origemEstornoComprovada && !lotesVinculados.has(Number(l.id)),
      // Dupla conferência: quem registrou a chegada não aceita o próprio lote (admin isento).
      aceiteBloqueadoMotivo:
        usuario && l.recebido_por_id && l.recebido_por_id === usuario.id && usuario.papel !== "admin"
          ? "Você registrou a chegada; o aceite fica com outra pessoa."
          : null,
    };
  });

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <PageHeader
          title="Saldo e lotes"
          description="Saldo por insumo e lotes, com entrada e baixa."
          help={
            <HelpTip title="Saldo e lotes">
              <p>
                Escolha o que ver: saldo por insumo ou lotes. O uso segue <b>FEFO</b>: o lote que vence primeiro
                sai primeiro.
              </p>
              <p>
                <b>Registrar chegada</b> cria um lote com o número do fabricante. <b>Dar baixa</b> retira material
                com motivo (consumo, perda, vencimento ou outro).
              </p>
              <p>
                O que pede atenção (falta, validade, compra atrasada) fica em <b>Situação do estoque</b>, na barra acima. Consumo, prazo e
                histórico de cada insumo ficam na ficha dele: clique no nome.
              </p>
            </HelpTip>
          }
          // Situação do estoque e Custo do estoque são itens da barra do Estoque, logo acima:
          // os dois botões que repetiam esses links saíram daqui (duplicidade)
          actions={
            <DownloadButton href="/cadastros/insumos/export" fileName="insumos.xlsx">
              Planilha de insumos
            </DownloadButton>
          }
        />

        <AguardandoVoceLinha pendencias={pendencias} className="mt-3" />

        {visao !== "consumo" && (
        <nav aria-label="O que mostrar do estoque" className="mt-2 flex flex-wrap gap-2 border-b border-border pb-3">
          {VISOES_ESTOQUE.map((v) => {
            const ativa = v.id === visao;
            const contagem = contagemDaVisao[v.id];
            return (
              <Link
                key={v.id}
                href={hrefVisaoEstoque(v.id)}
                aria-current={ativa ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors",
                  ativa
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-primary/5",
                )}
              >
                {v.rotulo}
                {contagem != null && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-xs tabular-nums",
                      ativa ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {contagem}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        )}

        {visao === "saldo" && (
          <div className="mt-4">
            <SaldoTable
              rows={saldoRows}
              podeMovimentar={podeBaixar}
              entradaInicialInsumoId={entradaInicialInsumoId}
              filtroInicial={filtroSaldo}
            />
          </div>
        )}

        {visao === "consumo" && (
          <section id="consumo-manual" aria-labelledby="titulo-consumo-manual" tabIndex={-1} className="mt-4 scroll-mt-20 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-1">
              <h3 id="titulo-consumo-manual" className="text-base font-semibold">Consumo mensal</h3>
              <HelpTip title="Consumo mensal">
                <p>Escolha um insumo para ver quanto saiu do estoque em cada mês e o consumo de referência.</p>
                <p>Quando ainda há pouco histórico, informe uma estimativa manual em embalagens por mês. Ela vale até o cálculo ganhar confiança alta.</p>
                <p>Uma nova estimativa não apaga as anteriores; o histórico fica guardado.</p>
              </HelpTip>
              {/* L10: o consumo se lê na ficha do insumo; aqui ficam a estimativa manual e o histórico */}
              {insumoSelecionado && (
                <Link
                  href={hrefFichaInsumo(insumoSelecionado.insumoId) ?? "/estoque"}
                  className="ml-auto text-sm font-medium text-primary hover:underline"
                >
                  Voltar à ficha do insumo
                </Link>
              )}
            </div>
            {insumosConsultaveis.length > 0 ? (
              <form action="/estoque#consumo-manual" method="get" className="mt-3 flex flex-wrap items-end gap-2">
                <label className="min-w-0 flex-1 text-sm font-medium">
                  Insumo
                  <select name="consumo_insumo" defaultValue={insumoSelecionado?.insumoId ?? ""} required className="mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-2 text-sm">
                    <option value="" disabled>Selecione um insumo do saldo</option>
                    {insumosConsultaveis.map(({ insumoId, especificacao }) => (
                      <option key={insumoId} value={insumoId}>{especificacao} · #{insumoId}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="min-h-11 rounded-md border border-input px-3 text-sm font-medium hover:bg-muted">Ver consumo</button>
              </form>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Nenhum insumo disponível no saldo para consulta.</p>
            )}
            {query.consumo_insumo !== undefined && !insumoSelecionado && (
              <p className="mt-2 text-sm text-warning-strong">Insumo indisponível nesta lista. Selecione um insumo do saldo.</p>
            )}
            {insumoSelecionado && cursorInvalido && (
              <p className="mt-2 text-sm text-warning-strong">Página de histórico inválida. <Link prefetch={false} className="underline" href={hrefConsumo(insumoSelecionado.insumoId)}>Voltar às revisões recentes</Link>.</p>
            )}
            {insumoSelecionado && consumoMensal && antesDaRevisao === null && (
              <ConsumoMensalPainel leitura={consumoMensal} especificacao={insumoSelecionado.especificacao} previsao={previsaoInsumo} />
            )}
            {consumoManual && !consumoManual.ok && (
              <p role="status" className="mt-3 text-sm text-warning-strong">Estimativa indisponível. {consumoManual.message}</p>
            )}
            {insumoSelecionado && consumoManual?.ok && (
              <div className="mt-4 space-y-4 border-t border-border pt-3">
                <div>
                  <h4 className="text-sm font-semibold">Estimativa manual vigente</h4>
                  {consumoManual.vigente === null ? (
                    <p className="mt-1 text-sm text-muted-foreground">Nenhuma estimativa manual registrada.</p>
                  ) : (
                    <div className="mt-1 text-sm"><DadosRevisaoConsumo registro={consumoManual.vigente} /></div>
                  )}
                </div>
                <div>
                  <h4 className="text-sm font-semibold">Histórico de revisões</h4>
                  {consumoManual.historico.length === 0 ? (
                    <p className="mt-1 text-sm text-muted-foreground">Nenhuma revisão nesta página.</p>
                  ) : (
                    <ul className="mt-1 divide-y divide-border text-sm">
                      {consumoManual.historico.map((registro) => (
                        <li key={registro.revisao} className="py-2"><DadosRevisaoConsumo registro={registro} /></li>
                      ))}
                    </ul>
                  )}
                  {(antesDaRevisao !== null || consumoManual.proxima_antes_da_revisao !== null) && (
                    <nav aria-label="Páginas do histórico de estimativa" className="mt-1 flex flex-wrap gap-x-4 text-sm text-primary">
                      {antesDaRevisao !== null && <Link prefetch={false} className="inline-flex min-h-11 items-center underline" href={hrefConsumo(insumoSelecionado.insumoId)}>Revisões recentes</Link>}
                      {consumoManual.proxima_antes_da_revisao !== null && (
                        <Link prefetch={false} className="inline-flex min-h-11 items-center underline" href={hrefConsumo(insumoSelecionado.insumoId, consumoManual.proxima_antes_da_revisao)}>Revisões mais antigas</Link>
                      )}
                    </nav>
                  )}
                </div>
                {antesDaRevisao !== null ? (
                  <p className="text-sm text-muted-foreground">Páginas anteriores são somente para consulta.</p>
                ) : (
                  <>
                    {consumoManual.apresentacao?.estado === "disponivel" ? (
                      <p className="text-sm">Cada embalagem tem {decimalConsumo.format(consumoManual.apresentacao.conteudo).replace(".", ",")} {consumoManual.apresentacao.unidade}.</p>
                    ) : (
                      <p className="text-sm text-warning-strong">Para registrar a estimativa, preencha no cadastro do insumo quanto vem em cada embalagem.</p>
                    )}
                    {consumoManual.podeRegistrar && consumoManual.apresentacao?.estado === "disponivel" ? (
                      <RegistrarConsumoManualForm
                        key={insumoSelecionado.insumoId}
                        preimagem={{
                          insumoId: insumoSelecionado.insumoId,
                          operacaoId: randomUUID(),
                          revisaoEsperada: consumoManual.vigente?.revisao ?? 0,
                          conteudo: decimalConsumo.format(consumoManual.apresentacao.conteudo),
                          unidade: consumoManual.apresentacao.unidade,
                        }}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">Sua função não permite registrar estimativa. O histórico continua visível.</p>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {/* Lotes (rastreabilidade + estados) */}
        {visao === "lotes" && (
        <>
        <div className="mt-4 flex items-center gap-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Lotes em estoque</h2>
          <HelpTip title="Estados do lote">
            <HelpLegend
              items={[
                { tom: "info", rotulo: "Disponível", texto: "pode ser reservado e retirado" },
                { tom: "info", rotulo: "Em uso", texto: "embalagem aberta; vale a validade após abertura" },
                { tom: "critico", rotulo: "Bloqueado", texto: "retido (recall, não conformidade); não sai para uso" },
              ]}
            />
            <p>
              Clique no número do lote para ver a etiqueta e o <b>histórico</b> de movimentações.
            </p>
          </HelpTip>
        </div>
        <div className="mt-3">
          <LotesTable
            rows={loteRows}
            podeAceitar={podeAceitar}
            podeGerir={podeGerir}
            podeCorrigir={podeCorrigir}
            podeBaixar={podeBaixar}
            responsavelPadrao={usuario?.nome || usuario?.email || ""}
          />
        </div>
        </>
        )}
      </main>
    </div>
  );
}
