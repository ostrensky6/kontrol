import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EstoquePage from "./page";
import { RegistrarConsumoManualForm } from "@/components/estoque/RegistrarConsumoManualForm";
import type { EstadoRegistroConsumoManual, ResultadoLeituraConsumoManual, RevisaoConsumoManual } from "@/lib/actions/consumo-manual";

const io = vi.hoisted(() => ({
  ler: vi.fn(), registrar: vi.fn(), from: vi.fn(), saldo: vi.fn(),
  resposta: { ok: false } as EstadoRegistroConsumoManual,
  pending: false, enviado: { current: false }, base: undefined as unknown,
}));
vi.mock("@/lib/actions/consumo-manual", () => ({ lerConsumoManual: io.ler, registrarConsumoManual: io.registrar }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: io.from }), createClientUntyped: async () => ({ from: io.from }),
}));
vi.mock("@/lib/auth/permissao-efetiva", () => ({ pode: async () => false }));
vi.mock("@/lib/auth/roles", () => ({ usuarioAtual: async () => null }));
vi.mock("@/components/common/HelpTip", () => ({
  HelpTip: ({ children }: { children: React.ReactNode }) => children, HelpLegend: () => null, HelpExample: () => null,
}));
vi.mock("@/components/common/DownloadButton", () => ({ DownloadButton: () => null }));
// O painel mensal tem testes próprios; aqui só importa a estimativa manual.
vi.mock("@/components/estoque/ConsumoMensalPainel", () => ({ ConsumoMensalPainel: () => null }));
vi.mock("@/lib/estoque/consumo-mensal", () => ({ lerConsumoMensal: async () => ({ ok: false, message: "" }), lerPrevisaoInsumo: async () => null }));
vi.mock("@/components/estoque/EstoqueTables", () => ({
  SaldoTable: (props: unknown) => { io.saldo(props); return createElement("p", {}, "Saldo por insumo"); },
  LotesTable: () => null,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => createElement("a", { href }, children),
}));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (inicial: unknown) => [io.base ?? (typeof inicial === "function" ? inicial() : inicial), vi.fn()],
  useRef: () => io.enviado,
  useActionState: (action: (estado: EstadoRegistroConsumoManual, dados: FormData) => unknown, estado: EstadoRegistroConsumoManual) =>
    [io.resposta, (dados: FormData) => action(estado, dados), io.pending],
}));

const saldo = (insumo_id: number) => ({
  insumo_id, especificacao: `Insumo sintético ${insumo_id}`, unidade: "mL", unidade_saldo: "mL",
  em_maos: 14, disponivel: 10, reservado: 4, ponto_reposicao: 2,
});
const registro: RevisaoConsumoManual = {
  insumo_id: 12, revisao: 3, quantidade_embalagens_mes: 0, conteudo_embalagem: 250,
  unidade_conteudo: "mL", fonte: "Planilha sintética", motivo: "Conferência do período", data_referencia: "2026-11-07",
  ator_id: "00000000-0000-4000-8000-000000000099", registrado_em: "2026-11-07T12:00:00Z",
};
const apresentacao = { estado: "disponivel", conteudo: 250, unidade: "mL" } as const;
const nenhuma = {
  ok: true, estado: "nenhuma", vigente: null, historico: [], proxima_antes_da_revisao: null,
  apresentacao, podeRegistrar: false,
} satisfies ResultadoLeituraConsumoManual;
const registrada = {
  ...nenhuma, estado: "registrada", vigente: registro, historico: [registro],
} satisfies ResultadoLeituraConsumoManual;

beforeEach(() => {
  vi.resetAllMocks();
  io.resposta = { ok: false }; io.pending = false; io.enviado = { current: false }; io.base = undefined;
  io.ler.mockResolvedValue(nenhuma);
  io.registrar.mockResolvedValue({ ok: true, estado: "registrada", registro });
  io.from.mockImplementation((table: string) => {
    const chain = {
      select: () => chain, order: () => chain, range: () => chain, not: () => chain, in: () => chain,
      then: (resolve: (result: { data: unknown; error: unknown }) => void) => resolve({
        data: table === "v_estoque_saldo" ? [saldo(12), saldo(13)] : table === "v_previsao_suprimentos"
          ? [{ insumo_id: 12, consumo_medio_diario: 2.5, janela_dias: 31, unidade_saldo: "mL", dias_cobertura: 4, ponto_reposicao_sugerido: 18, qtd_sugerida_compra: 3 }]
          : [],
        error: null,
      }),
    };
    return chain;
  });
});

const render = async (query: { consumo_insumo?: string | string[]; consumo_antes?: string } = {}) =>
  renderToStaticMarkup(await EstoquePage({ searchParams: Promise.resolve(query) }));

describe("consumidor de estimativa manual no saldo", () => {
  it("oferece só insumos do saldo e não consulta por linha, por ID invisível ou por parâmetro ambíguo", async () => {
    const html = await render();
    expect(html).toContain("Insumo sintético 12");
    expect(html).toContain("Insumo sintético 13");
    expect(await render({ consumo_insumo: "999" })).toContain("Insumo indisponível nesta lista");
    expect(await render({ consumo_insumo: ["12", "13"] })).toContain("Insumo indisponível nesta lista");
    expect(await render({ consumo_insumo: "12", consumo_antes: "inválida" })).toContain("Página de histórico inválida");
    expect(io.ler).not.toHaveBeenCalled();
  });

  it("confirma ausência e deixa a escrita desabilitada sem tocar ORD81, cobertura ou Repor", async () => {
    const html = await render({ consumo_insumo: "12" });
    expect(io.ler.mock.calls).toEqual([[12, null, 25]]);
    expect(html).toContain("Nenhuma estimativa manual registrada");
    expect(html).toContain("Sua função não permite registrar estimativa");
    expect(html).not.toContain("Registrar estimativa manual");
    expect(io.saldo.mock.calls[0][0].rows[0]).toMatchObject({
      disponivel: 10, reservado: 4, consumoMedioDiario: 2.5, diasCobertura: 4, pontoSugerido: 18,
      situacoes: ["repor"], saidasDiarias: { estado: "provisoria", taxa: 2.5, janelaDias: 31, unidadeReferencia: "mL" },
    });
    expect(html).toContain("Escolha um insumo para ver quanto saiu do estoque");
  });

  it("mostra zero vigente, metadados e páginas de histórico sem oferecer escrita na página anterior", async () => {
    io.ler.mockResolvedValueOnce({ ...registrada, proxima_antes_da_revisao: 2 });
    const atual = await render({ consumo_insumo: "12" });
    expect(atual).toContain("0 embalagens/mês");
    for (const texto of ["Apresentação confirmada", "Data de referência", "Planilha sintética", "Conferência do período"]) expect(atual).toContain(texto);
    expect(atual).toContain("consumo_antes=2#consumo-manual");
    expect(atual).not.toContain(registro.ator_id);

    io.ler.mockResolvedValueOnce({ ...registrada, apresentacao: null, podeRegistrar: false, historico: [{ ...registro, revisao: 1 }] });
    const antiga = await render({ consumo_insumo: "12", consumo_antes: "2" });
    expect(io.ler).toHaveBeenLastCalledWith(12, 2, 25);
    expect(antiga).toContain("Revisões recentes");
    expect(antiga).toContain("Páginas anteriores são somente para consulta");
    expect(antiga).not.toContain("Sua função não permite registrar estimativa");
  });

  it("distingue erro de ausência e não habilita formulário sem apresentação disponível", async () => {
    io.ler.mockResolvedValueOnce({ ok: false, codigo: "FALHA_LEITURA", message: "Não foi possível ler a estimativa manual." });
    const erro = await render({ consumo_insumo: "12" });
    expect(erro).toContain("Estimativa indisponível");
    expect(erro).not.toContain("Nenhuma estimativa manual registrada");
    expect(erro).toContain("Saldo por insumo");

    io.ler.mockResolvedValueOnce({ ...nenhuma, podeRegistrar: true, apresentacao: { estado: "indisponivel", motivo: "FALHA_CATALOGO" } });
    const semApresentacao = await render({ consumo_insumo: "12" });
    expect(semApresentacao).toContain("quanto vem em cada embalagem");
    expect(semApresentacao).not.toContain("Registrar estimativa manual");
  });

  it("só habilita com leitura confirmada e usa UUID novo, revisão esperada e confirmação explícita", async () => {
    io.ler.mockResolvedValue({ ...registrada, podeRegistrar: true });
    const html = await render({ consumo_insumo: "12" });
    expect(html).toContain("Registrar estimativa manual");
    expect(html).toMatch(/name="operacao_id" value="[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"/);
    expect(html).toContain('name="revisao_esperada" value="3"');
    expect(html).toMatch(/<input(?=[^>]*name="apresentacao_confirmada")(?=[^>]*required)[^>]*>/);
    expect(io.registrar).not.toHaveBeenCalled();
  });
});

const base = {
  insumoId: 12, revisaoEsperada: 3, operacaoId: "00000000-0000-4000-8000-000000000042", conteudo: "250", unidade: "mL",
};
type Props = Record<string, unknown>;
function nodes(tree: unknown): ReactElement<Props>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return isValidElement<Props>(tree) ? [tree, ...nodes(tree.props.children)] : [];
}
function writer(preimagem = base) {
  return RegistrarConsumoManualForm({ preimagem });
}

describe("formulário de registro de estimativa", () => {
  it("despacha o payload exato com zero e impede duplo envio síncrono", async () => {
    const tree = writer();
    const nomes = nodes(tree).flatMap(({ props }) => typeof props.name === "string" ? [props.name] : []);
    const dados = new FormData();
    for (const { props } of nodes(tree)) if (props.type === "hidden") dados.set(String(props.name), String(props.value));
    for (const [nome, valor] of Object.entries({
      quantidade_embalagens_mes: "0", data_referencia: "2026-11-07", fonte: "Contagem", motivo: "Correção", apresentacao_confirmada: "1",
    })) dados.set(nome, valor);
    expect(nomes.sort()).toEqual([...dados.keys()].sort());
    expect(Object.fromEntries(dados)).toMatchObject({
      insumo_id: "12", operacao_id: base.operacaoId, revisao_esperada: "3", conteudo_embalagem_esperado: "250",
      unidade_conteudo_esperada: "mL", quantidade_embalagens_mes: "0", apresentacao_confirmada: "1",
    });
    const preventDefault = vi.fn();
    tree.props.onSubmit({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    await tree.props.action(dados);
    tree.props.onSubmit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(io.registrar).toHaveBeenCalledExactlyOnceWith({ ok: false }, dados);
  });

  it.each(["REVISAO_DIVERGENTE", "RESPOSTA_INVALIDA", "FALHA_ESCRITA"] as const)(
    "exige conferir histórico sem reenviar após %s",
    (codigo) => {
      io.resposta = { ok: false, codigo, message: "O registro não foi confirmado." };
      const tree = writer();
      const html = renderToStaticMarkup(tree);
      expect(html).toContain("Recarregar a página");
      expect(html).not.toContain('type="submit"');
      const preventDefault = vi.fn();
      tree.props.onSubmit({ preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(io.registrar).not.toHaveBeenCalled();
      const recarregar = nodes(tree).find(({ props }) => props.type === "button" && props.children === "Recarregar a página");
      const reload = vi.fn();
      vi.stubGlobal("window", { location: { reload } });
      try {
        (recarregar?.props.onClick as () => void)();
        expect(reload).toHaveBeenCalledOnce();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("não troca a preimagem de um formulário aberto quando a revisão muda", () => {
    io.base = base;
    const tree = writer({ ...base, revisaoEsperada: 4, operacaoId: "00000000-0000-4000-8000-000000000043" });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("A estimativa ou a embalagem mudou enquanto você preenchia.");
    expect(html).toContain('name="revisao_esperada" value="3"');
    expect(html).toContain(base.operacaoId);
    expect(html).not.toContain('type="submit"');
  });

  it("não confirma no transporte rejeitado nem reapresenta a action", async () => {
    io.registrar.mockRejectedValueOnce(new Error("transporte sintético"));
    const result = await writer().props.action(new FormData());
    expect(result).toEqual({ ok: false, codigo: "FALHA_ESCRITA", message: "O registro não foi confirmado." });
    expect(io.registrar).toHaveBeenCalledOnce();
  });

  it("mostra pendência e, só após recibo confirmado, a revisão sem botão de reenvio", () => {
    io.pending = true;
    const pendente = renderToStaticMarkup(writer());
    expect(pendente).toContain('aria-busy="true"');
    expect(pendente).toContain("Registrando…");
    expect(pendente).not.toContain("Estimativa registrada.");
    io.pending = false;
    io.resposta = { ok: true, estado: "registrada", registro };
    const confirmado = renderToStaticMarkup(writer());
    expect(confirmado).toContain("Estimativa registrada.");
    expect(confirmado).not.toContain('type="submit"');
  });
});
