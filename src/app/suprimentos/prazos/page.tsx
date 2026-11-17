import Link from "next/link";
import { createClientUntyped } from "@/lib/supabase/server";
import { pode } from "@/lib/auth/permissao-efetiva";
import { PageHeader } from "@/components/app/PageHeader";
import { HelpTip } from "@/components/common/HelpTip";
import {
  amostrasPrazo,
  resumirPrazos,
  type PedidoPrazoRow,
  type ResumoPrazo,
} from "@/lib/suprimentos/prazos-compra";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

const ROTULO_CONFIANCA: Record<ResumoPrazo["confianca"], string> = {
  baixa: "Baixa (menos de 3 compras)",
  media: "Média (3 a 9 compras)",
  alta: "Alta (10 ou mais)",
};

function Tabela({ titulo, coluna, linhas }: { titulo: string; coluna: string; linhas: ResumoPrazo[] }) {
  const id = `prazos-${coluna.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className="mt-6 max-w-5xl" aria-labelledby={id}>
      <h2 id={id} className="mb-2 text-lg font-semibold tracking-tight">{titulo}</h2>
      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        {linhas.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Ainda não há compra recebida para medir.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{coluna}</TableHead>
                <TableHead className="text-right">Compras</TableHead>
                <TableHead className="text-right">Curto</TableHead>
                <TableHead className="text-right">Intermediário</TableHead>
                <TableHead className="text-right">Conservador</TableHead>
                <TableHead>Confiança</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.chave}>
                  <TableCell className="font-medium">{l.chave}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.n}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.curta} dias</TableCell>
                  <TableCell className="text-right tabular-nums">{l.intermediaria} dias</TableCell>
                  <TableCell className="text-right tabular-nums">{l.conservadora} dias</TableCell>
                  <TableCell>{ROTULO_CONFIANCA[l.confianca]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}

export default async function PrazosCompraPage() {
  const podeVer = (await pode("compras.ver")) || (await pode("pedido.ver"));
  if (!podeVer) {
    return (
      <main className="app-page-container">
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
    <main className="app-page-container">
      <PageHeader
        breadcrumbs={[{ label: "Pedidos", href: "/pedido" }, { label: "Prazos de compra" }]}
        title="Prazos de compra"
        help={
          <HelpTip title="Como o prazo é medido">
            <p>Conta os dias do envio do pedido para aprovação até a chegada de cada item. Pedido ainda aberto, atrasado ou cancelado não entra.</p>
            <p><b>Curto</b>: metade das compras chegou até aqui. <b>Intermediário</b>: 3 de cada 4. <b>Conservador</b>: 9 de cada 10.</p>
            <p>O caminho vem da instituição do pedido (por exemplo, Funpar) ou da modalidade (compra direta pela ATGC, fundação, universidade).</p>
          </HelpTip>
        }
        description={
          <>
            {amostras.length} {amostras.length === 1 ? "item recebido medido" : "itens recebidos medidos"}. Use o prazo conservador para insumo crítico.
            O prazo do fornecedor de cada insumo fica em <Link href="/cadastros/insumos" className="text-primary underline underline-offset-2">Cadastros → Insumos</Link>.
          </>
        }
      />
      {error && <p className="mt-3 text-sm text-danger-strong">Não foi possível ler os pedidos agora. Recarregue a página.</p>}
      <Tabela titulo="Por caminho de compra" coluna="Caminho" linhas={porCaminho} />
      <Tabela titulo="Por categoria" coluna="Categoria" linhas={porCategoria} />
      <Tabela titulo="Por insumo e caminho (50 mais frequentes)" coluna="Insumo" linhas={porInsumo} />
    </main>
  );
}
