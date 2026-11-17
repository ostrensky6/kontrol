import Link from "next/link";
import { emitirOrcamentoFinalDaDemanda, salvarParametrosEconomicosDaDemanda } from "@/lib/actions/demandas";
import { rotuloStatusVersaoFinal } from "@/lib/orcamento/rotulos-status";
import { HelpTip } from "@/components/common/HelpTip";
import { DocumentoProposta } from "@/components/orcamento/documento/DocumentoProposta";
import { PainelInterno } from "@/components/orcamento/interno/PainelInterno";
import { salvarTextosDemanda } from "@/lib/actions/orcamento-textos";
import { mascararPessoalVisao, montarFundos, type VisaoInterna } from "@/lib/orcamento/visao-interna";
import { ConfirmSubmitButton } from "@/components/common/ConfirmSubmitButton";
import { formatCurrency as brl, formatDate } from "@/lib/formatters";
import {
  LABEL_STATUS_FINAL,
  type StatusPropostaFinal,
  type ComposicaoReconciliada,
  type ItemCustoZero,
} from "@/lib/orcamento/proposta-final";
import {
  STATUS_FINAL_CLS,
  type DemandaDetalhe,
  type VersaoFinalResumo,
} from "@/lib/orcamento/demanda-detalhe";
import { TOM_ENTRADA } from "@/lib/orcamento/tom-valor";
import type { ModeloDocumentoProposta } from "@/lib/orcamento/documento-proposta";
import type { TextosProposta } from "@/lib/orcamento/textos-proposta";
import type { avaliarCompletudeDemanda } from "@/lib/orcamento/demanda-completude";
import type { consolidarOrcamentoFinal } from "@/lib/orcamento/orcamento-final";
import type { resolverParametrosProposta } from "@/lib/orcamento/parametros-proposta";

const inp = `rounded-md border border-input bg-card px-3 py-2 text-sm font-medium ${TOM_ENTRADA}`;
const hydrationSafe = { suppressHydrationWarning: true } as const;

type Props = {
  /** "hidden" quando a etapa não é a que está aberta */
  classePasso: string;
  statusFinal: StatusPropostaFinal;
  orcamentoFinal: ReturnType<typeof consolidarOrcamentoFinal>;
  versaoEmitidaVigente: VersaoFinalResumo | undefined;
  autorizadoEmitir: boolean;
  demandaId: number;
  operacaoEmissaoId: string;
  podeEmitir: boolean;
  semParametros: boolean;
  demanda: DemandaDetalhe;
  versaoReformulada: VersaoFinalResumo | null;
  temCustoZeroSemJustificativa: boolean;
  completudeDemanda: ReturnType<typeof avaliarCompletudeDemanda>;
  erroEmissao: string | undefined;
  composicaoFinal: ComposicaoReconciliada;
  hrefDados: string;
  custosZero: ItemCustoZero[];
  abaProposta: "documento" | "interno";
  erroParametros: string | undefined;
  parametrosSalvos: string | undefined;
  podeVerPessoal: boolean;
  visaoViva: VisaoInterna;
  subParam: string | undefined;
  autorizadoParametros: boolean;
  parametrosProposta: ReturnType<typeof resolverParametrosProposta>;
  documentoPrevia: ModeloDocumentoProposta;
  autorizadoTextos: boolean;
  textosVivos: TextosProposta;
  versoesFinais: VersaoFinalResumo[] | null;
};

/** Etapa da proposta final: ações, pendências, prévia e versões. */
export function DemandaPropostaFinal({
  classePasso,
  statusFinal,
  orcamentoFinal,
  versaoEmitidaVigente,
  autorizadoEmitir,
  demandaId,
  operacaoEmissaoId,
  podeEmitir,
  semParametros,
  demanda,
  versaoReformulada,
  temCustoZeroSemJustificativa,
  completudeDemanda,
  erroEmissao,
  composicaoFinal,
  hrefDados,
  custosZero,
  abaProposta,
  erroParametros,
  parametrosSalvos,
  podeVerPessoal,
  visaoViva,
  subParam,
  autorizadoParametros,
  parametrosProposta,
  documentoPrevia,
  autorizadoTextos,
  textosVivos,
  versoesFinais,
}: Props) {
  return (
    <section id="final" className={`mt-3 scroll-mt-20 space-y-4 ${classePasso}`}>
      {/* A — Cabeçalho da proposta + ações */}
      <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
        {/* Total e emissão numa faixa só; título e cliente já estão no cabeçalho. */}
        <div className="flex flex-wrap items-end justify-between gap-4 rounded-md border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-900 dark:bg-brand-950/30">
          <div>
            <p className="flex items-center gap-2 text-xs font-medium text-brand-700 dark:text-brand-300">
              Total da proposta
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal ${STATUS_FINAL_CLS[statusFinal]}`}>
                {LABEL_STATUS_FINAL[statusFinal]}
              </span>
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-brand-800 dark:text-brand-200">{brl(orcamentoFinal.totalFinal)}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {versaoEmitidaVigente && (
              <Link
                href={`/orcamento/final/${versaoEmitidaVigente.id}`}
                className="rounded-md border border-input bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
              >
                Abrir versão emitida ({versaoEmitidaVigente.numero})
              </Link>
            )}
            {!autorizadoEmitir ? (
              <p className="text-xs text-muted-foreground">
                A emissão é feita por coordenador ou superior, ou por quem tem a permissão “Orçamentos: Emitir proposta”.
              </p>
            ) : (
            <form action={emitirOrcamentoFinalDaDemanda} className="flex flex-wrap items-end gap-2">
              <input {...hydrationSafe} type="hidden" name="demanda_id" value={demandaId} />
              <input {...hydrationSafe} type="hidden" name="operacao_id" value={operacaoEmissaoId} />
              {podeEmitir && semParametros && (
                // Sem parâmetros o total = custo técnico; exige confirmação explícita (validada também no servidor).
                <label className="flex w-full items-center gap-2 rounded-md border border-warning-strong/30 bg-warning-soft px-3 py-2 text-xs font-medium text-warning-strong">
                  <input {...hydrationSafe} type="checkbox" name="confirmar_sem_parametros" value="sim" required className="h-4 w-4" />
                  Sem impostos, taxas nem lucro: emitir pelo custo técnico.
                </label>
              )}
              <div>
                <label htmlFor="emitirOrcamentoFinalDaDemanda-validade_dias" className="block text-xs text-muted-foreground">Validade (dias)</label>
                <input id="emitirOrcamentoFinalDaDemanda-validade_dias" {...hydrationSafe} name="validade_dias" type="number" min="1" step="1" defaultValue="30" className={`${inp} mt-1 w-24`} disabled={!podeEmitir} />
              </div>
              <ConfirmSubmitButton
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground dark:disabled:bg-muted"
                disabled={!podeEmitir}
                titulo="Emitir versão final?"
                mensagem={`Proposta nº ${demanda.id}, total ${brl(orcamentoFinal.totalFinal)}. A versão emitida recebe um número e não pode ser alterada depois.`}
                confirmLabel="Emitir"
              >
                Emitir versão final
              </ConfirmSubmitButton>
            </form>
            )}
          </div>
        </div>
        {versaoReformulada && (
          <p role="note" className="mt-2 rounded-md bg-warning-soft px-3 py-1.5 text-xs text-warning-strong">
            Reformulação da proposta {versaoReformulada.numero}: a versão emitida agora, quando aprovada, substitui a{" "}
            {versaoReformulada.numero}, que fica no histórico.
          </p>
        )}
        {!podeEmitir && (
          <p className="mt-2 text-right text-xs text-warning-strong">
            Emissão bloqueada:{" "}
            {(() => {
              const n = orcamentoFinal.pendencias.length + (temCustoZeroSemJustificativa ? 1 : 0) + (completudeDemanda.completa ? 0 : 1);
              return `${n} ${n === 1 ? "pendência" : "pendências"}`;
            })()}{" "}
            — <a href="#bloqueios-emissao" className="font-medium underline">ver</a>
          </p>
        )}
        {erroEmissao && (
          <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger-strong">{erroEmissao}</p>
        )}
      </div>
    
      {/* F — Pendências e bloqueios */}
      {(orcamentoFinal.pendencias.length > 0 || temCustoZeroSemJustificativa || !composicaoFinal.reconciliaOk || !completudeDemanda.completa) && (
        <div id="bloqueios-emissao" className="scroll-mt-24 rounded-lg border border-warning-strong/30 bg-warning-soft p-4">
          <h3 className="text-sm font-semibold text-warning-strong">Pendências e bloqueios</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-warning-strong">
            {!completudeDemanda.completa && (
              <li>
                Dados do orçamento: {completudeDemanda.pendencias.join("; ")} —{" "}
                <a href={hrefDados} className="font-medium underline">completar</a>
              </li>
            )}
            {orcamentoFinal.pendencias.map((p) => (
              <li key={p}>{p}</li>
            ))}
            {temCustoZeroSemJustificativa && (
              <li>
                Itens com custo técnico zero (sem justificativa de isenção):{" "}
                {custosZero.map((c) => c.descricao).join(", ")}. Emissão bloqueada.
              </li>
            )}
            {!composicaoFinal.reconciliaOk && (
              <li>Divergência de reconciliação entre composição e total final — revisar itens.</li>
            )}
          </ul>
        </div>
      )}
    
      {/* D — Mesmas abas da proposta emitida, com os valores atuais (28/09) */}
      <div className="space-y-3">
        <nav aria-label="Prévia da proposta" className="flex gap-1 border-b border-border">
          {[
            { id: "interno", rotulo: "Interno", href: `/orcamento/demandas/${demandaId}?etapa=final` },
            { id: "documento", rotulo: "Documento do cliente (prévia)", href: `/orcamento/demandas/${demandaId}?etapa=final&aba=documento` },
          ].map((t) => (
            <Link
              key={t.id}
              href={t.href}
              aria-current={abaProposta === t.id ? "page" : undefined}
              className={`border-b-2 px-4 py-2 text-sm ${
                abaProposta === t.id
                  ? "border-brand-600 font-semibold text-brand-800 dark:border-brand-400 dark:text-brand-200"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.rotulo}
            </Link>
          ))}
        </nav>
        {abaProposta === "interno" ? (
          <>
            {erroParametros && (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">{erroParametros}</p>
            )}
            {parametrosSalvos === "1" && !erroParametros && (
              <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success-strong">Percentuais salvos.</p>
            )}
            <PainelInterno
              visao={podeVerPessoal ? visaoViva : mascararPessoalVisao(visaoViva)}
              fundos={{ ...montarFundos(visaoViva, null), hrefFundos: "/orcamento/fundos" }}
              subInicial={subParam}
              motivoSemPercentuais={autorizadoParametros ? null : "Alterar os percentuais exige o perfil de gestor do orçamento."}
              percentuais={
                autorizadoParametros
                  ? {
                      valores: parametrosProposta.rates,
                      custoLaboratorio: orcamentoFinal.totalLaboratorioCusto,
                      custoProjeto: orcamentoFinal.totalProjetoCusto,
                      action: salvarParametrosEconomicosDaDemanda,
                      campos: { demanda_id: demandaId, retorno: "final" },
                      rotuloSalvar: "Salvar percentuais",
                      aviso: "Os percentuais valem para este orçamento e entram na próxima emissão.",
                    }
                  : null
              }
            />
          </>
        ) : (
          <>
            {documentoPrevia.avisos.length > 0 && (
              <ul className="space-y-1 text-xs text-warning-strong">
                {documentoPrevia.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
            <DocumentoProposta
              modelo={documentoPrevia}
              edicao={
                autorizadoTextos
                  ? {
                      action: salvarTextosDemanda,
                      campos: { demanda_id: demandaId },
                      textos: textosVivos,
                      aviso: "Salvo neste orçamento. Entra no documento na próxima emissão.",
                    }
                  : null
              }
            />
          </>
        )}
      </div>
    
      {/* G — Histórico resumido */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold">Histórico de versões</h3>
            <HelpTip title="Versões emitidas">
              <p>Cada versão guarda os <b>valores do dia da emissão</b>. Mudanças posteriores em custos ou parâmetros não alteram versões já emitidas.</p>
            </HelpTip>
          </div>
          <span className="text-xs text-muted-foreground/80">{versoesFinais?.length ?? 0} versão(ões)</span>
        </div>
        <div className="mt-3 divide-y divide-border/70 text-sm">
          {(versoesFinais ?? []).map((versao) => (
            <div key={versao.id} className="grid items-center gap-2 px-1 py-2 md:grid-cols-5">
              <Link href={`/orcamento/final/${versao.id}`} className="font-medium text-primary hover:underline">
                {versao.numero}
              </Link>
              <span>v{versao.versao}</span>
              <span>{rotuloStatusVersaoFinal(versao.status)}</span>
              <span>{versao.valido_ate ? `válida até ${formatDate(versao.valido_ate)}` : "sem validade"}</span>
              <span className="font-semibold tabular-nums md:text-right">{brl(Number(versao.total_final ?? 0))}</span>
            </div>
          ))}
          {(versoesFinais ?? []).length === 0 && (
            <p className="px-1 py-4 text-xs text-muted-foreground/80">Nenhuma versão final emitida.</p>
          )}
        </div>
      </div>
    </section>
  );
}
