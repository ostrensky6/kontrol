import { describe, expect, it } from "vitest";

import { aguardaLaboratorio, etapasAprovacao, normalizarAprovadores, travaDoEnvio, usuarioDecide } from "./aprovadores";

const completo = normalizarAprovadores({
  coordenador: { motivo: "coordenador_projeto", rotulo: "Coordenador do projeto Baía", nome: "Ana", email: "ana@x", ids: ["u-ana"] },
  falta_coordenador: null,
  laboratorio_exigido: true,
  laboratorio: { area_id: 3, area: "Genética", nome: "Sandra", substituto_nome: "Marcos", ids: ["u-sandra", "u-marcos"] },
  falta_laboratorio: null,
});

describe("aprovadores do pedido", () => {
  it("normaliza o JSON do banco e rejeita resposta vazia", () => {
    expect(normalizarAprovadores(null)).toBeNull();
    expect(completo?.coordenador?.ids).toEqual(["u-ana"]);
    expect(completo?.laboratorio?.area).toBe("Genética");
    expect(travaDoEnvio(completo)).toBeNull();
  });

  it("explica a trava quando falta coordenador", () => {
    const sem = normalizarAprovadores({
      coordenador: null,
      falta_coordenador: "O projeto \"X\" não tem coordenador cadastrado como usuário ativo.",
      laboratorio_exigido: false,
    });
    expect(travaDoEnvio(sem)).toContain("não tem coordenador");
    const [etapa] = etapasAprovacao(sem, { status: "rascunho" });
    expect(etapa).toMatchObject({ situacao: "travada", rotuloSituacao: "Trava o envio", quem: "Sem coordenador indicado" });
  });

  it("mostra as duas etapas na ordem e com texto da situação", () => {
    const emValidacao = etapasAprovacao(completo, { status: "em_validacao", natureza: "material_consumo_lab" });
    expect(emValidacao.map((e) => [e.chave, e.rotuloSituacao])).toEqual([
      ["coordenador", "Aguardando"],
      ["laboratorio", "Depois do coordenador"],
    ]);
    const validado = etapasAprovacao(completo, { status: "validado", natureza: "material_consumo_lab" });
    expect(validado[1]).toMatchObject({ situacao: "aguardando", quem: "Sandra" });
    expect(validado[1].detalhe).toContain("Substituto: Marcos");
    const aprovado = etapasAprovacao(completo, {
      status: "validado",
      natureza: "material_consumo_lab",
      aprovacao_area_em: "2026-11-09T12:00:00Z",
      aprovacao_area_por: "sandra@x",
    });
    expect(aprovado[1]).toMatchObject({ situacao: "feita", detalhe: "Aprovado por sandra@x." });
  });

  it("sabe quando o pedido espera o laboratório e quem decide", () => {
    expect(aguardaLaboratorio({ status: "validado", natureza: "material_consumo_lab" })).toBe(true);
    expect(aguardaLaboratorio({ status: "validado", natureza: "material_consumo_lab", aprovacao_area_em: "x" })).toBe(false);
    expect(aguardaLaboratorio({ status: "validado", natureza: "servico" })).toBe(false);
    expect(usuarioDecide(["u-ana"], "u-ana", false)).toBe(true);
    expect(usuarioDecide(["u-ana"], "u-bia", false)).toBe(false);
    expect(usuarioDecide(["u-ana"], "u-bia", true)).toBe(true);
  });
});
