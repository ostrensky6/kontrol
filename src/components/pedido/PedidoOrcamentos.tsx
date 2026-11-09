import { escolherOrcamento, registrarOrcamento, removerOrcamento } from "@/lib/actions/pedidos-internos";
import { FormComMensagem } from "@/components/pedido/FormComMensagem";
import { SubmitButton } from "@/components/common/SubmitButton";
import { formatCurrency as brl, formatDate, formatDateTime } from "@/lib/formatters";
import {
  ETAPAS_DE_COTACAO,
  ORCAMENTOS_EXIGIDOS,
  type Orcamento,
  resumirOrcamentos,
} from "@/lib/pedido/orcamentos";

const campo = "h-9 w-full rounded-md border border-input bg-card px-2 text-sm";

/**
 * D2 (0171): os 3 orçamentos do pedido, o menor valor e o escolhido. Quem
 * conduz a compra registra, remove (antes da escolha) e escolhe; os demais
 * só consultam.
 */
export function PedidoOrcamentos({
  pedidoId,
  status,
  orcamentos,
  podeGerir,
  fornecedores,
  anexos,
}: {
  pedidoId: number;
  status: string;
  /** null quando a leitura falhou: o quadro avisa em vez de mostrar "zero" */
  orcamentos: Orcamento[] | null;
  podeGerir: boolean;
  fornecedores: { id: number; nome: string }[];
  anexos: { id: number; titulo: string }[];
}) {
  if (orcamentos == null) {
    return (
      <section className="mt-4 rounded-lg border border-border bg-card p-3" data-testid="orcamentos-pedido">
        <h3 className="text-sm font-semibold">Orçamentos</h3>
        <p className="mt-1 text-xs text-warning-strong">Não foi possível ler os orçamentos agora. Recarregue a página.</p>
      </section>
    );
  }
  const resumo = resumirOrcamentos(orcamentos);
  const aberto = ETAPAS_DE_COTACAO.includes(status);
  const podeEscolher = podeGerir && status === "orcamentos_recebidos" && resumo.faltam === 0;
  const anexoTitulo = new Map(anexos.map((a) => [a.id, a.titulo]));
  const situacao =
    resumo.faltam > 0
      ? { simbolo: "⏳", texto: `${resumo.fornecedores} de ${ORCAMENTOS_EXIGIDOS}: falta${resumo.faltam > 1 ? "m" : ""} ${resumo.faltam}`, cls: "text-warning-strong" }
      : resumo.escolhido
        ? { simbolo: "✓", texto: `${ORCAMENTOS_EXIGIDOS} de ${ORCAMENTOS_EXIGIDOS}, escolhido: ${resumo.escolhido.fornecedor_nome}`, cls: "text-brand-700 dark:text-brand-300" }
        : { simbolo: "●", texto: `${ORCAMENTOS_EXIGIDOS} de ${ORCAMENTOS_EXIGIDOS}: falta escolher`, cls: "text-warning-strong" };

  return (
    <section className="mt-4 rounded-lg border border-border bg-card p-3" data-testid="orcamentos-pedido">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Orçamentos</h3>
        <p className={`text-xs font-medium ${situacao.cls}`}>
          <span aria-hidden="true">{situacao.simbolo} </span>
          {situacao.texto}
        </p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Toda compra tem {ORCAMENTOS_EXIGIDOS} orçamentos de fornecedores diferentes. Escolher um que não seja o de menor valor pede
        justificativa.
      </p>

      {orcamentos.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {orcamentos.map((o) => {
            const menor = resumo.menorValor != null && o.valor_total === resumo.menorValor;
            return (
              <li
                key={o.id}
                className={`rounded-md border px-3 py-2 text-sm ${o.escolhida ? "border-brand-500 bg-brand-50/40 dark:bg-brand-900/20" : "border-border"}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="min-w-0 break-words font-medium">{o.fornecedor_nome}</p>
                  <p className="tabular-nums font-semibold">{brl(o.valor_total)}</p>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {o.prazo_entrega_dias != null ? `Entrega em ${o.prazo_entrega_dias} dia${o.prazo_entrega_dias === 1 ? "" : "s"}` : "Prazo não informado"}
                  {o.validade ? ` · válido até ${formatDate(o.validade)}` : ""}
                  {o.anexo_id ? ` · documento: ${anexoTitulo.get(o.anexo_id) ?? `anexo #${o.anexo_id}`}` : " · sem documento ligado"}
                  {o.condicoes ? ` · ${o.condicoes}` : ""}
                </p>
                <p className="mt-1 flex flex-wrap gap-2 text-xs">
                  {menor && <span className="rounded bg-muted px-1.5 py-0.5 font-medium">Menor valor</span>}
                  {o.escolhida && (
                    <span className="rounded bg-brand-500 px-1.5 py-0.5 font-medium text-white">
                      <span aria-hidden="true">✓ </span>Escolhido
                    </span>
                  )}
                </p>
                {o.escolhida && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Escolhido por {o.escolhida_por ?? "—"}
                    {o.escolhida_em ? ` em ${formatDateTime(o.escolhida_em)}` : ""}
                    {o.justificativa_escolha ? `. Justificativa: ${o.justificativa_escolha}` : "."}
                  </p>
                )}
                {podeGerir && aberto && !o.escolhida && (
                  <div className="mt-2 flex flex-wrap items-start gap-2">
                    {podeEscolher && (
                      <FormComMensagem action={escolherOrcamento} className="flex flex-wrap items-start gap-2">
                        <input type="hidden" name="pedido_interno_id" value={pedidoId} />
                        <input type="hidden" name="orcamento_id" value={o.id} />
                        {!menor && (
                          <input
                            name="justificativa"
                            required
                            minLength={15}
                            aria-label={`Por que escolher ${o.fornecedor_nome}`}
                            placeholder="Por que não o de menor valor?"
                            className="h-8 w-60 max-w-full rounded-md border border-input bg-card px-2 text-xs"
                          />
                        )}
                        <SubmitButton size="sm" pendingLabel="Escolhendo…">
                          Escolher
                        </SubmitButton>
                      </FormComMensagem>
                    )}
                    <FormComMensagem action={removerOrcamento}>
                      <input type="hidden" name="pedido_interno_id" value={pedidoId} />
                      <input type="hidden" name="orcamento_id" value={o.id} />
                      <SubmitButton size="sm" variant="outline" pendingLabel="Removendo…">
                        Remover
                      </SubmitButton>
                    </FormComMensagem>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {podeGerir && aberto && (
        <FormComMensagem action={registrarOrcamento} className="mt-3 grid gap-2 rounded-md border border-dashed border-border p-3 sm:grid-cols-2">
          <input type="hidden" name="pedido_interno_id" value={pedidoId} />
          <p className="text-xs font-semibold sm:col-span-2">Registrar orçamento</p>
          <label className="grid gap-1 text-xs">
            Fornecedor cadastrado
            <select name="fornecedor_id" className={campo} defaultValue="">
              <option value="">— outro (escreva ao lado) —</option>
              {fornecedores.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            Ou nome do fornecedor
            <input name="fornecedor_nome" maxLength={200} className={campo} placeholder="Quando não está cadastrado" />
          </label>
          <label className="grid gap-1 text-xs">
            Valor total (R$)
            <input name="valor_total" type="number" min="0.01" step="0.01" required inputMode="decimal" className={campo} />
          </label>
          <label className="grid gap-1 text-xs">
            Prazo de entrega (dias)
            <input name="prazo_entrega_dias" type="number" min="0" step="1" inputMode="numeric" className={campo} />
          </label>
          <label className="grid gap-1 text-xs">
            Válido até
            <input name="validade" type="date" className={campo} />
          </label>
          <label className="grid gap-1 text-xs">
            Documento (anexo do pedido)
            <select name="anexo_id" className={campo} defaultValue="">
              <option value="">— anexe na seção Documentos e escolha aqui —</option>
              {anexos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.titulo}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs sm:col-span-2">
            Condições (frete, pagamento, garantia)
            <input name="condicoes" maxLength={1000} className={campo} />
          </label>
          <div className="sm:col-span-2">
            <SubmitButton size="sm" pendingLabel="Registrando…">
              Registrar orçamento
            </SubmitButton>
          </div>
        </FormComMensagem>
      )}
    </section>
  );
}
