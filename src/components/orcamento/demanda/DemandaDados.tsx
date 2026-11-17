import { OPCOES_INSTITUICAO, opcaoInstituicao } from "@/lib/orcamento/identidade-institucional";
import { HelpTip } from "@/components/common/HelpTip";
import { SalvarDemandaForm } from "@/components/orcamento/SalvarDemandaForm";
import {
  ClienteCadastradoSelect,
  type ClienteCadastro,
} from "@/components/orcamento/elaboracao/ClienteCadastradoSelect";
import { ROTULO_ETAPA, type EtapaId } from "@/lib/orcamento/etapas-proposta";
import { TOM_ENTRADA } from "@/lib/orcamento/tom-valor";
import type { DemandaDetalhe } from "@/lib/orcamento/demanda-detalhe";
import type { avaliarCompletudeDemanda } from "@/lib/orcamento/demanda-completude";

const lbl = "block text-xs font-medium text-muted-foreground";
// formulário Dados do orçamento: campos de 32 px, grupos aos pares (28/09)
const campo = `rounded-md border border-input bg-card px-2.5 text-sm font-medium ${TOM_ENTRADA} mt-0.5 h-8 w-full`;
const areaTexto = `rounded-md border border-input bg-card px-2.5 py-1.5 text-sm font-medium ${TOM_ENTRADA} mt-0.5 block min-h-14 w-full`;
// Caixas bem delimitadas (28/09): borda mais forte, fundo cinza atrás dos campos brancos e
// título da caixa com linha embaixo, para Identificação, Cliente e Amostras não se misturarem.
const grupo = "min-w-0 rounded-lg border border-foreground/20 bg-muted px-2.5 pb-2.5 pt-2 shadow-sm dark:bg-muted/40";
const legenda =
  "float-left mb-2 w-full border-b border-foreground/15 pb-1 text-xs font-semibold text-brand-700 dark:text-brand-300";
const grade = "clear-both grid grid-cols-6 gap-x-2 gap-y-1.5";
const hydrationSafe = { suppressHydrationWarning: true } as const;
const obrigatorio = <span className="text-danger-strong">*</span>;

type Props = {
  /** "hidden" quando a etapa não é a que está aberta */
  classePasso: string;
  completudeDemanda: ReturnType<typeof avaliarCompletudeDemanda>;
  proximaDosDados: EtapaId | null;
  demandaId: number;
  demanda: DemandaDetalhe;
  opcoesModalidade: [string, string][];
  projetos: { id: number; nome: string; }[] | null;
  clientes: { id: number; nome: string; cnpj: string | null; contato: string | null; email: string | null; telefone: string | null; endereco: string | null; }[] | null;
  exigeAnalises: boolean;
};

/** Etapa 1: dados do orçamento (cliente, modalidade, prazos e textos). */
export function DemandaDados({
  classePasso,
  completudeDemanda,
  proximaDosDados,
  demandaId,
  demanda,
  opcoesModalidade,
  projetos,
  clientes,
  exigeAnalises,
}: Props) {
  return (
    <section id="demanda" className={`mt-3 scroll-mt-20 rounded-lg border border-border bg-card px-4 pb-4 pt-3 shadow-sm ${classePasso}`}>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
        <h2 className="text-sm font-semibold">Dados do orçamento</h2>
        <HelpTip title="Dados do orçamento">
          <p>Pode seguir para os custos com dados parciais e completar depois. Os campos com <span className="text-danger-strong">*</span> são exigidos para emitir a proposta.</p>
        </HelpTip>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${completudeDemanda.completa ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" : "bg-warning-soft text-warning-strong"}`}>
          {completudeDemanda.completa ? "Completa" : `${completudeDemanda.faltante}% faltante`}
        </span>
      </div>
      <SalvarDemandaForm pendencias={completudeDemanda.pendencias} rotuloContinuar={proximaDosDados ? ROTULO_ETAPA[proximaDosDados] : null}>
        <input {...hydrationSafe} type="hidden" name="demanda_id" value={demandaId} />
        {/* Grupos lado a lado em telas largas (3 colunas), campos aos pares. */}
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-[1fr_1fr_0.8fr]">
          <fieldset className={grupo}>
            <legend className={legenda}>Identificação</legend>
            <div className={grade}>
              <div className="col-span-6">
                <label htmlFor="d-titulo" className={lbl}>Título {obrigatorio}</label>
                <input {...hydrationSafe} id="d-titulo" name="titulo" defaultValue={demanda.titulo ?? ""} className={campo} />
              </div>
              <div className="col-span-4">
                <label htmlFor="d-modalidade" className={lbl}>Modalidade</label>
                <select {...hydrationSafe} id="d-modalidade" name="modalidade" defaultValue={demanda.modalidade ?? "analises"} className={campo}>
                  {opcoesModalidade.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label htmlFor="d-prioridade" className={lbl}>Prioridade</label>
                <select {...hydrationSafe} id="d-prioridade" name="prioridade" defaultValue={demanda.prioridade ?? "normal"} className={campo}>
                  <option value="baixa">Baixa</option>
                  <option value="normal">Normal</option>
                  <option value="alta">Alta</option>
                  <option value="urgente">Urgente</option>
                </select>
              </div>
              <div className="col-span-3">
                <label htmlFor="orcamento-instituicao" className={lbl}>Empresa emissora</label>
                <select {...hydrationSafe} id="orcamento-instituicao" name="instituicao" defaultValue={opcaoInstituicao(demanda.instituicao)} className={campo}>
                  <option value="">Escolha…</option>
                  {OPCOES_INSTITUICAO.map((opcao) => <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>)}
                </select>
              </div>
              <div className="col-span-3">
                <label htmlFor="d-projeto" className={lbl}>Projeto <span className="font-normal">(se já existir)</span></label>
                <select {...hydrationSafe} id="d-projeto" name="projeto_id" defaultValue={demanda.projeto_id ?? ""} className={campo}>
                  <option value="">—</option>
                  {(projetos ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.nome}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-3">
                <label htmlFor="d-responsavel" className={lbl}>Responsável interno</label>
                <input {...hydrationSafe} id="d-responsavel" name="responsavel_interno" defaultValue={demanda.responsavel_interno ?? ""} className={campo} />
              </div>
              <div className="col-span-3">
                <label htmlFor="d-origem" className={lbl}>Origem</label>
                <input {...hydrationSafe} id="d-origem" name="origem" defaultValue={demanda.origem ?? ""} className={campo} />
              </div>
            </div>
          </fieldset>
    
          <fieldset className={grupo}>
            <legend className={legenda}>Cliente</legend>
            <div className={grade}>
              <div className="col-span-6">
                <label htmlFor="d-cliente" className={lbl}>Cliente cadastrado <span className="font-normal">(preenche os dados abaixo)</span></label>
                <ClienteCadastradoSelect
                  id="d-cliente"
                  name="cliente_id"
                  clientes={(clientes ?? []) as ClienteCadastro[]}
                  valorInicial={demanda.cliente_id ?? null}
                  className={campo}
                />
              </div>
              <div className="col-span-4">
                <label htmlFor="d-cliente-nome" className={lbl}>Razão social / nome {obrigatorio}</label>
                <input {...hydrationSafe} id="d-cliente-nome" name="cliente_nome" defaultValue={demanda.cliente_nome ?? ""} className={campo} />
              </div>
              <div className="col-span-2">
                <label htmlFor="d-cliente-cnpj" className={lbl}>CNPJ/CPF</label>
                <input {...hydrationSafe} id="d-cliente-cnpj" name="cliente_cnpj" defaultValue={demanda.cliente_cnpj ?? ""} className={campo} />
              </div>
              <div className="col-span-3">
                <label htmlFor="d-cliente-contato" className={lbl}>Contato</label>
                <input {...hydrationSafe} id="d-cliente-contato" name="cliente_contato" defaultValue={demanda.cliente_contato ?? ""} className={campo} />
              </div>
              <div className="col-span-3">
                <label htmlFor="d-cliente-telefone" className={lbl}>Telefone</label>
                <input {...hydrationSafe} id="d-cliente-telefone" name="cliente_telefone" defaultValue={demanda.cliente_telefone ?? ""} className={campo} />
              </div>
              <div className="col-span-3">
                <label htmlFor="d-cliente-email" className={lbl}>E-mail</label>
                <input {...hydrationSafe} id="d-cliente-email" name="cliente_email" type="email" defaultValue={demanda.cliente_email ?? ""} className={campo} />
              </div>
              <div className="col-span-3">
                <label htmlFor="d-cliente-endereco" className={lbl}>Endereço</label>
                <input {...hydrationSafe} id="d-cliente-endereco" name="cliente_endereco" defaultValue={demanda.cliente_endereco ?? ""} placeholder="Rua, nº · cidade/UF" className={campo} />
              </div>
            </div>
          </fieldset>
    
          <fieldset className={`${grupo} lg:col-span-2 2xl:col-span-1`}>
            <legend className={legenda}>Amostras e prazos</legend>
            <div className={`${grade} lg:grid-cols-12 2xl:grid-cols-6`}>
              <div className="col-span-6 lg:col-span-4 2xl:col-span-6">
                <label htmlFor="d-matriz" className={lbl}>Matriz ou tipo de amostra {exigeAnalises && obrigatorio}</label>
                <input {...hydrationSafe} id="d-matriz" name="matriz_amostra" defaultValue={demanda.matriz_amostra ?? ""} className={campo} />
              </div>
              <div className="col-span-3 lg:col-span-2 2xl:col-span-3">
                <label htmlFor="d-qtd" className={lbl}>Qtd. de amostras {exigeAnalises && obrigatorio}</label>
                <input {...hydrationSafe} id="d-qtd" name="quantidade_amostras_estimada" type="number" min="1" step="1" defaultValue={demanda.quantidade_amostras_estimada ?? ""} className={`${campo} text-right tabular-nums`} />
              </div>
              <div className="col-span-3 lg:col-span-2 2xl:col-span-3">
                <label htmlFor="d-prazo-tecnico" className={lbl}>Prazo técnico (dias)</label>
                <input {...hydrationSafe} id="d-prazo-tecnico" name="prazo_tecnico_dias" type="number" min="1" step="1" defaultValue={demanda.prazo_tecnico_dias ?? ""} className={`${campo} text-right tabular-nums`} />
              </div>
              <div className="col-span-3 lg:col-span-2 2xl:col-span-3">
                <label htmlFor="d-solicitacao" className={lbl}>Solicitado em</label>
                <input {...hydrationSafe} id="d-solicitacao" name="data_solicitacao" type="date" defaultValue={demanda.data_solicitacao ?? ""} className={campo} />
              </div>
              <div className="col-span-3 lg:col-span-2 2xl:col-span-3">
                <label htmlFor="d-prazo" className={lbl}>Prazo esperado</label>
                <input {...hydrationSafe} id="d-prazo" name="prazo_esperado" type="date" defaultValue={demanda.prazo_esperado ?? ""} className={campo} />
              </div>
            </div>
          </fieldset>
    
          <fieldset className={`${grupo} lg:col-span-2 2xl:col-span-3`}>
            <legend className={legenda}>Textos</legend>
            <div className="clear-both grid gap-x-2.5 gap-y-1.5 md:grid-cols-3">
              <div>
                <label htmlFor="d-descricao" className={lbl}>Descrição {obrigatorio} <span className="font-normal">(esta ou o escopo)</span></label>
                <textarea {...hydrationSafe} id="d-descricao" name="descricao" rows={2} defaultValue={demanda.descricao ?? ""} className={areaTexto} />
              </div>
              <div>
                <label htmlFor="d-escopo" className={lbl}>
                  Escopo preliminar {obrigatorio} <span className="font-normal">(texto inicial da proposta)</span>
                </label>
                <textarea {...hydrationSafe} id="d-escopo" name="escopo_preliminar" rows={2} defaultValue={demanda.escopo_preliminar ?? ""} className={areaTexto} />
              </div>
              <div>
                <label htmlFor="d-observacoes" className={lbl}>Observações internas</label>
                <textarea {...hydrationSafe} id="d-observacoes" name="observacoes" rows={2} defaultValue={demanda.observacoes ?? ""} className={areaTexto} />
              </div>
            </div>
          </fieldset>
        </div>
      </SalvarDemandaForm>
    </section>
  );
}
