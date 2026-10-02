import { createClientUntyped } from "@/lib/supabase/server";
import { pode } from "@/lib/auth/permissao-efetiva";
import { criarCicloInventario, fecharCicloInventario } from "@/lib/actions/inventario";
import { ConfirmSubmitButton } from "@/components/common/ConfirmSubmitButton";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { FormComMensagem } from "@/components/pedido/FormComMensagem";
import { formatDate, formatNumber } from "@/lib/formatters";
import { descreverDiferencaInventario, unidadeDoLote, type LoteUnidade } from "@/lib/inventario/contagem";
import {
  InventarioScannerPanel,
  type InventarioCicloOpcao,
  type InventarioLocalOpcao,
  type InventarioInsumoOpcao,
  type InventarioLoteOpcao,
} from "@/components/estoque/InventarioScannerPanel";
import { InventarioAjusteButton } from "@/components/estoque/InventarioAjusteButton";

export const dynamic = "force-dynamic";

type LoteDaContagem = LoteUnidade & {
  codigo_lote: string | null;
  insumos: { especificacao: string | null; unidade: string | null } | null;
};

type ContagemRow = {
  id: number;
  ciclo_id: number;
  lote_id: number | null;
  insumo_id: number | null;
  quantidade_sistema: number;
  quantidade_contada: number;
  divergencia: number;
  justificativa: string | null;
  ajuste_aplicado: boolean;
  contado_em: string;
  inventario_ciclos: { nome: string | null } | null;
  locais: { nome: string | null } | null;
  lotes_estoque: LoteDaContagem | null;
  insumos: { especificacao: string | null } | null;
};

type ContagemAberta = {
  id: number;
  ciclo_id: number;
  lote_id: number | null;
  insumo_id: number | null;
  quantidade_sistema: number;
  quantidade_contada: number;
  divergencia: number;
  ajuste_aplicado: boolean;
  lotes_estoque: ContagemRow["lotes_estoque"] | ContagemRow["lotes_estoque"][];
  insumos: ContagemRow["insumos"] | ContagemRow["insumos"][];
};

/** O que foi contado e em que unidade: lote ("frasco(s) de 1000 Un") ou insumo inteiro (frascos fechados). */
function descreverAlvo(c: {
  lote_id: number | null;
  lotes_estoque: unknown;
  insumos: unknown;
}) {
  const lote = firstRelation(c.lotes_estoque as LoteDaContagem | LoteDaContagem[] | null);
  if (c.lote_id != null) {
    const insumo = firstRelation(lote?.insumos);
    return {
      lote: lote?.codigo_lote ? `#${c.lote_id} · ${lote.codigo_lote}` : `#${c.lote_id}`,
      insumo: insumo?.especificacao ?? null,
      unidade: unidadeDoLote(lote, insumo?.unidade ?? null),
    };
  }
  const insumo = firstRelation(c.insumos as { especificacao: string | null } | { especificacao: string | null }[] | null);
  return { lote: "todos os lotes", insumo: insumo?.especificacao ?? null, unidade: "frasco(s)" };
}

const LOTE_SELECT = "codigo_lote, modelo_quantidade, conteudo_embalagem_snapshot, unidade_fisica_snapshot, insumos(especificacao, unidade)";

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export default async function InventarioPage() {
  const supabase = await createClientUntyped();
  const podeCriar = await pode("estoque.lote.gerir");
  const podeAjustar = await pode("estoque.lote.gerir");

  const [{ data: ciclos }, { data: locais }, { data: lotes }, { data: contagens }, { data: saldos }] = await Promise.all([
    supabase
      .from("inventario_ciclos")
      .select("id, nome")
      .eq("status", "aberto")
      .order("criado_em", { ascending: false }),
    supabase.from("locais").select("id, nome").order("nome"),
    supabase
      .from("lotes_estoque")
      .select("id, insumo_id, status, codigo_lote, quantidade_atual, local_id, modelo_quantidade, conteudo_embalagem_snapshot, unidade_fisica_snapshot, locais(nome), insumos(especificacao, unidade)")
      .not("status", "in", "(consumido,descartado)")
      .order("id", { ascending: false }),
    supabase
      .from("inventario_contagens")
      .select(`id, ciclo_id, lote_id, insumo_id, quantidade_sistema, quantidade_contada, divergencia, justificativa, ajuste_aplicado, contado_em, inventario_ciclos(nome), locais(nome), lotes_estoque(${LOTE_SELECT}), insumos(especificacao)`)
      .order("contado_em", { ascending: false })
      .limit(25),
    // insumos contados em embalagens fechadas: contagem sem lote
    supabase
      .from("v_estoque_saldo")
      .select("insumo_id, especificacao, unidade_saldo, modelo_quantidade")
      .eq("modelo_quantidade", "EMBALAGEM_FECHADA")
      .order("especificacao"),
  ]);

  // campanhas abertas: quantas contagens e quantas diferenças ainda sem ajuste
  const idsAbertos = (ciclos ?? []).map((ciclo) => Number(ciclo.id));
  const { data: contagensAbertas } = idsAbertos.length
    ? await supabase
        .from("inventario_contagens")
        .select(`id, ciclo_id, lote_id, insumo_id, quantidade_sistema, quantidade_contada, divergencia, ajuste_aplicado, lotes_estoque(${LOTE_SELECT}), insumos(especificacao)`)
        .in("ciclo_id", idsAbertos)
    : { data: [] as ContagemAberta[] };
  const abertas = (contagensAbertas ?? []) as unknown as ContagemAberta[];
  // o que não bate e ainda não foi ajustado: vira alerta no topo, item por item
  const diferencasPendentes = abertas
    .filter((c) => !c.ajuste_aplicado && Math.abs(Number(c.divergencia ?? 0)) > 0.000001)
    .map((c) => {
      const alvo = descreverAlvo(c);
      return {
        id: c.id,
        item: [alvo.insumo, c.lote_id != null ? `lote ${alvo.lote}` : alvo.lote].filter(Boolean).join(" · "),
        frase: descreverDiferencaInventario(Number(c.quantidade_sistema ?? 0), Number(c.quantidade_contada ?? 0), alvo.unidade).frase,
      };
    });
  const resumoCiclos = (ciclos ?? []).map((ciclo) => {
    const doCiclo = abertas.filter((c) => Number(c.ciclo_id) === Number(ciclo.id));
    return {
      id: Number(ciclo.id),
      nome: ciclo.nome ? String(ciclo.nome) : `Inventário #${ciclo.id}`,
      contagens: doCiclo.length,
      pendentes: doCiclo.filter((c) => !c.ajuste_aplicado && Math.abs(Number(c.divergencia ?? 0)) > 0.000001).length,
    };
  });

  const ciclosOpcoes: InventarioCicloOpcao[] = (ciclos ?? []).map((ciclo) => ({
    id: Number(ciclo.id),
    nome: ciclo.nome ? String(ciclo.nome) : `Inventário #${ciclo.id}`,
  }));
  const locaisOpcoes: InventarioLocalOpcao[] = (locais ?? []).map((local) => ({
    id: Number(local.id),
    nome: local.nome ? String(local.nome) : `Local #${local.id}`,
  }));
  const lotesOpcoes: InventarioLoteOpcao[] = (lotes ?? []).map((lote) => {
    const localRaw = lote.locais as { nome: string | null } | { nome: string | null }[] | null;
    const local = Array.isArray(localRaw) ? (localRaw[0] ?? null) : localRaw;
    const insumoRaw = lote.insumos as
      | { especificacao: string | null; unidade: string | null }
      | { especificacao: string | null; unidade: string | null }[]
      | null;
    const insumo = Array.isArray(insumoRaw) ? (insumoRaw[0] ?? null) : insumoRaw;

    return {
      id: Number(lote.id),
      codigoLote: lote.codigo_lote ? String(lote.codigo_lote) : null,
      quantidadeAtual: Number(lote.quantidade_atual ?? 0),
      localId: lote.local_id == null ? null : Number(lote.local_id),
      localNome: local?.nome ?? null,
      insumoDescricao: insumo?.especificacao ?? null,
      // mesma unidade do Controle de Estoque ("frasco(s) de 1000 Un")
      unidade: unidadeDoLote(lote as LoteUnidade, insumo?.unidade ?? null),
    };
  });
  const fechadasPorInsumo = new Map<number, number>();
  for (const lote of lotes ?? []) {
    if (lote.status !== "aceito" || lote.modelo_quantidade !== "EMBALAGEM_FECHADA") continue;
    const id = Number(lote.insumo_id);
    fechadasPorInsumo.set(id, (fechadasPorInsumo.get(id) ?? 0) + Number(lote.quantidade_atual ?? 0));
  }
  const insumosOpcoes: InventarioInsumoOpcao[] = (saldos ?? []).map((saldo) => ({
    id: Number(saldo.insumo_id),
    descricao: saldo.especificacao ? String(saldo.especificacao) : `Insumo #${saldo.insumo_id}`,
    fechadas: fechadasPorInsumo.get(Number(saldo.insumo_id)) ?? 0,
    unidade: saldo.unidade_saldo ? String(saldo.unidade_saldo) : null,
  }));

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <Breadcrumbs items={[{ label: "Estoque", href: "/estoque" }, { label: "Inventário" }]} />
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Inventário cíclico</h1>
              <HelpTip title="Inventário cíclico">
                <p>
                  Conferência física do estoque, organizada em <b>campanhas</b> (por exemplo, uma por
                  semana ou por local).
                </p>
                <p>
                  A contagem não muda o saldo sozinha: a diferença fica registrada e o saldo só é
                  corrigido quando alguém com <b>Corrigir estoque</b> clica em <b>Aplicar ajuste</b>.
                </p>
                <p>Com as diferenças ajustadas, <b>feche a campanha</b>: ela deixa de receber contagens.</p>
                <HelpExample>Sistema diz 12, você contou 10: diferença −2, com justificativa.</HelpExample>
              </HelpTip>
            </div>
          </div>
          {podeCriar && (
            <FormComMensagem action={criarCicloInventario} className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Campanha</label>
                <input
                  name="nome"
                  placeholder="Inventário semanal"
                  className="mt-1 rounded-md border border-input bg-card px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Local</label>
                <select
                  name="local_id"
                  defaultValue=""
                  className="mt-1 rounded-md border border-input bg-card px-3 py-2 text-sm"
                >
                  <option value="">Todos</option>
                  {locaisOpcoes.map((local) => (
                    <option key={local.id} value={local.id}>
                      {local.nome}
                    </option>
                  ))}
                </select>
              </div>
              <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Criar
              </button>
            </FormComMensagem>
          )}
        </div>

        {diferencasPendentes.length > 0 && (
          <div role="alert" className="mt-6 rounded-lg border border-warning-strong/30 bg-warning-soft px-4 py-3 text-sm text-warning-strong">
            <p className="font-semibold">
              {diferencasPendentes.length === 1
                ? "1 item contado não bate com o sistema"
                : `${diferencasPendentes.length} itens contados não batem com o sistema`}
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {diferencasPendentes.slice(0, 8).map((d) => (
                <li key={d.id}>
                  <span className="font-medium">{d.item}:</span> {d.frase}
                </li>
              ))}
            </ul>
            {diferencasPendentes.length > 8 && (
              <p className="mt-1">E mais {diferencasPendentes.length - 8} em Contagens recentes.</p>
            )}
            <p className="mt-1.5 text-xs">
              O saldo só muda quando alguém com Corrigir estoque clicar em Aplicar ajuste.
            </p>
          </div>
        )}

        {resumoCiclos.length > 0 && (
          <section aria-label="Campanhas abertas" className="mt-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Campanhas abertas
            </h2>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              {resumoCiclos.map((ciclo) => (
                <li key={ciclo.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 font-medium">{ciclo.nome}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {ciclo.contagens} {ciclo.contagens === 1 ? "contagem" : "contagens"}
                  </span>
                  {ciclo.pendentes > 0 ? (
                    <span className="text-warning-strong">
                      {ciclo.pendentes} com diferença sem ajuste
                    </span>
                  ) : (
                    <span className="text-muted-foreground">sem pendências</span>
                  )}
                  {podeAjustar && (
                    <FormComMensagem action={fecharCicloInventario} className="flex items-center gap-2">
                      <input type="hidden" name="ciclo_id" value={ciclo.id} />
                      <ConfirmSubmitButton
                        titulo="Fechar campanha?"
                        mensagem={`A campanha “${ciclo.nome}” deixa de receber contagens. As ${ciclo.contagens} contagens e os ajustes ficam no histórico.`}
                        confirmLabel="Fechar campanha"
                        disabled={ciclo.pendentes > 0}
                        className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Fechar campanha
                      </ConfirmSubmitButton>
                    </FormComMensagem>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-8">
          <InventarioScannerPanel
            ciclos={ciclosOpcoes}
            locais={locaisOpcoes}
            lotes={lotesOpcoes}
            insumos={insumosOpcoes}
          />
        </div>

        <section className="mt-8 rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Contagens recentes</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Campanha</th>
                  <th className="px-4 py-3 text-left">Lote ou insumo</th>
                  <th className="px-4 py-3 text-left">Local</th>
                  <th className="px-4 py-3 text-right">Sistema</th>
                  <th className="px-4 py-3 text-right">Contado</th>
                  <th className="px-4 py-3 text-right">Diferença</th>
                  <th className="px-4 py-3 text-left">Justificativa</th>
                  <th className="px-4 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {((contagens ?? []) as unknown as ContagemRow[]).map((contagem) => {
                  const ciclo = firstRelation(contagem.inventario_ciclos);
                  const local = firstRelation(contagem.locais);
                  const alvo = descreverAlvo(contagem);
                  const divergente = Math.abs(Number(contagem.divergencia ?? 0)) > 0.000001;
                  const diferenca = descreverDiferencaInventario(
                    Number(contagem.quantidade_sistema ?? 0),
                    Number(contagem.quantidade_contada ?? 0),
                    alvo.unidade,
                  );
                  return (
                    <tr key={contagem.id}>
                      <td className="px-4 py-3">
                        {ciclo?.nome ?? `#${contagem.ciclo_id}`}
                        <span className="block text-xs text-muted-foreground">{formatDate(contagem.contado_em)}</span>
                      </td>
                      <td className="max-w-xs truncate px-4 py-3" title={alvo.insumo ?? ""}>
                        {alvo.lote}
                        {alvo.insumo ? ` · ${alvo.insumo}` : ""}
                      </td>
                      <td className="px-4 py-3">{local?.nome ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatNumber(contagem.quantidade_sistema)}
                        {alvo.unidade && <span className="block text-xs text-muted-foreground">{alvo.unidade}</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(contagem.quantidade_contada)}</td>
                      <td
                        className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${divergente ? "font-medium text-warning-strong" : "text-brand-700 dark:text-brand-300"}`}
                        title={diferenca.frase}
                      >
                        {diferenca.curta}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3" title={contagem.justificativa ?? ""}>
                        {contagem.justificativa ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {contagem.ajuste_aplicado ? (
                          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-800 dark:bg-brand-950/50 dark:text-brand-300">
                            Ajustado
                          </span>
                        ) : divergente && podeAjustar ? (
                          <InventarioAjusteButton contagemId={contagem.id} />
                        ) : (
                          <span className="text-xs text-muted-foreground/80">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(contagens ?? []).length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground/80">
                      Nenhuma contagem registrada.
                    </td>
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
