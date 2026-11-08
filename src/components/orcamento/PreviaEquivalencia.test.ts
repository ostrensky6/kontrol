import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreviaEquivalencia } from "./PreviaEquivalencia";

const io = vi.hoisted(() => ({ action: vi.fn(), state: null as unknown, pending: false, metodo: "documento:r2" }));
vi.mock("@/lib/actions/previa-orcamento-equivalencia", () => ({ previaNovoOrcamentoEquivalencia: io.action }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/components/common/HelpTip", () => ({ HelpTip: ({ children }: { children: ReactNode }) => children }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: () => [io.metodo, vi.fn()], useRef: (value: unknown) => ({ current: value }),
  useActionState: (action: unknown) => [io.state, action, io.pending],
}));
function nodes(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(tree).flatMap((child) => isValidElement<Record<string, unknown>>(child)
    ? [child, ...nodes(child.props.children as ReactNode)] : []);
}
const tree = (habilitada = true, numeroAmostras = 12) => PreviaEquivalencia({ codigo: "A1", numeroAmostras, grupo: "Grupo A", habilitada });
beforeEach(() => { vi.resetAllMocks(); io.state = null; io.pending = false; io.metodo = "documento:r2"; });

describe("ORD133 prévia indicativa", () => {
  it("flag ausente não oferece submissão nem chama action", () => {
    expect(nodes(tree(false)).some((n) => n.type === "form")).toBe(false);
    expect(renderToStaticMarkup(tree(false))).toContain("Prévia desabilitada");
    expect(io.action).not.toHaveBeenCalled();
  });
  it("envia somente os três seletores e impede duplo submit síncrono", async () => {
    const form = nodes(tree()).find((n) => n.type === "form")!;
    const preventDefault = vi.fn();
    const submit = form.props.onSubmit as (e: { preventDefault: typeof preventDefault }) => void;
    submit({ preventDefault }); submit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    const dados = new FormData(); dados.set("metodo_revisao_ref", " documento:r2 "); dados.set("preco", "1"); dados.set("ator", "injetado");
    io.action.mockResolvedValue({ estado: "pendente", pendencias: [{ motivo: "sem_validacao_ativa" }] });
    await (form.props.action as (a: null, f: FormData) => Promise<unknown>)(null, dados);
    expect(io.action).toHaveBeenCalledExactlyOnceWith({ codigo_analise: "A1", numero_amostras: 12, metodo_revisao_ref: "documento:r2" });
  });
  it("quantidade inválida não vira uma amostra por fallback", async () => {
    const form = nodes(tree(true, 0)).find((n) => n.type === "form")!;
    const dados = new FormData(); dados.set("metodo_revisao_ref", "documento:r2");
    expect(await (form.props.action as (a: null, f: FormData) => Promise<unknown>)(null, dados)).toHaveProperty("erro");
    expect(io.action).not.toHaveBeenCalled();
  });
  it.each(["sem_permissao", "desabilitada", "sem_validacao_ativa", "fonte_incompleta"])("expõe pendência %s sem custo zero", (motivo) => {
    io.state = { metodo: io.metodo, resposta: { estado: "pendente", pendencias: [{ motivo }] } };
    const html = renderToStaticMarkup(tree());
    expect(html).toContain("não equivale a custo zero");
    expect(html).not.toContain("R$");
    if (motivo === "sem_permissao") expect(html).toContain("não tem autorização");
  });
  it("transporte falho retorna erro, libera guarda e não chama outro cálculo", async () => {
    const form = nodes(tree()).find((n) => n.type === "form")!;
    const dados = new FormData(); dados.set("metodo_revisao_ref", io.metodo);
    io.action.mockRejectedValue(new Error("transporte sintético"));
    const resultado = await (form.props.action as (a: null, f: FormData) => Promise<unknown>)(null, dados);
    io.state = resultado;
    expect(renderToStaticMarkup(tree())).toContain('role="alert"');
    expect(io.action).toHaveBeenCalledOnce();
  });
  it("processamento não exibe resultado anterior", () => {
    io.pending = true;
    io.state = { metodo: io.metodo, erro: "erro anterior" };
    const html = renderToStaticMarkup(tree());
    expect(html).toContain('aria-busy="true"'); expect(html).toContain("Aguardando confirmação"); expect(html).not.toContain("erro anterior");
  });
  it("calculado expõe breakdown e rastro, nunca botão persistir", () => {
    io.state = { metodo: io.metodo, resposta: { estado: "calculado", metodo_revisao_ref: io.metodo, instante: 1794042000000,
      persistivel: false, calculo: { totais: { reagentes: 10, equipamento: 2, pessoal: 3, overhead: 4, custoAnalitico: 15, custoTotal: 19, preco: 25 } },
      selecao: [{ necessidade_id: 1, etapa_id: null, insumo_id: 2, apresentacao_ref: "embalagem:r1", decisao_ref: "equivalencia:3", evidencia_ref: "laudo:r1", quantidade_consumo: 12, quantidade_estoque: 0.12, custo_total_insumo: 10 }],
    } };
    const html = renderToStaticMarkup(tree());
    for (const trecho of ["Preço indicativo total", "Maior custo convertido", "equivalencia:3", "laudo:r1", "não são atômicas", "não comprova um snapshot simultâneo", "não persistível"]) expect(html).toContain(trecho);
    expect(nodes(tree()).filter((n) => n.props.type === "submit")).toHaveLength(1);
    io.metodo = "outra-revisao";
    expect(renderToStaticMarkup(tree())).not.toContain("equivalencia:3");
  });
  it("integra exclusivamente criação, fora do form de gravação, e reinicia por seleção", () => {
    const parent = readFileSync("src/components/orcamento/DemandaForm.tsx", "utf8");
    const page = readFileSync("src/app/orcamento/demandas/nova/page.tsx", "utf8");
    expect(parent).toContain("criacao && exigeAnalises");
    expect(parent.indexOf("<PreviaEquivalencia")).toBeGreaterThan(parent.indexOf("</form>"));
    expect(parent).toContain("key={`${item.grupoKey}:${item.codigo}:${item.quantidade}`}");
    expect(page).toContain('previaEquivalenciaHabilitada={process.env.KONTROL_EQUIVALENCIA_PREVIA === "1"}');
    const component = readFileSync("src/components/orcamento/PreviaEquivalencia.tsx", "utf8");
    expect(component).not.toMatch(/calcularTodas|salvarDemanda|criarDemanda|emitir|replay/);
  });
});
