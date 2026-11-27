import { registrarNotaFiscal } from "@/lib/actions/pedidos-internos";
import { FormComMensagem } from "@/components/pedido/FormComMensagem";
import { SubmitButton } from "@/components/common/SubmitButton";
import { CampoArquivosAnexo } from "@/components/pedido/CampoArquivosAnexo";
import { ANEXO_TIPO_LABEL, CLASSE_CAMPO_PEDIDO, type PedidoInternoAnexo } from "@/lib/pedido/detalhe";
import { TIPOS_DOCUMENTO_FISCAL } from "@/lib/pedido/anexos";

/**
 * Bug 1 de 27/11/2026: na etapa Pagamento, a nota fiscal entra aqui, no
 * próprio "O que falta agora" (PDF e XML no mesmo envio). Com ela registrada,
 * "Concluir compra" libera e "Doc. fiscal" passa a "registrado".
 */
export function PedidoNotaFiscal({ pedidoId, anexos }: { pedidoId: number; anexos: PedidoInternoAnexo[] }) {
  const fiscais = anexos.filter((anexo) => TIPOS_DOCUMENTO_FISCAL.includes(anexo.tipo));
  return (
    <div className="mb-3 rounded-lg border border-border bg-muted/20 p-3" data-testid="nota-fiscal">
      <h3 className="text-sm font-semibold">Nota fiscal</h3>
      {fiscais.length > 0 ? (
        <ul className="mt-1 text-xs text-muted-foreground">
          {fiscais.map((anexo) => (
            <li key={anexo.id}>
              <span aria-hidden="true">✓ </span>
              {ANEXO_TIPO_LABEL[anexo.tipo] ?? anexo.tipo}: {anexo.titulo}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-warning-strong">Falta anexar a nota fiscal para concluir a compra.</p>
      )}
      <FormComMensagem
        action={registrarNotaFiscal}
        encType="multipart/form-data"
        className="mt-3 grid gap-2 sm:grid-cols-2"
      >
        <input type="hidden" name="pedido_interno_id" value={pedidoId} />
        <div>
          <label htmlFor={`nota-fiscal-${pedidoId}-tipo`} className="block text-xs text-muted-foreground/80">Tipo</label>
          <select id={`nota-fiscal-${pedidoId}-tipo`} name="tipo" defaultValue="nota_fiscal" className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`}>
            {TIPOS_DOCUMENTO_FISCAL.map((tipo) => (
              <option key={tipo} value={tipo}>
                {ANEXO_TIPO_LABEL[tipo] ?? tipo}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`nota-fiscal-${pedidoId}-numero`} className="block text-xs text-muted-foreground/80">Número da nota (opcional)</label>
          <input id={`nota-fiscal-${pedidoId}-numero`} name="numero" maxLength={60} inputMode="numeric" className={`${CLASSE_CAMPO_PEDIDO} mt-1 w-full`} />
        </div>
        <CampoArquivosAnexo
          id={`nota-fiscal-${pedidoId}-arquivo`}
          name="arquivo"
          label="Arquivos (PDF e XML da nota)"
          multiple
          className="sm:col-span-2"
        />
        <div className="sm:col-span-2">
          <SubmitButton size="sm" pendingLabel="Enviando…">
            Anexar nota fiscal
          </SubmitButton>
        </div>
      </FormComMensagem>
    </div>
  );
}
