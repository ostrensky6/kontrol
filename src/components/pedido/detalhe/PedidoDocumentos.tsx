import { adicionarAnexoPedidoInterno, removerAnexoPedidoInterno } from "@/lib/actions/pedidos-internos";
import { HelpTip } from "@/components/common/HelpTip";
import { FormComMensagem } from "@/components/pedido/FormComMensagem";
import { SubmitButton } from "@/components/common/SubmitButton";
import { ConfirmSubmitButton } from "@/components/common/ConfirmSubmitButton";
import { formatDateTime } from "@/lib/formatters";
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
};

/** Documentos do pedido: lista e inclusão. */
export function PedidoDocumentos({
  temDocumentoCotacao,
  anexoRows,
  editavel,
  pedidoId,
}: Props) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold text-muted-foreground">Documentos</h2>
          <HelpTip title="Documentos">
            <p>Cotações, termos, ofícios, boletos, notas e comprovantes.</p>
          </HelpTip>
        </div>
        <span className={`rounded-md px-2 py-1 text-xs ${temDocumentoCotacao ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" : "bg-warning-soft text-warning-strong"}`}>
          {anexoRows.length} anexo(s)
        </span>
      </div>
    
      <div className="mt-3 space-y-2">
        {anexoRows.map((anexo) => (
          <div key={anexo.id} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{anexo.titulo}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {ANEXO_TIPO_LABEL[anexo.tipo] ?? anexo.tipo} · {rotuloEtapa(anexo.etapa) ?? "sem etapa"} · {formatDateTime(anexo.criado_em)}
                </p>
                {anexo.downloadUrl || anexo.url ? (
                  <a href={(anexo.downloadUrl ?? anexo.url) as string} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-primary hover:underline">
                    {anexo.downloadUrl ? "Abrir arquivo" : "Abrir referência"}
                  </a>
                ) : anexo.storage_path ? (
                  <span className="mt-1 inline-block cursor-not-allowed text-xs text-muted-foreground/80" aria-disabled="true">
                    Arquivo indisponível no momento
                  </span>
                ) : null}
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
        {anexoRows.length === 0 && <p className="text-sm text-muted-foreground/80">Nenhum documento registrado.</p>}
      </div>
    
      <details className="mt-3 border-t border-border/70 pt-3">
        <summary className="cursor-pointer text-xs font-medium text-primary hover:underline">Registrar documento</summary>
        <FormComMensagem action={adicionarAnexoPedidoInterno} encType="multipart/form-data" className="mt-3 grid gap-3 md:grid-cols-2">
          <input type="hidden" name="pedido_interno_id" value={pedidoId} />
          <div>
            <label htmlFor="adicionarAnexoPedidoInterno-tipo" className="block text-xs text-muted-foreground/80">Tipo</label>
            <select id="adicionarAnexoPedidoInterno-tipo" name="tipo" defaultValue="orcamento_previo" className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`}>
              <option value="orcamento_previo">Cotação prévia</option>
              <option value="proposta">Cotação do fornecedor</option>
              <option value="print">Print</option>
              <option value="email">E-mail</option>
              <option value="termo_referencia">Termo de referência</option>
              <option value="oficio">Ofício</option>
              <option value="boleto">Boleto</option>
              <option value="nota_fiscal">Nota fiscal</option>
              <option value="comprovante">Comprovante</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div>
            <label htmlFor="adicionarAnexoPedidoInterno-titulo" className="block text-xs text-muted-foreground/80">Título</label>
            <input id="adicionarAnexoPedidoInterno-titulo" name="titulo" required className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`} />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="adicionarAnexoPedidoInterno-arquivo" className="block text-xs text-muted-foreground/80">Arquivo</label>
            <input id="adicionarAnexoPedidoInterno-arquivo" name="arquivo" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.docx,.xlsx" className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`} />
            <p className="mt-1 text-[11px] text-muted-foreground">PDF, imagem, DOCX ou XLSX, até 15 MB.</p>
          </div>
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
