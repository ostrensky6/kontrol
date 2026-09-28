import Link from "next/link";
import { HelpTip } from "@/components/common/HelpTip";
import { TriagemCodigoDesconhecidoForm } from "@/components/scanner/TriagemCodigoDesconhecidoForm";
import { prepararTriagemCadastro } from "@/lib/scanner/triagem";

export const dynamic = "force-dynamic";

type SearchParams = {
  codigo?: string;
  triagem?: string;
};

const FORMATO_LABEL: Record<string, string> = {
  kontrol_interno: "Código do Kontrol",
  url_kontrol: "Link do Kontrol",
  desconhecido: "Não reconhecido",
};

const TIPO_LABEL: Record<string, string> = {
  insumo: "Insumo",
  insumo_produto: "Produto de insumo",
  lote: "Lote",
  equipamento: "Equipamento",
  equipamento_unidade: "Unidade de equipamento",
  local: "Local",
  pedido_compra: "Pedido de compra",
  pedido_interno: "Pedido interno",
  planejamento: "Planejamento",
};

function mensagemTriagem(status?: string) {
  if (status === "registrada") {
    return "Triagem registrada como pendente.";
  }
  if (status === "existente") {
    return "Já existe uma triagem pendente para este código.";
  }
  return null;
}

export default async function CodigoDesconhecidoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { codigo: codigoRaw = "", triagem } = await searchParams;
  const codigo = codigoRaw.trim();
  const detalhes = codigo ? prepararTriagemCadastro(codigo) : null;
  const mensagem = mensagemTriagem(triagem);

  return (
    <main className="mx-auto max-w-lg px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex items-center gap-1">
        <h1 className="text-xl font-semibold text-foreground">Código não encontrado</h1>
        <HelpTip title="Código não encontrado">
          <p>
            Nenhum item, lote ou equipamento cadastrado tem este código. Registre uma{" "}
            <b>triagem</b>: alguém confere depois e vincula o código ao cadastro certo.
          </p>
          <p>Assim não se cria um cadastro pela metade.</p>
        </HelpTip>
      </div>

      {codigo ? (
        <>
          <p className="mt-4 rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">
            {codigo}
          </p>
          <dl className="mt-4 grid gap-2 rounded-md border border-border p-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Formato</dt>
              <dd className="font-medium text-foreground">
                {FORMATO_LABEL[detalhes?.formato ?? "desconhecido"] ?? detalhes?.formato}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Tipo sugerido</dt>
              <dd className="font-medium text-foreground">
                {detalhes?.tipoSugerido ? TIPO_LABEL[detalhes.tipoSugerido] ?? detalhes.tipoSugerido : "Não identificado"}
              </dd>
            </div>
          </dl>
          {mensagem && (
            <p className="mt-4 rounded-md border border-success-strong/30 bg-success-soft px-3 py-2 text-sm text-success-strong">
              {mensagem}
            </p>
          )}
          <TriagemCodigoDesconhecidoForm codigo={codigo} />
          <Link
            href="/scanner/triagem"
            className="mt-3 inline-flex text-sm font-medium text-brand-700 hover:text-brand-600 dark:text-brand-300"
          >
            Ver triagens pendentes
          </Link>
        </>
      ) : (
        <form method="get" className="mt-4 grid gap-2">
          <label htmlFor="codigo-manual" className="text-sm font-medium text-foreground">
            Digite o código lido
          </label>
          <div className="flex gap-2">
            <input
              id="codigo-manual"
              name="codigo"
              required
              autoComplete="off"
              placeholder="Ex.: código de barras do fornecedor"
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm"
            />
            <button className="rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Continuar
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
