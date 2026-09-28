import type { ReactNode } from "react";

import { formatCurrency as brl, formatDate } from "@/lib/formatters";
import type { ModeloDocumentoProposta } from "@/lib/orcamento/documento-proposta";
import { EditarSecaoTexto, type DestinoTextos } from "../texto/EditarSecaoTexto";
import { TextoRico } from "../texto/TextoRico";

/**
 * Documento do cliente (A4 retrato). Folha clara nos dois temas
 * (.folha-documento), igual na tela, no papel/PDF e no link público. Sem
 * <header>/<aside>: a impressão esconde essas tags.
 */
export function DocumentoProposta({
  modelo,
  edicao,
}: {
  modelo: ModeloDocumentoProposta;
  /** presente = textos editáveis (proposta viva ou prévia da elaboração) */
  edicao?: DestinoTextos | null;
}) {
  const cor = modelo.identidade.corPrincipal;
  const { empresa, cliente } = modelo;
  const contatosEmpresa = [empresa.telefone, empresa.email, empresa.site].filter(Boolean).join(" · ");
  const rodape = [empresa.nomeLegal, empresa.cnpj ? `CNPJ ${empresa.cnpj}` : null, `Proposta ${modelo.numero}`]
    .filter(Boolean)
    .join(" · ")
    .replace(/[<>]/g, "");
  const numerados = new Map(modelo.secoes.map((s) => [s.chave, s]));
  // Na edição, seções vazias aparecem (só na tela) para poderem ser preenchidas.
  const secoesTela = edicao
    ? edicao.textos.secoes.map((s) => numerados.get(s.chave) ?? { numero: null, chave: s.chave, titulo: s.titulo, linhasAutomaticas: [], texto: null })
    : modelo.secoes;

  return (
    <article
      aria-label={`Proposta comercial ${modelo.numero}`}
      className="folha-documento mx-auto w-full max-w-[210mm] rounded-lg border border-border text-[13px] leading-relaxed shadow-sm"
    >
      {/* Rodapé de todas as páginas impressas (a numeração vem do @page proposta). */}
      <style>{`@page proposta { @bottom-left { content: ${JSON.stringify(rodape)}; font-size: 7.5pt; color: #475569; } }`}</style>

      <div className="px-6 pb-4 pt-7 sm:px-10">
        <div className="flex flex-wrap items-start justify-between gap-6 sm:flex-nowrap">
          <div className="flex min-w-0 items-start gap-4">
            {/* Mantem <img> no documento imprimivel/PDF para preservar a renderizacao do logo institucional. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={modelo.identidade.logoSrc} alt={modelo.identidade.logoAlt} className="h-14 w-auto shrink-0" />
            <div className="min-w-0 text-xs leading-5 text-muted-foreground">
              <p className="text-sm font-semibold text-foreground">{empresa.nomeLegal}</p>
              {empresa.cnpj && <p>CNPJ {empresa.cnpj}</p>}
              {empresa.endereco && <p>{empresa.endereco}</p>}
              {contatosEmpresa && <p>{contatosEmpresa}</p>}
            </div>
          </div>
          <div className="shrink-0 text-xs leading-5 text-muted-foreground sm:text-right">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Proposta comercial</h1>
            <p className="text-sm font-semibold tabular-nums text-foreground">
              {modelo.rascunho ? "Prévia" : `Nº ${modelo.numero}`}
            </p>
            {!modelo.rascunho && <p>Versão {modelo.versao} · {modelo.statusRotulo}</p>}
            {modelo.emitidoEm && <p>Emitida em {formatDate(modelo.emitidoEm)}</p>}
            {modelo.validoAte && <p>Válida até {formatDate(modelo.validoAte)}</p>}
            {modelo.rascunho && <p>{modelo.statusRotulo}</p>}
          </div>
        </div>
        <div className="mt-5 h-1 rounded-full" style={{ backgroundColor: cor }} />
      </div>

      <div className="manter-junto grid gap-4 px-6 sm:grid-cols-[1.55fr_1fr] sm:px-10">
        <div className="rounded-md border border-border px-4 py-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cliente</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
            <Dado rotulo="Razão social" valor={cliente.nome} forte />
            <Dado rotulo="CNPJ/CPF" valor={cliente.documento} />
            <Dado rotulo="Endereço" valor={cliente.endereco} />
            <Dado rotulo="Contato" valor={cliente.contato} />
            <Dado rotulo="E-mail" valor={cliente.email} />
            <Dado rotulo="Telefone" valor={cliente.telefone} />
          </dl>
        </div>
        <div className="rounded-md border px-4 py-3" style={{ borderColor: cor }}>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Valor total</p>
          <p className="text-2xl font-semibold tabular-nums" style={{ color: cor }}>{brl(modelo.resumo.total)}</p>
          <p className="text-xs text-muted-foreground">impostos inclusos</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {modelo.resumo.prazoDias && <Dado rotulo="Prazo" valor={`${modelo.resumo.prazoDias} dias`} />}
            {modelo.resumo.amostras && <Dado rotulo="Amostras" valor={String(modelo.resumo.amostras)} />}
            {modelo.validadeDias && <Dado rotulo="Validade" valor={`${modelo.validadeDias} dias`} />}
          </dl>
        </div>
      </div>

      <Secao numero={modelo.numeracao.objeto} titulo="Objeto" cor={cor}>
        <p className="font-semibold">{modelo.objeto.titulo}</p>
        {modelo.objeto.modalidade && <p className="text-xs text-muted-foreground">{modelo.objeto.modalidade}</p>}
        <Editavel edicao={edicao} alvo={{ tipo: "descricao" }} titulo="Descrição da proposta">
          {modelo.objeto.descricao ? (
            <TextoRico doc={modelo.objeto.descricao} className="mt-2" />
          ) : edicao ? (
            <p className="no-print mt-2 text-xs italic text-muted-foreground">Sem descrição: use Editar para escrever o texto do cliente.</p>
          ) : null}
        </Editavel>
      </Secao>

      {modelo.escopo && modelo.numeracao.escopo && (
        <Secao numero={modelo.numeracao.escopo} titulo="Escopo técnico" cor={cor}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
            <Dado rotulo="Matriz" valor={modelo.escopo.matriz} />
            <Dado rotulo="Amostras" valor={modelo.escopo.amostras ? `${modelo.escopo.amostras} amostras` : null} />
            <Dado rotulo="Análises" valor={modelo.escopo.analises.length ? modelo.escopo.analises.join(" · ") : null} />
            <Dado
              rotulo="Prazo técnico"
              valor={modelo.escopo.prazoDias ? `${modelo.escopo.prazoDias} dias a partir do recebimento das amostras` : null}
            />
          </dl>
        </Secao>
      )}

      <Secao numero={modelo.numeracao.servicos} titulo="Serviços e valores" cor={cor} permiteQuebra>
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b-2 text-xs uppercase tracking-wide text-muted-foreground" style={{ borderBottomColor: cor }}>
              <th scope="col" className="py-1.5 pr-3 font-semibold">Item</th>
              <th scope="col" className="w-[16%] py-1.5 pr-3 text-right font-semibold">Qtd.</th>
              <th scope="col" className="w-[18%] py-1.5 pr-3 text-right font-semibold">Valor unit.</th>
              <th scope="col" className="w-[18%] py-1.5 text-right font-semibold">Valor total</th>
            </tr>
          </thead>
          {modelo.servicos.grupos.map((grupo) => (
            <tbody key={grupo.id} className="divide-y divide-border">
              <tr className="bg-muted/60">
                <td colSpan={3} className="px-1 py-1 font-semibold">{grupo.titulo}</td>
                <td className="px-0 py-1 text-right font-semibold tabular-nums">{brl(grupo.subtotal)}</td>
              </tr>
              {grupo.itens.map((item, i) => (
                <tr key={`${grupo.id}-${i}`}>
                  <td className="py-1.5 pl-3 pr-3 align-top">{item.descricao}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-right align-top tabular-nums">{item.quantidade}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-right align-top tabular-nums">{brl(item.valorUnitario)}</td>
                  <td className="whitespace-nowrap py-1.5 text-right align-top tabular-nums">{brl(item.valorTotal)}</td>
                </tr>
              ))}
            </tbody>
          ))}
          <tbody>
            <tr className="border-t-2 border-foreground/70">
              <th scope="row" colSpan={3} className="py-2 pr-3 text-right font-semibold">Total (impostos inclusos)</th>
              <td className="whitespace-nowrap py-2 text-right text-base font-semibold tabular-nums">{brl(modelo.servicos.total)}</td>
            </tr>
          </tbody>
        </table>
        {modelo.servicos.grupos.length === 0 && (
          <p className="py-3 text-center text-sm text-muted-foreground">Nenhum item nesta proposta.</p>
        )}
      </Secao>

      {secoesTela.map((secao) => (
        <Secao key={secao.chave} numero={secao.numero} titulo={secao.titulo} cor={cor} somenteTela={secao.numero == null}>
          {secao.linhasAutomaticas.map((linha) => (
            <p key={linha}>{linha}</p>
          ))}
          <Editavel edicao={edicao} alvo={{ tipo: "secao", chave: secao.chave }} titulo={secao.titulo}>
            {secao.texto ? (
              <TextoRico doc={secao.texto} className={secao.linhasAutomaticas.length ? "mt-1" : ""} />
            ) : (
              <p className="text-xs italic text-muted-foreground">Seção vazia: não sai no documento. Use Editar para incluir.</p>
            )}
          </Editavel>
        </Secao>
      ))}

      <Secao numero={modelo.numeracao.aceite} titulo="Aceite" cor={cor}>
        <p>De acordo com os termos desta proposta.</p>
        <div className="mt-8 grid gap-10 sm:grid-cols-2">
          <Assinatura titulo="Pela proponente" nome={empresa.nomeLegal} />
          <Assinatura titulo="De acordo, pelo cliente" nome={cliente.nome === "—" ? "Nome e cargo" : cliente.nome} />
        </div>
      </Secao>

      <footer className="proposal-footer mt-6 flex flex-wrap justify-between gap-2 border-t border-border px-6 py-3 text-xs text-muted-foreground sm:px-10">
        <span>{[empresa.nomeLegal, empresa.cnpj ? `CNPJ ${empresa.cnpj}` : null].filter(Boolean).join(" · ")}</span>
        <span>
          {modelo.rascunho ? "Prévia da proposta" : `Proposta ${modelo.numero} · versão ${modelo.versao}`}
        </span>
      </footer>
    </article>
  );
}

function Secao({
  numero,
  titulo,
  cor,
  permiteQuebra = false,
  somenteTela = false,
  children,
}: {
  numero: number | null;
  titulo: string;
  cor: string;
  permiteQuebra?: boolean;
  somenteTela?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`px-6 pt-5 sm:px-10 ${permiteQuebra ? "permite-quebra" : ""} ${somenteTela ? "no-print opacity-70" : ""}`}>
      <h2
        className="mb-2 border-b pb-1 text-xs font-semibold uppercase tracking-wider"
        style={{ color: cor, borderBottomColor: "var(--border)" }}
      >
        {numero != null ? `${numero}. ` : ""}
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Editavel({
  edicao,
  alvo,
  titulo,
  children,
}: {
  edicao?: DestinoTextos | null;
  alvo: { tipo: "descricao" } | { tipo: "secao"; chave: string };
  titulo: string;
  children: ReactNode;
}) {
  if (!edicao) return <>{children}</>;
  return (
    <EditarSecaoTexto alvo={alvo} titulo={titulo} destino={edicao}>
      {children}
    </EditarSecaoTexto>
  );
}

function Dado({ rotulo, valor, forte = false }: { rotulo: string; valor: string | null | undefined; forte?: boolean }) {
  if (!valor) return null;
  return (
    <>
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className={forte ? "font-semibold" : ""}>{valor}</dd>
    </>
  );
}

function Assinatura({ titulo, nome }: { titulo: string; nome: string }) {
  return (
    <div className="manter-junto">
      <div className="h-10 border-b border-foreground/60" />
      <p className="mt-1.5 text-sm font-semibold">{nome}</p>
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-xs text-muted-foreground">Data: ____/____/________</p>
    </div>
  );
}
