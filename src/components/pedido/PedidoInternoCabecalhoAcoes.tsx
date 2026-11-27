"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

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
import { atualizarPedidoInterno } from "@/lib/actions/pedidos-internos";
import { NATUREZAS_PEDIDO, OBJETIVOS_PEDIDO } from "@/lib/pedido/natureza";
import { FormComMensagem } from "./FormComMensagem";
import { ApagarPedido } from "./ApagarPedido";

type Opcao = {
  id: number;
  nome: string | null;
  coordenador?: string | null;
  coordenador_nome?: string | null;
  coordenador_email?: string | null;
};

const URGENCIA_ROTULO: Record<string, string> = { baixa: "Baixa", normal: "Normal", alta: "Alta", critica: "Crítica" };

const inputCls =
  "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm";

export function PedidoInternoCabecalhoAcoes({
  pedidoId,
  numero,
  titulo,
  projetoId,
  dataNecessidade,
  urgencia,
  tipoDemanda,
  natureza = null,
  objetivo = null,
  areaId = null,
  areas = [],
  justificativa,
  projetos,
  status,
  podeExcluir,
}: {
  pedidoId: number;
  numero: string;
  titulo: string;
  projetoId: number | null;
  dataNecessidade: string | null;
  /** só para mostrar: quem define é quem tem "Definir urgência do pedido" (0183) */
  urgencia: string | null;
  tipoDemanda: string | null;
  natureza?: string | null;
  objetivo?: string | null;
  /** 0169: laboratório ou área (obrigatório para material de consumo de laboratório) */
  areaId?: number | null;
  areas?: { id: number; nome: string; coordenador_nome?: string | null }[];
  justificativa: string | null;
  projetos: Opcao[];
  status: string;
  podeExcluir: boolean;
}) {
  const [editando, setEditando] = useState(false);
  return (
    <div className="flex items-center gap-2">
      {/* Editar */}
      <Dialog open={editando} onOpenChange={setEditando}>
        <DialogTrigger asChild>
          <button className="toque inline-flex items-center gap-1 rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Editar pedido {numero}</DialogTitle>
            <DialogDescription>Atualize os dados do pedido.</DialogDescription>
          </DialogHeader>
          <FormComMensagem action={atualizarPedidoInterno} onSuccess={() => setEditando(false)} className="grid gap-3">
            <input type="hidden" name="pedido_interno_id" value={pedidoId} />
            <div>
              <label htmlFor="atualizarPedidoInterno-titulo" className="block text-xs font-medium text-muted-foreground">Título do pedido</label>
              <input id="atualizarPedidoInterno-titulo" name="titulo" required defaultValue={titulo} className={inputCls} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="atualizarPedidoInterno-projeto_id" className="block text-xs font-medium text-muted-foreground">Projeto</label>
                <select id="atualizarPedidoInterno-projeto_id" name="projeto_id" defaultValue={projetoId ?? ""} className={inputCls}>
                  <option value="">Sem projeto (a Supervisão aprova)</option>
                  {projetos.map((projeto) => (
                    <option key={projeto.id} value={projeto.id}>
                      {projeto.nome}
                      {projeto.coordenador_nome || projeto.coordenador ? ` · ${projeto.coordenador_nome ?? projeto.coordenador}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="atualizarPedidoInterno-data_necessidade" className="block text-xs font-medium text-muted-foreground">Necessidade</label>
                <input id="atualizarPedidoInterno-data_necessidade" name="data_necessidade" type="date" defaultValue={dataNecessidade ?? ""} className={inputCls} />
              </div>
              <div className="sm:col-span-2" data-testid="urgencia-fixa">
                {/* 0183: quem pede não define a urgência; ela fura o ciclo do dia 10 */}
                <p className="text-xs text-muted-foreground">
                  Urgência: {URGENCIA_ROTULO[urgencia ?? "normal"] ?? urgencia}. Quem define é o administrativo, pelo botão
                  “Definir urgência” do pedido.
                </p>
              </div>
              <div>
                <label htmlFor="atualizarPedidoInterno-tipo_demanda" className="block text-xs font-medium text-muted-foreground">Onde será usado</label>
                <select id="atualizarPedidoInterno-tipo_demanda" name="tipo_demanda" defaultValue={tipoDemanda ?? "laboratorio"} className={inputCls}>
                  <option value="laboratorio">Laboratório</option>
                  <option value="campo">Campo</option>
                  <option value="laboratorio_campo">Lab./campo</option>
                  <option value="administrativo">Administrativo</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`editar-pedido-natureza-${pedidoId}`} className="block text-xs font-medium text-muted-foreground">Tipo de material ou despesa</label>
                <select id={`editar-pedido-natureza-${pedidoId}`} name="natureza" defaultValue={natureza ?? ""} className={inputCls}>
                  <option value="">Escolha…</option>
                  {NATUREZAS_PEDIDO.map((n) => (
                    <option key={n.valor} value={n.valor}>{n.rotulo}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`editar-pedido-objetivo-${pedidoId}`} className="block text-xs font-medium text-muted-foreground">Objetivo</label>
                <select id={`editar-pedido-objetivo-${pedidoId}`} name="objetivo" defaultValue={objetivo ?? ""} className={inputCls}>
                  <option value="">Escolha…</option>
                  {OBJETIVOS_PEDIDO.map((o) => (
                    <option key={o.valor} value={o.valor}>{o.rotulo}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor={`editar-pedido-area-${pedidoId}`} className="block text-xs font-medium text-muted-foreground">
                  Laboratório ou área (obrigatório para material de consumo de laboratório)
                </label>
                <select id={`editar-pedido-area-${pedidoId}`} name="area_id" defaultValue={areaId ?? ""} className={inputCls}>
                  <option value="">—</option>
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.nome}
                      {area.coordenador_nome ? ` · ${area.coordenador_nome}` : " · sem coordenação"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="atualizarPedidoInterno-justificativa" className="block text-xs font-medium text-muted-foreground">Justificativa</label>
              <textarea id="atualizarPedidoInterno-justificativa" name="justificativa" rows={3} defaultValue={justificativa ?? ""} className={inputCls} />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <button type="button" className="rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
                  Cancelar
                </button>
              </DialogClose>
              <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500">
                Salvar alterações
              </button>
            </DialogFooter>
          </FormComMensagem>
        </DialogContent>
      </Dialog>

      {/* Apagar: qualquer etapa (Antonio, 27/11/2026); o banco só recusa material já recebido (0186) */}
      {podeExcluir && (
        <ApagarPedido pedidoId={pedidoId} numero={numero} titulo={titulo} status={status} className="px-3 py-1.5" />
      )}
    </div>
  );
}
