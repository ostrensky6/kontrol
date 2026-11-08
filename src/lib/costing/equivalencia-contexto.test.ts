import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lerContextoEquivalencia } from "./equivalencia-contexto";

const { rpc, createClientUntyped } = vi.hoisted(() => ({ rpc: vi.fn(), createClientUntyped: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped }));
const versao = "equivalencia-contexto-autorizado-v1";
const candidato = { insumo_id: 91, especificacao: "SKU sintético", fabricante: null, codigo_fabricante: null,
  codigo_interno: null, quantidade_embalagem: 100, unidade_estoque: "frasco", unidade_consumo: "reação", fator_conversao: 100 };
function contexto() {
  return {
    versao, estado: "disponivel", codigo_analise: "A1", metodo_revisao_ref: "metodo:M1:r2",
    estado_validacoes: "disponivel", instante: 1000, revisao_contexto: `contexto:${"a".repeat(32)}`,
    capacidades: { consultar: true, registrar: true, revogar: true },
    necessidades: [{ necessidade_id: 11, etapa_id: null, nome_etapa: "Preparo", nome_atividade: "Mistura",
      unidade_consumo: "reação", quantidade_por_base: 2, modo_cobranca: "por_amostra", base_calculo: null,
      insumo_receita_id: null, etapa_contexto: null, candidatos: [{ ...candidato }] }],
    equipamentos: [{ equipamento_id: 31, nome: "Equipamento sintético" }],
    decisoes: [{ decisao_ref: "equivalencia:81", necessidade_id: 11, etapa_id: null,
      insumo_id: 91, equipamento_id: null, apresentacao_ref: "apresentacao:91:r1", evidencia_ref: "laudo:r1",
      unidade_estoque: "frasco", unidade_consumo: "reação", fator_conversao: 100,
      vigente_desde: 100, vigente_ate: null as number | null, estado: "validada", pode_revogar: true }],
    referencias_documentais: "atestacao_explicita_sem_catalogo_de_revisoes",
    candidatos_sao_equivalencias: false, cas_escrita: false,
  };
}
let data: ReturnType<typeof contexto>;
beforeEach(() => {
  data = contexto();
  rpc.mockReset().mockImplementation(async () => ({ data, error: null }));
  createClientUntyped.mockReset().mockResolvedValue({ rpc });
});
afterEach(() => {
  expect(rpc.mock.calls.every(([name]) => name === "ler_equivalencia_contexto_autorizado_v1")).toBe(true);
});

describe("fonte de contexto autorizado 0160 para a UI", () => {
  it("consulta somente código e revisão na sessão e devolve dimensões/autorizações factuais", async () => {
    expect(await lerContextoEquivalencia(" A1 ", " metodo:M1:r2 ")).toEqual(data);
    expect(rpc.mock.calls).toEqual([["ler_equivalencia_contexto_autorizado_v1", {
      p_codigo: "A1", p_metodo_revisao_ref: "metodo:M1:r2",
    }]]);
    expect(createClientUntyped).toHaveBeenCalledTimes(1);
  });

  it("não infere capacidade a partir da presença de decisões ou candidatos", async () => {
    data.capacidades.registrar = false; data.capacidades.revogar = false; data.decisoes[0].pode_revogar = false;
    expect(await lerContextoEquivalencia("A1", "metodo:M1:r2")).toMatchObject({ estado: "disponivel",
      capacidades: { consultar: true, registrar: false, revogar: false } });
  });

  it("distingue vazio confirmado, negação, limite e erro técnico", async () => {
    data.necessidades = []; data.equipamentos = []; data.decisoes = [];
    expect(await lerContextoEquivalencia("A1", "metodo:M1:r2")).toMatchObject({ estado: "disponivel", necessidades: [] });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "detalhe privado" } });
    expect(await lerContextoEquivalencia("A1", "metodo:M1:r2")).toEqual({ versao, estado: "negado", motivo: "sem_permissao" });
    rpc.mockResolvedValueOnce({ data: { versao, estado: "indisponivel", motivo: "limite_contexto" }, error: null });
    expect(await lerContextoEquivalencia("A1", "metodo:M1:r2")).toMatchObject({ estado: "indisponivel", motivo: "limite_contexto" });
    rpc.mockRejectedValueOnce(new Error("detalhe privado"));
    expect(await lerContextoEquivalencia("A1", "metodo:M1:r2")).toEqual({ versao, estado: "indisponivel", motivo: "falha_de_leitura" });
  });

  it("preserva revogação autorizada de decisão expirada ou com drift, sem anunciá-la novamente após revogar", async () => {
    data.estado_validacoes = "contexto_divergente";
    data.decisoes[0].vigente_ate = 900;
    expect(await lerContextoEquivalencia("A1", "metodo:M1:r2")).toMatchObject({ estado: "disponivel",
      decisoes: [{ pode_revogar: true }] });
    data.decisoes[0].estado = "revogada"; data.decisoes[0].pode_revogar = false;
    expect(await lerContextoEquivalencia("A1", "metodo:M1:r2")).toMatchObject({ estado: "disponivel",
      decisoes: [{ pode_revogar: false }] });
  });

  it.each(["", " ", "x".repeat(161)])("recusa revisão inválida sem RPC (%s)", async (metodo) => {
    expect(await lerContextoEquivalencia("A1", metodo)).toMatchObject({ estado: "indisponivel", motivo: "entrada_invalida" });
    expect(createClientUntyped).not.toHaveBeenCalled();
  });

  it.each(["codigo", "metodo", "necessidade_duplicada", "equipamento_duplicado", "decisao_duplicada", "candidato_duplicado",
    "dimensao", "fator", "revogada_com_capacidade", "capacidade_sem_permissao", "vigencia", "cas_ficticio", "equivalencia_inferida", "ator", "preco", "sem_versao"])(
    "falha fechado diante de contrato incoerente: %s", async (caso) => {
      if (caso === "codigo") data.codigo_analise = "A2";
      if (caso === "metodo") data.metodo_revisao_ref = "M2";
      if (caso === "necessidade_duplicada") data.necessidades.push(data.necessidades[0]);
      if (caso === "equipamento_duplicado") data.equipamentos.push(data.equipamentos[0]);
      if (caso === "decisao_duplicada") data.decisoes.push(data.decisoes[0]);
      if (caso === "candidato_duplicado") data.necessidades[0].candidatos.push({ ...candidato });
      if (caso === "dimensao") data.necessidades[0].candidatos[0].unidade_consumo = "ml";
      if (caso === "fator") data.necessidades[0].candidatos[0].fator_conversao = 0;
      if (caso === "revogada_com_capacidade") data.decisoes[0].estado = "revogada";
      if (caso === "capacidade_sem_permissao") data.capacidades.revogar = false;
      if (caso === "vigencia") data.decisoes[0].vigente_ate = 50;
      if (caso === "cas_ficticio") data.cas_escrita = true;
      if (caso === "equivalencia_inferida") data.candidatos_sao_equivalencias = true;
      if (caso === "ator") Object.assign(data.decisoes[0], { ator_id: "privado" });
      if (caso === "preco") Object.assign(data.necessidades[0].candidatos[0], { custo_unitario: 1 });
      if (caso === "sem_versao") data.revisao_contexto = "";
      expect(await lerContextoEquivalencia("A1", "metodo:M1:r2")).toEqual({ versao, estado: "indisponivel", motivo: "contrato_invalido" });
    },
  );
});

describe("contrato SQL 0160 — inspeção estática, não execução de SQL", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/0160_equivalencia_contexto_autorizado.sql", import.meta.url), "utf8");
  const fixture = readFileSync(new URL("../../../supabase/tests/equivalencia_contexto_autorizado_0160.sql", import.meta.url), "utf8");
  it("reutiliza autorização0154 antes de ler perfil e limita o escopo", () => {
    expect(sql.indexOf("v_fonte := public.ler_equivalencia_contextual_v1")).toBeLessThan(sql.indexOf("select p.papel"));
    expect(sql).toContain("v_papel in ('laboratorio','coordenador','supervisor')");
    expect(sql).toContain("d.codigo_analise = v_codigo and d.metodo_revisao_ref = v_metodo");
    expect(sql).toContain("public.registrar_equivalencia_contextual_v1(text,text,jsonb)', 'EXECUTE'");
    expect(sql).toContain("public.revogar_equivalencia_contextual_v1(bigint,text)', 'EXECUTE'");
    expect(sql).toContain("'cas_escrita',false");
    expect(sql).toContain("'motivo','limite_contexto'");
  });
  it("só acrescenta funções de leitura, sem table grant, escrita, substituição ou novo banco de decisões", () => {
    expect(sql).not.toMatch(/^\s*(insert|update|delete|alter table|create table|create or replace|drop|truncate)\b/im);
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete|usage|all)\b/i);
    expect(sql).toContain("returns jsonb language sql security invoker set search_path = ''");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toMatch(/grant execute[\s\S]+to authenticated;/);
  });
  it("deixa fixture FK-safe em transação com negações, grants, drift e rollback, para E2 posterior", () => {
    expect(fixture).toContain("ORD131 exige clone sintético vazio");
    expect(fixture).toContain("['sem_sessao','suspenso','provisorio']");
    expect(fixture).toContain("revoke usage on schema public");
    expect(fixture).toContain("revoke execute on function public.registrar_equivalencia_contextual_v1");
    expect(fixture.trimEnd().endsWith("rollback;")).toBe(true);
  });
});
