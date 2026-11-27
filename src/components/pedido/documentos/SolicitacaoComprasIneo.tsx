import {
  RUBRICAS_SOLICITACAO,
  type LinhaDocumento,
} from "@/lib/pedido/documento-fonte";
import { Assinatura, Preencher, TabelaItens, TextoEditavel, TituloSecao } from "./partes";

export type DadosSolicitacao = {
  projeto: string | null;
  rubricas: Set<string>;
  linhas: LinhaDocumento[];
  total: number | null;
  justificativas: string[];
  fornecedor: { nome: string; cnpj: string | null } | null;
  data: string;
  coordenador: string | null;
};

const caixa = "border border-slate-400 px-2 py-0.5";

/**
 * Solicitação de Compras do Instituto Ineo (projeto Piraupiá), no desenho do
 * formulário que a equipe preenche hoje à mão: título e convênio, rubrica,
 * itens, justificativa de cada material, fornecedor indicado e assinatura.
 */
export function SolicitacaoComprasIneo({ dados }: { dados: DadosSolicitacao }) {
  return (
    <article className="text-[13px] leading-snug" data-testid="documento-solicitacao-compras">
      <div className="flex items-center justify-between border-b border-slate-300 pb-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- documento impresso: a imagem vai do jeito que está */}
        <img src="/documentos/piraupia.jpg" alt="Piraupiá" className="h-14 w-auto" />
        <p className="text-right text-xs text-slate-600">Instituto Ineo · Projeto Piraupiá</p>
      </div>

      <h1 className="mt-5 text-center text-xl font-bold uppercase tracking-wide">Solicitação de compras</h1>

      <TituloSecao>Título do projeto</TituloSecao>
      <TextoEditavel rotulo="Título do projeto">{dados.projeto ?? ""}</TextoEditavel>

      <TituloSecao>Número do convênio</TituloSecao>
      <Preencher rotulo="Número do convênio" />

      <TituloSecao>Dados para compra</TituloSecao>
      {/* tabela-fora-do-padrao: documento impresso para quem paga, no desenho do formulário da fonte */}
      <table className="w-full border-collapse">
        <tbody>
          {RUBRICAS_SOLICITACAO.map((rubrica, i) => (
            <tr key={rubrica}>
              <td className={caixa}>
                {i + 1}. {rubrica}
              </td>
              <td className={`${caixa} w-12 text-center font-bold`} aria-label={dados.rubricas.has(rubrica) ? "marcado" : "não marcado"}>
                {dados.rubricas.has(rubrica) ? "x" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4">
        <TabelaItens
          linhas={dados.linhas}
          total={dados.total}
          colunaEspecificacao="Especificação do material"
          colunaUnitario="Valor uni. (R$)"
          colunaTotal="Valor total (R$)"
        />
      </div>

      <TituloSecao>Justificativa técnica para compra de cada material</TituloSecao>
      <div className={`${caixa} space-y-2`}>
        {dados.justificativas.length ? (
          dados.justificativas.map((texto, i) => (
            <TextoEditavel key={i} rotulo={`Justificativa ${i + 1}`}>
              {dados.justificativas.length > 1 ? `${i + 1}. ${texto}` : texto}
            </TextoEditavel>
          ))
        ) : (
          <TextoEditavel rotulo="Justificativa" />
        )}
      </div>

      <TituloSecao>Indicação dos fornecedores</TituloSecao>
      {/* tabela-fora-do-padrao: documento impresso para quem paga, no desenho do formulário da fonte */}
      <table className="w-full border-collapse">
        <tbody>
          <tr>
            <td className={`${caixa} w-48`}>Fornecedor</td>
            <td className={caixa}>
              {dados.fornecedor ? (
                <>
                  {dados.fornecedor.nome}
                  {dados.fornecedor.cnpj ? ` (CNPJ: ${dados.fornecedor.cnpj})` : <> (CNPJ: <Preencher rotulo="CNPJ do fornecedor" />)</>}
                </>
              ) : (
                <Preencher rotulo="Fornecedor" largo />
              )}
            </td>
          </tr>
          <tr>
            <td className={caixa}>Venda exclusiva?*</td>
            <td className={caixa}>
              <Preencher rotulo="Venda exclusiva">Não</Preencher>
            </td>
          </tr>
          <tr>
            <td className={caixa}>Nº do orçamento</td>
            <td className={caixa}>
              <Preencher rotulo="Número do orçamento" />
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-xs">*Se sim, anexar as cartas/documentos que comprovem a exclusividade.</p>

      <p className="mt-6">{dados.data}</p>
      <Assinatura
        nome={dados.coordenador ?? <Preencher rotulo="Nome de quem assina" largo />}
        papel={<Preencher rotulo="Cargo de quem assina">Coordenador técnico</Preencher>}
      />
    </article>
  );
}
