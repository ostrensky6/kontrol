"use client";

import { createContext, useActionState, useContext, useEffect, useRef } from "react";
import { DownloadButton } from "@/components/common/DownloadButton";
import { Loader2, Upload } from "lucide-react";
import { importarCadastrosWorkbook, type ImportCadastrosState } from "@/lib/actions/cadastros";
import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/common/HelpTip";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

const initialState: ImportCadastrosState = { ok: false };
const LIMITE_MENSAGENS = 50;
/** Limite de envio das ações do servidor (next.config: 4 MB). */
const LIMITE_BYTES = 4 * 1024 * 1024;

type Importacao = {
  state: ImportCadastrosState;
  action: (formData: FormData) => void;
  pendente: boolean;
};

const ImportacaoContext = createContext<Importacao | null>(null);

function useImportacao(): Importacao {
  const ctx = useContext(ImportacaoContext);
  if (!ctx) throw new Error("ImportacaoCadastros: use dentro de <ImportacaoCadastrosProvider>.");
  return ctx;
}

/**
 * Importação de todos os cadastros por XLSX. O botão fica no topo do painel
 * (ao lado de "Cadastrar insumo") e o resultado logo abaixo do cabeçalho;
 * os dois partilham o mesmo estado por este provider.
 */
export function ImportacaoCadastrosProvider({ children }: { children: React.ReactNode }) {
  const [state, action, pendente] = useActionState(importarCadastrosWorkbook, initialState);
  return <ImportacaoContext.Provider value={{ state, action, pendente }}>{children}</ImportacaoContext.Provider>;
}

/** Botões do topo: Importar XLSX (escolher o arquivo já envia) e Baixar XLSX. */
export function BotoesPlanilhaCadastros({ podeImportar = true }: { podeImportar?: boolean }) {
  const { state, action, pendente } = useImportacao();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <>
      {podeImportar ? (
        <form ref={formRef} action={action} {...formularioSemPerda(state)} className="inline-flex">
          <label
            className={
              "inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground " +
              "hover:bg-primary/90 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 " +
              (pendente ? "pointer-events-none opacity-70" : "")
            }
          >
            {pendente ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
            {pendente ? "Importando…" : "Importar XLSX"}
            <input
              name="arquivo"
              type="file"
              accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="sr-only"
              required
              disabled={pendente}
              onChange={(event) => {
                const input = event.currentTarget;
                const arquivo = input.files?.[0];
                if (!arquivo) return;
                if (arquivo.size > LIMITE_BYTES) {
                  input.setCustomValidity("Arquivo maior que 4 MB. Apague imagens ou abas que não são de cadastro e salve de novo.");
                  input.reportValidity();
                  return;
                }
                input.setCustomValidity("");
                formRef.current?.requestSubmit();
              }}
            />
          </label>
        </form>
      ) : null}
      <DownloadButton href="/cadastros/export" fileName="todos-os-cadastros.xlsx">
        Baixar XLSX
      </DownloadButton>
      <HelpTip title="Importação por planilha">
        <p>Baixe a planilha XLSX, preencha e importe de volta com <b>Importar XLSX</b> (escolher o arquivo já envia).</p>
        <p>
          A planilha tem uma aba por cadastro e uma aba de instruções. A importação só <b>adiciona e atualiza</b>:
          nada é excluído. Células vazias mantêm o valor atual.
        </p>
        <p>
          Também aceita a sua própria planilha: a aba pode ter outro nome (ex.: &quot;Planilha1&quot;) se a linha de
          títulos usar os nomes de coluna do modelo, como &quot;Item específico / SKU&quot; ou &quot;Insumo&quot;.
          Arquivos .xls antigos precisam ser salvos como .xlsx no Excel.
        </p>
        {!podeImportar ? <p>Seu perfil só consulta: importar exige permissão para editar cadastros.</p> : null}
      </HelpTip>
    </>
  );
}

/** Resultado da última importação (mensagem, totais por aba, erros e avisos). */
export function ResultadoImportacaoCadastros() {
  const { state } = useImportacao();
  if (!state.message && !state.resumo) return null;

  const totais = state.resumo?.reduce(
    (acc, item) => ({
      inseridos: acc.inseridos + item.inseridos,
      atualizados: acc.atualizados + item.atualizados,
      inalterados: acc.inalterados + item.inalterados,
      ignorados: acc.ignorados + item.ignorados,
      avisos: acc.avisos + item.avisos.length,
    }),
    { inseridos: 0, atualizados: 0, inalterados: 0, ignorados: 0, avisos: 0 },
  );
  const erros = state.resumo?.flatMap((item) => item.erros.map((erro) => `${item.aba} · ${erro}`)) ?? [];
  const avisos = state.resumo?.flatMap((item) => item.avisos.map((aviso) => `${item.aba} · ${aviso}`)) ?? [];

  return (
    <section aria-label="Resultado da importação" className="mt-4 rounded-lg border border-border bg-card p-4 shadow-sm">
        <MensagemAcao estado={state} />

        {totais && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="secondary">{totais.inseridos} inseridos</Badge>
            <Badge variant="secondary">{totais.atualizados} atualizados</Badge>
            <Badge variant="muted">{totais.inalterados} sem alteração</Badge>
            <Badge variant={totais.ignorados ? "secondary" : "muted"} className={totais.ignorados ? "text-destructive" : undefined}>
              {totais.ignorados} com erro
            </Badge>
            <Badge variant={totais.avisos ? "secondary" : "muted"}>{totais.avisos} avisos</Badge>
          </div>
        )}

        {state.resumo && (
          <div className="mt-4 overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Aba</th>
                  <th className="px-3 py-2 font-medium">Inseridos</th>
                  <th className="px-3 py-2 font-medium">Atualizados</th>
                  <th className="px-3 py-2 font-medium">Sem alteração</th>
                  <th className="px-3 py-2 font-medium">Com erro</th>
                </tr>
              </thead>
              <tbody>
                {state.resumo.map((item) => (
                  <tr key={item.aba} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{item.aba}</td>
                    <td className="px-3 py-2">{item.inseridos}</td>
                    <td className="px-3 py-2">{item.atualizados}</td>
                    <td className="px-3 py-2">{item.inalterados}</td>
                    <td className="px-3 py-2">{item.ignorados}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {erros.length > 0 && (
          <details className="mt-4 rounded-md border border-border p-3 text-xs" open>
            <summary className="cursor-pointer font-medium text-destructive">
              Erros ({erros.length}) — estas linhas não foram importadas
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {erros.slice(0, LIMITE_MENSAGENS).map((erro, index) => (
                <li key={index}>{erro}</li>
              ))}
              {erros.length > LIMITE_MENSAGENS && <li>… e mais {erros.length - LIMITE_MENSAGENS}.</li>}
            </ul>
          </details>
        )}

        {avisos.length > 0 && (
          <details className="mt-3 rounded-md border border-border p-3 text-xs">
            <summary className="cursor-pointer font-medium">Avisos ({avisos.length})</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {avisos.slice(0, LIMITE_MENSAGENS).map((aviso, index) => (
                <li key={index}>{aviso}</li>
              ))}
              {avisos.length > LIMITE_MENSAGENS && <li>… e mais {avisos.length - LIMITE_MENSAGENS}.</li>}
            </ul>
          </details>
        )}
    </section>
  );
}
