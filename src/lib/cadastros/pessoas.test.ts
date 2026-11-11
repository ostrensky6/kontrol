import { describe, expect, it } from "vitest";

import type { Campo } from "@/lib/cadastros/config";
import { comPessoasNovas, papelDaNovaPessoa } from "@/lib/cadastros/pessoas";

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
