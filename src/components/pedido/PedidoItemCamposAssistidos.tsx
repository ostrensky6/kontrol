"use client";

import { useMemo, useState } from "react";

export type PedidoItemCatalogo = {
  id: number;
  especificacao: string | null;
  nomeItem?: string | null;
  categoriaCompra?: string | null;
  tipoInsumo?: string | null;
  unidade: string | null;
  custoUnitario?: number | null;
  /** Insumo contado em frascos fechados (0123): item em frascos, preço por frasco. */
  emFrascos?: boolean;
  conteudoEmbalagem?: number | null;
  custoEmbalagem?: number | null;
  unidades?: string[];
  modelos?: string[];
  volumes?: string[];
  fornecedores?: string[];
};

export type PedidoItemDefaults = {
  tipo?: string | null;
  insumoId?: number | null;
  especificacao?: string | null;
  modelo?: string | null;
  volume?: string | null;
  quantidade?: number | string | null;
  unidade?: string | null;
  orcamentoPrevio?: number | string | null;
  fornecedorSugerido?: string | null;
  observacao?: string | null;
};

const inputCls = "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm";
const unidadesVendaveisPadrao = [
  "un",
  "unidade",
  "frasco",
  "kit",
  "caixa",
  "pacote",
  "embalagem",
  "tubo",
  "placa",
  "cartucho",
  "L",
  "mL",
  "uL",
  "g",
  "kg",
  "mg",
  "ug",
  "ng",
  "reacoes",
  "testes",
  "metro",
  "cm",
  "par",
];

function uniq(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

export function PedidoItemCamposAssistidos({
  catalogo,
  fornecedores = [],
  unidadesPadrao = unidadesVendaveisPadrao,
  defaults = {},
  layout = "page",
  idPrefix = layout,
}: {
  catalogo: PedidoItemCatalogo[];
  fornecedores?: string[];
  unidadesPadrao?: string[];
  defaults?: PedidoItemDefaults;
  layout?: "page" | "dialog";
  idPrefix?: string;
}) {
  const [insumoId, setInsumoId] = useState(defaults.insumoId ? String(defaults.insumoId) : "");
  const [insumoBusca, setInsumoBusca] = useState(() => {
    const inicial = catalogo.find((item) => item.id === defaults.insumoId);
    return inicial ? rotuloInsumo(inicial) : "";
  });
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [especificacao, setEspecificacao] = useState(defaults.especificacao ?? "");
  const [unidade, setUnidade] = useState(defaults.unidade ?? "");
  const [modelo, setModelo] = useState(defaults.modelo ?? "");
  const [volume, setVolume] = useState(defaults.volume ?? "");
  const [fornecedor, setFornecedor] = useState(defaults.fornecedorSugerido ?? "");
  const [orcamento, setOrcamento] = useState(defaults.orcamentoPrevio ?? "");

  const selecionado = useMemo(
    () => catalogo.find((item) => String(item.id) === insumoId) ?? null,
    [catalogo, insumoId],
  );
  const categorias = useMemo(
    () => uniq(catalogo.map((item) => item.tipoInsumo ?? item.nomeItem ?? item.categoriaCompra)),
    [catalogo],
  );
  const catalogoFiltrado = useMemo(
    () =>
      categoriaFiltro
        ? catalogo.filter((item) => [item.tipoInsumo, item.nomeItem, item.categoriaCompra].includes(categoriaFiltro))
        : catalogo,
    [catalogo, categoriaFiltro],
  );
  const unidadeOptions = uniq([selecionado?.unidade, ...(selecionado?.unidades ?? []), unidade, ...unidadesPadrao]);
  const modeloOptions = uniq([...(selecionado?.modelos ?? []), modelo]);
  const volumeOptions = uniq([...(selecionado?.volumes ?? []), volume]);
  const fornecedorOptions = uniq([...(selecionado?.fornecedores ?? []), fornecedor, ...fornecedores]);

  const ids = {
    tipo: `pedido-item-tipo-${idPrefix}`,
    categoria: `pedido-item-categoria-${idPrefix}`,
    insumoBusca: `pedido-item-insumo-busca-${idPrefix}`,
    insumoSelecao: `pedido-item-insumo-selecao-${idPrefix}`,
    especificacao: `pedido-item-especificacao-${idPrefix}`,
    quantidade: `pedido-item-quantidade-${idPrefix}`,
    unidade: `pedido-item-unidade-${idPrefix}`,
    modelo: `pedido-item-modelo-${idPrefix}`,
    volume: `pedido-item-volume-${idPrefix}`,
    fornecedor: `pedido-item-fornecedor-${idPrefix}`,
    orcamento: `pedido-item-orcamento-${idPrefix}`,
    observacao: `pedido-item-observacao-${idPrefix}`,
    insumos: `pedido-item-insumos-${idPrefix}`,
    unidades: `pedido-item-unidades-${idPrefix}`,
    modelos: `pedido-item-modelos-${idPrefix}`,
    volumes: `pedido-item-volumes-${idPrefix}`,
    fornecedores: `pedido-item-fornecedores-${idPrefix}`,
  };

  const span = {
    tipo: layout === "page" ? "md:col-span-2 xl:col-span-1" : "",
    categoria: layout === "page" ? "md:col-span-3 xl:col-span-2" : "",
    especificacao: layout === "page" ? "md:col-span-6 xl:col-span-4" : "sm:col-span-2",
    quantidade: layout === "page" ? "md:col-span-2" : "",
    unidade: layout === "page" ? "md:col-span-2 xl:col-span-1" : "",
    modelo: layout === "page" ? "md:col-span-3 xl:col-span-2" : "",
    volume: layout === "page" ? "md:col-span-3 xl:col-span-2" : "",
    insumo: layout === "page" ? "md:col-span-4 xl:col-span-3" : "",
    fornecedor: layout === "page" ? "md:col-span-4 xl:col-span-3" : "",
    orcamento: layout === "page" ? "md:col-span-2" : "",
    observacao: layout === "page" ? "md:col-span-8 xl:col-span-5" : "sm:col-span-2",
  };

  function preencherInsumo(insumo: PedidoItemCatalogo) {
    setInsumoId(String(insumo.id));
    setInsumoBusca(rotuloInsumo(insumo));
    setEspecificacao(insumo.especificacao ?? insumo.nomeItem ?? "");
    setModelo(insumo.modelos?.[0] ?? "");
    setFornecedor(insumo.fornecedores?.[0] ?? "");
    if (insumo.emFrascos) {
      // O banco grava o item em frascos; quantidade e preço seguem o frasco.
      setUnidade("frasco");
      setVolume(`${insumo.conteudoEmbalagem} ${insumo.unidade}`);
      setOrcamento(insumo.custoEmbalagem ?? "");
      return;
    }
    setUnidade(insumo.unidade ?? insumo.unidades?.[0] ?? "");
    setVolume(insumo.volumes?.[0] ?? "");
    setOrcamento(insumo.custoUnitario ?? "");
  }

  function selecionarInsumo(value: string) {
    setInsumoId(value);
    const insumo = catalogo.find((item) => String(item.id) === value);
    if (insumo) preencherInsumo(insumo);
  }

  function buscarInsumo(value: string) {
    setInsumoBusca(value);
    const normalizado = value.trim().toLowerCase();
    const insumo =
      catalogo.find((item) => rotuloInsumo(item).toLowerCase() === normalizado) ??
      catalogo.find((item) => (item.especificacao ?? item.nomeItem ?? "").trim().toLowerCase() === normalizado);
    if (insumo) {
      preencherInsumo(insumo);
      return;
    }
    setInsumoId("");
    if (!especificacao && value.trim()) setEspecificacao(value.trim());
  }

  return (
    <>
      <div className={span.tipo}>
        <label htmlFor={ids.tipo} className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Tipo</label>
        <select id={ids.tipo} name="tipo" defaultValue={defaults.tipo ?? "material"} className={`${inputCls} mt-1 w-full`}>
          <option value="material">Material</option>
          <option value="servico">Serviço</option>
          <option value="equipamento">Equipamento</option>
        </select>
      </div>
      <input type="hidden" name="insumo_id" value={insumoId} />
      <div className={span.categoria}>
        <label htmlFor={ids.categoria} className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Filtro</label>
        <select id={ids.categoria} value={categoriaFiltro} onChange={(event) => setCategoriaFiltro(event.target.value)} className={inputCls}>
          <option value="">Todas as categorias</option>
          {categorias.map((categoria) => (
            <option key={categoria} value={categoria}>
              {categoria}
            </option>
          ))}
        </select>
      </div>
      <div className={span.insumo}>
        <label htmlFor={ids.insumoBusca} className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Insumo existente</label>
        <input
          id={ids.insumoBusca}
          list={ids.insumos}
          value={insumoBusca}
          onChange={(event) => buscarInsumo(event.target.value)}
          placeholder="Buscar por produto, especificação, categoria..."
          className={inputCls}
        />
        <datalist id={ids.insumos}>
          {catalogoFiltrado.map((insumo) => (
            <option key={insumo.id} value={rotuloInsumo(insumo)} />
          ))}
        </datalist>
        {catalogo.length > 0 && (
          <select
            id={ids.insumoSelecao}
            aria-label="Selecionar insumo na lista filtrada"
            value={insumoId}
            onChange={(event) => selecionarInsumo(event.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-card px-2 py-1.5 text-xs text-muted-foreground"
          >
            <option value="">Selecionar na lista filtrada</option>
            {catalogoFiltrado.map((insumo) => (
              <option key={insumo.id} value={insumo.id}>
                {insumo.especificacao ?? insumo.nomeItem ?? `Insumo #${insumo.id}`}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className={span.especificacao}>
        <label htmlFor={ids.especificacao} className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Especificação</label>
        <input
          id={ids.especificacao}
          name="especificacao"
          required
          value={especificacao}
          onChange={(event) => setEspecificacao(event.target.value)}
          className={inputCls}
        />
      </div>
      <div className={span.quantidade}>
        <label htmlFor={ids.quantidade} className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Qtd</label>
        <input
          id={ids.quantidade}
          name="quantidade"
          type="number"
          min="0.0001"
          step="any"
          required
          defaultValue={defaults.quantidade ?? 1}
          className={inputCls}
        />
      </div>
      <div className={span.unidade}>
        <label htmlFor={ids.unidade} className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Unidade</label>
        <input
          id={ids.unidade}
          name="unidade"
          list={ids.unidades}
          value={unidade}
          onChange={(event) => setUnidade(event.target.value)}
          className={inputCls}
        />
        <datalist id={ids.unidades}>{unidadeOptions.map((value) => <option key={value} value={value} />)}</datalist>
      </div>
      <div className={span.modelo}>
        <label htmlFor={ids.modelo} className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Marca/modelo</label>
        <input
          id={ids.modelo}
          name="modelo"
          list={ids.modelos}
          value={modelo}
          onChange={(event) => setModelo(event.target.value)}
          className={inputCls}
        />
        <datalist id={ids.modelos}>{modeloOptions.map((value) => <option key={value} value={value} />)}</datalist>
      </div>
      <div className={span.volume}>
        <label htmlFor={ids.volume} className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Volume</label>
        <input
          id={ids.volume}
          name="volume"
          list={ids.volumes}
          value={volume}
          onChange={(event) => setVolume(event.target.value)}
          className={inputCls}
        />
        <datalist id={ids.volumes}>{volumeOptions.map((value) => <option key={value} value={value} />)}</datalist>
      </div>
      <div className={span.fornecedor}>
        <label htmlFor={ids.fornecedor} className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Fornecedor sugerido</label>
        <input
          id={ids.fornecedor}
          name="fornecedor_sugerido"
          list={ids.fornecedores}
          value={fornecedor}
          onChange={(event) => setFornecedor(event.target.value)}
          className={inputCls}
        />
        <datalist id={ids.fornecedores}>{fornecedorOptions.map((value) => <option key={value} value={value} />)}</datalist>
      </div>
      <div className={span.orcamento}>
        <label htmlFor={ids.orcamento} className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Preço estimado (un.)</label>
        <input
          id={ids.orcamento}
          name="orcamento_previo"
          type="number"
          min="0"
          step="0.01"
          value={orcamento}
          onChange={(event) => setOrcamento(event.target.value)}
          className={inputCls}
        />
      </div>
      <div className={span.observacao}>
        <label htmlFor={ids.observacao} className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Observação</label>
        <input id={ids.observacao} name="observacao" defaultValue={defaults.observacao ?? ""} className={inputCls} />
      </div>
    </>
  );
}

function rotuloInsumo(insumo: PedidoItemCatalogo) {
  return uniq([
    insumo.especificacao ?? insumo.nomeItem ?? `Insumo #${insumo.id}`,
    insumo.tipoInsumo,
    insumo.categoriaCompra,
  ]).join(" | ");
}
