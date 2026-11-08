"use client";

import { useRef, useState, type FormEvent } from "react";
import { unstable_rethrow } from "next/navigation";
import { lerConsumoMensal, operarConsumoMensal, type LeituraConsumoMensal, type EntradaConsumoMensal, type OperacaoConsumoMensal } from "@/lib/actions/consumo-mensal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpTip } from "@/components/common/HelpTip";
import { PAPEIS } from "@/lib/auth/permissions";
import { formatDateTime, formatNumber } from "@/lib/formatters";

const acoes = ["configurar", "certificar", "executar", "governanca"] as const;
const rotulos = { configurar: "Configurar critérios", certificar: "Certificar mês", executar: "Executar transição", governanca: "Governar capacidades" };
const selectClass = "mt-1 min-h-11 w-full rounded-md border border-input bg-background px-2 focus-visible:outline-2 focus-visible:outline-ring";
const falha: Extract<LeituraConsumoMensal, { ok: false }> = { ok: false, codigo: "NAO_CONFIRMADO", message: "Leitura não confirmada. Não presuma estado atual, sucesso ou rollback." };

export function ConsumoMensalPainel({ insumoId }: { insumoId: number }) {
  const [leitura, setLeitura] = useState<LeituraConsumoMensal | null>(null);
  const [resultado, setResultado] = useState<OperacaoConsumoMensal | null>(null);
  const [pending, setPending] = useState(false);
  const [acao, setAcao] = useState("");
  const trava = useRef(false);
  const concluida = useRef(false);
  async function consultar() {
    if (trava.current) return;
    trava.current = true; setPending(true); setLeitura(null); setResultado(null); setAcao("");
    try { setLeitura(await lerConsumoMensal(insumoId)); concluida.current = false; }
    catch (e) { unstable_rethrow(e); setLeitura(falha); }
    finally { trava.current = false; setPending(false); }
  }
  async function gravar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trava.current || concluida.current || !leitura?.ok || !leitura.escrita_habilitada
      || !acoes.some((a) => a === acao && leitura.atual.capacidades[a] === true)) return;
    const form = new FormData(event.currentTarget);
    if (form.get("confirmacao") !== "sim") return;
    const str = (key: string) => String(form.get(key) ?? "").trim();
    const num = (key: string) => str(key) === "" ? NaN : Number(str(key).replace(",", "."));
    const booleano = (key: string) => str(key) === "true" ? true : str(key) === "false" ? false : undefined;
    let dados: unknown;
    switch (acao) {
      case "configurar": dados = { inicio: str("inicio"), fuso: str("fuso"), janela: num("janela"), minimo_n: num("minimo_n"), comparabilidade: str("comparabilidade"), conteudo: num("conteudo"), unidade: str("unidade"), unidade_consumo: str("unidade_consumo"), fator: num("fator") }; break;
      case "certificar": dados = { mes: str("mes"), cobertura_integral: booleano("cobertura_integral"), sem_ruptura: booleano("sem_ruptura"), prova_sha256: str("prova_sha256"), prova_referencia: str("prova_referencia") }; break;
      case "executar": dados = {}; break;
      case "governanca": dados = { papel: str("papel"), acao: str("acao"), permitido: booleano("permitido"), motivo: str("motivo") }; break;
      default: return;
    }
    const input = { operacao_id: crypto.randomUUID(), acao, insumo_id: acao === "governanca" ? null : insumoId, dados,
      ...(acao === "governanca" ? { insumo_leitura_id: insumoId } : {}) };
    trava.current = true; setPending(true); setResultado(null);
    try {
      const r = await operarConsumoMensal(input); setResultado(r);
      setLeitura("atual" in r ? r.atual : falha);
    } catch (e) { unstable_rethrow(e); setResultado(falha); setLeitura(falha); }
    finally { concluida.current = true; trava.current = false; setPending(false); }
  }
  return <section className="mt-4 min-w-0 space-y-3 border-t border-border pt-4 text-sm" aria-busy={pending}>
    <div className="flex items-center gap-1"><h4 className="font-semibold">Consumo mensal prospectivo · insumo #{insumoId}</h4>
      <HelpTip title="Qualidade e certificação mensal"><p>Qualidade alta depende de meses civis comparáveis, cobertura integral declarada, ausência de ruptura declarada e mesma apresentação, conforme janela e mínimo configurados. Certificação humana com SHA e referência não é telemetria nem verificação automática do documento.</p><p>Ruptura, apresentação diferente, cobertura insuficiente e ajuste sem vínculo podem impedir comparabilidade. A estimativa manual permanece registrada. Esta série não é taxa diária × 30.</p><p>Configurar, certificar e executar são capacidades distintas. A matriz começa sem concessões; a consulta não autoriza por si só a gravação.</p></HelpTip>
    </div>
    <Button type="button" variant="outline" disabled={pending} onClick={() => void consultar()}>{pending ? "Consultando / registrando…" : "Consultar / reler estado atual"}</Button>
    {!leitura && !pending && <p>Consulte o insumo selecionado para confirmar série, qualidade e capacidades.</p>}
    {pending && <p role="status">Aguarde a resposta. Não presuma gravação, rollback ou valor zero.</p>}
    {resultado && <p role={resultado.ok ? "status" : "alert"}>{resultado.ok
      ? `Recibo confirmado · ${resultado.recibo.acao} · ${resultado.recibo.operacao_id}${resultado.recibo.repetida ? " · repetido/histórico" : ""}. O recibo não substitui a leitura atual abaixo.`
      : `${resultado.message} Não reenvie automaticamente. Releia antes de decidir nova operação.`}</p>}
    {leitura && !leitura.ok && <p role="alert" className="text-warning-strong">Estado atual indisponível. {leitura.message}</p>}
    {leitura?.ok && <>
      <LeituraMensal atual={leitura.atual} configuracaoEstado={leitura.configuracao_estado} />
      <dl className="grid gap-1 sm:grid-cols-2">{acoes.map((a) => <div key={a}><dt>{rotulos[a]}</dt><dd>{leitura.atual.capacidades[a] ? "Capacidade concedida nesta leitura" : "Sem concessão nesta leitura"}</dd></div>)}</dl>
      {!leitura.escrita_habilitada && <p>Escrita desabilitada no servidor. A leitura continua disponível.</p>}
      {leitura.escrita_habilitada && !resultado && !pending && <>
        <label className="block">Operação<select className={selectClass} value={acao} onChange={(e) => setAcao(e.target.value)}><option value="">Escolha uma operação</option>{acoes.filter((a) => leitura.atual.capacidades[a] === true).map((a) => <option key={a} value={a}>{rotulos[a]}</option>)}</select></label>
        {acoes.some((a) => a === acao && leitura.atual.capacidades[a] === true) && <form key={acao} onSubmit={gravar} className="space-y-3 rounded-md border border-border p-3">
          <CamposMensais acao={acao as EntradaConsumoMensal["acao"]} />
          <label className="flex items-start gap-2"><input type="checkbox" name="confirmacao" value="sim" required />Confirmo os valores e declarações desta operação.</label>
          <Button type="submit">Confirmar operação</Button>
        </form>}
      </>}
      {resultado && <p>Releia o estado atual antes de outra operação. Não há retry automático.</p>}
    </>}
  </section>;
}

function LeituraMensal({ atual: a, configuracaoEstado }: { atual: Extract<LeituraConsumoMensal, { ok: true }>["atual"]; configuracaoEstado: string }) {
  return <div className="space-y-2 break-words">
    <p>Configuração: {configuracaoEstado} · Estado: {a.estado.replaceAll("_", " ")} · Qualidade: {a.qualidade.replaceAll("_", " ")} · Meses comparáveis: {a.n}.</p>
    <p>Média: {a.media_embalagens_mes === null ? "não comprovada" : `${formatNumber(a.media_embalagens_mes)} embalagens/mês${a.media_embalagens_mes === 0 ? " (zero confirmado na série)" : ""}`}.</p>
    {a.configuracao && <p>Revisão de configuração #{a.configuracao.id} · início {a.configuracao.inicio} · {a.configuracao.fuso} · janela {a.configuracao.janela} meses · mínimo {a.configuracao.minimo_n}. Apresentação: {a.configuracao.conteudo} {a.configuracao.unidade}; consumo em {a.configuracao.unidade_consumo}, fator {a.configuracao.fator}.</p>}
    {a.manual_vigente ? <p>Manual preservado · revisão #{a.manual_vigente.revisao}: {formatNumber(a.manual_vigente.quantidade_embalagens_mes)} embalagens/mês · fonte {a.manual_vigente.fonte} · referência {a.manual_vigente.data_referencia}.</p> : <p>Nenhuma estimativa manual confirmada nesta leitura.</p>}
    {a.transicao ? <p>Transição registrada para o insumo #{a.transicao.insumo_id} em {formatDateTime(a.transicao.registrado_em)}. {a.estado === "reavaliacao" ? "Reavaliação necessária; a qualidade atual não sustenta alta." : "Consulte a série atual abaixo."}</p> : <p>Nenhuma transição registrada nesta leitura.</p>}
    {a.meses.length === 0 ? <p>Sem meses na série; isso não representa consumo zero.</p> : <ul className="divide-y divide-border">{a.meses.map((m) => <li key={m.mes} className="py-2">{m.mes} · revisão {m.revisao ?? "não comprovada"} · {m.comparavel ? "comparável" : "não comparável"} · {m.quantidade === null ? "quantidade não comprovada" : `${formatNumber(m.quantidade)} embalagens`} · {m.motivo.replaceAll("_", " ")}</li>)}</ul>}
  </div>;
}

function CamposMensais({ acao }: { acao: EntradaConsumoMensal["acao"] }) {
  const campo = (name: string, label: string, type = "text", props: Record<string, string | number> = {}) => <label key={name} className="block">{label}<Input name={name} type={type} required {...props} /></label>;
  const escolha = (name: string, label: string, options: [string, string][]) => <label key={name} className="block">{label}<select className={selectClass} name={name} required defaultValue=""><option value="">Escolha explicitamente</option>{options.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
  const simNao: [string,string][] = [["true", "Sim"], ["false", "Não"]];
  if (acao === "executar") return <p>A execução solicita a transição conforme os critérios atuais. Não certifica meses nem altera a estimativa manual por inferência.</p>;
  if (acao === "configurar") return <>
    <p>Informe os critérios deliberados. Nenhum limiar é escolhido automaticamente.</p>
    {campo("inicio", "Início (primeiro dia do mês)", "date")}
    {escolha("fuso", "Fuso", [["America/Sao_Paulo", "America/Sao_Paulo"]])}
    {campo("janela", "Janela em meses", "number", { min: 1, max: 120, step: 1 })}
    {campo("minimo_n", "Mínimo de meses comparáveis", "number", { min: 1, max: 120, step: 1 })}
    {escolha("comparabilidade", "Critério de comparabilidade", [["mes_civil_integral_sem_ruptura_mesma_apresentacao", "Mês civil integral, sem ruptura, mesma apresentação"]])}
    {campo("conteudo", "Conteúdo da embalagem", "number", { min: 0, step: "any" })}
    {campo("unidade", "Unidade do conteúdo")}{campo("unidade_consumo", "Unidade de consumo")}
    {campo("fator", "Fator de conversão", "number", { min: 0, step: "any" })}
  </>;
  if (acao === "certificar") return <>
    <p>Declaração humana: informe a referência e o SHA-256 de prova existente. Nenhum arquivo é criado, enviado ou verificado automaticamente aqui.</p>
    {campo("mes", "Mês certificado (primeiro dia)", "date")}
    {escolha("cobertura_integral", "Cobertura integral comprovada por você?", simNao)}{escolha("sem_ruptura", "Ausência de ruptura comprovada por você?", simNao)}
    {campo("prova_sha256", "SHA-256 da prova", "text", { pattern: "[a-f0-9]{64}", maxLength: 64 })}{campo("prova_referencia", "Referência da prova", "text", { maxLength: 500 })}
  </>;
  return <>
    <p>Política por função/operação; não há concessão presumida.</p>
    {escolha("papel", "Função", PAPEIS.map((p) => [p.value, p.label]))}
    {escolha("acao", "Capacidade", [["configurar", rotulos.configurar], ["certificar", rotulos.certificar], ["executar", rotulos.executar]])}
    {escolha("permitido", "Conceder capacidade?", simNao)}{campo("motivo", "Motivo", "text", { maxLength: 500 })}
  </>;
}
