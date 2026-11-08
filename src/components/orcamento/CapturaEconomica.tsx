"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import { Button } from "@/components/ui/button";
import { capturarNovoOrcamentoEquivalencia, type EstadoCapturaEquivalencia } from "@/lib/actions/captura-orcamento-equivalencia";
import type { IntencaoCaptura, LeituraContextoCaptura, LeituraHistoricoCaptura, PreparacaoCaptura } from "@/lib/orcamento/captura-equivalencia-leitura";

type Props = { orcamentoId: number; contexto: LeituraContextoCaptura; prepararAction: (input: unknown) => Promise<PreparacaoCaptura> };
const incerta: EstadoCapturaEquivalencia = { ok:false, motivo:"resultado_indeterminado", message:"Resultado não confirmado. Consulte o histórico pelo UUID antes de decidir repetir a mesma tentativa." };

export function CapturaEconomica({ orcamentoId, contexto: c, prepararAction }: Props) {
  const router = useRouter();
  const [tentativa, setTentativa] = useState<IntencaoCaptura | null>(null);
  const [resultado, setResultado] = useState<EstadoCapturaEquivalencia | null>(null);
  const [pending, setPending] = useState(false);
  const trava = useRef(false);
  const epoch = useRef(0);
  const enviada = useRef(false);
  const stamp = c.estado === "contexto" ? c.contexto_ref : c.estado;
  useEffect(() => () => { epoch.current++; }, [orcamentoId, stamp]);
  const autorizado = c.estado === "contexto" && c.orcamento_id === orcamentoId && c.captura_habilitada && c.capacidades.preparar_intencao && c.revisao !== null;

  async function executar(intencao: IntencaoCaptura, e: number) {
    enviada.current = true;
    setResultado(incerta);
    try {
    const r = await capturarNovoOrcamentoEquivalencia(intencao);
    if (epoch.current !== e) return;
    const recibo = r.recibo;
    const confirmado = r.ok && recibo?.operacao_id === intencao.operacao_id && recibo.orcamento_id === orcamentoId
      && recibo.revisao_anterior === intencao.revisao_esperada && recibo.quantidade_itens === Object.keys(intencao.metodos).length
      && recibo.revisao_aplicada === intencao.revisao_esperada + recibo.quantidade_itens;
    setResultado(r.ok && !confirmado ? incerta : r);
    } finally {
      // Efeito possível exige reconciliação mesmo quando o recibo é tardio ou perdido.
      router.refresh();
    }
  }
  async function iniciar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trava.current || tentativa || enviada.current || !autorizado || c.estado !== "contexto" || c.revisao === null) return;
    const fd = new FormData(event.currentTarget);
    if (fd.get("confirmar") !== "sim") return;
    const metodos: Record<string,string> = {};
    for (const item of c.itens) {
      const escolhido = String(fd.get(`metodo-${item.id}`) ?? "");
      if (!item.metodos_documentados.some(m => m.metodo_revisao_ref === escolhido && m.tem_validacao_vigente && m.estado_validacoes === "disponivel")) return;
      metodos[item.codigo_analise] = escolhido;
    }
    if (!c.itens.length || Object.keys(metodos).length !== c.itens.length) return;
    const intencao: IntencaoCaptura = { versao:"equivalencia-economica-v1",orcamento_id:orcamentoId,revisao_esperada:c.revisao,operacao_id:crypto.randomUUID(),metodos };
    trava.current = true; setPending(true); const e = epoch.current; setResultado(null);
    try {
      const p = await prepararAction({ contexto_ref:c.contexto_ref,intencao });
      if (epoch.current !== e) return;
      if (p.estado !== "preparada") { setResultado({ok:false,message:`Preparação recusada: ${p.motivo}. Releia o contexto.`}); return; }
      // Nunca aceita que o transporte substitua a intenção criada e confirmada.
      if (p.contexto_ref !== c.contexto_ref || JSON.stringify(p.intencao) !== JSON.stringify(intencao)) { setResultado({ok:false,message:"Preparação divergente. Releia o contexto."}); return; }
      setTentativa(p.intencao);
      await executar(p.intencao,e);
    } catch (error) { unstable_rethrow(error); if (epoch.current === e) setResultado(incerta); }
    finally { trava.current=false; setPending(false); }
  }
  async function repetir() {
    if (trava.current || !tentativa || resultado?.motivo !== "resultado_indeterminado") return;
    trava.current=true; setPending(true); const e=epoch.current;
    try { await executar(tentativa,e); }
    catch(error) { unstable_rethrow(error); if(epoch.current===e)setResultado(incerta); }
    finally { trava.current=false;setPending(false); }
  }
  return <section aria-label="Captura econômica por equivalência" aria-busy={pending} className="no-print mt-4 space-y-3 border-t border-border pt-4 text-sm">
    <h3 className="font-semibold">Captura econômica por equivalência</h3>
    <p>Usa composição e quantidades já persistidas. Fontes econômicas não verificadas: preparar não trava preços nem comprova fontes; o executor revalida e aplica CAS atomicamente. Não emite proposta.</p>
    {c.estado !== "contexto" ? <p role="alert">Contexto {c.estado}: {c.motivo}. Não significa ausência de captura.</p> : <>
      <p>Orçamento #{c.orcamento_id} · demanda #{c.demanda.id} · revisão {c.revisao ?? "desconhecida"} · modo {c.modo}.</p>
      {!c.captura_habilitada && <p>Captura desligada. Consulta autorizada preservada.</p>}
      {!c.capacidades.preparar_intencao && <p>Preparação não concedida nesta leitura.</p>}
      {c.itens.length === 0 && <p>Nenhum item confirmado; não representa custo zero.</p>}
      {autorizado && !tentativa && <form onSubmit={iniciar} className="space-y-3">
        <fieldset disabled={pending} className="space-y-3">
          {c.itens.map(i => <label key={i.id} className="block">{i.codigo_analise} · {i.n_amostras ?? "quantidade desconhecida"} amostras persistidas
            <select name={`metodo-${i.id}`} required defaultValue="" className="block min-h-11 w-full rounded-md border border-input bg-background px-2">
              <option value="">Escolha a revisão documental</option>
              {i.metodos_documentados.filter(m=>m.tem_validacao_vigente&&m.estado_validacoes==="disponivel").map(m=><option key={m.metodo_revisao_ref}>{m.metodo_revisao_ref}</option>)}
            </select>
          </label>)}
          <label className="flex items-start gap-2"><input type="checkbox" name="confirmar" value="sim" required />Confirmo a captura com os itens persistidos. Após capturar, editores e recálculo legados ficam bloqueados; este contrato não oferece edição de quantidade nem reversão.</label>
          <Button type="submit">{pending ? "Preparando / capturando…" : "Confirmar captura econômica"}</Button>
        </fieldset>
      </form>}
    </>}
    {tentativa && <details open className="break-words"><summary>Intenção original · UUID {tentativa.operacao_id}</summary><pre className="whitespace-pre-wrap">{JSON.stringify(tentativa,null,2)}</pre></details>}
    {resultado && <p role={resultado.ok?"status":"alert"}>{resultado.motivo && `${resultado.motivo}: `}{resultado.message}</p>}
    {resultado?.recibo && <p>Recibo {resultado.recibo.replay?"histórico/replay":"confirmado"}: revisão {resultado.recibo.revisao_aplicada}. Não substitui o estado atual.</p>}
    {tentativa && resultado?.motivo === "resultado_indeterminado" && <Button disabled={pending} type="button" onClick={repetir}>Repetir intenção original, sem preparar novamente</Button>}
    <Button disabled={pending} type="button" variant="outline" onClick={()=>router.refresh()}>Reler contexto atual</Button>
    <p>A tentativa existe somente em memória até desmontar: sair ou recarregar não garante recuperação. Anote o UUID para consultar o histórico. Nenhum retry é automático; conflito exige conferência, não troca de UUID.</p>
    <a href="#historico-laboratorio" className="underline">Consultar histórico pelo UUID</a>
  </section>;
}

export function HistoricoEconomico({ orcamentoId, contexto, geracaoLeitura, consultarAction }: { orcamentoId:number; contexto:LeituraContextoCaptura; geracaoLeitura:string; consultarAction:(uuid:string)=>Promise<LeituraHistoricoCaptura> }) {
  const geracao = `${orcamentoId}:${geracaoLeitura}:${contexto.estado}:${contexto.estado === "contexto" ? contexto.contexto_ref : contexto.motivo}`;
  const [cache,setH]=useState<{geracao:string; leitura:LeituraHistoricoCaptura}|null>(null);
  // Oculta o corpo antigo já no primeiro render, antes de executar efeitos.
  const h = cache?.geracao === geracao ? cache.leitura : null;
  const [pending,setPending]=useState(false);
  const trava=useRef(false); const epoch=useRef(0);
  useEffect(()=>()=>{epoch.current++;},[geracao]);
  async function consultar(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(trava.current)return;
    const uuid=String(new FormData(e.currentTarget).get("uuid")??"").trim();
    trava.current=true;setPending(true);setH(null);const atual=epoch.current;
    try { const r=await consultarAction(uuid);if(epoch.current===atual)setH({geracao,leitura:r}); }
    catch(error){unstable_rethrow(error);if(epoch.current===atual)setH({geracao,leitura:{versao:"captura-economica-leitura-v1",estado:"indisponivel",motivo:"falha_de_leitura"}});}
    finally{trava.current=false;setPending(false);}
  }
  return <section aria-label="Histórico econômico congelado" aria-busy={pending} className="space-y-3 border-t border-border pt-3 text-sm">
    <h3 className="font-semibold">Histórico econômico congelado</h3>
    {contexto.estado === "contexto" ? <><p>{contexto.historico.length} de {contexto.historico_total} recibos. {contexto.historico_truncado?"Lista truncada aos últimos 20; consulte UUID conhecido.":"Lista desta leitura."}</p><ul className="break-words">{contexto.historico.map(r=><li key={r.operacao_id}>{r.operacao_id} · {r.criado_em}</li>)}</ul></> : <p>Lista atual indisponível; a consulta por UUID conhecido é independente.</p>}
    {contexto.estado === "negado" && <p role="alert">Contexto negado: {contexto.motivo}. Leituras anteriores invalidadas. Uma nova consulta por UUID revalida a autorização no servidor.</p>}
    <form onSubmit={consultar} className="space-y-2"><label className="block">UUID da operação<input name="uuid" required className="block min-h-11 w-full rounded-md border border-input bg-background px-2" /></label><Button disabled={pending} type="submit">{pending?"Consultando…":"Consultar recibo e snapshot"}</Button></form>
    {h && (h.estado === "historico" ? <><p>Recibo histórico; não é estado atual. Hash confere: integridade do ledger, não nova auditoria matemática. Fonte, referência, unidade, fator e valores abaixo são os de então, sem preço vivo ou recálculo.</p><details open><summary>Snapshot e proveniência congelados</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify({recibo:h.recibo,snapshot:h.snapshot},null,2)}</pre></details></> : <p role="alert">{h.estado === "nao_localizada"?"Operação não localizada nesta consulta autorizada; não presuma rollback.":`${h.estado}: ${h.motivo}. Falha não significa operação inexistente.`}</p>)}
  </section>;
}
