"use client";

import { Fragment, useActionState, useEffect, useState, type ReactNode } from "react";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";
import { useRouter } from "next/navigation";
import type { Campo } from "@/lib/cadastros/config";
import {
  comPessoasNovas,
  papelDaNovaPessoa,
  type OpcaoPessoa,
  type PreAprovadoOpcao,
} from "@/lib/cadastros/pessoas";
import { NovaPessoaDialog } from "@/components/cadastros/NovaPessoaDialog";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import type { LoteBaixa } from "@/lib/estoque/baixa";
import { salvarRegistro, type FormState } from "@/lib/actions/cadastros";
import { cn } from "@/lib/utils";
import { CodigosBarrasCampo } from "@/components/cadastros/CodigosBarrasCampo";
import type { Registro } from "@/components/cadastros/crud/apoio";
import { LotesInsumoResumo } from "@/components/cadastros/crud/LotesInsumoResumo";
import { CampoInput, rotuloDoCampo } from "@/components/cadastros/crud/CampoInput";

/**
 * Seção de cada campo no formulário. O título vem do primeiro campo do grupo
 * na configuração e vale até o próximo; assim, esconder o primeiro campo de um
 * grupo (oculto) não apaga o título da seção.
 */
function camposComSecao(campos: Campo[], criando: boolean) {
  let grupo: string | undefined;
  const visiveis: { campo: Campo; grupo?: string }[] = [];
  for (const campo of campos) {
    if (campo.grupo) grupo = campo.grupo;
    if (campo.oculto || campo.bloco) continue;
    visiveis.push({ campo, grupo });
  }
  let anterior: string | undefined;
  return {
    formulario: visiveis.map(({ campo, grupo: secao }) => {
      const titulo = secao !== anterior ? secao : undefined;
      anterior = secao;
      return { campo, titulo };
    }),
    estoqueInicial: criando ? campos.filter((campo) => campo.bloco === "estoque_inicial" && !campo.oculto) : [],
  };
}

function TituloSecao({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-2 border-b border-border pb-1 text-xs font-semibold text-muted-foreground sm:col-span-2">
      {children}
    </h3>
  );
}

export function CadastroDrawer({
  open,
  slug,
  singular,
  campos,
  registro,
  onOpenChange,
  onClose,
  onSalvo,
  podeMovimentarEstoque,
  podeCorrigirEstoque,
  podeCadastrarPessoa,
  preAprovados,
  codigosNovo = [],
}: {
  open: boolean;
  slug: string;
  singular: string;
  campos: Campo[];
  registro: Registro | null;
  onOpenChange: (open: boolean) => void;
  onClose: () => void;
  onSalvo: (estado: FormState) => void;
  podeMovimentarEstoque: boolean;
  podeCorrigirEstoque: boolean;
  podeCadastrarPessoa: boolean;
  preAprovados: PreAprovadoOpcao[];
  codigosNovo?: string[];
}) {
  const router = useRouter();
  // pessoa cadastrada sem sair do formulário: entra nas listas de usuário e já vem escolhida no campo
  const [novaPessoa, setNovaPessoa] = useState<{ campo: Campo; nome?: string; email?: string } | null>(null);
  // pré-aprovado que ganhou conta aqui: sai das opções de pré-aprovados
  const [emailsComContaAgora, setEmailsComContaAgora] = useState<string[]>([]);
  const preAprovadosAbertos = preAprovados.filter((pre) => !emailsComContaAgora.includes(pre.email));
  const [pessoasNovas, setPessoasNovas] = useState<OpcaoPessoa[]>([]);
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [state, action] = useActionState<FormState, FormData>(
    salvarRegistro,
    { ok: false },
  );
  // Estavel enquanto o drawer ficar aberto: um reenvio (duplo clique, retry
  // de rede) usa o mesmo id e a RPC de criação devolve o resultado anterior
  // em vez de duplicar o insumo/lote.
  const [operacaoId] = useState(() => crypto.randomUUID());
  const isInsumos = slug === "insumos";
  const quantidadeModelo = isInsumos ? (registro?.quantidade_modelo as string | null | undefined) : null;
  const podeCorrigirQuantidade = isInsumos && registro?.id != null && quantidadeModelo !== "LEGADO";
  const { formulario, estoqueInicial } = camposComSecao(comPessoasNovas(campos, pessoasNovas), !registro);

  useEffect(() => {
    if (!state.ok) return;
    onSalvo(state);
    router.refresh();
    onClose();
  }, [state, router, onClose, onSalvo]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            {registro ? `Editar ${singular}` : `Novo ${singular}`}
          </DrawerTitle>
          <DrawerDescription className="sr-only">
            Preencha os campos obrigatórios e salve para atualizar o cadastro.
          </DrawerDescription>
        </DrawerHeader>

        {isInsumos && registro?.id != null && (
          <LotesInsumoResumo
            insumoId={Number(registro.id)}
            especificacao={String(registro.especificacao ?? singular)}
            unidade={typeof registro.unidade === "string" ? registro.unidade : null}
            quantidadeAtual={Number(registro.quantidade ?? 0)}
            podeCorrigirQuantidade={podeCorrigirQuantidade && podeCorrigirEstoque}
            podeMovimentar={podeMovimentarEstoque}
            lotes={(registro.lotes_resumo as LoteBaixa[] | undefined) ?? []}
          />
        )}

        <form action={action} {...formularioSemPerda(state)} className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <input type="hidden" name="_slug" value={slug} />
          <input type="hidden" name="_operacao_id" value={operacaoId} />
          {registro?.id != null && (
            <input type="hidden" name="_id" value={String(registro.id)} />
          )}

          {formulario.map(({ campo: c, titulo }) => (
            <Fragment key={c.name}>
              {titulo && <TituloSecao>{titulo}</TituloSecao>}
              <CampoInput
                campo={c}
                valor={registro?.[c.name]}
                erro={state.errors?.[c.name]}
                escolhida={escolhas[c.name]}
                podeCadastrarPessoa={podeCadastrarPessoa}
                aoCadastrarPessoa={(preenchido) => setNovaPessoa({ campo: c, ...preenchido })}
                registro={registro}
                rotuloOrigem={rotuloDoCampo(campos, c.nomeSugeridoDe)}
                preAprovados={c.opcoesDe === "perfis" ? preAprovadosAbertos : []}
                aoEscolherPessoa={(id) => setEscolhas((atuais) => ({ ...atuais, [c.name]: id }))}
              />
            </Fragment>
          ))}

          {isInsumos && (
            <CodigosBarrasCampo
              valorInicial={registro ? ((registro.codigos_barras as string[] | undefined) ?? []) : codigosNovo}
              erro={state.errors?.codigos_barras}
            />
          )}

          {isInsumos && !registro && (
            <>
              <TituloSecao>Estoque inicial</TituloSecao>
              <div>
                <div className="flex min-h-5 items-center gap-0.5">
                  <Label htmlFor="campo-quantidade" className="block">
                    Quantidade (embalagens fechadas)
                  </Label>
                  <HelpTip title="Quantidade (embalagens fechadas)">
                    <p>
                      Conte <b>embalagens fechadas</b> (frascos, pacotes, kits), não o volume de cada
                      uma. Deixe 0 se ainda não houver.
                    </p>
                    <HelpExample>
                      3 frascos de 500 mL → informe <b>3</b> (não 1500).
                    </HelpExample>
                  </HelpTip>
                </div>
                <Input
                  id="campo-quantidade"
                  name="quantidade"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step="1"
                  defaultValue="0"
                  aria-invalid={state.errors?.quantidade ? true : undefined}
                  aria-describedby={
                    state.errors?.quantidade ? "campo-quantidade-aviso campo-quantidade-erro" : "campo-quantidade-aviso"
                  }
                  className={cn(
                    "mt-1",
                    state.errors?.quantidade && "border-destructive focus-visible:ring-destructive",
                  )}
                />
                {/* CAD-3: consequência visível, não escondida no "?" */}
                <p id="campo-quantidade-aviso" className="mt-1 text-xs text-muted-foreground">
                  Entra direto no estoque, sem quarentena.
                </p>
                {state.errors?.quantidade && (
                  <p id="campo-quantidade-erro" className="mt-1 text-xs text-destructive">
                    {state.errors.quantidade}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="campo-codigo_lote" className="block">
                  Lote do fabricante
                </Label>
                <Input
                  id="campo-codigo_lote"
                  name="codigo_lote"
                  maxLength={80}
                  placeholder="Ex.: 24B1187 (vazio: o Kontrol gera um código)"
                  autoComplete="off"
                  className="mt-1"
                />
              </div>
              {estoqueInicial.map((c) => (
                <CampoInput key={c.name} campo={c} valor={undefined} erro={state.errors?.[c.name]} />
              ))}
            </>
          )}

          <MensagemAcao
            estado={state.ok ? null : state}
            className="rounded-md bg-destructive/10 px-3 py-2 empty:p-0 sm:col-span-2"
          />

          <DrawerFooter className="sm:col-span-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
            >
              Cancelar
            </Button>
            <SubmitButton>Salvar</SubmitButton>
          </DrawerFooter>
        </form>

        {novaPessoa && (
          <NovaPessoaDialog
            rotuloCampo={novaPessoa.campo.label}
            papelPadrao={papelDaNovaPessoa(novaPessoa.campo)}
            nomeInicial={novaPessoa.nome}
            emailInicial={novaPessoa.email}
            preAprovado={Boolean(novaPessoa.email)}
            aoFechar={(usuario) => {
              if (usuario) {
                setPessoasNovas((atuais) => [...atuais, { value: usuario.id, label: usuario.nome }]);
                setEscolhas((atuais) => ({ ...atuais, [novaPessoa.campo.name]: usuario.id }));
                if (novaPessoa.email) setEmailsComContaAgora((atuais) => [...atuais, novaPessoa.email as string]);
              }
              setNovaPessoa(null);
            }}
          />
        )}
      </DrawerContent>
    </Drawer>
  );
}
