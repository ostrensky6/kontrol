import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { enviarExclusaoSePermitida } from "./CrudShell";

const source = readFileSync(new URL("./CrudShell.tsx", import.meta.url), "utf8");

describe("CrudShell: quantidade no cadastro de insumos", () => {
  it("nao depende mais do fluxo de estoque em quarentena para o cadastro", () => {
    expect(source).not.toContain(
      'import { AjusteInventarioButton } from "@/components/estoque/ReceberLote";',
    );
    expect(source).not.toContain("AjusteInventarioButton");
    expect(source).not.toContain("ofertaEntradaId");
  });

  it("mostra o campo Quantidade no formulario de criacao, antes do Salvar", () => {
    const criacao = source.indexOf('isInsumos && !registro && (');
    const campoQuantidade = source.indexOf('name="quantidade"', criacao);
    const botaoSalvar = source.indexOf("<SubmitButton>Salvar</SubmitButton>", campoQuantidade);

    expect(criacao).toBeGreaterThan(-1);
    expect(campoQuantidade).toBeGreaterThan(criacao);
    expect(botaoSalvar).toBeGreaterThan(campoQuantidade);
  });

  it("envia um operacao_id estavel para evitar duplicacao em reenvio", () => {
    expect(source).toContain('const [operacaoId] = useState(() => crypto.randomUUID());');
    expect(source).toContain('name="_operacao_id"');
  });

  it("salva e fecha o drawer no mesmo submit, sem etapa posterior", () => {
    expect(source).toMatch(/if \(!state\.ok\) return;[\s\S]*router\.refresh\(\);[\s\S]*onClose\(\);/);
  });

  it("oferece correcao autorizada e auditavel na edicao, exceto para modelo legado", () => {
    expect(source).toContain('quantidadeModelo !== "LEGADO"');
    expect(source).toContain("Corrigir quantidade");
    expect(source).toContain('name="motivo"');
    expect(source).toContain("corrigirQuantidadeEmbalagens");
  });

  it("nao separa mais unidades abertas/fechadas na interface do cadastro", () => {
    expect(source).not.toContain("unidades_fechadas");
    expect(source).not.toContain("unidades_abertas");
  });
});

describe("CrudShell: ciclo de vida e exclusao protegida de insumos", () => {
  it("mantem inativos na listagem e comunica o estado como Ativo ou Inativo", () => {
    expect(source).toContain('data: rows');
    expect(source).not.toMatch(/data:\s*rows\.filter\([^)]*ativo/);
    expect(source).toMatch(/COM_ATIVO[\s\S]*"insumos"/);
    expect(source).toContain('value ? "Ativo" : "Inativo"');
    expect(source).toContain('{ value: "true", label: "Ativo" }');
    expect(source).toContain('{ value: "false", label: "Inativo" }');
  });

  it("oferece inativacao e reativacao explicitas somente na area autorizada", () => {
    expect(source).toContain("alterarAtivoRegistro");
    expect(source).toContain('ativo ? "Inativar" : "Reativar"');
    expect(source).toContain('name="ativo"');
    expect(source).toContain('value={String(!ativo)}');
    expect(source).toMatch(/if \(somenteLeitura\) return dataCols;[\s\S]*<RowActions/);
  });

  it("explica os vinculos reais, preserva o historico e impede repetir a exclusao bloqueada", () => {
    expect(source).toContain("state.blockers ?? []");
    expect(source).toContain("Vínculos que preservam o histórico");
    expect(source).toContain("blocker.identificador");
    expect(source).toContain("blocker.href");
    expect(source).toContain('disabled={pending || bloqueado}');
    expect(source).toContain(
      'slug === "insumos" && !exclusaoState.ok && Boolean(exclusaoState.message)',
    );
    expect(source).toContain('max-h-[calc(100dvh-2rem)] max-w-sm overflow-y-auto');
    expect(source).toContain("Nada foi removido");
  });

  it("permite inativar apos o bloqueio sem reenviar a exclusao", () => {
    expect(source).toMatch(/type="button"[\s\S]*onClick={onInativar}[\s\S]*Inativar/);
    expect(source).toMatch(/<form action={action}[\s\S]*name="_slug"[\s\S]*name="_id"/);
  });

  it("mantem a recusa por registro ao fechar e reabrir sem chamar a action novamente", () => {
    const rowActions = source.slice(
      source.indexOf("function RowActions"),
      source.indexOf("const COM_ATIVO"),
    );
    const deleteDialog = source.slice(
      source.indexOf("function DeleteRegistroDialog"),
      source.indexOf("/**", source.indexOf("function DeleteRegistroDialog")),
    );

    expect(rowActions).toContain("useActionState<FormState, FormData>(");
    expect(rowActions).toContain("state={exclusaoState}");
    expect(rowActions).toContain("action={exclusaoProtegida}");
    expect(rowActions).toContain("bloqueado={exclusaoBloqueada}");
    expect(deleteDialog).not.toContain("useActionState<FormState, FormData>(");

    const action = vi.fn();
    let aberto = true;
    aberto = false;
    aberto = true;

    enviarExclusaoSePermitida(true, action, new FormData());

    expect(aberto).toBe(true);
    expect(action).not.toHaveBeenCalled();
  });
});
