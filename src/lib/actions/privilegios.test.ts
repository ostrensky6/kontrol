import { beforeEach, describe, expect, it, vi } from "vitest";
import { PAPEIS } from "@/lib/auth/permissions";
import { obterMatrizPrivilegios, salvarMatrizPrivilegios } from "./privilegios";

const io = vi.hoisted(() => ({
  temPapel: vi.fn(), revalidatePath: vi.fn(),
  createClient: vi.fn(), createAdminClient: vi.fn(),
  selectRead: vi.fn(), eqRead: vi.fn(), maybeSingle: vi.fn(),
  update: vi.fn(), eqWrite: vi.fn(), filterWrite: vi.fn(), selectWrite: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: io.revalidatePath }));
vi.mock("@/lib/auth/roles", () => ({ temPapel: io.temPapel }));
vi.mock("@/lib/supabase/server", () => ({ createClient: io.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: io.createAdminClient }));

const papel = "coordenador";
const legado = "insumos.excluir_em_cascata";
const atual = {
  papel,
  permissoes: { [legado]: true, "cadastros.editar": false, "orcamentos.emitir": true },
  atualizado_em: "2026-11-07T10:00:00.000Z",
};
const categorias = (linha: typeof atual = atual) => PAPEIS.filter((p) => p.value !== "admin").map((p) =>
  p.value === papel ? linha : { ...atual, papel: p.value, permissoes: {} },
);

function formulario(revisao: string, alteracoes: unknown = [["orcamentos.emitir", false]], alvo: string = papel) {
  const dados = new FormData();
  dados.set("papel", alvo);
  dados.set("revisao", revisao);
  dados.set("alteracoes", JSON.stringify(alteracoes));
  return dados;
}

async function revisaoExibida() {
  const matriz = await obterMatrizPrivilegios();
  if (!matriz.ok) throw new Error(matriz.message);
  return matriz.categorias.coordenador.revisao;
}

beforeEach(() => {
  vi.resetAllMocks();
  io.temPapel.mockResolvedValue(true);
  io.createClient.mockResolvedValue({ from: () => ({ select: io.selectRead }) });
  io.createAdminClient.mockReturnValue({ from: () => ({ update: io.update }) });
  io.selectRead.mockReturnValue({ data: categorias(), error: null, eq: io.eqRead });
  io.eqRead.mockReturnValue({ maybeSingle: io.maybeSingle });
  io.maybeSingle.mockResolvedValue({ data: atual, error: null });
  const filtros = { eq: io.eqWrite, filter: io.filterWrite, select: io.selectWrite };
  io.update.mockReturnValue(filtros);
  io.eqWrite.mockReturnValue(filtros);
  io.filterWrite.mockReturnValue(filtros);
  io.selectWrite.mockResolvedValue({ data: [{ papel }], error: null });
});

describe("matriz de privilégios", () => {
  it("distingue falta de autoridade antes de ler ou escrever", async () => {
    io.temPapel.mockResolvedValue(false);
    await expect(obterMatrizPrivilegios()).resolves.toMatchObject({ ok: false, motivo: "sem_permissao" });
    await expect(salvarMatrizPrivilegios({ ok: false }, formulario("a".repeat(64)))).resolves.toMatchObject({ ok: false });
    expect(io.temPapel).toHaveBeenCalledWith("admin");
    expect(io.createClient).not.toHaveBeenCalled();
    expect(io.createAdminClient).not.toHaveBeenCalled();
  });

  it("expõe só chaves conhecidas, true/false/ausente e revisão da categoria", async () => {
    const leitura = await obterMatrizPrivilegios();
    expect(leitura).toMatchObject({ ok: true, categorias: { coordenador: { armazenadas: {
      "orcamentos.emitir": true, "cadastros.editar": false, "planejamento.editar": null,
    }, revisao: expect.stringMatching(/^[a-f0-9]{64}$/) } } });
    expect(JSON.stringify(leitura)).not.toContain(legado);
  });

  it.each([true, false])("aplica só a intenção e preserva chave legada %s", async (valor) => {
    const linha = { ...atual, permissoes: { ...atual.permissoes, [legado]: valor } };
    io.selectRead.mockReturnValue({ data: categorias(linha), eq: io.eqRead });
    io.maybeSingle.mockResolvedValue({ data: linha });
    const revisao = await revisaoExibida();
    const dados = formulario(revisao, [["orcamentos.emitir", false], ["projetos.editar", true]]);
    await expect(salvarMatrizPrivilegios({ ok: false }, dados)).resolves.toMatchObject({ ok: true });
    const { permissoes } = io.update.mock.calls[0][0];
    expect(permissoes).toEqual({ ...linha.permissoes, "orcamentos.emitir": false, "projetos.editar": true });
    expect(permissoes).not.toHaveProperty(["planejamento.editar"]);
    expect(io.eqRead).toHaveBeenCalledWith("papel", papel);
    expect(io.eqWrite.mock.calls).toEqual([["papel", papel], ["atualizado_em", linha.atualizado_em]]);
    expect(io.filterWrite).toHaveBeenCalledWith("permissoes", "eq", JSON.stringify(linha.permissoes));
    expect(io.selectWrite).toHaveBeenCalledWith("papel");
    expect(io.revalidatePath.mock.calls).toEqual([["/governanca/privilegios"], ["/usuarios"]]);
  });

  it("sem mudança real não escreve nem revalida", async () => {
    const dados = formulario(await revisaoExibida(), [["cadastros.editar", false]]);
    await expect(salvarMatrizPrivilegios({ ok: false }, dados)).resolves.toEqual({ ok: true, message: "Nada mudou." });
    expect(io.createAdminClient).not.toHaveBeenCalled();
    expect(io.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["admin", [["orcamentos.emitir", false]]],
    ["supervisor", [["orcamentos.emitir", false]]],
    [papel, [[legado, true]]],
    [papel, [["orcamentos.emitir", "false"]]],
    [papel, [["orcamentos.emitir", true], ["orcamentos.emitir", false]]],
    [papel, { "orcamentos.emitir": false }],
  ])("recusa papel ou alteração inválida antes do I/O: %s %j", async (alvo, alteracoes) => {
    const dados = formulario("a".repeat(64), alteracoes, alvo as string);
    await expect(salvarMatrizPrivilegios({ ok: false }, dados)).resolves.toMatchObject({ ok: false });
    expect(io.createClient).not.toHaveBeenCalled();
    expect(io.createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    { data: atual, error: { message: "falha de leitura" } },
    { data: null, error: null },
    { data: { ...atual, permissoes: [] }, error: null },
  ])("falha fechado em erro, linha ausente ou JSON inválido: %j", async (resposta) => {
    const revisao = await revisaoExibida();
    io.maybeSingle.mockResolvedValue(resposta);
    await expect(salvarMatrizPrivilegios({ ok: false }, formulario(revisao))).resolves.toMatchObject({ ok: false });
    expect(io.createAdminClient).not.toHaveBeenCalled();
    expect(io.revalidatePath).not.toHaveBeenCalled();
  });

  it("distingue matriz incompleta de falta de autoridade", async () => {
    io.selectRead.mockReturnValue({ data: [atual], error: null });
    await expect(obterMatrizPrivilegios()).resolves.toMatchObject({ ok: false, motivo: "leitura" });
  });

  it("recusa revisão da exibição stale mesmo com timestamp igual", async () => {
    const revisao = await revisaoExibida();
    io.maybeSingle.mockResolvedValue({ data: { ...atual, permissoes: { ...atual.permissoes, [legado]: false } } });
    await expect(salvarMatrizPrivilegios({ ok: false }, formulario(revisao))).resolves.toMatchObject({ ok: false, conflito: true });
    expect(io.createAdminClient).not.toHaveBeenCalled();
  });

  it("concorrência após a leitura: zero linhas no UPDATE condicional é conflito", async () => {
    const revisao = await revisaoExibida();
    io.selectWrite.mockResolvedValue({ data: [], error: null });
    await expect(salvarMatrizPrivilegios({ ok: false }, formulario(revisao))).resolves.toMatchObject({ ok: false, conflito: true });
    expect(io.eqWrite.mock.calls).toEqual([["papel", papel], ["atualizado_em", atual.atualizado_em]]);
    expect(io.filterWrite).toHaveBeenCalledWith("permissoes", "eq", JSON.stringify(atual.permissoes));
    expect(io.update).toHaveBeenCalledTimes(1);
    expect(io.revalidatePath).not.toHaveBeenCalled();
  });
});
