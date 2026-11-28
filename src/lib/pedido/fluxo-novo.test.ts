import { describe, expect, it } from "vitest";

import { etapasAprovacao, idsDaVezFluxoNovo, normalizarAprovadores, travaDoEnvio } from "./aprovadores";
import { datasDoCiclo } from "./ciclo";
import { etapaDoPedido } from "./etapas";
import { motivoItensSemCadastro } from "./item-novo";
import { proximoPasso } from "./proximo-passo";
import { colunasAprovacao } from "./quadro-aprovacoes";
import { textoReenvio } from "./reenvio";
import { motivoCotacaoIncompleta, type Orcamento } from "./orcamentos";
import { emAprovacaoFluxoNovo, naCotacaoFluxoNovo, pedidoDoFluxoNovo, pedidoInternoStatus } from "./status";
import { vezFluxoNovo } from "./vez-fluxo-novo";

/** 0188: ordem nova das aprovações (Antonio e Rafaela, 27/11/2026). */
const bruto = {
  fluxo: 2,
  coordenador: { motivo: "coordenador_projeto", rotulo: "Coordenador do projeto Piraupiá", nome: "Sandra", email: null, ids: ["coord"] },
  falta_coordenador: null,
  laboratorio_exigido: true,
  laboratorio: { area_id: 1, area: "Genética", nome: "Gisela", substituto_nome: null, ids: ["lab"] },
  falta_laboratorio: null,
  financeiro: { nome: "Nathieli Cozer", ids: ["fin"] },
  falta_financeiro: null,
};
const aprovadores = normalizarAprovadores(bruto)!;

describe("ordem nova das aprovações (0188)", () => {
  it("status novos têm rótulo; laboratório e financeiro na Aprovação, cotação e projeto na Cotação (0189)", () => {
    expect(pedidoInternoStatus("aguardando_area").label).toBe("Aguardando laboratório ou campo");
    expect(pedidoInternoStatus("aguardando_financeiro").label).toBe("Aguardando financeiro");
    expect(pedidoInternoStatus("aguardando_cotacao").label).toBe("Cotação com o solicitante");
    expect(pedidoInternoStatus("aguardando_projeto").label).toBe("Aguardando coordenador do projeto");
    for (const status of ["aguardando_area", "aguardando_financeiro", "aguardando_projeto"]) {
      expect(emAprovacaoFluxoNovo(status)).toBe(true);
    }
    expect(etapaDoPedido({ status: "aguardando_area" })).toBe("aprovacao");
    expect(etapaDoPedido({ status: "aguardando_financeiro" })).toBe("aprovacao");
    expect(etapaDoPedido({ status: "aguardando_cotacao" })).toBe("cotacao");
    expect(etapaDoPedido({ status: "aguardando_projeto" })).toBe("cotacao");
    // a cotação não é aprovação: quem pediu registra os orçamentos e envia
    expect(emAprovacaoFluxoNovo("aguardando_cotacao")).toBe(false);
    expect(naCotacaoFluxoNovo("aguardando_cotacao")).toBe(true);
    expect(emAprovacaoFluxoNovo("em_validacao")).toBe(false);
    expect(pedidoDoFluxoNovo({ fluxo: 2 })).toBe(true);
    expect(pedidoDoFluxoNovo({})).toBe(false);
  });

  it("lê o financeiro e a ordem do banco; a vez de cada um vem do status", () => {
    expect(aprovadores.fluxo).toBe(2);
    expect(aprovadores.financeiro?.nome).toBe("Nathieli Cozer");
    expect(idsDaVezFluxoNovo(aprovadores, "aguardando_area")).toEqual(["lab"]);
    expect(idsDaVezFluxoNovo(aprovadores, "aguardando_financeiro")).toEqual(["fin"]);
    expect(idsDaVezFluxoNovo(aprovadores, "aguardando_projeto")).toEqual(["coord"]);
    expect(idsDaVezFluxoNovo(aprovadores, "aguardando_cotacao")).toEqual([]);
    expect(idsDaVezFluxoNovo(aprovadores, "aprovado_para_compra")).toEqual([]);
  });

  it("o laboratório ou campo trava o envio antes do coordenador", () => {
    const semArea = normalizarAprovadores({ ...bruto, laboratorio: null, falta_laboratorio: "Escolha o laboratório ou o campo", falta_coordenador: "Sem coordenador" });
    expect(travaDoEnvio(semArea)).toBe("Escolha o laboratório ou o campo");
  });

  it("'Quem aprova' mostra as três na ordem: feitas, a da vez e as que vêm depois", () => {
    const etapas = etapasAprovacao(aprovadores, { status: "aguardando_financeiro", aprovacao_area_por: "gisela@x" });
    expect(etapas.map((e) => [e.chave, e.situacao])).toEqual([
      ["laboratorio", "feita"],
      ["financeiro", "aguardando"],
      ["coordenador", "futura"],
    ]);
    expect(etapas[0].detalhe).toBe("Aprovado por gisela@x.");
    const rascunho = etapasAprovacao(aprovadores, { status: "rascunho" });
    expect(rascunho.map((e) => e.rotuloSituacao)).toEqual(["Depois do envio", "Depois da anterior", "Depois da cotação"]);
    // 0189: na cotação, laboratório e financeiro feitos; o coordenador vem depois dela
    const cotacao = etapasAprovacao(aprovadores, { status: "aguardando_cotacao" });
    expect(cotacao.map((e) => [e.chave, e.situacao, e.rotuloSituacao])).toEqual([
      ["laboratorio", "feita", "Feita"],
      ["financeiro", "feita", "Feita"],
      ["coordenador", "futura", "Depois da cotação"],
    ]);
    const aprovado = etapasAprovacao(aprovadores, { status: "aprovado_para_compra" });
    expect(aprovado.every((e) => e.situacao === "feita")).toBe(true);
  });

  it("quadro: as colunas seguem a vez e a parada", () => {
    const registros = [
      { etapa: "Envio para aprovação", decisao: "registrado", status_origem: "rascunho", criado_em: "2026-11-27T10:00:00Z" },
      { etapa: "Aprovação do laboratório ou campo", decisao: "aprovado", responsavel: "gisela@x", status_origem: "aguardando_area", criado_em: "2026-11-27T11:00:00Z" },
      { etapa: "Aprovação financeira", decisao: "devolvido", responsavel: "fin@x", comentario: "Falta o CNPJ", status_origem: "aguardando_financeiro", criado_em: "2026-11-27T12:00:00Z" },
    ];
    const devolvido = colunasAprovacao({ status: "ajuste_solicitante", fluxo: 2 }, registros);
    expect(devolvido.laboratorio.situacao).toBe("aprovado");
    expect(devolvido.laboratorio.quem).toBe("gisela@x");
    expect(devolvido.financeiro.situacao).toBe("devolvido");
    expect(devolvido.financeiro.motivo).toBe("Falta o CNPJ");
    expect(devolvido.projeto.situacao).toBe("futura");

    const reenvio = [...registros, { etapa: "Reenvio depois do ajuste", decisao: "registrado", status_origem: "ajuste_solicitante", criado_em: "2026-11-27T13:00:00Z" }];
    const deVolta = colunasAprovacao({ status: "aguardando_financeiro", fluxo: 2 }, reenvio);
    expect([deVolta.laboratorio.situacao, deVolta.financeiro.situacao, deVolta.projeto.situacao]).toEqual(["aprovado", "aguardando", "futura"]);

    const reprovado = colunasAprovacao({ status: "cancelado", fluxo: 2 }, [
      registros[0],
      { etapa: "Aprovação do laboratório ou campo", decisao: "reprovado", comentario: "Não é do laboratório", status_origem: "aguardando_area", criado_em: "2026-11-27T11:00:00Z" },
    ]);
    expect(reprovado.laboratorio.situacao).toBe("reprovado");
    expect(reprovado.financeiro.situacao).toBe("nao_se_aplica");

    const naCotacao = colunasAprovacao({ status: "aguardando_cotacao", fluxo: 2 }, registros.slice(0, 2));
    expect([naCotacao.laboratorio.situacao, naCotacao.financeiro.situacao, naCotacao.projeto.situacao]).toEqual(["aprovado", "aprovado", "futura"]);
    expect(naCotacao.projeto.rotulo).toBe("Depois da cotação");

    const liberado = colunasAprovacao({ status: "compra_fechada", fluxo: 2 }, []);
    expect([liberado.laboratorio.situacao, liberado.financeiro.situacao, liberado.projeto.situacao]).toEqual(["aprovado", "aprovado", "aprovado"]);
  });

  it("próximo passo diz o nome de quem aprova em cada vez", () => {
    expect(proximoPasso({ status: "rascunho", fluxo: 2 }).depois).toContain("laboratório ou campo");
    expect(proximoPasso({ status: "aguardando_area", fluxo: 2 }, { laboratorio: "Gisela (Genética)" }).responsavel).toBe("Gisela (Genética)");
    expect(proximoPasso({ status: "aguardando_financeiro", fluxo: 2 }, { financeiro: "Nathieli Cozer" })).toMatchObject({
      acao: "Escolher a fonte de pagamento e aprovar",
      responsavel: "Nathieli Cozer (financeiro)",
    });
    expect(proximoPasso({ status: "aguardando_projeto", fluxo: 2 }, { coordenador: "Sandra", coordenadorRotulo: "Coordenador do projeto" }).responsavel).toBe(
      "Sandra (Coordenador do projeto)",
    );
    expect(proximoPasso({ status: "aguardando_cotacao", fluxo: 2 }, { solicitante: "rafaela@x" })).toMatchObject({
      acao: "Fazer a cotação: 3 orçamentos e enviar",
      responsavel: "rafaela@x (quem pediu)",
    });
    expect(proximoPasso({ status: "aguardando_financeiro", fluxo: 2 }).depois).toContain("quem pediu faz a cotação");
    expect(proximoPasso({ status: "aprovado_para_compra", fluxo: 2 }, { cicloAbreEm: "2026-12-01" }).acao).toContain("Aguardar o ciclo");
  });

  it("de quem é a vez: titular, substituto ou espera", () => {
    const base = { aprovadores, comoSubstituto: "como Administrador", podeGerir: true, rotuloStatus: "Aguardando financeiro" };
    const titular = vezFluxoNovo({ ...base, pedido: { status: "aguardando_financeiro", fluxo: 2 }, usuarioId: "fin", substituto: false });
    expect(titular.podeDecidir).toBe(true);
    expect(titular.vez?.texto).toContain("fonte de pagamento");
    const admin = vezFluxoNovo({ ...base, pedido: { status: "aguardando_financeiro", fluxo: 2 }, usuarioId: "outro", substituto: true });
    expect(admin.vez?.texto).toBe("Você pode decidir como Administrador, na ausência de Nathieli Cozer.");
    const outro = vezFluxoNovo({ ...base, pedido: { status: "aguardando_financeiro", fluxo: 2 }, usuarioId: "outro", substituto: false });
    expect(outro.podeDecidir).toBe(false);
    expect(outro.vez?.tom).toBe("espera");
    expect(outro.motivoSemDecisao).toContain("A vez é de Nathieli Cozer");
    const antigo = vezFluxoNovo({ ...base, pedido: { status: "em_validacao" }, usuarioId: "coord", substituto: false });
    expect(antigo.vez).toBeNull();
  });

  it("0189: a cotação é de quem pediu; na ausência, o substituto; os outros esperam", () => {
    const base = { aprovadores, comoSubstituto: "como Administrador", podeGerir: true, rotuloStatus: "Cotação com o solicitante" };
    const pedido = { status: "aguardando_cotacao", fluxo: 2, solicitante: "Rafaela@X" };
    const dono = vezFluxoNovo({ ...base, pedido, usuarioId: "raf", emailUsuario: "rafaela@x", substituto: false });
    expect(dono.podeCotar).toBe(true);
    expect(dono.podeDecidir).toBe(false);
    expect(dono.vez?.texto).toContain("Faça a cotação");
    const admin = vezFluxoNovo({ ...base, pedido, usuarioId: "adm", emailUsuario: "adm@x", substituto: true });
    expect(admin.podeCotar).toBe(true);
    expect(admin.vez?.texto).toContain("na ausência de quem pediu");
    const coordenador = vezFluxoNovo({ ...base, pedido, usuarioId: "coord", emailUsuario: "coord@x", substituto: false });
    expect(coordenador.podeCotar).toBe(false);
    expect(coordenador.vez).toEqual({ tom: "espera", rotulo: "Cotação com o solicitante", texto: null });
  });

  it("0189: o que falta na cotação (3 fornecedores, 3 com documento)", () => {
    const orc = (id: number, fornecedor_nome: string, anexo_id: number | null) =>
      ({ id, fornecedor_nome, valor_total: 100 + id, anexo_id }) as unknown as Orcamento;
    expect(motivoCotacaoIncompleta([orc(1, "A", 1), orc(2, "a", 2)])).toBe(
      "A cotação precisa de 3 orçamentos de fornecedores diferentes. Faltam 2.",
    );
    expect(motivoCotacaoIncompleta([orc(1, "A", 1), orc(2, "B", null), orc(3, "C", 3)])).toBe(
      "Cada orçamento vai com o documento do fornecedor (PDF ou imagem). 2 de 3 têm.",
    );
    expect(motivoCotacaoIncompleta([orc(1, "A", 1), orc(2, "B", 2), orc(3, "C", 3)])).toBeNull();
  });

  it("reenvio na ordem nova volta para quem devolveu, ou recomeça", () => {
    const igual = { mantem: true, mudou: [], motivo: "igual" as const, valorAtual: 10, valorValidado: 10, aguardaLaboratorio: false };
    expect(textoReenvio(igual, { fluxoNovo: true, devolvidoNaEtapa: "aguardando_projeto" })).toContain("volta direto para o coordenador do projeto");
    const mudou = { ...igual, mantem: false, mudou: ["valor"], motivo: "mudou" as const, valorAtual: 20 };
    expect(textoReenvio(mudou, { fluxoNovo: true })).toContain("três aprovações");
  });

  it("o ciclo conta da aprovação do coordenador do projeto, na ordem nova", () => {
    const datas = datasDoCiclo(
      [
        { status_origem: "rascunho", status_destino: "aguardando_area", criado_em: "2026-11-05T10:00:00Z" },
        { status_origem: "aguardando_projeto", status_destino: "aprovado_para_compra", criado_em: "2026-11-12T10:00:00Z" },
      ],
      "2026-11-06T10:00:00Z",
    );
    expect(datas).toEqual({ solicitadoEm: "2026-11-05T10:00:00Z", aprovadoEm: "2026-11-12T10:00:00Z" });
  });
});

describe("item novo na ordem nova", () => {
  it("pede o cadastro antes de aprovar (financeiro), não antes de formalizar", () => {
    const itens = [{ tipo: "material", insumo_id: null }];
    expect(motivoItensSemCadastro(itens, { podeCadastrar: true, fluxoNovo: true })).toBe(
      "Há 1 item novo, ainda sem cadastro. Use “Cadastrar insumo” na lista de itens antes de aprovar.",
    );
    expect(motivoItensSemCadastro(itens, { podeCadastrar: true })).toContain("antes de formalizar.");
  });
});
