import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsumoMensalPainel } from "./ConsumoMensalPainel";

const io = vi.hoisted(() => ({ states: [] as unknown[], setters: [] as ReturnType<typeof vi.fn>[], ler: vi.fn(), operar: vi.fn() }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const setter = vi.fn(); io.setters.push(setter); return [io.states.length ? io.states.shift() : initial, setter]; },
  useRef: (value: unknown) => ({ current: value }),
}));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/components/common/HelpTip", () => ({ HelpTip: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/lib/actions/consumo-mensal", () => ({ lerConsumoMensal: io.ler, operarConsumoMensal: io.operar }));
const base = { ok: true, configuracao_estado: "AUSENTE", escrita_habilitada: true,
  natureza_prova: "DECLARACAO_HUMANA_NAO_VERIFICADA_AUTOMATICAMENTE",
  atual: { configuracao: null, estado: "sem_leitura_comparavel", qualidade: "sem_leitura_comparavel", n: 0,
    media_embalagens_mes: null, meses: [], transicao: null, manual_vigente: null,
    capacidades: { configurar: true, certificar: true, executar: true, governanca: true } },
};
const falha = { ok: false, codigo: "NAO_CONFIRMADO", message: "Não confirmado" };
function nodes(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(tree).flatMap((n) => isValidElement<Record<string, unknown>>(n) ? [n, ...nodes(n.props.children as ReactNode)] : []);
}
function tree(leitura: unknown = base, acao = "", resultado: unknown = null, pending = false) {
  io.states = [leitura, resultado, pending, acao]; io.setters = [];
  return ConsumoMensalPainel({ insumoId: 17 });
}
async function submit(acao: string, campos: Record<string, string>, resposta: unknown = { ok: true, recibo: { acao, operacao_id: "uuid", repetida: false }, atual: base }) {
  const t = tree(base, acao);
  const handler = nodes(t).find((n) => n.type === "form")!.props.onSubmit as (e: unknown) => Promise<void>;
  const Native = globalThis.FormData;
  vi.stubGlobal("FormData", class extends Native { constructor(input?: unknown) { super(); if (input) for (const [k,v] of Object.entries({ confirmacao: "sim", ...campos })) this.set(k,v); } });
  io.operar.mockResolvedValue(resposta);
  try {
    const event = { preventDefault: vi.fn(), currentTarget: {} };
    const p = handler(event); await handler(event); await p;
    await handler(event);
  } finally { vi.unstubAllGlobals(); }
}
beforeEach(() => { vi.resetAllMocks(); io.states = []; io.setters = []; });

describe("ORD147 consumo mensal no Saldo", () => {
  it("leitura sob demanda usa somente ID do insumo selecionado, sem autoexecução", async () => {
    const t = tree(null); io.ler.mockResolvedValue(base);
    (nodes(t).find((n) => n.props.onClick)!.props.onClick as () => void)(); await Promise.resolve();
    expect(io.ler).toHaveBeenCalledExactlyOnceWith(17); expect(io.operar).not.toHaveBeenCalled();
    expect(io.setters[0]).toHaveBeenCalledWith(base);
  });
  it.each([false, true])("flag %s não substitui capacidade explícita", (flag) => {
    const leitura = { ...base, escrita_habilitada: flag, atual: { ...base.atual, capacidades: { configurar: false, certificar: false, executar: false, governanca: false } } };
    expect(nodes(tree(leitura, "executar")).some((n) => n.type === "form")).toBe(false);
    expect(nodes(tree({ ...base, escrita_habilitada: false }, "executar")).some((n) => n.type === "form")).toBe(false);
  });
  it("configuração envia os critérios explícitos sem defaults e protege duplo envio", async () => {
    await submit("configurar", { inicio: "2026-11-01", fuso: "America/Sao_Paulo", janela: "6", minimo_n: "4", comparabilidade: "mes_civil_integral_sem_ruptura_mesma_apresentacao", conteudo: "100", unidade: "mL", unidade_consumo: "mL", fator: "100" });
    expect(io.operar).toHaveBeenCalledOnce();
    expect(io.operar.mock.calls[0][0]).toMatchObject({ insumo_id: 17, acao: "configurar", dados: { janela: 6, minimo_n: 4, conteudo: 100, fator: 100 } });
  });
  it("certificação preserva não explícito e SHA/ref, sem upload", async () => {
    await submit("certificar", { mes: "2026-11-01", cobertura_integral: "false", sem_ruptura: "true", prova_sha256: "a".repeat(64), prova_referencia: "Relatório existente" });
    expect(io.operar.mock.calls[0][0].dados).toEqual({ mes: "2026-11-01", cobertura_integral: false, sem_ruptura: true, prova_sha256: "a".repeat(64), prova_referencia: "Relatório existente" });
  });
  it("booleano sem escolha não vira false", async () => {
    await submit("certificar", { mes: "2026-11-01" });
    expect(io.operar.mock.calls[0][0].dados.cobertura_integral).toBeUndefined();
  });
  it("execução não recebe critérios nem certificação do cliente", async () => {
    await submit("executar", { fator: "999", ator_id: "injetado" });
    expect(io.operar.mock.calls[0][0]).toMatchObject({ insumo_id: 17, acao: "executar", dados: {} });
    expect(io.operar.mock.calls[0][0]).not.toHaveProperty("ator_id");
  });
  it("governança usa insumo null e ID separado apenas para releitura", async () => {
    await submit("governanca", { papel: "laboratorio", acao: "certificar", permitido: "false", motivo: "Revisão" });
    expect(io.operar.mock.calls[0][0]).toMatchObject({ insumo_id: null, insumo_leitura_id: 17, acao: "governanca", dados: { papel: "laboratorio", acao: "certificar", permitido: false, motivo: "Revisão" } });
  });
  it("recibo repetido não substitui leitura atual falha", async () => {
    const historico = { ok: true, recibo: { acao: "executar", operacao_id: "uuid", repetida: true, estado_historico: true, media_embalagens_mes: 999 }, atual: falha };
    await submit("executar", {}, historico);
    expect(io.setters[0]).toHaveBeenCalledWith(falha);
    const html = renderToStaticMarkup(tree(falha, "executar", historico));
    expect(html).toContain("repetido/histórico"); expect(html).toContain("Estado atual indisponível"); expect(html).not.toContain("999");
  });
  it("erro não comprova rollback nem cria retry", async () => {
    await submit("executar", {}, falha);
    expect(io.operar).toHaveBeenCalledOnce();
    const t = tree(falha, "executar", falha);
    expect(nodes(t).some((n) => n.type === "form")).toBe(false);
    expect(renderToStaticMarkup(t)).toContain("Não reenvie automaticamente");
  });
  it("distingue zero comprovado de ausência e explica certificação humana", () => {
    expect(renderToStaticMarkup(tree(base))).toContain("Média: não comprovada");
    const zero = { ...base, atual: { ...base.atual, n: 1, media_embalagens_mes: 0, meses: [{ mes: "2026-10-01", revisao: 1, comparavel: true, quantidade: 0, motivo: "certificado" }] } };
    const html = renderToStaticMarkup(tree(zero));
    expect(html).toContain("zero confirmado na série"); expect(html).toContain("não é telemetria"); expect(html).toContain("ajuste sem vínculo");
  });
  it("integra no ID do Saldo sem alterar o formulário manual nem Repor", () => {
    const source = readFileSync("src/app/estoque/page.tsx", "utf8");
    expect(source).toContain('<ConsumoMensalPainel key={insumoSelecionado.insumoId} insumoId={insumoSelecionado.insumoId} />');
    expect(source).toContain("<RegistrarConsumoManualForm");
    const painel = readFileSync("src/components/estoque/ConsumoMensalPainel.tsx", "utf8");
    expect(painel).not.toMatch(/registrarConsumoManual|reporEstoque|process.env|\*\s*30/);
  });
});
