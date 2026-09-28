import Link from "next/link";
import type { ReactNode } from "react";

import { HelpTip } from "@/components/common/HelpTip";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime } from "@/lib/formatters";
import { createClient } from "@/lib/supabase/server";
import { usuarioAtual } from "@/lib/auth/roles";
import { pode, podeVerSalario } from "@/lib/auth/permissao-efetiva";
import { mascararAuditoriaSigilosa } from "@/lib/cadastros/salario";
import { LABEL_PAPEL, PERMISSOES_ORCAMENTO } from "@/lib/orcamento/governanca";
import { agruparAlteracoesSeguidas, type GrupoAuditoria } from "@/lib/orcamento/auditoria-resumo";
import { PERMISSOES } from "@/lib/auth/permissions";

function rotuloPermissao(chave: string) {
  const permissao = PERMISSOES.find((item) => item.key === chave);
  return permissao ? `${permissao.modulo}: ${permissao.label}` : chave;
}

export const dynamic = "force-dynamic";

const ENTIDADES_ORCAMENTO = [
  "orcamento",
  "orcamento_projeto",
  "orcamento_final",
  "orcamento_parametros",
  "orcamento_template",
  "orcamento_catalogo",
];

const LABEL_ENTIDADE: Record<string, string> = {
  orcamento: "Laboratório",
  orcamento_projeto: "Projeto",
  orcamento_final: "Final",
  orcamento_parametros: "Parâmetros",
  orcamento_template: "Template",
  orcamento_catalogo: "Catálogo",
};

const TABELAS_ORCAMENTO = [
  "demandas_propostas",
  "orcamentos",
  "orcamento_itens",
  "orcamento_projetos",
  "orcamento_projeto_custos",
  "orcamento_projeto_analises",
  "orcamento_final_versoes",
  "parametros",
  "parametros_economicos_versoes",
  "orcamento_projeto_templates",
  "orcamento_projeto_catalogo",
];

const LABEL_ACAO: Record<string, string> = {
  insert: "Criou",
  update: "Alterou",
  delete: "Removeu",
};

const IGNORAR_DIFF = new Set(["criado_em", "atualizado_em", "status_operacional_atualizado_em"]);

/** Quantos itens cada lista mostra de início; o restante fica em "Ver mais". */
const VISIVEIS = 10;

type Evento = {
  id: number;
  entidade: string;
  entidade_id: number;
  de_status: string | null;
  para_status: string;
  usuario: string | null;
  observacao: string | null;
  criado_em: string;
};

type Auditoria = {
  id: number;
  tabela: string;
  registro_id: string | null;
  acao: string;
  usuario: string | null;
  valor_anterior: Record<string, unknown> | null;
  valor_novo: Record<string, unknown> | null;
  criado_em: string;
};

export default async function GovernancaOrcamentoPage() {
  const permitido = await pode("auditoria.visualizar");
  const usuario = await usuarioAtual();

  if (!permitido) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-center font-sans">
        <p className="text-sm text-muted-foreground">
          Acesso restrito. A governança de Orçamentos é visível para gestor ou admin.
        </p>
        <Link href="/orcamento" className={buttonVariants({ variant: "outline", className: "mt-4" })}>
          Voltar para Orçamentos
        </Link>
      </main>
    );
  }

  const supabase = await createClient();
  const [{ data: eventos }, { data: auditorias }] = await Promise.all([
    supabase
      .from("eventos_status")
      .select("id, entidade, entidade_id, de_status, para_status, usuario, observacao, criado_em")
      .in("entidade", ENTIDADES_ORCAMENTO)
      .order("criado_em", { ascending: false })
      .limit(80),
    supabase
      .from("auditoria")
      .select("id, tabela, registro_id, acao, usuario, valor_anterior, valor_novo, criado_em")
      .in("tabela", TABELAS_ORCAMENTO)
      .order("id", { ascending: false })
      .limit(80),
  ]);

  const eventosRecentes = (eventos ?? []) as Evento[];
  // Preço PE do catálogo: escondido pela policy da 0112 e mascarado aqui também.
  const podeVerSalarios = await podeVerSalario();
  const auditoriaRecente = ((auditorias ?? []) as Auditoria[]).map((item) =>
    mascararAuditoriaSigilosa(item, podeVerSalarios),
  );
  // Autosaves gravam várias vezes o mesmo registro em segundos: uma linha por sequência.
  const gruposAuditoria = agruparAlteracoesSeguidas(auditoriaRecente, IGNORAR_DIFF);
  const eventosComMotivo = eventosRecentes.filter((evento) => Boolean(evento.observacao?.trim())).length;
  const acoesCriticas = eventosRecentes.filter((evento) =>
    ["cancelado", "alterado", "duplicado"].includes(evento.para_status) || evento.entidade === "orcamento_final",
  ).length;

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
              Orçamentos
            </p>
            <div className="flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Governança e permissões</h1>
              <HelpTip title="Governança e permissões">
                <p>Mostra <b>quem pode fazer</b> cada ação sensível do orçamento e o registro de cada mudança, para reconstruir a origem de qualquer valor final.</p>
                <p><b>Críticas</b> são cancelamentos, alterações, duplicações e ações sobre propostas emitidas; <b>Com motivo</b> são eventos registrados com justificativa.</p>
              </HelpTip>
            </div>
            {/* resumo em uma linha (28/09), no lugar de quatro cartões */}
            <p className="mt-0.5 text-sm text-muted-foreground">
              <Numero valor={PERMISSOES_ORCAMENTO.length} /> ações governadas
              {" · "}<Numero valor={eventosRecentes.length} /> eventos recentes
              {" · "}<Numero valor={eventosComMotivo} /> com motivo
              {" · "}<Numero valor={acoesCriticas} /> {acoesCriticas === 1 ? "crítica" : "críticas"}
            </p>
          </div>
          <p className="rounded-md border border-border bg-card px-3 py-1.5 text-sm shadow-sm">
            <span className="text-xs text-muted-foreground">Sessão atual: </span>
            <strong className="font-semibold">{usuario?.nome || usuario?.email || "Usuário autenticado"}</strong>
            <span className="text-muted-foreground"> · {usuario?.papel ? LABEL_PAPEL[usuario.papel] : "Técnico"}</span>
          </p>
        </div>

        <section aria-labelledby="matriz-titulo" className="mt-4 rounded-lg border border-border bg-card shadow-sm">
          <CabecalhoPainel
            id="matriz-titulo"
            titulo="Matriz operacional"
            subtitulo="Ações sensíveis, papel mínimo, motivo e evidência auditável."
            ajuda={
              <HelpTip title="Como a regra é aplicada" className="h-6 w-6">
                <p>Cada ação é <b>conferida na ação do servidor e no banco</b>: esconder um botão na tela não basta para liberar ou bloquear.</p>
                <p><b>Quem pode</b>: quem tiver a permissão indicada em Usuários. Ela vem marcada por padrão para o papel mínimo e os papéis acima dele.</p>
              </HelpTip>
            }
          />
          <div tabIndex={0} aria-label="Matriz operacional" className="overflow-x-auto">
            <table className="w-full min-w-[46rem] table-fixed text-sm">
              <colgroup>
                <col className="w-[37%]" />
                <col className="w-[27%]" />
                <col className="w-[8.75rem]" />
                <col />
              </colgroup>
              <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Ação</th>
                  <th className="px-3 py-1.5 font-medium">Quem pode</th>
                  <th className="px-3 py-1.5 font-medium">Motivo</th>
                  <th className="px-3 py-1.5 font-medium">Evidência</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {PERMISSOES_ORCAMENTO.map((permissao) => {
                  const quemPode = permissao.chave
                    ? rotuloPermissao(permissao.chave)
                    : `${LABEL_PAPEL[permissao.papelMinimo]} ou superior`;
                  return (
                    <tr key={permissao.acao} className="align-top">
                      <td className="px-3 py-1.5">
                        <span className="block font-medium">{permissao.titulo}</span>
                        <span className="block truncate text-xs text-muted-foreground" title={permissao.descricao}>
                          {permissao.descricao}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="block truncate" title={permissao.chave ? `Quem tiver “${quemPode}”` : quemPode}>
                          {quemPode}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Padrão: {LABEL_PAPEL[permissao.papelMinimo].toLowerCase()} e acima
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                            permissao.motivoObrigatorio ? "bg-warning-soft text-warning-strong" : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {permissao.motivoObrigatorio ? "Obrigatório" : "Quando aplicável"}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">{permissao.eventoAuditavel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-4 grid items-start gap-4 xl:grid-cols-2">
          <Painel titulo="Eventos sensíveis" total={eventosRecentes.length}>
            {eventosRecentes.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum evento de orçamento encontrado.</p>
            ) : (
              <ListaComMais itens={eventosRecentes} chave={(evento) => evento.id} render={(evento) => <LinhaEvento evento={evento} />} />
            )}
          </Painel>

          <Painel
            titulo="Auditoria por campo"
            total={auditoriaRecente.length}
            ajuda={
              <HelpTip title="Auditoria por campo" className="h-6 w-6">
                <p>Cada gravação nas tabelas de orçamento, com o <b>valor anterior → novo</b> dos campos alterados. Gravações seguidas do mesmo registro, pela mesma pessoa e nos mesmos campos, aparecem juntas numa linha.</p>
              </HelpTip>
            }
          >
            {gruposAuditoria.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">Nenhuma alteração auditada nas tabelas de orçamento.</p>
            ) : (
              <ListaComMais itens={gruposAuditoria} chave={(grupo) => grupo.maisRecente.id} render={(grupo) => <LinhaAuditoria grupo={grupo} />} />
            )}
          </Painel>
        </section>
      </main>
    </div>
  );
}

function Numero({ valor }: { valor: number }) {
  return <b className="font-semibold tabular-nums text-foreground">{valor.toLocaleString("pt-BR")}</b>;
}

function CabecalhoPainel({
  id,
  titulo,
  subtitulo,
  ajuda,
  extra,
}: {
  id?: string;
  titulo: string;
  subtitulo?: string;
  ajuda?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border px-3 py-2">
      <div className="flex items-center gap-0.5">
        <h2 id={id} className="text-sm font-semibold">{titulo}</h2>
        {ajuda ?? (subtitulo ? <HelpTip title={titulo}><p>{subtitulo}</p></HelpTip> : null)}
      </div>
      {extra}
    </div>
  );
}

function Painel({
  titulo,
  total,
  ajuda,
  children,
}: {
  titulo: string;
  total: number;
  ajuda?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <CabecalhoPainel
        titulo={titulo}
        ajuda={ajuda}
        extra={total > 0 && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{total.toLocaleString("pt-BR")} {total === 1 ? "registro" : "registros"}</span>}
      />
      {children}
    </section>
  );
}

/** Mostra os primeiros itens; o restante abre em "Ver mais", sem sair da página. */
function ListaComMais<T>({
  itens,
  chave,
  render,
}: {
  itens: T[];
  chave: (item: T) => number;
  render: (item: T) => ReactNode;
}) {
  const primeiros = itens.slice(0, VISIVEIS);
  const resto = itens.slice(VISIVEIS);
  return (
    <>
      <ul className="divide-y divide-border/70">
        {primeiros.map((item) => <li key={chave(item)}>{render(item)}</li>)}
      </ul>
      {resto.length > 0 && (
        <details className="group border-t border-border">
          <summary className="flex cursor-pointer list-none items-center px-3 py-1.5 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Ver mais ({resto.length})</span>
            <span className="hidden group-open:inline">Ver menos</span>
          </summary>
          <ul className="divide-y divide-border/70 border-t border-border/70">
            {resto.map((item) => <li key={chave(item)}>{render(item)}</li>)}
          </ul>
        </details>
      )}
    </>
  );
}

/** Data | o que aconteceu (e o detalhe na linha de baixo) | quem fez. */
function LinhaRegistro({
  data,
  titulo,
  tituloTexto,
  detalhe,
  usuario,
}: {
  data: string;
  titulo: ReactNode;
  /** Versão em texto do título, para a dica quando ele é cortado. */
  tituloTexto: string;
  detalhe?: string | null;
  usuario: string | null;
}) {
  return (
    <div className="grid gap-x-3 px-3 py-1.5 text-sm sm:grid-cols-[7.25rem_minmax(0,1fr)] sm:items-baseline">
      <span className="text-xs tabular-nums text-muted-foreground">{data}</span>
      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          <p className="min-w-0 flex-1 truncate" title={tituloTexto}>{titulo}</p>
          <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground" title={usuario ?? undefined}>
            {usuario || "Sem usuário"}
          </span>
        </div>
        {detalhe && (
          <p className="truncate text-xs text-muted-foreground" title={detalhe}>
            {detalhe}
          </p>
        )}
      </div>
    </div>
  );
}

function LinhaEvento({ evento }: { evento: Evento }) {
  return (
    <LinhaRegistro
      data={formatDateTime(evento.criado_em)}
      titulo={
        <>
          <strong className="font-semibold">{LABEL_ENTIDADE[evento.entidade] ?? evento.entidade}</strong>
          <span className="text-muted-foreground"> #{evento.entidade_id}</span>
          <span className="text-muted-foreground"> · {evento.de_status || "novo"} → {evento.para_status}</span>
        </>
      }
      tituloTexto={`${LABEL_ENTIDADE[evento.entidade] ?? evento.entidade} #${evento.entidade_id} · ${evento.de_status || "novo"} → ${evento.para_status}`}
      detalhe={evento.observacao}
      usuario={evento.usuario}
    />
  );
}

function LinhaAuditoria({ grupo }: { grupo: GrupoAuditoria<Auditoria> }) {
  const item = grupo.maisRecente;
  return (
    <LinhaRegistro
      data={formatDateTime(item.criado_em)}
      titulo={
        <>
          <strong className="font-semibold">{LABEL_ACAO[item.acao] ?? item.acao}</strong>
          <span className="text-muted-foreground"> {item.tabela} #{item.registro_id ?? "-"}</span>
          {grupo.itens.length > 1 && (
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {periodoDoGrupo(grupo)}
            </span>
          )}
        </>
      }
      tituloTexto={[`${LABEL_ACAO[item.acao] ?? item.acao} ${item.tabela} #${item.registro_id ?? "-"}`, grupo.itens.length > 1 ? periodoDoGrupo(grupo) : null].filter(Boolean).join(" · ")}
      detalhe={grupo.resumo}
      usuario={item.usuario}
    />
  );
}

/** "6 alterações seguidas" no mesmo minuto; senão, o intervalo entre a primeira e a última. */
function periodoDoGrupo(grupo: GrupoAuditoria<Auditoria>) {
  const quantidade = `${grupo.itens.length} alterações`;
  const inicio = formatDateTime(grupo.maisAntiga.criado_em);
  const fim = formatDateTime(grupo.maisRecente.criado_em);
  if (inicio === fim) return `${quantidade} seguidas`;
  const [diaInicio, horaInicio] = inicio.split(", ");
  const [diaFim, horaFim] = fim.split(", ");
  return diaInicio === diaFim && horaInicio && horaFim
    ? `${quantidade} entre ${horaInicio} e ${horaFim}`
    : `${quantidade} entre ${inicio} e ${fim}`;
}
