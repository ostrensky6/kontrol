import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
