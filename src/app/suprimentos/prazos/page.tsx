import Link from "next/link";
import { createClientUntyped } from "@/lib/supabase/server";
import { pode } from "@/lib/auth/permissao-efetiva";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { HelpTip } from "@/components/common/HelpTip";
import {
  amostrasPrazo,
  resumirPrazos,
  type PedidoPrazoRow,
  type ResumoPrazo,
} from "@/lib/suprimentos/prazos-compra";

export const dynamic = "force-dynamic";

const ROTULO_CONFIANCA: Record<ResumoPrazo["confianca"], string> = {
  baixa: "Baixa (menos de 3 compras)",
  media: "Média (3 a 9 compras)",
  alta: "Alta (10 ou mais)",
};

const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const td = "px-3 py-2 text-sm";

function Tabela({ titulo, coluna, linhas }: { titulo: string; coluna: string; linhas: ResumoPrazo[] }) {
  const id = `prazos-${coluna.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className="mt-6" aria-labelledby={id}>
      <h2 id={id} className="mb-2 text-lg font-semibold tracking-tight">{titulo}</h2>
      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        {linhas.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Ainda não há compra recebida para medir.</p>
        ) : (
          <table className="min-w-full">
            <thead className="border-b border-border/70">
              <tr>
                <th className={th}>{coluna}</th>
                <th className={`${th} text-right`}>Compras</th>
                <th className={`${th} text-right`}>Curto</th>
                <th className={`${th} text-right`}>Intermediário</th>
                <th className={`${th} text-right`}>Conservador</th>
                <th className={th}>Confiança</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.chave} className="border-b border-border/50 last:border-b-0">
                  <td className={`${td} font-medium`}>{l.chave}</td>
                  <td className={`${td} text-right tabular-nums`}>{l.n}</td>
                  <td className={`${td} text-right tabular-nums`}>{l.curta} dias</td>
                  <td className={`${td} text-right tabular-nums`}>{l.intermediaria} dias</td>
                  <td className={`${td} text-right tabular-nums`}>{l.conservadora} dias</td>
                  <td className={td}>{ROTULO_CONFIANCA[l.confianca]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export default async function PrazosCompraPage() {
  const podeVer = (await pode("compras.ver")) || (await pode("pedido.ver"));
  if (!podeVer) {
    return (
      <main id="conteudo-principal" className="mx-auto max-w-5xl px-4 py-6">
        <p className="text-sm">Sua função não permite ver os prazos de compra.</p>
      </main>
    );
  }
  const supabase = await createClientUntyped();
  const { data, error } = await supabase
    .from("pedidos_internos")
    .select(
      "id, criado_em, enviado_validacao_em, modalidade_compra, instituicao_destino, pedidos_internos_itens(insumo_id, recebido_em, insumos(especificacao, categoria_compra))",
    )
    .not("status", "eq", "cancelado")
    .order("criado_em", { ascending: false })
    .limit(1000);
  const amostras = amostrasPrazo((data ?? []) as unknown as PedidoPrazoRow[]);
  const porCaminho = resumirPrazos(amostras, (a) => a.caminho);
  const porCategoria = resumirPrazos(amostras, (a) => a.categoria);
  const porInsumo = resumirPrazos(amostras, (a) => `${a.insumo} · ${a.caminho}`).slice(0, 50);

  return (
    <main id="conteudo-principal" className="mx-auto max-w-5xl px-4 py-6">
      <Breadcrumbs items={[{ label: "Suprimentos", href: "/suprimentos" }, { label: "Prazos de compra" }]} />
      <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight">
        Prazos de compra
        <HelpTip title="Como o prazo é medido">
          <p>Conta os dias do envio do pedido interno para validação até o recebimento de cada item. Pedido ainda aberto, atrasado ou cancelado não entra.</p>
          <p><b>Curto</b>: metade das compras chegou até aqui. <b>Intermediário</b>: 3 de cada 4. <b>Conservador</b>: 9 de cada 10.</p>
          <p>O caminho vem da instituição do pedido (por exemplo, Funpar) ou da modalidade (compra direta pela ATGC, fundação, universidade).</p>
        </HelpTip>
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {amostras.length} {amostras.length === 1 ? "item recebido medido" : "itens recebidos medidos"}. Use o prazo conservador para insumo crítico.
        O prazo do fornecedor de cada insumo fica em <Link href="/cadastros/insumos" className="text-primary hover:underline">Cadastros → Insumos</Link>.
      </p>
      {error && <p className="mt-3 text-sm text-danger-strong">Não foi possível ler os pedidos agora. Recarregue a página.</p>}
      <Tabela titulo="Por caminho de compra" coluna="Caminho" linhas={porCaminho} />
      <Tabela titulo="Por categoria" coluna="Categoria" linhas={porCategoria} />
      <Tabela titulo="Por insumo e caminho (50 mais frequentes)" coluna="Insumo" linhas={porInsumo} />
    </main>
  );
}
