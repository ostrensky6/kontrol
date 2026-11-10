import { describe, expect, it } from "vitest";

import { coordenadorDoProjeto, responsavelDoProjeto, rotuloCoordenador } from "./responsavel";

const usuarios = [
  { id: "u1", nome: "Sandra", email: "sandra@example.com", suspenso: false },
  { id: "u2", nome: "Vilmar", email: null, suspenso: true },
  { id: "u3", nome: " ", email: "sem.nome@example.com" },
];

describe("coordenador do projeto", () => {
  it("vale o usuário indicado, não o nome escrito à mão", () => {
    const c = coordenadorDoProjeto({ coordenador_id: "u1", responsavel: "Outra pessoa" }, usuarios);
    expect(c).toEqual({ situacao: "ok", nome: "Sandra" });
    expect(rotuloCoordenador(c)).toBe("Sandra");
    expect(coordenadorDoProjeto({ coordenador_id: "u3" }, usuarios)).toEqual({ situacao: "ok", nome: "sem.nome@example.com" });
  });

  it("nome escrito sem usuário indicado não aprova: falta coordenador", () => {
    const c = coordenadorDoProjeto({ coordenador_id: null, responsavel: "Antonio" }, usuarios);
    expect(c).toEqual({ situacao: "falta", escrito: "Antonio" });
    expect(rotuloCoordenador(c)).toBe("Sem coordenador (escrito: Antonio)");
    expect(rotuloCoordenador(coordenadorDoProjeto({}, usuarios))).toBe("Sem coordenador");
    // usuário apagado conta como falta
    expect(coordenadorDoProjeto({ coordenador_id: "sumiu" }, usuarios).situacao).toBe("falta");
  });

  it("usuário suspenso é avisado à parte (o banco também trava)", () => {
    const c = coordenadorDoProjeto({ coordenador_id: "u2" }, usuarios);
    expect(c).toEqual({ situacao: "suspenso", nome: "Vilmar" });
    expect(rotuloCoordenador(c)).toBe("Vilmar (usuário suspenso)");
  });

  it("o nome escrito segue a ordem: responsável, depois os campos antigos", () => {
    expect(responsavelDoProjeto({ responsavel: " ", coordenador_nome: "Gisele", coordenador: "x" })).toBe("Gisele");
    expect(responsavelDoProjeto({})).toBeNull();
  });
});
