import { lerFonteEquivalencia } from "@/lib/costing/equivalencia-fonte";
import { HelpTip } from "@/components/common/HelpTip";
import { formatDateTime, formatNumber } from "@/lib/formatters";
import { lerContextoEquivalencia } from "@/lib/costing/equivalencia-contexto";
import { EquivalenciaRevisionadaForm } from "./EquivalenciaRevisionadaForm";

export async function EquivalenciaFicha({ codigo, metodoRevisaoRef, escritaHabilitada }: {
  codigo: string;
  metodoRevisaoRef?: string;
  escritaHabilitada: boolean;
}) {
  const metodo = typeof metodoRevisaoRef === "string" ? metodoRevisaoRef.trim() : "";
  const invalido = metodo.length > 160;
  const fonte = metodo && !invalido ? await lerFonteEquivalencia(codigo, metodo) : null;
  const contexto = metodo && !invalido ? await lerContextoEquivalencia(codigo, metodo) : null;
  const motivos = {
    contexto_divergente: "O contexto da ficha mudou em relação à validação registrada. Não é possível confirmar a equivalência atual.",
    contrato_invalido: "A resposta não confirmou o contrato de equivalência desta ficha e revisão.",
    falha_de_leitura: "Não foi possível consultar as validações desta ficha e revisão. A ausência de decisão não foi confirmada.",
  };

  return (
    <section aria-labelledby="equivalencia-ficha" className="mt-6 space-y-3 border-t border-border pt-4 text-sm">
      <div className="flex items-center gap-1">
        <h2 id="equivalencia-ficha" className="font-semibold">Validações técnicas de equivalência</h2>
        <HelpTip title="Validação técnica não é preferência">
          <p>A decisão vale para a necessidade, etapa, SKU, equipamento e revisão documental registrados. Nome parecido ou item preferencial não prova equivalência.</p>
          <p>Esta consulta não altera cálculos, emissão ou histórico de orçamentos.</p>
        </HelpTip>
      </div>
      <form method="get" action={`/analises/${encodeURIComponent(codigo)}`} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="view" value="materiais-insumos" />
        <label className="min-w-0 flex-1 space-y-1">
          <span className="block font-medium">Referência documental do método e revisão</span>
          <input name="metodo_revisao_ref" defaultValue={invalido ? "" : metodo} required maxLength={160}
            aria-describedby="equivalencia-metodo-ajuda"
            className="h-11 w-full rounded-md border border-input bg-background px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
        </label>
        <button type="submit" className="min-h-11 rounded-md bg-primary px-4 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Consultar revisão</button>
      </form>
      <p id="equivalencia-metodo-ajuda" className="text-muted-foreground">Informe a referência exata do documento técnico. O filtro não escolhe uma revisão automaticamente nem cadastra uma decisão.</p>
      {!escritaHabilitada && <p className="text-muted-foreground">Somente consulta: a escrita revisionada de validações técnicas está desabilitada.</p>}
      {contexto?.estado === "disponivel" ? <EquivalenciaRevisionadaForm contexto={contexto} habilitada={escritaHabilitada} />
        : contexto && <p role="alert">Contexto autorizado {contexto.estado === "negado" ? "negado" : "indisponível"}: {contexto.motivo.replaceAll("_", " ")}. Nenhuma capacidade de escrita presumida.</p>}
      {invalido ? <p role="alert">A referência deve ter no máximo 160 caracteres.</p>
        : fonte === null ? <p>Informe o método e a revisão para consultar as decisões desta ficha.</p>
        : fonte.estado === "indisponivel" ? <p role="alert" className="text-warning-strong">{motivos[fonte.motivo]} Você pode consultar novamente.</p>
        : <>
          <p className="text-muted-foreground">Leitura em {formatDateTime(new Date(fonte.instante).toISOString())} · {fonte.versao}</p>
          {fonte.decisoes.length === 0 ? <p>Nenhuma decisão registrada para esta ficha e revisão. Isso não confirma equivalência.</p>
            : <ul className="divide-y divide-border">
              {fonte.decisoes.map((decisao) => {
                const vigente = decisao.vigente_desde <= fonte.instante && (decisao.vigente_ate === null || decisao.vigente_ate > fonte.instante);
                const estado = decisao.estado === "revogada" ? "Revogada" : vigente ? "Vigente na leitura" : "Fora da vigência na leitura";
                return <li key={decisao.decisao_ref} className="space-y-2 break-words py-3">
                  <h3 className="font-medium">{estado} · {decisao.decisao_ref}</h3>
                  <p>Necessidade #{decisao.necessidade_id} · {decisao.etapa_id === null ? "Sem etapa" : `Etapa #${decisao.etapa_id}`} · SKU #{decisao.insumo_id} · {decisao.equipamento_ref ?? "Sem equipamento"}</p>
                  <p>Apresentação: {decisao.apresentacao_ref}. Conversão registrada: {formatNumber(decisao.fator_conversao)} · estoque: {decisao.unidade_estoque} · consumo: {decisao.unidade_consumo}.</p>
                  <p>Evidência: {decisao.evidencia_ref} · Validador: {decisao.validador_id} ({decisao.papel_validador}).</p>
                  <p className="text-muted-foreground">Desde {formatDateTime(new Date(decisao.vigente_desde).toISOString())} · {decisao.vigente_ate === null ? "Sem fim de vigência registrado" : `Até ${formatDateTime(new Date(decisao.vigente_ate).toISOString())}`}</p>
                </li>;
              })}
            </ul>}
        </>}
    </section>
  );
}
