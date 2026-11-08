"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { previaNovoOrcamentoEquivalencia } from "@/lib/actions/previa-orcamento-equivalencia";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpTip } from "@/components/common/HelpTip";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/formatters";

type Resposta = Awaited<ReturnType<typeof previaNovoOrcamentoEquivalencia>>;
type Estado = { metodo: string; resposta?: Resposta; erro?: string } | null;
const rotulos = { reagentes: "Reagentes", equipamento: "Equipamento", pessoal: "Pessoal", overhead: "Overhead", custoAnalitico: "Custo analítico", custoTotal: "Custo total", preco: "Preço indicativo total" };

export function PreviaEquivalencia({ codigo, numeroAmostras, grupo, habilitada }: {
  codigo: string; numeroAmostras: number; grupo: string; habilitada: boolean;
}) {
  const [metodo, setMetodo] = useState("");
  const ocupado = useRef(false);
  const [state, action, pending] = useActionState<Estado, FormData>(async (_anterior, form) => {
    const revisao = String(form.get("metodo_revisao_ref") ?? "").trim();
    try {
      if (!habilitada || !Number.isSafeInteger(numeroAmostras) || numeroAmostras <= 0 || !revisao || revisao.length > 160) {
        return { metodo: revisao, erro: "Confira a quantidade selecionada e a revisão documental; a prévia precisa estar habilitada." };
      }
      return { metodo: revisao, resposta: await previaNovoOrcamentoEquivalencia({
        codigo_analise: codigo, numero_amostras: numeroAmostras, metodo_revisao_ref: revisao,
      }) };
    } catch (erro) {
      unstable_rethrow(erro);
      return { metodo: revisao, erro: "Não foi possível confirmar a prévia. Consulte novamente; nenhum resultado foi gravado." };
    } finally { ocupado.current = false; }
  }, null);
  const atual = !pending && state?.metodo === metodo.trim() ? state : null;
  const resposta = atual?.resposta;
  return (
    <details className="min-w-0 rounded-md border border-border p-3 text-sm">
      <summary className="min-h-11 cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-ring">{grupo} · {codigo} · {numeroAmostras} amostra(s)</summary>
      <div className="flex items-start gap-1">
        <p>Prévia indicativa não persistível. Não fixa preço e não altera o orçamento.</p>
        <HelpTip title="Limites da prévia"><p>Compara custos convertidos de alternativas tecnicamente validadas, usando o maior custo por necessidade. Não é preferência de compra.</p><p>As leituras não são atômicas. O instante informado não comprova um snapshot simultâneo. Persistência depende de um fluxo atômico futuro.</p></HelpTip>
      </div>
      {!habilitada ? <p className="mt-2 text-muted-foreground">Prévia desabilitada nesta instalação.</p> : (
        <form action={action} aria-busy={pending} className="mt-3 space-y-3" onSubmit={(event) => {
          if (ocupado.current || pending) event.preventDefault(); else ocupado.current = true;
        }}>
          <label className="block font-medium">Referência documental do método e revisão
            <Input name="metodo_revisao_ref" value={metodo} onChange={(event) => setMetodo(event.target.value)} required maxLength={160} disabled={pending} className="mt-1" />
          </label>
          <Button type="submit" disabled={pending || !Number.isSafeInteger(numeroAmostras) || numeroAmostras <= 0}>{pending ? "Consultando fontes e calculando…" : "Consultar prévia"}</Button>
        </form>
      )}
      {pending && <p role="status" className="mt-2">Aguardando confirmação das fontes. Nenhum valor está confirmado.</p>}
      {atual?.erro && <p role="alert" className="mt-2 text-danger-strong">{atual.erro}</p>}
      {resposta?.estado === "pendente" && <div role="status" className="mt-3 text-warning-strong">
        <p>Prévia pendente — não equivale a custo zero.</p>
        <ul className="list-inside list-disc break-words">{resposta.pendencias.map((p, i) => <li key={i}>{p.motivo === "sem_permissao" ? "Sua sessão não tem autorização para consultar esta prévia." : p.motivo === "desabilitada" ? "Prévia desabilitada no servidor." : `Fonte ou contexto não confirmado: ${p.motivo.replaceAll("_", " ")}.`}</li>)}</ul>
      </div>}
      {resposta?.estado === "calculado" && <div role="status" className="mt-3 space-y-3">
        <p>Calculado para {numeroAmostras} amostra(s) · revisão {resposta.metodo_revisao_ref} · {formatDateTime(new Date(resposta.instante).toISOString())}.</p>
        <dl className="grid gap-2 sm:grid-cols-2">{Object.entries(rotulos).map(([chave, rotulo]) => <div key={chave}><dt className="text-muted-foreground">{rotulo}</dt><dd className="font-medium tabular-nums">{formatCurrency(resposta.calculo.totais[chave as keyof typeof rotulos])}</dd></div>)}</dl>
        <h3 className="font-medium">Maior custo convertido por necessidade · proveniência</h3>
        <ul className="divide-y divide-border">{resposta.selecao.map((s) => <li key={s.necessidade_id} className="break-words py-2">
          <p>Necessidade #{s.necessidade_id} · etapa {s.etapa_id ?? "não vinculada"} · SKU #{s.insumo_id}: {formatCurrency(s.custo_total_insumo)}</p>
          <p>Quantidade de consumo: {formatNumber(s.quantidade_consumo)} · de estoque: {formatNumber(s.quantidade_estoque)}.</p>
          <p>Apresentação: {s.apresentacao_ref} · decisão: {s.decisao_ref} · evidência: {s.evidencia_ref}.</p>
        </li>)}</ul>
      </div>}
      <Link href={`/analises/${encodeURIComponent(codigo)}?view=materiais-insumos`} className="mt-2 inline-flex min-h-11 items-center underline focus-visible:outline-2 focus-visible:outline-ring">Consultar ficha e validações técnicas</Link>
    </details>
  );
}
