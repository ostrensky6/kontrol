"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { formatCurrency as brl } from "@/lib/formatters";
import { anosDoProjeto, subtotalCusto } from "@/lib/project-budget/editor";
import { NOTA_VALOR_MASCARADO, VALOR_MASCARADO } from "@/lib/cadastros/mascara";
import { FormAcao, type AcaoFormulario } from "./FormAcao";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHead } from "@/components/ui/table";

export type LinhaPessoal = {
  id: number;
  descricao: string;
  quantidade: number;
  custo_unitario: number;
  meses_selecionados: number[];
};

function Salvar({ alterado }: { alterado: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={!alterado || pending}
      className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Salvando…" : "Salvar meses"}
    </button>
  );
}

const botaoSecundario =
  "rounded-md border border-input px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Grade de meses do Pessoal (PE), paginada por ano como no app antigo:
 * total da linha = meses marcados × valor mensal. As marcações só são gravadas
 * ao clicar em "Salvar meses" (um único envio para todas as linhas).
 */
export function GradeMesesPessoal({
  linhas,
  mesesProjeto,
  orcamentoProjetoId,
  demandaId,
  editavel,
  action,
  acoesLinha,
  detalhesLinha,
  mascarado = false,
}: {
  linhas: LinhaPessoal[];
  mesesProjeto: number;
  orcamentoProjetoId: number;
  demandaId: number;
  editavel: boolean;
  action: AcaoFormulario;
  /** Botões de editar/remover já renderizados no servidor, por id da linha. */
  acoesLinha?: Record<number, ReactNode>;
  /** Selos do catálogo vivo por linha, renderizados no servidor. */
  detalhesLinha?: Record<number, ReactNode>;
  /** Sem a permissão de pessoal: valores e totais aparecem como XXX (DC8). */
  mascarado?: boolean;
}) {
  const anos = useMemo(() => anosDoProjeto(mesesProjeto), [mesesProjeto]);
  const [anoAtivo, setAnoAtivo] = useState(1);
  const inicial = useMemo(
    () => Object.fromEntries(linhas.map((linha) => [linha.id, [...linha.meses_selecionados].sort((a, b) => a - b)])),
    [linhas],
  );
  const [meses, setMeses] = useState<Record<number, number[]>>(inicial);
  const [base, setBase] = useState(inicial);
  // Quando o servidor devolve dados novos (após salvar), a grade volta a refletir o banco.
  if (base !== inicial) {
    setBase(inicial);
    setMeses(inicial);
  }

  const ano = anos.find((item) => item.ano === anoAtivo) ?? anos[0];
  const todos = anos.flatMap((item) => item.meses);
  const alterado = linhas.some((linha) => (meses[linha.id] ?? []).join(",") !== (inicial[linha.id] ?? []).join(","));

  function definir(id: number, proximos: Iterable<number>) {
    setMeses((atual) => ({ ...atual, [id]: [...new Set(proximos)].sort((a, b) => a - b) }));
  }

  function alternarMes(id: number, mes: number) {
    const atuais = new Set(meses[id] ?? []);
    if (atuais.has(mes)) atuais.delete(mes);
    else atuais.add(mes);
    definir(id, atuais);
  }

  function alternarAno(id: number) {
    const atuais = new Set(meses[id] ?? []);
    const completo = ano.meses.every((mes) => atuais.has(mes));
    ano.meses.forEach((mes) => (completo ? atuais.delete(mes) : atuais.add(mes)));
    definir(id, atuais);
  }

  if (linhas.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhum profissional incluído. Adicione do catálogo ou manualmente.</p>;
  }

  // A tabela fica fora do <form>: as caixas de marcação são controladas e o envio usa os
  // campos ocultos abaixo. Assim os diálogos de editar/remover de cada linha não ficam
  // aninhados no formulário da grade.
  return (
    <div>
      <FormAcao
        action={action}
        sucesso="Meses do pessoal salvos."
        aria-label="Salvar meses do pessoal"
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <input type="hidden" name="orcamento_projeto_id" value={orcamentoProjetoId} />
        <input type="hidden" name="demanda_id" value={demandaId} />
        {linhas.map((linha) => (
          <span key={linha.id} hidden>
            <input type="hidden" name={`linha_${linha.id}`} value="1" />
            {(meses[linha.id] ?? []).map((mes) => (
              <input key={mes} type="hidden" name={`meses_${linha.id}`} value={mes} />
            ))}
          </span>
        ))}
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          Projeto com {mesesProjeto} {mesesProjeto === 1 ? "mês" : "meses"}.
          <HelpTip title="Meses do pessoal">
            <p>Marque os meses em que cada profissional atua; <b>M1</b> é o primeiro mês do projeto. O total da linha é <b>meses marcados × valor mensal</b>.</p>
            <HelpExample>6 meses marcados × R$ 4.000 = R$ 24.000.</HelpExample>
          </HelpTip>
        </p>
        {editavel && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={botaoSecundario} onClick={() => linhas.forEach((linha) => definir(linha.id, todos))}>
              Marcar todos
            </button>
            <button type="button" className={botaoSecundario} onClick={() => linhas.forEach((linha) => definir(linha.id, []))}>
              Limpar
            </button>
            <Salvar alterado={alterado} />
          </div>
        )}
      </FormAcao>

      {anos.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Ano exibido na grade">
          {anos.map((item) => (
            <button
              key={item.ano}
              type="button"
              aria-pressed={item.ano === ano.ano}
              onClick={() => setAnoAtivo(item.ano)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                item.ano === ano.ano ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200" : "border-input hover:bg-muted"
              }`}
            >
              Ano {item.ano} (M{item.inicio}–M{item.fim})
            </button>
          ))}
        </div>
      )}

      {alterado && (
        <p role="status" className="mt-2 text-xs font-medium text-warning-strong">
          Há marcações não salvas.
        </p>
      )}

      <div className="mt-3 overflow-x-auto rounded-md border border-border">
        <Table>
          <caption className="sr-only">Meses do pessoal, ano {ano.ano}</caption>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col">Profissional / função</TableHead>
              <TableHead scope="col" className="text-right">Valor mensal</TableHead>
              {editavel && (
                <TableHead scope="col">
                  <span className="sr-only">Marcar ou limpar o ano</span>
                </TableHead>
              )}
              {ano.meses.map((mes) => (
                <TableHead key={mes} scope="col" className="px-1 text-center">M{mes}</TableHead>
              ))}
              <TableHead scope="col" className="text-right">Meses</TableHead>
              <TableHead scope="col" className="text-right">Total</TableHead>
              {acoesLinha && (
                <TableHead scope="col">
                  <span className="sr-only">Ações</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((linha) => {
              const marcados = new Set(meses[linha.id] ?? []);
              const anoCompleto = ano.meses.every((mes) => marcados.has(mes));
              const total = subtotalCusto({
                rubrica: "PE",
                quantidade: linha.quantidade,
                custo_unitario: linha.custo_unitario,
                meses_selecionados: [...marcados],
              });
              return (
                <TableRow key={linha.id} className="align-middle">
                  <TableRowHead className="font-medium">
                    {linha.descricao}
                    {detalhesLinha?.[linha.id]}
                  </TableRowHead>
                  <TableCell className="text-right tabular-nums">
                    {mascarado ? <span title={NOTA_VALOR_MASCARADO}>{VALOR_MASCARADO}</span> : brl(linha.custo_unitario)}
                  </TableCell>
                  {editavel && (
                    <TableCell>
                      <button
                        type="button"
                        className={botaoSecundario}
                        onClick={() => alternarAno(linha.id)}
                        aria-label={`${anoCompleto ? "Limpar" : "Marcar"} meses do ano ${ano.ano} de ${linha.descricao}`}
                      >
                        {anoCompleto ? "Limpar" : "Ano"}
                      </button>
                    </TableCell>
                  )}
                  {ano.meses.map((mes) => (
                    <TableCell key={mes} className="px-1 text-center">
                      <input
                        type="checkbox"
                        className="size-4 accent-brand-600"
                        checked={marcados.has(mes)}
                        disabled={!editavel}
                        onChange={() => alternarMes(linha.id, mes)}
                        aria-label={`${linha.descricao}, mês ${mes}`}
                      />
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums">
                    {marcados.size > 0 ? marcados.size : <span title="Sem meses marcados: conta a quantidade da linha">{linha.quantidade}*</span>}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {mascarado ? <span title={NOTA_VALOR_MASCARADO}>{VALOR_MASCARADO}</span> : brl(total)}
                  </TableCell>
                  {acoesLinha && <TableCell className="text-right whitespace-nowrap">{acoesLinha[linha.id]}</TableCell>}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {linhas.some((linha) => (meses[linha.id] ?? []).length === 0) && (
        <p className="mt-2 text-[11px] text-muted-foreground">* Linha sem meses marcados: o total usa a quantidade informada no item.</p>
      )}
    </div>
  );
}
