import { describe, expect, it } from "vitest";

import type { Campo } from "@/lib/cadastros/config";
import {
  comPessoasNovas,
  papelDaNovaPessoa,
  preAprovadoDoValor,
  preAprovadosSemConta,
  sugestaoDePessoa,
  valorPreAprovado,
} from "@/lib/cadastros/pessoas";

const coordenador: Campo = {
  name: "coordenador_id",
  label: "Coordenação",
  tipo: "select",
  opcoesDe: "perfis",
  opcoes: [{ value: "a", label: "Ana" }],
};
const nome: Campo = { name: "nome", label: "Nome", tipo: "text" };
const fornecedor: Campo = { name: "fornecedor_id", label: "Fornecedor", tipo: "select", opcoesDe: "fornecedores", opcoes: [] };

describe("pessoas cadastradas no formulário", () => {
  it("a pessoa nova entra em todo campo de usuário e só neles", () => {
    const campos = comPessoasNovas([nome, coordenador, fornecedor], [{ value: "n", label: "Nova Pessoa" }]);
    expect(campos[0]).toBe(nome);
    expect(campos[1].opcoes?.map((o) => o.value)).toEqual(["a", "n"]);
    expect(campos[2].opcoes).toEqual([]);
  });

  it("depois de salvar, a pessoa já vem na lista do servidor e não aparece duas vezes", () => {
    const doServidor: Campo = { ...coordenador, opcoes: [{ value: "a", label: "Ana" }, { value: "n", label: "Nova Pessoa" }] };
    const campos = comPessoasNovas([doServidor], [{ value: "n", label: "Nova Pessoa" }]);
    expect(campos[0].opcoes?.filter((o) => o.value === "n")).toHaveLength(1);
  });

  it("sem pessoa nova, os campos ficam como vieram", () => {
    const campos = [coordenador];
    expect(comPessoasNovas(campos, [])).toBe(campos);
  });

  it("a função sugerida é Coordenador, a não ser que o campo peça outra", () => {
    expect(papelDaNovaPessoa({})).toBe("coordenador");
    expect(papelDaNovaPessoa({ novaPessoaPapel: "compra" })).toBe("compra");
  });
});

describe("nome escrito à mão no projeto", () => {
  const campoProjeto: Campo = {
    name: "coordenador_id",
    label: "Coordenador do projeto",
    tipo: "select",
    opcoesDe: "perfis",
    nomeSugeridoDe: "responsavel",
    opcoes: [
      { value: "a", label: "Ana Silvia Pedrazzani" },
      { value: "s", label: "Giorgi Dal Pont", inativo: true },
    ],
  };

  it("nome de quem já tem usuário: sugere indicar, sem diferença de acento, maiúscula ou espaço", () => {
    expect(sugestaoDePessoa(campoProjeto, { responsavel: "  ana  sílvia PEDRAZZANI " }, "")).toEqual({
      tipo: "existente",
      nome: "Ana Silvia Pedrazzani",
      id: "a",
    });
  });

  it("nome sem usuário: sugere cadastrar com o nome escrito", () => {
    expect(sugestaoDePessoa(campoProjeto, { responsavel: "Marcio  Pie" }, "")).toEqual({ tipo: "nova", nome: "Marcio Pie" });
  });

  it("nome parecido não é a mesma pessoa, e usuário suspenso não é sugerido", () => {
    expect(sugestaoDePessoa(campoProjeto, { responsavel: "Ana Silva Pedrazani" }, "")).toEqual({ tipo: "nova", nome: "Ana Silva Pedrazani" });
    expect(sugestaoDePessoa(campoProjeto, { responsavel: "Giorgi Dal Pont" }, "")).toEqual({ tipo: "nova", nome: "Giorgi Dal Pont" });
  });

  it("sem sugestão quando já há coordenador, não há nome escrito ou o campo não pede", () => {
    expect(sugestaoDePessoa(campoProjeto, { responsavel: "Ana Silvia Pedrazzani" }, "a")).toBeNull();
    expect(sugestaoDePessoa(campoProjeto, { responsavel: "   " }, "")).toBeNull();
    expect(sugestaoDePessoa(campoProjeto, null, "")).toBeNull();
    expect(sugestaoDePessoa({ ...campoProjeto, nomeSugeridoDe: undefined }, { responsavel: "Ana" }, "")).toBeNull();
  });
});

describe("pré-aprovados no campo de usuário", () => {
  const pre = [
    { id: 4, nome: "Ana Silvia Pedrazzani", email: "Ana@Exemplo.com " },
    { id: 9, nome: "Camila Prestes", email: "camila@exemplo.com" },
    { id: 7, nome: null, email: "sem.nome@exemplo.com" },
    { id: 8, nome: "Sem e-mail", email: null },
  ];

  it("só entra quem ainda não tem conta com o mesmo e-mail", () => {
    expect(preAprovadosSemConta(pre, ["CAMILA@exemplo.com", null])).toEqual([
      { id: 4, nome: "Ana Silvia Pedrazzani", email: "ana@exemplo.com" },
      { id: 7, nome: "sem.nome@exemplo.com", email: "sem.nome@exemplo.com" },
    ]);
  });

  it("o valor pre:<id> leva ao pré-aprovado; valor de usuário não", () => {
    const lista = preAprovadosSemConta(pre, []);
    expect(valorPreAprovado({ id: 4 })).toBe("pre:4");
    expect(preAprovadoDoValor("pre:4", lista)?.nome).toBe("Ana Silvia Pedrazzani");
    expect(preAprovadoDoValor("pre:99", lista)).toBeNull();
    expect(preAprovadoDoValor("00000000-0000-4000-8000-0000000000c1", lista)).toBeNull();
  });

  it("nome escrito de quem está pré-aprovado: sugere criar a conta e indicar", () => {
    const campo: Campo = { name: "coordenador_id", label: "Coordenador do projeto", tipo: "select", opcoesDe: "perfis", nomeSugeridoDe: "responsavel", opcoes: [] };
    expect(sugestaoDePessoa(campo, { responsavel: "Ana Silvia Pedrazzani" }, "", preAprovadosSemConta(pre, []))).toEqual({
      tipo: "pre_aprovado",
      nome: "Ana Silvia Pedrazzani",
      email: "ana@exemplo.com",
    });
    // quem já tem conta vence a pré-aprovação
    const comConta = { ...campo, opcoes: [{ value: "u", label: "Ana Silvia Pedrazzani" }] };
    expect(sugestaoDePessoa(comConta, { responsavel: "Ana Silvia Pedrazzani" }, "", preAprovadosSemConta(pre, []))?.tipo).toBe("existente");
  });
});
