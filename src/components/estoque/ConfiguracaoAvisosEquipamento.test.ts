import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfiguracaoAvisosEquipamento } from "./ConfiguracaoAvisosEquipamento";

const io = vi.hoisted(() => ({ states: [] as unknown[], setters: [] as ReturnType<typeof vi.fn>[], contexto: vi.fn(), direito: vi.fn(), configurar: vi.fn(), governar: vi.fn() }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const setter = vi.fn(); io.setters.push(setter); return [io.states.length ? io.states.shift() : initial, setter]; },
  useRef: (value: unknown) => ({ current: value }),
}));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/components/common/HelpTip", () => ({ HelpTip: () => null }));
vi.mock("@/lib/actions/equipamentos-contexto", () => ({ consultarContextoConfiguracaoAvisoEquipamento: io.contexto, consultarDireitoAvisoEquipamento: io.direito }));
vi.mock("@/lib/actions/equipamentos-avisos", () => ({ configurarAvisoEquipamento: io.configurar, governarDireitoAvisoEquipamento: io.governar }));
function nodes(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(tree).flatMap((n) => isValidElement<Record<string, unknown>>(n) ? [n, ...nodes(n.props.children as ReactNode)] : []);
}
function invoke(node: ReactElement<Record<string, unknown>>, states: unknown[] = []) {
  io.states = [...states]; io.setters = [];
  return (node.type as (p: Record<string, unknown>) => ReactNode)(node.props);
}
const dados = { equipamento_unidade_id: 10, tipo: "calibracao", versao_esperada: 0,
  permissoes: { configurar: true, governar: true }, regra: { estado: "confirmada", dado: null },
  origens: { itens: [{ id: 30, tipo: "calibracao", status: "agendada", proxima_data: "2028-03-01" }], proximo_apos: 30 },
  responsaveis: { itens: [{ id: "00000000-0000-4000-8000-000000000001", nome: "Responsável de teste" }], proximo_apos: null },
};
function contexto(data: unknown = dados, habilitada = true) {
  io.states = ["calibracao"];
  const outer = ConfiguracaoAvisosEquipamento({ unidadeId: 10, escritaHabilitada: habilitada });
  const component = nodes(outer).find((n) => n.props.unidadeId === 10)!;
  return invoke(component, [data, "", false]);
}
function gravacao(data: unknown = dados) {
  const ctx = contexto(data);
  const node = nodes(ctx).find((n) => n.props.dados)!;
  return invoke(node, [null, false]);
}
beforeEach(() => { vi.resetAllMocks(); io.states = []; io.setters = []; });

describe("ORD146 configuração e governança", () => {
  it("lê mesmo com escrita desligada e não monta gravação", () => {
    const ctx = contexto(dados, false);
    expect(nodes(ctx).some((n) => n.props.dados)).toBe(false);
    expect(nodes(ctx).some((n) => typeof n.props.onClick === "function")).toBe(true);
  });
  it("CAS null bloqueia; zero só vem do contexto confirmado; página vazia não é ausência", () => {
    expect(nodes(contexto({ ...dados, versao_esperada: null })).some((n) => n.props.dados)).toBe(false);
    expect(nodes(contexto()).some((n) => n.props.dados)).toBe(true);
    const empty = contexto({ ...dados, versao_esperada: 3, origens: { itens: [], proximo_apos: null }, permissoes: { governar: false } });
    expect(renderToStaticMarkup(empty)).toContain("Isso não confirma ausência de regra");
    expect(nodes(empty).some((n) => n.props.dados)).toBe(false);
  });
  it("consulta por escopo e paginação, falha não vira autorização", async () => {
    const ctx = contexto(null);
    const click = nodes(ctx).find((n) => n.props.onClick)!.props.onClick as () => void;
    io.contexto.mockResolvedValue({ ok: false, message: "Sem concessão" });
    click(); click(); await Promise.resolve();
    expect(io.contexto).toHaveBeenCalledExactlyOnceWith({ p_unidade_id: 10, p_tipo: "calibracao", p_origem_apos: null, p_responsavel_apos: null, p_limite: 20 });
    expect(io.setters[1]).toHaveBeenCalledWith("Sem concessão");
    expect(io.configurar).not.toHaveBeenCalled();
  });
  it("próxima página usa cursor literal", async () => {
    const ctx = contexto(); io.contexto.mockResolvedValue({ ok: true, dados });
    const button = nodes(ctx).find((n) => n.props.children === "Próxima página de origens")!;
    (button.props.onClick as () => void)(); await Promise.resolve();
    expect(io.contexto.mock.calls[0][0]).toMatchObject({ p_origem_apos: 30, p_responsavel_apos: null });
  });
  it("mapeia origem/data/responsável/CAS à action, sem aceitar injeção; trava duplicata", async () => {
    const tree = gravacao();
    const form = nodes(tree).find((n) => n.type === "form")!;
    const NativeFormData = globalThis.FormData;
    const supplied = { origem: "30", responsavel: dados.responsaveis.itens[0].id, p_antecedencia_dias: "7", p_motivo: "Revisão", confirmacao: "sim", p_versao_esperada: "999" };
    vi.stubGlobal("FormData", class extends NativeFormData { constructor(input?: unknown) { super(); if (input) for (const [k,v] of Object.entries(supplied)) this.set(k,v); } });
    try {
      io.configurar.mockResolvedValue({ ok: true, recibo: { estado: "configurada" } });
      const submit = form.props.onSubmit as (e: unknown) => Promise<void>;
      const event = { preventDefault: vi.fn(), currentTarget: {} };
      const first = submit(event); await submit(event); await first;
      expect(io.configurar).toHaveBeenCalledOnce();
      const payload = Object.fromEntries(io.configurar.mock.calls[0][1]);
      expect(payload).toMatchObject({ p_unidade_id: "10", p_tipo: "calibracao", p_versao_esperada: "0", p_ocorrencia_id: "30", p_data_referencia: "2028-03-01", p_responsavel_id: supplied.responsavel, p_antecedencia_dias: "7" });
      expect(payload.p_operacao_id).toMatch(/^[0-9a-f-]{36}$/);
      await submit(event); expect(io.configurar).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
  it("governança só com concessão explícita do contexto; par não preselecionado", () => {
    expect(nodes(contexto({ ...dados, permissoes: { governar: false } })).some((n) => n.props.habilitada !== undefined)).toBe(false);
    const node = nodes(contexto()).find((n) => n.props.habilitada === true)!;
    const html = renderToStaticMarkup(invoke(node, [{ papel: "", operacao: "" }]));
    expect(html).toContain("Nenhuma política vem pré-selecionada");
    expect(io.direito).not.toHaveBeenCalled();
  });
  it("erro/sucesso de gravação só oferece releitura", () => {
    const node = nodes(contexto()).find((n) => n.props.dados)!;
    for (const resultado of [{ ok: false, message: "Resultado incerto" }, { ok: true, recibo: { estado: "configurada" } }]) {
      const html = renderToStaticMarkup(invoke(node, [resultado, false]));
      expect(html).toContain("Recarregar antes de outra operação");
      expect(html).not.toContain('type="submit"');
    }
  });
  it("consulta o par e envia concessão esperada false apenas após confirmação", async () => {
    const governanca = nodes(contexto()).find((n) => n.props.habilitada === true)!;
    const par = invoke(governanca, [{ papel: "laboratorio", operacao: "avaliar" }]);
    const consulta = nodes(par).find((n) => n.props.papel === "laboratorio")!;
    const vazio = invoke(consulta, [null, "", false]);
    io.direito.mockResolvedValue({ ok: false, message: "Consulta negada" });
    (nodes(vazio).find((n) => n.props.onClick)!.props.onClick as () => void)(); await Promise.resolve();
    expect(io.direito).toHaveBeenCalledExactlyOnceWith({ p_papel: "laboratorio", p_operacao: "avaliar" });
    expect(nodes(vazio).some((n) => n.props.direito)).toBe(false);
    const direito = { estado: "confirmado", papel: "laboratorio", operacao: "avaliar", pode_governar: true, concessao_esperada: false };
    const confirmado = invoke(consulta, [direito, "", false]);
    const gravar = nodes(confirmado).find((n) => n.props.direito)!;
    const tree = invoke(gravar, [null, false]);
    const Native = globalThis.FormData;
    vi.stubGlobal("FormData", class extends Native { constructor(input?: unknown) { super(); if (input) { this.set("p_motivo", "Revisão autorizada"); this.set("confirmacao", "sim"); this.set("p_concedido", "true"); this.set("p_concessao_esperada", "true"); } } });
    try {
      io.governar.mockResolvedValue({ ok: true, recibo: { estado: "direito_registrado" } });
      await (nodes(tree).find((n) => n.type === "form")!.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: vi.fn(), currentTarget: {} });
      expect(Object.fromEntries(io.governar.mock.calls[0][1])).toMatchObject({ p_papel: "laboratorio", p_operacao: "avaliar", p_concessao_esperada: "false", p_concedido: "true" });
    } finally { vi.unstubAllGlobals(); }
  });
});
