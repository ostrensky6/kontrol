"use client";

import { useActionState, useEffect, useRef } from "react";
import { validarAlternativaInsumo } from "@/lib/actions/alternativas";
import { ESTADO_INICIAL } from "@/lib/erros";
import { HelpTip } from "@/components/common/HelpTip";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/formatters";

export type AlternativaLinha = {
  id: number;
  grupo_escolha: string;
  especificacao_insumo: string | null;
  custo_por_amostra: number | null;
  alternativa_situacao: string | null;
  alternativa_observacao: string | null;
  alternativa_validada_em: string | null;
};

const ROTULO_SITUACAO: Record<string, string> = {
  valida: "Serve",
  invalida: "Não serve (fora do orçamento)",
};

function Situacao({ linha, orcada }: { linha: AlternativaLinha; orcada: boolean }) {
  const classe =
    linha.alternativa_situacao === "invalida"
      ? "border-danger-strong/40 bg-danger-soft text-danger-strong"
      : linha.alternativa_situacao === "valida"
        ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100"
        : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100";
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${classe}`}>
        {linha.alternativa_situacao ? ROTULO_SITUACAO[linha.alternativa_situacao] : "Ainda não avaliada"}
      </span>
      {orcada && (
        <span className="rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-100">
          Entra no orçamento
        </span>
      )}
    </span>
  );
}

function FormValidar({ linha, codigo }: { linha: AlternativaLinha; codigo: string }) {
  const [estado, enviar] = useActionState(validarAlternativaInsumo, ESTADO_INICIAL);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (estado.ok) ref.current?.reset(); }, [estado]);
  const nome = linha.especificacao_insumo ?? `linha ${linha.id}`;
  return (
    <form ref={ref} action={enviar} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="insumo_analise_id" value={linha.id} />
      <input type="hidden" name="codigo_analise" value={codigo} />
      <label className="text-xs font-medium">
        Decisão
        <select name="decisao" defaultValue="" required aria-label={`Decisão sobre ${nome}`}
          className="mt-1 block min-h-9 rounded-md border border-input bg-background px-2 text-xs">
          <option value="" disabled>Escolha</option>
          <option value="valida">Serve</option>
          <option value="invalida">Não serve</option>
        </select>
      </label>
      <label className="min-w-48 flex-1 text-xs font-medium">
        Observação
        <Input name="observacao" required maxLength={1000} aria-label={`Observação sobre ${nome}`} className="mt-1 h-9 text-xs" />
      </label>
      <SubmitButton pendingLabel="Salvando…">Registrar</SubmitButton>
      <MensagemAcao estado={estado} />
    </form>
  );
}

/**
 * Alternativas de cada grupo de escolha. O orçamento usa a mais cara entre as
 * que não foram marcadas como "não serve" (0159).
 */
export function AlternativasValidacao({
  codigo,
  linhas,
  orcadas,
  podeValidar,
}: {
  codigo: string;
  linhas: AlternativaLinha[];
  /** ids das linhas que o cálculo atual adota */
  orcadas: number[];
  podeValidar: boolean;
}) {
  if (linhas.length === 0) return null;
  const grupos = new Map<string, AlternativaLinha[]>();
  for (const l of linhas) {
    if (!grupos.has(l.grupo_escolha)) grupos.set(l.grupo_escolha, []);
    grupos.get(l.grupo_escolha)!.push(l);
  }
  return (
    <div className="mt-4 space-y-3" data-testid="alternativas-validacao">
      <div className="flex items-center gap-1">
        <p className="text-sm font-semibold">Alternativas (grupos de escolha)</p>
        <HelpTip title="Alternativas (grupos de escolha)">
          <p>
            O orçamento usa a alternativa mais cara entre as que servem. Marque “Não serve” para tirar uma
            alternativa do cálculo; o grupo sempre fica com pelo menos uma.
          </p>
          <p>
            Laboratório, Coordenador, Supervisor e Administrador podem registrar; cada decisão fica no
            histórico.
          </p>
        </HelpTip>
      </div>
      <p className="text-xs text-muted-foreground">O orçamento usa a mais cara entre as que servem.</p>
      {[...grupos].map(([grupo, opcoes]) => (
        <div key={grupo} className="rounded-md border border-border p-2">
          <p className="text-xs font-semibold">Grupo {grupo}</p>
          <ul className="mt-1 space-y-2">
            {opcoes.map((l) => (
              <li key={l.id} className="space-y-1 border-t border-border/60 pt-2 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium">{l.especificacao_insumo ?? "Sem especificação"}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {l.custo_por_amostra != null && l.custo_por_amostra > 0 ? `${formatCurrency(l.custo_por_amostra)} por amostra` : "sem preço"}
                  </span>
                </div>
                <Situacao linha={l} orcada={orcadas.includes(l.id)} />
                {l.alternativa_observacao && (
                  <p className="text-[11px] text-muted-foreground">
                    “{l.alternativa_observacao}”
                    {l.alternativa_validada_em && ` em ${new Date(l.alternativa_validada_em).toLocaleDateString("pt-BR")}`}
                  </p>
                )}
                {podeValidar && <FormValidar linha={l} codigo={codigo} />}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
