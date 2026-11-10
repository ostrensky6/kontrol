import { describe, expect, it } from "vitest";

import { PEDIDO_INTERNO_STATUS } from "./status";
import { proximoPasso } from "./proximo-passo";

describe("proximoPasso", () => {
  it("todo status do banco tem próximo passo escrito, com responsável", () => {
    for (const status of Object.keys(PEDIDO_INTERNO_STATUS)) {
      const passo = proximoPasso({ status });
      expect(passo.acao, status).not.toBe("Revisar pedido");
      expect(passo.responsavel, status).toBeTruthy();
    }
    expect(proximoPasso({ status: "desconhecido" })).toEqual({ acao: "Revisar pedido", responsavel: "Operação", depois: null });
  });

  it("a ação tem o mesmo nome do botão que o coordenador aperta", () => {
    expect(proximoPasso({ status: "rascunho" }).acao).toBe("Enviar para aprovação");
    expect(proximoPasso({ status: "em_validacao" }).acao).toBe("Aprovar pedido");
    expect(proximoPasso({ status: "analise_administrativa" }).acao).toBe("Autorizar compra");
    expect(proximoPasso({ status: "aguardando_aprovacao_final" }).acao).toBe("Aprovar compra final");
  });

  it("na aprovação diz o nome de quem aprova; sem projeto, a Supervisão", () => {
    expect(proximoPasso({ status: "em_validacao" }, { coordenador: "Sandra", coordenadorRotulo: "Coordenador do projeto" })).toEqual({
      acao: "Aprovar pedido",
      responsavel: "Sandra (Coordenador do projeto)",
      depois: "o Administrativo formaliza a compra.",
    });
    expect(proximoPasso({ status: "em_validacao" }, { coordenador: "—" }).responsavel).toBe(
      "Coordenador do projeto (sem projeto: Supervisão)",
    );
    expect(proximoPasso({ status: "em_validacao" }, { semProjeto: true }).responsavel).toBe("Supervisão");
  });

  it("material de laboratório passa pela coordenação do laboratório antes de seguir", () => {
    const lab = { natureza: "material_consumo_lab" };
    expect(proximoPasso({ status: "em_validacao", ...lab }).depois).toBe(
      "a coordenação do laboratório também aprova, por ser material de laboratório.",
    );
    expect(proximoPasso({ status: "validado", ...lab }, { laboratorio: "Sandra (Genética)" })).toEqual({
      acao: "Aprovar pelo laboratório",
      responsavel: "Sandra (Genética)",
      depois: "o Administrativo formaliza a compra.",
    });
    expect(proximoPasso({ status: "validado", ...lab, aprovacao_area_em: "2026-11-01" }).acao).toBe("Formalizar em compras");
  });

  it("pedido do ciclo seguinte espera o ciclo abrir", () => {
    const passo = proximoPasso({ status: "validado" }, { cicloAbreEm: "2099-12-01" });
    expect(passo.acao).toBe("Aguardar o ciclo de dezembro/2099");
    expect(passo.responsavel).toBe("Compras/Administrativo, a partir de 01/12/2099");
    // fora do status validado o ciclo não trava nada
    expect(proximoPasso({ status: "formalizado" }, { cicloAbreEm: "2099-12-01" }).acao).toBe("Registrar análise administrativa");
  });

  it("processo encerrado não tem passo seguinte", () => {
    expect(proximoPasso({ status: "compra_concluida" }).depois).toBeNull();
    expect(proximoPasso({ status: "cancelado" }).depois).toBeNull();
  });
});
