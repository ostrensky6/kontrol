import Link from "next/link";
import {
  motivoSemAprovacaoFinal,
  motivoSemCotacoesRecebidas,
  type Orcamento,
  type ResumoOrcamentos,
} from "@/lib/pedido/orcamentos";
import { PedidoOrcamentos } from "@/components/pedido/PedidoOrcamentos";
import { QuemAprova } from "@/components/pedido/QuemAprova";
import { cn } from "@/lib/utils";
import { registrarAnaliseAdministrativa } from "@/lib/actions/pedidos-internos";
import { PedidoInternoAcoes } from "@/components/pedido/PedidoInternoAcoes";
import { PedidoNotaFiscal } from "@/components/pedido/detalhe/PedidoNotaFiscal";
import { TIPOS_DOCUMENTO_FISCAL } from "@/lib/pedido/anexos";
import { HelpTip } from "@/components/common/HelpTip";
import { FormComMensagem } from "@/components/pedido/FormComMensagem";
import { SubmitButton } from "@/components/common/SubmitButton";
import { formatDateTime } from "@/lib/formatters";
import {
  type FornecedorRaw,
  type PedidoInternoAnexo,
  CLASSE_CAMPO_PEDIDO,
  type PedidoDetalhe,
} from "@/lib/pedido/detalhe";
import type { ProximoPasso } from "@/lib/pedido/proximo-passo";
import type { AprovadoresPedido, EtapaAprovacao } from "@/lib/pedido/aprovadores";
import type { pedidoInternoSituacao } from "@/lib/pedido/status";

type Props = {
  vez: { tom: "sua" | "espera" | "neutro"; rotulo: string; texto: string | null; };
  encerrado: boolean;
  proxima: ProximoPasso;
  statusMeta: ReturnType<typeof pedidoInternoSituacao>;
  editavel: boolean;
  pedidoId: number;
  pedido: PedidoDetalhe;
  podeGerir: boolean;
  rascunhoCompleto: boolean;
  compraFormal: { id: number; status: string; } | null;
  podeValidar: boolean;
  /** 0136 (D2): quem pediu não dá a aprovação final do próprio pedido; null quando pode */
  motivoProprioPedido?: string | null;
  aprovadores: AprovadoresPedido | null;
  esperaLaboratorio: boolean;
  podeDecidirLaboratorio: boolean;
  motivoCiclo: string | null;
  /** item novo ainda sem insumo: trava a formalização com a explicação */
  motivoItensSemCadastro?: string | null;
  pendenciaPagamento: string | null;
  podeConfirmar: boolean;
  resumoOrcamentos: ResumoOrcamentos | null;
  controlados: string[];
  etapasQuemAprova: EtapaAprovacao[];
  comOrcamentos: boolean;
  orcamentos: Orcamento[] | null;
  fornecedores: FornecedorRaw[] | null;
  anexoRowsBase: PedidoInternoAnexo[];
  aguardandoChegada: boolean;
};

/** Quadro "O que falta agora": de quem é a vez, a próxima ação e as decisões da etapa. */
export function PedidoPainelAgora({
  vez,
  encerrado,
  proxima,
  statusMeta,
  editavel,
  pedidoId,
  pedido,
  podeGerir,
  rascunhoCompleto,
  compraFormal,
  podeValidar,
  motivoProprioPedido = null,
  aprovadores,
  esperaLaboratorio,
  podeDecidirLaboratorio,
  motivoCiclo,
  motivoItensSemCadastro = null,
  pendenciaPagamento,
  podeConfirmar,
  resumoOrcamentos,
  controlados,
  etapasQuemAprova,
  comOrcamentos,
  orcamentos,
  fornecedores,
  anexoRowsBase,
  aguardandoChegada,
}: Props) {
  return (
    <div
      data-testid="painel-agora"
      className={cn(
        "rounded-lg border bg-card p-4 shadow-sm",
        vez.tom === "sua" ? "border-primary/60 ring-1 ring-primary/30" : "border-border",
      )}
    >
      <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-xs font-semibold text-muted-foreground">
              {encerrado ? "Situação" : "O que falta agora"}
            </p>
            <HelpTip title="O que falta agora">
              <p>
                Este quadro diz o próximo passo do pedido, com quem ele está e o que vem depois. Quando
                o passo depende de você, aparece <b>Sua vez</b> e os botões ficam aqui mesmo.
              </p>
              <p>A trilha acima mostra as seis etapas: as cumpridas levam um visto e a atual fica em destaque.</p>
            </HelpTip>
          </div>
          <h2 className="mt-0.5 text-lg font-semibold leading-6">{proxima.acao}</h2>
          {proxima.responsavel !== "—" && (
            <p className="mt-1 text-sm text-muted-foreground">
              Com: <b className="font-medium text-foreground">{proxima.responsavel}</b>
            </p>
          )}
        </div>
        <span
          data-testid="vez"
          className={cn(
            "inline-flex shrink-0 items-center rounded-full px-3 py-1 text-sm font-semibold",
            vez.tom === "sua"
              ? "bg-primary text-primary-foreground"
              : vez.tom === "espera"
                ? "bg-warning-soft text-warning-strong"
                : "bg-muted text-muted-foreground",
          )}
        >
          {vez.rotulo}
        </span>
      </div>
      {vez.texto && <p className="mt-2 max-w-2xl text-sm text-foreground">{vez.texto}</p>}
      <div className="mt-3">
        {pedido.status === "aguardando_pagamento_nf" && podeGerir && (
          <PedidoNotaFiscal pedidoId={pedidoId} anexos={anexoRowsBase} />
        )}
        {statusMeta && !editavel && (
          <PedidoInternoAcoes
            semDocumentoFiscal={!anexoRowsBase.some((anexo) => TIPOS_DOCUMENTO_FISCAL.includes(anexo.tipo))}
            pedidoId={pedidoId}
            status={pedido.status}
            podeGerir={podeGerir}
            podeEnviarValidacao={rascunhoCompleto}
            temCompraFormal={Boolean(compraFormal)}
            motivoSemValidacao={
              podeValidar
                ? undefined
                : `Quem aprova: ${aprovadores?.coordenador?.nome ?? "coordenador do projeto"}. Na ausência, o Administrador.`
            }
            aguardandoLaboratorio={esperaLaboratorio}
            podeDecidirLaboratorio={podeDecidirLaboratorio}
            motivoCicloTravado={motivoCiclo}
            motivoItensSemCadastro={motivoItensSemCadastro}
            pendenciaPagamento={pendenciaPagamento}
            podeConfirmarEntrega={podeConfirmar}
            motivoSemCotacoesRecebidas={resumoOrcamentos ? motivoSemCotacoesRecebidas(resumoOrcamentos) : null}
            motivoSemAprovacaoFinal={resumoOrcamentos ? motivoSemAprovacaoFinal(resumoOrcamentos) : null}
            motivoProprioPedido={motivoProprioPedido}
            controlado={controlados.length > 0}
          />
        )}
        {pendenciaPagamento && (
          <p className="mt-2 text-xs text-warning-strong" data-testid="pendencia-pagamento">
            <span aria-hidden="true">⏳ </span>
            {pendenciaPagamento}
          </p>
        )}
        {pedido.entrega_confirmada_em && (
          <p className="mt-2 text-xs text-muted-foreground" data-testid="entrega-confirmada">
            <span aria-hidden="true">✓ </span>
            Entrega confirmada em {formatDateTime(pedido.entrega_confirmada_em)} por {pedido.entrega_confirmada_por ?? "—"}
            {pedido.entrega_observacao ? `: ${pedido.entrega_observacao}` : "."}
          </p>
        )}
        {pedido.excecao_pagamento && (
          <p className="mt-2 text-xs text-warning-strong" data-testid="excecao-pagamento">
            <span aria-hidden="true">! </span>
            Exceção registrada por {pedido.excecao_pagamento_por ?? "—"}
            {pedido.excecao_pagamento_em ? ` em ${formatDateTime(pedido.excecao_pagamento_em)}` : ""}: pagamento antes da entrega.
            Acordo: {pedido.excecao_pagamento}
          </p>
        )}
        {editavel && (
          <a
            href="#envio"
            className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium text-foreground hover:bg-muted"
          >
            Conferir e enviar, no fim da lista de itens
          </a>
        )}
        {!encerrado && !editavel && !podeGerir && !podeDecidirLaboratorio && (
          <p className="text-sm text-muted-foreground">
            Você acompanha este pedido. Quem age nesta etapa precisa da permissão “Aprovar pedidos”.
          </p>
        )}
      </div>
      {proxima.depois && (
        <p className="mt-3 border-t border-border/70 pt-3 text-sm text-muted-foreground" data-testid="depois">
          <b className="font-medium text-foreground">Depois:</b> {proxima.depois}
        </p>
      )}
      {etapasQuemAprova.length > 0 && <QuemAprova etapas={etapasQuemAprova} />}
      {editavel && (aprovadores?.falta_coordenador || aprovadores?.falta_laboratorio) && (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="resolver-trava">
          {aprovadores.falta_coordenador && pedido.projeto_id != null && (
            <Link href={`/cadastros/projetos?focus=${pedido.projeto_id}`} className="font-medium text-primary hover:underline">
              Indicar o coordenador do projeto
            </Link>
          )}
          {aprovadores.falta_laboratorio && (
            <Link href="/cadastros/coordenacoes" className="font-medium text-primary hover:underline">
              Indicar a coordenação do laboratório
            </Link>
          )}
        </p>
      )}
      {comOrcamentos && (
        <PedidoOrcamentos
          pedidoId={pedidoId}
          status={pedido.status}
          orcamentos={orcamentos}
          podeGerir={podeGerir}
          fornecedores={((fornecedores ?? []) as unknown as FornecedorRaw[])
            .filter((f): f is { id: number; nome: string } => typeof f.id === "number" && Boolean(f.nome))
            .map((f) => ({ id: f.id, nome: f.nome }))}
          anexos={anexoRowsBase
            .filter((a) => ["orcamento_previo", "proposta", "print", "email"].includes(a.tipo))
            .map((a) => ({ id: a.id, titulo: a.titulo }))}
        />
      )}
      {pedido.status === "formalizado" && podeGerir && (
        <FormComMensagem action={registrarAnaliseAdministrativa} className="mt-5 grid gap-3 rounded-lg border border-border bg-muted/20 p-4 md:grid-cols-2">
          <input type="hidden" name="pedido_interno_id" value={pedidoId} />
          <div className="flex items-center gap-1 md:col-span-2">
            <h3 className="text-sm font-semibold">Análise administrativa</h3>
            <HelpTip title="Análise administrativa">
              <p>Confirme recurso, rubrica e conformidade antes de liberar cotação.</p>
            </HelpTip>
          </div>
          <div>
            <label htmlFor="registrarAnaliseAdministrativa-fonte_recurso" className="block text-xs font-medium text-muted-foreground">Fonte do recurso</label>
            <input id="registrarAnaliseAdministrativa-fonte_recurso"
              name="fonte_recurso"
              required
              defaultValue={pedido.fonte_recurso ?? (controlados.length > 0 ? "FUNPAR" : "")}
              className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`}
            />
            {controlados.length > 0 && (
              <p className="mt-1 text-xs text-warning-strong">Produto controlado: a fonte tem que ser a FUNPAR.</p>
            )}
          </div>
          <div>
            <label htmlFor="registrarAnaliseAdministrativa-rubrica" className="block text-xs font-medium text-muted-foreground">Rubrica</label>
            <input id="registrarAnaliseAdministrativa-rubrica" name="rubrica" required defaultValue={pedido.rubrica ?? ""} className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`} />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="registrarAnaliseAdministrativa-conformidade_admin" className="block text-xs font-medium text-muted-foreground">Conformidades administrativas</label>
            <textarea id="registrarAnaliseAdministrativa-conformidade_admin" name="conformidade_admin" required defaultValue={pedido.conformidade_admin ?? ""} rows={3} className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`} />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="registrarAnaliseAdministrativa-observacao" className="block text-xs font-medium text-muted-foreground">Observação</label>
            <input id="registrarAnaliseAdministrativa-observacao" name="observacao" defaultValue={pedido.observacao_compras ?? ""} className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`} />
          </div>
          <div className="md:col-span-2">
            <SubmitButton pendingLabel="Registrando…" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Registrar análise administrativa
            </SubmitButton>
          </div>
        </FormComMensagem>
      )}
      {aguardandoChegada && (
        <div className="mt-3 rounded-lg border border-leaf-300 bg-leaf-50 p-3 text-sm text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/30 dark:text-leaf-300">
          <span className="inline-flex items-center gap-1">
            <span>
              Receba os itens na tabela ou em{" "}
              <Link href="/recebimento" className="font-medium underline">
                Recebimento
              </Link>
              .
            </span>
            <HelpTip title="Quando o recebimento termina">
              <p>
                A etapa de recebimento só fecha quando <b>todos</b> os materiais e equipamentos do
                pedido forem lançados no estoque.
              </p>
            </HelpTip>
          </span>
        </div>
      )}
    </div>
  );
}
