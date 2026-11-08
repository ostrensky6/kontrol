import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UsuarioAcoes } from "./UsuarioAcoes";
import { CriarUsuarioForm } from "./CriarUsuarioForm";
import type { UsuarioRow } from "./UsuariosTable";
import UsuariosPage from "@/app/usuarios/page";
import type { UsuarioFormState } from "@/lib/actions/usuarios";

const ui = vi.hoisted(() => ({
  dialog: null as string | null,
  destino: "",
  atual: null as { papel: string; label: string } | null,
  resposta: { ok: false, message: "" } as UsuarioFormState,
  pending: false,
  transicao: undefined as Promise<unknown> | undefined,
  nomear: vi.fn(),
  editar: vi.fn(),
  criar: vi.fn(),
  preAprovar: vi.fn(),
  trocarDialog: vi.fn(),
  usuario: vi.fn(),
  cliente: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useId: () => "destino-ui",
  useState: (initial: unknown) => [
    initial === null ? ui.dialog : typeof initial === "function" ? ui.atual ?? initial() : initial === "" ? ui.destino : initial,
    ui.trocarDialog,
  ],
  useTransition: () => [ui.pending, (work: () => Promise<unknown>) => { ui.transicao = work(); }],
  useActionState: (action: (prev: UsuarioFormState, data: FormData) => unknown, initial: UsuarioFormState) => [
    ui.resposta, (data: FormData) => action(initial, data), ui.pending,
  ],
}));
vi.mock("@/lib/actions/usuarios", () => ({
  nomearPapelUsuario: ui.nomear, editarUsuario: ui.editar,
  alterarSenhaUsuario: vi.fn(), alternarSuspensao: vi.fn(),
  criarUsuario: ui.criar, criarUsuarioPreAprovado: ui.preAprovar,
  excluirUsuario: vi.fn(), gerarNovaSenhaProvisoria: vi.fn(),
}));
vi.mock("@/lib/auth/roles", () => ({ usuarioAtual: ui.usuario }));
vi.mock("@/lib/supabase/server", () => ({ createClient: ui.cliente }));
vi.mock("@/lib/formulario-sem-perda", async (original) => ({
  ...await original<typeof import("@/lib/formulario-sem-perda")>(),
  enviarSemReset: (handler: (dados: FormData) => void) => handler,
}));
vi.mock("./AssinaturaUsuarioForm", () => ({ AssinaturaUsuarioForm: () => null }));
vi.mock("./UsuariosTable", () => ({ UsuariosTable: function UsuariosTable() { return null; } }));
vi.mock("next/link", () => ({ default: () => null }));

type Props = Record<string, unknown>;
function nodes(tree: unknown): ReactElement<Props>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Props>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
function words(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(words).join(" ");
  if (typeof tree === "string") return tree;
  return isValidElement<Props>(tree) ? words(tree.props.children) : "";
}
function component(tree: unknown, name: string) {
  const el = nodes(tree).find(({ type }) => typeof type === "function" && type.name === name);
  if (!el) throw new Error(`Componente ausente: ${name}`);
  return el;
}
function dialogTree(name: string, row: UsuarioRow = alvo) {
  const el = component(UsuarioAcoes({ row }), name);
  return (el.type as (props: Props) => unknown)(el.props);
}
function fields(tree: unknown) {
  const dados = new FormData();
  for (const { props } of nodes(tree)) {
    if (typeof props.name === "string" && !props.disabled) dados.set(props.name, String(props.value ?? props.defaultValue ?? ""));
  }
  return dados;
}
function form(tree: unknown) {
  const el = nodes(tree).find(({ type }) => type === "form");
  if (!el) throw new Error("Formulário ausente");
  return el.props;
}

const adminId = "00000000-0000-4000-8000-000000000001";
const alvo: UsuarioRow = {
  id: "00000000-0000-4000-8000-000000000002", nome: "Pessoa sintética", email: "alvo@kontrol.test",
  papel: "gestor", papelLabel: "Gestor", suspenso: false, senhaProvisoria: false, temAcesso: true,
  papeisDestino: ["coordenador", "supervisor"],
};

beforeEach(() => {
  vi.resetAllMocks();
  ui.dialog = null; ui.destino = ""; ui.atual = null; ui.pending = false;
  ui.resposta = { ok: false, message: "" };
  ui.transicao = undefined;
  ui.nomear.mockResolvedValue({ ok: true, message: "Função atualizada." });
  ui.editar.mockResolvedValue({ ok: true, message: "Usuário atualizado." });
});

describe("consumidor de usuários", () => {
  it("edita apenas id e nome, sem função nem exceções", async () => {
    const tree = dialogTree("EditarDialog");
    const dados = fields(tree);
    expect([...dados]).toEqual([["id", alvo.id], ["nome", alvo.nome]]);
    (form(tree).onSubmit as (dados: FormData) => void)(dados);
    await ui.transicao;
    expect(ui.editar).toHaveBeenCalledWith({ ok: false, message: "" }, dados);
    expect(ui.nomear).not.toHaveBeenCalled();
  });

  it("oferece só os destinos projetados e envia os três campos à action de nomeação", async () => {
    ui.dialog = "nomear";
    ui.destino = "supervisor";
    const tree = dialogTree("NomearPapelDialog");
    expect(words(tree)).toContain("Função atual:  Gestor");
    expect(words(tree)).toContain("Governança → Privilégios");
    expect(nodes(tree).filter(({ type }) => type === "option").map(({ props }) => props.value))
      .toEqual(["", "coordenador", "supervisor"]);
    const dados = fields(tree);
    expect([...dados]).toEqual([["id", alvo.id], ["papel_atual_esperado", "gestor"], ["papel_destino", "supervisor"]]);
    await (form(tree).action as (dados: FormData) => Promise<unknown>)(dados);
    expect(ui.nomear).toHaveBeenCalledWith({ ok: false, message: "" }, dados);
    expect(ui.editar).not.toHaveBeenCalled();
  });

  it("preserva convite, senha, assinatura e suspensão, e oculta troca sem destinos", () => {
    const menu = words(UsuarioAcoes({ row: { ...alvo, papeisDestino: [] } }));
    for (const acao of ["Editar cadastro", "Upload assinatura", "Alterar senha", "Gerar senha provisória", "Suspender", "Apagar"]) {
      expect(menu).toContain(acao);
    }
    expect(menu).not.toContain("Trocar função");
    const pre = words(UsuarioAcoes({ row: { ...alvo, temAcesso: false, preAprovadoId: 9 } }));
    expect(pre).toContain("Cadastrar acesso");
    expect(pre).not.toContain("Trocar função");
    expect(words(UsuarioAcoes({ row: { ...alvo, nome: "—" } }))).toContain("Completar nome");
  });

  it("bloqueia submissão enquanto pendente, e mantém erro ou conflito sem rebase nem reenvio", () => {
    ui.dialog = "nomear";
    ui.destino = "supervisor";
    ui.pending = true;
    const pendente = dialogTree("NomearPapelDialog");
    expect(form(pendente)["aria-busy"]).toBe(true);
    expect(nodes(pendente).some(({ props }) => props.type === "submit" && props.disabled)).toBe(true);
    expect(words(pendente)).toContain("Confirmando…");

    ui.pending = false;
    ui.resposta = { ok: false, codigo: "PAPEL_ALTERADO", message: "A função mudou." };
    ui.atual = { papel: "gestor", label: "Gestor" };
    const conflito = dialogTree("NomearPapelDialog", { ...alvo, papel: "coordenador", papelLabel: "Coordenador" });
    expect(fields(conflito).get("papel_atual_esperado")).toBe("gestor");
    expect(nodes(conflito).some(({ props }) => props.role === "alert")).toBe(true);
    expect(words(conflito)).toContain("Recarregue a lista e confira");
    expect(words(conflito)).toContain("Recarregar lista");
    expect(nodes(conflito).some(({ props }) => props.type === "submit")).toBe(false);
    const preventDefault = vi.fn();
    (form(conflito).onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(ui.nomear).not.toHaveBeenCalled();

    ui.resposta = { ok: false, message: "A nomeação não foi confirmada." };
    const erro = dialogTree("NomearPapelDialog");
    expect(words(erro)).toContain("A nomeação não foi confirmada.");
    expect(nodes(erro).some(({ props }) => props.type === "submit")).toBe(false);
  });

  it("só apresenta conclusão quando a action confirma, sem repetir a troca", () => {
    ui.dialog = "nomear";
    ui.destino = "supervisor";
    ui.resposta = { ok: true, message: "Função atualizada." };
    const tree = dialogTree("NomearPapelDialog", { ...alvo, papel: "supervisor", papelLabel: "Supervisor", papeisDestino: [] });
    expect(words(tree)).toContain("Função atualizada.");
    expect(nodes(tree).some(({ props }) => props.role === "status")).toBe(true);
    expect(nodes(tree).some(({ props }) => props.type === "submit")).toBe(false);
    expect(words(tree)).toContain("Concluir");
  });
});

describe("abertura de conta", () => {
  it("envia Laboratório fixo no cadastro direto, sem seletor nem overrides", async () => {
    const tree = CriarUsuarioForm();
    expect(nodes(tree).filter(({ type }) => type === "option")).toHaveLength(0);
    expect(words(tree)).toContain("A conta começa em Laboratório");
    expect(words(tree)).toContain("Trocar função");
    const dados = fields(tree);
    expect([...dados.keys()].sort()).toEqual(["email", "nome", "papel"]);
    expect(dados.get("papel")).toBe("laboratorio");
    await (form(tree).action as (data: FormData) => Promise<unknown>)(dados);
    expect(ui.criar).toHaveBeenCalledWith({ ok: false, message: "" }, dados);
    expect(component(tree, "SubmitButton").props.pendingLabel).toBe("Cadastrando…");

    ui.resposta = { ok: false, message: "Cadastro não concluído." };
    expect(component(CriarUsuarioForm(), "MensagemAcao").props.estado).toEqual(ui.resposta);
    ui.resposta = { ok: true, message: "Criado.", senhaProvisoria: "fixture-provisoria" };
    expect(component(CriarUsuarioForm(), "SenhaProvisoriaGerada").props.senha).toBe("fixture-provisoria");
  });

  it("abre pré-aprovação Laboratório somente por ID e conserva pendência e feedback", async () => {
    ui.dialog = "pre_aprovar";
    const pre = { ...alvo, temAcesso: false, preAprovadoId: 9, papel: "laboratorio", papelLabel: "Laboratório" };
    const tree = dialogTree("PreAprovarDialog", pre);
    expect(words(tree)).toContain("A conta começa em Laboratório");
    expect(words(tree)).toContain("Trocar função");
    const dados = fields(tree);
    expect([...dados]).toEqual([["pre_aprovado_id", "9"]]);
    await (form(tree).action as (data: FormData) => Promise<unknown>)(dados);
    expect(ui.preAprovar).toHaveBeenCalledWith({ ok: false, message: "" }, dados);

    ui.pending = true;
    expect(nodes(dialogTree("PreAprovarDialog", pre)).some(({ props }) => props.type === "submit" && props.disabled)).toBe(true);
    ui.pending = false;
    ui.resposta = { ok: false, message: "Pré-aprovação não encontrada." };
    expect(words(dialogTree("PreAprovarDialog", pre))).toContain("Pré-aprovação não encontrada.");
    ui.resposta = { ok: true, message: "Acesso criado.", senhaProvisoria: "fixture-pre" };
    expect(component(dialogTree("PreAprovarDialog", pre), "SenhaProvisoriaGerada").props.senha).toBe("fixture-pre");
  });

  it("explica a recusa de pré-aprovação fora de Laboratório sem oferecer envio", () => {
    ui.dialog = "pre_aprovar";
    const tree = dialogTree("PreAprovarDialog", { ...alvo, temAcesso: false, preAprovadoId: 9 });
    expect(words(tree)).toContain("Só pré-aprovações em Laboratório podem abrir conta");
    expect(nodes(tree).some(({ type, props }) => type === "form" || props.type === "submit")).toBe(false);
    expect(ui.preAprovar).not.toHaveBeenCalled();
  });
});

describe("projeção de usuários (leitura mockada, sem banco)", () => {
  it.each([null, { papel: "supervisor" }, { papel: "coordenador" }, { papel: "admin", suspenso: true }])(
    "não abre a lista administrativa para %j",
    async (ator) => {
      ui.usuario.mockResolvedValue(ator && { id: adminId, suspenso: false, ...ator });
      expect(words(await UsuariosPage())).toContain("Acesso restrito");
      expect(ui.cliente).not.toHaveBeenCalled();
    },
  );

  it("Admin mantém a lista; não consulta nem serializa overrides, e projeta os destinos pela guarda Nexus", async () => {
    const perfil = (id: string, papel: string) => ({ id, nome: id, email: `${id}@kontrol.test`, papel, permissoes: { legado: true } });
    const outroAdmin = "00000000-0000-4000-8000-000000000003";
    const supervisor = "00000000-0000-4000-8000-000000000004";
    const registro = [perfil(adminId, "admin"), perfil(outroAdmin, "admin"), perfil(supervisor, "supervisor"), perfil(alvo.id, "gestor")];
    const pre = [{ ...perfil("pre", "gestor"), id: 7 }];
    ui.usuario.mockResolvedValue({ id: adminId, papel: "admin", suspenso: false });
    ui.cliente.mockResolvedValue({ from: ui.from });
    ui.from.mockImplementation((table) => ({ select: (cols: string) => {
      ui.select(table, cols);
      return { order: async () => ({ data: table === "perfis" ? registro : pre }) };
    } }));
    const tree = await UsuariosPage();
    expect(ui.select.mock.calls).toEqual([
      ["perfis", "id, nome, email, papel, suspenso, senha_provisoria, assinatura_path, assinatura_url"],
      ["usuarios_pre_aprovados", "id, nome, email, papel"],
    ]);
    const rows = component(tree, "UsuariosTable").props.rows as UsuarioRow[];
    expect(rows.filter((row) => row.papel === "admin").map(({ id }) => id)).toEqual([adminId, outroAdmin]);
    expect(rows.find(({ id }) => id === adminId)?.papeisDestino).toEqual([]);
    expect(rows.find(({ id }) => id === outroAdmin)?.papeisDestino).toEqual([]);
    expect(rows.find(({ id }) => id === supervisor)?.papeisDestino).toEqual(["coordenador", "gestor"]);
    expect(rows.find(({ id }) => id === alvo.id)?.papeisDestino).not.toContain("gestor");
    expect(rows.find(({ preAprovadoId }) => preAprovadoId === 7)?.papeisDestino).toBeUndefined();
    for (const row of rows) {
      expect(row).not.toHaveProperty("permissoes");
      expect(row).not.toHaveProperty("categorias");
    }
  });
});
