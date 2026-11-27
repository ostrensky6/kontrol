import { formatCurrency } from "@/lib/formatters";
import { LOCAL_DE_ENTREGA, type LinhaDocumento } from "@/lib/pedido/documento-fonte";
import { Assinatura, Preencher, TabelaItens, TextoEditavel, TituloSecao } from "./partes";

export type DadosTermo = {
  objeto: string;
  justificativas: string[];
  especificacoes: string[];
  linhas: LinhaDocumento[];
  total: number | null;
  orcamentos: { fornecedor: string; valor: number; escolhido: boolean }[];
  media: number | null;
  prazoDias: number;
  criterios: string[];
  coordenador: { nome: string | null; email: string | null };
  solicitante: string | null;
  data: string;
};

const caixa = "border border-slate-400 px-2 py-0.5 align-top";

/**
 * Termo de Referência da Funpar (projetos Petrobras), no desenho do modelo da
 * fundação: nove partes, a tabela com a média dos orçamentos e, na segunda
 * folha, o mapa de pesquisa de preços que o termo diz ir "em anexo".
 */
export function TermoReferenciaFunpar({ dados }: { dados: DadosTermo }) {
  const texto = (textos: string[], rotulo: string) =>
    textos.length ? (
      textos.map((t, i) => (
        <TextoEditavel key={i} rotulo={`${rotulo} ${i + 1}`}>
          {t}
        </TextoEditavel>
      ))
    ) : (
      <TextoEditavel rotulo={rotulo} />
    );
  return (
    <article className="text-[13px] leading-normal" data-testid="documento-termo-referencia">
      <div className="flex items-start justify-between gap-4 border-b border-slate-300 pb-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- documento impresso: a imagem vai do jeito que está */}
        <img src="/documentos/funpar-logo.png" alt="Funpar, Fundação da Universidade Federal do Paraná" className="h-16 w-auto" />
        {/* eslint-disable-next-line @next/next/no-img-element -- documento impresso: a imagem vai do jeito que está */}
        <img src="/documentos/funpar-endereco.jpg" alt="Rua João Negrão, 280, Centro, Curitiba, Paraná. Telefone (41) 3360-7400" className="h-14 w-auto" />
      </div>

      <h1 className="mt-5 text-center text-xl font-bold uppercase tracking-wide">Termo de referência</h1>
      <div className="mt-3 text-xs">
        <p>Deverá acompanhar todo pedido para: aquisição de bens permanentes; materiais de consumo; contratação de serviços.</p>
        <p className="mt-1 font-semibold">
          ATENÇÃO: os pedidos só serão aceitos se estiverem acompanhados de Termo de Referência, Planilha de Custo/Mapa de
          Pesquisa de Preços e Orçamentos, e o mesmo deverá ser completamente preenchido, em todos os seus campos, sem exceções.
        </p>
      </div>

      <TituloSecao>1 – Objeto</TituloSecao>
      <TextoEditavel rotulo="Objeto">{dados.objeto}</TextoEditavel>

      <TituloSecao>2 – Justificativa</TituloSecao>
      <div className="space-y-2">{texto(dados.justificativas, "Justificativa")}</div>

      <TituloSecao>3 – Quantitativo / especificações técnicas / valores referenciais de mercado</TituloSecao>
      <div className="space-y-2">{texto(dados.especificacoes, "Especificações técnicas")}</div>
      <p className="mt-3 mb-1.5">Planilha de Custo/Mapa de Pesquisa de Preços e Orçamentos (em anexo)</p>
      <TabelaItens
        linhas={dados.linhas}
        total={dados.total}
        colunaEspecificacao="Especificação/Descrição (Especificação Técnica)"
        colunaUnitario="Média/Valor unitário (R$)"
        colunaTotal="Média/Valor total (R$)"
      />
      <div className="mt-3 text-sm">
        <p>Ass.:</p>
        <p>Responsável pela elaboração das Especificações</p>
        <p>Coordenador: {dados.coordenador.nome ?? <Preencher rotulo="Coordenador responsável pelas especificações" largo />}</p>
        <p>
          Matrícula/UFPR <Preencher rotulo="Matrícula UFPR do coordenador" />
        </p>
      </div>

      <TituloSecao>4 – Locais de entrega dos bens ou realização dos serviços</TituloSecao>
      {/* tabela-fora-do-padrao: documento impresso para quem paga, no desenho do formulário da fonte */}
      <table className="w-full border-collapse">
        <tbody>
          <tr className="bg-slate-100">
            <th className={`${caixa} w-24 text-left`}>Unidade</th>
            <th className={`${caixa} text-left`}>Endereço</th>
          </tr>
          <tr>
            <td className={caixa}>
              <Preencher rotulo="Unidade de entrega">{LOCAL_DE_ENTREGA.unidade}</Preencher>
            </td>
            <td className={caixa}>
              <TextoEditavel rotulo="Endereço de entrega">{LOCAL_DE_ENTREGA.endereco}</TextoEditavel>
            </td>
          </tr>
        </tbody>
      </table>

      <TituloSecao>5 – Estratégia de fornecimento, prazo de entrega ou prazo de execução</TituloSecao>
      <TextoEditavel rotulo="Estratégia de fornecimento">
        {`O material deverá ser entregue no quantitativo e na localidade indicada acima no prazo máximo de ${dados.prazoDias} dias após a emissão do pedido. O material deverá ter prazo de validade mínima de doze meses, contados a partir da data de entrega. Caso algum produto apresente defeito de fabricação quando em uso no decorrer do prazo de validade, o fornecedor deverá efetuar a troca do mesmo em cinco dias úteis, a contar da notificação, sem ônus adicional.`}
      </TextoEditavel>

      <TituloSecao>6 – Acompanhamento da execução do serviço</TituloSecao>
      <p>REPRESENTANTES DA ADMINISTRAÇÃO, para o recebimento, acompanhamento e fiscalização:</p>
      <p>
        Responsável: {dados.coordenador.nome ?? <Preencher rotulo="Responsável pelo recebimento" largo />}
        {dados.coordenador.email ? ` - ${dados.coordenador.email}` : ""} · Telefone: <Preencher rotulo="Telefone do responsável" />
      </p>
      <p>
        Responsável substituto: <Preencher rotulo="Responsável substituto" largo />
      </p>

      <TituloSecao>7 – Critérios de aceitabilidade</TituloSecao>
      <div className="space-y-2">{texto(dados.criterios, "Critério de aceitabilidade")}</div>

      <TituloSecao>8 – Da veracidade dos orçamentos</TituloSecao>
      <p>
        Venho firmar que os orçamentos enviados juntamente a este Termo de Referência foram por mim realizados e são
        verdadeiros, conforme rubrica/assinatura em cada um deles.
      </p>
      <p className="mt-2">Ass.:</p>
      <p>Responsável pela elaboração dos orçamentos</p>
      <p>Nome: {dados.solicitante ?? <Preencher rotulo="Responsável pelos orçamentos" largo />}</p>

      <TituloSecao>9 – Disposições gerais/informações complementares</TituloSecao>
      <TextoEditavel rotulo="Disposições gerais" />

      <p className="mt-8">{dados.data}</p>
      <Assinatura
        nome={dados.solicitante ?? <Preencher rotulo="Responsável pelo termo" largo />}
        papel="RESPONSÁVEL PELA ELABORAÇÃO DO TERMO DE REFERÊNCIA"
      />

      <div className="mt-8 break-inside-avoid border border-slate-500 p-3 text-center">
        <p className="font-bold">ORDENADOR DE DESPESA</p>
        <p className="mt-1">APROVO O PRESENTE TERMO DE REFERÊNCIA E AUTORIZO A REALIZAÇÃO DE PROCESSO DE COMPRA.</p>
        <Assinatura
          nome={`Coordenador do projeto: ${dados.coordenador.nome ?? ""}`}
          papel={
            <>
              Matrícula/UFPR <Preencher rotulo="Matrícula UFPR do ordenador de despesa" />
            </>
          }
        />
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element -- documento impresso: a imagem vai do jeito que está */}
      <img
        src="/documentos/funpar-rodape.jpg"
        alt="Entidade de Direito Privado Declarada de Utilidade Pública. CNPJ/MF nº 78.350.188/0001-95"
        className="mt-6 h-10 w-auto"
      />

      {/* o termo diz que o mapa vai "em anexo": vai na folha seguinte */}
      <section className="page-break-before mt-10 print:mt-0" aria-labelledby="mapa-precos-titulo">
        <h2 id="mapa-precos-titulo" className="text-center text-base font-bold uppercase tracking-wide">
          Planilha de custo / mapa de pesquisa de preços
        </h2>
        <p className="mt-2 text-xs">Objeto: {dados.objeto}</p>
        {/* tabela-fora-do-padrao: documento impresso para quem paga, no desenho do formulário da fonte */}
        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="bg-slate-100">
              <th className={`${caixa} w-12 text-center`}>Nº</th>
              <th className={`${caixa} text-left`}>Fornecedor</th>
              <th className={`${caixa} w-36 text-right`}>Valor total (R$)</th>
            </tr>
          </thead>
          <tbody>
            {dados.orcamentos.map((o, i) => (
              <tr key={`${o.fornecedor}-${i}`}>
                <td className={`${caixa} text-center`}>{i + 1}</td>
                <td className={caixa}>
                  {o.fornecedor}
                  {o.escolhido ? " (escolhido)" : ""}
                </td>
                <td className={`${caixa} text-right tabular-nums`}>{formatCurrency(o.valor)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={caixa} colSpan={2}>
                Média dos orçamentos
              </td>
              <td className={`${caixa} text-right tabular-nums`}>{dados.media == null ? "" : formatCurrency(dados.media)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs">Os orçamentos de cada fornecedor seguem anexos, rubricados por quem os realizou.</p>
      </section>
    </article>
  );
}
