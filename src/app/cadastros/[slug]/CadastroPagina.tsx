import { coordenadorDoProjeto, rotuloCoordenador, type UsuarioCoordenador } from "@/app/projetos/_lib/responsavel";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClientUntyped } from "@/lib/supabase/server";
import {
  CADASTROS,
  type Campo,
} from "@/lib/cadastros/config";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { CrudShell } from "@/components/cadastros/CrudShell";
import { CODIGO_BARRAS_MAX, chaveCodigoBarras } from "@/lib/scanner/codigo-barras";
import { codigosBarrasPorInsumo } from "@/lib/scanner/vinculos-codigo";
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
import { preAprovadosSemConta, type PreAprovadoOpcao } from "@/lib/cadastros/pessoas";
import { motivoSomenteConsulta } from "@/lib/cadastros/somente-consulta";
import {
  camposTecnicosParaUsuario,
  colunasCalculadasTecnico,
  lerLinhasCadastro,
} from "@/lib/cadastros/salario";
import { pode, podeVerSalario } from "@/lib/auth/permissao-efetiva";
import { temPapel } from "@/lib/auth/roles";
import type { PermissaoUsuario } from "@/lib/auth/permissions";
import { lerTudo } from "@/lib/supabase/ler-tudo";

/** Tabelas com coluna `ativo`: inativos só aparecem no seletor como valor atual. */
const FONTES_COM_ATIVO = new Set(["fornecedores", "clientes", "tipo_insumos", "insumos", "coordenacoes_area"]);

/** Permissão que libera criar, editar e excluir em cada cadastro (mesma do RLS, 0108/0124). */
const PERMISSAO_EDITAR: Record<string, PermissaoUsuario> = {
  insumos: "insumos.editar",
  projetos: "projetos.editar",
  // 0169: quem aprova o quê é decisão do Administrador
  coordenacoes: "usuarios.gerenciar",
  // 0173: quem recebe os avisos do administrativo e do pagamento, idem
  responsaveis: "usuarios.gerenciar",
  // 0174: previsão de equipamentos (mesma permissão do RLS)
  previsao_equipamentos: "pedido.aprovar",
};

const PRIORIDADES: Record<string, string> = { "1": "1 · Alta", "2": "2 · Média", "3": "3 · Baixa" };
const SITUACOES_PREVISAO: Record<string, string> = {
  previsto: "Previsto",
  pedido: "Pedido aberto",
  comprado: "Comprado",
  descartado: "Descartado",
};

const ETAPAS_RESPONSAVEIS: Record<string, string> = {
  administrativo: "Administrativo: autorização, cotações e aprovação final",
  pagamento: "Pagamento e nota fiscal",
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

export type ConsultaCadastro = { [key: string]: string | string[] | undefined };

/**
 * O cadastro de `slug` com a lista, os formulários e as ações. É o corpo de
 * /cadastros/[slug] e também de Estoque → Equipamentos (tipos e previsão de
 * compra), que mostram o mesmo cadastro com outra navegação em volta.
 */
export async function CadastroPagina({
  slug,
  query,
  breadcrumbs,
  abas,
}: {
  slug: string;
  query: ConsultaCadastro;
  /** trilha de pão própria; sem ela, Cadastros › nome do cadastro */
  breadcrumbs?: { label: string; href?: string }[];
  /** navegação por abas acima do título (Equipamentos) */
  abas?: ReactNode;
}) {
  const cfg = CADASTROS[slug];
  if (!cfg) notFound();

  const supabase = await createClientUntyped();
  // Só o Administrador cadastra usuário: os campos de usuário oferecem "Cadastrar nova pessoa" a ele
  // e mandam os demais pedirem a ele.
  const podeCadastrarPessoa = cfg.campos.some((c) => c.opcoesDe === "perfis") && (await temPapel("admin"));
  // Sem a permissão de edição, a tela vira consulta (sem Novo, Editar e Excluir).
  const permissaoEditar = PERMISSAO_EDITAR[slug] ?? "cadastros.editar";
  const podeEditar = await pode(permissaoEditar);
  // Salário: decidido no servidor; sem permissão o valor real nunca é lido
  // nem serializado para o CrudShell (cliente).
  const podeVerSalarioTecnicos = slug === "tecnicos" ? await podeVerSalario() : false;
  // Seção "Lotes" da edição do insumo: só mostra o que o banco aceitaria.
  const [podeMovimentarEstoque, podeCorrigirEstoque] =
    slug === "insumos"
      ? await Promise.all([pode("estoque.movimentar"), pode("estoque.lote.gerir")])
      : [false, false];
  const [{ data: rows, error: rowsError }, { data: parametros }] = await Promise.all([
    lerLinhasCadastro(supabase, cfg.tabela, { podeVerSalario: podeVerSalarioTecnicos }),
    supabase.from("parametros").select("chave, valor").eq("chave", "dias_uteis_ano"),
  ]);
  // falha de leitura não pode virar tabela vazia ("0 registros")
  if (rowsError) throw new Error(`Falha ao carregar ${cfg.titulo.toLowerCase()}: ${rowsError.message}`);
  const diasUteisAno = Number(parametros?.[0]?.valor ?? 222);

  let linhas = await comColunasCalculadas(slug, rows ?? [], diasUteisAno);

  if (slug === "insumos") {
    const { data: lotes, error: lotesError } = await lerTudo<Record<string, unknown>>((de, ate) =>
      supabase
        .from("lotes_estoque")
        .select("id, codigo_lote, insumo_id, status, quantidade_atual, validade, validade_apos_abertura, data_abertura, modelo_quantidade")
        .order("id")
        .range(de, ate),
    );
    if (lotesError) throw new Error(lotesError.message);
    const { data: reservas, error: reservasError } = await lerTudo<{
      lote_id: number | null;
      quantidade: number;
      quantidade_consumida: number | null;
      status: string;
    }>((de, ate) =>
      supabase
        .from("reservas_estoque")
        .select("id, lote_id, quantidade, quantidade_consumida, status")
        .in("status", ["reservado", "parcial"])
        .order("id")
        .range(de, ate),
    );
    // reserva não lida não pode virar "nada reservado" (o disponível do lote ficaria maior)
    if (reservasError) throw new Error(`Não foi possível ler as reservas do estoque: ${reservasError.message}`);
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
    // códigos de barras do fabricante (identificadores), editados no formulário
    const codigosPorInsumo = await codigosBarrasPorInsumo(supabase);
    linhas = linhas.map((r) => ({
      ...r,
      codigos_barras: codigosPorInsumo.get(String(r.id)) ?? [],
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
  let emailsComConta: (string | null)[] = [];
  for (const fonte of fontes) {
    if (fonte === "perfis") {
      // usuários: nome (ou e-mail); suspenso só aparece quando já é o valor atual
      const { data } = await supabase.from("perfis").select("id, nome, email, suspenso").order("nome");
      emailsComConta = (data ?? []).map((r) => r.email);
      opcoesPorFonte[fonte] = ((data ?? []) as { id: string; nome: string | null; email: string | null; suspenso: boolean | null }[]).map(
        (r) => ({
          value: r.id,
          label: r.nome?.trim() || r.email || r.id,
          ...(r.suspenso ? { inativo: true } : {}),
        }),
      );
      continue;
    }
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
    // coordenador = usuário que aprova os pedidos; o nome escrito à mão não aprova (0136/0169)
    const usuarios: UsuarioCoordenador[] = (opcoesPorFonte["perfis"] ?? []).map((o) => ({
      id: o.value,
      nome: o.label,
      suspenso: Boolean(o.inativo),
    }));
    linhas = linhas.map((r) => ({
      ...r,
      coordenador_usuario: rotuloCoordenador(coordenadorDoProjeto(r as { coordenador_id?: string | null }, usuarios)),
    }));
  }

  // laboratórios e áreas: nome de quem coordena e de quem substitui
  if (slug === "coordenacoes") {
    const usuarios = opcoesPorFonte["perfis"] ?? [];
    const nomePorId = new Map(usuarios.map((o) => [o.value, o.label]));
    linhas = linhas.map((r) => ({
      ...r,
      coordenador_nome: r.coordenador_id != null ? nomePorId.get(String(r.coordenador_id)) ?? "—" : "Sem coordenador: o pedido trava",
      substituto_nome: r.substituto_id != null ? nomePorId.get(String(r.substituto_id)) ?? "—" : "—",
    }));
  }

  // laboratório dono (insumos) e previsão de equipamentos (0174)
  if (slug === "insumos" || slug === "previsao_equipamentos") {
    const laboratorios = opcoesPorFonte["coordenacoes_area"] ?? [];
    const nomePorId = new Map(laboratorios.map((o) => [o.value, o.label]));
    linhas = linhas.map((r) => ({
      ...r,
      laboratorio_nome: r.laboratorio_id != null ? nomePorId.get(String(r.laboratorio_id)) ?? "—" : "—",
      ...(slug === "previsao_equipamentos"
        ? {
            prioridade_nome: PRIORIDADES[String(r.prioridade)] ?? String(r.prioridade ?? "—"),
            situacao_nome: SITUACOES_PREVISAO[String(r.situacao)] ?? String(r.situacao ?? "—"),
          }
        : {}),
    }));
  }

  // responsáveis do administrativo e do pagamento (0173)
  if (slug === "responsaveis") {
    const usuarios = opcoesPorFonte["perfis"] ?? [];
    const nomePorId = new Map(usuarios.map((o) => [o.value, o.label]));
    // 0180: sem responsável, vale a primeira pessoa ativa com a função Administrativo
    const { data: administrativos } = await supabase
      .from("perfis")
      .select("nome, email")
      .eq("papel", "administrativo")
      .eq("suspenso", false)
      .order("nome");
    const primeiroAdministrativo = ((administrativos ?? []) as { nome: string | null; email: string | null }[])
      .map((p) => p.nome?.trim() || p.email || "")
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "pt-BR"))[0];
    const semResponsavel = primeiroAdministrativo
      ? `Sem indicado: vale ${primeiroAdministrativo} (Administrativo)`
      : "Sem responsável: avisos vão ao Administrador";
    linhas = linhas.map((r) => ({
      ...r,
      etapa_nome: ETAPAS_RESPONSAVEIS[String(r.etapa)] ?? String(r.etapa ?? "—"),
      usuario_nome: r.usuario_id != null ? nomePorId.get(String(r.usuario_id)) ?? "—" : semResponsavel,
      substituto_nome: r.substituto_id != null ? nomePorId.get(String(r.substituto_id)) ?? "—" : "—",
    }));
  }

  // pré-aprovados que ainda não entraram: só o Administrador lê (RLS) e só ele cria a conta
  let preAprovados: PreAprovadoOpcao[] = [];
  if (podeCadastrarPessoa) {
    const { data } = await supabase.from("usuarios_pre_aprovados").select("id, nome, email").order("nome");
    preAprovados = preAprovadosSemConta(data ?? [], emailsComConta);
  }

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        {abas}
        <Breadcrumbs items={breadcrumbs ?? [{ label: "Cadastros", href: "/cadastros" }, { label: cfg.titulo }]} />

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
        {!podeEditar && (
          <p data-testid="motivo-somente-consulta" className="mt-1 text-sm text-muted-foreground">
            {motivoSomenteConsulta(slug, permissaoEditar)}
          </p>
        )}

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
            podeMovimentarEstoque={podeMovimentarEstoque}
            podeCorrigirEstoque={podeCorrigirEstoque}
            novoComCodigo={
              slug === "insumos" && query.novo === "1" && typeof query.codigo === "string"
                ? chaveCodigoBarras(query.codigo).slice(0, CODIGO_BARRAS_MAX) || undefined
                : undefined
            }
            abrirNovo={!cfg.apenasEditar && query.novo === "1"}
            apenasEditar={cfg.apenasEditar}
            podeCadastrarPessoa={podeCadastrarPessoa}
            preAprovados={preAprovados}
          />
        </div>
      </main>
    </div>
  );
}
