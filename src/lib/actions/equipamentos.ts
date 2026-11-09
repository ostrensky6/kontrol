"use server";

import { revalidatePath } from "next/cache";
import { createClientUntyped } from "@/lib/supabase/server";
import { conferirEscrita } from "@/lib/supabase/escrita";
import { mensagemDoBanco, type EstadoAcao } from "@/lib/erros";
import { pode } from "@/lib/auth/permissao-efetiva";
import { DECISOES_AVISO, TIPOS_MANUTENCAO, type DecisaoAviso, type TipoManutencao } from "@/lib/equipamentos/avisos";

const SEM_PERMISSAO: EstadoAcao = { ok: false, message: "Sua função não permite alterar equipamentos." };

function texto(form: FormData, campo: string, max = 1000) {
  const v = String(form.get(campo) ?? "").trim();
  return v.length > 0 && v.length <= max ? v : null;
}
function opcional(form: FormData, campo: string, max = 200) {
  const v = String(form.get(campo) ?? "").trim();
  return v === "" ? null : v.slice(0, max);
}
function inteiro(form: FormData, campo: string, min: number, max: number) {
  const v = String(form.get(campo) ?? "").trim();
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}
function data(form: FormData, campo: string) {
  const v = String(form.get(campo) ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null;
}
function tipo(form: FormData): TipoManutencao | null {
  const v = String(form.get("tipo") ?? "");
  return (TIPOS_MANUTENCAO as readonly string[]).includes(v) ? (v as TipoManutencao) : null;
}
function atualizar() {
  revalidatePath("/estoque/equipamentos");
  revalidatePath("/");
}

/** Cadastra uma unidade física (patrimônio) de um equipamento do catálogo. */
export async function cadastrarUnidadeEquipamento(_prev: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const equipamentoId = inteiro(form, "equipamento_id", 1, Number.MAX_SAFE_INTEGER);
  const patrimonio = opcional(form, "codigo_patrimonio", 80);
  const serie = opcional(form, "numero_serie", 80);
  if (!equipamentoId) return { ok: false, message: "Escolha o equipamento." };
  if (!patrimonio && !serie) return { ok: false, message: "Informe o patrimônio ou o número de série." };
  if (!(await pode("cadastros.editar"))) return SEM_PERMISSAO;
  const supabase = await createClientUntyped();
  const { data: linhas, error } = await supabase.from("equipamento_unidades").insert({
    equipamento_id: equipamentoId,
    codigo_patrimonio: patrimonio,
    numero_serie: serie,
    patrimonio_de: opcional(form, "patrimonio_de", 120),
    fabricante: opcional(form, "fabricante", 120),
    modelo: opcional(form, "modelo", 120),
    observacoes: opcional(form, "observacoes", 1000),
  }).select("id");
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  const escrita = conferirEscrita(error, linhas, "A unidade não foi cadastrada.");
  if (!escrita.ok) return { ok: false, message: escrita.message };
  atualizar();
  return { ok: true, message: "Unidade cadastrada." };
}

/** Registra uma manutenção/calibração feita ou agendada. */
export async function registrarManutencaoEquipamento(_prev: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const unidadeId = inteiro(form, "equipamento_unidade_id", 1, Number.MAX_SAFE_INTEGER);
  const t = tipo(form);
  const situacao = String(form.get("situacao") ?? "");
  const quando = data(form, "data");
  const proxima = String(form.get("proxima_data") ?? "").trim() === "" ? null : data(form, "proxima_data");
  if (!unidadeId || !t) return { ok: false, message: "Escolha a unidade e o tipo." };
  if (situacao !== "concluida" && situacao !== "agendada") return { ok: false, message: "Diga se já foi feita ou se está agendada." };
  if (!quando) return { ok: false, message: "Informe a data." };
  if (String(form.get("proxima_data") ?? "").trim() !== "" && !proxima) return { ok: false, message: "Próxima data inválida." };
  if (proxima && proxima <= quando) return { ok: false, message: "A próxima data precisa ser depois da data informada." };
  if (!(await pode("cadastros.editar"))) return SEM_PERMISSAO;
  const supabase = await createClientUntyped();
  const { data: linhas, error } = await supabase.from("equipamento_manutencoes").insert({
    equipamento_unidade_id: unidadeId,
    tipo: t,
    status: situacao,
    data_programada: quando,
    data_conclusao: situacao === "concluida" ? quando : null,
    proxima_data: situacao === "concluida" ? proxima : null,
    tecnico_responsavel: opcional(form, "tecnico_responsavel", 120),
    numero_documento: opcional(form, "numero_documento", 120),
    descricao: opcional(form, "descricao", 1000),
  }).select("id");
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  const escrita = conferirEscrita(error, linhas, "A manutenção não foi registrada.");
  if (!escrita.ok) return { ok: false, message: escrita.message };
  atualizar();
  return { ok: true, message: situacao === "concluida" ? "Manutenção registrada." : "Manutenção agendada." };
}

/** Cria ou atualiza o plano (periodicidade e antecedência do aviso) da unidade para um tipo. */
export async function definirPlanoEquipamento(_prev: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const unidadeId = inteiro(form, "equipamento_unidade_id", 1, Number.MAX_SAFE_INTEGER);
  const t = tipo(form);
  const periodicidade = inteiro(form, "periodicidade_dias", 1, 3650);
  const antecedenciaTexto = String(form.get("antecedencia_aviso_dias") ?? "").trim();
  const antecedencia = antecedenciaTexto === "" ? null : inteiro(form, "antecedencia_aviso_dias", 0, 730);
  if (!unidadeId || !t) return { ok: false, message: "Escolha a unidade e o tipo." };
  if (!periodicidade) return { ok: false, message: "Informe de quantos em quantos dias (1 a 3650)." };
  if (antecedenciaTexto !== "" && antecedencia === null) return { ok: false, message: "Antecedência do aviso: 0 a 730 dias." };
  if (!(await pode("cadastros.editar"))) return SEM_PERMISSAO;
  const supabase = await createClientUntyped();
  const valores = {
    periodicidade_dias: periodicidade,
    antecedencia_aviso_dias: antecedencia,
    obrigatorio: form.get("obrigatorio") === "on",
    descricao: opcional(form, "descricao", 500),
    ativo: true,
  };
  const { data: existentes, error: erroLeitura } = await supabase
    .from("equipamento_planos_manutencao")
    .select("id")
    .eq("equipamento_unidade_id", unidadeId)
    .eq("tipo", t)
    .eq("ativo", true)
    .limit(1);
  if (erroLeitura) return { ok: false, message: mensagemDoBanco(erroLeitura) };
  const atual = existentes?.[0]?.id as number | undefined;
  const { data: linhas, error } = atual
    ? await supabase.from("equipamento_planos_manutencao").update(valores).eq("id", atual).select("id")
    : await supabase.from("equipamento_planos_manutencao")
      .insert({ ...valores, equipamento_unidade_id: unidadeId, tipo: t, tolerancia_dias: 0 })
      .select("id");
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  const escrita = conferirEscrita(error, linhas, "O plano não foi salvo.");
  if (!escrita.ok) return { ok: false, message: escrita.message };
  atualizar();
  return { ok: true, message: "Plano salvo." };
}

/** Registra o que foi decidido sobre um aviso; o aviso sai da lista de pendentes. */
export async function encaminharAvisoEquipamento(_prev: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const unidadeId = inteiro(form, "equipamento_unidade_id", 1, Number.MAX_SAFE_INTEGER);
  const t = tipo(form);
  const vencimentoTexto = String(form.get("vencimento") ?? "").trim();
  const vencimento = vencimentoTexto === "" ? null : data(form, "vencimento");
  const decisao = String(form.get("decisao") ?? "");
  const observacao = texto(form, "observacao");
  if (!unidadeId || !t || (vencimentoTexto !== "" && !vencimento)) return { ok: false, message: "Aviso inválido. Recarregue a página." };
  if (!(DECISOES_AVISO as readonly string[]).includes(decisao)) return { ok: false, message: "Escolha o que foi decidido." };
  if (!observacao) return { ok: false, message: "Escreva uma observação (até 1000 caracteres)." };
  if (!(await pode("cadastros.editar"))) return SEM_PERMISSAO;
  const supabase = await createClientUntyped();
  const { data: sessao } = await supabase.auth.getUser();
  if (!sessao?.user?.id) return { ok: false, message: "Entre novamente para registrar." };
  const { data: linhas, error } = await supabase.from("equipamento_aviso_encaminhamentos").insert({
    equipamento_unidade_id: unidadeId,
    tipo: t,
    vencimento,
    decisao: decisao as DecisaoAviso,
    observacao,
    criado_por: sessao.user.id,
  }).select("id");
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  const escrita = conferirEscrita(error, linhas, "O encaminhamento não foi registrado.");
  if (!escrita.ok) return { ok: false, message: escrita.message };
  atualizar();
  return { ok: true, message: "Encaminhamento registrado." };
}
