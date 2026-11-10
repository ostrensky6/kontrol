"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { criarPedidoInterno } from "@/lib/actions/pedidos-internos";
import { NATUREZAS_PEDIDO, OBJETIVOS_PEDIDO } from "@/lib/pedido/natureza";
import { dataEmBrasilia, ehUrgente, explicarCicloHoje } from "@/lib/pedido/ciclo";
import { FormComMensagem } from "./FormComMensagem";

type ProjetoOption = {
  id: number;
  nome: string;
  coordenador?: string | null;
  coordenador_nome?: string | null;
  coordenador_email?: string | null;
};

export type AreaOption = { id: number; nome: string; coordenador_nome?: string | null };

const inputCls = "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm";

export function NovoPedidoDialog({
  projetos,
  areas = [],
  abrirAoCarregar = false,
}: {
  projetos: ProjetoOption[];
  areas?: AreaOption[];
  /** abre o formulário ao chegar pelo botão "Novo pedido" da visão geral (/pedido?novo=1) */
  abrirAoCarregar?: boolean;
}) {
  const [natureza, setNatureza] = useState("");
  const [urgencia, setUrgencia] = useState("normal");
  const urgente = ehUrgente(urgencia);
  const exigeLaboratorio = natureza === "material_consumo_lab";
  return (
    <Dialog defaultOpen={abrirAoCarregar}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Novo pedido
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo pedido</DialogTitle>
          <DialogDescription>
            Registre o pedido do laboratório ou do campo. Os itens entram depois, no rascunho.
          </DialogDescription>
        </DialogHeader>
        <FormComMensagem action={criarPedidoInterno} className="grid gap-5">
          <section className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-12">
            <div className="md:col-span-12">
              <h3 className="text-sm font-semibold">Identificação do pedido</h3>
            </div>
            <div className="md:col-span-6">
              <label htmlFor="novo-pedido-titulo" className="block text-xs font-medium text-muted-foreground">Título do pedido</label>
              <input
                id="novo-pedido-titulo"
                name="titulo"
                required
                placeholder="Ex.: Reagentes para sequenciamento de junho"
                className={inputCls}
              />
            </div>
            <div className="md:col-span-6">
              <label htmlFor="novo-pedido-projeto" className="block text-xs font-medium text-muted-foreground">Projeto</label>
              <select
                id="novo-pedido-projeto"
                name="projeto_id"
                defaultValue=""
                aria-describedby="novo-pedido-projeto-ajuda"
                className={inputCls}
              >
                <option value="">Sem projeto (a Supervisão valida)</option>
                {projetos.map((projeto) => (
                  <option key={projeto.id} value={projeto.id}>
                    {projeto.nome}
                    {projeto.coordenador_nome || projeto.coordenador
                      ? ` · ${projeto.coordenador_nome ?? projeto.coordenador}`
                      : ""}
                  </option>
                ))}
              </select>
              <p id="novo-pedido-projeto-ajuda" className="mt-1 text-xs text-muted-foreground">
                O coordenador do projeto valida o pedido. Sem coordenador cadastrado, o envio trava.
              </p>
            </div>
            <div className="md:col-span-4">
              <label htmlFor="novo-pedido-natureza" className="block text-xs font-medium text-muted-foreground">Tipo de material ou despesa</label>
              <select
                id="novo-pedido-natureza"
                name="natureza"
                required
                value={natureza}
                onChange={(e) => setNatureza(e.target.value)}
                className={inputCls}
              >
                <option value="" disabled>Escolha…</option>
                {NATUREZAS_PEDIDO.map((n) => (
                  <option key={n.valor} value={n.valor}>{n.rotulo}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-4">
              <label htmlFor="novo-pedido-objetivo" className="block text-xs font-medium text-muted-foreground">Objetivo</label>
              <select id="novo-pedido-objetivo" name="objetivo" required defaultValue="" className={inputCls}>
                <option value="" disabled>Escolha…</option>
                {OBJETIVOS_PEDIDO.map((o) => (
                  <option key={o.valor} value={o.valor}>{o.rotulo}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-4">
              <label htmlFor="novo-pedido-area" className="block text-xs font-medium text-muted-foreground">
                Laboratório ou área{exigeLaboratorio ? " (obrigatório)" : ""}
              </label>
              <select
                id="novo-pedido-area"
                name="area_id"
                required={exigeLaboratorio}
                defaultValue=""
                aria-describedby="novo-pedido-area-ajuda"
                className={inputCls}
              >
                <option value="">{exigeLaboratorio ? "Escolha…" : "—"}</option>
                {areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.nome}
                    {area.coordenador_nome ? ` · ${area.coordenador_nome}` : " · sem coordenação"}
                  </option>
                ))}
              </select>
            </div>
            {exigeLaboratorio && (
              <p id="novo-pedido-area-ajuda" className="text-xs text-muted-foreground md:col-span-12">
                Material de consumo de laboratório passa também pela coordenação do laboratório, depois do coordenador do projeto.
              </p>
            )}
            <div className="md:col-span-4">
              <label htmlFor="novo-pedido-tipo" className="block text-xs font-medium text-muted-foreground">Onde será usado</label>
              <select id="novo-pedido-tipo" name="tipo_demanda" defaultValue="laboratorio" className={inputCls}>
                <option value="laboratorio">Laboratório</option>
                <option value="campo">Campo</option>
                <option value="laboratorio_campo">Lab./campo</option>
                <option value="administrativo">Administrativo</option>
                <option value="outro">Outro</option>
              </select>
            </div>
            <div className="md:col-span-4">
              <label htmlFor="novo-pedido-data" className="block text-xs font-medium text-muted-foreground">Necessidade</label>
              <input id="novo-pedido-data" name="data_necessidade" type="date" className={inputCls} />
            </div>
            <div className="md:col-span-4">
              <label htmlFor="novo-pedido-urgencia" className="block text-xs font-medium text-muted-foreground">Urgência</label>
              <select
                id="novo-pedido-urgencia"
                name="urgencia"
                value={urgencia}
                onChange={(e) => setUrgencia(e.target.value)}
                className={inputCls}
              >
                <option value="baixa">Baixa</option>
                <option value="normal">Normal</option>
                <option value="alta">Alta (fura o ciclo)</option>
                <option value="critica">Crítica (fura o ciclo)</option>
              </select>
            </div>
            <p className="text-xs text-muted-foreground md:col-span-12" data-testid="ciclo-pedido">
              {explicarCicloHoje(dataEmBrasilia(new Date()), urgente)}
            </p>
            {urgente && (
              <div className="md:col-span-12">
                <label htmlFor="novo-pedido-urgencia-justificativa" className="block text-xs font-medium text-muted-foreground">
                  Por que é urgente? (obrigatório)
                </label>
                <textarea
                  id="novo-pedido-urgencia-justificativa"
                  name="urgencia_justificativa"
                  required
                  minLength={15}
                  maxLength={1000}
                  rows={2}
                  placeholder="Ex.: amostras chegam dia 15 e o reagente acabou"
                  className={`${inputCls} h-auto py-2`}
                />
              </div>
            )}
          </section>

          <section className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <h3 className="text-sm font-semibold">Justificativa</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Fonte e rubrica são definidas pelo administrativo.
              </p>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="novo-pedido-justificativa" className="block text-xs font-medium text-muted-foreground">Justificativa técnica</label>
              <textarea
                id="novo-pedido-justificativa"
                name="justificativa"
                rows={3}
                placeholder="Experimentos, análises ou problema que originou a compra. Em projeto, ligue aos objetivos dele."
                className={inputCls}
              />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="novo-pedido-fonte" className="block text-xs font-medium text-muted-foreground">Fonte sugerida (opcional)</label>
              <input id="novo-pedido-fonte" name="fonte_recurso" placeholder="Se souber: projeto, convênio, recurso interno..." className={inputCls} />
            </div>
          </section>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit">Criar rascunho</Button>
          </DialogFooter>
        </FormComMensagem>
      </DialogContent>
    </Dialog>
  );
}
