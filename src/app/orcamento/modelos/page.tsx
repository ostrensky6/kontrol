import Link from "next/link";

import { ConfirmActionButton } from "@/components/common/ConfirmActionButton";
import { SubmitButton } from "@/components/common/SubmitButton";
import { HelpTip } from "@/components/common/HelpTip";
import {
  arquivarCatalogoProjetoItem,
  criarProjetoDeTemplate,
  duplicarTemplateProjeto,
  excluirTemplate,
} from "@/lib/actions/orcamento-projetos";
import { formatCurrency as brl, formatDate } from "@/lib/formatters";
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
};

type ProjetoOpcao = {
  id: number;
  nome: string;
};

const rubricas = ["PE", "MC", "MP", "ST", "VD", "OU"] as const;

export default async function OrcamentoModelosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filtros = await searchParams;
  const supabase = await createClient();
  const [{ data: templates }, { data: catalogoCompleto }, { data: projetos }] = await Promise.all([
    supabase
      .from("orcamento_projeto_templates")
      .select("id, nome, descricao, itens, parametros, origem, criado_em")
      .order("criado_em", { ascending: false }),
    // Preço de PE (pessoas nominais) vem mascarado (NULL) do banco para quem
    // não tem "Ver salário dos técnicos" — migration 0112. Já vem ordenado.
    supabase.rpc("orcamento_projeto_catalogo_listar"),
    supabase.from("projetos").select("id, nome").order("nome").limit(100),
  ]);
  const catalogo = ((catalogoCompleto ?? []) as CatalogoItem[]).slice(0, 300);

  const templatesFiltrados = filtrarTemplates((templates ?? []) as TemplateProjeto[], filtros);
  const catalogoFiltrado = filtrarCatalogo((catalogo ?? []) as CatalogoItem[], filtros);
  const templatesAtivos = ((templates ?? []) as TemplateProjeto[]).filter((item) => !isArquivado(item)).length;
  const templatesArquivados = ((templates ?? []) as TemplateProjeto[]).filter(isArquivado).length;
  const itensAtivos = ((catalogo ?? []) as CatalogoItem[]).filter((item) => item.ativo).length;
  const importados = ((catalogo ?? []) as CatalogoItem[]).filter((item) => item.origem === "orcamento_projetos_antigo").length;
  const parametrosPadrao = resumirParametrosPadrao((templates ?? []) as TemplateProjeto[]);

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/orcamento" className="text-xs text-muted-foreground hover:underline">Orçamentos</Link>
            <div className="mt-2 flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Modelos e catálogo</h1>
              <HelpTip title="Modelos e catálogo">
                <p>Base reutilizável para montar orçamentos de projeto: <b>modelos</b> com itens prontos, o <b>catálogo institucional</b> de custos por rubrica e os parâmetros padrão.</p>
                <p>Nada é apagado: itens fora de uso são arquivados e continuam no histórico.</p>
              </HelpTip>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {USO_DIRETO_DE_TEMPLATE && (
              <Link href="/orcamento/projetos" className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500">
                Usar em orçamento
              </Link>
            )}
            <Link href="/orcamento" className="rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-muted">
              Orçamentos
            </Link>
          </div>
        </div>

        <nav className="mt-5 flex gap-2 overflow-x-auto text-sm">
          {[
            ["#templates", "Templates"],
            ["#catalogo", "Catálogo institucional"],
            ["#parametros", "Parâmetros padrão"],
            ["#importados", "Origem importada"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-md border border-border px-3 py-2 font-medium hover:bg-muted">
              {label}
            </a>
          ))}
        </nav>

        <section className="mt-6 grid gap-3 sm:grid-cols-4">
          <Resumo titulo="Templates ativos" valor={templatesAtivos.toLocaleString("pt-BR")} />
          <Resumo titulo="Templates arquivados" valor={templatesArquivados.toLocaleString("pt-BR")} />
          <Resumo titulo="Itens ativos" valor={itensAtivos.toLocaleString("pt-BR")} />
          <Resumo titulo="Origem importada" valor={importados.toLocaleString("pt-BR")} />
        </section>

        <form className="mt-6 rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[1fr_10rem_12rem_10rem_auto_auto] md:items-end">
            <CampoFiltro label="Busca">
              <input name="busca" defaultValue={filtros.busca ?? ""} className={inputCls} />
            </CampoFiltro>
            <CampoFiltro label="Rubrica">
              <select name="rubrica" defaultValue={filtros.rubrica ?? ""} className={inputCls}>
                <option value="">Todas</option>
                {rubricas.map((rubrica) => <option key={rubrica} value={rubrica}>{rubrica}</option>)}
              </select>
            </CampoFiltro>
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
            <button className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500">Filtrar</button>
            <Link href="/orcamento/modelos" className="rounded-md border border-input px-3 py-2 text-sm font-medium text-center hover:bg-muted">
              Limpar
            </Link>
          </div>
        </form>

        <section id="templates" className="mt-6 scroll-mt-8 rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Templates de projeto</h2>
              <p className="mt-1 text-xs text-muted-foreground">Duplique ou arquive modelos. Usar em orçamento: em breve.</p>
            </div>
            {USO_DIRETO_DE_TEMPLATE && <Link href="/orcamento/projetos" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">Criar a partir de template</Link>}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2">Origem</th>
                  <th className="px-3 py-2 text-right">Itens</th>
                  <th className="px-3 py-2">Parâmetros</th>
                  <th className="px-3 py-2">Criado em</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {templatesFiltrados.map((template) => (
                  <tr key={template.id}>
                    <td className="px-3 py-3 font-medium">{nomeVisivel(template.nome)}</td>
                    <td className="px-3 py-3 text-muted-foreground">{template.descricao ?? "—"}</td>
                    <td className="px-3 py-3"><Origem origem={template.origem} /></td>
                    <td className="px-3 py-3 text-right tabular-nums">{contarItens(template.itens)}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{resumoParametros(template.parametros)}</td>
                    <td className="px-3 py-3 text-muted-foreground">{formatDate(template.criado_em)}</td>
                    <td className="px-3 py-3">{isArquivado(template) ? <Badge tom="zinc">Arquivado</Badge> : <Badge tom="brand">Ativo</Badge>}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
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
                          <SubmitButton variant="link" size="sm" className="h-auto p-0 text-xs font-medium text-brand-700 dark:text-brand-300" pendingLabel="Duplicando…">Duplicar</SubmitButton>
                        </form>
                        {!isArquivado(template) && (
                          <ConfirmActionButton
                            action={excluirTemplate}
                            fields={{ template_id: template.id }}
                            trigger="Arquivar"
                            titulo="Arquivar template"
                            mensagem={`Arquivar o template ${nomeVisivel(template.nome)}? Ele deixa de ser oferecido como ativo, mas o registro permanece no histórico.`}
                            confirmLabel="Arquivar"
                            triggerClassName="text-xs font-medium text-danger-strong hover:underline"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {templatesFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground/80">Nenhum template encontrado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section id="catalogo" className="mt-6 scroll-mt-8 rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Catálogo institucional de custos</h2>
          <p className="mt-1 text-xs text-muted-foreground">Itens reutilizáveis por rubrica, com origem auditável e arquivamento sem remoção.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Rubrica</th>
                  <th className="px-3 py-2">Categoria institucional</th>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2">Unidade</th>
                  <th className="px-3 py-2 text-right">Custo padrão</th>
                  <th className="px-3 py-2">Origem</th>
                  <th className="px-3 py-2">Válido desde</th>
                  <th className="px-3 py-2">Ativo</th>
                  <th className="px-3 py-2 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {catalogoFiltrado.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-3 font-medium">{item.id}</td>
                    <td className="px-3 py-3"><Badge>{item.rubrica}</Badge></td>
                    <td className="px-3 py-3">{item.categoria ?? "—"}</td>
                    <td className="px-3 py-3">{item.descricao}</td>
                    <td className="px-3 py-3">{item.unidade ?? "un"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {precoCatalogoMascarado(item) ? (
                        <span title={NOTA_VALOR_MASCARADO}>
                          {VALOR_MASCARADO}
                          <span className="sr-only"> — {NOTA_VALOR_MASCARADO}</span>
                        </span>
                      ) : (
                        brl(Number(item.preco_unitario ?? 0))
                      )}
                    </td>
                    <td className="px-3 py-3"><Origem origem={item.origem} /></td>
                    <td className="px-3 py-3 text-muted-foreground">{formatDate(item.valid_from)}</td>
                    <td className="px-3 py-3">{item.ativo ? <Badge tom="brand">Sim</Badge> : <Badge tom="zinc">Não</Badge>}</td>
                    <td className="px-3 py-3 text-right">
                      {item.ativo ? (
                        <ConfirmActionButton
                          action={arquivarCatalogoProjetoItem}
                          fields={{ catalogo_item_id: item.id }}
                          trigger="Arquivar"
                          titulo="Arquivar item do catálogo"
                          mensagem={`Arquivar ${item.descricao}? O item deixa de ser sugerido para novos orçamentos, sem apagar histórico.`}
                          confirmLabel="Arquivar"
                          triggerClassName="text-xs font-medium text-danger-strong hover:underline"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground/80">Arquivado</span>
                      )}
                    </td>
                  </tr>
                ))}
                {catalogoFiltrado.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground/80">Nenhum item de catálogo encontrado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section id="parametros" className="mt-6 scroll-mt-8 rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Parâmetros padrão em templates</h2>
          <p className="mt-1 text-xs text-muted-foreground">Leitura consolidada dos parâmetros salvos nos modelos reutilizáveis.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-6">
            {parametrosPadrao.map((item) => (
              <Resumo key={item.label} titulo={item.label} valor={item.valor} />
            ))}
          </div>
        </section>

        <section id="importados" className="mt-6 scroll-mt-8 rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1">
            <h2 className="text-sm font-semibold">Importados do app antigo</h2>
            <HelpTip title="Importados do app antigo">
              <p>Itens trazidos do sistema anterior de orçamento. A origem fica registrada para <b>auditoria</b>; no dia a dia, use o <b>catálogo institucional</b>.</p>
            </HelpTip>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            {rubricas.map((rubrica) => {
              const itens = ((catalogo ?? []) as CatalogoItem[]).filter((item) => item.origem === "orcamento_projetos_antigo" && item.rubrica === rubrica);
              return <Resumo key={rubrica} titulo={`${rubrica} importados`} valor={itens.length.toLocaleString("pt-BR")} />;
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

const inputCls =
  "mt-1 w-full rounded-md border border-input bg-card px-2 py-2 text-sm";

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
        (filtros.status === "ativo" ? item.ativo : filtros.status === "inativo" || filtros.status === "arquivado" ? !item.ativo : true))
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
    { label: "Impostos", valor: `${media("impostos_legacy")}%` },
    { label: "Incubação", valor: `${media("incubacao")}%` },
    { label: "Reserva", valor: `${media("reserva")}%` },
    { label: "Investimentos", valor: `${media("investimentos")}%` },
    { label: "Lucro", valor: `${media("lucro")}%` },
  ];
}

function jsonRecord(value: Json): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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

function Resumo({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
