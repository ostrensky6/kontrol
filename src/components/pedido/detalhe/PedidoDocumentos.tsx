import Link from "next/link";
import { FileText, Printer } from "lucide-react";

import { VazioCompacto } from "@/components/app/EmptyState";
import { Etiqueta } from "@/components/common/Etiqueta";
import { adicionarAnexoPedidoInterno, removerAnexoPedidoInterno } from "@/lib/actions/pedidos-internos";
import { HelpTip } from "@/components/common/HelpTip";
import { FormComMensagem } from "@/components/pedido/FormComMensagem";
import { SubmitButton } from "@/components/common/SubmitButton";
import { ConfirmSubmitButton } from "@/components/common/ConfirmSubmitButton";
import { formatDateTime } from "@/lib/formatters";
import { ehEnderecoWeb, pedidoComSolicitante, tiposDeDocumentoNoStatus } from "@/lib/pedido/anexos";
import { CampoArquivosAnexo } from "@/components/pedido/CampoArquivosAnexo";
import {
  ANEXO_TIPO_LABEL,
  type PedidoInternoAnexo,
  rotuloEtapa,
  CLASSE_CAMPO_PEDIDO,
} from "@/lib/pedido/detalhe";

type Props = {
  temDocumentoCotacao: boolean;
  anexoRows: PedidoInternoAnexo[];
  editavel: boolean;
  pedidoId: number;
  /** status do pedido: orçamento prévio e termo de referência só enquanto ele está com quem pede */
  status: string | null;
  /** fonte de pagamento escolhida pelo financeiro: dá o documento para quem paga (Ineo, Funpar) */
  fonte?: string | null;
};

/** Documentos do pedido: lista e inclusão. */
export function PedidoDocumentos({
  temDocumentoCotacao,
  anexoRows,
  editavel,
  pedidoId,
  status,
  fonte = null,
}: Props) {
  const tipos = tiposDeDocumentoNoStatus(status);
  const comSolicitante = pedidoComSolicitante(status);
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold">Documentos</h2>
          <HelpTip title="Documentos">
            <p>O orçamento prévio e o termo de referência são de quem pede e entram com o pedido. Depois vêm os orçamentos da cotação, ofícios, boletos, notas e comprovantes.</p>
          </HelpTip>
        </div>
        <Etiqueta tom={temDocumentoCotacao ? "marca" : "atencao"}>
          {anexoRows.length} {anexoRows.length === 1 ? "anexo" : "anexos"}
        </Etiqueta>
      </div>
    
      {fonte && (
        <Link
          href={`/pedido/${pedidoId}/documento`}
          className="mt-3 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm font-medium text-primary hover:bg-primary/10"
        >
          <Printer className="size-4 shrink-0" aria-hidden="true" />
          Documento para a fonte de pagamento ({fonte}): abrir para imprimir
        </Link>
      )}

      <div className="mt-3 space-y-2">
        {anexoRows.map((anexo) => (
          <div key={anexo.id} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{anexo.titulo}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {ANEXO_TIPO_LABEL[anexo.tipo] ?? anexo.tipo} · {rotuloEtapa(anexo.etapa) ?? "sem etapa"} · {formatDateTime(anexo.criado_em)}
                </p>
                {/* o link assinado nasce no clique (bug 2 de 27/11/2026) */}
                {anexo.downloadUrl && (
                  <a href={anexo.downloadUrl} target="_blank" rel="noreferrer" className="mt-1 mr-3 inline-block text-xs text-primary hover:underline">
                    Abrir arquivo
                  </a>
                )}
                {/* documento com arquivo e link mostra os dois; referência que não é endereço fica como texto */}
                {anexo.url &&
                  (ehEnderecoWeb(anexo.url) ? (
                    <a href={anexo.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-primary hover:underline">
                      Abrir referência
                    </a>
                  ) : (
                    <span className="mt-1 inline-block text-xs text-muted-foreground">Referência: {anexo.url}</span>
                  ))}
                {(anexo.arquivo_nome || anexo.storage_path) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {anexo.arquivo_nome ?? "Arquivo preparado"}
                    {anexo.mime_type ? ` · ${anexo.mime_type}` : ""}
                    {anexo.tamanho_bytes ? ` · ${Math.round(anexo.tamanho_bytes / 1024)} KB` : ""}
                  </p>
                )}
                {anexo.observacao && <p className="mt-1 text-xs text-muted-foreground">{anexo.observacao}</p>}
              </div>
              {editavel && (
                <FormComMensagem action={removerAnexoPedidoInterno} className="text-right">
                  <input type="hidden" name="anexo_id" value={anexo.id} />
                  <input type="hidden" name="pedido_interno_id" value={pedidoId} />
                  <ConfirmSubmitButton
                    className="text-xs text-danger-strong hover:underline"
                    titulo="Remover o documento?"
                    mensagem={`"${anexo.titulo}" sai da lista de documentos deste pedido e o arquivo é apagado.`}
                    confirmLabel="Remover"
                    destrutivo
                  >
                    Remover
                  </ConfirmSubmitButton>
                </FormComMensagem>
              )}
            </div>
          </div>
        ))}
        {anexoRows.length === 0 && <VazioCompacto icon={FileText}>Nenhum documento registrado.</VazioCompacto>}
      </div>
    
      <details className="mt-3 border-t border-border/70 pt-3">
        <summary className="cursor-pointer text-xs font-medium text-primary hover:underline">Registrar documento</summary>
        <FormComMensagem action={adicionarAnexoPedidoInterno} encType="multipart/form-data" className="mt-3 grid gap-3 md:grid-cols-2">
          <input type="hidden" name="pedido_interno_id" value={pedidoId} />
          <div>
            <label htmlFor="adicionarAnexoPedidoInterno-tipo" className="block text-xs text-muted-foreground/80">Tipo</label>
            <select id="adicionarAnexoPedidoInterno-tipo" name="tipo" defaultValue={tipos[0]?.valor} className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`}>
              {tipos.map((tipo) => (
                <option key={tipo.valor} value={tipo.valor}>{tipo.rotulo}</option>
              ))}
            </select>
            {!comSolicitante && (
              <p className="mt-1 text-xs text-muted-foreground" data-testid="documentos-da-solicitacao">
                Orçamento prévio e termo de referência entram com o pedido, por quem pede.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="adicionarAnexoPedidoInterno-titulo" className="block text-xs text-muted-foreground/80">Título</label>
            <input id="adicionarAnexoPedidoInterno-titulo" name="titulo" required className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`} />
          </div>
          <CampoArquivosAnexo id="adicionarAnexoPedidoInterno-arquivo" name="arquivo" label="Arquivo" className="md:col-span-2" />
          <div className="md:col-span-2">
            <label htmlFor="adicionarAnexoPedidoInterno-url" className="block text-xs text-muted-foreground/80">Link ou referência externa (opcional)</label>
            <input id="adicionarAnexoPedidoInterno-url" name="url" placeholder="https://..." className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`} />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="adicionarAnexoPedidoInterno-observacao" className="block text-xs text-muted-foreground/80">Observação</label>
            <input id="adicionarAnexoPedidoInterno-observacao" name="observacao" className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`} />
          </div>
          <div className="md:col-span-2">
            <SubmitButton pendingLabel="Enviando…" className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Registrar documento
            </SubmitButton>
          </div>
        </FormComMensagem>
      </details>
    </div>
  );
}
