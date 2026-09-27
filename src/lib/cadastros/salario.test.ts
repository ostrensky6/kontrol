import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CADASTROS } from "@/lib/cadastros/config";
import { VALOR_MASCARADO, estaMascarado } from "@/lib/cadastros/mascara";
import {
  camposTecnicosParaUsuario,
  carregarTecnicos,
  colunasCalculadasTecnico,
  lerLinhasCadastro,
  mascararAuditoriaSigilosa,
  mesclarRemuneracao,
  precoCatalogoMascarado,
  prepararSalarioTecnico,
} from "@/lib/cadastros/salario";
import { valueForCell } from "@/lib/cadastros/xlsx";
import {
  createMockSupabaseClient,
  getMockSupabaseStore,
  resetMockSupabaseStore,
} from "@/lib/testing/mock-supabase";

const tecnicos = [
  { id: 1, nome: "Ana", processo: "Laboratório", horas_mes_base: 160, percentual_dedicado: 50 },
  { id: 2, nome: "Bia", processo: "Bioinformática", horas_mes_base: 100, percentual_dedicado: 10 },
];

function cliente(papel?: string) {
  return createMockSupabaseClient({ papel }) as unknown as SupabaseClient;
}

afterEach(() => resetMockSupabaseStore());

describe("máscara do salário dos técnicos", () => {
  it("reconhece XXX com tolerância a caixa/espaços e nada além disso", () => {
    expect(estaMascarado("XXX")).toBe(true);
    expect(estaMascarado(" xxx ")).toBe(true);
    expect(estaMascarado("")).toBe(false);
    expect(estaMascarado(0)).toBe(false);
    expect(estaMascarado(null)).toBe(false);
  });

  it("sem permissão, troca o salário por XXX mesmo que a RPC devolva valores", () => {
    const linhas = mesclarRemuneracao(tecnicos, [{ id: 1, valor_mes: 8000 }], false);
    expect(linhas.map((l) => l.valor_mes)).toEqual([VALOR_MASCARADO, VALOR_MASCARADO]);
  });

  it("com permissão, junta o valor real por id e falha fechada quando o banco devolve NULL", () => {
    const linhas = mesclarRemuneracao(
      tecnicos,
      [{ id: 1, valor_mes: "8000" }, { id: 2, valor_mes: null }],
      true,
    );
    expect(linhas[0].valor_mes).toBe(8000);
    expect(linhas[1].valor_mes).toBe(VALOR_MASCARADO);
  });

  it("mascara também custo/hora e valor HH (permitiriam recalcular o salário)", () => {
    expect(colunasCalculadasTecnico({ ...tecnicos[0], valor_mes: VALOR_MASCARADO })).toMatchObject({
      custo_hora: VALOR_MASCARADO,
      valor_hh: VALOR_MASCARADO,
    });
    expect(colunasCalculadasTecnico({ ...tecnicos[0], valor_mes: 8000 })).toMatchObject({
      custo_hora: 50,
      valor_hh: 25,
    });
  });

  it("sem permissão, o campo de salário do formulário vira somente leitura e opcional", () => {
    const campos = CADASTROS.tecnicos.campos;
    const mascarados = camposTecnicosParaUsuario(campos, false);
    const salario = mascarados.find((c) => c.name === "valor_mes");
    expect(salario).toMatchObject({ mascarado: true, obrigatorio: false });
    expect(mascarados.filter((c) => c.mascarado)).toHaveLength(1);
    expect(camposTecnicosParaUsuario(campos, true)).toBe(campos);
  });
});

describe("gravação do salário", () => {
  it("sem permissão, nunca envia valor_mes (formulário ou importação)", () => {
    for (const contexto of ["formulario", "importacao"] as const) {
      const r = prepararSalarioTecnico({ nome: "Ana", valor_mes: "9999" }, { podeVer: false, contexto });
      expect(r.semSalario).toBe(true);
      expect(r.obj).not.toHaveProperty("valor_mes");
      expect(r.obj).toMatchObject({ nome: "Ana" });
    }
  });

  it("XXX mantém o valor atual mesmo para quem tem permissão", () => {
    const r = prepararSalarioTecnico({ valor_mes: "XXX" }, { podeVer: true, contexto: "importacao" });
    expect(r).toEqual({ obj: {}, semSalario: true });
  });

  it("em branco: importação mantém o atual; formulário continua exigindo", () => {
    expect(prepararSalarioTecnico({}, { podeVer: true, contexto: "importacao" }).semSalario).toBe(true);
    expect(prepararSalarioTecnico({ valor_mes: "" }, { podeVer: true, contexto: "formulario" })).toEqual({
      obj: { valor_mes: "" },
      semSalario: false,
    });
  });

  it("com permissão e valor numérico, grava normalmente", () => {
    expect(prepararSalarioTecnico({ valor_mes: 7000 }, { podeVer: true, contexto: "formulario" })).toEqual({
      obj: { valor_mes: 7000 },
      semSalario: false,
    });
  });
});

describe("leitura server-side com o mock do banco", () => {
  function semear() {
    getMockSupabaseStore().tecnicos = tecnicos.map((t, i) => ({ ...t, valor_mes: [8000, 5000][i] }));
  }

  it("select('*') em tecnicos é negado, como no banco após a 0112", async () => {
    semear();
    const { data, error } = await cliente().from("tecnicos").select("*");
    expect(data).toBeNull();
    expect(error).toMatchObject({ code: "42501" });
  });

  it("admin (permissão padrão) recebe o salário real", async () => {
    semear();
    const { data, error } = await carregarTecnicos(cliente(), true);
    expect(error).toBeNull();
    expect(data?.map((r) => r.valor_mes)).toEqual([8000, 5000]);
  });

  it("gestor sem a permissão recebe XXX mesmo se o app pedir o valor", async () => {
    semear();
    const { data } = await carregarTecnicos(cliente("gestor"), true);
    expect(data?.map((r) => r.valor_mes)).toEqual([VALOR_MASCARADO, VALOR_MASCARADO]);
    expect(JSON.stringify(data)).not.toContain("8000");
  });

  it("a permissão concedida à categoria libera o salário", async () => {
    semear();
    const categorias = getMockSupabaseStore().permissoes_categorias;
    const gestor = categorias.find((c) => c.papel === "gestor");
    const original = gestor!.permissoes;
    gestor!.permissoes = { ...(original as object), "tecnicos.salario.ver": true };
    try {
      const { data } = await carregarTecnicos(cliente("gestor"), true);
      expect(data?.map((r) => r.valor_mes)).toEqual([8000, 5000]);
    } finally {
      gestor!.permissoes = original;
    }
  });

  it("lerLinhasCadastro usa colunas explícitas só para tecnicos", async () => {
    semear();
    const { data } = await lerLinhasCadastro(cliente("tecnico"), "tecnicos", { podeVerSalario: false });
    expect(Object.keys(data![0]).sort()).toEqual(
      ["ativo", "horas_mes_base", "id", "nome", "percentual_dedicado", "processo", "valor_mes"].sort(),
    );
    expect(data![0].valor_mes).toBe(VALOR_MASCARADO);
  });

  it("valor-hora de pessoal só existe como agregado", async () => {
    semear();
    const { data } = await cliente("tecnico").rpc("valor_hora_pessoal_total");
    // 8000/160×50% + 5000/100×10% = 25 + 5
    expect(data).toBeCloseTo(30);
  });
});

describe("exportação XLSX", () => {
  it("escreve XXX na célula de salário mascarado", () => {
    const campo = CADASTROS.tecnicos.campos.find((c) => c.name === "valor_mes");
    expect(valueForCell(VALOR_MASCARADO, campo)).toBe(VALOR_MASCARADO);
    expect(valueForCell(8000, campo)).toBe(8000);
  });
});

describe("catálogo PE e auditoria", () => {
  it("considera mascarado o PE sem preço ou marcado pelo banco", () => {
    expect(precoCatalogoMascarado({ rubrica: "PE", preco_unitario: null })).toBe(true);
    expect(precoCatalogoMascarado({ rubrica: "PE", preco_unitario: 10, preco_mascarado: true })).toBe(true);
    expect(precoCatalogoMascarado({ rubrica: "PE", preco_unitario: 10, preco_mascarado: false })).toBe(false);
    expect(precoCatalogoMascarado({ rubrica: "MC", preco_unitario: null })).toBe(false);
  });

  it("mascara salário e preço PE na trilha para quem não tem permissão", () => {
    const tecnico = {
      tabela: "tecnicos_remuneracao",
      valor_anterior: { id: 1, valor_mes: 8000 },
      valor_novo: { id: 1, valor_mes: 9000 },
    };
    expect(mascararAuditoriaSigilosa(tecnico, false)).toMatchObject({
      valor_anterior: { valor_mes: VALOR_MASCARADO },
      valor_novo: { valor_mes: VALOR_MASCARADO },
    });
    expect(mascararAuditoriaSigilosa(tecnico, true)).toBe(tecnico);

    const pe = {
      tabela: "orcamento_projeto_catalogo",
      valor_anterior: null,
      valor_novo: { rubrica: "PE", preco_unitario: 5000, descricao: "Fulana" },
    };
    expect(mascararAuditoriaSigilosa(pe, false).valor_novo).toMatchObject({
      preco_unitario: VALOR_MASCARADO,
      descricao: "Fulana",
    });
    const mc = { ...pe, valor_novo: { rubrica: "MC", preco_unitario: 10 } };
    expect(mascararAuditoriaSigilosa(mc, false)).toBe(mc);
  });

  it("a RPC do catálogo esconde só o preço de PE para quem não tem permissão", async () => {
    getMockSupabaseStore().orcamento_projeto_catalogo = [
      { id: "PE-1", rubrica: "PE", descricao: "Fulana", preco_unitario: 5000 },
      { id: "MC-1", rubrica: "MC", descricao: "Balde", preco_unitario: 50 },
    ];
    const { data } = await cliente("coordenador").rpc("orcamento_projeto_catalogo_listar");
    const porId = Object.fromEntries((data as { id: string }[]).map((item) => [item.id, item]));
    expect(porId["PE-1"]).toMatchObject({ preco_unitario: null, preco_mascarado: true });
    expect(porId["MC-1"]).toMatchObject({ preco_unitario: 50, preco_mascarado: false });

    const direto = await cliente().from("orcamento_projeto_catalogo").select("id, preco_unitario");
    expect(direto.error).toMatchObject({ code: "42501" });
  });
});
