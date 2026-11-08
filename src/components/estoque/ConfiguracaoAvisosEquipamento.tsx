"use client";

import { useRef, useState, type FormEvent } from "react";
import { unstable_rethrow } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpTip } from "@/components/common/HelpTip";
import { PAPEIS, isPapelUsuario } from "@/lib/auth/permissions";
import { consultarContextoConfiguracaoAvisoEquipamento, consultarDireitoAvisoEquipamento,
  type ContextoConfiguracaoAvisoEquipamento, type DireitoAvisoEquipamento,
  type ConsultaContextoAvisoEquipamento } from "@/lib/actions/equipamentos-contexto";
import { configurarAvisoEquipamento, governarDireitoAvisoEquipamento,
  type ResultadoAcaoAvisoEquipamento } from "@/lib/actions/equipamentos-avisos";

const TIPOS = ["preventiva", "corretiva", "calibracao", "qualificacao", "verificacao", "limpeza_tecnica"] as const;
const OPERACOES = ["configurar", "avaliar", "reconhecer", "encaminhar"] as const;
const selectClass = "mt-1 min-h-11 w-full rounded-md border border-input bg-background px-2 text-foreground focus-visible:outline-2 focus-visible:outline-ring";

export function ConfiguracaoAvisosEquipamento({ unidadeId, escritaHabilitada }: { unidadeId: number; escritaHabilitada: boolean }) {
  const [tipo, setTipo] = useState("");
  return <details className="mt-3 border-t border-border py-2 text-sm">
    <summary className="min-h-11 cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-ring">Consultar configuração e direitos</summary>
    <HelpTip title="Configuração dos avisos"><p>Selecione uma origem e um responsável retornados pela consulta autorizada. Página vazia não prova ausência de regra. A gravação revalida permissão e versão no banco; não bloqueia o equipamento automaticamente.</p></HelpTip>
    {!escritaHabilitada && <p>Escrita desabilitada. Consultas permitidas continuam disponíveis.</p>}
    <label className="block">Tipo de ocorrência<select className={selectClass} value={tipo} onChange={(e) => setTipo(e.target.value)}>
      <option value="">Selecione o tipo</option>{TIPOS.map((t) => <option key={t} value={t}>{t.replaceAll("_", " ")}</option>)}
    </select></label>
    {TIPOS.map((t) => t === tipo && <ContextoAviso key={`${unidadeId}:${t}`} unidadeId={unidadeId} tipo={t} habilitada={escritaHabilitada} />)}
  </details>;
}

function ContextoAviso({ unidadeId, tipo, habilitada }: { unidadeId: number; tipo: ConsultaContextoAvisoEquipamento["p_tipo"]; habilitada: boolean }) {
  const [dados, setDados] = useState<ContextoConfiguracaoAvisoEquipamento | null>(null);
  const [erro, setErro] = useState("");
  const [pending, setPending] = useState(false);
  const trava = useRef(false);
  const cursores = useRef<{ origem: number | null; responsavel: string | null }>({ origem: null, responsavel: null });
  async function consultar(origem: number | null = null, responsavel: string | null = null) {
    if (trava.current) return;
    trava.current = true; setPending(true); setDados(null); setErro("");
    try {
      const r = await consultarContextoConfiguracaoAvisoEquipamento({ p_unidade_id: unidadeId, p_tipo: tipo, p_origem_apos: origem, p_responsavel_apos: responsavel, p_limite: 20 });
      if (r.ok) { cursores.current = { origem, responsavel }; setDados(r.dados); } else setErro(r.message);
    } catch (e) { unstable_rethrow(e); setErro("Consulta indisponível. Tente consultar novamente."); }
    finally { trava.current = false; setPending(false); }
  }
  return <div className="mt-3 space-y-3" aria-busy={pending}>
    <Button type="button" variant="outline" disabled={pending} onClick={() => void consultar()}>{pending ? "Consultando…" : "Consultar / reler primeira página"}</Button>
    {erro && <p role="alert" className="text-danger-strong">{erro}</p>}
    {dados && <>
      <p>Configuração autorizada na consulta. Governança: {dados.permissoes.governar ? "autorizada na consulta" : "não concedida"}.</p>
      <p>{dados.versao_esperada === null ? "Versão desconhecida: gravação bloqueada." : dados.versao_esperada === 0 ? "Ausência de regra confirmada; versão esperada 0." : `Versão esperada: ${dados.versao_esperada}.`}</p>
      {dados.origens.itens.length === 0 && <p>Nenhuma origem nesta página. Isso não confirma ausência de regra.</p>}
      {dados.responsaveis.itens.length === 0 && <p>Nenhum responsável nesta página.</p>}
      <div className="flex flex-wrap gap-2">
        {dados.origens.proximo_apos !== null && <Button type="button" variant="outline" onClick={() => void consultar(dados.origens.proximo_apos, cursores.current.responsavel)}>Próxima página de origens</Button>}
        {dados.responsaveis.proximo_apos !== null && <Button type="button" variant="outline" onClick={() => void consultar(cursores.current.origem, dados.responsaveis.proximo_apos)}>Próxima página de responsáveis</Button>}
      </div>
      <p className="text-muted-foreground">Cada releitura limpa a seleção. A consulta não dispensa reautorização e comparação da versão na gravação.</p>
      {habilitada && dados.versao_esperada !== null && dados.versao_esperada < 2147483647 && dados.origens.itens.length > 0 && dados.responsaveis.itens.length > 0 && <GravarAviso dados={dados} />}
      {dados.permissoes.governar === true && <GovernancaAviso habilitada={habilitada} />}
    </>}
  </div>;
}

function GravarAviso({ dados, direito }: { dados?: ContextoConfiguracaoAvisoEquipamento; direito?: DireitoAvisoEquipamento }) {
  const [resultado, setResultado] = useState<ResultadoAcaoAvisoEquipamento | null>(null);
  const [pending, setPending] = useState(false);
  const trava = useRef(false);
  const encerrado = useRef(false);
  async function gravar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (trava.current || encerrado.current) return;
    const form = new FormData(e.currentTarget);
    const enviar = new FormData();
    enviar.set("p_motivo", String(form.get("p_motivo") ?? ""));
    if (!String(form.get("p_motivo") ?? "").trim() || form.get("confirmacao") !== "sim") return;
    if (dados) {
      const origem = dados.origens.itens.find((o) => String(o.id) === form.get("origem"));
      const responsavel = dados.responsaveis.itens.find((r) => r.id === form.get("responsavel"));
      if (!origem || !responsavel || dados.versao_esperada === null) return;
      for (const [k, v] of Object.entries({ p_unidade_id: dados.equipamento_unidade_id, p_tipo: dados.tipo, p_versao_esperada: dados.versao_esperada, p_ocorrencia_id: origem.id, p_data_referencia: origem.proxima_data, p_responsavel_id: responsavel.id, p_antecedencia_dias: form.get("p_antecedencia_dias") })) enviar.set(k, String(v));
    } else if (direito?.pode_governar === true) {
      const concedido = form.get("p_concedido");
      if (concedido !== "true" && concedido !== "false") return;
      for (const [k, v] of Object.entries({ p_papel: direito.papel, p_operacao: direito.operacao, p_concessao_esperada: String(direito.concessao_esperada), p_concedido: concedido })) enviar.set(k, v);
    } else return;
    trava.current = true; setPending(true);
    enviar.set("p_operacao_id", crypto.randomUUID());
    try { setResultado(await (dados ? configurarAvisoEquipamento : governarDireitoAvisoEquipamento)(null, enviar)); }
    catch (erro) { unstable_rethrow(erro); setResultado({ ok: false, codigo: "INDISPONIVEL", message: "Resultado não confirmado. Recarregue antes de decidir uma nova operação." }); }
    finally { encerrado.current = true; trava.current = false; setPending(false); }
  }
  return <form onSubmit={gravar} aria-busy={pending} className="space-y-3 border-t border-border pt-3">
    <fieldset disabled={pending || resultado !== null} className="space-y-3">
      <legend className="font-medium">{dados ? "Configurar aviso" : "Alterar concessão consultada"}</legend>
      {dados ? <>
        <label className="block">Origem<select className={selectClass} name="origem" required defaultValue=""><option value="">Selecione uma origem</option>{dados.origens.itens.map((o) => <option key={o.id} value={o.id}>Ocorrência #{o.id} · {o.proxima_data} · {o.status}</option>)}</select></label>
        <label className="block">Responsável<select className={selectClass} name="responsavel" required defaultValue=""><option value="">Selecione um responsável</option>{dados.responsaveis.itens.map((r) => <option key={r.id} value={r.id}>{r.nome ?? "Nome não informado"} · {r.id}</option>)}</select></label>
        <label className="block">Antecedência em dias<Input name="p_antecedencia_dias" type="number" min={0} max={2147483647} step={1} required /></label>
      </> : <>
        <p>{direito?.papel} · {direito?.operacao} · Concessão atual: {direito?.concessao_esperada ? "sim" : "não"}.</p>
        <label className="block">Nova concessão<select className={selectClass} name="p_concedido" required defaultValue=""><option value="">Escolha explicitamente</option><option value="true">Conceder</option><option value="false">Não conceder</option></select></label>
      </>}
      <label className="block">Motivo<Input name="p_motivo" required /></label>
      <label className="flex items-start gap-2"><input name="confirmacao" type="checkbox" value="sim" required />Confirmo esta operação e a revisão dos dados consultados.</label>
      {resultado === null && <Button type="submit" disabled={pending}>{pending ? "Registrando…" : "Confirmar gravação"}</Button>}
    </fieldset>
    {resultado && <><p role={resultado.ok ? "status" : "alert"}>{resultado.ok ? "Operação confirmada. Recarregue para consultar a regra e avaliar a janela." : resultado.message}</p><Button type="button" variant="outline" onClick={() => window.location.reload()}>Recarregar antes de outra operação</Button></>}
  </form>;
}

function GovernancaAviso({ habilitada }: { habilitada: boolean }) {
  const [par, setPar] = useState({ papel: "", operacao: "" });
  return <details className="border-t border-border pt-3">
    <summary className="min-h-11 cursor-pointer focus-visible:outline-2 focus-visible:outline-ring">Governança dos direitos de aviso</summary>
    <p>Escolha o par função/operação. Nenhuma política vem pré-selecionada; somente a consulta confirma a concessão atual.</p>
    <label className="block">Função<select className={selectClass} value={par.papel} onChange={(e) => setPar({ ...par, papel: e.target.value })}><option value="">Selecione</option>{PAPEIS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
    <label className="block">Operação<select className={selectClass} value={par.operacao} onChange={(e) => setPar({ ...par, operacao: e.target.value })}><option value="">Selecione</option>{OPERACOES.map((o) => <option key={o}>{o}</option>)}</select></label>
    {isPapelUsuario(par.papel) && OPERACOES.map((operacao) => operacao === par.operacao && <ConsultarDireito key={`${par.papel}:${operacao}`} papel={par.papel as DireitoAvisoEquipamento["papel"]} operacao={operacao} habilitada={habilitada} />)}
  </details>;
}

function ConsultarDireito({ papel, operacao, habilitada }: Pick<DireitoAvisoEquipamento, "papel" | "operacao"> & { habilitada: boolean }) {
  const [direito, setDireito] = useState<DireitoAvisoEquipamento | null>(null);
  const [erro, setErro] = useState("");
  const [pending, setPending] = useState(false);
  const trava = useRef(false);
  async function consultar() {
    if (trava.current) return;
    trava.current = true; setPending(true); setDireito(null); setErro("");
    try { const r = await consultarDireitoAvisoEquipamento({ p_papel: papel, p_operacao: operacao }); if (r.ok) setDireito(r.dados); else setErro(r.message); }
    catch (e) { unstable_rethrow(e); setErro("Concessão desconhecida. Consulte novamente antes de operar."); }
    finally { trava.current = false; setPending(false); }
  }
  return <div aria-busy={pending} className="mt-3 space-y-2">
    <Button type="button" variant="outline" disabled={pending} onClick={() => void consultar()}>{pending ? "Consultando concessão…" : "Consultar / reler concessão"}</Button>
    {erro && <p role="alert">{erro}</p>}
    {direito && <p>Concessão confirmada: {direito.concessao_esperada ? "sim" : "não"}.</p>}
    {habilitada && direito?.pode_governar === true && <GravarAviso direito={direito} />}
  </div>;
}
