import { existsSync } from "node:fs";
import { expect, it } from "vitest";
import { AJUDA_TOPICOS, topicoCasa } from "./topics";

const topico = (id: string) => AJUDA_TOPICOS.find((t) => t.id === id)!;
const texto = (id: string) => JSON.stringify(topico(id));
it.each([
  ["equivalência", "analises"], ["fechamento mensal", "estoque"],
  ["/estoque/equipamentos", "cadastros"], ["/nomeacoes", "nomeacoes"],
  ["vínculo explícito", "vinculos-projeto"],
])("busca da Central associa %s ao tópico %s", (rota,id) => {
  expect(topicoCasa(topico(id),rota)).toBe(true);
  expect(existsSync(`src/app${topico(id).href}/page.tsx`)).toBe(true);
});
it("não confunde prefixos nem cria links com IDs fictícios",()=>{
  expect(topicoCasa(topico("nomeacoes"),"/nomeacoes-inexistente")).toBe(false);
  expect(topicoCasa(topico("vinculos-projeto"),"/orcamento/projetos/123")).toBe(false);
  expect(topico("vinculos-projeto").href).toBe("/projetos");
  expect(new Set(AJUDA_TOPICOS.map(t=>t.id)).size).toBe(AJUDA_TOPICOS.length);
});
it("busca textual preserva acentos opcionais e conteúdo antecedente",()=>{
  expect(topicoCasa(topico("analises"),"equivalencia CAS")).toBe(true);
  expect(texto("custeio")).toContain("Resolver custo pendente");
  expect(texto("cadastros")).toContain("Saldo não conferido");
  expect(texto("orcamento-historico")).toContain("Comparar com a anterior");
});
it("documenta limites por fluxo sem confundir recibo e estado atual",()=>{
  for(const fragmento of ["certificação humana", "não é telemetria", "não executa transição automática", "não significam consumo zero", "histórico"])
    expect(texto("estoque")).toContain(fragmento);
  for(const fragmento of ["não é CAS", "UUID", "até desmontar", "não garante recuperação", "Recibo histórico"])
    expect(texto("analises")).toContain(fragmento);
  for(const fragmento of ["não há autoalteração", "Gestor → Gestor", "PAPEL_ALTERADO", "não cria"])
    expect(texto("nomeacoes")).toContain(fragmento);
  for(const fragmento of ["Administrador apto", "escrita desligada", "não remove coordenação", "papel mudou", "ausência nela nunca"])
    expect(texto("vinculos-projeto")).toContain(fragmento);
  for(const fragmento of ["CAS", "não comprova", "não prova ausência de regra", "e-mail", "replay cego"])
    expect(texto("cadastros")).toContain(fragmento);
});
