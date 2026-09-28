import Link from "next/link";
import type { ReactNode } from "react";
import { Archive, ArchiveRestore, Copy, History, Search, SlidersHorizontal, X } from "lucide-react";
import { CLASSE_BOTAO_ICONE, CLASSE_BOTAO_ICONE_PERIGO, IconeAcao } from "@/components/common/IconeAcao";

import { ConfirmActionButton } from "@/components/common/ConfirmActionButton";
import { SubmitButton } from "@/components/common/SubmitButton";
import { HelpTip } from "@/components/common/HelpTip";
import { ItemCatalogoDialog } from "@/components/orcamento/catalogo/ItemCatalogoDialog";
import { UnificarItemDialog } from "@/components/orcamento/catalogo/UnificarItemDialog";
import { buttonVariants } from "@/components/ui/button";
import {
  criarProjetoDeTemplate,
  duplicarTemplateProjeto,
  excluirTemplate,
} from "@/lib/actions/orcamento-projetos";
import { definirAtivoItemCatalogo, salvarItemCatalogo, unificarItensCatalogo } from "@/lib/actions/catalogo-custos";
import { temPermissao } from "@/lib/auth/permissao-efetiva";
import { podeOrcamento } from "@/lib/orcamento/governanca";
import {
  MESES_VALOR_VELHO,
  origemDoValor,
  ROTULO_EVENTO_CATALOGO,
  valorDesatualizado,
} from "@/lib/orcamento/catalogo-custos";
import { formatCurrency as brl, formatDate, formatDateTime } from "@/lib/formatters";
import { NOTA_VALOR_MASCARADO, VALOR_MASCARADO } from "@/lib/cadastros/mascara";
import { precoCatalogoMascarado } from "@/lib/cadastros/salario";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

// "Usar" criava um orçamento de projeto sem vínculo com proposta e voltava à
// lista em ciclo. Fica oculto até a migração do editor de projeto (protocolo
// docs/migracao-orcamento-projetos-protocolo.md); o código segue preservado.
const USO_DIRETO_DE_TEMPLATE = false;

type SearchParams = {
  origem?: string;
  rubrica?: string;
  status?: string;
  busca?: string;
  /** "1" = só valores com mais de 8 meses (DC7). */
  velho?: string;
  /** Código do item cujo histórico de valores aparece no painel. */
  historico?: string;
};

type TemplateProjeto = {
  id: number;
  nome: string;
  descricao: string | null;
  itens: Json;
  parametros: Json;
  origem: string;
  criado_em: string;
};

type CatalogoItem = {
  id: string;
  rubrica: string;
  descricao: string;
  unidade: string | null;
  preco_unitario: number | null;
  preco_mascarado?: boolean;
  categoria: string | null;
  origem: string;
  ativo: boolean;
  valid_from: string | null;
  // catálogo vivo (0137): unificação e origem do valor atual
  substituido_por?: string | null;
  valor_atualizado_em?: string | null;
  valor_atualizado_por?: string | null;
  valor_origem_demanda_titulo?: string | null;
};

type HistoricoValor = {
  registrado_em: string;
  evento: string;
  preco_unitario: number | null;
  preco_anterior: number | null;
  aplicado: boolean;
  demanda_titulo: string | null;
  usuario: string | null;
  observacao: string | null;
};

type ProjetoOpcao = {
  id: number;
  nome: string;
};

/** Rubricas na ordem e com os rótulos da visão interna da proposta. */
const RUBRICAS = [
  { id: "PE", rotulo: "PE · Pessoal" },
  { id: "MC", rotulo: "MC · Material de consumo" },
  { id: "MP", rotulo: "MP · Material permanente" },
  { id: "ST", rotulo: "ST · Serviços de terceiros" },
  { id: "VD", rotulo: "VD · Viagens e diárias" },
  { id: "OU", rotulo: "OU · Outros" },
] as const;
const rubricas = RUBRICAS.map((rubrica) => rubrica.id);

export default async function OrcamentoModelosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filtros = await searchParams;
  const supabase = await createClient();
  const [
    { data: templates },
    { data: catalogoCompleto },
    { data: projetos },
    podeEditarCatalogo,
    podePessoal,
    podeSalario,
  ] = await Promise.all([
    supabase
      .from("orcamento_projeto_templates")
      .select("id, nome, descricao, itens, parametros, origem, criado_em")
      .order("criado_em", { ascending: false }),
    // Preço de PE (pessoas nominais) vem mascarado (NULL) do banco para quem
    // não tem "Valores de pessoal no orçamento" (0137). Já vem ordenado.
    supabase.rpc("orcamento_projeto_catalogo_listar"),
    supabase.from("projetos").select("id, nome").order("nome").limit(100),
    // Editar o catálogo: "Modelos e catálogos" (0138, mesma regra da RLS da 0124).
    podeOrcamento("gerir_modelos"),
    temPermissao("orcamentos.pessoal"),
    temPermissao("tecnicos.salario.ver"),
  ]);
  const podeVerPessoal = podePessoal || podeSalario;
  const catalogo = ((catalogoCompleto ?? []) as CatalogoItem[]).slice(0, 400);
  const itemHistorico = filtros.historico ? catalogo.find((item) => item.id === filtros.historico) : undefined;
  const { data: historicoData } = itemHistorico
    ? await supabase.rpc("catalogo_projeto_historico", { p_id: itemHistorico.id })
    : { data: null };
  const historico = (historicoData ?? []) as HistoricoValor[];

  const templatesFiltrados = filtrarTemplates((templates ?? []) as TemplateProjeto[], filtros);
  // A rubrica é escolhida nas abas do catálogo; as contagens das abas seguem os demais filtros.
  const catalogoSemRubrica = filtrarCatalogo(catalogo, { ...filtros, rubrica: undefined });
  const catalogoFiltrado = filtrarCatalogo(catalogo, filtros);
  const abasRubrica = RUBRICAS.map((rubrica) => ({
    ...rubrica,
    total: catalogoSemRubrica.filter((item) => item.rubrica === rubrica.id).length,
  })).filter((aba) => aba.total > 0 || aba.id === filtros.rubrica);
  const templatesAtivos = ((templates ?? []) as TemplateProjeto[]).filter((item) => !isArquivado(item)).length;
  const templatesArquivados = ((templates ?? []) as TemplateProjeto[]).filter(isArquivado).length;
  const itensAtivos = catalogo.filter((item) => item.ativo).length;
  const importados = catalogo.filter((item) => item.origem === "orcamento_projetos_antigo").length;
  const parametrosPadrao = resumirParametrosPadrao((templates ?? []) as TemplateProjeto[]);

  const filtrosAvancados = [filtros.origem, filtros.status, filtros.velho].filter(Boolean).length;
  const temFiltro = Boolean(filtros.busca || filtros.origem || filtros.status || filtros.rubrica || filtros.velho);
  const valoresVelhos = catalogo.filter((item) => item.ativo && valorDesatualizado(dataDoValor(item))).length;
  /** Itens ativos da mesma rubrica para onde um item repetido pode ser unificado. */
  const opcoesUnificar = (item: CatalogoItem) =>
    catalogo
      .filter((outro) => outro.id !== item.id && outro.rubrica === item.rubrica && outro.ativo && !outro.substituido_por)
      .map((outro) => ({ id: outro.id, descricao: outro.descricao, unidade: outro.unidade }));
  const mostrarRubrica = !filtros.rubrica;

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href="/orcamento" className="text-xs text-muted-foreground hover:underline">Orçamentos</Link>
            <div className="mt-1 flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Modelos e catálogo</h1>
              <HelpTip title="Modelos e catálogo">
                <p>Base reutilizável para montar orçamentos de projeto: <b>modelos</b> com itens prontos, o <b>catálogo institucional</b> de custos por rubrica e os parâmetros padrão.</p>
                <p>Nada é apagado: itens fora de uso são arquivados e continuam no histórico.</p>
              </HelpTip>
            </div>
            {/* resumo em uma linha (28/09), no lugar dos quatro cartões */}
            <p className="mt-0.5 text-sm text-muted-foreground">
              <Numero valor={templatesAtivos} /> {templatesAtivos === 1 ? "template ativo" : "templates ativos"}
              {" · "}<Numero valor={templatesArquivados} /> {templatesArquivados === 1 ? "template arquivado" : "templates arquivados"}
              {" · "}<Numero valor={itensAtivos} /> {itensAtivos === 1 ? "item ativo" : "itens ativos"} no catálogo
              {" · "}<Numero valor={importados} /> de origem importada
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {USO_DIRETO_DE_TEMPLATE && (
              <Link href="/orcamento/projetos" className={buttonVariants({ size: "sm" })}>
                Usar em orçamento
              </Link>
            )}
            <Link href="/orcamento" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Orçamentos
            </Link>
          </div>
        </div>

        {/* Barra de filtros no padrão do Histórico: busca de largura fixa, o resto num painel.
            A rubrica fica nas abas do catálogo; o campo oculto a preserva ao filtrar. */}
        <form
          key={JSON.stringify(filtros)}
          role="search"
          aria-label="Filtrar modelos e catálogo"
          className="mt-4 flex flex-wrap items-center gap-2"
        >
          {filtros.rubrica && <input type="hidden" name="rubrica" value={filtros.rubrica} />}
          <div className="relative w-full sm:w-72">
            <label htmlFor="modelos-busca" className="sr-only">Buscar por código, descrição ou categoria</label>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              id="modelos-busca"
              type="search"
              name="busca"
              defaultValue={filtros.busca ?? ""}
              placeholder="Código, descrição ou categoria"
              className={`${campoCls} w-full pl-8`}
            />
          </div>
          <details className="relative">
            <summary className={`${campoCls} flex cursor-pointer list-none items-center gap-1.5 font-medium hover:bg-accent [&::-webkit-details-marker]:hidden`}>
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden />
              Mais filtros
              {filtrosAvancados > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
                  {filtrosAvancados}
                </span>
              )}
            </summary>
            <div className="absolute left-0 top-full z-20 mt-2 grid w-[min(24rem,calc(100vw-2rem))] grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 shadow-lg">
              <CampoFiltro label="Origem">
                <select name="origem" defaultValue={filtros.origem ?? ""} className={inputCls}>
                  <option value="">Todas</option>
                  <option value="kontrol">Kontrol</option>
                  <option value="orcamento_projetos_antigo">Importada</option>
                </select>
              </CampoFiltro>
              <CampoFiltro label="Status">
                <select name="status" defaultValue={filtros.status ?? ""} className={inputCls}>
                  <option value="">Todos</option>
                  <option value="ativo">Ativo</option>
                  <option value="arquivado">Arquivado</option>
                  <option value="inativo">Inativo</option>
                </select>
              </CampoFiltro>
              <CampoFiltro label="Valor do catálogo">
                <select name="velho" defaultValue={filtros.velho ?? ""} className={inputCls}>
                  <option value="">Todos</option>
                  <option value="1">Mais de {MESES_VALOR_VELHO} meses sem atualizar</option>
                </select>
              </CampoFiltro>
            </div>
          </details>
          <button className="inline-flex h-9 items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-500">
            Filtrar
          </button>
          {temFiltro && (
            <Link href="/orcamento/modelos" className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
              Limpar
            </Link>
          )}
        </form>

        <section id="templates" aria-labelledby="templates-titulo" className="mt-4 scroll-mt-8 rounded-lg border border-border bg-card shadow-sm">
          <Cabecalho
            id="templates-titulo"
            titulo="Templates de projeto"
            subtitulo="Duplique ou arquive modelos. Usar em orçamento: em breve."
            semBorda={templatesFiltrados.length === 0}
            extra={
              <>
                {templatesFiltrados.length === 0 && (
                  <p className="text-xs text-muted-foreground/80">Nenhum template encontrado.</p>
                )}
                {USO_DIRETO_DE_TEMPLATE && (
                  <Link href="/orcamento/projetos" className="ml-auto text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
                    Criar a partir de template
                  </Link>
                )}
              </>
            }
          />
          {templatesFiltrados.length > 0 && (
            <div tabIndex={0} aria-label="Templates de projeto" className="overflow-x-auto">
              <table className="w-full min-w-[60rem] table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[18%]" />
                  <col />
                  <col className="w-[6.5rem]" />
                  <col className="w-[3.5rem]" />
                  <col className="w-[22%]" />
                  <col className="w-[6.5rem]" />
                  <col className="w-[6.5rem]" />
                  <col className="w-[9rem]" />
                </colgroup>
                <thead className={cabecalhoTabela}>
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Nome</th>
                    <th className="px-3 py-1.5 font-medium">Descrição</th>
                    <th className="px-3 py-1.5 font-medium">Origem</th>
                    <th className="px-3 py-1.5 text-right font-medium">Itens</th>
                    <th className="px-3 py-1.5 font-medium">Parâmetros</th>
                    <th className="px-3 py-1.5 font-medium">Criado em</th>
                    <th className="px-3 py-1.5 font-medium">Status</th>
                    <th className="px-3 py-1.5 text-right font-medium">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {templatesFiltrados.map((template) => (
                    <tr key={template.id}>
                      <td className="truncate px-3 py-1.5 font-medium" title={nomeVisivel(template.nome)}>{nomeVisivel(template.nome)}</td>
                      <td className="truncate px-3 py-1.5 text-muted-foreground" title={template.descricao ?? undefined}>{template.descricao ?? "—"}</td>
                      <td className="px-3 py-1.5"><Origem origem={template.origem} /></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{contarItens(template.itens)}</td>
                      <td className="truncate px-3 py-1.5 text-xs text-muted-foreground" title={resumoParametros(template.parametros)}>{resumoParametros(template.parametros)}</td>
                      <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{formatDate(template.criado_em)}</td>
                      <td className="px-3 py-1.5">{isArquivado(template) ? <Badge tom="zinc">Arquivado</Badge> : <Badge tom="brand">Ativo</Badge>}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex justify-end gap-1">
                          {USO_DIRETO_DE_TEMPLATE && !isArquivado(template) && (
                            <form action={criarProjetoDeTemplate} className="flex items-center gap-1">
                              <input type="hidden" name="template_id" value={template.id} />
                              <select name="projeto_id" defaultValue="" className="rounded-md border border-input bg-card px-2 py-1 text-xs">
                                <option value="">Sem projeto</option>
                                {((projetos ?? []) as ProjetoOpcao[]).map((projeto) => (
                                  <option key={projeto.id} value={projeto.id}>{projeto.nome}</option>
                                ))}
                              </select>
                              <SubmitButton variant="link" size="sm" className="h-auto p-0 text-xs font-medium text-brand-700 dark:text-brand-300" pendingLabel="Criando…">Usar</SubmitButton>
                            </form>
                          )}
                          <form action={duplicarTemplateProjeto}>
                            <input type="hidden" name="template_id" value={template.id} />
                            <SubmitButton variant="ghost" size="icon" className={CLASSE_BOTAO_ICONE} pendingLabel="…">
                              <IconeAcao icone={Copy} rotulo="Duplicar modelo" />
                            </SubmitButton>
                          </form>
                          {!isArquivado(template) && (
                            <ConfirmActionButton
                              action={excluirTemplate}
                              fields={{ template_id: template.id }}
                              trigger={<IconeAcao icone={Archive} rotulo="Arquivar modelo" />}
                              titulo="Arquivar template"
                              mensagem={`Arquivar o template ${nomeVisivel(template.nome)}? Ele deixa de ser oferecido como ativo, mas o registro permanece no histórico.`}
                              confirmLabel="Arquivar"
                              triggerClassName={CLASSE_BOTAO_ICONE_PERIGO}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <FaixaResumo
            id="parametros"
            titulo="Parâmetros padrão em templates"
            ajuda={
              <HelpTip title="Parâmetros padrão em templates" className="h-6 w-6">
                <p>Leitura consolidada dos parâmetros salvos nos modelos reutilizáveis: a <b>média</b> dos templates ativos.</p>
              </HelpTip>
            }
            itens={parametrosPadrao.map((item) => [item.label, item.valor])}
          />
          <FaixaResumo
            id="importados"
            titulo="Importados do app antigo"
            ajuda={
              <HelpTip title="Importados do app antigo" className="h-6 w-6">
                <p>Itens trazidos do sistema anterior de orçamento, por rubrica. A origem fica registrada para <b>auditoria</b>; no dia a dia, use o <b>catálogo institucional</b>.</p>
              </HelpTip>
            }
            itens={rubricas.map((rubrica) => [
              rubrica,
              catalogo
                .filter((item) => item.origem === "orcamento_projetos_antigo" && item.rubrica === rubrica)
                .length.toLocaleString("pt-BR"),
            ])}
          />
        </div>

        <section id="catalogo" aria-labelledby="catalogo-titulo" className="mt-4 scroll-mt-8 rounded-lg border border-border bg-card shadow-sm">
          <Cabecalho
            id="catalogo-titulo"
            titulo="Catálogo institucional de custos"
            subtitulo="Valores de referência dos orçamentos de projeto. Cada item (rubrica + descrição + unidade) tem um valor só: a conclusão de cada revisão de custos atualiza o catálogo e aqui também se cria e edita. Nada é apagado: o valor antigo fica no histórico e o item fora de uso é arquivado."
            semBorda
            extra={
              <div className="ml-auto flex items-center gap-3">
                {valoresVelhos > 0 && (
                  <Link
                    href={hrefModelos({ ...filtros, velho: "1", historico: undefined })}
                    className="text-xs font-medium text-warning-strong hover:underline"
                  >
                    {valoresVelhos} {valoresVelhos === 1 ? "valor" : "valores"} com mais de {MESES_VALOR_VELHO} meses
                  </Link>
                )}
                {podeEditarCatalogo && (
                  <ItemCatalogoDialog
                    rubricaPadrao={filtros.rubrica ?? "MC"}
                    podeVerPessoal={podeVerPessoal}
                    action={salvarItemCatalogo}
                  />
                )}
              </div>
            }
          />
          {itemHistorico && (
            <div className="border-t border-border bg-muted/30 px-3 py-2" aria-labelledby="historico-titulo">
              <div className="flex items-center justify-between gap-2">
                <h3 id="historico-titulo" className="text-sm font-semibold">
                  Histórico de valores · {itemHistorico.id} — {itemHistorico.descricao} ({itemHistorico.unidade ?? "un"})
                </h3>
                <Link href={hrefHistorico(filtros, undefined)} scroll={false} className={CLASSE_BOTAO_ICONE}>
                  <IconeAcao icone={X} rotulo="Fechar o histórico" />
                </Link>
              </div>
              {historico.length === 0 ? (
                <p className="py-1 text-xs text-muted-foreground">Sem registros de valor.</p>
              ) : (
                <table className="mt-1 w-full text-left text-xs">
                  <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Quando</th>
                      <th className="py-1 pr-3 font-medium">O que</th>
                      <th className="py-1 pr-3 text-right font-medium">Valor</th>
                      <th className="py-1 pr-3 text-right font-medium">Antes</th>
                      <th className="py-1 pr-3 font-medium">Origem</th>
                      <th className="py-1 font-medium">Quem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {historico.map((linha, indice) => (
                      <tr key={`${linha.registrado_em}-${indice}`}>
                        <td className="whitespace-nowrap py-1 pr-3 tabular-nums">{formatDateTime(linha.registrado_em)}</td>
                        <td className="py-1 pr-3">
                          {ROTULO_EVENTO_CATALOGO[linha.evento] ?? linha.evento}
                          {!linha.aplicado && <span className="ml-1 text-warning-strong">(aguardando)</span>}
                        </td>
                        <td className="whitespace-nowrap py-1 pr-3 text-right tabular-nums">
                          {linha.preco_unitario == null ? VALOR_MASCARADO : brl(Number(linha.preco_unitario))}
                        </td>
                        <td className="whitespace-nowrap py-1 pr-3 text-right tabular-nums text-muted-foreground">
                          {linha.preco_anterior == null ? "—" : brl(Number(linha.preco_anterior))}
                        </td>
                        <td className="py-1 pr-3 text-muted-foreground">
                          {linha.demanda_titulo ? `Proposta “${linha.demanda_titulo}”` : linha.observacao ?? "—"}
                        </td>
                        <td className="py-1 text-muted-foreground">{linha.usuario ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {/* Subabas por rubrica (como a visão interna da proposta): só as que têm itens. */}
          <nav aria-label="Rubricas do catálogo" className="flex gap-1 overflow-x-auto border-b border-border px-1.5 [scrollbar-width:none]">
            <AbaRubrica href={hrefRubrica(filtros, undefined)} ativa={!filtros.rubrica} rotulo="Todas" total={catalogoSemRubrica.length} />
            {abasRubrica.map((aba) => (
              <AbaRubrica
                key={aba.id}
                href={hrefRubrica(filtros, aba.id)}
                ativa={filtros.rubrica === aba.id}
                rotulo={aba.rotulo}
                total={aba.total}
              />
            ))}
          </nav>
          <div tabIndex={0} aria-label="Itens do catálogo institucional" className="overflow-x-auto">
            <table className="w-full min-w-[56rem] table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[5.5rem]" />
                {mostrarRubrica && <col className="w-[4.25rem]" />}
                <col className="w-[16%]" />
                <col />
                <col className="w-[5.5rem]" />
                <col className="w-[7.5rem]" />
                <col className="w-[6rem]" />
                <col className="w-[7.5rem]" />
                <col className="w-[8.75rem]" />
              </colgroup>
              <thead className={cabecalhoTabela}>
                <tr>
                  <th className="px-3 py-1.5 font-medium">Código</th>
                  {mostrarRubrica && <th className="px-3 py-1.5 font-medium">Rubrica</th>}
                  <th className="px-3 py-1.5 font-medium">Grupo</th>
                  <th className="px-3 py-1.5 font-medium">Descrição</th>
                  <th className="px-3 py-1.5 font-medium">Unidade</th>
                  <th className="px-3 py-1.5 text-right font-medium">Custo padrão</th>
                  <th className="px-3 py-1.5 font-medium">Origem</th>
                  <th className="px-3 py-1.5 font-medium">Atualizado</th>
                  <th className="px-3 py-1.5 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {catalogoFiltrado.map((item) => (
                  <tr key={item.id} className={item.id === itemHistorico?.id ? "bg-muted/40" : undefined}>
                    <td className="truncate px-3 py-1.5 font-medium" title={item.id}>{item.id}</td>
                    {mostrarRubrica && <td className="px-3 py-1.5"><Badge>{item.rubrica}</Badge></td>}
                    <td className="truncate px-3 py-1.5 text-muted-foreground" title={item.categoria ?? undefined}>{item.categoria ?? "—"}</td>
                    <td className="truncate px-3 py-1.5" title={item.descricao}>
                      {item.descricao}
                      {item.substituido_por && (
                        <span className="block text-[11px] text-muted-foreground">Unificado em {item.substituido_por}</span>
                      )}
                    </td>
                    <td className="truncate px-3 py-1.5 text-muted-foreground" title={item.unidade ?? "un"}>{item.unidade ?? "un"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                      {precoCatalogoMascarado(item) ? (
                        <span title={NOTA_VALOR_MASCARADO}>
                          {VALOR_MASCARADO}
                          <span className="sr-only"> — {NOTA_VALOR_MASCARADO}</span>
                        </span>
                      ) : (
                        brl(Number(item.preco_unitario ?? 0))
                      )}
                    </td>
                    <td className="px-3 py-1.5"><Origem origem={item.origem} /></td>
                    <td
                      className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted-foreground"
                      title={`Valor de ${formatDate(dataDoValor(item))} — ${origemDoValor(item)}`}
                    >
                      {formatDate(dataDoValor(item))}
                      {item.ativo && valorDesatualizado(dataDoValor(item)) && (
                        <span className="ml-1 rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning-strong">
                          +{MESES_VALOR_VELHO} meses
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        {podeEditarCatalogo && !item.substituido_por && (
                          <ItemCatalogoDialog
                            item={{
                              id: item.id,
                              rubrica: item.rubrica,
                              descricao: item.descricao,
                              unidade: item.unidade,
                              categoria: item.categoria,
                              preco_unitario: item.preco_unitario,
                              preco_mascarado: precoCatalogoMascarado(item),
                            }}
                            podeVerPessoal={podeVerPessoal}
                            action={salvarItemCatalogo}
                          />
                        )}
                        <Link href={hrefHistorico(filtros, item.id)} scroll={false} className={CLASSE_BOTAO_ICONE}>
                          <IconeAcao icone={History} rotulo={`Histórico de valores de ${item.descricao}`} />
                        </Link>
                        {podeEditarCatalogo && item.ativo && !item.substituido_por && opcoesUnificar(item).length > 0 && (
                          <UnificarItemDialog item={item} opcoes={opcoesUnificar(item)} action={unificarItensCatalogo} />
                        )}
                        {podeEditarCatalogo && !item.substituido_por && (item.ativo ? (
                          <ConfirmActionButton
                            action={definirAtivoItemCatalogo}
                            fields={{ catalogo_item_id: item.id, ativo: "0" }}
                            trigger={<IconeAcao icone={Archive} rotulo={`Arquivar ${item.descricao}`} />}
                            titulo="Arquivar item do catálogo"
                            mensagem={`Arquivar ${item.descricao}? O item deixa de ser sugerido para novos orçamentos, sem apagar histórico.`}
                            confirmLabel="Arquivar"
                            triggerClassName={CLASSE_BOTAO_ICONE_PERIGO}
                          />
                        ) : (
                          <ConfirmActionButton
                            action={definirAtivoItemCatalogo}
                            fields={{ catalogo_item_id: item.id, ativo: "1" }}
                            trigger={<IconeAcao icone={ArchiveRestore} rotulo={`Reativar ${item.descricao}`} />}
                            titulo="Reativar item do catálogo"
                            mensagem={`Reativar ${item.descricao}? O item volta a ser sugerido nos orçamentos de projeto.`}
                            confirmLabel="Reativar"
                            destrutivo={false}
                            triggerClassName={CLASSE_BOTAO_ICONE}
                          />
                        ))}
                        {!item.ativo && !podeEditarCatalogo && <Badge tom="zinc">Arquivado</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
                {catalogoFiltrado.length === 0 && (
                  <tr>
                    <td colSpan={mostrarRubrica ? 9 : 8} className="px-3 py-2 text-muted-foreground/80">Nenhum item de catálogo encontrado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

const campoCls = "h-9 rounded-md border border-input bg-card px-3 text-sm";

const inputCls =
  "mt-1 w-full rounded-md border border-input bg-card px-2 py-2 text-sm";

const cabecalhoTabela = "whitespace-nowrap bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground";

/** Endereço da página com os filtros dados (vazios ficam de fora). */
function hrefModelos(filtros: SearchParams) {
  const params = new URLSearchParams(
    Object.entries(filtros).filter((entrada): entrada is [string, string] => Boolean(entrada[1])),
  );
  const consulta = params.toString();
  return consulta ? `/orcamento/modelos?${consulta}` : "/orcamento/modelos";
}

/** Mesmo endereço, com a rubrica trocada e os demais filtros preservados (fecha o histórico). */
function hrefRubrica(filtros: SearchParams, rubrica: string | undefined) {
  return hrefModelos({ ...filtros, rubrica, historico: undefined });
}

/** Abre (ou fecha, com `undefined`) o painel de histórico de um item, preservando os filtros. */
function hrefHistorico(filtros: SearchParams, id: string | undefined) {
  return `${hrefModelos({ ...filtros, historico: id })}#catalogo`;
}

/** Data do valor atual: a da última atualização (0137) ou a da carga. */
function dataDoValor(item: CatalogoItem) {
  return item.valor_atualizado_em ?? item.valid_from;
}

function filtrarTemplates(templates: TemplateProjeto[], filtros: SearchParams) {
  const busca = (filtros.busca ?? "").toLocaleLowerCase("pt-BR");
  return templates.filter((template) => {
    const texto = `${template.nome} ${template.descricao ?? ""}`.toLocaleLowerCase("pt-BR");
    return (
      (!busca || texto.includes(busca)) &&
      (!filtros.origem || template.origem === filtros.origem) &&
      (!filtros.status ||
        (filtros.status === "arquivado" ? isArquivado(template) : filtros.status === "ativo" ? !isArquivado(template) : true))
    );
  });
}

function filtrarCatalogo(catalogo: CatalogoItem[], filtros: SearchParams) {
  const busca = (filtros.busca ?? "").toLocaleLowerCase("pt-BR");
  return catalogo.filter((item) => {
    const texto = `${item.id} ${item.descricao} ${item.categoria ?? ""}`.toLocaleLowerCase("pt-BR");
    return (
      (!busca || texto.includes(busca)) &&
      (!filtros.rubrica || item.rubrica === filtros.rubrica) &&
      (!filtros.origem || item.origem === filtros.origem) &&
      (!filtros.status ||
        (filtros.status === "ativo" ? item.ativo : filtros.status === "inativo" || filtros.status === "arquivado" ? !item.ativo : true)) &&
      (!filtros.velho || (item.ativo && valorDesatualizado(dataDoValor(item))))
    );
  });
}

function isArquivado(template: TemplateProjeto) {
  return template.nome.startsWith("[ARQUIVADO]") || Boolean(template.descricao?.includes("Arquivado em "));
}

function nomeVisivel(nome: string) {
  return nome.replace(/^\[ARQUIVADO\]\s*/i, "");
}

function contarItens(itens: Json) {
  return Array.isArray(itens) ? itens.length : 0;
}

function resumoParametros(parametros: Json) {
  if (!parametros || typeof parametros !== "object" || Array.isArray(parametros)) return "sem parâmetros";
  const record = parametros as Record<string, unknown>;
  const pares = [
    ["meses", record.project_months],
    ["impostos", record.impostos_legacy],
    ["incubação", record.incubacao],
    ["reserva", record.reserva],
    ["invest.", record.investimentos],
    ["lucro", record.lucro],
  ].filter(([, value]) => value !== undefined && value !== null);
  return pares.length ? pares.map(([label, value]) => `${label}: ${String(value)}`).join(" · ") : "sem parâmetros";
}

function resumirParametrosPadrao(templates: TemplateProjeto[]) {
  const ativos = templates.filter((template) => !isArquivado(template));
  const media = (key: string) => {
    const valores = ativos
      .map((template) => jsonRecord(template.parametros))
      .filter((parametros) => parametros !== null)
      .map((parametros) => Number(parametros[key] ?? 0));
    if (!valores.length) return "—";
    return (valores.reduce((total, valor) => total + valor, 0) / valores.length).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  };
  return [
    { label: "Meses", valor: media("project_months") },
    { label: "Impostos", valor: percentual(media("impostos_legacy")) },
    { label: "Incubação", valor: percentual(media("incubacao")) },
    { label: "Reserva", valor: percentual(media("reserva")) },
    { label: "Investimentos", valor: percentual(media("investimentos")) },
    { label: "Lucro", valor: percentual(media("lucro")) },
  ];
}

/** Sem templates ativos a média é "—": o símbolo de % só acompanha número. */
function percentual(valor: string) {
  return valor === "—" ? valor : `${valor}%`;
}

function jsonRecord(value: Json): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function Numero({ valor }: { valor: number }) {
  return <b className="font-semibold tabular-nums text-foreground">{valor.toLocaleString("pt-BR")}</b>;
}

/** Cabeçalho de bloco em uma linha: título, explicação curta e extras ao lado. */
function Cabecalho({
  id,
  titulo,
  subtitulo,
  extra,
  semBorda = false,
}: {
  id: string;
  titulo: string;
  subtitulo?: string;
  extra?: ReactNode;
  semBorda?: boolean;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 ${semBorda ? "" : "border-b border-border"}`}>
      <div className="flex items-center gap-0.5">
        <h2 id={id} className="text-sm font-semibold">{titulo}</h2>
        {subtitulo && <HelpTip title={titulo}><p>{subtitulo}</p></HelpTip>}
      </div>
      {extra}
    </div>
  );
}

/** Bloco-resumo numa faixa: título à esquerda e os valores em linha. */
function FaixaResumo({
  id,
  titulo,
  ajuda,
  itens,
}: {
  id: string;
  titulo: string;
  ajuda: ReactNode;
  itens: Array<[string, string]>;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      className="flex scroll-mt-8 flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 shadow-sm"
    >
      <div className="flex items-center gap-0.5">
        <h2 id={`${id}-titulo`} className="text-sm font-semibold">{titulo}</h2>
        {ajuda}
      </div>
      <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
        {itens.map(([rotulo, valor]) => (
          <div key={rotulo} className="flex items-baseline gap-1">
            <dt className="text-xs text-muted-foreground">{rotulo}</dt>
            <dd className="font-semibold tabular-nums">{valor}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function AbaRubrica({ href, ativa, rotulo, total }: { href: string; ativa: boolean; rotulo: string; total: number }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={ativa ? "page" : undefined}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-1.5 text-sm transition-colors ${
        ativa
          ? "border-brand-600 font-medium text-brand-800 dark:border-brand-400 dark:text-brand-200"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {rotulo}
      <span className="text-xs tabular-nums text-muted-foreground">{total.toLocaleString("pt-BR")}</span>
    </Link>
  );
}

function CampoFiltro({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function Origem({ origem }: { origem: string | null }) {
  if (origem === "orcamento_projetos_antigo") return <Badge tom="amber">Importada</Badge>;
  if (origem === "revisao_custos") return <Badge tom="brand">Orçamento</Badge>;
  if (origem === "cadastro_catalogo") return <Badge tom="brand">Cadastro</Badge>;
  return <Badge tom="brand">Kontrol</Badge>;
}

function Badge({ children, tom = "zinc" }: { children: React.ReactNode; tom?: "brand" | "amber" | "zinc" }) {
  const cls =
    tom === "brand"
      ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300"
      : tom === "amber"
        ? "bg-warning-soft text-warning-strong"
        : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}
