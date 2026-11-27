import { describe, expect, it } from "vitest";

import { COLUNAS_QUADRO, colunasAprovacao, resumoItens, termoDeReferencia, type RegistroAprovacao } from "./quadro-aprovacoes";
import { PEDIDO_INTERNO_STATUS } from "./status";

const envio = (criado_em: string, status_origem = "rascunho"): RegistroAprovacao => ({
  etapa: "Lista de materiais",
  decisao: "registrado",
  status_origem,
  criado_em,
});
const projetoAprovou: RegistroAprovacao = {
  etapa: "Validação das especificações técnicas",
  decisao: "aprovado",
  responsavel: "sandra@example.com",
  comentario: "Informações de modelo, volume e quantidade confirmadas.",
  status_origem: "em_validacao",
  criado_em: "2026-11-20T10:00:00Z",
};

describe("quadro de aprovações", () => {
  it("mostra as colunas na ordem pedida: laboratório, financeiro, projeto", () => {
    expect(COLUNAS_QUADRO.map((c) => c.chave)).toEqual(["laboratorio", "financeiro", "projeto"]);
  });

  it("todo status do fluxo dá uma situação para as três colunas", () => {
    for (const status of Object.keys(PEDIDO_INTERNO_STATUS)) {
      const c = colunasAprovacao({ status, natureza: "material_consumo_lab" }, []);
      for (const chave of ["laboratorio", "financeiro", "projeto"] as const) {
        expect(c[chave].rotulo, `${status}/${chave}`).not.toBe("");
      }
    }
  });

  it("pedido enviado: vez do coordenador do projeto, o resto ainda não chegou", () => {
    const c = colunasAprovacao({ status: "em_validacao", natureza: "material_consumo_lab" }, [envio("2026-11-19T10:00:00Z")]);
    expect(c.projeto.situacao).toBe("aguardando");
    expect(c.laboratorio.situacao).toBe("futura");
    expect(c.financeiro.situacao).toBe("futura");
  });

  it("aprovado pelo projeto e esperando o laboratório: verde no projeto, amarelo no laboratório", () => {
    const c = colunasAprovacao({ status: "validado", natureza: "material_consumo_lab" }, [envio("2026-11-19T10:00:00Z"), projetoAprovou]);
    expect(c.projeto).toMatchObject({ situacao: "aprovado", quem: "sandra@example.com", quando: "2026-11-20T10:00:00Z" });
    expect(c.laboratorio.situacao).toBe("aguardando");
    expect(c.financeiro.situacao).toBe("futura");
  });

  it("devolução do laboratório fica vermelha com o motivo até o reenvio", () => {
    const devolucao: RegistroAprovacao = {
      etapa: "Aprovação da coordenação do laboratório",
      decisao: "devolvido",
      responsavel: "vilmar@example.com",
      comentario: "  Falta o volume das ponteiras.  ",
      status_origem: "validado",
      criado_em: "2026-11-21T09:00:00Z",
    };
    const antes = colunasAprovacao({ status: "ajuste_solicitante", natureza: "material_consumo_lab" }, [projetoAprovou, devolucao]);
    expect(antes.laboratorio).toMatchObject({ situacao: "devolvido", rotulo: "Devolvido", motivo: "Falta o volume das ponteiras." });
    // a aprovação do projeto continua valendo (0175)
    expect(antes.projeto.situacao).toBe("aprovado");

    const reenviado = colunasAprovacao({ status: "validado", natureza: "material_consumo_lab" }, [
      projetoAprovou,
      devolucao,
      envio("2026-11-22T09:00:00Z", "ajuste_solicitante"),
    ]);
    expect(reenviado.laboratorio.situacao).toBe("aguardando");
  });

  it("devolução do projeto respondida e aprovada depois fica verde", () => {
    const c = colunasAprovacao({ status: "validado", natureza: "material_consumo_geral" }, [
      { ...projetoAprovou, decisao: "devolvido", comentario: "Rever quantidade", criado_em: "2026-11-18T10:00:00Z" },
      envio("2026-11-19T10:00:00Z", "ajuste_solicitante"),
      projetoAprovou,
    ]);
    expect(c.projeto.situacao).toBe("aprovado");
    expect(c.laboratorio.situacao).toBe("nao_se_aplica");
    expect(c.financeiro.situacao).toBe("aguardando");
  });

  it("financeiro: análise devolvida fica vermelha; autorizada fica verde", () => {
    const devolvida = colunasAprovacao({ status: "ajuste_compras", natureza: "material_consumo_geral" }, [
      projetoAprovou,
      {
        etapa: "Análise de fonte de recurso, rubrica e conformidade",
        decisao: "devolvido",
        responsavel: "financeiro@example.com",
        comentario: "Rubrica errada",
        status_origem: "analise_administrativa",
        criado_em: "2026-11-23T10:00:00Z",
      },
    ]);
    expect(devolvida.financeiro).toMatchObject({ situacao: "devolvido", motivo: "Rubrica errada" });

    const autorizada = colunasAprovacao({ status: "orcamentos", natureza: "material_consumo_geral" }, [
      projetoAprovou,
      {
        etapa: "Liberação para cotação",
        decisao: "aprovado",
        responsavel: "financeiro@example.com",
        status_origem: "analise_administrativa",
        criado_em: "2026-11-24T10:00:00Z",
      },
    ]);
    expect(autorizada.financeiro).toMatchObject({ situacao: "aprovado", quem: "financeiro@example.com" });
  });

  it("pedido antigo sem registro: o status já diz que as aprovações passaram", () => {
    const c = colunasAprovacao({ status: "compra_concluida", natureza: "material_consumo_lab" }, []);
    expect(c.projeto.situacao).toBe("aprovado");
    expect(c.financeiro.situacao).toBe("aprovado");
    // antes da 0169 não havia aprovação do laboratório: não inventa uma
    expect(c.laboratorio.situacao).toBe("nao_se_aplica");
  });

  it("laboratório aprovado sem registro na tabela usa a data gravada no pedido", () => {
    const c = colunasAprovacao(
      { status: "formalizado", natureza: "material_consumo_lab", aprovacao_area_em: "2026-11-25T12:00:00Z", aprovacao_area_por: "gisela@example.com" },
      [projetoAprovou],
    );
    expect(c.laboratorio).toMatchObject({ situacao: "aprovado", quem: "gisela@example.com" });
    expect(c.financeiro.situacao).toBe("aguardando");
  });

  it("reprovação fica vermelha, com o motivo, mesmo depois de qualquer envio", () => {
    const c = colunasAprovacao({ status: "cancelado", natureza: "material_consumo_lab" }, [
      envio("2026-11-19T10:00:00Z"),
      {
        etapa: "Aprovação da coordenação do laboratório",
        decisao: "reprovado",
        responsavel: "juliana@example.com",
        comentario: "Material já existe no estoque do campo.",
        status_origem: "validado",
        criado_em: "2026-11-20T10:00:00Z",
      },
    ]);
    expect(c.laboratorio).toMatchObject({ situacao: "reprovado", rotulo: "Reprovado", motivo: "Material já existe no estoque do campo." });
    expect(c.financeiro.situacao).toBe("nao_se_aplica");
  });

  it("rascunho e cancelado", () => {
    const rascunho = colunasAprovacao({ status: "rascunho", natureza: "material_consumo_lab" }, []);
    expect([rascunho.laboratorio.situacao, rascunho.financeiro.situacao, rascunho.projeto.situacao]).toEqual(["futura", "futura", "futura"]);
    const cancelado = colunasAprovacao({ status: "cancelado", natureza: "material_consumo_lab" }, [projetoAprovou]);
    expect(cancelado.projeto.situacao).toBe("aprovado");
    expect(cancelado.financeiro.situacao).toBe("nao_se_aplica");
  });

  it("termo de referência e resumo dos itens", () => {
    expect(termoDeReferencia([{ id: 3, tipo: "proposta" }, { id: 5, tipo: "termo_referencia" }, { id: 4, tipo: "termo_referencia" }])?.id).toBe(5);
    expect(termoDeReferencia([{ id: 3, tipo: "proposta" }])).toBeNull();
    expect(resumoItens([{ especificacao: "Luva M" }, { especificacao: "Ponteira 10 µL" }, { especificacao: "Etanol" }, { especificacao: "Agarose" }])).toBe(
      "Luva M; Ponteira 10 µL; Etanol +1",
    );
    expect(resumoItens([])).toBe("Sem itens");
  });
});
