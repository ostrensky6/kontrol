import Link from "next/link";
import { statusInfo } from "@/components/app/status";
import { AprovarCompra, EncerrarComPendencia, MarcarCompraEnviada } from "@/components/compras/PedidoAcoes";
import { HelpTip } from "@/components/common/HelpTip";
import { SubmitButton } from "@/components/common/SubmitButton";
import { FormComMensagem } from "@/components/pedido/FormComMensagem";
import { definirFornecedorCompra } from "@/lib/actions/compras";
import { formatDate } from "@/lib/formatters";
import { compraAceitaChegada } from "@/lib/pedido/chegada-pela-compra";
import {
  ANCORA_PAINEL_COMPRA,
  compraEmAndamento,
  compraSemFornecedor,
  envioDaCompra,
  fornecedorCadastradoComNome,
  type ChegadaDaCompra,
  type CompraDoPedido,
} from "@/lib/pedido/compra-do-pedido";
import { CLASSE_CAMPO_PEDIDO } from "@/lib/pedido/detalhe";

type Props = {
  pedidoId: number;
  pedidoStatus: string;
  compra: CompraDoPedido;
  /** null: a leitura dos itens da compra falhou (a tela já avisa no topo) */
  chegada: ChegadaDaCompra | null;
  orcamentoEscolhido: { fornecedor_id: number | null; fornecedor_nome: string } | null;
  fornecedores: { id: number; nome: string }[];
  /** permissão "Aprovar compras": fornecedor, envio e encerrar com pendência */
  podeAprovarCompra: boolean;
  /** hoje em Brasília (aaaa-mm-dd), para dizer se a entrega atrasou */
  hoje: string;
};

const CLASSE_LINK = "rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-muted";

/**
 * Painel "Compra" do pedido (compra única na tela, auditoria de 16/11, item 10,
 * proposta 2). A compra que nasceu do pedido é conduzida aqui: fornecedor,
 * situação, previsão, chegada, envio pela instituição, pendência e impressão.
 * A tela da compra fica para consulta.
 */
export function PedidoCompraPainel({
  pedidoId,
  pedidoStatus,
  compra,
  chegada,
  orcamentoEscolhido,
  fornecedores,
  podeAprovarCompra,
  hoje,
}: Props) {
  const situacao = statusInfo(compra.status).label;
  const fornecedor = compra.fornecedores?.nome ?? null;
  const semFornecedor = compraSemFornecedor(compra);
  const nomeNoOrcamento = orcamentoEscolhido?.fornecedor_nome?.trim() || null;
  const sugerido = fornecedorCadastradoComNome(nomeNoOrcamento, fornecedores);
  const envio = envioDaCompra(pedidoStatus, compra.status);
  const emAndamento = compraEmAndamento(compra.status);
  const prevista = compra.data_prevista_entrega ?? null;
  const atrasada = emAndamento && prevista != null && prevista.slice(0, 10) < hoje;

  return (
    <section
      id={ANCORA_PAINEL_COMPRA}
      aria-labelledby="painel-compra-titulo"
      data-testid="painel-compra"
      className="mt-3 scroll-mt-20 rounded-lg border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="painel-compra-titulo" className="text-sm font-semibold">
            Compra #{compra.id}
          </h2>
          <span data-testid="painel-compra-situacao" className="rounded-full bg-muted px-3 py-1 text-xs font-medium">
            {situacao}
          </span>
          <HelpTip title="A compra é conduzida aqui">
            <p>
              A compra nasce do pedido e segue com ele: fornecedor, envio, chegada e pendência ficam neste
              quadro e na tabela de itens. A tela da compra serve para consulta e impressão.
            </p>
            <p>
              <b>Fechar com fornecedor</b> já marca a compra como enviada e calcula a previsão de entrega.
              Pela Fundação ou Universidade são dois momentos: <b>Encaminhar à instituição</b> e, depois,{" "}
              <b>Instituição enviou ao fornecedor</b>.
            </p>
          </HelpTip>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/compras/${compra.id}/imprimir`} className={CLASSE_LINK}>
            Imprimir / PDF
          </Link>
          <Link href={`/compras/${compra.id}`} className={CLASSE_LINK}>
            Consultar a compra
          </Link>
        </div>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Fornecedor</dt>
          <dd className="font-medium" data-testid="painel-compra-fornecedor">
            {fornecedor ?? (
              <span className="text-warning-strong">
                {semFornecedor ? "Falta definir" : "—"}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Previsão de entrega</dt>
          <dd className="font-medium" data-testid="painel-compra-previsao">
            {prevista ? formatDate(prevista) : <span className="text-muted-foreground">sem previsão</span>}
            {atrasada && (
              <span className="ml-2 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger-strong">
                Atrasada
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Chegada</dt>
          <dd className="font-medium" data-testid="painel-compra-chegada">
            {chegada == null
              ? "sem dado"
              : chegada.itens === 0
                ? "—"
                : `${chegada.completos} de ${chegada.itens} ${chegada.itens === 1 ? "item recebido" : "itens recebidos"}`}
          </dd>
          {compraAceitaChegada(compra.status) && chegada != null && chegada.completos < chegada.itens && (
            <dd className="text-xs text-muted-foreground">Registre a chegada na linha do item, na tabela abaixo.</dd>
          )}
        </div>
      </dl>

      {semFornecedor && (
        <div
          role="note"
          data-testid="painel-compra-sem-fornecedor"
          className="mt-3 rounded-md border border-warning-strong/30 bg-warning-soft px-3 py-2 text-sm"
        >
          <p>
            {nomeNoOrcamento
              ? sugerido
                ? `O orçamento escolhido traz o nome “${nomeNoOrcamento}”, que está no cadastro. Confirme para ele sair no pedido impresso.`
                : `O orçamento escolhido traz só o nome “${nomeNoOrcamento}”, que não está no cadastro de fornecedores.`
              : "Esta compra está sem fornecedor: sem ele o pedido impresso sai incompleto."}
          </p>
          {podeAprovarCompra ? (
            <FormComMensagem action={definirFornecedorCompra} className="mt-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="pedido_id" value={compra.id} />
              <input type="hidden" name="pedido_interno_id" value={pedidoId} />
              <div>
                <label htmlFor="painel-compra-fornecedor" className="block text-xs text-muted-foreground">
                  Fornecedor da compra
                </label>
                <select
                  id="painel-compra-fornecedor"
                  name="fornecedor_id"
                  required
                  defaultValue={sugerido ? String(sugerido.id) : ""}
                  className={CLASSE_CAMPO_PEDIDO}
                >
                  <option value="" disabled>
                    Selecione…
                  </option>
                  {fornecedores.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
              </div>
              <SubmitButton size="sm" pendingLabel="Salvando…">
                Definir fornecedor
              </SubmitButton>
              {!sugerido && (
                <Link href="/cadastros/fornecedores" className="text-sm font-medium text-primary hover:underline">
                  Cadastrar fornecedor
                </Link>
              )}
            </FormComMensagem>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Definir o fornecedor exige a permissão “Aprovar compras”.</p>
          )}
        </div>
      )}

      {compra.status === "solicitado" && (
        <div className="mt-3 flex flex-wrap items-start gap-3" data-testid="painel-compra-aprovacao">
          {podeAprovarCompra ? <AprovarCompra pedidoId={compra.id} /> : null}
          <p className="max-w-xl text-xs text-muted-foreground">
            A compra é aprovada junto com o pedido. Esta continua solicitada, o que acontece quando ela atende
            também outro pedido. Se ele ainda não chegou à aprovação final, a aprovação é recusada e a mensagem diz
            qual pedido falta.
            {podeAprovarCompra ? "" : " Aprovar a compra exige a permissão “Aprovar compras”."}
          </p>
        </div>
      )}

      {envio === "no_fechamento" && (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="painel-compra-envio">
          “Fechar com fornecedor” já marca esta compra como enviada e calcula a previsão de entrega. Pela Fundação
          ou Universidade, use “Encaminhar à instituição”: o envio ao fornecedor é registrado aqui depois.
        </p>
      )}
      {(envio === "instituicao" || envio === "pendente") && (
        <div className="mt-3 flex flex-wrap items-start gap-3" data-testid="painel-compra-envio">
          {podeAprovarCompra ? (
            <MarcarCompraEnviada
              pedidoId={compra.id}
              label={envio === "instituicao" ? "Instituição enviou ao fornecedor" : "Marcar compra como enviada"}
            />
          ) : null}
          <p className="max-w-xl text-xs text-muted-foreground">
            {envio === "instituicao"
              ? "Quando a instituição fizer o pedido ao fornecedor, registre aqui: a compra passa a enviada e a previsão de entrega é calculada."
              : "O pedido foi fechado, mas o envio ao fornecedor ainda não está registrado na compra."}
            {podeAprovarCompra ? "" : " Registrar o envio exige a permissão “Aprovar compras”."}
          </p>
        </div>
      )}

      {chegada?.temRecebimento && emAndamento && (
        <div className="mt-4 border-t border-border/70 pt-3" data-testid="painel-compra-pendencia">
          <h3 className="text-sm font-semibold">Faltou item?</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Se o restante não vai chegar nesta compra, encerre com pendência e diga o destino do que faltou.
          </p>
          <div className="mt-2">
            {podeAprovarCompra ? (
              <EncerrarComPendencia pedidoId={compra.id} />
            ) : (
              <p className="text-xs text-muted-foreground">Encerrar com pendência exige a permissão “Aprovar compras”.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
