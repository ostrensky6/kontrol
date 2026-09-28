"use client";

import { useId, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { formatCurrency as brl, formatDate } from "@/lib/formatters";
import { MESES_VALOR_VELHO, origemDoValor, valorDesatualizado } from "@/lib/orcamento/catalogo-custos";
import { VALOR_MASCARADO } from "@/lib/cadastros/mascara";
import { FormAcao, type AcaoFormulario } from "./FormAcao";

export type ItemCatalogo = {
  id: string;
  descricao: string;
  unidade: string | null;
  preco_unitario: number;
  /** Preço de pessoal oculto por falta da permissão "Ver salário dos técnicos". */
  preco_mascarado?: boolean;
  categoria: string | null;
  /** Quando e de onde veio o valor atual (catálogo vivo, 0137). */
  valor_atualizado_em?: string | null;
  valor_atualizado_por?: string | null;
  valor_origem_demanda_titulo?: string | null;
  origem?: string | null;
};

const MAX_SUGESTOES = 8;

function normalizar(texto: string) {
  return texto.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

const campo =
  "mt-0.5 h-8 w-full rounded-md border border-input bg-card px-2.5 text-sm font-medium text-brand-700 dark:text-brand-300";
const rotulo = "block text-xs font-medium text-muted-foreground";

function Adicionar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-8 rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Adicionando…" : "Adicionar"}
    </button>
  );
}

/**
 * Campo único para lançar um item (Fase C): digitar a descrição busca no catálogo da rubrica;
 * escolher um item preenche descrição, unidade e valor (editável só para este orçamento).
 * Sem escolher, é item novo: entra no catálogo ao concluir a revisão.
 */
export function AdicionarItemProjeto({
  rubrica,
  itens,
  orcamentoProjetoId,
  demandaId,
  action,
}: {
  rubrica: string;
  itens: ItemCatalogo[];
  orcamentoProjetoId: number;
  demandaId: number;
  action: AcaoFormulario;
}) {
  const id = useId();
  const pessoal = rubrica === "PE";
  const [descricao, setDescricao] = useState("");
  const [unidade, setUnidade] = useState(pessoal ? "mês" : "");
  const [valor, setValor] = useState("");
  const [escolhido, setEscolhido] = useState<ItemCatalogo | null>(null);
  const [aberto, setAberto] = useState(false);
  const [destaque, setDestaque] = useState(0);

  const sugestoes = useMemo(() => {
    const termo = normalizar(descricao);
    const lista = termo
      ? itens.filter((item) => normalizar(`${item.descricao} ${item.categoria ?? ""}`).includes(termo))
      : itens;
    return lista.slice(0, MAX_SUGESTOES);
  }, [descricao, itens]);

  // Mesmo item (descrição + unidade) já no catálogo, mas não escolhido na lista.
  const igualNoCatalogo = useMemo(() => {
    if (escolhido || !descricao.trim()) return null;
    const d = normalizar(descricao);
    const u = normalizar(unidade || "un");
    return itens.find((item) => normalizar(item.descricao) === d && normalizar(item.unidade || "un") === u) ?? null;
  }, [escolhido, descricao, unidade, itens]);

  function escolher(item: ItemCatalogo) {
    if (item.preco_mascarado) return;
    setEscolhido(item);
    setDescricao(item.descricao);
    setUnidade(item.unidade ?? "");
    setValor(String(item.preco_unitario));
    setAberto(false);
  }

  function limpar() {
    setDescricao("");
    setUnidade(pessoal ? "mês" : "");
    setValor("");
    setEscolhido(null);
  }

  const listaId = `${id}-sugestoes`;
  const mostrarLista = aberto && sugestoes.length > 0;

  return (
    <FormAcao
      action={action}
      sucesso="Item adicionado."
      aoConcluir={limpar}
      aria-label={`Adicionar item em ${rubrica}`}
      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_7rem_6rem_8rem_auto] lg:items-end"
    >
      <input type="hidden" name="orcamento_projeto_id" value={orcamentoProjetoId} />
      <input type="hidden" name="demanda_id" value={demandaId} />
      <input type="hidden" name="rubrica" value={rubrica} />
      <input type="hidden" name="catalogo_item_id" value={escolhido?.id ?? ""} />
      <div className="relative">
        <label htmlFor={`${id}-descricao`} className={rotulo}>
          {pessoal ? "Profissional / função" : "Descrição"} <span className="text-danger-strong">*</span>
        </label>
        <input
          id={`${id}-descricao`}
          name="descricao"
          required
          autoComplete="off"
          role="combobox"
          aria-expanded={mostrarLista}
          aria-controls={listaId}
          aria-autocomplete="list"
          placeholder="Digite para buscar no catálogo"
          value={descricao}
          onChange={(evento) => {
            const texto = evento.target.value;
            setDescricao(texto);
            setAberto(true);
            setDestaque(0);
            if (escolhido && texto !== escolhido.descricao) setEscolhido(null);
          }}
          onFocus={() => setAberto(true)}
          onBlur={() => setAberto(false)}
          onKeyDown={(evento) => {
            if (!mostrarLista) return;
            if (evento.key === "ArrowDown") {
              evento.preventDefault();
              setDestaque((atual) => Math.min(atual + 1, sugestoes.length - 1));
            } else if (evento.key === "ArrowUp") {
              evento.preventDefault();
              setDestaque((atual) => Math.max(atual - 1, 0));
            } else if (evento.key === "Enter") {
              evento.preventDefault();
              escolher(sugestoes[destaque]);
            } else if (evento.key === "Escape") {
              setAberto(false);
            }
          }}
          className={campo}
        />
        {mostrarLista && (
          <ul
            id={listaId}
            role="listbox"
            aria-label="Itens do catálogo"
            className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-card py-1 text-sm shadow-lg"
          >
            {sugestoes.map((item, indice) => (
              <li
                key={item.id}
                role="option"
                aria-selected={indice === destaque}
                aria-disabled={item.preco_mascarado || undefined}
                onMouseDown={(evento) => {
                  evento.preventDefault();
                  escolher(item);
                }}
                onMouseEnter={() => setDestaque(indice)}
                className={`flex cursor-pointer items-baseline justify-between gap-3 px-2.5 py-1 ${
                  indice === destaque ? "bg-muted" : ""
                } ${item.preco_mascarado ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <span className="min-w-0 truncate">
                  {item.descricao}
                  <span className="ml-1 text-xs text-muted-foreground">({item.unidade ?? "un"})</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {item.preco_mascarado ? VALOR_MASCARADO : brl(item.preco_unitario)}
                  {!item.preco_mascarado && valorDesatualizado(item.valor_atualizado_em) && (
                    <span className="ml-1 rounded-full bg-warning-soft px-1 text-[10px] font-semibold text-warning-strong">
                      +{MESES_VALOR_VELHO}m
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <label htmlFor={`${id}-unidade`} className={rotulo}>Unidade</label>
        <input
          id={`${id}-unidade`}
          name="unidade"
          value={unidade}
          onChange={(evento) => {
            setUnidade(evento.target.value);
            if (escolhido && normalizar(evento.target.value) !== normalizar(escolhido.unidade ?? "")) setEscolhido(null);
          }}
          className={campo}
        />
      </div>
      {pessoal ? (
        <input type="hidden" name="quantidade" value="1" />
      ) : (
        <div>
          <label htmlFor={`${id}-quantidade`} className={rotulo}>Quantidade</label>
          <input id={`${id}-quantidade`} name="quantidade" type="number" min="0.01" step="0.01" defaultValue="1" required className={campo} />
        </div>
      )}
      <div>
        <label htmlFor={`${id}-valor`} className={rotulo}>
          {pessoal ? "Valor mensal (R$)" : "Valor unitário (R$)"} <span className="text-danger-strong">*</span>
        </label>
        <input
          id={`${id}-valor`}
          name="custo_unitario"
          type="number"
          min="0"
          step="0.01"
          required
          value={valor}
          onChange={(evento) => setValor(evento.target.value)}
          className={campo}
        />
      </div>
      <Adicionar />
      <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5" aria-live="polite">
        {escolhido ? (
          <>
            Do catálogo ({escolhido.id}): {brl(escolhido.preco_unitario)}
            {escolhido.valor_atualizado_em && <> de {formatDate(escolhido.valor_atualizado_em)}, {origemDoValor(escolhido)}</>}.
            {Number(valor) !== escolhido.preco_unitario && valor !== "" && (
              <span className="ml-1 font-medium text-foreground">
                Valor alterado: vale para este orçamento e, ao concluir a revisão, atualiza o catálogo.
              </span>
            )}
            {valorDesatualizado(escolhido.valor_atualizado_em) && (
              <span className="ml-1 font-medium text-warning-strong">
                Valor de mais de {MESES_VALOR_VELHO} meses: confira.
              </span>
            )}
          </>
        ) : igualNoCatalogo ? (
          <span className="text-warning-strong">
            Já existe no catálogo: {igualNoCatalogo.descricao} ({igualNoCatalogo.unidade ?? "un"}). Escolha na lista para usar o
            valor de referência.
          </span>
        ) : descricao.trim() ? (
          "Item novo: entra no catálogo ao concluir a revisão."
        ) : (
          `${itens.length} ${itens.length === 1 ? "item" : "itens"} no catálogo desta rubrica. Digite para buscar ou lance um item novo.`
        )}
      </p>
      <details className="sm:col-span-2 lg:col-span-5">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Etapa, atividade e entrega (opcional)</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {(["etapa", "atividade", "entrega"] as const).map((nome) => (
            <div key={nome}>
              <label htmlFor={`${id}-${nome}`} className={rotulo}>
                {nome === "etapa" ? "Etapa" : nome === "atividade" ? "Atividade" : "Entrega"}
              </label>
              <input id={`${id}-${nome}`} name={nome} className={campo} />
            </div>
          ))}
        </div>
      </details>
    </FormAcao>
  );
}
