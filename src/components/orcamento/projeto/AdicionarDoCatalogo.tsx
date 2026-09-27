"use client";

import { useId, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency as brl } from "@/lib/formatters";
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
};

function normalizar(texto: string) {
  return texto.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function Enviar({ desabilitado }: { desabilitado: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={desabilitado || pending}
      className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Adicionando…" : "Adicionar do catálogo"}
    </button>
  );
}

/** Busca nos itens ativos do catálogo da rubrica e adiciona o escolhido ao orçamento. */
export function AdicionarDoCatalogo({
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
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState("");
  const filtrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (!termo) return itens;
    return itens.filter((item) => normalizar(`${item.descricao} ${item.categoria ?? ""}`).includes(termo));
  }, [busca, itens]);
  const pessoal = rubrica === "PE";
  const escolhaValida = filtrados.some((item) => item.id === selecionado);

  if (itens.length === 0) {
    return <p className="text-xs text-muted-foreground">Não há itens ativos no catálogo para esta rubrica.</p>;
  }

  return (
    <FormAcao
      action={action}
      sucesso="Item do catálogo adicionado."
      aoConcluir={() => setSelecionado("")}
      className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_7rem_auto] md:items-end"
      aria-label={`Adicionar item do catálogo em ${rubrica}`}
    >
      <input type="hidden" name="orcamento_projeto_id" value={orcamentoProjetoId} />
      <input type="hidden" name="demanda_id" value={demandaId} />
      <div>
        <Label htmlFor={`${id}-busca`}>Buscar no catálogo</Label>
        <Input
          id={`${id}-busca`}
          type="search"
          value={busca}
          onChange={(evento) => setBusca(evento.target.value)}
          placeholder="Descrição ou grupo"
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor={`${id}-item`}>Item do catálogo ({filtrados.length})</Label>
        <select
          id={`${id}-item`}
          name="catalogo_item_id"
          required
          value={escolhaValida ? selecionado : ""}
          onChange={(evento) => setSelecionado(evento.target.value)}
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="" disabled>
            {filtrados.length === 0 ? "Nenhum item encontrado" : "Selecione…"}
          </option>
          {filtrados.map((item) => (
            <option key={item.id} value={item.id} disabled={item.preco_mascarado}>
              {item.descricao} ·{" "}
              {item.preco_mascarado
                ? `${VALOR_MASCARADO} (sem permissão para usar)`
                : `${brl(item.preco_unitario)}/${item.unidade ?? "un"}`}
            </option>
          ))}
        </select>
      </div>
      {pessoal ? (
        <input type="hidden" name="quantidade" value="1" />
      ) : (
        <div>
          <Label htmlFor={`${id}-quantidade`}>Quantidade</Label>
          <Input id={`${id}-quantidade`} name="quantidade" type="number" min="0.01" step="0.01" defaultValue="1" required className="mt-1" />
        </div>
      )}
      <Enviar desabilitado={!escolhaValida} />
    </FormAcao>
  );
}
