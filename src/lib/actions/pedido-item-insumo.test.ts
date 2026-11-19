import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockSupabaseClient, getMockSupabaseStore, resetMockSupabaseStore } from "@/lib/testing/mock-supabase";

const revalidatePath = vi.fn();
const permissoes = new Set<string>();
let papel = "gestor";

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/permissao-efetiva", () => ({ pode: vi.fn(async (chave: string) => permissoes.has(chave)) }));
vi.mock("@/lib/supabase/server", () => ({
  createClientUntyped: vi.fn(async () => createMockSupabaseClient({ papel })),
}));

type Linha = Record<string, unknown>;

const ITEM = 7001;
const PEDIDO = 502; // "Primers para aprovar E2E", em_validacao

function loja() {
  return getMockSupabaseStore() as unknown as Record<string, Linha[]>;
}

function item(id = ITEM) {
  return loja().pedidos_internos_itens.find((linha) => linha.id === id)!;
}

function formulario(campos: Record<string, string> = {}) {
  const dados = new FormData();
  const padrao: Record<string, string> = {
    item_id: String(ITEM),
    pedido_interno_id: String(PEDIDO),
    insumo_especificacao: "Tampão TE 1X",
    insumo_fabricante: "Sigma",
    insumo_codigo_fabricante: "T9285",
    insumo_unidade: "mL",
    insumo_quantidade_embalagem: "500",
    insumo_custo_embalagem: "180",
  };
  for (const [campo, valor] of Object.entries({ ...padrao, ...campos })) dados.set(campo, valor);
  return dados;
}

async function cadastrar(dados: FormData) {
  const { cadastrarInsumoDoItemPedido } = await import("./pedido-item-insumo");
  return cadastrarInsumoDoItemPedido({ ok: false }, dados);
}

beforeEach(() => {
  resetMockSupabaseStore();
  revalidatePath.mockReset();
  permissoes.clear();
  permissoes.add("pedido.aprovar");
  permissoes.add("insumos.editar");
  papel = "gestor";
  loja().pedidos_internos_itens.push({
    id: ITEM,
    pedido_interno_id: PEDIDO,
    tipo: "material",
    especificacao: "Tampão TE 1X",
    insumo_id: null,
    quantidade: 2,
    unidade: "frasco",
    volume: "500 mL",
    orcamento_previo: 180,
  });
});

/** Decisão de Antonio em 19/11/2026: Compras cadastra o item novo pelo pedido, antes de formalizar. */
describe("item novo do pedido: cadastrar o insumo e ligar ao item", () => {
  it("cadastra o insumo sem lote, com os dados conferidos, e liga o item a ele", async () => {
    const antes = loja().insumos.length;
    const lotesAntes = loja().lotes_estoque.length;

    const resultado = await cadastrar(formulario());

    expect(resultado.ok).toBe(true);
    expect(resultado.message).toContain("cadastrado e ligado ao item");
    expect(loja().insumos).toHaveLength(antes + 1);
    const insumo = loja().insumos.at(-1)!;
    expect(insumo).toMatchObject({
      especificacao: "Tampão TE 1X",
      fabricante: "Sigma",
      codigo_fabricante: "T9285",
      unidade: "mL",
      quantidade_embalagem: 500,
      custo_total_embalagem: 180,
      ativo: true,
    });
    // nunca recebido: o cadastro não cria lote nem saldo
    expect(loja().lotes_estoque).toHaveLength(lotesAntes);
    expect(item().insumo_id).toBe(insumo.id);
    expect(revalidatePath).toHaveBeenCalledWith(`/pedido/${PEDIDO}`);
    expect(revalidatePath).toHaveBeenCalledWith("/cadastros/insumos");
  });

  it("sem “Editar insumos”, nada é criado e a mensagem diz a quem pedir", async () => {
    permissoes.delete("insumos.editar");
    const antes = loja().insumos.length;

    const resultado = await cadastrar(formulario());

    expect(resultado).toEqual({
      ok: false,
      message: "Cadastrar o insumo pede a permissão “Editar insumos”. Peça ao administrador, em Usuários, ou a quem cuida do cadastro.",
    });
    expect(loja().insumos).toHaveLength(antes);
    expect(item().insumo_id).toBeNull();
  });

  it("na aprovação, quem não tem “Aprovar pedidos” não mexe no item", async () => {
    permissoes.delete("pedido.aprovar");
    const resultado = await cadastrar(formulario());
    expect(resultado.ok).toBe(false);
    expect(resultado.message).toContain("Aprovar pedidos");
    expect(item().insumo_id).toBeNull();
  });

  it("nome ou código que já existe no cadastro não vira insumo repetido", async () => {
    const antes = loja().insumos.length;

    // mesmo nome, escrito sem acento e em outra caixa
    const porNome = await cadastrar(formulario({ insumo_especificacao: "kit EXTRACAO e2e", insumo_codigo_fabricante: "" }));
    expect(porNome.ok).toBe(false);
    expect(porNome.message).toContain("Já existe no cadastro o insumo “Kit extração E2E”");
    expect(porNome.message).toContain("Ligar a este");

    // outro nome, mesmo código do fabricante
    const porCodigo = await cadastrar(formulario({ insumo_especificacao: "Kit novo", insumo_codigo_fabricante: "kx-900" }));
    expect(porCodigo.ok).toBe(false);
    expect(porCodigo.message).toContain("Kit extração E2E");

    expect(loja().insumos).toHaveLength(antes);
    expect(item().insumo_id).toBeNull();
  });

  it("“Ligar a este” liga o item a um insumo que já existia, sem pedir “Editar insumos”", async () => {
    permissoes.delete("insumos.editar");
    const antes = loja().insumos.length;

    const resultado = await cadastrar(formulario({ ligar_insumo_id: "900" }));

    expect(resultado).toEqual({ ok: true, message: "Item ligado ao insumo “Kit extração E2E”." });
    expect(loja().insumos).toHaveLength(antes);
    expect(item().insumo_id).toBe(900);
  });

  it("insumo inativo não recebe item", async () => {
    loja().insumos.find((insumo) => insumo.id === 900)!.ativo = false;
    const resultado = await cadastrar(formulario({ ligar_insumo_id: "900" }));
    expect(resultado.ok).toBe(false);
    expect(resultado.message).toContain("não está mais ativo");
    expect(item().insumo_id).toBeNull();
  });

  it("serviço e item já ligado são recusados", async () => {
    item().tipo = "servico";
    expect((await cadastrar(formulario())).message).toBe("Serviço não tem insumo no cadastro.");
    item().tipo = "material";
    item().insumo_id = 900;
    expect((await cadastrar(formulario())).message).toContain("já está ligado a um insumo");
  });

  it("depois de formalizado, os itens não mudam", async () => {
    loja().pedidos_internos.find((pedido) => pedido.id === PEDIDO)!.status = "analise_administrativa";
    const antes = loja().insumos.length;
    const resultado = await cadastrar(formulario());
    expect(resultado.ok).toBe(false);
    expect(resultado.message).toContain("Nesta etapa os itens não mudam");
    expect(loja().insumos).toHaveLength(antes);
  });

  it("dado inválido é recusado antes de criar o insumo", async () => {
    const antes = loja().insumos.length;
    const resultado = await cadastrar(formulario({ insumo_quantidade_embalagem: "0" }));
    expect(resultado).toEqual({ ok: false, message: "Informe quanto vem em 1 embalagem (maior que zero)." });
    expect(loja().insumos).toHaveLength(antes);
  });
});
