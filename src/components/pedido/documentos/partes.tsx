import type { ReactNode } from "react";
import { formatCurrency } from "@/lib/formatters";
import type { LinhaDocumento } from "@/lib/pedido/documento-fonte";

/**
 * Campo que o Kontrol não guarda (número do convênio, matrícula, nº do
 * orçamento): quem imprime escreve na própria tela. Vazio, sai no papel como
 * uma linha para preencher à mão.
 */
export function Preencher({ rotulo, children, largo = false }: { rotulo: string; children?: ReactNode; largo?: boolean }) {
  return (
    <span
      role="textbox"
      aria-label={rotulo}
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      title="Escreva aqui antes de imprimir"
      className={`inline-block ${largo ? "min-w-72" : "min-w-36"} border-b border-dotted border-slate-500 px-0.5 outline-none focus:bg-amber-50 empty:before:content-['\\00a0'] print:border-solid print:[&:not(:empty)]:border-transparent`}
    >
      {children}
    </span>
  );
}

/** Bloco de texto que se escreve na tela (justificativa, disposições gerais). */
export function TextoEditavel({ rotulo, children }: { rotulo: string; children?: ReactNode }) {
  return (
    <div
      role="textbox"
      aria-label={rotulo}
      aria-multiline="true"
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      title="Pode corrigir o texto antes de imprimir"
      className="min-h-6 whitespace-pre-line rounded-sm outline-none focus:bg-amber-50"
    >
      {children}
    </div>
  );
}

export function TituloSecao({ children }: { children: ReactNode }) {
  return <h2 className="mt-4 mb-1 text-sm font-bold uppercase tracking-wide">{children}</h2>;
}

const celula = "border border-slate-400 px-2 py-0.5 align-top";

/** Tabela de itens: a mesma forma nos dois documentos, com o título de coluna de cada modelo. */
export function TabelaItens({
  linhas,
  total,
  colunaUnitario,
  colunaTotal,
  colunaEspecificacao,
}: {
  linhas: LinhaDocumento[];
  total: number | null;
  colunaUnitario: string;
  colunaTotal: string;
  colunaEspecificacao: string;
}) {
  const valor = (v: number | null) => (v == null ? "" : formatCurrency(v).replace("R$", "").trim());
  // tabela-fora-do-padrao: documento impresso para quem paga, no desenho do formulário da fonte
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="bg-slate-100">
          <th className={`${celula} w-12 text-center`}>Item</th>
          <th className={`${celula} text-left`}>{colunaEspecificacao}</th>
          <th className={`${celula} w-16 text-center`}>Unid.</th>
          <th className={`${celula} w-14 text-center`}>Qtd.</th>
          <th className={`${celula} w-28 text-right`}>{colunaUnitario}</th>
          <th className={`${celula} w-28 text-right`}>{colunaTotal}</th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((linha) => (
          <tr key={linha.numero}>
            <td className={`${celula} text-center`}>{linha.numero}</td>
            <td className={celula}>{linha.especificacao}</td>
            <td className={`${celula} text-center`}>{linha.unidade}</td>
            <td className={`${celula} text-center tabular-nums`}>{linha.quantidade.toLocaleString("pt-BR")}</td>
            <td className={`${celula} text-right tabular-nums`}>{valor(linha.valorUnitario)}</td>
            <td className={`${celula} text-right tabular-nums`}>{valor(linha.valorTotal)}</td>
          </tr>
        ))}
        <tr className="font-semibold">
          <td className={celula} colSpan={5}>
            Total
          </td>
          <td className={`${celula} text-right tabular-nums`}>{total == null ? "" : formatCurrency(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Linha de assinatura com o nome e o papel embaixo. */
export function Assinatura({ nome, papel, complemento }: { nome: ReactNode; papel: ReactNode; complemento?: ReactNode }) {
  return (
    <div className="mt-8 break-inside-avoid text-center text-sm">
      <div className="mx-auto w-80 border-t border-slate-700 pt-1 font-medium">{nome}</div>
      <div>{papel}</div>
      {complemento && <div>{complemento}</div>}
    </div>
  );
}
