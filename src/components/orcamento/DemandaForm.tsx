"use client";

import { useActionState, useMemo, useState } from "react";
import type { DemandaFormState } from "@/lib/actions/demandas";
import { criarDemandaCompleta, salvarDemanda } from "@/lib/actions/demandas";
import { modalidadeExigeLaboratorio } from "@/lib/orcamento/orcamento-economico";
import { proximaIdentificacaoGrupo } from "@/lib/orcamento/grupos-amostras";
import { TOM_ENTRADA } from "@/lib/orcamento/tom-valor";
import { formatCurrency } from "@/lib/formatters";
import { Pencil, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HelpExample, HelpLegend, HelpTip } from "@/components/common/HelpTip";
import { OPCOES_INSTITUICAO, opcaoInstituicao } from "@/lib/orcamento/identidade-institucional";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

type Option = { id: number; nome: string };
type Demanda = {
  id: number;
  titulo: string | null;
  cliente_id: number | null;
  projeto_id: number | null;
  cliente_nome: string | null;
  cliente_cnpj: string | null;
  cliente_contato: string | null;
  instituicao: string | null;
  responsavel_interno: string | null;
  origem: string | null;
  data_solicitacao: string | null;
  prazo_esperado: string | null;
  matriz_amostra: string | null;
  quantidade_amostras_estimada: number | null;
  prazo_tecnico_dias: number | null;
  modalidade: string | null;
  status: string | null;
  prioridade: string | null;
  descricao: string | null;
  escopo_preliminar: string | null;
  observacoes: string | null;
};
export type AnaliseCatalogoDemanda = {
  codigo: string;
  nome: string | null;
  nome_simplificado: string | null;
  descricao: string | null;
  status: string | null;
  metodo: string | null;
  matriz?: string | null;
  unidade: string | null;
  prazo_tecnico_dias: number | null;
  custeio_disponivel: boolean;
  lote_padrao: number | null;
  capacidade_dia: number | null;
  reagentes: Array<{
    especificacao: string;
    unidade: string;
    quantidade_por_amostra: number;
    custo_unitario?: number | null;
    status_vinculo_insumo?: string | null;
    estoque_status?: string | null;
    modo_cobranca: "por_amostra" | "por_execucao";
  }>;
};
export type GrupoAmostraDemanda = {
  id?: number | null;
  identificacao: string;
  tipo_matriz: string | null;
  quantidade_amostras: number;
  unidade: string;
  observacao: string | null;
};
export type AnaliseSelecionadaDemanda = {
  grupo_amostra_id?: number | null;
  grupo_identificacao?: string | null;
  codigo_analise: string;
  quantidade_amostras: number;
  origem_quantidade: string;
  status_custeio?: string | null;
};

const initialState: DemandaFormState = { ok: false };
/** Itens exibidos no catálogo de uma vez; acima disso, o usuário refina a busca. */
const LIMITE_CATALOGO = 30;
const inp = `rounded-md border-2 border-brand-300 bg-card px-3 py-2 text-sm font-medium shadow-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-200 dark:border-brand-700 dark:focus:ring-brand-900 ${TOM_ENTRADA}`;
const inheritedInp = "rounded-md border border-input bg-muted/50 px-3 py-2 text-sm font-medium text-foreground shadow-sm outline-none focus:border-ring focus:ring-2 focus:ring-border";
const operationalInp = "rounded-md border-2 border-warning-strong/30 bg-warning-soft px-3 py-2 text-sm font-semibold text-warning-strong shadow-sm outline-none focus:border-warning-strong focus:ring-2 focus:ring-warning-strong/30";
const lbl = "block text-xs font-medium text-muted-foreground";

export function DemandaForm({
  demanda,
  clientes,
  projetos,
  analises,
  gruposAmostras,
  analisesSelecionadas,
  matrizes = [],
  modo = "completo",
}: {
  demanda: Demanda;
  clientes: Option[];
  projetos: Option[];
  analises: AnaliseCatalogoDemanda[];
  gruposAmostras: GrupoAmostraDemanda[];
  analisesSelecionadas: AnaliseSelecionadaDemanda[];
  /** Matrizes cadastradas; o grupo só aceita um código desta lista (FK). */
  matrizes?: { codigo: string; nome: string }[];
  modo?: "completo" | "demanda" | "laboratorio";
}) {
  const action: (state: DemandaFormState, formData: FormData) => Promise<DemandaFormState> =
    demanda.id > 0 ? salvarDemanda : criarDemandaCompleta;
  const [state, formAction, pending] = useActionState(action, initialState);
  const quantidadeInicial = demanda.quantidade_amostras_estimada ?? 1;
  const [modalidade, setModalidade] = useState(demanda.modalidade ?? "analises");
  const [busca, setBusca] = useState("");
  // Quantidade aceita "" durante a digitação para o campo poder ser apagado.
  const [grupos, setGrupos] = useState<Array<Omit<GrupoAmostraDemanda, "quantidade_amostras"> & { quantidade_amostras: number | ""; key: string }>>(() => {
    const base = gruposAmostras.length > 0 ? gruposAmostras : [{
      identificacao: "Grupo A",
      tipo_matriz: demanda.matriz_amostra,
      quantidade_amostras: quantidadeInicial,
      unidade: "amostras",
      observacao: null,
    }];
    return base.map((grupo, index) => ({ ...grupo, key: `grupo-${grupo.id ?? index + 1}` }));
  });
  const [selecionadas, setSelecionadas] = useState<Array<{ grupoKey: string; codigo: string; quantidade: number | ""; origem: string; statusCusteio: string | null }>>(() =>
    analisesSelecionadas.map((item) => {
      const fallbackIndex = gruposAmostras.findIndex((grupo) => grupo.identificacao === item.grupo_identificacao);
      const fallbackKey = grupos[fallbackIndex >= 0 ? fallbackIndex : 0]?.key ?? "grupo-1";
      return {
        grupoKey: item.grupo_amostra_id ? `grupo-${item.grupo_amostra_id}` : fallbackKey,
        codigo: item.codigo_analise,
        quantidade: item.quantidade_amostras || quantidadeInicial,
        origem: item.origem_quantidade === "manual" ? "manual" : "padrao",
        statusCusteio: item.status_custeio ?? null,
      };
    }),
  );
  const [, setGrupoAtivo] = useState(() => grupos[0]?.key ?? "grupo-1");
  const [seletorAberto, setSeletorAberto] = useState<string | null>(null);
  const exigeAnalises = modalidadeExigeLaboratorio(modalidade);
  const mostraDemanda = modo !== "laboratorio";
  const mostraLaboratorio = modo !== "demanda";
  const porCodigo = useMemo(() => new Map(analises.map((analise) => [analise.codigo, analise])), [analises]);
  const [grupoParaRemover, setGrupoParaRemover] = useState<string | null>(null);
  const removerGrupo = (grupoKey: string) => {
    setGrupos((atuais) => (atuais.length > 1 ? atuais.filter((item) => item.key !== grupoKey) : atuais));
    setSelecionadas((atuais) => atuais.filter((item) => item.grupoKey !== grupoKey));
    setSeletorAberto((atual) => (atual === grupoKey ? null : atual));
    setGrupoParaRemover(null);
  };
  const { filtradas, totalEncontradas } = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const base = termo
          ? analises.filter((analise) =>
          [analise.codigo, analise.nome, analise.nome_simplificado, analise.metodo, analise.matriz, analise.status, analise.descricao]
            .filter(Boolean)
            .some((valor) => String(valor).toLowerCase().includes(termo)),
        )
      : analises;
    return { filtradas: base.slice(0, LIMITE_CATALOGO), totalEncontradas: base.length };
  }, [analises, busca]);

  const toggleAnalise = (grupoKey: string, codigo: string) => {
    setSelecionadas((atuais) => {
      if (atuais.some((item) => item.codigo === codigo && item.grupoKey === grupoKey)) return atuais.filter((item) => !(item.codigo === codigo && item.grupoKey === grupoKey));
      const grupo = grupos.find((item) => item.key === grupoKey);
      return [...atuais, { grupoKey, codigo, quantidade: Number(grupo?.quantidade_amostras) || quantidadeInicial, origem: "padrao", statusCusteio: porCodigo.get(codigo)?.custeio_disponivel ? "disponivel" : "pendente" }];
    });
  };
  const totalAmostras = selecionadas.reduce((total, item) => total + Number(item.quantidade || 0), 0);
  const pendentesCusteio = selecionadas.filter((item) => {
    const analise = porCodigo.get(item.codigo);
    return analise ? !analise.custeio_disponivel : item.statusCusteio === "pendente";
  }).length;
  const previsoesOperacionais = selecionadas.map((item) => {
    const analise = porCodigo.get(item.codigo);
    const quantidade = Math.max(1, Number(item.quantidade || 1));
    const lotePadrao = Math.max(1, Number(analise?.lote_padrao ?? quantidade));
    const lotes = Math.max(1, Math.ceil(quantidade / lotePadrao));
    const capacidadeDia = Math.max(0, Number(analise?.capacidade_dia ?? 0));
    return {
      key: `${item.grupoKey}-${item.codigo}`,
      grupoKey: item.grupoKey,
      codigo: item.codigo,
      quantidade,
      lotePadrao,
      lotes,
      prazoDias: capacidadeDia > 0 ? Math.max(1, Math.ceil(quantidade / capacidadeDia)) : null,
      reagentes: (analise?.reagentes ?? []).map((reagente) => ({
        ...reagente,
        consumo: reagente.quantidade_por_amostra * (reagente.modo_cobranca === "por_execucao" ? lotes : quantidade),
        custo: Number(reagente.custo_unitario ?? 0) * reagente.quantidade_por_amostra * (reagente.modo_cobranca === "por_execucao" ? lotes : quantidade),
      })),
    };
  });
  const custoDiretoLaboratorio = previsoesOperacionais.reduce(
    (total, previsao) => total + previsao.reagentes.reduce((subtotal, reagente) => subtotal + Number(reagente.custo || 0), 0),
    0,
  );
  const prazoMaximoLaboratorio = Math.max(0, ...previsoesOperacionais.map((previsao) => Number(previsao.prazoDias ?? 0)));
  const pendenciasInsumos = analises
    .flatMap((analise) => analise.reagentes.map((reagente) => ({ codigo: analise.codigo, ...reagente })))
    .filter((reagente) => reagente.status_vinculo_insumo === "insumo_sem_cadastro_correspondente");

  return (
    <form action={formAction} {...formularioSemPerda(state)} className="mt-3 space-y-4">
      {demanda.id > 0 ? <input type="hidden" name="demanda_id" value={demanda.id} /> : null}
      <input type="hidden" name="escopo_salvamento" value={modo} />
      {!mostraDemanda && (
        <CamposDemandaLeitura
          demanda={demanda}
          quantidadeAmostras={grupos.reduce((total, grupo) => total + Number(grupo.quantidade_amostras || 0), 0) || quantidadeInicial}
          matrizAmostra={grupos.map((grupo) => grupo.tipo_matriz).filter(Boolean).join("; ") || (demanda.matriz_amostra ?? "")}
        />
      )}
      <div className="flex flex-wrap gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
        <Legenda texto="Editável" classe="border-brand-300 bg-card" />
        <Legenda texto="Herdado" classe="border-input bg-muted" />
        <Legenda texto="Calculado" classe="border-dashed border-input bg-muted" />
        <Legenda texto="Operacional" classe="border-warning-strong/30 bg-warning-soft" />
        <Legenda texto="Bloqueado após emissão" classe="border-input bg-muted" />
      </div>
      {state.message && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            state.ok
              ? "bg-brand-50 text-brand-900 dark:bg-brand-950/40 dark:text-brand-200"
              : "bg-danger-soft text-danger-strong"
          }`}
          aria-live="polite"
        >
          {state.message}
          {state.savedAt ? <span className="ml-2 text-xs opacity-75">Último salvamento: {new Date(state.savedAt).toLocaleString("pt-BR")}</span> : null}
        </div>
      )}
      {mostraDemanda && (
      <section className="rounded-md border border-border p-3">
        <h3 className="text-sm font-semibold">Identificação do orçamento</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className={lbl}>Título <Obrigatorio /></label>
            <input name="titulo" defaultValue={demanda.titulo ?? ""} className={`${inp} mt-1 w-full`} />
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>Modalidade <Obrigatorio /></label>
            <select name="modalidade" value={modalidade} onChange={(event) => setModalidade(event.target.value)} className={`${inp} mt-1 w-full`}>
              <option value="analises">Análises laboratoriais</option>
              <option value="projeto">Projeto sem análises</option>
              <option value="projeto_com_analises">Projeto com análises</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Número do orçamento <Selo texto="Calculado" /></label>
            <div className="mt-1 rounded-md border border-dashed border-input bg-muted/50 px-3 py-2 text-sm font-medium text-muted-foreground">
              {demanda.id > 0 ? `#${demanda.id}` : "Gerado ao salvar"}
            </div>
          </div>
          <div>
            <label className={lbl}>Prioridade</label>
            <select name="prioridade" defaultValue={demanda.prioridade ?? "normal"} className={`${inp} mt-1 w-full`}>
              <option value="baixa">Baixa</option>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
              <option value="urgente">Urgente</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Responsável interno</label>
            <input name="responsavel_interno" defaultValue={demanda.responsavel_interno ?? ""} className={`${inp} mt-1 w-full`} />
          </div>
          <div>
            <label className={lbl}>Data da solicitação</label>
            <input name="data_solicitacao" type="date" defaultValue={demanda.data_solicitacao ?? ""} className={`${inp} mt-1 w-full`} />
          </div>
          <div>
            <label className={lbl}>Prazo esperado</label>
            <input name="prazo_esperado" type="date" defaultValue={demanda.prazo_esperado ?? ""} className={`${inp} mt-1 w-full`} />
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>Origem</label>
            <input name="origem" defaultValue={demanda.origem ?? ""} className={`${inp} mt-1 w-full`} />
          </div>
          <input name="prazo_tecnico_dias" type="hidden" value={demanda.prazo_tecnico_dias ?? ""} />
          <input name="quantidade_amostras_estimada" type="hidden" value={grupos.reduce((total, grupo) => total + Number(grupo.quantidade_amostras || 0), 0) || quantidadeInicial} />
          <input name="matriz_amostra" type="hidden" value={grupos.map((grupo) => grupo.tipo_matriz).filter(Boolean).join("; ") || (demanda.matriz_amostra ?? "")} />
        </div>
      </section>
      )}

      {mostraDemanda && (
      <section className="rounded-md border border-border p-3">
        <h3 className="text-sm font-semibold">Cliente</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className={lbl}>Cliente <Obrigatorio /></label>
            <select name="cliente_id" defaultValue={demanda.cliente_id ?? ""} className={`${inp} mt-1 w-full`}>
              <option value="">Sem cadastro</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>Projeto <Selo texto="Quando aplicável" /></label>
            <select name="projeto_id" defaultValue={demanda.projeto_id ?? ""} className={`${inp} mt-1 w-full`}>
              <option value="">Sem projeto vinculado</option>
              {projetos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>Nome do cliente <Selo texto="Editável" /></label>
            <input name="cliente_nome" defaultValue={demanda.cliente_nome ?? ""} className={`${inp} mt-1 w-full`} />
          </div>
          <div>
            <label className={lbl}>CNPJ/CPF</label>
            <input name="cliente_cnpj" defaultValue={demanda.cliente_cnpj ?? ""} className={`${inp} mt-1 w-full`} />
          </div>
          <div>
            <label htmlFor="demanda-instituicao" className={lbl}>Instituição emissora (cabeçalho da proposta)</label>
            <select id="demanda-instituicao" name="instituicao" defaultValue={opcaoInstituicao(demanda.instituicao)} className={`${inp} mt-1 w-full`}>
              <option value="">Escolha…</option>
              {OPCOES_INSTITUICAO.map((opcao) => <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>Contato <Selo texto="Herdado do cliente quando selecionado" /></label>
            <input name="cliente_contato" defaultValue={demanda.cliente_contato ?? ""} className={`${inheritedInp} mt-1 w-full`} />
          </div>
        </div>
      </section>
      )}

      {mostraDemanda && (
      <section className="rounded-md border border-border p-3">
        <h3 className="text-sm font-semibold">Escopo inicial</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={lbl}>Descrição do orçamento <Obrigatorio /></label>
            <textarea id="descricao" name="descricao" rows={3} defaultValue={demanda.descricao ?? ""} className={`${inp} mt-1 w-full ${state.errors?.descricao ? "border-danger-strong/40 focus:border-danger-strong focus:ring-danger-strong/30" : ""}`} />
          </div>
          <div>
            <label className={lbl}>Observações gerais</label>
            <textarea name="observacoes" rows={3} defaultValue={demanda.observacoes ?? ""} className={`${inp} mt-1 w-full`} />
          </div>
        </div>
      </section>
      )}

      {mostraLaboratorio && exigeAnalises && (
      <section className="rounded-md border border-border p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold">Amostras a processar</h3>
            <HelpTip title="Grupos de amostras">
              <p>Separe as amostras em <b>grupos</b> por tipo ou matriz, cada um com suas análises. A quantidade do grupo vale para todas as análises dele, salvo se você mudar na linha.</p>
              <HelpExample>Grupo A: 20 amostras de solo com qPCR e 16S. Grupo B: 5 amostras de água só com qPCR.</HelpExample>
            </HelpTip>
          </div>
          <button type="button" onClick={() => {
            const key = `grupo-novo-${Date.now()}`;
            setGrupos((atuais) => [...atuais, { key, identificacao: proximaIdentificacaoGrupo(atuais.map((g) => g.identificacao)), tipo_matriz: "", quantidade_amostras: 1, unidade: "amostras", observacao: null }]);
            setGrupoAtivo(key);
            setSeletorAberto(key);
          }} className="rounded-md border border-input px-3 py-2 text-xs font-medium hover:bg-muted">Adicionar tipo de amostra</button>
        </div>
        <div className="mt-3 grid gap-3">
          {grupos.map((grupo) => {
            const selecionadasDoGrupo = selecionadas.filter((item) => item.grupoKey === grupo.key);
            return (
            <div key={grupo.key} id={`grupo-card-${grupo.key}`} className="grid gap-2 rounded-md bg-muted/50 p-3 sm:grid-cols-5">
              <input type="hidden" name="grupo_key" value={grupo.key} />
              {/* id do grupo existente: permite atualizar em vez de recriar,
                  preservando o vínculo de demanda_analises.grupo_amostra_id */}
              <input type="hidden" name="grupo_id" value={grupo.id ?? ""} />
              <div><label className={lbl}>Grupo</label><input name="grupo_identificacao" value={grupo.identificacao} onChange={(event) => setGrupos((atuais) => atuais.map((item) => item.key === grupo.key ? { ...item, identificacao: event.target.value } : item))} className={`${inp} mt-1 w-full`} /></div>
              <div className="sm:col-span-2"><label htmlFor={`matriz-${grupo.key}`} className={lbl}>Tipo/matriz</label>{matrizes.length > 0 ? (
                <select id={`matriz-${grupo.key}`} name="grupo_tipo_matriz" value={grupo.tipo_matriz ?? ""} onChange={(event) => setGrupos((atuais) => atuais.map((item) => item.key === grupo.key ? { ...item, tipo_matriz: event.target.value } : item))} className={`${inp} mt-1 w-full`}>
                  <option value="">Selecione…</option>
                  {grupo.tipo_matriz && !matrizes.some((m) => m.codigo === grupo.tipo_matriz) && <option value={grupo.tipo_matriz}>{grupo.tipo_matriz}</option>}
                  {matrizes.map((m) => <option key={m.codigo} value={m.codigo}>{m.nome}</option>)}
                </select>
              ) : (
                <input id={`matriz-${grupo.key}`} name="grupo_tipo_matriz" value={grupo.tipo_matriz ?? ""} onChange={(event) => setGrupos((atuais) => atuais.map((item) => item.key === grupo.key ? { ...item, tipo_matriz: event.target.value } : item))} className={`${inp} mt-1 w-full`} />
              )}</div>
              <div><label className={lbl}>Quantidade</label><input name="grupo_quantidade" type="number" min="1" step="1" required value={grupo.quantidade_amostras} onChange={(event) => {
                const quantidade = lerQuantidade(event.target.value);
                setGrupos((atuais) => atuais.map((item) => item.key === grupo.key ? { ...item, quantidade_amostras: quantidade } : item));
                // Análises que seguem o padrão do grupo acompanham a nova quantidade.
                if (quantidade !== "") setSelecionadas((atuais) => atuais.map((atual) => atual.grupoKey === grupo.key && atual.origem === "padrao" ? { ...atual, quantidade } : atual));
              }} className={`${operationalInp} mt-1 w-full`} /></div>
              <div><label className={lbl}>Unidade</label><input name="grupo_unidade" value={grupo.unidade} onChange={(event) => setGrupos((atuais) => atuais.map((item) => item.key === grupo.key ? { ...item, unidade: event.target.value } : item))} className={`${inp} mt-1 w-full`} /></div>
              <div className="sm:col-span-5"><label className={lbl}>Observação</label><input name="grupo_observacao" value={grupo.observacao ?? ""} onChange={(event) => setGrupos((atuais) => atuais.map((item) => item.key === grupo.key ? { ...item, observacao: event.target.value } : item))} className={`${inp} mt-1 w-full`} /></div>
              {grupos.length > 1 && (
                <div className="sm:col-span-5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (selecionadasDoGrupo.length === 0) removerGrupo(grupo.key);
                      else setGrupoParaRemover(grupo.key);
                    }}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-danger-strong hover:bg-danger-soft"
                  >
                    <Trash2 aria-hidden className="h-3.5 w-3.5" /> Remover grupo
                  </button>
                </div>
              )}
              <div className="sm:col-span-5 rounded-md border border-border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground">Análises deste grupo</h4>
                    <p className="mt-1 text-xs text-muted-foreground">{selecionadasDoGrupo.length} análise(s) selecionada(s) para {grupo.identificacao || "grupo"}.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setGrupoAtivo(grupo.key);
                      setSeletorAberto((atual) => atual === grupo.key ? null : grupo.key);
                    }}
                    className="rounded-md bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-500"
                  >
                    Selecionar análises
                  </button>
                </div>
                {selecionadasDoGrupo.length > 0 ? (
                  <div tabIndex={0} aria-label="Análises selecionadas do grupo" className="mt-3 overflow-x-auto">
                    <table className="min-w-full divide-y divide-border/70 text-sm">
                      <thead className="text-left text-xs text-muted-foreground">
                        <tr><th className="py-2">Código da análise</th><th>Nome da análise</th><th>Quantidade de amostras para esta análise</th><th className="w-10 text-right"></th></tr>
                      </thead>
                      <tbody className="divide-y divide-border/70">
                        {selecionadasDoGrupo.map((item) => {
                          const analise = porCodigo.get(item.codigo);
                          return (
                            <tr key={`${item.grupoKey}-${item.codigo}`}>
                              <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                                <input type="hidden" name="analise_grupo_key" value={item.grupoKey} />
                                <input type="hidden" name="analise_codigo" value={item.codigo} />
                                <input type="hidden" name="analise_origem_quantidade" value={item.origem} />
                                {item.codigo}
                              </td>
                              <td className="pr-3">{analise?.nome_simplificado ?? analise?.nome ?? "Sem nome"}</td>
                              <td className="pr-3">
                                <input
                                  name="analise_quantidade"
                                  type="number"
                                  min="1"
                                  step="1"
                                  required
                                  value={item.quantidade}
                                  onChange={(event) => setSelecionadas((atuais) => atuais.map((atual) => atual.codigo === item.codigo && atual.grupoKey === item.grupoKey ? { ...atual, quantidade: lerQuantidade(event.target.value), origem: "manual" } : atual))}
                                  className={`${operationalInp} w-24`}
                                />
                              </td>
                              <td className="text-right">
                                <button type="button" onClick={() => toggleAnalise(item.grupoKey, item.codigo)} className="text-danger-strong hover:text-danger-strong" title="Remover análise" aria-label={`Remover análise ${item.codigo}`}>
                                  <Trash2 aria-hidden className="h-4 w-4 inline" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-3 rounded-md border border-dashed border-input px-3 py-2 text-xs text-muted-foreground">Nenhuma análise selecionada para este grupo.</p>
                )}
                {seletorAberto === grupo.key && (
                  <div className="mt-3 rounded-md border border-brand-200 bg-brand-50/40 p-3 dark:border-brand-900 dark:bg-brand-950/20">
                    <input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar por código, nome ou método" aria-label="Buscar análises" className={`${inp} w-full`} />
                    {totalEncontradas > filtradas.length && (
                      <p role="status" className="mt-2 text-xs text-muted-foreground">
                        Mostrando {filtradas.length} de {totalEncontradas}. Refine a busca para ver as demais.
                      </p>
                    )}
                    <div tabIndex={0} aria-label="Catálogo de análises filtradas" className="mt-3 max-h-[24rem] overflow-y-auto rounded-md border border-border bg-card">
                      {filtradas.length === 0 ? (
                        <p className="px-3 py-4 text-xs text-muted-foreground">
                          {analises.length === 0 ? "Não existem análises ativas cadastradas ou você não possui permissão para visualizar este catálogo." : "Nenhuma análise corresponde à busca ou à matriz informada."}
                        </p>
                      ) : filtradas.map((analise) => {
                        const marcada = selecionadas.some((item) => item.codigo === analise.codigo && item.grupoKey === grupo.key);
                        const pendenteInsumo = analise.reagentes.some((reagente) => reagente.status_vinculo_insumo === "insumo_sem_cadastro_correspondente");
                        return (
                          <label key={`${grupo.key}-${analise.codigo}`} className="flex cursor-pointer gap-3 border-b border-border/70 px-3 py-2 text-sm last:border-0 hover:bg-brand-50 focus-within:bg-brand-50 dark:hover:bg-brand-950/20">
                            <input type="checkbox" checked={marcada} onChange={() => toggleAnalise(grupo.key, analise.codigo)} className="mt-1 h-4 w-4 rounded border-input focus:ring-2 focus:ring-brand-500" />
                            <span>
                              <span className="font-medium">{analise.codigo} · {analise.nome_simplificado ?? analise.nome ?? "Sem nome"}</span>
                              <span className="block text-xs text-muted-foreground">
                                Método: {analise.metodo ?? "não informado"} · Lote: {analise.lote_padrao ?? "a calcular"} amostra(s) · Custeio: {analise.custeio_disponivel ? "disponível" : "pendente"}{pendenteInsumo ? " · insumo sem cadastro" : ""}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      </section>
      )}

      {mostraLaboratorio && exigeAnalises && (
        <section id="analises-solicitadas" className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-1">
                <h3 className="text-sm font-semibold">Análises por grupo de amostra</h3>
                <HelpTip title="Previsão por análise">
                  <p><b>Lotes previstos</b> é o número de corridas necessárias, conforme o lote de cada análise. O sistema ainda <b>não verifica a matriz</b>: confirme tecnicamente se cada análise serve para a amostra.</p>
                  <HelpLegend
                    items={[
                      { tom: "info", rotulo: "Disponível", texto: "custo da análise já calculado; insumos cadastrados (Mapeados)." },
                      { tom: "atencao", rotulo: "Pendente", texto: "falta custo calculado ou há reagente sem cadastro no estoque." },
                    ]}
                  />
                  <HelpExample>30 amostras e lote de 12 → 3 lotes previstos.</HelpExample>
                </HelpTip>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Resumo consolidado das análises selecionadas nos grupos acima. {analises.length} análise(s) oficial(is) disponível(is).</p>
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <ResumoLaboratorio titulo="Análises" valor={`${selecionadas.length}`} detalhe={`${totalAmostras} amostra(s)`} />
            <ResumoLaboratorio titulo="Custo direto estimado" valor={formatCurrency(custoDiretoLaboratorio)} detalhe="insumos/reagentes" />
            <ResumoLaboratorio titulo="Prazo técnico" valor={prazoMaximoLaboratorio > 0 ? `${prazoMaximoLaboratorio} dia(s)` : "a calcular"} detalhe="maior prazo previsto" />
            <ResumoLaboratorio titulo="Pendências" valor={`${pendentesCusteio}`} detalhe={pendentesCusteio > 0 ? "custeio pendente" : "custeio disponível"} />
          </div>
          <div className="mt-3 rounded-md border border-warning-strong/30 bg-warning-soft px-3 py-2 text-xs text-warning-strong">
            Confirme tecnicamente se cada análise serve para a matriz antes de emitir.
          </div>
          <div tabIndex={0} aria-label="Resumo de análises por grupo" className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-2">Grupo</th><th>Tipo/matriz da amostra</th><th>Código da análise</th><th>Nome da análise</th><th>Quantidade de amostras para esta análise</th><th>Prazo técnico calculado</th><th>Lotes previstos</th><th>Status do custeio</th><th>Status dos insumos</th><th className="w-16 text-right"></th></tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {selecionadas.map((item) => {
                  const analise = porCodigo.get(item.codigo);
                  const grupo = grupos.find((grupo) => grupo.key === item.grupoKey);
                  const previsao = previsoesOperacionais.find((prev) => prev.key === `${item.grupoKey}-${item.codigo}`);
                  const statusInsumos = analise?.reagentes.some((reagente) => reagente.status_vinculo_insumo === "insumo_sem_cadastro_correspondente") ? "Pendente" : "Mapeados";
                  return (
                    <tr key={`${item.grupoKey}-${item.codigo}`}>
                      <td className="py-2 pr-3">{grupo?.identificacao ?? "Grupo"}</td>
                      <td className="pr-3 text-muted-foreground">{grupo?.tipo_matriz || "—"}</td>
                      <td className="pr-3 font-mono text-xs text-muted-foreground">{item.codigo}</td>
                      <td className="pr-3">{analise?.nome_simplificado ?? analise?.nome ?? "Sem nome"}</td>
                      <td className="pr-3 font-semibold tabular-nums">{item.quantidade}</td>
                      <td className="pr-3 text-muted-foreground">{previsao?.prazoDias ? `${previsao.prazoDias} dia(s)` : "a calcular"}</td>
                      <td className="pr-3 text-muted-foreground">{previsao ? `${previsao.lotes} lote(s) de ${previsao.lotePadrao}` : "a calcular"}</td>
                      <td className={analise?.custeio_disponivel ? "pr-3 text-brand-700 dark:text-brand-300" : "pr-3 text-warning-strong"}>
                        {analise?.custeio_disponivel ? "Disponível" : "Pendente"}
                      </td>
                      <td className={statusInsumos === "Mapeados" ? "pr-3 text-brand-700 dark:text-brand-300" : "pr-3 text-warning-strong"}>{statusInsumos}</td>
                      <td className="text-right space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setSeletorAberto(item.grupoKey);
                            document.getElementById(`grupo-card-${item.grupoKey}`)?.scrollIntoView({ behavior: "smooth" });
                          }}
                          className="text-muted-foreground hover:text-foreground"
                          title="Editar análises do grupo"
                          aria-label={`Editar análises do ${grupo?.identificacao ?? "grupo"}`}
                        >
                          <Pencil aria-hidden className="h-4 w-4 inline" />
                        </button>
                        <button type="button" onClick={() => toggleAnalise(item.grupoKey, item.codigo)} className="text-danger-strong hover:text-danger-strong" title="Remover análise" aria-label={`Remover análise ${item.codigo}`}>
                          <Trash2 aria-hidden className="h-4 w-4 inline" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {selecionadas.length === 0 && (
                  <tr><td colSpan={10} className="py-4 text-xs text-muted-foreground/80">Nenhuma análise selecionada.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {previsoesOperacionais.length > 0 && (
            <div className="mt-3 rounded-md border border-border bg-muted/50 p-3">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Previsão operacional calculada</h4>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {previsoesOperacionais.map((previsao) => (
                  <div key={previsao.key} className="rounded-md border border-border bg-card p-2 text-xs">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-semibold">{grupos.find((grupo) => grupo.key === previsao.grupoKey)?.identificacao ?? "Grupo"} · {previsao.codigo}</span>
                      <span className="text-muted-foreground">{previsao.quantidade} amostra(s) · {previsao.lotes} lote(s) de {previsao.lotePadrao}</span>
                    </div>
                    <ul className="mt-2 space-y-1 text-muted-foreground">
                      {previsao.reagentes.length > 0 ? previsao.reagentes.slice(0, 4).map((reagente, index) => (
                        <li key={`${previsao.codigo}-${reagente.especificacao}-${index}`}>
                          {reagente.especificacao}: {formatNumber(reagente.consumo)} {reagente.unidade} · {formatCurrency(reagente.custo)} <span className="text-muted-foreground/80">({reagente.modo_cobranca === "por_execucao" ? "por execução" : "por amostra"})</span>
                        </li>
                      )) : <li>Sem reagentes configurados na receita técnica oficial.</li>}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {mostraLaboratorio && exigeAnalises && (
      <section className="rounded-md border border-border p-3">
        <h3 className="text-sm font-semibold">Pendências</h3>
        {pendenciasInsumos.length > 0 ? (
          <ul className="mt-2 space-y-1 text-xs text-warning-strong">
            {[...new Set(pendenciasInsumos.map((item) => `${item.codigo}: ${item.especificacao}`))].map((item) => (
              <li key={item}><Selo texto="Pendente" /> {item}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Sem pendências de cadastro de insumo para as análises carregadas.</p>
        )}
      </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60">
          {pending ? "Salvando…" : demanda.id > 0 ? (modo === "laboratorio" ? "Salvar análises laboratoriais" : "Salvar orçamento") : "Criar orçamento"}
        </button>
        {state.errors?.descricao ? <a href="#descricao" className="text-sm font-medium text-danger-strong">Corrigir descrição</a> : null}
      </div>

      <Dialog open={grupoParaRemover !== null} onOpenChange={(aberto) => { if (!aberto) setGrupoParaRemover(null); }}>
        <DialogContent className="max-w-sm text-left" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Remover {grupos.find((g) => g.key === grupoParaRemover)?.identificacao ?? "grupo"}?</DialogTitle>
            <DialogDescription>
              As {selecionadas.filter((item) => item.grupoKey === grupoParaRemover).length} análise(s) deste grupo também saem do orçamento. A remoção só é gravada ao salvar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={() => setGrupoParaRemover(null)} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => grupoParaRemover && removerGrupo(grupoParaRemover)}
              className="rounded-md bg-destructive px-4 py-1.5 text-sm font-medium text-white hover:bg-destructive/90"
            >
              Remover grupo
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

function CamposDemandaLeitura({
  demanda,
  quantidadeAmostras,
  matrizAmostra,
}: {
  demanda: Demanda;
  quantidadeAmostras: number;
  matrizAmostra: string;
}) {
  // Os campos continuam no formulário (ocultos) para o salvamento não apagar
  // nada; na tela, só um resumo legível, sem IDs nem códigos (UI-7).
  const ocultos: Array<[string, string | number | null | undefined]> = [
    ["titulo", demanda.titulo],
    ["cliente_id", demanda.cliente_id],
    ["projeto_id", demanda.projeto_id],
    ["cliente_nome", demanda.cliente_nome],
    ["cliente_cnpj", demanda.cliente_cnpj],
    ["cliente_contato", demanda.cliente_contato],
    ["instituicao", demanda.instituicao],
    ["responsavel_interno", demanda.responsavel_interno],
    ["origem", demanda.origem],
    ["data_solicitacao", demanda.data_solicitacao],
    ["prazo_esperado", demanda.prazo_esperado],
    ["modalidade", demanda.modalidade ?? "analises"],
    ["prioridade", demanda.prioridade ?? "normal"],
    ["matriz_amostra", matrizAmostra],
    ["quantidade_amostras_estimada", quantidadeAmostras],
    ["prazo_tecnico_dias", demanda.prazo_tecnico_dias],
    ["descricao", demanda.descricao],
    ["escopo_preliminar", demanda.escopo_preliminar],
    ["observacoes", demanda.observacoes],
  ];
  return (
    <section className="rounded-md border border-border bg-muted/50 p-3">
      {ocultos.map(([name, valor]) => (
        <input key={name} type="hidden" name={name} value={valor == null ? "" : String(valor)} />
      ))}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-sm font-semibold">Dados do orçamento</h3>
        <Selo texto="Para alterar, volte à etapa Dados" />
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <ResumoLeitura rotulo="Título" valor={demanda.titulo} largo />
        <ResumoLeitura rotulo="Cliente" valor={demanda.cliente_nome} />
        <ResumoLeitura rotulo="Contato" valor={demanda.cliente_contato} />
        <ResumoLeitura rotulo="Instituição emissora" valor={demanda.instituicao} />
        <ResumoLeitura rotulo="Responsável interno" valor={demanda.responsavel_interno} />
        <ResumoLeitura rotulo="Prazo esperado" valor={formatarData(demanda.prazo_esperado)} />
        <ResumoLeitura rotulo="Amostras" valor={quantidadeAmostras ? `${quantidadeAmostras} · ${matrizAmostra || "matriz não informada"}` : null} />
        <ResumoLeitura rotulo="Descrição" valor={demanda.descricao || demanda.escopo_preliminar} largo />
      </dl>
    </section>
  );
}

function formatarData(valor: string | null | undefined) {
  if (!valor) return null;
  const [ano, mes, dia] = valor.slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : valor;
}

function ResumoLeitura({ rotulo, valor, largo = false }: { rotulo: string; valor: string | number | null | undefined; largo?: boolean }) {
  return (
    <div className={largo ? "sm:col-span-2" : ""}>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap font-medium">{valor == null || valor === "" ? "—" : valor}</dd>
    </div>
  );
}


function Obrigatorio() {
  return <span className="text-[10px] font-semibold uppercase tracking-wide text-danger-strong">Obrigatório</span>;
}

function Selo({ texto }: { texto: string }) {
  return <span className="rounded border border-input px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{texto}</span>;
}

// "" mantém o campo vazio durante a edição; valores válidos viram inteiros >= 1.
function lerQuantidade(valor: string): number | "" {
  if (valor.trim() === "") return "";
  const n = Math.floor(Number(valor));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function formatNumber(valor: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(valor);
}

function Legenda({ texto, classe }: { texto: string; classe: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-3 w-3 rounded border ${classe}`} />
      {texto}
    </span>
  );
}

function ResumoLaboratorio({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{valor}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detalhe}</p>
    </div>
  );
}
