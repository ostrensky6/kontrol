import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { HelpTip } from "@/components/common/HelpTip";
import { SubmitButton } from "@/components/common/SubmitButton";
import { EditorSecaoPadrao } from "@/components/orcamento/documento/EditorSecaoPadrao";
import { FormEstado } from "@/components/orcamento/FormEstado";
import { Input } from "@/components/ui/input";
import { salvarEmpresaEmissora, salvarSecaoPadrao } from "@/lib/actions/orcamento-textos";
import { pode } from "@/lib/auth/permissao-efetiva";
import { podeOrcamento } from "@/lib/orcamento/governanca";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const EMPRESAS = [
  { codigo: "ATGC" as const, rotulo: "ATGC Genética Ambiental" },
  { codigo: "GIA" as const, rotulo: "GIA / UFPR" },
];

/**
 * Orçamentos › Documento da proposta (28/09): dados cadastrais de cada empresa
 * emissora (cabeçalho e rodapé) e as seções padrão do texto da proposta.
 */
export default async function DocumentoPropostaPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  const { empresa: empresaParam } = await searchParams;
  const empresaAtiva = EMPRESAS.find((e) => e.codigo === empresaParam) ?? EMPRESAS[0];
  const [podeCadastro, podeTextos] = await Promise.all([pode("cadastros.editar"), podeOrcamento("emitir_final")]);
  const supabase = await createClient();
  const [{ data: empresa }, { data: secoes }] = await Promise.all([
    supabase.from("empresas_emissoras").select("*").eq("codigo", empresaAtiva.codigo).maybeSingle(),
    supabase
      .from("proposta_secoes_padrao")
      .select("chave, titulo, texto, ordem, ativo")
      .eq("empresa_codigo", empresaAtiva.codigo)
      .order("ordem")
      .order("chave"),
  ]);

  const campo = "mt-1 h-8";
  const rotulo = "text-xs font-medium text-muted-foreground";

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <Breadcrumbs items={[{ label: "Orçamentos", href: "/orcamento" }, { label: "Documento da proposta" }]} />
        <div className="mt-3 flex items-center gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Documento da proposta</h1>
          <HelpTip title="Documento da proposta">
            <p>Dados da empresa que aparecem no <b>cabeçalho e no rodapé</b> da proposta, e as <b>seções padrão</b> do texto (prazos, responsabilidades, condições, confidencialidade…).</p>
            <p>Valem para as <b>próximas emissões</b>: cada proposta copia os textos ao ser emitida e pode ajustá-los depois, sem mexer no padrão.</p>
          </HelpTip>
        </div>

        <nav aria-label="Empresa emissora" className="mt-4 flex gap-1 border-b border-border">
          {EMPRESAS.map((e) => (
            <a
              key={e.codigo}
              href={`/orcamento/documento-proposta?empresa=${e.codigo}`}
              aria-current={e.codigo === empresaAtiva.codigo ? "page" : undefined}
              className={`border-b-2 px-4 py-2 text-sm ${
                e.codigo === empresaAtiva.codigo
                  ? "border-brand-600 font-semibold text-brand-800 dark:border-brand-400 dark:text-brand-200"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {e.rotulo}
            </a>
          ))}
        </nav>

        <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <section aria-labelledby="dados-empresa" className="h-fit rounded-lg border border-border bg-card p-4 shadow-sm">
            <h2 id="dados-empresa" className="text-sm font-semibold">Dados cadastrais</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Cabeçalho, rodapé e assinatura da proposta.</p>
            {!empresa ? (
              <p className="mt-3 text-sm text-warning-strong">Cadastro da empresa não encontrado: a migration 0135 ainda não foi aplicada neste banco.</p>
            ) : (
              <FormEstado action={salvarEmpresaEmissora} className="mt-3 grid grid-cols-12 gap-x-3 gap-y-2">
                <input type="hidden" name="codigo" value={empresaAtiva.codigo} />
                <div className="col-span-12">
                  <label htmlFor="emp-nome" className={rotulo}>Razão social</label>
                  <Input id="emp-nome" name="nome_legal" defaultValue={empresa.nome_legal} required disabled={!podeCadastro} className={campo} />
                </div>
                <div className="col-span-12 sm:col-span-5">
                  <label htmlFor="emp-cnpj" className={rotulo}>CNPJ</label>
                  <Input id="emp-cnpj" name="cnpj" defaultValue={empresa.cnpj ?? ""} placeholder="00.000.000/0000-00" disabled={!podeCadastro} className={campo} />
                </div>
                <div className="col-span-12 sm:col-span-7">
                  <label htmlFor="emp-tel" className={rotulo}>Telefone</label>
                  <Input id="emp-tel" name="telefone" defaultValue={empresa.telefone ?? ""} placeholder="(41) 0000-0000" disabled={!podeCadastro} className={campo} />
                </div>
                <div className="col-span-12">
                  <label htmlFor="emp-end" className={rotulo}>Endereço</label>
                  <Input id="emp-end" name="endereco" defaultValue={empresa.endereco ?? ""} placeholder="Rua, número · cidade/UF · CEP" disabled={!podeCadastro} className={campo} />
                </div>
                <div className="col-span-12 sm:col-span-6">
                  <label htmlFor="emp-email" className={rotulo}>E-mail</label>
                  <Input id="emp-email" name="email" type="email" defaultValue={empresa.email ?? ""} disabled={!podeCadastro} className={campo} />
                </div>
                <div className="col-span-12 sm:col-span-6">
                  <label htmlFor="emp-site" className={rotulo}>Site</label>
                  <Input id="emp-site" name="site" defaultValue={empresa.site ?? ""} placeholder="www.exemplo.com.br" disabled={!podeCadastro} className={campo} />
                </div>
                <div className="col-span-12 flex items-center justify-end">
                  {podeCadastro ? (
                    <SubmitButton size="sm">Salvar dados</SubmitButton>
                  ) : (
                    <span className="text-xs text-muted-foreground">Somente consulta: alterar exige a permissão “Cadastros: editar”.</span>
                  )}
                </div>
              </FormEstado>
            )}
          </section>

          <section aria-labelledby="secoes-padrao" className="space-y-3">
            <div>
              <h2 id="secoes-padrao" className="text-sm font-semibold">Seções padrão do texto</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Entram depois de Objeto, Escopo técnico e Serviços e valores, na ordem abaixo. Seção inativa ou vazia não sai no documento.
                {!podeTextos && " Alterar exige a permissão “Orçamentos: Emitir proposta”."}
              </p>
            </div>
            {(secoes ?? []).map((s) => (
              <EditorSecaoPadrao
                key={s.chave}
                empresa={empresaAtiva.codigo}
                secao={{ chave: s.chave, titulo: s.titulo, texto: s.texto, ordem: s.ordem, ativo: s.ativo }}
                action={salvarSecaoPadrao}
                podeEditar={podeTextos}
              />
            ))}
            {podeTextos && (
              <details className="rounded-md border border-dashed border-border px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium text-primary">Nova seção</summary>
                <div className="mt-2">
                  <EditorSecaoPadrao empresa={empresaAtiva.codigo} action={salvarSecaoPadrao} podeEditar />
                </div>
              </details>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
