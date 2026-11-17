"use client";

import { useId, useState } from "react";
import { Lock, UserCheck, UserPlus } from "lucide-react";
import type { Campo } from "@/lib/cadastros/config";
import {
  preAprovadoDoValor,
  sugestaoDePessoa,
  valorPreAprovado,
  type PreAprovadoOpcao,
} from "@/lib/cadastros/pessoas";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HelpExample, HelpTip, TextoAjuda } from "@/components/common/HelpTip";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/formatters";
import { NOTA_VALOR_MASCARADO, VALOR_MASCARADO } from "@/lib/cadastros/mascara";
import type { Registro } from "@/components/cadastros/crud/apoio";

/** Rótulo de outro campo do formulário, sem o "(opcional)". */
export function rotuloDoCampo(campos: readonly Campo[], nome: string | undefined): string | undefined {
  if (!nome) return undefined;
  return campos.find((campo) => campo.name === nome)?.label.replace(/\s*\(opcional\)\s*$/i, "");
}

export function CampoInput({
  campo,
  valor,
  erro,
  escolhida,
  podeCadastrarPessoa = false,
  aoCadastrarPessoa,
  registro,
  rotuloOrigem,
  preAprovados = [],
  aoEscolherPessoa,
}: {
  campo: Campo;
  valor: unknown;
  erro?: string;
  /** pessoa cadastrada agora para este campo: vira o valor escolhido */
  escolhida?: string;
  podeCadastrarPessoa?: boolean;
  /** abre "Cadastrar nova pessoa", já preenchido quando se sabe o nome ou o e-mail */
  aoCadastrarPessoa?: (preenchido?: { nome?: string; email?: string }) => void;
  /** registro aberto: de onde vem o nome escrito à mão (campo.nomeSugeridoDe) */
  registro?: Registro | null;
  /** rótulo do campo que tem o nome escrito à mão */
  rotuloOrigem?: string;
  /** pré-aprovados sem conta (só para o Administrador) */
  preAprovados?: PreAprovadoOpcao[];
  /** indica no campo um usuário que já existe */
  aoEscolherPessoa?: (id: string) => void;
}) {
  const base =
    "mt-1 " +
    (erro
      ? "border-destructive focus-visible:ring-destructive"
      : "");
  const span = campo.colSpan === 2 ? "sm:col-span-2" : "sm:col-span-1";
  const valorInicial = valor == null ? campo.valorPadrao : valor;
  const v = escolhida ?? (valorInicial == null ? "" : String(valorInicial));
  const idBase = useId();
  // escolha feita à mão no select (não controlado), para esconder a sugestão
  const [manual, setManual] = useState<{ base: string | undefined; valor: string } | null>(null);
  const valorEfetivo = manual && manual.base === escolhida ? manual.valor : v;
  const sugestao = sugestaoDePessoa(campo, registro, valorEfetivo, preAprovados);
  const inputId = `campo-${campo.name}`;
  const erroId = erro ? `${inputId}-erro` : undefined;
  const avisoId = campo.aviso ? `${inputId}-aviso` : undefined;
  const descritoPor = [avisoId, erroId].filter(Boolean).join(" ") || undefined;
  // inativos só aparecem quando já são o valor atual (CAD2-4)
  const opcoes = (campo.opcoes ?? []).filter((o) => !o.inativo || String(o.value) === v);

  if (campo.somenteLeitura) {
    // Calculado no servidor: sem `name`, nada é enviado e o valor não muda.
    const notaId = `${idBase}-calc`;
    return (
      <div className={span}>
        <div className="flex min-h-5 items-center gap-0.5">
          <Label htmlFor={inputId} className="block">
            {campo.label}
          </Label>
        </div>
        <Input
          id={inputId}
          value={campo.tipo === "date" && v ? formatDate(v) : v || "—"}
          readOnly
          disabled
          aria-describedby={campo.ajuda ? notaId : undefined}
          className="mt-1"
        />
        {campo.ajuda && (
          <p id={notaId} className="mt-1 text-xs text-muted-foreground">
            <TextoAjuda texto={campo.ajuda} />
          </p>
        )}
      </div>
    );
  }

  if (campo.mascarado) {
    // Sem permissão: o servidor já trocou o valor por "XXX". O input não tem
    // `name`, então nada é enviado e o valor atual é preservado no banco.
    const mascaradoId = `${idBase}-valor`;
    const notaId = `${idBase}-nota`;
    return (
      <div className={span}>
        <Label htmlFor={mascaradoId} className="block">
          {campo.label}
        </Label>
        <Input
          id={mascaradoId}
          value={VALOR_MASCARADO}
          readOnly
          disabled
          aria-describedby={notaId}
          className="mt-1"
        />
        <p id={notaId} className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden="true" />
          {NOTA_VALOR_MASCARADO}
        </p>
      </div>
    );
  }

  return (
    <div className={span}>
      <div className="flex min-h-5 items-center gap-0.5">
        <Label htmlFor={inputId} className="block">
          {campo.label}
          {campo.obrigatorio && <span className="text-destructive"> *</span>}
        </Label>
        {campo.ajuda && (
          <HelpTip title={campo.label}>
            <p>
              <TextoAjuda texto={campo.ajuda} />
            </p>
            {campo.exemplo && (
              <HelpExample>
                <TextoAjuda texto={campo.exemplo} />
              </HelpExample>
            )}
          </HelpTip>
        )}
      </div>

      {campo.tipo === "textarea" ? (
        <Textarea
          id={inputId}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descritoPor}
          name={campo.name}
          defaultValue={v}
          rows={3}
          placeholder={campo.placeholder}
          className={cn(
            "mt-1",
            erro && "border-destructive focus-visible:ring-destructive",
          )}
        />
      ) : campo.tipo === "select" ? (
        <Select
          // a pessoa recém-cadastrada troca o valor de um campo que não é controlado
          key={escolhida ?? "inicial"}
          id={inputId}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descritoPor}
          name={campo.name}
          defaultValue={v}
          onChange={(event) => {
            const pre = preAprovadoDoValor(event.target.value, preAprovados);
            if (pre) {
              // pré-aprovado não tem conta: o campo não fica com ele; o cadastro abre preenchido
              event.target.value = valorEfetivo;
              aoCadastrarPessoa?.({ nome: pre.nome, email: pre.email });
              return;
            }
            setManual({ base: escolhida, valor: event.target.value });
          }}
          className={cn(
            "mt-1",
            erro && "border-destructive focus-visible:ring-destructive",
          )}
        >
          <option value="">—</option>
          {opcoes.map((o) => (
            <option key={o.value} value={o.value}>
              {o.inativo ? `${o.label} (inativo)` : o.label}
            </option>
          ))}
          {preAprovados.length > 0 && (
            <optgroup label="Pré-aprovados, ainda sem conta (escolher cria a conta)">
              {preAprovados.map((pre) => (
                <option key={pre.id} value={valorPreAprovado(pre)}>
                  {pre.nome} (pré-aprovado)
                </option>
              ))}
            </optgroup>
          )}
        </Select>
      ) : campo.tipo === "checkbox" ? (
        <div className="mt-2">
          <Checkbox
            id={inputId}
            name={campo.name}
            defaultChecked={valor === undefined ? Boolean(campo.padraoLigado) : Boolean(valor)}
          />
        </div>
      ) : (
        <Input
          id={inputId}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descritoPor}
          name={campo.name}
          defaultValue={v}
          placeholder={campo.placeholder}
          type={
            campo.tipo === "date"
              ? "date"
              : campo.tipo === "text"
                ? "text"
                : "number"
          }
          step={
            campo.step ??
            (campo.tipo === "currency"
              ? "0.01"
              : campo.tipo === "percent"
                ? "0.1"
                : undefined)
          }
          min={campo.min}
          max={campo.max}
          className={base}
        />
      )}

      {campo.aviso && (
        <p id={avisoId} className="mt-1 text-xs text-muted-foreground">
          {campo.aviso}
        </p>
      )}
      {sugestao && (sugestao.tipo === "existente" || podeCadastrarPessoa) && (
        <div
          data-testid={`sugestao-${campo.name}`}
          className="mt-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800 dark:border-brand-900/40 dark:bg-brand-950/20 dark:text-brand-200"
        >
          <p>
            “{sugestao.nome}” está em {rotuloOrigem ?? "outro campo"}
            {sugestao.tipo === "existente"
              ? " e já tem usuário."
              : sugestao.tipo === "pre_aprovado"
                ? ", pré-aprovado e ainda sem conta."
                : " e ainda não tem usuário."}
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-1.5"
            onClick={() =>
              sugestao.tipo === "existente"
                ? aoEscolherPessoa?.(sugestao.id)
                : aoCadastrarPessoa?.(
                    sugestao.tipo === "pre_aprovado" ? { nome: sugestao.nome, email: sugestao.email } : { nome: sugestao.nome },
                  )
            }
          >
            {sugestao.tipo === "existente" ? <UserCheck aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
            {sugestao.tipo === "existente"
              ? `Indicar ${sugestao.nome}`
              : sugestao.tipo === "pre_aprovado"
                ? `Criar a conta de ${sugestao.nome} e indicar`
                : `Cadastrar ${sugestao.nome} e indicar`}
          </Button>
        </div>
      )}
      {campo.opcoesDe === "perfis" &&
        (podeCadastrarPessoa ? (
          <button
            type="button"
            onClick={() => aoCadastrarPessoa?.()}
            className="mt-1 min-h-8 rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            A pessoa não está na lista? Cadastrar nova pessoa
          </button>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            A pessoa não está na lista? Peça ao Administrador para cadastrá-la em Governança → Usuários.
          </p>
        ))}
      {erro && (
        <p id={erroId} className="mt-1 text-xs text-destructive">
          {erro}
        </p>
      )}
    </div>
  );
}
