import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeituraAvisosEquipamento } from "@/lib/equipamentos/avisos";
import EquipamentosPage from "./page";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { AvisosEquipamento, lerContextosAvisosEquipamento } from "@/components/estoque/AvisosEquipamento";
import { OperarAvisoEquipamentoForm } from "@/components/estoque/OperarAvisoEquipamentoForm";
import type { ResultadoAcaoAvisoEquipamento } from "@/lib/actions/equipamentos-avisos";

const escrita = vi.hoisted(() => ({
  avaliar: vi.fn(), reconhecer: vi.fn(), encaminhar: vi.fn(), pending: false,
  state: null as ResultadoAcaoAvisoEquipamento | null,
}));
vi.mock("@/lib/actions/equipamentos-avisos", () => ({
  avaliarAvisoEquipamento: escrita.avaliar, reconhecerAvisoEquipamento: escrita.reconhecer,
  encaminharAvisoEquipamento: escrita.encaminhar,
}));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [typeof value === "function" ? value() : value, vi.fn()],
  useActionState: (action: unknown) => [escrita.state, action, escrita.pending],
}));

function nodes(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(tree).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...nodes(child.props.children as ReactNode)];
  });
}

const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), cliente: vi.fn(), erroUnidades: false }));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped: io.cliente }));
vi.mock("@/lib/scanner/origem", () => ({ origemPublicaKontrol: async () => "http://localhost" }));
vi.mock("@/components/common/QrCode", () => ({ QrCode: () => null }));
vi.mock("@/components/common/HelpTip", () => ({
  HelpTip: ({ children }: { children: React.ReactNode }) => children,
  HelpExample: () => null, HelpLegend: () => null,
}));

const unidade = (id: number) => ({
  id, equipamento_id: id, codigo_patrimonio: `PAT-${id}`, numero_serie: null,
  fabricante: null, modelo: null, status_operacional: "operacional", ativo: true,
  observacoes: null, equipamentos: { nome: `Equipamento sintético ${id}` }, locais: null,
});
const escopo = { equipamento_unidade_id: 10, tipo: "calibracao" };
const confirmada = <T>(dado: T) => ({ estado: "confirmada", dado } as const);
const indisponivel = { estado: "indisponivel" } as const;
const origem = { ...escopo, id: 30, status: "concluida", proxima_data: "2028-03-01" };
const avisos = (["pendente", "reconhecido", "encaminhado"] as const).map((estado, index) => ({
  id: `aviso-${index}`, estado, ocorrencia_id: 30 + index, regra_id: "regra-nao-exposta",
  data_referencia: "2028-02-12", responsavel_id: "responsavel-nao-exposto", aberto_em: "2028-02-08T12:00:00+00:00",
}));
const contexto: LeituraAvisosEquipamento = {
  ...escopo, hoje_sp: "2028-02-29",
  regra: confirmada({ ...escopo, ocorrencia_id: 30, data_referencia: "2028-03-01", antecedencia_dias: 1 }),
  origem: confirmada(origem), avisos: confirmada(avisos),
  permissoes: { configurar: false, encaminhar: true },
};

beforeEach(() => {
  vi.resetAllMocks();
  escrita.state = null;
  escrita.pending = false;
  io.erroUnidades = false;
  io.cliente.mockResolvedValue({ from: io.from, rpc: io.rpc });
  io.rpc.mockResolvedValue({ data: [contexto], error: null });
  io.from.mockImplementation((table: string) => {
    let filtro: number | undefined;
    const chain = {
      select: () => chain, order: () => chain, in: () => chain, limit: () => chain,
      eq: (column: string, valor: number) => { if (column === "id") filtro = valor; return chain; },
      then: (resolve: (result: { data: unknown; error: unknown }) => void) => resolve({
        data: table === "equipamento_unidades" ? [unidade(10), unidade(11)].filter((row) => filtro == null || row.id === filtro) : [],
        error: table === "equipamento_unidades" && io.erroUnidades ? { code: "42501" } : null,
      }),
    };
    return chain;
  });
});

describe("ORD119 controles reais de avisos", () => {
  async function controles(habilitada = true, direitos: unknown = { avaliar: true, configurar: true, reconhecer: true, encaminhar: true }, version: unknown = 2) {
    io.rpc.mockResolvedValueOnce({ data: [{ ...contexto,
      regra: confirmada({ ...escopo, ocorrencia_id: 30, data_referencia: "2028-03-01", antecedencia_dias: 1, versao: version }),
      avisos: confirmada(avisos.map((aviso, index) => ({ ...aviso, id: `00000000-0000-4000-8000-00000000000${index}` }))),
      permissoes: direitos,
    }], error: null });
    return nodes(AvisosEquipamento({ unidadeId: 10, contextos: await lerContextosAvisosEquipamento(await io.cliente(), 10), escritaHabilitada: habilitada }))
      .filter((node) => node.type === OperarAvisoEquipamentoForm);
  }

  it("exige flag e direito explícito; nunca apresenta configuração ou governança", async () => {
    expect(await controles(false)).toHaveLength(0);
    expect(await controles(true, {})).toHaveLength(0);
    expect(await controles(true, { avaliar: false, reconhecer: false, encaminhar: false })).toHaveLength(0);
    const forms = await controles();
    expect(forms.map((form) => form.props.operacao)).toEqual(["avaliar", "reconhecer", "encaminhar", "encaminhar"]);
    expect(forms[0].props.campos).toEqual({ p_unidade_id: "10", p_tipo: "calibracao", p_versao_esperada: "2" });
    expect(forms[1].props.campos).toMatchObject({ p_estado_esperado: "pendente", p_aviso_id: "00000000-0000-4000-8000-000000000000" });
    expect(escrita.avaliar).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "2", 0, -1])("não inventa versão para avaliação: %s", async (version) => {
    const forms = await controles(true, { avaliar: true }, version === undefined ? "ausente" : version);
    expect(forms).toHaveLength(0);
  });

  it.each(["avaliar", "reconhecer", "encaminhar"] as const)("envia %s à action real com payload e trava síncrona", async (operacao) => {
    const forms = await controles();
    const props = forms.find((form) => form.props.operacao === operacao)!.props;
    const tree = OperarAvisoEquipamentoForm(props as Parameters<typeof OperarAvisoEquipamentoForm>[0]);
    const elements = nodes(tree);
    const form = elements.find((node) => node.type === "form")!;
    const dados = new FormData();
    for (const element of elements.filter((node) => node.type === "input" && node.props.type === "hidden")) {
      dados.set(element.props.name as string, element.props.value as string);
    }
    if (operacao !== "avaliar") dados.set("p_motivo", "Conferência local");
    if (operacao === "encaminhar") dados.set("p_destino", "Equipe técnica");
    const preventDefault = vi.fn();
    const submit = form.props.onSubmit as (event: { preventDefault: typeof preventDefault }) => void;
    submit({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    submit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    escrita[operacao].mockResolvedValue({ ok: true, recibo: { estado: "fora_janela", data_referencia: "2028-03-01" } });
    await (form.props.action as (state: null, data: FormData) => Promise<unknown>)(null, dados);
    expect(escrita[operacao]).toHaveBeenCalledExactlyOnceWith(null, dados);
    expect(dados.get("p_operacao_id")).toBe(props.operacaoId);
    expect(dados.has("papel")).toBe(false);
    const checkbox = elements.find((node) => node.props.type === "checkbox")!;
    expect(checkbox.props.required).toBe(true);
    expect(checkbox.props.name).toBeUndefined();
  });

  it.each([
    { ok: false, codigo: "CONFLITO", message: "Conflito confirmado" },
    { ok: false, codigo: "INDISPONIVEL", message: "Resultado incerto" },
    { ok: true, recibo: { estado: "fora_janela", data_referencia: "2028-03-01" } },
  ] satisfies ResultadoAcaoAvisoEquipamento[])("exige releitura após resposta, sem retry automático", (state) => {
    escrita.state = state;
    const tree = OperarAvisoEquipamentoForm({ operacao: "avaliar", operacaoId: "id-fixo", campos: { p_versao_esperada: "2" } });
    const elements = nodes(tree);
    expect(elements.some((node) => node.props.type === "submit")).toBe(false);
    expect(elements.some((node) => node.type === "fieldset" && node.props.disabled === true)).toBe(true);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Recarregar e conferir trilha");
    expect(html).toContain(state.ok ? 'role="status"' : 'role="alert"');
  });

  it("bloqueia enquanto processa", () => {
    escrita.pending = true;
    const tree = OperarAvisoEquipamentoForm({ operacao: "avaliar", operacaoId: "id-fixo", campos: {} });
    const form = nodes(tree).find((node) => node.type === "form")!;
    const preventDefault = vi.fn();
    (form.props.onSubmit as (event: { preventDefault: typeof preventDefault }) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(form.props["aria-busy"]).toBe(true);
    expect(renderToStaticMarkup(tree)).toContain("Registrando…");
  });
});

async function render(params: { focus?: string; scan?: string } = {}) {
  return renderToStaticMarkup(await EquipamentosPage({ searchParams: Promise.resolve(params) }));
}
const detalhe = () => render({ focus: "10" });

describe("consumidor de avisos no detalhe de equipamento", () => {
  it("não consulta avisos na lista nem para unidade selecionada fora da leitura de sessão", async () => {
    const lista = await render();
    expect(lista).toContain("Equipamento sintético 10");
    expect(lista).toContain("Equipamento sintético 11");
    expect(lista).not.toContain("Avisos do cadastro");
    expect(await render({ focus: "999" })).not.toContain("Avisos do cadastro");
    io.erroUnidades = true;
    expect(await detalhe()).not.toContain("Avisos do cadastro");
    expect(io.rpc).not.toHaveBeenCalled();
  });

  it("consulta uma vez no detalhe e separa referência, janela, histórico e permissões", async () => {
    const html = await render({ scan: "10" });
    expect(io.rpc.mock.calls).toEqual([["contextos_avisos_equipamento", { p_unidade_id: 10 }]]);
    expect(html).toContain("Próxima data da ocorrência de origem");
    expect(html).toContain("01/03/2028");
    expect(html).toContain("Dentro da janela de aviso");
    expect(html).toContain("Próxima ação");
    expect(html).toContain("Plano ativo");
    for (const label of ["Pendente", "Reconhecido", "Encaminhado", "Não concedida", "Permissão indisponível", "Concedida · só consulta aqui"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Referência gravada:");
    expect(html).toContain("não confirma execução nem resolução");
    expect(html).not.toMatch(/<form|responsavel-nao-exposto|regra-nao-exposta/);
  });

  it("mostra vazio apenas com leitura confirmada e não confunde ausência de regra com falha", async () => {
    io.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await detalhe()).toContain("Nenhuma regra ou aviso registrado para esta unidade");
    io.rpc.mockResolvedValueOnce({ data: [{ ...contexto, regra: confirmada(null), avisos: confirmada([]) }], error: null });
    const html = await detalhe();
    expect(html).toContain("Sem regra de aviso configurada");
    expect(html).toContain("Nenhum aviso registrado para este tipo");
  });

  it.each([
    [null, null],
    [[], { code: "PGRST202" }],
    [[contexto], { code: "42501" }],
    [[contexto, { ...contexto, equipamento_unidade_id: 11 }], null],
    [[contexto, contexto], null],
    [{ contexto }, null],
  ])("falha fechado sem converter leitura não confirmada em ausência", async (data, error) => {
    io.rpc.mockResolvedValueOnce({ data, error });
    const html = await detalhe();
    expect(html).toContain("Avisos indisponíveis");
    expect(html).not.toContain("Nenhuma regra ou aviso registrado");
    expect(html).not.toContain("Referência gravada:");
  });

  it("não derruba o detalhe quando a leitura dos avisos rejeita por transporte", async () => {
    io.rpc.mockRejectedValueOnce(new Error("falha sintética de transporte"));
    const html = await detalhe();
    expect(html).toContain("Avisos indisponíveis");
    expect(html).toContain("Operação básica");
  });

  it.each([
    [indisponivel, "Referência indisponível"],
    [confirmada({ ...origem, equipamento_unidade_id: 11 }), "Referência indisponível"],
    [confirmada({ ...origem, status: "cancelada" }), "A ocorrência de origem foi cancelada"],
    [confirmada({ ...origem, proxima_data: "2028-03-02" }), "A próxima data da origem mudou"],
    [confirmada(null), "O registro de origem não está mais disponível"],
  ])("preserva pendências com referência não confirmada ou alterada", async (leituraOrigem, texto) => {
    io.rpc.mockResolvedValueOnce({ data: [{ ...contexto, origem: leituraOrigem }], error: null });
    const html = await detalhe();
    expect(html).toContain(texto);
    expect(html).toContain("Pendente");
    expect(html).toContain("Referência gravada:");
    expect(html).not.toContain("Próxima data da ocorrência de origem");
  });

  it("não trata histórico malformado ou cruzado como vazio", async () => {
    io.rpc.mockResolvedValueOnce({ data: [{
      ...contexto, avisos: confirmada([{ ...avisos[0], equipamento_unidade_id: 11, estado: "resolvido" }]),
    }], error: null });
    const html = await detalhe();
    expect(html).toContain("Histórico de avisos indisponível");
    expect(html).not.toContain("Nenhum aviso registrado");
    expect(html).not.toContain("resolvido");
  });
});
