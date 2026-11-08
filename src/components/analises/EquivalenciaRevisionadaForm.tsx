"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import type { ContextoEquivalencia } from "@/lib/costing/equivalencia-contexto";
import { prepararEquivalenciaRevisionada, registrarEquivalenciaRevisionada, revogarEquivalenciaRevisionada, type EstadoEquivalenciaRevisionada } from "@/lib/actions/equivalencia-revisionada";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Contexto = Extract<ContextoEquivalencia, { estado: "disponivel" }>;
type Tentativa = { campos: Record<string, string>; contexto: string; necessidade: number; enviada: boolean };
const inicial: EstadoEquivalenciaRevisionada = { ok: false };
const versao = "equivalencia-escrita-v1";
const selectClass = "mt-1 min-h-11 w-full rounded-md border border-input bg-background px-2 focus-visible:outline-2 focus-visible:outline-ring";
const incerta = (): EstadoEquivalenciaRevisionada => ({ ok: false, motivo: "resultado_indeterminado", message: "Resultado não confirmado. Preserve esta tentativa; não presuma ausência de efeito ou rollback." });
function formData(campos: Record<string, string>) { const form = new FormData(); for (const [k,v] of Object.entries(campos)) form.set(k,v); return form; }
function decimalSemExpoente(valor: number) {
  const [mantissa, expoente] = String(valor).split("e");
  if (expoente === undefined) return mantissa;
  const [inteiro, fracao = ""] = mantissa.split(".");
  const digitos = inteiro + fracao;
  const ponto = inteiro.length + Number(expoente);
  // Expande os dígitos originais; não arredonda nem altera a grandeza da fonte.
  return ponto <= 0 ? "0." + "0".repeat(-ponto) + digitos
    : ponto >= digitos.length ? digitos + "0".repeat(ponto - digitos.length)
    : digitos.slice(0, ponto) + "." + digitos.slice(ponto);
}

export function EquivalenciaRevisionadaForm({ contexto: c, habilitada }: { contexto: Contexto; habilitada: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [tentativa, setTentativa] = useState<Tentativa | null>(null);
  const [resultado, setResultado] = useState<EstadoEquivalenciaRevisionada>(inicial);
  const [busy, setBusy] = useState<"preparar" | "gravar" | null>(null);
  const [anteriores, setAnteriores] = useState<Tentativa[]>([]);
  const epoch = useRef(0);
  const trava = useRef(false);
  const atual = useRef<Tentativa | null>(null);
  const stamp = `${c.codigo_analise}:${c.metodo_revisao_ref}:${c.revisao_contexto}`;
  useEffect(() => () => { epoch.current++; }, [stamp]);
  const necessidade = c.necessidades.find((n) => String(n.necessidade_id) === draft.necessidade_id);
  const candidato = necessidade?.candidatos.find((i) => String(i.insumo_id) === draft.insumo_id);
  const decisao = c.decisoes.find((d) => d.decisao_ref === draft.decisao_ref);
  const congelada = tentativa?.enviada === true;
  const pode = habilitada && (draft.acao === "registrar" ? c.capacidades.registrar : draft.acao === "revogar" && c.capacidades.revogar);
  const preparada = tentativa !== null && (tentativa.enviada || tentativa.contexto === stamp);
  function editar(name: string, value: string) {
    if (atual.current?.enviada) return;
    epoch.current++; atual.current = null; setTentativa(null); setResultado(inicial);
    setDraft((d): Record<string, string> => name === "acao" ? { acao: value } : name === "necessidade_id" ? { ...d, necessidade_id: value, insumo_id: "" } : { ...d, [name]: value });
  }
  async function preparar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (trava.current || !pode || atual.current?.enviada) return;
    const campos: Record<string, string> = { versao, acao: draft.acao, codigo_analise: c.codigo_analise, metodo_revisao_ref: c.metodo_revisao_ref };
    let necessidadeId: number;
    if (draft.acao === "registrar") {
      if (!necessidade || !candidato || !draft.equipamento_id || (draft.equipamento_id !== "sem" && !c.equipamentos.some((e) => String(e.equipamento_id) === draft.equipamento_id))) return;
      necessidadeId = necessidade.necessidade_id;
      Object.assign(campos, { necessidade_id: String(necessidadeId), etapa_id: necessidade.etapa_id === null ? "" : String(necessidade.etapa_id), insumo_id: String(candidato.insumo_id), equipamento_id: draft.equipamento_id === "sem" ? "" : draft.equipamento_id,
        apresentacao_ref: draft.apresentacao_ref ?? "", unidade_estoque: candidato.unidade_estoque, unidade_consumo: candidato.unidade_consumo, fator_conversao: decimalSemExpoente(candidato.fator_conversao), evidencia_ref: draft.evidencia_ref ?? "", vigente_ate: draft.vigente_ate ?? "", confirmada: draft.confirmada ?? "" });
    } else {
      if (!decisao?.pode_revogar || decisao.estado !== "validada") return;
      necessidadeId = decisao.necessidade_id;
      Object.assign(campos, { decisao_ref: decisao.decisao_ref, motivo: draft.motivo ?? "" });
    }
    const e = ++epoch.current; trava.current = true; setBusy("preparar"); setResultado(inicial); atual.current = null; setTentativa(null);
    try {
      const r = await prepararEquivalenciaRevisionada(inicial, formData(campos));
      if (epoch.current !== e) return;
      const p = r.preparacao;
      if (r.ok && p && p.cas_escrita === true && p.versao === versao && p.acao === campos.acao && p.codigo_analise === campos.codigo_analise && p.metodo_revisao_ref === campos.metodo_revisao_ref && p.necessidade_id === necessidadeId && p.decisao_ref === (campos.decisao_ref ?? null)) {
        const t = { campos: { ...campos, operacao_id: crypto.randomUUID(), revisao_esperada: p.revisao_esperada }, contexto: stamp, necessidade: necessidadeId, enviada: false };
        atual.current = t; setTentativa(t); setResultado(r);
      } else setResultado(r.ok ? incerta() : r);
    } catch (error) { unstable_rethrow(error); if (epoch.current === e) setResultado(incerta()); }
    finally { trava.current = false; setBusy(null); }
  }
  async function confirmar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const t = atual.current;
    if (trava.current || !pode || !t || (!t.enviada && t.contexto !== stamp) || new FormData(event.currentTarget).get("confirmar") !== "sim") return;
    if (resultado.motivo === "contexto_obsoleto" || resultado.motivo === "identidade_reutilizada" || resultado.recibo) return;
    const enviada = { ...t, enviada: true }; atual.current = enviada; setTentativa(enviada);
    trava.current = true; setBusy("gravar"); const e = ++epoch.current;
    try {
      const action = t.campos.acao === "registrar" ? registrarEquivalenciaRevisionada : revogarEquivalenciaRevisionada;
      const r = await action(inicial, formData(t.campos));
      if (epoch.current !== e) return;
      const recibo = r.recibo;
      const correlacionado = recibo && recibo.operacao_id === t.campos.operacao_id && recibo.revisao_aplicada === t.campos.revisao_esperada && recibo.codigo_analise === t.campos.codigo_analise && recibo.metodo_revisao_ref === t.campos.metodo_revisao_ref && recibo.acao === t.campos.acao && recibo.necessidade_id === t.necessidade && recibo.estado === (t.campos.acao === "registrar" ? "validada" : "revogada") && (t.campos.acao !== "revogar" || recibo.decisao_ref === t.campos.decisao_ref);
      setResultado(r.ok && !correlacionado ? incerta() : r);
      router.refresh();
    } catch (error) { unstable_rethrow(error); if (epoch.current === e) { setResultado(incerta()); router.refresh(); } }
    finally { trava.current = false; setBusy(null); }
  }
  function novaIntencao(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (trava.current || new FormData(event.currentTarget).get("separar") !== "sim") return;
    if (atual.current?.enviada) setAnteriores((a) => [...a, atual.current!]);
    epoch.current++; atual.current = null; setTentativa(null); setDraft({}); setResultado(inicial); router.refresh();
  }
  const select = (name: string, label: string, options: [string,string][]) => <label className="block">{label}<select name={name} className={selectClass} required value={draft[name] ?? ""} onChange={(e) => editar(name,e.target.value)}><option value="">Selecione explicitamente</option>{options.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
  const input = (name: string, label: string, required: boolean, maxLength: number) => <label className="block">{label}<Input name={name} value={draft[name] ?? ""} onChange={(e) => editar(name,e.target.value)} required={required} maxLength={maxLength} /></label>;
  return <div className="space-y-3 border-t border-border pt-3 text-sm" aria-busy={busy !== null}>
    <p>Contexto autorizado lido em {new Date(c.instante).toISOString()}. Candidatos não são equivalências; esta leitura não é CAS.</p>
    {c.estado_validacoes === "contexto_divergente" && <p role="alert">Há validação divergente do contexto atual. Consulte os dados antes de preparar.</p>}
    <p>Registro: {c.capacidades.registrar ? "capacidade informada" : "não concedido"} · Revogação: {c.capacidades.revogar ? "capacidade informada" : "não concedida"}. O servidor reautoriza cada operação.</p>
    {!habilitada ? <p>Escrita revisionada desabilitada; consulta preservada.</p> : <>
      <form onSubmit={preparar} className="space-y-3">
        <fieldset disabled={congelada || busy === "gravar"} className="space-y-3">
          <legend className="font-medium">Intenção de validação técnica</legend>
          {select("acao", "Operação", [...(c.capacidades.registrar ? [["registrar", "Registrar"] as [string,string]] : []), ...(c.capacidades.revogar ? [["revogar", "Revogar"] as [string,string]] : [])])}
          {draft.acao === "registrar" && <>
            {select("necessidade_id", "Necessidade da ficha", c.necessidades.map((n) => [String(n.necessidade_id), `#${n.necessidade_id} · ${n.nome_atividade ?? n.nome_etapa ?? "Sem rótulo"}`]))}
            {necessidade && <p>Etapa: {necessidade.etapa_id ?? "sem vínculo"}. {necessidade.candidatos.length === 0 ? "Nenhum candidato autorizado para esta necessidade." : "Selecione um candidato; a escolha não constitui validação."}</p>}
            {select("insumo_id", "SKU candidato autorizado", (necessidade?.candidatos ?? []).map((i) => [String(i.insumo_id), `#${i.insumo_id} · ${i.especificacao}`]))}
            {candidato && <p>Estoque: {candidato.unidade_estoque} · consumo: {candidato.unidade_consumo} · fator: {candidato.fator_conversao}. Valores da consulta, não editáveis.</p>}
            {select("equipamento_id", "Contexto de equipamento", [["sem", "Sem equipamento (ausência explícita)"], ...c.equipamentos.map((e): [string,string] => [String(e.equipamento_id), `#${e.equipamento_id} · ${e.nome}`])])}
            {input("apresentacao_ref", "Referência documental da apresentação (atestação explícita)", true, 160)}
            {input("evidencia_ref", "Referência da evidência técnica", true, 240)}
            {input("vigente_ate", "Fim de vigência opcional (ISO 8601 com fuso; vazio = sem fim)", false, 40)}
            <label className="flex items-start gap-2"><input name="confirmada" type="checkbox" checked={draft.confirmada === "sim"} onChange={(e) => editar("confirmada",e.target.checked ? "sim" : "")} required />Atesto a intenção técnica desta revisão documental, apresentação e evidência.</label>
          </>}
          {draft.acao === "revogar" && <>
            {select("decisao_ref", "Decisão autorizada para revogação", c.decisoes.filter((d) => d.pode_revogar && d.estado === "validada").map((d) => [d.decisao_ref, `${d.decisao_ref} · necessidade #${d.necessidade_id} · SKU #${d.insumo_id}`]))}
            {input("motivo", "Motivo da revogação", true, 500)}
          </>}
          {!congelada && <Button type="submit" disabled={!pode || busy !== null}>{busy === "preparar" ? "Preparando contexto…" : "Preparar sem gravar"}</Button>}
        </fieldset>
      </form>
      {preparada && <div className="space-y-2 break-words">
        <p>Operação {tentativa.campos.operacao_id} · CAS {tentativa.campos.revisao_esperada}.</p>
        <details><summary className="min-h-11 cursor-pointer">Intenção congelada da tentativa</summary><dl>{Object.entries(tentativa.campos).map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{v || "Ausência explícita"}</dd></div>)}</dl></details>
        {!resultado.recibo && resultado.motivo !== "contexto_obsoleto" && resultado.motivo !== "identidade_reutilizada" && <form onSubmit={confirmar} className="space-y-2">
          <label className="flex items-start gap-2"><input name="confirmar" type="checkbox" value="sim" required disabled={busy !== null} />Confirmo {tentativa.campos.acao === "registrar" ? "o registro" : "a revogação"} desta intenção exata.</label>
          <Button type="submit" disabled={busy !== null || !pode}>{busy === "gravar" ? "Confirmando…" : tentativa.enviada ? "Repetir exatamente a mesma tentativa" : "Confirmar gravação preparada"}</Button>
        </form>}
      </div>}
      {resultado.message && <p role={resultado.ok ? "status" : "alert"}>{resultado.motivo ? `${resultado.motivo}: ` : ""}{resultado.message}</p>}
      {resultado.recibo && <p>Recibo {resultado.recibo.replay ? "histórico (replay, sem novo efeito)" : "da operação"}: {resultado.recibo.decisao_ref}, {resultado.recibo.estado}. Não é o estado atual; replay não desfaz revogação. A consulta autorizada abaixo é atualizada separadamente.</p>}
      {congelada && <form onSubmit={novaIntencao} className="space-y-2 border-t border-border pt-3">
        <label className="flex items-start gap-2"><input name="separar" type="checkbox" value="sim" required disabled={busy !== null} />Quero outra intenção. Sei que a operação anterior pode ter produzido efeito; isto não a cancela nem confirma rollback.</label>
        <Button type="submit" variant="outline" disabled={busy !== null}>Separar nova intenção e reler</Button>
      </form>}
    </>}
    {anteriores.map((a) => <details key={a.campos.operacao_id} className="break-words"><summary className="min-h-11 cursor-pointer">Tentativa anterior preservada: {a.campos.operacao_id} — não presumir ausência de efeito</summary><pre className="whitespace-pre-wrap">{JSON.stringify(a.campos,null,2)}</pre></details>)}
    <Button type="button" variant="outline" disabled={busy !== null} onClick={() => { epoch.current++; if (!atual.current?.enviada) { atual.current = null; setTentativa(null); } router.refresh(); }}>Atualizar consulta autorizada</Button>
    <p className="text-muted-foreground">Não há retry automático. A vigência é verificada pelo servidor; o relógio local não bloqueia replay da intenção original.</p>
  </div>;
}
