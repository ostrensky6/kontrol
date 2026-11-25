import Link from "next/link";
import { createClient, createClientUntyped } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { HelpTip } from "@/components/common/HelpTip";
import { PlanoLinhaAcoes } from "@/components/planejamento/PlanoGestao";
import { pode } from "@/lib/auth/permissao-efetiva";
import { avaliarGestaoPlano } from "@/lib/planejamento/gestao";
import { criarResolvedorDeTaxas, valorLaboratorioNaProposta, valorProjetoNaProposta } from "@/lib/orcamento/valores-modulos";
import { formatCurrency as moeda, formatDate as fmtData } from "@/lib/formatters";
import { rotuloStatusOrcamento } from "@/lib/orcamento/rotulos-status";
import { STATUS_PROJETO } from "../_lib/status";
import { coordenadorDoProjeto, responsavelDoProjeto, type UsuarioCoordenador } from "../_lib/responsavel";
import { temPapel } from "@/lib/auth/roles";
import { VinculosProjeto, type VinculoPessoa } from "@/components/projetos/VinculosProjeto";
import { AvisoLeitura } from "@/components/common/AvisoLeitura";
import { novaLeitura, semRegistro } from "@/lib/supabase/leitura";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EtapaProgresso } from "@/components/pedido/EtapaProgresso";
import { etapaDoPedido } from "@/lib/pedido/etapas";
import { pedidoInternoNumero, pedidoInternoStatus } from "@/lib/pedido/status";

export const dynamic = "force-dynamic";

const STATUS_ORC: Record<string, { label: string; cls: string }> = {
  rascunho: { label: "Rascunho", cls: "bg-warning-soft text-warning-strong" },
  enviado: { label: "Enviado", cls: "bg-info-soft text-info-strong" },
  aprovado: { label: "Aprovado", cls: "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" },
  recusado: { label: "Recusado", cls: "bg-muted text-muted-foreground" },
};

const ROTULO_TIPO_ORC: Record<string, string> = {
  analises: "Análises de laboratório",
  projeto: "Custos do projeto",
};

const STATUS_COMPRA: Record<string, { label: string; cls: string }> = {
  solicitado: { label: "Solicitado", cls: "bg-warning-soft text-warning-strong" },
  aprovado: { label: "Aprovado", cls: "bg-info-soft text-info-strong" },
  enviado: { label: "Enviado", cls: "bg-info-soft text-info-strong" },
  em_transito: { label: "Em trânsito", cls: "bg-info-soft text-info-strong" },
  recebido: { label: "Recebido", cls: "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" },
  cancelado: { label: "Cancelado", cls: "bg-muted text-muted-foreground" },
};

function Badge({ map, status }: { map: Record<string, { label: string; cls: string }>; status: string }) {
  const s = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>
      {s.label}
    </span>
  );
}

function Kpi({
  label,
  valor,
  hint,
  ajuda,
}: {
  label: string;
  valor: string;
  hint?: string;
  ajuda?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3 shadow-sm sm:p-4">
      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">{label}{ajuda}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight text-foreground tabular-nums sm:text-xl">{valor}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

const cardCls =
  "rounded-lg border border-border bg-card shadow-sm";

export default async function ProjetoHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const leitura = novaLeitura("/projetos/[id]");
  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) semRegistro(leitura);

  const supabase = await createClient();

  const { data: projeto } = await leitura.de("projetos", supabase
    .from("projetos")
    .select("id, nome, cliente_id, responsavel, coordenador, coordenador_nome, status, data_inicio, data_fim, descricao")
    .eq("id", id)
    .single());

  if (!projeto) semRegistro(leitura);

  // quem aprova os pedidos do projeto é o usuário indicado como coordenador (0136/0169)
  // (coordenador_id ainda não está nos tipos gerados: lido à parte)
  const { data: linhaCoordenador } = await (await createClientUntyped())
    .from("projetos")
    .select("coordenador_id")
    .eq("id", id)
    .maybeSingle();
  const coordenadorId = (linhaCoordenador as { coordenador_id: string | null } | null)?.coordenador_id ?? null;
  const { data: usuarioCoordenador } = coordenadorId
    ? await leitura.de("pessoas", supabase.from("perfis").select("id, nome, email, suspenso").eq("id", coordenadorId))
    : { data: [] };
  const coordenador = coordenadorDoProjeto(
    { ...projeto, coordenador_id: coordenadorId },
    (usuarioCoordenador ?? []) as UsuarioCoordenador[],
  );
  const escrito = responsavelDoProjeto(projeto);

  // 0160: só o Admin vê e altera quem atua no projeto.
  const ehAdmin = await temPapel("admin");
  const vinculos = ehAdmin
    ? (((await leitura.de("pessoas do projeto", supabase.rpc("vinculos_projeto" as never, { p_projeto_id: id } as never))).data ?? []) as VinculoPessoa[])
    : null;

  const [
    { data: cliente },
    { data: orcamentos },
    { data: orcProjetos },
    { data: planos },
    { data: compras },
    { data: demandas },
    { data: fornecedores },
    { data: parametrosGlobais },
    { data: pedidosInternos },
  ] = await Promise.all([
    projeto.cliente_id != null
      ? leitura.de("clientes", supabase.from("clientes").select("id, nome").eq("id", projeto.cliente_id).single())
      : Promise.resolve({ data: null }),
    leitura.de("orçamentos de laboratório", supabase
      .from("orcamentos")
      .select("id, tipo, status, data_orcamento, demanda_id, orcamento_itens(n_amostras, custo_unitario, preco_unitario)")
      .eq("projeto_id", id)
      .order("criado_em", { ascending: false })),
    leitura.de("orçamentos de projeto", supabase
      .from("orcamento_projetos")
      .select(
        "id, demanda_id, titulo, status, data_orcamento, margem_lucro, impostos, impostos_legacy, incubacao, reserva, investimentos, lucro, orcamento_projeto_analises(n_amostras, custo_unitario, preco_unitario), orcamento_projeto_custos(rubrica, quantidade, custo_unitario, preco_unitario, meses_selecionados)",
      )
      .eq("projeto_id", id)
      .order("criado_em", { ascending: false })),
    leitura.de("planejamentos", supabase
      .from("planejamento")
      .select("id, nome, data_alvo, criado_em, status_operacional, planejamento_itens(n_amostras), reservas_estoque(status, quantidade_consumida)")
      .eq("projeto_id", id)
      .order("criado_em", { ascending: false })),
    leitura.de("compras", supabase
      .from("pedidos_compra")
      .select("id, status, data_solicitacao, fornecedor_id, pedidos_compra_itens!pedidos_compra_itens_pedido_id_fkey(quantidade, custo_unitario_estimado)")
      .eq("projeto_id", id)
      .order("criado_em", { ascending: false })),
    leitura.de("demandas", supabase
      .from("demandas_propostas")
      .select("id, titulo, status, data_solicitacao, param_impostos, param_incubacao, param_reserva, param_investimentos, param_lucro")
      .eq("projeto_id", id)
      .order("criado_em", { ascending: false })),
    leitura.de("fornecedores", supabase.from("fornecedores").select("id, nome")),
    leitura.de("parâmetros", supabase.from("parametros").select("chave, valor")),
    // pedidos do projeto (o que se pediu, antes de virar compra com fornecedor)
    leitura.de("pedidos", supabase
      .from("pedidos_internos")
      .select("id, titulo, status, natureza, aprovacao_area_em, data_necessidade, criado_em, pedidos_internos_itens(quantidade, orcamento_previo)")
      .eq("projeto_id", id)
      .order("criado_em", { ascending: false })),
  ]);

  // Orçamento ligado ao projeto só pela entrada (demanda) também é do projeto:
  // o módulo de laboratório ou de custos pode não ter o projeto preenchido.
  const demandaIds = (demandas ?? []).map((d) => d.id);
  const [{ data: orcamentosPelaDemanda }, { data: orcProjetosPelaDemanda }] = demandaIds.length
    ? await Promise.all([
        leitura.de("orçamentos de laboratório", supabase
          .from("orcamentos")
          .select("id, tipo, status, data_orcamento, demanda_id, orcamento_itens(n_amostras, custo_unitario, preco_unitario)")
          .in("demanda_id", demandaIds)
          .order("criado_em", { ascending: false })),
        leitura.de("orçamentos de projeto", supabase
          .from("orcamento_projetos")
          .select(
            "id, demanda_id, titulo, status, data_orcamento, margem_lucro, impostos, impostos_legacy, incubacao, reserva, investimentos, lucro, orcamento_projeto_analises(n_amostras, custo_unitario, preco_unitario), orcamento_projeto_custos(rubrica, quantidade, custo_unitario, preco_unitario, meses_selecionados)",
          )
          .in("demanda_id", demandaIds)
          .order("criado_em", { ascending: false })),
      ])
    : [{ data: [] }, { data: [] }];
  const semRepetir = <T extends { id: number }>(...listas: Array<T[] | null | undefined>) => {
    const vistos = new Set<number>();
    return listas.flatMap((lista) => lista ?? []).filter((linha) => !vistos.has(linha.id) && vistos.add(linha.id));
  };
  const orcamentosDoProjeto = semRepetir(orcamentos, orcamentosPelaDemanda);
  const orcProjetosDoProjeto = semRepetir(orcProjetos, orcProjetosPelaDemanda);
  // ORC-9/ORC2-5: "orçado" = propostas aprovadas em vigor (uma por orçamento),
  // pelo total congelado na emissão; o status dos módulos não chega a "aprovado".
  const { data: propostasVigentes } = await leitura.de("proposta aprovada", supabase
    .from("v_proposta_aprovada_vigente")
    .select("versao_id, total_final")
    .eq("projeto_id", id));

  const fornecedorNome = new Map((fornecedores ?? []).map((f) => [f.id, f.nome]));

  // --- Orçamentos (dois modelos) unificados em linhas com total ---
  type OrcLinha = { key: string; href: string; titulo: string; tipo: string; data: string; status: string; total: number };

  // valores pela mesma regra da emissão (custo técnico + gross-up único com as taxas da proposta)
  const taxasDa = criarResolvedorDeTaxas({ projetos: orcProjetosDoProjeto, demandas, parametrosGlobais });

  const orcAnalises: OrcLinha[] = orcamentosDoProjeto.map((o) => {
    const total = valorLaboratorioNaProposta(o.orcamento_itens ?? [], taxasDa(o.demanda_id));
    return {
      key: `a-${o.id}`,
      href: `/orcamento/${o.id}`,
      titulo: `Orçamento ${o.id}`,
      tipo: o.tipo ?? "analises",
      data: o.data_orcamento ?? "",
      status: o.status,
      total,
    };
  });

  const orcProjetoLinhas: OrcLinha[] = orcProjetosDoProjeto.map((o) => {
    const total = valorProjetoNaProposta(
      { custos: o.orcamento_projeto_custos, analises: o.orcamento_projeto_analises },
      taxasDa(o.demanda_id, o),
    );
    return {
      key: `p-${o.id}`,
      href: o.demanda_id != null ? `/orcamento/demandas/${o.demanda_id}?etapa=projeto` : `/orcamento/projetos/${o.id}`,
      titulo: o.titulo ?? `Projeto ${o.id}`,
      tipo: "projeto",
      data: o.data_orcamento ?? "",
      status: o.status,
      total,
    };
  });

  const orcLinhas = [...orcAnalises, ...orcProjetoLinhas];
  const orcadoAprovado = (propostasVigentes ?? []).reduce((a, v) => a + Number(v.total_final ?? 0), 0);

  // --- Compras: valor comprometido (estimado), exceto cancelados ---
  const comprasLinhas = (compras ?? []).map((c) => {
    const total = (c.pedidos_compra_itens ?? []).reduce(
      (a, it) => a + Number(it.quantidade) * Number(it.custo_unitario_estimado ?? 0),
      0,
    );
    return {
      id: c.id,
      status: c.status,
      data: c.data_solicitacao,
      fornecedor: c.fornecedor_id != null ? fornecedorNome.get(c.fornecedor_id) ?? "—" : "—",
      itens: (c.pedidos_compra_itens ?? []).length,
      total,
    };
  });
  const comprometidoCompras = comprasLinhas
    .filter((c) => c.status !== "cancelado")
    .reduce((a, c) => a + c.total, 0);

  const pedidosLinhas = (pedidosInternos ?? []).map((p) => ({
    id: p.id,
    numero: pedidoInternoNumero(p.id),
    titulo: p.titulo,
    etapa: etapaDoPedido(p),
    situacao: pedidoInternoStatus(p.status).label,
    necessidade: p.data_necessidade,
    previo: (p.pedidos_internos_itens ?? []).reduce(
      (a, it) => a + Number(it.quantidade ?? 0) * Number(it.orcamento_previo ?? 0),
      0,
    ),
  }));

  const podeGerirPlanos = await pode("planejamento.editar");
  const planosLinhas = (planos ?? []).map((p) => ({
    id: p.id,
    gestao: avaliarGestaoPlano({
      status: p.status_operacional,
      reservas: p.reservas_estoque ?? [],
      podeGerir: podeGerirPlanos,
    }),
    nome: p.nome ?? `Plano ${p.id}`,
    dataAlvo: p.data_alvo,
    amostras: (p.planejamento_itens ?? []).reduce((a, it) => a + Number(it.n_amostras), 0),
    itens: (p.planejamento_itens ?? []).length,
  }));

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <AvisoLeitura falhas={leitura.falhas} />
        <Breadcrumbs items={[{ label: "Projetos", href: "/projetos" }, { label: projeto.nome }]} />

        {/* Header */}
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">{projeto.nome}</h1>
              <Badge map={STATUS_PROJETO} status={projeto.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {cliente?.nome ? `Cliente: ${cliente.nome}` : "Sem cliente vinculado"}
              {coordenador.situacao === "ok" ? ` · Coordenador: ${coordenador.nome}` : ""}
              {escrito && !(coordenador.situacao === "ok" && coordenador.nome === escrito) ? ` · Responsável técnico: ${escrito}` : ""}
              {projeto.data_inicio || projeto.data_fim
                ? ` · ${fmtData(projeto.data_inicio)} → ${fmtData(projeto.data_fim)}`
                : ""}
            </p>
            {projeto.descricao && (
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{projeto.descricao}</p>
            )}
          </div>
          <Link
            href={`/cadastros/projetos?focus=${projeto.id}`}
            className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
          >
            Editar cadastro
          </Link>
        </div>

        {coordenador.situacao !== "ok" && !["concluido", "cancelado"].includes(projeto.status) && (
          <div
            data-testid="projeto-sem-coordenador"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning-strong/40 bg-warning-soft px-4 py-3 text-sm text-warning-strong"
          >
            <p className="max-w-3xl">
              <b>
                {coordenador.situacao === "suspenso"
                  ? `O coordenador ${coordenador.nome} está com o usuário suspenso.`
                  : "Este projeto está sem coordenador."}
              </b>{" "}
              Os pedidos do projeto não seguem para aprovação.
              {coordenador.situacao === "falta" && coordenador.escrito
                ? ` O nome “${coordenador.escrito}” está só escrito no cadastro: para aprovar, a pessoa precisa ser indicada como coordenador.`
                : ""}
            </p>
            <Link href={`/cadastros/projetos?focus=${projeto.id}`} className="font-semibold underline">
              Indicar coordenador
            </Link>
          </div>
        )}

        {/* KPIs */}
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            label="Orçado (aprovado)"
            valor={moeda(orcadoAprovado)}
            hint={`${(propostasVigentes ?? []).length} proposta(s) aprovada(s)`}
            ajuda={
              <HelpTip title="Orçado (aprovado)">
                <p>Soma das <b>propostas aprovadas em vigor</b> deste projeto, pelo valor final da emissão (uma por orçamento). Propostas canceladas ou substituídas não entram.</p>
              </HelpTip>
            }
          />
          <Kpi
            label="Comprometido em compras"
            valor={moeda(comprometidoCompras)}
            hint={`${comprasLinhas.length} compra(s) com fornecedor`}
            ajuda={
              <HelpTip title="Comprometido em compras">
                <p>Valor <b>estimado</b> das compras com fornecedor ligadas ao projeto, exceto as canceladas.</p>
              </HelpTip>
            }
          />
          <Kpi label="Planejamentos" valor={String(planosLinhas.length)} hint={`${planosLinhas.reduce((a, p) => a + p.amostras, 0)} amostras`} />
          <Kpi label="Orçamentos" valor={String((demandas ?? []).length)} hint="entradas do projeto" />
        </div>

        {/* Orçamentos: a entrada (o que o cliente pediu) e, embaixo, os valores de cada módulo */}
        <section className="mt-8" aria-labelledby="projeto-orcamentos">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="projeto-orcamentos" className="text-lg font-semibold tracking-tight">Orçamentos</h2>
            <Link href="/orcamento" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">Ver todos</Link>
          </div>
          {(demandas ?? []).length === 0 && orcLinhas.length === 0 ? (
            <div className={cardCls}>
              <p className="px-3 py-6 text-center text-sm text-muted-foreground/80">Nenhum orçamento ligado a este projeto.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(demandas ?? []).length > 0 && (
                <div className={`${cardCls} overflow-x-auto`}>
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="min-w-44">Orçamento</TableHead>
                        <TableHead>Solicitado em</TableHead>
                        <TableHead>Situação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(demandas ?? []).map((d) => (
                        <TableRow key={d.id}>
                          <TableCell><Link href={`/orcamento/demandas/${d.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{d.titulo}</Link></TableCell>
                          <TableCell>{fmtData(d.data_solicitacao)}</TableCell>
                          <TableCell>{rotuloStatusOrcamento(d.status)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {orcLinhas.length > 0 && (
                <div className={`${cardCls} overflow-x-auto`}>
                  <p className="px-3 pt-3 text-sm font-medium text-muted-foreground">Valores por módulo (laboratório e custos do projeto)</p>
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="min-w-36">Documento</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orcLinhas.map((o) => (
                        <TableRow key={o.key}>
                          <TableCell><Link href={o.href} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{o.titulo}</Link></TableCell>
                          <TableCell>{ROTULO_TIPO_ORC[o.tipo] ?? o.tipo}</TableCell>
                          <TableCell>{fmtData(o.data)}</TableCell>
                          <TableCell><Badge map={STATUS_ORC} status={o.status} /></TableCell>
                          <TableCell className="text-right tabular-nums">{moeda(o.total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Planejamentos */}
        <section className="mt-8" aria-labelledby="projeto-planejamentos">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="projeto-planejamentos" className="text-lg font-semibold tracking-tight">Planejamentos</h2>
            <Link href="/planejamento" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">Ver todos</Link>
          </div>
          <div className={`${cardCls} overflow-x-auto`}>
            {planosLinhas.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground/80">Nenhum planejamento vinculado a este projeto.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="min-w-36">Plano</TableHead>
                    <TableHead>Data-alvo</TableHead>
                    <TableHead className="text-right">Análises</TableHead>
                    <TableHead className="text-right">Amostras</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {planosLinhas.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell><Link href={`/planejamento/${p.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{p.nome}</Link></TableCell>
                      <TableCell>{fmtData(p.dataAlvo)}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.itens}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.amostras}</TableCell>
                      <TableCell className="text-right">
                        <PlanoLinhaAcoes
                          planId={p.id}
                          nome={p.nome}
                          editavel={p.gestao.podeEditar}
                          gestao={{ acao: p.gestao.acao, bloqueado: p.gestao.acaoBloqueada, motivo: p.gestao.motivoAcao }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </section>

        {/* Pedidos do projeto */}
        <section className="mt-8" aria-labelledby="projeto-pedidos">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="projeto-pedidos" className="text-lg font-semibold tracking-tight">Pedidos</h2>
            <Link href="/pedido" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">Ver todos</Link>
          </div>
          <div className={`${cardCls} overflow-x-auto`}>
            {pedidosLinhas.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground/80">Nenhum pedido deste projeto.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="min-w-52">Pedido</TableHead>
                    <TableHead className="min-w-48">Etapa</TableHead>
                    <TableHead>Precisa até</TableHead>
                    <TableHead className="text-right">Valor prévio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pedidosLinhas.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link href={`/pedido/${p.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
                          <span className="tabular-nums text-muted-foreground">{p.numero}</span> · {p.titulo}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="min-w-36 space-y-1">
                          <EtapaProgresso etapa={p.etapa} />
                          <span className="block text-xs text-muted-foreground">{p.situacao}</span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{fmtData(p.necessidade)}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.previo > 0 ? moeda(p.previo) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </section>

        {/* Compras */}
        <section className="mt-8" aria-labelledby="projeto-compras">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="projeto-compras" className="text-lg font-semibold tracking-tight">Compras</h2>
            <Link href="/compras" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">Ver todas</Link>
          </div>
          <div className={`${cardCls} overflow-x-auto`}>
            {comprasLinhas.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground/80">Nenhuma compra com fornecedor ligada a este projeto.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="min-w-28">Compra</TableHead>
                    <TableHead className="min-w-36">Fornecedor</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Itens</TableHead>
                    <TableHead className="text-right">Estimado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comprasLinhas.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell><Link href={`/compras/${c.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">Compra #{c.id}</Link></TableCell>
                      <TableCell>{c.fornecedor}</TableCell>
                      <TableCell>{fmtData(c.data)}</TableCell>
                      <TableCell><Badge map={STATUS_COMPRA} status={c.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{c.itens}</TableCell>
                      <TableCell className="text-right tabular-nums">{moeda(c.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </section>

        {vinculos && <VinculosProjeto projetoId={id} pessoas={vinculos} />}

      </main>
    </div>
  );
}
