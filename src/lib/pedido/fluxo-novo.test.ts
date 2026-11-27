import { describe, expect, it } from "vitest";

import { etapasAprovacao, idsDaVezFluxoNovo, normalizarAprovadores, travaDoEnvio } from "./aprovadores";
import { datasDoCiclo } from "./ciclo";
import { etapaDoPedido } from "./etapas";
import { motivoItensSemCadastro } from "./item-novo";
import { faltaNosOrcamentosParaEnviar, lerOrcamentosNovoPedido } from "./orcamentos-novo-pedido";
import { proximoPasso } from "./proximo-passo";
import { colunasAprovacao } from "./quadro-aprovacoes";
import { textoReenvio } from "./reenvio";
import { emAprovacaoFluxoNovo, pedidoDoFluxoNovo, pedidoInternoStatus } from "./status";
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
  it("status novos têm rótulo e caem na etapa Aprovação", () => {
    expect(pedidoInternoStatus("aguardando_area").label).toBe("Aguardando laboratório ou campo");
    expect(pedidoInternoStatus("aguardando_financeiro").label).toBe("Aguardando financeiro");
    expect(pedidoInternoStatus("aguardando_projeto").label).toBe("Aguardando coordenador do projeto");
    for (const status of ["aguardando_area", "aguardando_financeiro", "aguardando_projeto"]) {
      expect(etapaDoPedido({ status })).toBe("aprovacao");
      expect(emAprovacaoFluxoNovo(status)).toBe(true);
    }
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
    expect(rascunho.map((e) => e.rotuloSituacao)).toEqual(["Depois do envio", "Depois da anterior", "Depois da anterior"]);
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

describe("orçamentos junto com o pedido (0188)", () => {
  function formulario(linhas: Record<string, string | File>) {
    const dados = new FormData();
    for (const [k, v] of Object.entries(linhas)) dados.set(k, v);
    return dados;
  }

  it("lê as linhas preenchidas e ignora as em branco", () => {
    const pdf = new File([new Uint8Array(5)], "a.pdf", { type: "application/pdf" });
    const { orcamentos, erro } = lerOrcamentosNovoPedido(
      formulario({
        orcamentos_indices: "0,1,2",
        orcamento_0_fornecedor_nome: "Loja A",
        orcamento_0_valor: "1.234,50",
        orcamento_0_prazo: "10",
        orcamento_0_arquivo: pdf,
        orcamento_1_fornecedor_nome: "Loja B",
        orcamento_1_valor: "99.9",
        orcamento_2_arquivo: new File([], ""),
      }),
    );
    expect(erro).toBeNull();
    expect(orcamentos.map((o) => [o.fornecedor_nome, o.valor_total, o.prazo_entrega_dias, Boolean(o.arquivo)])).toEqual([
      ["Loja A", 1234.5, 10, true],
      ["Loja B", 99.9, null, false],
    ]);
  });

  it("linha pela metade volta com o número da linha", () => {
    expect(lerOrcamentosNovoPedido(formulario({ orcamentos_indices: "0,1", orcamento_1_valor: "10" })).erro).toBe(
      "Orçamento 2: escolha o fornecedor ou escreva o nome dele.",
    );
    expect(lerOrcamentosNovoPedido(formulario({ orcamentos_indices: "0", orcamento_0_fornecedor_nome: "Loja" })).erro).toBe(
      "Orçamento 1: informe o valor total (maior que zero).",
    );
  });

  it("para enviar: 3 fornecedores diferentes, cada um com o documento", () => {
    expect(faltaNosOrcamentosParaEnviar([{ nome: "A", comDocumento: true }, { nome: "a", comDocumento: true }])).toBe(
      "O pedido vai com 3 orçamentos de fornecedores diferentes. Faltam 2.",
    );
    expect(
      faltaNosOrcamentosParaEnviar([
        { nome: "A", comDocumento: true },
        { nome: "B", comDocumento: true },
        { nome: "C", comDocumento: false },
      ]),
    ).toContain("2 de 3 têm");
    expect(
      faltaNosOrcamentosParaEnviar([
        { nome: "A", comDocumento: true },
        { nome: "B", comDocumento: true },
        { nome: "C", comDocumento: true },
      ]),
    ).toBeNull();
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
