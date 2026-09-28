import { beforeEach, describe, expect, it, vi } from "vitest";

// Exclusões do orçamento de projeto: o resultado do Storage e do banco é
// conferido; nada de "concluído" quando uma das partes falhou (27/09).

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const revalidatePath = vi.fn();
const storageRemove = vi.fn();
const deleteRow = vi.fn();
const filtros: [string, unknown][] = [];
let anexo: { data: { path: string } | null; error: { message: string } | null };
let removidos: { data: { id: number }[] | null; error: { message: string } | null };
let projeto: { status: string; demanda_id: number };

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect, unstable_rethrow: vi.fn() }));
vi.mock("./eventos", () => ({ registrarEvento: vi.fn() }));
vi.mock("@/lib/orcamento/parametros-versionamento", () => ({ registrarVersaoParametrosEconomicos: vi.fn() }));
vi.mock("@/lib/orcamento/governanca", () => ({ exigirPapelOrcamento: vi.fn() }));

function consulta(resultadoSingle: () => unknown) {
  const cadeia = {
    eq: (coluna: string, valor: unknown) => {
      filtros.push([coluna, valor]);
      return cadeia;
    },
    single: async () => resultadoSingle(),
    select: async () => removidos,
  };
  return cadeia;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (tabela: string) => ({
      select: () =>
        consulta(() =>
          tabela === "orcamento_projeto_anexos" ? anexo : { data: projeto, error: null },
        ),
      delete: () => {
        deleteRow(tabela);
        return consulta(() => removidos);
      },
    }),
    storage: { from: () => ({ remove: storageRemove }) },
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  filtros.length = 0;
  storageRemove.mockResolvedValue({ data: [], error: null });
  anexo = { data: { path: "77/abc-laudo.pdf" }, error: null };
  removidos = { data: [{ id: 9 }], error: null };
  projeto = { status: "rascunho", demanda_id: 5 };
});

function anexoForm() {
  const formData = new FormData();
  formData.set("orcamento_projeto_id", "77");
  formData.set("anexo_id", "9");
  return formData;
}

describe("removerAnexoProjeto", () => {
  it("só procura o anexo dentro do orçamento informado", async () => {
    const { removerAnexoProjeto } = await import("./orcamento-projetos");

    await removerAnexoProjeto(anexoForm());

    expect(filtros).toContainEqual(["orcamento_projeto_id", 77]);
    expect(storageRemove).toHaveBeenCalledWith(["77/abc-laudo.pdf"]);
    expect(deleteRow).toHaveBeenCalledWith("orcamento_projeto_anexos");
  });

  it("não segue quando o anexo não é deste orçamento", async () => {
    anexo = { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
    const { removerAnexoProjeto } = await import("./orcamento-projetos");

    await expect(removerAnexoProjeto(anexoForm())).rejects.toThrow("Anexo não encontrado");
    expect(storageRemove).not.toHaveBeenCalled();
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it("mantém o anexo na lista quando o arquivo não pode ser apagado", async () => {
    storageRemove.mockResolvedValue({ data: null, error: { message: "storage indisponível" } });
    const { removerAnexoProjeto } = await import("./orcamento-projetos");

    await expect(removerAnexoProjeto(anexoForm())).rejects.toThrow("Nada foi removido");
    expect(deleteRow).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("avisa quando o registro do anexo não sai da lista", async () => {
    removidos = { data: [], error: null };
    const { removerAnexoProjeto } = await import("./orcamento-projetos");

    await expect(removerAnexoProjeto(anexoForm())).rejects.toThrow("Remova de novo");
  });
});

describe("excluirOrcamentoProjeto", () => {
  function exclusaoForm() {
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");
    return formData;
  }

  it("não anuncia a exclusão quando o banco não apagou nada", async () => {
    removidos = { data: [], error: null };
    const { excluirOrcamentoProjeto } = await import("./orcamento-projetos");

    await expect(excluirOrcamentoProjeto(exclusaoForm())).rejects.toThrow("erro_exclusao=");
  });

  it("não anuncia a exclusão quando o banco recusa", async () => {
    removidos = { data: null, error: { message: "permission denied" } };
    const { excluirOrcamentoProjeto } = await import("./orcamento-projetos");

    await expect(excluirOrcamentoProjeto(exclusaoForm())).rejects.toThrow("erro_exclusao=");
  });

  it("exclui e volta à etapa quando o banco confirma", async () => {
    const { excluirOrcamentoProjeto } = await import("./orcamento-projetos");

    await expect(excluirOrcamentoProjeto(exclusaoForm())).rejects.toThrow(
      "NEXT_REDIRECT:/orcamento/demandas/5?etapa=projeto",
    );
    expect(redirect).toHaveBeenCalledWith("/orcamento/demandas/5?etapa=projeto");
  });
});
