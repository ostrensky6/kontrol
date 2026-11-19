"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";

import { SubmitButton } from "@/components/common/SubmitButton";
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
import { carregarCatalogoNovoPedido, type CatalogoNovoPedido } from "@/lib/actions/catalogo-pedido";
import { criarPedidoInterno } from "@/lib/actions/pedidos-internos";
import { NATUREZAS_PEDIDO, OBJETIVOS_PEDIDO } from "@/lib/pedido/natureza";
import { dataEmBrasilia, explicarCicloHoje } from "@/lib/pedido/ciclo";
import {
  CAMPOS_ITEM_NOVO_PEDIDO,
  faltaNoItem,
  normalizarItemNovoPedido,
  type CampoItemNovoPedido,
} from "@/lib/pedido/itens-novo-pedido";
import { CampoArquivosAnexo } from "./CampoArquivosAnexo";
import { FormComMensagem } from "./FormComMensagem";
import { NovoPedidoItensLista, type ItemDaLista } from "./NovoPedidoItensLista";
import { PedidoItemCamposAssistidos, type PedidoItemDefaults } from "./PedidoItemCamposAssistidos";

type ProjetoOption = {
  id: number;
  nome: string;
  coordenador?: string | null;
  coordenador_nome?: string | null;
  coordenador_email?: string | null;
};

export type AreaOption = { id: number; nome: string; coordenador_nome?: string | null };

const inputCls = "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm";
const CATALOGO_INDISPONIVEL: CatalogoNovoPedido = { catalogo: [], fornecedores: [], incompleto: true };

/**
 * "Novo pedido" (relatório de ajustes de Compras de 17/11/2026): os itens
 * entram aqui mesmo e "Enviar para aprovação" grava o pedido e já o envia
 * (ajuste 4). Fechar com algo preenchido pede confirmação antes de descartar;
 * "Guardar rascunho" guarda para terminar depois. Quem pede não define a
 * urgência (ajuste 2) nem sugere a fonte do recurso (ajuste 3). A cotação
 * prévia e o termo de referência entram aqui, com o pedido (ajustes de
 * 19/11/2026, ajuste 2).
 */
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
  const [aberto, setAberto] = useState(abrirAoCarregar);
  const [mexeu, setMexeu] = useState(false);
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  /** troca a cada descarte: o formulário renasce vazio */
  const [versao, setVersao] = useState(0);
  const [catalogo, setCatalogo] = useState<CatalogoNovoPedido | null>(null);
  const catalogoPedido = useRef(false);

  // O catálogo de insumos só é lido quando o formulário abre pela primeira vez.
  const pedirCatalogo = useCallback(() => {
    if (catalogoPedido.current) return;
    catalogoPedido.current = true;
    carregarCatalogoNovoPedido()
      .then(setCatalogo)
      .catch(() => setCatalogo(CATALOGO_INDISPONIVEL));
  }, []);

  useEffect(() => {
    if (abrirAoCarregar) pedirCatalogo();
  }, [abrirAoCarregar, pedirCatalogo]);

  // Fechar a aba ou recarregar com o pedido preenchido: o navegador pergunta antes.
  useEffect(() => {
    if (!aberto || !mexeu) return;
    const avisar = (evento: BeforeUnloadEvent) => evento.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [aberto, mexeu]);

  function mudarAberto(proximo: boolean) {
    if (proximo) {
      pedirCatalogo();
      setAberto(true);
      return;
    }
    // Fechar (X, Esc, clique fora ou "Cancelar") com algo preenchido não descarta sem perguntar.
    if (mexeu) {
      setConfirmandoDescarte(true);
      return;
    }
    setAberto(false);
  }

  function descartar() {
    setConfirmandoDescarte(false);
    setMexeu(false);
    setVersao((atual) => atual + 1);
    setAberto(false);
  }

  return (
    <Dialog open={aberto} onOpenChange={mudarAberto}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Novo pedido
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo pedido</DialogTitle>
          <DialogDescription>
            Registre o pedido do laboratório ou do campo, inclua os itens e envie para aprovação.
          </DialogDescription>
        </DialogHeader>
        {confirmandoDescarte && (
          <div
            role="group"
            aria-labelledby="novo-pedido-descartar-titulo"
            data-testid="novo-pedido-descartar"
            className="grid gap-3 rounded-lg border border-warning-strong/40 bg-warning-soft p-4"
          >
            <div>
              <h3 id="novo-pedido-descartar-titulo" className="text-sm font-semibold">Descartar este pedido?</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                O que você preencheu ainda não foi guardado. Para não perder, continue e use “Guardar rascunho” ou “Enviar
                para aprovação”.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={descartar}>
                Descartar pedido
              </Button>
              <Button type="button" onClick={() => setConfirmandoDescarte(false)}>
                Continuar preenchendo
              </Button>
            </div>
          </div>
        )}
        {/* Escondido, não desmontado: o que foi digitado continua nos campos enquanto a pessoa decide. */}
        <div className={confirmandoDescarte ? "hidden" : undefined}>
          <NovoPedidoFormulario
            key={versao}
            projetos={projetos}
            areas={areas}
            catalogo={catalogo}
            aoMexer={() => setMexeu(true)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NovoPedidoFormulario({
  projetos,
  areas,
  catalogo,
  aoMexer,
}: {
  projetos: ProjetoOption[];
  areas: AreaOption[];
  /** null enquanto carrega */
  catalogo: CatalogoNovoPedido | null;
  aoMexer: () => void;
}) {
  const [natureza, setNatureza] = useState("");
  const [itens, setItens] = useState<ItemDaLista[]>([]);
  /** campos do item em preenchimento: a versão troca para limpar ou carregar um item da lista */
  const [emPreenchimento, setEmPreenchimento] = useState<{ versao: number; defaults: PedidoItemDefaults }>({ versao: 0, defaults: {} });
  const [erroItem, setErroItem] = useState<string | null>(null);
  const [acaoClicada, setAcaoClicada] = useState<"enviar" | "rascunho">("enviar");
  const camposItem = useRef<HTMLDivElement>(null);
  const proximaChave = useRef(1);
  const exigeLaboratorio = natureza === "material_consumo_lab";

  function lerCamposDoItem() {
    const valores = {} as Record<CampoItemNovoPedido, string>;
    for (const campo of CAMPOS_ITEM_NOVO_PEDIDO) {
      const elemento = camposItem.current?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${campo}"]`);
      valores[campo] = elemento?.value ?? "";
    }
    return valores;
  }

  function adicionarItem() {
    const campos = lerCamposDoItem();
    const falta = faltaNoItem(normalizarItemNovoPedido(campos));
    if (falta) {
      setErroItem(falta);
      return;
    }
    setErroItem(null);
    const chave = proximaChave.current;
    proximaChave.current += 1;
    setItens((atuais) => [...atuais, { chave, campos }]);
    setEmPreenchimento((atual) => ({ versao: atual.versao + 1, defaults: {} }));
    aoMexer();
  }

  function removerItem(chave: number) {
    setItens((atuais) => atuais.filter((item) => item.chave !== chave));
  }

  /** Devolve o item aos campos para corrigir; ele volta para a lista com "Adicionar item". */
  function editarItem(chave: number) {
    if (lerCamposDoItem().especificacao.trim()) {
      setErroItem("Adicione ou limpe o item que está em preenchimento antes de editar outro.");
      return;
    }
    const item = itens.find((candidato) => candidato.chave === chave);
    if (!item) return;
    const { campos } = item;
    setErroItem(null);
    setItens((atuais) => atuais.filter((candidato) => candidato.chave !== chave));
    setEmPreenchimento((atual) => ({
      versao: atual.versao + 1,
      defaults: {
        tipo: campos.tipo,
        insumoId: Number(campos.insumo_id) || null,
        especificacao: campos.especificacao,
        modelo: campos.modelo,
        volume: campos.volume,
        quantidade: campos.quantidade,
        unidade: campos.unidade,
        orcamentoPrevio: campos.orcamento_previo,
        fornecedorSugerido: campos.fornecedor_sugerido,
        observacao: campos.observacao,
        caracteristicas: campos.caracteristicas,
        exigenciaTecnica: campos.exigencia_tecnica,
        exclusividade: campos.exclusividade,
        outrosFornecedores: campos.outros_fornecedores,
      },
    }));
  }

  /**
   * Enter num campo não envia o pedido: o envio só sai pelos botões. Nos campos
   * do item, Enter adiciona o item à lista.
   */
  function aoTeclar(evento: KeyboardEvent<HTMLDivElement>) {
    if (evento.key !== "Enter" || !(evento.target instanceof HTMLInputElement)) return;
    evento.preventDefault();
    if (camposItem.current?.contains(evento.target)) adicionarItem();
  }

  return (
    <FormComMensagem action={criarPedidoInterno} className="grid gap-5">
      {/* só observa a digitação dos campos de dentro: marca que há o que perder e segura o Enter */}
      <div className="grid gap-5" onInput={aoMexer} onKeyDown={aoTeclar}>
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
              <option value="">Sem projeto (a Supervisão aprova)</option>
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
              O coordenador do projeto aprova o pedido. Sem coordenador cadastrado, o envio trava.
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
              aria-describedby={exigeLaboratorio ? "novo-pedido-area-ajuda" : undefined}
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
          <p className="text-xs text-muted-foreground md:col-span-12" data-testid="ciclo-pedido">
            {explicarCicloHoje(dataEmBrasilia(new Date()), false)} A urgência é definida pelo administrativo, não por quem pede: se o
            pedido não pode esperar o ciclo, diga o porquê na justificativa.
          </p>
        </section>

        <section className="grid gap-3 rounded-lg border border-border p-4">
          <div>
            <h3 className="text-sm font-semibold">Justificativa</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Fonte e rubrica são definidas pelo administrativo.
            </p>
          </div>
          <div>
            <label htmlFor="novo-pedido-justificativa" className="block text-xs font-medium text-muted-foreground">
              Justificativa técnica (obrigatória para enviar)
            </label>
            <textarea
              id="novo-pedido-justificativa"
              name="justificativa"
              rows={3}
              placeholder="Experimentos, análises ou problema que originou a compra. Em projeto, ligue aos objetivos dele."
              className={inputCls}
            />
          </div>
        </section>

        <section className="grid gap-3 rounded-lg border border-border p-4" aria-labelledby="novo-pedido-itens-titulo">
          <div>
            <h3 id="novo-pedido-itens-titulo" className="text-sm font-semibold">Materiais, serviços e equipamentos</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Preencha um item e aperte “Adicionar item”. Para enviar, o pedido precisa de ao menos um item com especificação,
              quantidade e unidade.
            </p>
          </div>
          <NovoPedidoItensLista itens={itens} aoEditar={editarItem} aoRemover={removerItem} />
          <input type="hidden" name="itens_json" value={JSON.stringify(itens.map((item) => item.campos))} />
          {catalogo === null ? (
            <p role="status" className="text-xs text-muted-foreground">Carregando a lista de insumos…</p>
          ) : (
            <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3">
              {catalogo.incompleto && (
                <p className="text-xs text-warning-strong">
                  Parte da lista de insumos não carregou. Você ainda pode descrever o item à mão.
                </p>
              )}
              <div ref={camposItem} className="grid gap-3 md:grid-cols-12" data-testid="novo-pedido-item-campos">
                <PedidoItemCamposAssistidos
                  key={emPreenchimento.versao}
                  catalogo={catalogo.catalogo}
                  fornecedores={catalogo.fornecedores}
                  defaults={emPreenchimento.defaults}
                  layout="painel"
                  idPrefix="novo-pedido-item"
                  obrigatorios={false}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={adicionarItem}>
                  Adicionar item
                </Button>
                {erroItem && (
                  <p role="alert" className="text-xs font-medium text-danger-strong">{erroItem}</p>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-2" aria-labelledby="novo-pedido-documentos-titulo">
          <div className="md:col-span-2">
            <h3 id="novo-pedido-documentos-titulo" className="text-sm font-semibold">Cotação prévia e termo de referência</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Opcional. Anexe aqui, com o pedido: da Aprovação em diante, esses dois documentos não entram mais.
            </p>
          </div>
          <CampoArquivosAnexo id="novo-pedido-cotacao-previa" name="documento_orcamento_previo" label="Cotação prévia" multiple />
          <CampoArquivosAnexo id="novo-pedido-termo-referencia" name="documento_termo_referencia" label="Termo de referência" multiple />
        </section>

        <DialogFooter className="sm:items-center">
          <p className="text-xs text-muted-foreground sm:mr-auto sm:max-w-md">
            “Enviar para aprovação” grava o pedido e já o envia a quem aprova. “Guardar rascunho” guarda para terminar depois.
          </p>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </DialogClose>
          <SubmitButton
            variant="outline"
            name="acao"
            value="rascunho"
            pendingLabel={acaoClicada === "rascunho" ? "Guardando…" : "Guardar rascunho"}
            onClick={() => setAcaoClicada("rascunho")}
          >
            Guardar rascunho
          </SubmitButton>
          <SubmitButton
            name="acao"
            value="enviar"
            pendingLabel={acaoClicada === "enviar" ? "Enviando…" : "Enviar para aprovação"}
            onClick={() => setAcaoClicada("enviar")}
          >
            Enviar para aprovação
          </SubmitButton>
        </DialogFooter>
      </div>
    </FormComMensagem>
  );
}
