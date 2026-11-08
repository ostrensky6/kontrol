import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EquivalenciaFicha } from "./EquivalenciaFicha";

const io = vi.hoisted(() => ({ ler: vi.fn() }));
vi.mock("@/lib/costing/equivalencia-fonte", () => ({ lerFonteEquivalencia: io.ler }));
vi.mock("@/lib/costing/equivalencia-contexto", () => ({ lerContextoEquivalencia: async () => ({ estado: "indisponivel", motivo: "falha_de_leitura" }) }));
vi.mock("./EquivalenciaRevisionadaForm", () => ({ EquivalenciaRevisionadaForm: () => null }));
vi.mock("@/components/common/HelpTip", () => ({ HelpTip: ({ children }: { children: React.ReactNode }) => children }));
const instante = Date.parse("2026-11-07T12:00:00Z");
const decisao = {
  codigo_analise: "A1", necessidade_id: 10, etapa_id: null, metodo_revisao_ref: "documento:r2", equipamento_ref: null,
  insumo_id: 20, apresentacao_ref: "embalagem:r1", decisao_ref: "equivalencia:30", evidencia_ref: "relatorio:r1",
  validador_id: "ator-decisao:0123456789abcdef0123456789abcdef", papel_validador: "laboratorio", estado: "validada",
  unidade_estoque: "frasco", unidade_consumo: "mL", fator_conversao: 100, vigente_desde: instante - 1000, vigente_ate: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  io.ler.mockResolvedValue({ estado: "disponivel", versao: "equivalencia-contextual-v1", instante, decisoes: [] });
});
const render = async (metodoRevisaoRef?: string, escritaHabilitada = false) => renderToStaticMarkup(await EquivalenciaFicha({ codigo: "A1", metodoRevisaoRef, escritaHabilitada }));

describe("ORD121 consumidor contextual da ficha", () => {
  it("não escolhe revisão nem consulta sem filtro explícito", async () => {
    expect(await render()).toContain("Informe o método e a revisão");
    expect(await render(" ")).toContain("Informe o método e a revisão");
    expect(await render("x".repeat(161))).toContain("no máximo 160 caracteres");
    expect(io.ler).not.toHaveBeenCalled();
  });
  it("consulta a fonte real por código/revisão; vazio não afirma equivalência", async () => {
    const html = await render(" documento:r2 ");
    expect(io.ler).toHaveBeenCalledExactlyOnceWith("A1", "documento:r2");
    expect(html).toContain("Nenhuma decisão registrada");
    expect(html).toContain("Isso não confirma equivalência");
    expect(html).toContain('method="get"');
    expect(html).toContain('value="materiais-insumos"');
  });
  it.each(["falha_de_leitura", "contrato_invalido", "contexto_divergente"])("distingue %s da ausência", async (motivo) => {
    io.ler.mockResolvedValue({ estado: "indisponivel", motivo });
    const html = await render("documento:r2");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Nenhuma decisão registrada");
    expect(html).toContain("consultar novamente");
  });
  it("mostra contexto por IDs, vigência, revogação e proveniência sem agrupar nomes", async () => {
    io.ler.mockResolvedValue({ estado: "disponivel", versao: "equivalencia-contextual-v1", instante, decisoes: [
      decisao, { ...decisao, decisao_ref: "equivalencia:31", estado: "revogada" },
      { ...decisao, decisao_ref: "equivalencia:32", vigente_ate: instante - 1 },
    ] });
    const html = await render("documento:r2");
    for (const trecho of ["Vigente na leitura", "Revogada", "Fora da vigência", "Necessidade #10", "SKU #20", "Sem etapa", "Sem equipamento", "relatorio:r1", "ator-decisao:", "não altera cálculos, emissão ou histórico"]) expect(html).toContain(trecho);
  });
  it.each([false, true])("sem projeção de autorização não cria escrita mesmo com flag %s", async (flag) => {
    const html = await render("documento:r2", flag);
    expect(html).not.toMatch(/method="post"|name="confirmada"|name="papel"|name="ator"|name="necessidade_id"/);
    expect(html).toContain(flag ? "Nenhuma capacidade de escrita presumida" : "escrita revisionada de validações técnicas está desabilitada");
  });
});
