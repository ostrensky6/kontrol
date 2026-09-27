import { notFound } from "next/navigation";
import { createClientUntyped } from "@/lib/supabase/server";
import {
  CADASTROS,
  type Campo,
} from "@/lib/cadastros/config";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { CrudShell } from "@/components/cadastros/CrudShell";
import { HelpTip, TextoAjuda } from "@/components/common/HelpTip";
import { loteBaixaDeDb, somarReservasPorLote, type LoteDbBaixa } from "@/lib/estoque/baixa";
import { equipCustoDia } from "@/lib/costing/engine";
import {
  menorValidadePorInsumo,
  modeloQuantidadePorInsumo,
  projetarQuantidadeInsumos,
  type LoteInsumo,
  type LoteModelo,
  type LoteValidade,
} from "@/lib/cadastros/insumos";
import { nomesDosPais } from "@/lib/cadastros/locais";
import {
  camposTecnicosParaUsuario,
  colunasCalculadasTecnico,
  lerLinhasCadastro,
} from "@/lib/cadastros/salario";
import { pode, podeVerSalario } from "@/lib/auth/permissao-efetiva";
import type { PermissaoUsuario } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

/** Tabelas com coluna `ativo`: inativos só aparecem no seletor como valor atual. */
const FONTES_COM_ATIVO = new Set(["fornecedores", "clientes", "tipo_insumos"]);

/** Permissão que libera criar, editar e excluir em cada cadastro (mesma do RLS, 0108/0124). */
const PERMISSAO_EDITAR: Record<string, PermissaoUsuario> = {
  insumos: "insumos.editar",
  projetos: "projetos.editar",
};

type Row = Record<string, unknown>;

function dateOnly(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function tempoParaValidade(value: unknown) {
  const validade = dateOnly(value);
  if (!validade) return "—";

  const agora = new Date();
  const hoje = new Date(Date.UTC(
    agora.getUTCFullYear(),
    agora.getUTCMonth(),
    agora.getUTCDate(),
  ));
  const dias = Math.ceil(
    (validade.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (dias < 0) return `Vencido há ${Math.abs(dias)} dia(s)`;
  if (dias === 0) return "Vence hoje";
  if (dias < 30) return `${dias} dia(s)`;

  const meses = Math.floor(dias / 30);
  const diasRestantes = dias % 30;
  return diasRestantes > 0
    ? `${meses} mês(es) e ${diasRestantes} dia(s)`
    : `${meses} mês(es)`;
}

function addDays(dateText: unknown, days: unknown): string | null {
  const base = dateOnly(dateText);
  const n = Number(days);
  if (!base || !Number.isFinite(n) || n <= 0) return null;
  const result = new Date(base);
  result.setUTCDate(result.getUTCDate() + Math.round(n));
  return result.toISOString().slice(0, 10);
}

function dataFimVidaUtilEquipamento(row: Row): string | null {
  const anos = Number(row.vida_util_anos);
  if (!Number.isFinite(anos) || anos <= 0) return typeof row.data_validade === "string" ? row.data_validade : null;
  return addDays(row.data_aquisicao, anos * 365.2425) ?? (typeof row.data_validade === "string" ? row.data_validade : null);
}

async function comColunasCalculadas(
  slug: string,
  rows: Row[],
  diasUteisAno: number,
): Promise<Row[]> {
  switch (slug) {
    case "equipamentos":
      return rows.map((r) => {
        const dataValidade = dataFimVidaUtilEquipamento(r);
        return {
          ...r,
          data_validade: dataValidade,
          tempo_para_validade: tempoParaValidade(dataValidade),
          custo_dia: equipCustoDia(
            {
              quantidade: r.quantidade as number,
              custo_unitario: r.custo_unitario as number,
              vida_util_anos: r.vida_util_anos as number,
              percentual_manutencao_anual: r.percentual_manutencao_anual as number,
              manutencao_anual_fixa: r.manutencao_anual_fixa as number,
            },
            diasUteisAno,
          ),
        };
      });
    case "tecnicos":
      // antes da 0129 (ou no mock) a coluna não existe: técnico sem o campo é ativo
      return rows.map((r) => colunasCalculadasTecnico({ ...r, ativo: r.ativo !== false }));
    case "overhead":
      return rows.map((r) => ({
        ...r,
        custo_hora_bancada:
          Number(r.horas_bancada_mes) > 0
            ? (Number(r.custo_mensal) / Number(r.horas_bancada_mes)) *
              (Number(r.percentual_compensada) / 100)
            : 0,
      }));
    default:
      return rows;
  }
}

export default async function CadastroPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const cfg = CADASTROS[slug];
  if (!cfg) notFound();

  const supabase = await createClientUntyped();
  // Sem a permissão de edição, a tela vira consulta (sem Novo, Editar e Excluir).
  const podeEditar = await pode(PERMISSAO_EDITAR[slug] ?? "cadastros.editar");
  // Salário: decidido no servidor; sem permissão o valor real nunca é lido
  // nem serializado para o CrudShell (cliente).
  const podeVerSalarioTecnicos = slug === "tecnicos" ? await podeVerSalario() : false;
  const [{ data: rows, error: rowsError }, { data: parametros }] = await Promise.all([
    lerLinhasCadastro(supabase, cfg.tabela, { podeVerSalario: podeVerSalarioTecnicos }),
    supabase.from("parametros").select("chave, valor").eq("chave", "dias_uteis_ano"),
  ]);
  // falha de leitura não pode virar tabela vazia ("0 registros")
  if (rowsError) throw new Error(`Falha ao carregar ${cfg.titulo.toLowerCase()}: ${rowsError.message}`);
  const diasUteisAno = Number(parametros?.[0]?.valor ?? 222);

  let linhas = await comColunasCalculadas(slug, rows ?? [], diasUteisAno);

  if (slug === "insumos") {
    const { data: lotes, error: lotesError } = await supabase
      .from("lotes_estoque")
      .select("id, codigo_lote, insumo_id, status, quantidade_atual, validade, validade_apos_abertura, data_abertura, modelo_quantidade");
    if (lotesError) throw new Error(lotesError.message);
    const { data: reservas } = await supabase
      .from("reservas_estoque")
      .select("lote_id, quantidade, quantidade_consumida, status")
      .in("status", ["reservado", "parcial"]);
    const reservadoPorLote = somarReservasPorLote(reservas ?? []);
    linhas = projetarQuantidadeInsumos(linhas, (lotes ?? []) as LoteInsumo[]);
    const modelos = modeloQuantidadePorInsumo((lotes ?? []) as LoteModelo[]);
    // lotes com saldo, para a seção "Lotes" da edição do insumo
    const lotesPorInsumo = new Map<string, Record<string, unknown>[]>();
    for (const lote of (lotes ?? []) as Record<string, unknown>[]) {
      if (!(Number(lote.quantidade_atual) > 0) || ["consumido", "descartado"].includes(String(lote.status))) continue;
      const chave = String(lote.insumo_id);
      lotesPorInsumo.set(chave, [...(lotesPorInsumo.get(chave) ?? []), lote]);
    }
    const validadePorInsumo = menorValidadePorInsumo((lotes ?? []) as LoteValidade[]);
    linhas = linhas.map((r) => ({
      ...r,
      // a validade é do lote: a coluna mostra o lote com saldo que vence primeiro
      validade_lotes: validadePorInsumo.get(String(r.id)) ?? null,
      // embalagem de R$ 0: o insumo entra sem custo nas análises (CAD2-11)
      custo_unitario:
        r.custo_total_embalagem != null && Number(r.custo_total_embalagem) === 0 ? "Sem custo" : r.custo_unitario,
      quantidade_modelo: modelos.get(String(r.id)) ?? null,
      lotes_resumo: (lotesPorInsumo.get(String(r.id)) ?? [])
        .sort((a, b) => String(a.validade ?? "9999").localeCompare(String(b.validade ?? "9999")))
        .map((l) => loteBaixaDeDb(l as unknown as LoteDbBaixa, reservadoPorLote)),
    }));
  }

  // injeta opções dinâmicas nos selects que referenciam outra tabela. Registros
  // inativos vêm marcados: o formulário só os oferece quando já são o valor atual.
  const fontes = [...new Set(cfg.campos.map((c) => c.opcoesDe).filter(Boolean))] as string[];
  const opcoesPorFonte: Record<string, { value: string; label: string; inativo?: boolean }[]> = {};
  for (const fonte of fontes) {
    const comAtivo = FONTES_COM_ATIVO.has(fonte);
    const { data } = await supabase
      .from(fonte)
      .select(comAtivo ? "id, nome, ativo" : "id, nome")
      .order("nome");
    opcoesPorFonte[fonte] = ((data ?? []) as unknown as { id: number; nome: string | null; ativo?: boolean | null }[]).map(
      (r) => ({
        value: String(r.id),
        label: String(r.nome ?? ""),
        ...(comAtivo && r.ativo === false ? { inativo: true } : {}),
      }),
    );
  }
  const camposBase: Campo[] = cfg.campos.map((c) =>
    c.opcoesDe ? { ...c, opcoes: opcoesPorFonte[c.opcoesDe] ?? [] } : c,
  );
  const campos =
    slug === "tecnicos" ? camposTecnicosParaUsuario(camposBase, podeVerSalarioTecnicos) : camposBase;

  if (slug === "insumos") {
    const tipos = opcoesPorFonte["tipo_insumos"] ?? [];
    const tipoNomePorId = new Map(tipos.map((o) => [o.value, o.label]));
    const tipoIdPorNome = new Map(tipos.map((o) => [o.label.trim().toLowerCase(), o.value]));
    linhas = linhas.map((r) => {
      const tipoNome =
        r.tipo_insumo_id != null
          ? tipoNomePorId.get(String(r.tipo_insumo_id))
          : undefined;
      if (r.tipo_insumo_id != null || r.nome_item == null) {
        return {
          ...r,
          tipo_insumo_nome: tipoNome ?? r.nome_item ?? "—",
        };
      }
      const tipoId = tipoIdPorNome.get(String(r.nome_item).trim().toLowerCase());
      return {
        ...r,
        tipo_insumo_id: tipoId ?? r.tipo_insumo_id,
        tipo_insumo_nome: tipoId ? tipoNomePorId.get(tipoId) ?? r.nome_item : r.nome_item,
      };
    });
  }

  if (slug === "locais") {
    const pais = nomesDosPais(linhas);
    linhas = linhas.map((r) => ({ ...r, parent_nome: pais.get(String(r.id)) ?? "—" }));
  }

  // projetos: resolve o nome do cliente para a coluna da tabela
  if (slug === "projetos") {
    const clientes = opcoesPorFonte["clientes"] ?? [];
    const nomePorId = new Map(clientes.map((o) => [o.value, o.label]));
    linhas = linhas.map((r) => ({
      ...r,
      cliente_nome: r.cliente_id != null ? nomePorId.get(String(r.cliente_id)) ?? "—" : "—",
    }));
  }

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <Breadcrumbs items={[{ label: "Cadastros", href: "/cadastros" }, { label: cfg.titulo }]} />

        <div className="mt-6 flex items-center gap-1">
          <h1 className="text-xl font-semibold tracking-tight">{cfg.titulo}</h1>
          <HelpTip title={cfg.titulo}>
            <p>
              <TextoAjuda texto={cfg.subtitulo} />
            </p>
            {slug === "tecnicos" && !podeVerSalarioTecnicos && (
              <p>
                O salário aparece como <b>XXX</b>: ver e alterar exige a permissão “Ver salário dos
                técnicos” (Governança → Privilégios).
              </p>
            )}
          </HelpTip>
        </div>

        <div className="mt-6">
          <CrudShell
            slug={cfg.slug}
            singular={cfg.singular}
            rotulo={cfg.rotulo}
            colunas={cfg.colunas}
            campos={campos}
            rows={linhas}
            initialFocusId={typeof query.focus === "string" ? query.focus : undefined}
            somenteLeitura={!podeEditar}
          />
        </div>
      </main>
    </div>
  );
}
