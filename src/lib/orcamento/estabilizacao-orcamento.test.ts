import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationsUrl = new URL("../../../supabase/migrations/", import.meta.url);
const additiveMigrations = readdirSync(migrationsUrl)
  .map((name) => ({ name, number: Number(name.match(/^(\d+)/)?.[1]) }))
  .filter(({ name, number }) => name.endsWith(".sql") && number > 98)
  .sort((a, b) => a.number - b.number || a.name.localeCompare(b.name))
  .map((migration) => ({
    ...migration,
    source: readFileSync(new URL(migration.name, migrationsUrl), "utf8"),
  }));

// Com sobrecargas (ex.: emitir com e sem operacao_id), `assinatura` escolhe qual.
function latestFunctionDefinition(name: string, assinatura?: RegExp) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:"?[\\w]+"?\\.)?"?${escapedName}"?\\s*\\([\\s\\S]*?\\bas\\s+(\\$[\\w]*\\$)[\\s\\S]*?\\1\\s*;`,
    "gi",
  );
  return additiveMigrations
    .flatMap((migration) =>
      [...migration.source.matchAll(pattern)].map((match) => ({
        migration: migration.name,
        source: match[0],
      })),
    )
    .filter((definicao) => !assinatura || assinatura.test(definicao.source.slice(0, definicao.source.search(/\breturns\b/i))))
    .at(-1);
}

function requireLatestFunctionDefinition(name: string, assinatura?: RegExp) {
  const definition = latestFunctionDefinition(name, assinatura);
  expect(
    definition,
    `Nenhuma migration aditiva numericamente posterior a 0098 define ${name}; 0079–0098 permanecem congeladas.`,
  ).toBeDefined();
  return definition?.source ?? "";
}
const publicApprovalPage = readFileSync(
  new URL("../../app/aprovar/[token]/page.tsx", import.meta.url),
  "utf8",
);
const historyPage = readFileSync(
  new URL("../../app/orcamento/historico/page.tsx", import.meta.url),
  "utf8",
);
const demandsAction = readFileSync(new URL("../actions/demandas.ts", import.meta.url), "utf8");
const budgetsAction = readFileSync(new URL("../actions/orcamentos.ts", import.meta.url), "utf8");
const historyAction = readFileSync(new URL("../actions/orcamento-historico.ts", import.meta.url), "utf8");

describe("KONTROL-DIAG-005 — aprovação pública", () => {
  it("vincula identidade de versão e conclui aprovação, transição e evento sob lock", () => {
    const approvalMigration = requireLatestFunctionDefinition("aprovar_orcamento_publico");
    expect.soft(approvalMigration).toContain("orcamento_final_versao_id");
    expect.soft(approvalMigration).toMatch(/aprovar_orcamento_publico[\s\S]*for update/i);
    expect.soft(approvalMigration).toContain("app.orcamento_projeto_transicao");
    expect.soft(approvalMigration).toMatch(/aprovar_orcamento_publico[\s\S]*insert into eventos_status/i);
  });

  it("preserva sucesso idempotente no retry do mesmo token", () => {
    const approvalMigration = requireLatestFunctionDefinition("aprovar_orcamento_publico");
    expect(approvalMigration).toMatch(/aprovado_em\s+is\s+not\s+null[\s\S]*return\s+true/i);
  });
});

describe("KONTROL-DIAG-006 — terminologia e engine autoritativa", () => {
  it("rotula Σ parâmetros sem alterar a matemática e não recalcula a página pública pela engine legada", () => {
    expect.soft(historyPage).not.toContain('<Delta titulo="Markup"');
    expect.soft(publicApprovalPage).not.toContain("calcularOrcamentoProjeto(");
  });
});

describe("KONTROL-DIAG-007 — snapshot reconstruível", () => {
  it("congela o snapshot operacional e sua fonte na versão final emitida", () => {
    expect.soft(demandsAction).toContain('rpc("emitir_orcamento_final_transacional"');
    expect.soft(demandsAction).toMatch(/orcamentos[\s\S]*fonte_custo_insumos[\s\S]*custo_snapshot/);
    expect.soft(demandsAction).toMatch(/snapshot\s*=\s*\{[\s\S]*custo_snapshot/);
  });

  it("recalcula o operacional com motivo, revisão e evento na mesma RPC", () => {
    expect.soft(budgetsAction).toContain('["enviado", "aprovado", "cancelado"]');
    expect.soft(budgetsAction).toContain("exige motivo");
    expect.soft(budgetsAction).toMatch(/rpc\("recalcular_orcamento_transacional"[\s\S]*p_motivo/);
  });
});

describe("KONTROL-DIAG-008 — pós-emissão atômico", () => {
  it("usa RPCs para transição e duplicação sem update+evento ou max+1 no app", () => {
    expect.soft(historyAction).toContain('rpc("transicionar_orcamento_final"');
    expect.soft(historyAction).toContain('rpc("duplicar_orcamento_final_transacional"');
    expect.soft(historyAction).not.toMatch(/const novaVersao\s*=\s*Number\(ultima\?\.versao/);
    expect.soft(historyAction).not.toContain('registrarEvento("orcamento_final"');
  });

  it("recebe a identidade idempotente antes das actions sem gerar randomUUID internamente", () => {
    expect.soft(demandsAction).not.toContain("randomUUID");
    expect.soft(budgetsAction).not.toContain("randomUUID");
    expect.soft(historyAction).not.toContain("randomUUID");
  });

  it("torna a duplicacao idempotente e rejeita reuso com origem ou payload diferente", () => {
    const duplicateMigration = requireLatestFunctionDefinition(
      "duplicar_orcamento_final_transacional",
    );

    expect.soft(duplicateMigration).toMatch(
      /duplicar_orcamento_final_transacional\s*\([\s\S]*p_operacao_id\s+uuid/i,
    );
    expect.soft(duplicateMigration).toMatch(
      /v_payload\s*:=\s*jsonb_build_object\([\s\S]*'versao_id'\s*,\s*p_versao_id/i,
    );
    expect.soft(duplicateMigration).toMatch(
      /where\s+operacao_id\s*=\s*p_operacao_id[\s\S]*jsonb_build_object\('repetido'\s*,\s*true\)/i,
    );
    expect.soft(duplicateMigration).toMatch(
      /operacao_payload\s+is\s+distinct\s+from\s+v_payload[\s\S]*OPERACAO_ID_REUTILIZADA_COM_PAYLOAD_DIFERENTE/i,
    );
  });

  it("rejeita payload conflitante na emissao e no recalculo para a mesma identidade", () => {
    for (const functionName of [
      "emitir_orcamento_final_transacional",
      "recalcular_orcamento_transacional",
    ]) {
      const definition = requireLatestFunctionDefinition(functionName, /p_operacao_id\s+uuid/i);
      expect.soft(definition, functionName).toContain(
        "OPERACAO_ID_REUTILIZADA_COM_PAYLOAD_DIFERENTE",
      );
      expect.soft(definition, functionName).toMatch(
        /'repetido'\s*,\s*true/i,
      );
    }
  });
});
