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
    select: () => {
      const consulta = {
        eq: () => consulta,
        in: () => consulta,
        limit: async () => resultado(),
        order: async () => resultado(),
        then: (resolve: (value: ReturnType<typeof resultado>) => unknown) => resolve(resultado()),
      };
      return consulta;
    },
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
vi.mock("@/lib/auth/roles", () => ({ usuarioAtual: vi.fn(async () => ({ id: "u-1", email: "estoque@lab" })) }));
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

  it("coluna Códigos de barras só acrescenta códigos ao insumo, sem repetir GTIN-14 e EAN-13", async () => {
    db.insumos = [insumoExistente()];
    db.identificadores = [];
    const { importarCadastrosWorkbook } = await import("./cadastros");

    const result = await importarCadastrosWorkbook(
      { ok: false },
      await planilha({
        Insumos: [
          [...CABECALHO_INSUMOS, "Códigos de barras"],
          [9, "Kit existente", "Marca X", "kit", null, 100, 10, "7891234567895; 07891234567895"],
        ],
      }),
    );

    expect(result.ok).toBe(true);
    expect(inserts).toEqual([
      {
        table: "identificadores",
        payload: [
          expect.objectContaining({
            codigo: "7891234567895",
            valor: "7891234567895",
            tipo: "codigo_barras",
            entidade_tipo: "insumo",
            entidade_id: 9,
            ativo: true,
          }),
        ],
      },
    ]);
    expect(updates.filter((u) => u.table === "identificadores")).toEqual([]);
    expect(result.resumo?.[0]).toMatchObject({ atualizados: 1 });
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
    // Sem valor: entra sem custo, com aviso (não recusa a linha).
    expect(result.resumo?.[0]).toMatchObject({ inseridos: 2, ignorados: 1 });
    expect(result.resumo?.[0].erros).toEqual([
      "Linha 4, Quantidade (embalagens fechadas): use um número inteiro de embalagens",
    ]);
    expect(result.resumo?.[0].avisos).toContain("Linha 3: sem Valor da embalagem; cadastrado sem custo (preencha depois).");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("completa insumo novo com campos vazios e não perde a linha por fornecedor desconhecido", async () => {
    db.fornecedores = [{ id: 7, nome: "KASVI IMPORTACAO E DISTRIBUICAO DE PRODUTOS PARA LABORATORIO LTDA" }];
    const { importarCadastrosWorkbook } = await import("./cadastros");

    const result = await importarCadastrosWorkbook(
      { ok: false },
      await planilha({
        Insumos: [
          ["Item específico / SKU", "Unidade de consumo", "Fornecedor principal", "Fornecedor alternativo"],
          ["Tubo PCR", "caixa", "KASVI IMPORTACAO E DISTRIBUICAO DE PRODUTOS PARA LABOR", "Fornecedor que não existe"],
          ["Luva", null, null, null],
        ],
      }),
    );

    expect(result.resumo?.[0]).toMatchObject({ inseridos: 2, ignorados: 0 });
    const dados = rpc.mock.calls.map((chamada) => chamada[1].p_dados_insumo);
    expect(dados[0]).toMatchObject({ especificacao: "Tubo PCR", unidade: "caixa", quantidade_embalagem: 1, custo_total_embalagem: 0, fornecedor_id: 7 });
    expect(dados[0].fornecedor_alt_id ?? null).toBeNull();
    expect(dados[1]).toMatchObject({ especificacao: "Luva", unidade: "unidade" });
    const avisos = result.resumo?.[0].avisos.join("\n") ?? "";
    expect(avisos).toContain('Linha 2, Fornecedor alternativo: "Fornecedor que não existe" não encontrado no cadastro; ficou em branco');
    expect(avisos).toContain('Linha 2: sem Unidade da embalagem; usada a Unidade de consumo ("caixa").');
    expect(avisos).toContain('Linha 3: sem Unidade da embalagem nem de consumo; considerado "unidade"');
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
    expect(semAba.message).toContain('"Planilha1"');
    expect(semAba.message).toContain("Item específico / SKU");
  });

  it("importa a planilha do usuário com outro nome de aba, título antes do cabeçalho e aba no singular", async () => {
    const { importarCadastrosWorkbook } = await import("./cadastros");

    const propria = await importarCadastrosWorkbook(
      { ok: false },
      await planilha({
        Planilha1: [
          ["Lista de reagentes do laboratório"],
          [],
          ["Insumo", "Marca / fabricante", "Unidade da embalagem", "Valor da embalagem (R$)", "Quantidade na embalagem"],
          ["Etanol absoluto", "Merck", "frasco", 120, 1],
        ],
      }),
    );
    expect(propria.resumo?.map((r) => r.aba)).toEqual(["Insumos"]);
    expect(propria.resumo?.[0].avisos.join(" ")).toContain('A aba "Planilha1" foi importada como Insumos');
    expect(propria.resumo?.[0].avisos.join(" ")).toContain("Cabeçalho encontrado na linha 3");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1].p_dados_insumo).toMatchObject({ especificacao: "Etanol absoluto" });

    rpc.mockClear();
    const singular = await importarCadastrosWorkbook({ ok: false }, await planilha({ insumo: [CABECALHO_INSUMOS] }));
    expect(singular.resumo?.map((r) => r.aba)).toEqual(["Insumos"]);
  });

  it("importa planilha que o ExcelJS não abre, pelos valores das células", async () => {
    const JSZip = (await import("jszip")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Minha lista");
    ws.addRow(["Insumo", "Unidade da embalagem", "Valor da embalagem (R$)", "Quantidade na embalagem"]);
    ws.addRow(["Etanol absoluto", "frasco", 120, 1]);
    const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    zip.file("xl/worksheets/sheet1.xml", sheet.replace("</worksheet>", '<drawing r:id="rId99"/></worksheet>'));
    const formData = new FormData();
    formData.set("arquivo", new File([await zip.generateAsync({ type: "arraybuffer" })], "qualquer nome.xlsx"));

    const { importarCadastrosWorkbook } = await import("./cadastros");
    const resultado = await importarCadastrosWorkbook({ ok: false }, formData);

    expect(resultado.resumo?.map((r) => r.aba)).toEqual(["Insumos"]);
    expect(resultado.resumo?.[0].avisos.join(" ")).toContain("só pelos valores");
    expect(rpc.mock.calls[0][1].p_dados_insumo).toMatchObject({ especificacao: "Etanol absoluto" });
  });

  it("explica o que fazer com .xls antigo e com texto salvo como planilha", async () => {
    const { importarCadastrosWorkbook } = await import("./cadastros");
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const formXls = new FormData();
    formXls.set("arquivo", new File([xls], "aa.xls"));
    const resultadoXls = await importarCadastrosWorkbook({ ok: false }, formXls);
    expect(resultadoXls.ok).toBe(false);
    expect(resultadoXls.message).toContain("Excel 97-2003");
    expect(resultadoXls.message).toContain("Salvar como");

    const formCsv = new FormData();
    formCsv.set("arquivo", new File(["Insumo;Unidade\nEtanol;frasco\n"], "aa.xls"));
    const resultadoCsv = await importarCadastrosWorkbook({ ok: false }, formCsv);
    expect(resultadoCsv.message).toContain("é texto");
  });
});
