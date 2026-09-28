import type { ReactNode } from "react";
import { Lock, RefreshCcw, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { podeOrcamento } from "@/lib/orcamento/governanca";
import { temPermissao } from "@/lib/auth/permissao-efetiva";
import {
  adicionarItemProjeto,
  aplicarModeloProjeto,
  atualizarCustoProjeto,
  concluirRevisaoCustosProjeto,
  reabrirCustosProjeto,
  removerAnaliseProjeto,
  removerCustoProjeto,
  salvarComoTemplate,
  salvarDuracaoProjeto,
  salvarMesesPessoalProjeto,
  salvarViagensProjeto,
} from "@/lib/actions/orcamento-projetos";
import {
  conferenciaRevisao,
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
import { MESES_VALOR_VELHO, valorDesatualizado } from "@/lib/orcamento/catalogo-custos";
import { NOTA_VALOR_MASCARADO, VALOR_MASCARADO } from "@/lib/cadastros/mascara";
import { CLASSE_BOTAO_ICONE_PERIGO, IconeAcao } from "@/components/common/IconeAcao";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ConfirmActionButton } from "@/components/common/ConfirmActionButton";
import { ConfirmSubmitButton } from "@/components/common/ConfirmSubmitButton";
import { HelpTip } from "@/components/common/HelpTip";
import { ExportProjetoButtons } from "@/components/orcamento/ExportProjetoButtons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdicionarItemProjeto, type ItemCatalogo } from "./AdicionarItemProjeto";
import { EditarCustoDialog } from "./EditarCustoDialog";
import { SalvarModeloDialog, UsarModeloDialog, type ModeloResumo } from "./ModelosProjetoDialogs";
import { ReabrirRevisaoDialog } from "./ReabrirRevisaoDialog";
import { FormAcao } from "./FormAcao";
import { GradeMesesPessoal } from "./GradeMesesPessoal";
import {
  frasesPreviaCatalogo,
  lerPlanoCatalogo,
  resumirPlanoCatalogo,
  seloLinhaCatalogo,
  type LinhaPlanoCatalogo,
  type SeloCatalogo,
} from "@/lib/project-budget/catalogo-vivo";

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

const TOM_SELO: Record<SeloCatalogo["tom"], string> = {
  novo: "bg-info-soft text-info-strong",
  atualiza: "bg-success-soft text-success-strong",
  aviso: "bg-warning-soft text-warning-strong",
};

/** Selo do catálogo vivo na linha (novo, atualiza, catálogo hoje, repetido, pessoal pendente). */
function SeloCatalogoLinha({ linha }: { linha?: LinhaPlanoCatalogo }) {
  const selo = linha ? seloLinhaCatalogo(linha) : null;
  // DC7: valor do catálogo parado há mais de 8 meses, em amarelo (só nas linhas ligadas a ele).
  const velho =
    linha && (linha.acao === "inalterado" || linha.acao === "vincular") && valorDesatualizado(linha.valorCatalogoEm);
  if (!selo && !velho) return null;
  return (
    <>
      {selo && (
        <span
          className={`mt-1 block w-fit rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TOM_SELO[selo.tom]}`}
          title={selo.detalhe}
        >
          {selo.rotulo}
        </span>
      )}
      {velho && (
        <span
          className="mt-1 block w-fit rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning-strong"
          title="O valor deste item no catálogo não é atualizado há mais de 8 meses. Confira antes de concluir."
        >
          Catálogo +{MESES_VALOR_VELHO} meses
        </span>
      )}
    </>
  );
}

function Mascarado() {
  return (
    <span title={NOTA_VALOR_MASCARADO}>
      {VALOR_MASCARADO}
      <span className="sr-only"> — {NOTA_VALOR_MASCARADO}</span>
    </span>
  );
}

/**
 * Editor da etapa "Custos do projeto" da proposta (Etapa A da migração do app antigo):
 * rubricas PE/MC/MP/ST/VD/OU, grade de meses do pessoal, viagens com cálculo automático,
 * um campo único para lançar itens (catálogo ou novo), modelos, exportação, conferência e
 * conclusão da revisão (RPC concluir_revisao_custos_projeto, que alimenta o catálogo vivo) e
 * reabertura/reformulação (0139). Pessoal sem a permissão aparece como XXX (DC8, 0140).
 */
export async function EditorCustosProjeto({
  orcamentoProjetoId,
  demandaId,
}: {
  orcamentoProjetoId: number;
  demandaId: number;
}) {
  const supabase = await createClient();
  const [
    { data: orc },
    { data: custosData },
    { data: analisesData },
    { data: catalogoData },
    podeRevisar,
    { data: demandaInst },
    podePreencher,
    podeModelos,
    podePessoal,
    podeSalario,
    { data: modelosData },
    { data: aprovadaData },
  ] =
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
      podeOrcamento("revisar_modulo"),
      // instituição do orçamento: título e criador dos arquivos exportados
      supabase.from("demandas_propostas").select("instituicao").eq("id", demandaId).maybeSingle(),
      podeOrcamento("preencher_custos"),
      podeOrcamento("gerir_modelos"),
      temPermissao("orcamentos.pessoal"),
      temPermissao("tecnicos.salario.ver"),
      supabase.from("orcamento_projeto_templates").select("id, nome, descricao, itens").order("nome"),
      // Proposta aprovada: reabrir vira reformulação (0139).
      supabase
        .from("orcamento_final_versoes")
        .select("numero")
        .eq("demanda_id", demandaId)
        .in("status", ["aprovado", "convertido_projeto"])
        .order("versao", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (!orc) {
    return <p className="mt-4 text-sm text-muted-foreground">Orçamento de projeto não encontrado.</p>;
  }

  // DC8 (0137/0140): pessoal só para quem tem "Valores de pessoal no orçamento" (ou vê salário).
  const podeVerPessoal = podePessoal || podeSalario;
  const modelos: ModeloResumo[] = (
    (modelosData ?? []) as Array<{ id: number; nome: string; descricao: string | null; itens: unknown }>
  )
    .filter((modelo) => !modelo.nome.startsWith("[ARQUIVADO]"))
    .map((modelo) => ({
      id: modelo.id,
      nome: modelo.nome,
      descricao: modelo.descricao,
      itens: Array.isArray(modelo.itens) ? modelo.itens.length : 0,
    }));
  const versaoAprovada = (aprovadaData as { numero: string } | null)?.numero ?? null;

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
  // Catálogo vivo (0137): o que a conclusão faria com cada linha. Só interessa em edição.
  const { data: previaData } = editavel
    ? await supabase.rpc("previa_catalogo_revisao_projeto", { p_orcamento_projeto_id: orcamentoProjetoId })
    : { data: null };
  const planoCatalogo = lerPlanoCatalogo(previaData);
  const planoPorLinha = new Map(planoCatalogo.map((linha) => [linha.linhaId, linha]));
  const frasesCatalogo = frasesPreviaCatalogo(resumirPlanoCatalogo(planoCatalogo));
  const mesesProjeto = Math.max(1, Number(orc.project_months ?? 12));
  const viagem = normalizarViagemInputs((orc.travel_inputs ?? null) as Partial<ViagemInputs> | null);

  const totalAnalises = roundMoney(analises.reduce((soma, a) => soma + a.custo_unitario * a.n_amostras, 0));
  // As análises antigas lançadas no projeto (DC3) entram em MC, como no total e na planilha.
  const rubricas = resumirRubricas(custos, { total: totalAnalises, itens: analises.length });
  const totalProjeto = roundMoney(rubricas.reduce((soma, r) => soma + r.total, 0));
  const quantidadeItens = custos.length + analises.length;
  const temPessoal = custos.some((item) => item.rubrica === "PE");
  // Sem a permissão, o total também revelaria o pessoal por subtração.
  const mascararPessoal = !podeVerPessoal && temPessoal;
  const avisosConferencia = editavel ? conferenciaRevisao({ custos, viagem, plano: planoCatalogo }) : [];

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
    instituicao: demandaInst?.instituicao ?? null,
  };

  const campos = (
    <>
      <input type="hidden" name="orcamento_projeto_id" value={orcamentoProjetoId} />
      <input type="hidden" name="demanda_id" value={demandaId} />
    </>
  );

  function acoesItem(item: (typeof custos)[number]): ReactNode {
    if (!editavel) return null;
    // Pessoal sem a permissão: só leitura (o banco também recusa, 0140).
    if (item.rubrica === "PE" && !podeVerPessoal) return null;
    return (
      <span className="inline-flex items-center gap-0.5">
        <EditarCustoDialog
          item={item}
          orcamentoProjetoId={orcamentoProjetoId}
          demandaId={demandaId}
          action={atualizarCustoProjeto}
          podePessoal={podeVerPessoal}
        />
        <ConfirmActionButton
          action={removerCustoProjeto}
          fields={{ orcamento_projeto_id: orcamentoProjetoId, demanda_id: demandaId, item_id: item.id }}
          titulo="Remover item?"
          mensagem={`"${item.descricao}" sai dos custos do projeto (${brl(subtotalCusto(item))}).`}
          confirmLabel="Remover"
          triggerClassName={CLASSE_BOTAO_ICONE_PERIGO}
          trigger={<IconeAcao icone={Trash2} rotulo={`Remover ${item.descricao}`} />}
        />
      </span>
    );
  }

  function blocoAdicionar(rubrica: string) {
    if (!editavel) return null;
    if (rubrica === "PE" && !podeVerPessoal) {
      return (
        <p className="mt-3 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Pessoal é lançado por quem tem a permissão “Valores de pessoal no orçamento”.
        </p>
      );
    }
    return (
      <div className="mt-3 rounded-md border border-dashed border-foreground/20 p-3">
        <AdicionarItemProjeto
          rubrica={rubrica}
          itens={catalogo.filter((item) => item.rubrica === rubrica)}
          orcamentoProjetoId={orcamentoProjetoId}
          demandaId={demandaId}
          action={adicionarItemProjeto}
        />
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
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {ORIGEM[item.origem ?? "manual"] ?? item.origem}
                    <SeloCatalogoLinha linha={planoPorLinha.get(item.id)} />
                  </td>
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

  // DC3: a caixa de análises do projeto saiu; as já lançadas aparecem em MC para conferir ou remover.
  const analisesAntigas =
    analises.length === 0 ? null : (
      <div className="rounded-md border border-border">
        <div className="flex items-center gap-1 border-b border-border bg-muted/50 px-3 py-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Análises lançadas no projeto</h4>
          <HelpTip title="Análises lançadas no projeto">
            <p>
              Lançadas antes da mudança: entram em MC pelo <b>custo técnico</b> e continuam valendo. Análises novas entram pela
              etapa <b>Laboratório</b>, com o tipo “Projeto com análises laboratoriais”.
            </p>
          </HelpTip>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{brl(totalAnalises)}</span>
        </div>
        <table className="min-w-full text-sm">
          <caption className="sr-only">Análises lançadas no projeto</caption>
          <tbody className="divide-y divide-border/70">
            {analises.map((item) => (
              <tr key={item.id}>
                <th scope="row" className="px-3 py-1.5 text-left font-medium">{item.codigo_analise}</th>
                <td className="px-3 py-1.5 text-right tabular-nums">{item.n_amostras.toLocaleString("pt-BR")} amostras</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{brl(item.custo_unitario)}</td>
                <td className="px-3 py-1.5 text-right font-medium tabular-nums">{brl(item.custo_unitario * item.n_amostras)}</td>
                {editavel && (
                  <td className="px-2 py-1 text-right">
                    <ConfirmActionButton
                      action={removerAnaliseProjeto}
                      fields={{ orcamento_projeto_id: orcamentoProjetoId, demanda_id: demandaId, item_id: item.id }}
                      titulo="Remover análise?"
                      mensagem={`${item.codigo_analise} (${item.n_amostras} amostras) sai dos custos do projeto.`}
                      confirmLabel="Remover"
                      triggerClassName={CLASSE_BOTAO_ICONE_PERIGO}
                      trigger={<IconeAcao icone={Trash2} rotulo={`Remover ${item.codigo_analise}`} />}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

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
        {((editavel && podePreencher) || (podeModelos && custos.length > 0)) && (
          <div className="flex flex-wrap items-end gap-2">
            {editavel && podePreencher && (
              <UsarModeloDialog
                modelos={modelos}
                orcamentoProjetoId={orcamentoProjetoId}
                demandaId={demandaId}
                action={aplicarModeloProjeto}
              />
            )}
            {podeModelos && custos.length > 0 && (
              <SalvarModeloDialog orcamentoProjetoId={orcamentoProjetoId} demandaId={demandaId} action={salvarComoTemplate} />
            )}
          </div>
        )}
        <div className="text-right">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Custo do projeto</p>
          <p className="text-2xl font-semibold tabular-nums" data-testid="total-custo-projeto">
            {mascararPessoal ? <Mascarado /> : brl(totalProjeto)}
          </p>
          <p className="text-[11px] text-muted-foreground">{quantidadeItens} {quantidadeItens === 1 ? "item" : "itens"} · custo técnico, antes dos parâmetros</p>
        </div>
      </div>

      {orc.reformulacao_de_versao_id && (
        <p role="note" className="flex items-start gap-2 rounded-md border border-warning-strong/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning-strong">
          <RefreshCcw className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">Reformulação da proposta {versaoAprovada ?? "aprovada"}.</strong> Ao concluir a
            revisão, emita a nova versão; quando aprovada, ela substitui a atual, que fica no histórico.
          </span>
        </p>
      )}

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
            <p className="mt-1 font-medium tabular-nums" data-testid={`total-rubrica-${r.codigo}`}>
              {r.codigo === "PE" && mascararPessoal ? <Mascarado /> : brl(r.total)}
            </p>
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
                  // Sem a permissão, o valor nem chega ao navegador (DC8).
                  custo_unitario: podeVerPessoal ? item.custo_unitario : 0,
                  meses_selecionados: item.meses_selecionados,
                }))}
                mesesProjeto={mesesProjeto}
                orcamentoProjetoId={orcamentoProjetoId}
                demandaId={demandaId}
                editavel={editavel && podeVerPessoal}
                mascarado={!podeVerPessoal}
                action={salvarMesesPessoalProjeto}
                acoesLinha={
                  editavel && podeVerPessoal
                    ? Object.fromEntries(linhasPessoal.map((item) => [item.id, acoesItem(item)]))
                    : undefined
                }
                detalhesLinha={Object.fromEntries(
                  linhasPessoal.map((item) => [item.id, <SeloCatalogoLinha key={item.id} linha={planoPorLinha.get(item.id)} />]),
                )}
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
                {rubrica === "MC" && analisesAntigas}
              </>
            )}
            {blocoAdicionar(rubrica)}
          </TabsContent>
        ))}
      </Tabs>

      {/* Exportação e conclusão da revisão */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-md border border-border p-3">
        <div>
          <div className="flex items-center gap-1">
            <h4 className="text-sm font-semibold">Exportar custos do projeto</h4>
            <HelpTip title="Exportar custos">
              <p>Itens, rubricas e demonstrativo com os parâmetros deste orçamento de projeto.</p>
            </HelpTip>
          </div>
          <div className="mt-2">
            {mascararPessoal ? (
              // A planilha levaria os valores de pessoal ao navegador.
              <p className="text-xs text-muted-foreground">Há itens de pessoal: a exportação exige a permissão de pessoal.</p>
            ) : (
              <ExportProjetoButtons info={exportInfo} itens={exportItens} calculo={calculoExport} />
            )}
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
                      Custo do projeto: <strong>{mascararPessoal ? VALOR_MASCARADO : brl(totalProjeto)}</strong> em {quantidadeItens}{" "}
                      {quantidadeItens === 1 ? "item" : "itens"}.
                    </p>
                    <p className="mt-2">
                      Os custos ficam travados e passam a compor a proposta. Para mudar depois, use “Reabrir revisão”.
                    </p>
                    {avisosConferencia.length > 0 && (
                      <div className="mt-2 rounded-md bg-warning-soft px-2 py-1.5 text-warning-strong">
                        <p className="font-medium">Confira antes de concluir:</p>
                        <ul className="mt-1 list-disc space-y-1 pl-5">
                          {avisosConferencia.map((aviso) => (
                            <li key={aviso.tipo}>{aviso.texto}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {frasesCatalogo.length > 0 ? (
                      <div className="mt-2">
                        <p className="font-medium">No catálogo de custos:</p>
                        <ul className="mt-1 list-disc space-y-1 pl-5">
                          {frasesCatalogo.map((frase) => (
                            <li key={frase}>{frase}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="mt-2">O catálogo de custos não muda.</p>
                    )}
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
            <div className="mt-2">
              <ReabrirRevisaoDialog
                orcamentoProjetoId={orcamentoProjetoId}
                demandaId={demandaId}
                versaoAprovada={versaoAprovada}
                action={reabrirCustosProjeto}
              />
            </div>
          )}
          {estado.podeReabrir && !podeRevisar && (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Reabrir a revisão é feito por quem emite propostas (coordenador, gestor ou administrador).
            </p>
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
