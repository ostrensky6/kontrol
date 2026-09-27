import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const revalidatePath = vi.fn();
let db: Record<string, Row[]> = {};
const updates: { table: string; payload: Row; id: unknown }[] = [];
const inserts: { table: string; payload: Row }[] = [];
const deletes: string[] = [];
const rpc = vi.fn();

function from(table: string) {
  const resultado = () => ({ data: db[table] ?? [], error: null });
  return {
    select: () => ({
      order: async () => resultado(),
      then: (resolve: (value: ReturnType<typeof resultado>) => unknown) => resolve(resultado()),
    }),
    update: (payload: Row) => ({
      eq: async (_coluna: string, id: unknown) => {
        updates.push({ table, payload, id });
        return { error: null };
      },
    }),
    insert: async (payload: Row) => {
      inserts.push({ table, payload });
      return { error: null };
    },
    delete: () => {
      deletes.push(table);
      return { eq: async () => ({ error: null }) };
    },
  };
}

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClientUntyped: vi.fn(async () => ({ from, rpc })),
}));

const CABECALHO_INSUMOS = [
  "ID",
  "Item específico / SKU",
  "Marca / fabricante",
  "Unidade",
  "Quantidade (embalagens fechadas)",
  "Valor da embalagem (R$)",
  "Quantidade na embalagem",
];

async function planilha(abas: Record<string, unknown[][]>) {
  const workbook = new ExcelJS.Workbook();
  for (const [nome, linhas] of Object.entries(abas)) {
    const sheet = workbook.addWorksheet(nome);
    for (const linha of linhas) sheet.addRow(linha);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const formData = new FormData();
  formData.set("arquivo", new File([buffer], "cadastros.xlsx"));
  return formData;
}

const insumoExistente = (overrides: Row = {}): Row => ({
  id: 9,
  especificacao: "Kit existente",
  tipo_insumo_id: 4,
  codigo_interno: "INT-9",
  nome_item: null,
  fabricante: "Marca X",
  custo_total_embalagem: 100,
  quantidade_embalagem: 10,
  unidade: "kit",
  unidade_consumo: "kit",
  fator_conversao: 1,
  custo_unitario: 10,
  ponto_reposicao: 0,
  estoque_seguranca: 0,
  ...overrides,
});

describe("importação XLSX de cadastros (só adicionar e atualizar)", () => {
  beforeEach(() => {
    db = { insumos: [], clientes: [], lotes_estoque: [], tipo_insumos: [], fornecedores: [] };
    updates.length = 0;
    inserts.length = 0;
    deletes.length = 0;
    revalidatePath.mockReset();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { insumo_id: 50, repetido: false }, error: null });
  });

  it("nunca exclui registros ausentes da planilha", async () => {
    db.insumos = [insumoExistente(), insumoExistente({ id: 10, especificacao: "Fora da planilha" })];
    db.clientes = [{ id: 1, nome: "Cliente antigo", ativo: true }];
    const { importarCadastrosWorkbook } = await import("./cadastros");

    const result = await importarCadastrosWorkbook(
      { ok: false },
      await planilha({
        Insumos: [CABECALHO_INSUMOS, [9, "Kit existente", "Marca X", "kit", null, 100, 10]],
        Clientes: [["Razão social / nome"], ["Cliente novo"]],
      }),
    );

    expect(result.ok).toBe(true);
    expect(deletes).toEqual([]);
    expect(inserts).toEqual([{ table: "clientes", payload: expect.objectContaining({ nome: "Cliente novo", ativo: true }) }]);
    expect(result.resumo?.map((r) => r.aba)).toEqual(["Clientes", "Insumos"]);
    expect(result.message).toContain("Nada foi excluído");
  });

  it("atualiza só as colunas alteradas, sem anular campos não exportados", async () => {
    db.insumos = [insumoExistente()];
    const { importarCadastrosWorkbook } = await import("./cadastros");

    const result = await importarCadastrosWorkbook(
      { ok: false },
      await planilha({
        // fabricante em branco = manter; tipo técnico/código interno nem existem na planilha
        Insumos: [CABECALHO_INSUMOS, [9, "Kit existente", null, "kit", null, "120,00", 10]],
      }),
    );

    expect(result.ok).toBe(true);
    expect(updates).toEqual([
      { table: "insumos", id: 9, payload: { custo_total_embalagem: 120, custo_unitario: 12 } },
    ]);
    expect(result.resumo?.[0]).toMatchObject({ atualizados: 1, inseridos: 0, inalterados: 0 });
  });

  it("linha idêntica ao cadastro conta como sem alteração e não grava", async () => {
    db.insumos = [insumoExistente()];
    const { importarCadastrosWorkbook } = await import("./cadastros");

    const result = await importarCadastrosWorkbook(
      { ok: false },
      await planilha({ Insumos: [CABECALHO_INSUMOS, [9, "Kit existente", "Marca X", "kit", 0, 100, 10]] }),
    );

    expect(updates).toEqual([]);
    expect(result.resumo?.[0]).toMatchObject({ inalterados: 1, atualizados: 0, avisos: [] });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("cria insumo novo com quantidade pela RPC, com operacao_id determinístico por arquivo e linha", async () => {
    const { importarCadastrosWorkbook } = await import("./cadastros");
    const arquivo = await planilha({
      Insumos: [CABECALHO_INSUMOS, [null, "Kit novo", "Marca Y", "kit", 3, "1.234,56", "10"]],
    });

    const primeira = await importarCadastrosWorkbook({ ok: false }, arquivo);
    const segunda = await importarCadastrosWorkbook({ ok: false }, arquivo);

    expect(primeira.ok).toBe(true);
    expect(segunda.ok).toBe(true);
    expect(inserts).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(2);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("criar_insumo_com_quantidade");
    expect(args).toMatchObject({
      p_quantidade_embalagens: 3,
      p_dados_insumo: expect.objectContaining({
        especificacao: "Kit novo",
        custo_total_embalagem: 1234.56,
        quantidade_embalagem: 10,
        unidade_consumo: "kit",
        fator_conversao: 1,
      }),
    });
    expect(args.p_dados_insumo).not.toHaveProperty("custo_unitario");
    expect(args.p_dados_insumo).not.toHaveProperty("quantidade");
    expect(args.p_operacao_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rpc.mock.calls[1][1].p_operacao_id).toBe(args.p_operacao_id);
  });

  it("reenvio repetido pela RPC não conta como nova inserção", async () => {
    rpc.mockResolvedValue({ data: { insumo_id: 50, repetido: true }, error: null });
    const { importarCadastrosWorkbook } = await import("./cadastros");

    const result = await importarCadastrosWorkbook(
      { ok: false },
      await planilha({ Insumos: [CABECALHO_INSUMOS, [null, "Kit novo", null, "kit", 2, 10, 1]] }),
    );

    expect(result.resumo?.[0]).toMatchObject({ inseridos: 0, inalterados: 1 });
    expect(result.resumo?.[0].avisos[0]).toContain("já importada antes");
  });

  it("ignora a quantidade de itens existentes e avisa quando difere do estoque", async () => {
    db.insumos = [insumoExistente()];
    db.lotes_estoque = [
      { insumo_id: 9, status: "aceito", quantidade_atual: 2, validade: null, validade_apos_abertura: null, data_abertura: null },
    ];
    const { importarCadastrosWorkbook } = await import("./cadastros");

    const result = await importarCadastrosWorkbook(
      { ok: false },
      await planilha({ Insumos: [CABECALHO_INSUMOS, [9, "Kit existente", "Marca X", "kit", 7, 100, 10]] }),
    );

    expect(rpc).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.resumo?.[0].avisos).toEqual([
      "Linha 2: Quantidade (embalagens fechadas) ignorada para item existente (atual 2, planilha 7). Registre entradas e baixas em Estoque.",
    ]);
  });

  it("erros citam o rótulo da coluna e a linha; as demais linhas seguem", async () => {
    const { importarCadastrosWorkbook } = await import("./cadastros");

    const result = await importarCadastrosWorkbook(
      { ok: false },
      await planilha({
        Insumos: [
          CABECALHO_INSUMOS,
          [null, "Kit ok", null, "kit", null, "12,50", 1],
          [null, "Kit sem valor", null, "kit", null, null, 1],
          [null, "Kit fracionado", null, "kit", "1,5", 10, 1],
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.resumo?.[0]).toMatchObject({ inseridos: 1, ignorados: 2 });
    expect(result.resumo?.[0].erros).toEqual([
      "Linha 3, Valor da embalagem (R$): obrigatório",
      "Linha 4, Quantidade (embalagens fechadas): use um número inteiro de embalagens",
    ]);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("modelo exportado traz Instruções, quantidade atual e volta sem alterações ao ser reimportado", async () => {
    db.insumos = [insumoExistente({ data_validade: "2027-03-05", fornecedor_id: 3 })];
    db.fornecedores = [{ id: 3, nome: "Fornecedor Três" }];
    db.lotes_estoque = [
      { insumo_id: 9, status: "aceito", quantidade_atual: 2, validade: null, validade_apos_abertura: null, data_abertura: null },
    ];
    const { buildCadastrosWorkbook } = await import("@/lib/cadastros/xlsx");
    const { importarCadastrosWorkbook } = await import("./cadastros");

    const workbook = await buildCadastrosWorkbook("insumos");
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Instruções", "Insumos"]);
    const instrucoes = workbook.getWorksheet("Instruções")!.getColumn(1).values.join("\n");
    expect(instrucoes).toContain("nenhum registro é excluído");
    expect(instrucoes).toContain("só vale para itens novos");
    expect(instrucoes).toContain("Insumos: Item específico / SKU, Valor da embalagem (R$), Quantidade na embalagem, Unidade da embalagem, Fator de conversão");

    const aba = workbook.getWorksheet("Insumos")!;
    const cabecalho = (aba.getRow(1).values as unknown[]).slice(1);
    const colunaQuantidade = cabecalho.indexOf("Quantidade (embalagens fechadas)") + 1;
    expect(cabecalho.indexOf("Unidade da embalagem") + 2).toBe(colunaQuantidade);
    expect(aba.getRow(2).getCell(colunaQuantidade).value).toBe(2);
    expect(String(aba.getRow(1).getCell(colunaQuantidade).note)).toContain("Só para itens novos");

    const buffer = await workbook.xlsx.writeBuffer();
    const formData = new FormData();
    formData.set("arquivo", new File([buffer], "modelo.xlsx"));
    const result = await importarCadastrosWorkbook({ ok: false }, formData);

    expect(result.ok).toBe(true);
    expect(result.resumo?.[0]).toMatchObject({ inalterados: 1, atualizados: 0, inseridos: 0, avisos: [] });
    expect(updates).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("aceita planilha só com a aba Insumos e recusa planilha sem aba reconhecida", async () => {
    const { importarCadastrosWorkbook } = await import("./cadastros");

    const soInsumos = await importarCadastrosWorkbook(
      { ok: false },
      await planilha({ Instruções: [["texto"]], Insumos: [CABECALHO_INSUMOS] }),
    );
    expect(soInsumos.ok).toBe(true);
    expect(soInsumos.resumo?.map((r) => r.aba)).toEqual(["Insumos"]);

    const semAba = await importarCadastrosWorkbook({ ok: false }, await planilha({ Planilha1: [["x"]] }));
    expect(semAba.ok).toBe(false);
    expect(semAba.message).toContain("Nenhuma aba de cadastro encontrada");
  });
});
