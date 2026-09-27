import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  new URL("../../app/orcamento/demandas/[id]/page.tsx", import.meta.url),
  "utf8",
);
const componentUrl = new URL("./SalvarDemandaForm.tsx", import.meta.url);
const component = existsSync(componentUrl) ? readFileSync(componentUrl, "utf8") : "";

describe("SalvarDemandaForm", () => {
  it("mantem a pagina server e limita o cliente ao formulario de salvamento", () => {
    expect(page).not.toMatch(/^\s*["']use client["']/);
    expect(page).toContain('import { SalvarDemandaForm } from "@/components/orcamento/SalvarDemandaForm";');
    expect(page).toContain("<SalvarDemandaForm>");
    expect(page).toContain("</SalvarDemandaForm>");
    expect(page).not.toContain("<form action={salvarDemanda}");
  });

  it("preserva integralmente os campos atuais da demanda", () => {
    for (const name of [
      "demanda_id",
      "titulo",
      "cliente_id",
      "projeto_id",
      "cliente_nome",
      "cliente_cnpj",
      "cliente_contato",
      "instituicao",
      "responsavel_interno",
      "origem",
      "data_solicitacao",
      "prazo_esperado",
      "matriz_amostra",
      "quantidade_amostras_estimada",
      "prazo_tecnico_dias",
      "modalidade",
      // UI-6: status sai do formulário; a RPC preserva o atual.
      "prioridade",
      "descricao",
      "escopo_preliminar",
      "observacoes",
    ]) {
      expect(page).toContain(`name="${name}"`);
    }
  });

  it("observa o retorno da action e nao confirma sucesso sem savedAt", () => {
    expect(component, "a fronteira cliente ainda nao existe").toContain('"use client"');
    expect(component).toContain("useActionState");
    expect(component).toContain("salvarDemanda");
    expect(component).toMatch(/initialState:\s*DemandaFormState\s*=\s*\{\s*ok:\s*false\s*\}/);
    expect(component).toMatch(/useActionState\([^,]+,\s*initialState\)/);
    expect(component).toContain("state.ok && Boolean(state.savedAt)");
    expect(component).toContain("state.message");
    expect(component).toContain('role={salvamentoConfirmado ? "status" : "alert"}');
    expect(component).toContain('aria-live={salvamentoConfirmado ? "polite" : "assertive"}');
  });

  it("explicita processamento, bloqueia reenvio e permite retry apos retorno", () => {
    expect(component).toContain("action={formAction}");
    expect(component).toContain("aria-busy={pending}");
    expect(component).toMatch(/<button[\s\S]*type="submit"[\s\S]*disabled=\{pending\}/);
    expect(component).toContain('{pending ? "Salvando…" : "Salvar orçamento"}');
    expect(component).not.toContain("redirect(");
  });
});
