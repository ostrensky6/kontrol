import { describe, expect, it } from "vitest";

import { ancoraDaSecao, hrefAjuda, tipoDaSecao, topicoDaUrl, topicoParaRota } from "./secao";
import { AJUDA_TOPICOS } from "./topics";

describe("tipoDaSecao", () => {
  it("reconhece passo a passo, boas práticas e para que serve", () => {
    expect(tipoDaSecao("Passo a passo")).toBe("passos");
    expect(tipoDaSecao("Como usar")).toBe("passos");
    expect(tipoDaSecao("Boas práticas")).toBe("praticas");
    expect(tipoDaSecao("Para que serve")).toBe("serve");
    expect(tipoDaSecao("O que você cadastra aqui")).toBe("serve");
  });

  it("destaca seções de cuidado e exceção", () => {
    expect(tipoDaSecao("Privilégios que merecem atenção")).toBe("atencao");
    expect(tipoDaSecao("Se não encontrar a proposta")).toBe("atencao");
    expect(tipoDaSecao("Regras e exceções")).toBe("atencao");
  });

  it("título livre é informação", () => {
    expect(tipoDaSecao("Painel de insumos")).toBe("info");
    expect(tipoDaSecao("Técnicos e salário")).toBe("info");
  });
});

describe("link direto para o tópico", () => {
  it("acha o tópico pelo id e ignora id desconhecido", () => {
    expect(topicoDaUrl("pedido")?.id).toBe("pedido");
    expect(topicoDaUrl("nao-existe")).toBeNull();
    expect(topicoDaUrl(null)).toBeNull();
  });

  it("monta o link e a âncora", () => {
    expect(hrefAjuda("pedido")).toBe("/ajuda?topico=pedido");
    expect(ancoraDaSecao("pedido", 0)).toBe("ajuda-pedido-1");
  });

  it("os ids dos tópicos são únicos (o link depende disso)", () => {
    const ids = AJUDA_TOPICOS.map((topico) => topico.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("topicoParaRota", () => {
  it("leva cada tela ao tópico que a explica", () => {
    expect(topicoParaRota("/pedido/12")).toBe("pedido");
    expect(topicoParaRota("/estoque/controle")).toBe("estoque");
    expect(topicoParaRota("/governanca/backups")).toBe("backups");
    expect(topicoParaRota("/governanca/privilegios")).toBe("privilegios");
    expect(topicoParaRota("/")).toBe("navegacao-geral");
  });

  it("todo destino existe na Central de Ajuda", () => {
    const rotas = ["/orcamento", "/estoque", "/suprimentos", "/pedido", "/aprovar", "/recebimento", "/compras",
      "/planejamento", "/custeio", "/parametros", "/analises", "/insumos", "/cadastros", "/projetos",
      "/governanca/incidentes", "/governanca/backups", "/governanca", "/notificacoes", "/usuarios", "/auditoria", "/"];
    for (const rota of rotas) {
      expect(topicoDaUrl(topicoParaRota(rota)), rota).not.toBeNull();
    }
  });
});
