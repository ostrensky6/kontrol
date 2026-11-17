import { registrarComunicacaoPedidoInterno } from "@/lib/actions/pedidos-internos";
import { HelpTip } from "@/components/common/HelpTip";
import { FormComMensagem } from "@/components/pedido/FormComMensagem";
import { SubmitButton } from "@/components/common/SubmitButton";
import { formatDateTime } from "@/lib/formatters";
import {
  COMUNICACAO_TIPO_LABEL,
  type PedidoInternoComunicacao,
  CLASSE_CAMPO_PEDIDO,
} from "@/lib/pedido/detalhe";

type Props = {
  comunicacaoRows: PedidoInternoComunicacao[];
  pedidoId: number;
};

/** Comunicações do pedido: lista e registro. */
export function PedidoComunicacoes({
  comunicacaoRows,
  pedidoId,
}: Props) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-semibold text-muted-foreground">Comunicações</h2>
        <HelpTip title="Comunicações">
          <p>Registro interno de e-mails, reuniões, mensagens e encaminhamentos.</p>
        </HelpTip>
      </div>
    
      <div className="mt-3 space-y-2">
        {comunicacaoRows.map((comunicacao) => (
          <div key={comunicacao.id} className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">{comunicacao.assunto ?? COMUNICACAO_TIPO_LABEL[comunicacao.tipo] ?? comunicacao.tipo}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {COMUNICACAO_TIPO_LABEL[comunicacao.tipo] ?? comunicacao.tipo} · {comunicacao.remetente ?? "—"} → {comunicacao.destinatarios ?? "—"} · {formatDateTime(comunicacao.criado_em)}
            </p>
            {comunicacao.referencia && <p className="mt-1 text-xs text-primary">{comunicacao.referencia}</p>}
            {comunicacao.observacao && <p className="mt-1 text-xs text-muted-foreground">{comunicacao.observacao}</p>}
          </div>
        ))}
        {comunicacaoRows.length === 0 && <p className="text-sm text-muted-foreground/80">Nenhuma comunicação registrada.</p>}
      </div>
    
      <details className="mt-3 border-t border-border/70 pt-3">
        <summary className="cursor-pointer text-xs font-medium text-primary hover:underline">Registrar comunicação</summary>
        <FormComMensagem action={registrarComunicacaoPedidoInterno} className="mt-3 grid gap-3 md:grid-cols-2">
          <input type="hidden" name="pedido_interno_id" value={pedidoId} />
          <div>
            <label htmlFor="registrarComunicacaoPedidoInterno-tipo" className="block text-xs text-muted-foreground/80">Tipo</label>
            <select id="registrarComunicacaoPedidoInterno-tipo" name="tipo" defaultValue="email" className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`}>
              <option value="email">E-mail</option>
              <option value="reuniao">Reunião</option>
              <option value="telefone">Telefone</option>
              <option value="mensagem">Mensagem</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div>
            <label htmlFor="registrarComunicacaoPedidoInterno-remetente" className="block text-xs text-muted-foreground/80">Remetente</label>
            <input id="registrarComunicacaoPedidoInterno-remetente" name="remetente" defaultValue="giacompras2025@gmail.com" className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`} />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="registrarComunicacaoPedidoInterno-destinatarios" className="block text-xs text-muted-foreground/80">Destinatários</label>
            <input id="registrarComunicacaoPedidoInterno-destinatarios" name="destinatarios" className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`} />
          </div>
          <div>
            <label htmlFor="registrarComunicacaoPedidoInterno-assunto" className="block text-xs text-muted-foreground/80">Assunto</label>
            <input id="registrarComunicacaoPedidoInterno-assunto" name="assunto" className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`} />
          </div>
          <div>
            <label htmlFor="registrarComunicacaoPedidoInterno-referencia" className="block text-xs text-muted-foreground/80">Referência</label>
            <input id="registrarComunicacaoPedidoInterno-referencia" name="referencia" placeholder="ID da mensagem, protocolo, link..." className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`} />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="registrarComunicacaoPedidoInterno-observacao" className="block text-xs text-muted-foreground/80">Observação</label>
            <input id="registrarComunicacaoPedidoInterno-observacao" name="observacao" className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`} />
          </div>
          <div className="md:col-span-2">
            <SubmitButton pendingLabel="Registrando…" className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Registrar comunicação
            </SubmitButton>
          </div>
        </FormComMensagem>
      </details>
    </div>
  );
}
