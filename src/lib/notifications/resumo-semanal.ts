/**
 * Resumo semanal para Coordenador, Gestor, Supervisor e Administrador
 * (plano de evolução, item 20). Toda segunda-feira o cron grava um aviso
 * "sistema" com papel_destino = coordenador (alcança quem está acima) e o
 * despacho de e-mails existente envia. Um por semana: se já houver um nos
 * últimos 6 dias, não grava outro.
 */

type Resultado<T> = PromiseLike<{ data: T | null; error: { message: string } | null; count?: number | null }>;

export type ClienteResumo = {
  from: (tabela: string) => {
    select: (colunas: string, opcoes?: { count?: "exact"; head?: boolean }) => FiltroLeitura;
    insert: (valores: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  };
};

type FiltroLeitura = Resultado<Record<string, unknown>[]> & {
  eq: (coluna: string, valor: unknown) => FiltroLeitura;
  gte: (coluna: string, valor: string) => FiltroLeitura;
  in: (coluna: string, valores: readonly string[]) => FiltroLeitura;
};

export type DadosResumo = {
  alertas: Record<string, number>;
  pedidosEmValidacao: number;
  equipamentosVencidos: number;
  equipamentosProximos: number;
};

const ROTULO_ALERTA: [string, string][] = [
  ["reposicao", "abaixo do mínimo"],
  ["reposicao_pendente", "com reposição pendente"],
  ["compra_atrasada", "com compra atrasada"],
  ["vencido", "vencidos"],
  ["vencimento", "vencendo em breve"],
  ["sem_validade", "sem validade cadastrada"],
];

export function textoResumo(d: DadosResumo) {
  const linhas: string[] = [];
  for (const [tipo, rotulo] of ROTULO_ALERTA) {
    const n = d.alertas[tipo] ?? 0;
    if (n > 0) linhas.push(`${n} ${n === 1 ? "insumo" : "insumos"} ${rotulo}`);
  }
  if (d.pedidosEmValidacao > 0) {
    linhas.push(`${d.pedidosEmValidacao} ${d.pedidosEmValidacao === 1 ? "pedido interno aguardando" : "pedidos internos aguardando"} validação`);
  }
  if (d.equipamentosVencidos > 0) linhas.push(`${d.equipamentosVencidos} manutenção/calibração vencida sem encaminhamento`);
  if (d.equipamentosProximos > 0) linhas.push(`${d.equipamentosProximos} manutenção/calibração perto de vencer sem encaminhamento`);
  return linhas.length === 0 ? "Nada pendente nesta semana." : `${linhas.join("; ")}.`;
}

/** Segunda-feira no horário de Brasília. */
export function ehSegundaEmBrasilia(agora: Date) {
  const dia = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(agora);
  return dia === "Mon";
}

async function contar(consulta: FiltroLeitura) {
  const { count, error } = await consulta;
  if (error) throw new Error(error.message);
  return Number(count ?? 0);
}

export async function gerarResumoSemanal(
  supabase: ClienteResumo,
  agora = new Date(),
): Promise<{ gerado: boolean; motivo?: string }> {
  if (!ehSegundaEmBrasilia(agora)) return { gerado: false, motivo: "nao_e_segunda" };
  const seisDias = new Date(agora.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
  const jaTem = await contar(
    supabase.from("notificacoes").select("id", { count: "exact", head: true })
      .eq("entidade_tipo", "resumo_semanal").gte("criado_em", seisDias),
  );
  if (jaTem > 0) return { gerado: false, motivo: "ja_enviado" };

  const { data: alertas, error } = await supabase.from("v_alertas_estoque").select("tipo, insumo_id");
  if (error) throw new Error(error.message);
  const porTipo: Record<string, Set<unknown>> = {};
  for (const a of alertas ?? []) {
    const tipo = String(a.tipo);
    (porTipo[tipo] ??= new Set()).add(a.insumo_id);
  }
  const dados: DadosResumo = {
    alertas: Object.fromEntries(Object.entries(porTipo).map(([k, v]) => [k, v.size])),
    pedidosEmValidacao: await contar(
      supabase.from("pedidos_internos").select("id", { count: "exact", head: true }).eq("status", "em_validacao"),
    ),
    equipamentosVencidos: await contar(
      supabase.from("v_equipamento_avisos").select("equipamento_unidade_id", { count: "exact", head: true })
        .eq("encaminhado", false).in("situacao", ["vencido", "sem_registro"]),
    ),
    equipamentosProximos: await contar(
      supabase.from("v_equipamento_avisos").select("equipamento_unidade_id", { count: "exact", head: true })
        .eq("encaminhado", false).eq("situacao", "proximo"),
    ),
  };
  const { error: erroInsert } = await supabase.from("notificacoes").insert({
    tipo: "sistema",
    titulo: "Resumo da semana",
    corpo: textoResumo(dados),
    entidade_tipo: "resumo_semanal",
    papel_destino: "coordenador",
  });
  if (erroInsert) throw new Error(erroInsert.message);
  return { gerado: true };
}
