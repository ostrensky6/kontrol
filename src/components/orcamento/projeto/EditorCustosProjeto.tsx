import type { ReactNode } from "react";
import { Lock, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { podeOrcamento } from "@/lib/orcamento/governanca";
import {
  adicionarAnaliseProjeto,
  adicionarCustoCatalogoProjeto,
  adicionarCustoProjeto,
  atualizarCustoProjeto,
  concluirRevisaoCustosProjeto,
  reabrirCustosProjeto,
  removerAnaliseProjeto,
  removerCustoProjeto,
  salvarDuracaoProjeto,
  salvarMesesPessoalProjeto,
  salvarViagensProjeto,
} from "@/lib/actions/orcamento-projetos";
import {
  estadoEdicaoProjeto,
  ORDEM_RUBRICAS,
  resumirRubricas,
  situacaoQuantidadeViagem,
  subtotalCusto,
} from "@/lib/project-budget/editor";
import { ratesDoOrcamentoProjeto } from "@/lib/orcamento/parametros-proposta";
import { calcularOrcamentoProjeto, roundMoney, RUBRICAS_PROJETO } from "@/lib/project-budget/orcamento-projeto";
import { normalizarViagemInputs, type ViagemInputs } from "@/lib/project-budget/travel";
import type { ProjetoExportItem } from "@/lib/project-budget/exporters";
import { formatCurrency as brl } from "@/lib/formatters";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ConfirmActionButton } from "@/components/common/ConfirmActionButton";
import { ConfirmSubmitButton } from "@/components/common/ConfirmSubmitButton";
import { HelpTip } from "@/components/common/HelpTip";
import { ExportProjetoButtons } from "@/components/orcamento/ExportProjetoButtons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdicionarDoCatalogo, type ItemCatalogo } from "./AdicionarDoCatalogo";
import { EditarCustoDialog } from "./EditarCustoDialog";
import { FormAcao } from "./FormAcao";
import { GradeMesesPessoal } from "./GradeMesesPessoal";

type Custo = {
  id: number;
  categoria: string;
  rubrica: string | null;
  descricao: string;
  etapa: string | null;
  atividade: string | null;
  entrega: string | null;
  quantidade: number;
  unidade: string | null;
  custo_unitario: number;
  meses_selecionados: number[] | null;
  catalogo_item_id: string | null;
  origem: string | null;
};

type AnaliseProjeto = {
  id: number;
  codigo_analise: string;
  n_amostras: number;
  custo_unitario: number;
};

type CatalogoLinha = ItemCatalogo & { rubrica: string };

const ORIGEM: Record<string, string> = {
  manual: "Manual",
  catalogo: "Catálogo",
  template: "Modelo",
  orcamento_projetos_antigo: "App antigo",
};

const CAMPOS_VIAGEM: Array<{ chave: keyof ViagemInputs; rotulo: string; passo: string }> = [
  { chave: "pessoas", rotulo: "Pessoas", passo: "1" },
  { chave: "dias_campo", rotulo: "Dias de campo", passo: "1" },
  { chave: "fator_risco_dias", rotulo: "Dias extras (risco)", passo: "1" },
  { chave: "diarias_hospedagem", rotulo: "Diárias de hotel", passo: "1" },
  { chave: "quartos", rotulo: "Quartos", passo: "1" },
  { chave: "veiculos", rotulo: "Veículos", passo: "1" },
  { chave: "distancia_km", rotulo: "Distância total (km)", passo: "0.1" },
  { chave: "consumo_km_l", rotulo: "Consumo (km/L)", passo: "0.1" },
  { chave: "pedagios", rotulo: "Pedágios", passo: "1" },
  { chave: "passagens_aereas", rotulo: "Passagens aéreas", passo: "1" },
];

const inp = "mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-medium text-brand-700 dark:text-brand-300";
const lbl = "block text-xs font-medium text-muted-foreground";
const botaoPrimario = "rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Editor da etapa "Custos do projeto" da proposta (Etapa A da migração do app antigo):
 * rubricas PE/MC/MP/ST/VD/OU, grade de meses do pessoal, viagens com cálculo automático,
 * análises dentro do projeto, exportação e conclusão da revisão (RPC transicionar_orcamento_projeto).
 */
export async function EditorCustosProjeto({
  orcamentoProjetoId,
  demandaId,
}: {
  orcamentoProjetoId: number;
  demandaId: number;
}) {
  const supabase = await createClient();
  const [{ data: orc }, { data: custosData }, { data: analisesData }, { data: catalogoData }, { data: analisesDisponiveis }, podeRevisar] =
    await Promise.all([
      supabase.from("orcamento_projetos").select("*").eq("id", orcamentoProjetoId).single(),
      supabase
        .from("orcamento_projeto_custos")
        .select("id, categoria, rubrica, descricao, etapa, atividade, entrega, quantidade, unidade, custo_unitario, meses_selecionados, catalogo_item_id, origem")
        .eq("orcamento_projeto_id", orcamentoProjetoId)
        .order("rubrica")
        .order("id"),
      supabase
        .from("orcamento_projeto_analises")
        .select("id, codigo_analise, n_amostras, custo_unitario")
        .eq("orcamento_projeto_id", orcamentoProjetoId)
        .order("id"),
      // Leitura pela RPC da 0112: preço de pessoal (PE) vem mascarado sem a
      // permissão "Ver salário dos técnicos"; o SELECT direto do preço é negado.
      supabase.rpc("orcamento_projeto_catalogo_listar"),
      supabase.from("analises").select("codigo, nome").eq("ativo", true).eq("ofertavel", true).order("codigo"),
      podeOrcamento("revisar_modulo"),
    ]);

  if (!orc) {
    return <p className="mt-4 text-sm text-muted-foreground">Orçamento de projeto não encontrado.</p>;
  }

  const custos = ((custosData ?? []) as Custo[]).map((item) => ({
    ...item,
    rubrica: item.rubrica ?? "OU",
    quantidade: Number(item.quantidade),
    custo_unitario: Number(item.custo_unitario),
    meses_selecionados: item.meses_selecionados ?? [],
  }));
  const analises = ((analisesData ?? []) as AnaliseProjeto[]).map((item) => ({
    ...item,
    n_amostras: Number(item.n_amostras),
    custo_unitario: Number(item.custo_unitario),
  }));
  const catalogo = ((catalogoData ?? []) as Array<CatalogoLinha & { ativo?: boolean | null }>)
    .filter((item) => item.ativo !== false)
    .map((item) => ({
      ...item,
      preco_unitario: Number(item.preco_unitario ?? 0),
      preco_mascarado: item.preco_mascarado === true,
    }));
  const estado = estadoEdicaoProjeto(orc.status);
  const editavel = estado.editavel;
  const mesesProjeto = Math.max(1, Number(orc.project_months ?? 12));
  const viagem = normalizarViagemInputs((orc.travel_inputs ?? null) as Partial<ViagemInputs> | null);

  const rubricas = resumirRubricas(custos);
  const totalCustos = roundMoney(rubricas.reduce((soma, r) => soma + r.total, 0));
  const totalAnalises = roundMoney(analises.reduce((soma, a) => soma + a.custo_unitario * a.n_amostras, 0));
  const totalProjeto = roundMoney(totalCustos + totalAnalises);
  const quantidadeItens = custos.length + analises.length;

  // Exportação: mesma base mostrada na tela (custo técnico; análises entram pelo custo).
  const exportItens: ProjetoExportItem[] = [
    ...custos.map((item) => ({
      rubrica: item.rubrica,
      categoria: item.atividade ?? item.categoria,
      descricao: item.descricao,
      unidade: item.unidade,
      quantidade: item.quantidade,
      preco_unitario: item.custo_unitario,
      meses_selecionados: item.meses_selecionados,
      total: subtotalCusto(item),
    })),
    ...analises.map((item) => ({
      rubrica: "MC",
      categoria: "Análises laboratoriais",
      descricao: item.codigo_analise,
      unidade: "amostra",
      quantidade: item.n_amostras,
      preco_unitario: item.custo_unitario,
      meses_selecionados: [],
      total: roundMoney(item.custo_unitario * item.n_amostras),
    })),
  ];
  const calculoExport = calcularOrcamentoProjeto(
    exportItens.map((item) => ({
      rubrica: item.rubrica,
      quantidade: item.quantidade,
      preco_unitario: item.preco_unitario,
      meses_selecionados: item.meses_selecionados ?? [],
    })),
    ratesDoOrcamentoProjeto(orc),
  );
  const exportInfo = {
    numero: orc.numero ?? null,
    titulo: orc.titulo ?? "",
    cliente_nome: orc.cliente_nome ?? null,
    cliente_cnpj: orc.cliente_cnpj ?? null,
    cliente_contato: orc.cliente_contato ?? null,
    coordenador: orc.coordenador ?? null,
    proprietario: orc.proprietario ?? null,
    responsavel: orc.responsavel ?? null,
    data_orcamento: orc.data_orcamento ?? null,
    status: orc.status ?? null,
    project_months: mesesProjeto,
    escopo: orc.escopo ?? null,
    cronograma: orc.cronograma ?? null,
    observacoes: orc.observacoes ?? null,
  };

  const campos = (
    <>
      <input type="hidden" name="orcamento_projeto_id" value={orcamentoProjetoId} />
      <input type="hidden" name="demanda_id" value={demandaId} />
    </>
  );

  function acoesItem(item: (typeof custos)[number]): ReactNode {
    if (!editavel) return null;
    return (
      <span className="inline-flex items-center gap-1">
        <EditarCustoDialog
          item={item}
          orcamentoProjetoId={orcamentoProjetoId}
          demandaId={demandaId}
          action={atualizarCustoProjeto}
        />
        <ConfirmActionButton
          action={removerCustoProjeto}
          fields={{ orcamento_projeto_id: orcamentoProjetoId, demanda_id: demandaId, item_id: item.id }}
          titulo="Remover item?"
          mensagem={`"${item.descricao}" sai dos custos do projeto (${brl(subtotalCusto(item))}).`}
          confirmLabel="Remover"
          triggerClassName="rounded-md p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger-strong"
          trigger={
            <>
              <Trash2 className="size-4" aria-hidden />
              <span className="sr-only">Remover {item.descricao}</span>
            </>
          }
        />
      </span>
    );
  }

  function formManual(rubrica: string) {
    const pessoal = rubrica === "PE";
    const prefixo = `novo-${rubrica}`;
    return (
      <FormAcao
        action={adicionarCustoProjeto}
        sucesso="Item adicionado."
        aria-label={`Adicionar item manual em ${rubrica}`}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_7rem_7rem_9rem_auto] lg:items-end"
      >
        {campos}
        <input type="hidden" name="rubrica" value={rubrica} />
        <div>
          <label htmlFor={`${prefixo}-descricao`} className={lbl}>{pessoal ? "Profissional / função" : "Descrição"}</label>
          <input id={`${prefixo}-descricao`} name="descricao" required className={inp} />
        </div>
        <div>
          <label htmlFor={`${prefixo}-unidade`} className={lbl}>Unidade</label>
          <input id={`${prefixo}-unidade`} name="unidade" defaultValue={pessoal ? "mês" : ""} className={inp} />
        </div>
        {pessoal ? (
          <input type="hidden" name="quantidade" value="1" />
        ) : (
          <div>
            <label htmlFor={`${prefixo}-quantidade`} className={lbl}>Quantidade</label>
            <input id={`${prefixo}-quantidade`} name="quantidade" type="number" min="0.01" step="0.01" defaultValue="1" required className={inp} />
          </div>
        )}
        <div>
          <label htmlFor={`${prefixo}-custo`} className={lbl}>{pessoal ? "Valor mensal (R$)" : "Custo unitário (R$)"}</label>
          <input id={`${prefixo}-custo`} name="custo_unitario" type="number" min="0" step="0.01" required className={inp} />
        </div>
        <button type="submit" className={botaoPrimario}>Adicionar item</button>
        <details className="sm:col-span-2 lg:col-span-5">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Etapa, atividade e entrega (opcional)</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {(["etapa", "atividade", "entrega"] as const).map((campo) => (
              <div key={campo}>
                <label htmlFor={`${prefixo}-${campo}`} className={lbl}>
                  {campo === "etapa" ? "Etapa" : campo === "atividade" ? "Atividade" : "Entrega"}
                </label>
                <input id={`${prefixo}-${campo}`} name={campo} className={inp} />
              </div>
            ))}
          </div>
        </details>
      </FormAcao>
    );
  }

  function blocoAdicionar(rubrica: string) {
    if (!editavel) return null;
    return (
      <div className="mt-4 space-y-4 rounded-md border border-dashed border-border p-3">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Do catálogo</h4>
          <div className="mt-2">
            <AdicionarDoCatalogo
              rubrica={rubrica}
              itens={catalogo.filter((item) => item.rubrica === rubrica)}
              orcamentoProjetoId={orcamentoProjetoId}
              demandaId={demandaId}
              action={adicionarCustoCatalogoProjeto}
            />
          </div>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Item manual</h4>
          <div className="mt-2">{formManual(rubrica)}</div>
        </div>
      </div>
    );
  }

  function tabelaItens(rubrica: string) {
    const itens = custos.filter((item) => item.rubrica === rubrica);
    const viagens = rubrica === "VD";
    return (
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Itens de {RUBRICAS_PROJETO[rubrica as keyof typeof RUBRICAS_PROJETO]}</caption>
          <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2">Descrição</th>
              <th scope="col" className="px-3 py-2">Unidade</th>
              <th scope="col" className="px-3 py-2 text-right">Qtd.</th>
              <th scope="col" className="px-3 py-2 text-right">Custo unit.</th>
              <th scope="col" className="px-3 py-2 text-right">Subtotal</th>
              <th scope="col" className="px-3 py-2">Origem</th>
              {editavel && (
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Ações</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {itens.length === 0 && (
              <tr>
                <td colSpan={editavel ? 7 : 6} className="px-3 py-4 text-xs text-muted-foreground">
                  Nenhum item nesta rubrica.
                </td>
              </tr>
            )}
            {itens.map((item) => {
              const detalhe = [item.etapa, item.atividade, item.entrega].filter(Boolean).join(" · ");
              const situacao = viagens ? situacaoQuantidadeViagem(item, viagem) : null;
              return (
                <tr key={item.id} className="align-top">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {item.descricao}
                    {detalhe && <span className="block text-xs font-normal text-muted-foreground">{detalhe}</span>}
                  </th>
                  <td className="px-3 py-2">{item.unidade || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {item.quantidade.toLocaleString("pt-BR")}
                    {situacao && situacao.situacao !== "manual" && (
                      <span
                        className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          situacao.situacao === "calculado" ? "bg-success-soft text-success-strong" : "bg-warning-soft text-warning-strong"
                        }`}
                        title={situacao.situacao === "ajustado" ? `Pelas entradas de viagem seriam ${situacao.calculada}` : undefined}
                      >
                        {situacao.situacao === "calculado" ? "Calculado" : `Ajustado · calc.: ${Number(situacao.calculada).toLocaleString("pt-BR")}`}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{brl(item.custo_unitario)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{brl(subtotalCusto(item))}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{ORIGEM[item.origem ?? "manual"] ?? item.origem}</td>
                  {editavel && <td className="px-3 py-2 text-right whitespace-nowrap">{acoesItem(item)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const linhasPessoal = custos.filter((item) => item.rubrica === "PE");

  return (
    <div className="mt-4 space-y-5" data-testid="editor-custos-projeto">
      {/* Cabeçalho: duração, status e totais */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-md border border-border bg-muted/30 p-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{orc.titulo}</p>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={orc.status === "enviado" ? "revisado" : orc.status === "rascunho" ? "em_elaboracao" : orc.status} label={estado.rotulo} />
            <span className="text-xs text-muted-foreground">
              Duração: {mesesProjeto} {mesesProjeto === 1 ? "mês" : "meses"}
            </span>
          </div>
        </div>
        {editavel && (
          <FormAcao action={salvarDuracaoProjeto} sucesso="Duração do projeto atualizada." className="flex items-end gap-2" aria-label="Duração do projeto">
            {campos}
            <div>
              <label htmlFor="projeto-duracao" className={lbl}>Duração (meses)</label>
              <input id="projeto-duracao" name="project_months" type="number" min="1" max="60" step="1" required defaultValue={mesesProjeto} className={`${inp} w-24`} />
            </div>
            <button type="submit" className="rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-muted">Alterar</button>
          </FormAcao>
        )}
        <div className="text-right">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Custo do projeto</p>
          <p className="text-2xl font-semibold tabular-nums" data-testid="total-custo-projeto">{brl(totalProjeto)}</p>
          <p className="text-[11px] text-muted-foreground">{quantidadeItens} {quantidadeItens === 1 ? "item" : "itens"} · custo técnico, antes dos parâmetros</p>
        </div>
      </div>

      {!editavel && estado.motivo && (
        <p role="note" className="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold text-foreground">Edição bloqueada.</strong> {estado.motivo}
          </span>
        </p>
      )}

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Totais por rubrica">
        {rubricas.map((r) => (
          <li key={r.codigo} className="rounded-md border border-border p-3">
            <p className="text-xs font-semibold">
              {r.codigo} · {r.nome}
            </p>
            <p className="mt-1 font-medium tabular-nums" data-testid={`total-rubrica-${r.codigo}`}>{brl(r.total)}</p>
            <p className="text-[11px] text-muted-foreground">{r.itens} {r.itens === 1 ? "item" : "itens"}</p>
          </li>
        ))}
      </ul>

      <Tabs defaultValue="PE">
        <TabsList className="h-auto flex-wrap" aria-label="Rubricas do projeto">
          {rubricas.map((r) => (
            <TabsTrigger key={r.codigo} value={r.codigo}>
              {r.codigo} · {r.nome} ({r.itens})
            </TabsTrigger>
          ))}
        </TabsList>
        {ORDEM_RUBRICAS.map((rubrica) => (
          <TabsContent key={rubrica} value={rubrica} className="mt-3 space-y-3" aria-label={RUBRICAS_PROJETO[rubrica]}>
            {rubrica === "PE" ? (
              <GradeMesesPessoal
                linhas={linhasPessoal.map((item) => ({
                  id: item.id,
                  descricao: item.descricao,
                  quantidade: item.quantidade,
                  custo_unitario: item.custo_unitario,
                  meses_selecionados: item.meses_selecionados,
                }))}
                mesesProjeto={mesesProjeto}
                orcamentoProjetoId={orcamentoProjetoId}
                demandaId={demandaId}
                editavel={editavel}
                action={salvarMesesPessoalProjeto}
                acoesLinha={editavel ? Object.fromEntries(linhasPessoal.map((item) => [item.id, acoesItem(item)])) : undefined}
              />
            ) : (
              <>
                {rubrica === "VD" && (
                  <div className="rounded-md border border-border p-3">
                    <h4 className="text-sm font-semibold">Entradas de viagem</h4>
                    <p className="mt-1 rounded-md bg-warning-soft px-2 py-1 text-xs text-warning-strong">
                      Salvar recalcula as quantidades (alimentação, hospedagem, combustível, pedágio, passagem, aluguel de veículo e seguro) e substitui ajustes manuais. Dias extras somam aos dias de campo e às diárias.
                    </p>
                    <FormAcao action={salvarViagensProjeto} sucesso="Entradas de viagem salvas e quantidades recalculadas." aria-label="Entradas de viagem" className="mt-3">
                      {campos}
                      <fieldset disabled={!editavel} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                        <legend className="sr-only">Entradas de viagem</legend>
                        {CAMPOS_VIAGEM.map((campo) => (
                          <div key={campo.chave}>
                            <label htmlFor={`viagem-${campo.chave}`} className={lbl}>{campo.rotulo}</label>
                            <input
                              id={`viagem-${campo.chave}`}
                              name={campo.chave}
                              type="number"
                              min="0"
                              step={campo.passo}
                              defaultValue={viagem[campo.chave]}
                              className={inp}
                            />
                          </div>
                        ))}
                      </fieldset>
                      {editavel && (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                          <label className="inline-flex items-center gap-2 text-xs">
                            <input type="checkbox" name="criar_linhas_padrao" value="1" defaultChecked className="size-4 accent-brand-600" />
                            Criar as linhas de viagem do catálogo que faltarem
                          </label>
                          <button type="submit" className={botaoPrimario}>Salvar e recalcular</button>
                        </div>
                      )}
                    </FormAcao>
                  </div>
                )}
                {tabelaItens(rubrica)}
              </>
            )}
            {blocoAdicionar(rubrica)}
          </TabsContent>
        ))}
      </Tabs>

      {/* Análises laboratoriais dentro do projeto */}
      <div className="rounded-md border border-border p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-1">
            <h4 className="text-sm font-semibold">Análises dentro do projeto</h4>
            <HelpTip title="Análises dentro do projeto">
              <p>Entram pelo <b>custo técnico</b> do Custeio, sem o preço de tabela, para que impostos, taxas e lucro incidam <b>uma única vez</b>, nos parâmetros da proposta.</p>
            </HelpTip>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{brl(totalAnalises)}</span>
        </div>
        <div className="mt-3 overflow-x-auto rounded-md border border-border">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Análises dentro do projeto</caption>
            <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">Análise</th>
                <th scope="col" className="px-3 py-2 text-right">Amostras</th>
                <th scope="col" className="px-3 py-2 text-right">Custo unit.</th>
                <th scope="col" className="px-3 py-2 text-right">Subtotal</th>
                {editavel && (
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Ações</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {analises.length === 0 && (
                <tr>
                  <td colSpan={editavel ? 5 : 4} className="px-3 py-4 text-xs text-muted-foreground">Nenhuma análise no projeto.</td>
                </tr>
              )}
              {analises.map((item) => (
                <tr key={item.id}>
                  <th scope="row" className="px-3 py-2 text-left font-medium">{item.codigo_analise}</th>
                  <td className="px-3 py-2 text-right tabular-nums">{item.n_amostras.toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{brl(item.custo_unitario)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{brl(item.custo_unitario * item.n_amostras)}</td>
                  {editavel && (
                    <td className="px-3 py-2 text-right">
                      <ConfirmActionButton
                        action={removerAnaliseProjeto}
                        fields={{ orcamento_projeto_id: orcamentoProjetoId, demanda_id: demandaId, item_id: item.id }}
                        titulo="Remover análise?"
                        mensagem={`${item.codigo_analise} (${item.n_amostras} amostras) sai dos custos do projeto.`}
                        confirmLabel="Remover"
                        triggerClassName="rounded-md p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger-strong"
                        trigger={
                          <>
                            <Trash2 className="size-4" aria-hidden />
                            <span className="sr-only">Remover {item.codigo_analise}</span>
                          </>
                        }
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editavel && (
          <FormAcao action={adicionarAnaliseProjeto} sucesso="Análise adicionada." aria-label="Adicionar análise ao projeto" className="mt-3 flex flex-wrap items-end gap-3">
            {campos}
            <div className="min-w-56 flex-1">
              <label htmlFor="projeto-analise-codigo" className={lbl}>Análise</label>
              <select id="projeto-analise-codigo" name="codigo_analise" required defaultValue="" className={inp}>
                <option value="" disabled>Selecione…</option>
                {((analisesDisponiveis ?? []) as Array<{ codigo: string; nome: string | null }>).map((a) => (
                  <option key={a.codigo} value={a.codigo}>
                    {a.codigo}{a.nome ? ` · ${a.nome}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="projeto-analise-amostras" className={lbl}>Amostras</label>
              <input id="projeto-analise-amostras" name="n_amostras" type="number" min="1" step="1" defaultValue="1" required className={`${inp} w-28`} />
            </div>
            <button type="submit" className={botaoPrimario}>Adicionar análise</button>
          </FormAcao>
        )}
      </div>

      {/* Exportação e conclusão da revisão */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-md border border-border p-3">
        <div>
          <h4 className="text-sm font-semibold">Exportar custos do projeto</h4>
          <p className="mt-1 text-xs text-muted-foreground">Itens, rubricas e demonstrativo com os parâmetros deste orçamento de projeto.</p>
          <div className="mt-2">
            <ExportProjetoButtons info={exportInfo} itens={exportItens} calculo={calculoExport} />
          </div>
        </div>
        <div className="max-w-md">
          <h4 className="text-sm font-semibold">Revisão dos custos</h4>
          {estado.podeConcluir && podeRevisar && (
            <FormAcao action={concluirRevisaoCustosProjeto} sucesso="Revisão dos custos concluída." className="mt-2 space-y-2">
              {campos}
              <p className="text-xs leading-5 text-muted-foreground">
                Concluir trava a edição destes custos e libera os parâmetros e a emissão da proposta.
              </p>
              <ConfirmSubmitButton
                className={botaoPrimario}
                disabled={quantidadeItens === 0}
                titulo="Concluir revisão dos custos?"
                mensagem={
                  <>
                    <p>
                      Custo do projeto: <strong>{brl(totalProjeto)}</strong> em {quantidadeItens} {quantidadeItens === 1 ? "item" : "itens"}.
                    </p>
                    <p className="mt-2">
                      Os custos ficam travados e passam a compor a proposta. Custos revisados não voltam para edição nesta versão do sistema.
                    </p>
                  </>
                }
                confirmLabel="Concluir revisão"
              >
                Concluir revisão dos custos
              </ConfirmSubmitButton>
              {quantidadeItens === 0 && <p className="text-xs text-warning-strong">Adicione ao menos um item antes de concluir.</p>}
            </FormAcao>
          )}
          {estado.podeConcluir && !podeRevisar && (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Preencha os custos; a conclusão da revisão é feita por coordenador, gestor ou administrador.
            </p>
          )}
          {estado.podeReabrir && podeRevisar && (
            <FormAcao action={reabrirCustosProjeto} sucesso="Custos reabertos para edição." className="mt-2">
              {campos}
              <ConfirmSubmitButton
                className="rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-muted"
                titulo="Reabrir para edição?"
                mensagem="Os custos voltam a ficar editáveis e a revisão precisará ser concluída de novo."
                confirmLabel="Reabrir"
              >
                Reabrir para edição
              </ConfirmSubmitButton>
            </FormAcao>
          )}
          {!estado.podeConcluir && !estado.podeReabrir && (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {orc.status === "enviado" ? "Revisão concluída." : estado.motivo}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
