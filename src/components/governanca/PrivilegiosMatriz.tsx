"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import type { FormState } from "@/lib/actions/cadastros";
import { salvarMatrizPrivilegios, type obterMatrizPrivilegios } from "@/lib/actions/privilegios";
import { PAPEIS, type PapelUsuario, type PermissaoUsuario } from "@/lib/auth/permissions";
import { gruposDePermissoes } from "@/lib/auth/permission-categories";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { faixaDoModulo } from "./faixas";

const initial: FormState = { ok: false, message: "" };
const GRUPOS = gruposDePermissoes();

type Leitura = Awaited<ReturnType<typeof obterMatrizPrivilegios>>;
type PapelEditavel = Exclude<PapelUsuario, "admin">;
type Linha = Extract<Leitura, { ok: true }>["categorias"][PapelEditavel];
type Rascunho = Linha & { alteracoes: Partial<Record<PermissaoUsuario, boolean>> };
type Retorno = { revisao: string; estado: Awaited<ReturnType<typeof salvarMatrizPrivilegios>> };

export function PrivilegiosMatriz({ leitura }: { leitura: Leitura }) {
  const router = useRouter();
  const [rascunhos, setRascunhos] = useState<Partial<Record<PapelEditavel, Rascunho>>>({});
  const [retornos, setRetornos] = useState<Partial<Record<PapelEditavel, Retorno>>>({});
  const [salvando, setSalvando] = useState<PapelEditavel | null>(null);
  const emEnvio = useRef(false);
  const [recarregando, iniciarRecarga] = useTransition();
  const recarregar = () => iniciarRecarga(() => router.refresh());

  if (!leitura.ok) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">{leitura.motivo === "sem_permissao" ? "Acesso restrito" : "Matriz indisponível"}</h2>
        <MensagemAcao estado={leitura} className="mt-1" />
        {leitura.motivo === "leitura" && (
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={recarregar} disabled={recarregando}>
            {recarregando ? "Recarregando…" : "Recarregar matriz"}
          </Button>
        )}
      </section>
    );
  }

  const { categorias } = leitura;
  const estadoDaCategoria = (papel: PapelEditavel) => {
    const rascunho = rascunhos[papel];
    const retorno = retornos[papel];
    const revisaoAtual = categorias[papel].revisao;
    return {
      rascunho,
      precisaRecarga: retorno?.revisao === revisaoAtual && Boolean(retorno.estado.ok || retorno.estado.conflito),
      desatualizado: Boolean(rascunho && (rascunho.revisao !== revisaoAtual || retorno?.estado.conflito)),
    };
  };

  function alterar(papel: PapelEditavel, chave: PermissaoUsuario, valor: boolean | null) {
    const { precisaRecarga, desatualizado } = estadoDaCategoria(papel);
    if (precisaRecarga || desatualizado || salvando === papel || recarregando) return;
    setRascunhos((atuais) => {
      const base = atuais[papel] ?? categorias[papel];
      const alteracoes = { ...atuais[papel]?.alteracoes };
      if (valor === null || valor === base.armazenadas[chave]) delete alteracoes[chave];
      else alteracoes[chave] = valor;
      return { ...atuais, [papel]: Object.keys(alteracoes).length ? { ...base, alteracoes } : undefined };
    });
    setRetornos((atuais) => ({ ...atuais, [papel]: undefined }));
  }

  async function salvar(papel: PapelEditavel) {
    const { rascunho, precisaRecarga, desatualizado } = estadoDaCategoria(papel);
    if (!rascunho || precisaRecarga || desatualizado || recarregando || emEnvio.current) return;
    const dados = new FormData();
    dados.set("papel", papel);
    dados.set("revisao", rascunho.revisao);
    dados.set("alteracoes", JSON.stringify(Object.entries(rascunho.alteracoes)));
    emEnvio.current = true;
    setSalvando(papel);
    setRetornos((atuais) => ({ ...atuais, [papel]: undefined }));
    try {
      const estado = await salvarMatrizPrivilegios(initial, dados);
      setRetornos((atuais) => ({ ...atuais, [papel]: { revisao: rascunho.revisao, estado } }));
      if (estado.ok) setRascunhos((atuais) => ({ ...atuais, [papel]: undefined }));
    } catch {
      setRetornos((atuais) => ({
        ...atuais,
        [papel]: { revisao: rascunho.revisao, estado: { ok: false, message: "Não foi possível confirmar a operação. Recarregue a matriz para conferir." } },
      }));
    } finally {
      emEnvio.current = false;
      setSalvando(null);
    }
  }

  const podePrecisarRecarga = PAPEIS.some(({ value }) => value !== "admin" && estadoDaCategoria(value).precisaRecarga);
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Privilégios por categoria</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            “Não configurado” significa que a categoria não tem valor gravado. “Negado” é uma negativa gravada.
            Salve só a categoria que você editou. A matriz não confirma o acesso individual.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={recarregar} disabled={salvando !== null || recarregando}>
          {recarregando ? "Recarregando…" : "Recarregar matriz"}
        </Button>
      </div>
      {podePrecisarRecarga && (
        <p role="status" className="mt-2 text-sm text-warning-strong">
          Recarregue a matriz para conferir os valores gravados antes de editar novamente a categoria afetada.
        </p>
      )}
      {PAPEIS.map(({ value, label }) => value !== "admin" && (
        <div key={value} aria-label={`Retorno de ${label}`} role="group">
          <MensagemAcao estado={retornos[value]?.estado} className="mt-2" />
        </div>
      ))}

      <div tabIndex={0} role="region" aria-label="Matriz de privilégios por categoria" className="mt-4 max-h-[70dvh] overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-xs uppercase tracking-wide text-muted-foreground shadow-sm">
            <tr>
              <th scope="col" className="px-3 py-3 text-left">
                Privilégio
              </th>
              {PAPEIS.map(({ value, label }) => {
                if (value === "admin") return <th key={value} scope="col" className="w-32 px-2 py-3 text-center">{label}</th>;
                const { rascunho, precisaRecarga, desatualizado } = estadoDaCategoria(value);
                return (
                  <th key={value} scope="col" aria-label={label} className="w-36 px-2 py-3 text-center">
                    <span className="block">{label}</span>
                    <Button type="button" size="sm" variant="outline" aria-label={`Salvar ${label}`}
                      className="mt-1 normal-case" disabled={!rascunho || precisaRecarga || desatualizado || salvando !== null || recarregando}
                      aria-busy={salvando === value || undefined} onClick={() => void salvar(value)}>
                      {salvando === value ? "Salvando…" : "Salvar"}
                    </Button>
                    {rascunho && (
                      <div className="mt-1 text-[11px] font-normal normal-case text-warning-strong">
                        <p>{desatualizado ? "Rascunho de revisão anterior" : "Alterações não salvas"}</p>
                        {desatualizado && (
                          <Button type="button" variant="ghost" size="sm" aria-label={`Descartar rascunho de ${label}`}
                            disabled={precisaRecarga || salvando !== null || recarregando}
                            onClick={() => {
                              setRascunhos((atuais) => ({ ...atuais, [value]: undefined }));
                              setRetornos((atuais) => ({ ...atuais, [value]: undefined }));
                            }}>
                            Descartar rascunho
                          </Button>
                        )}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          {GRUPOS.map(([modulo, permissoes], indice) => (
            <tbody
              key={modulo}
              data-modulo={modulo}
              className={cn("border-t-2 border-border", faixaDoModulo(indice))}
            >
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={PAPEIS.length + 1}
                  className="px-3 pb-1 pt-3 text-left text-xs font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300"
                >
                  {modulo}
                </th>
              </tr>
              {permissoes.map((permissao) => (
                <tr key={permissao.key} className="border-t border-border/50">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <p className="font-medium text-foreground">{permissao.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{permissao.descricao}</p>
                  </th>
                  {PAPEIS.map(({ value, label }) => {
                    if (value === "admin") return <td key={value} className="px-2 py-2 text-center text-xs text-muted-foreground">Permitido · fixo</td>;
                    const { rascunho, precisaRecarga, desatualizado } = estadoDaCategoria(value);
                    const gravado = (rascunho ?? categorias[value]).armazenadas[permissao.key];
                    const alterado = rascunho?.alteracoes[permissao.key];
                    const atual = alterado ?? gravado;
                    return (
                      <td key={value} className="px-2 py-2 text-center">
                        <Select
                          value={atual === null ? "" : String(atual)}
                          disabled={precisaRecarga || desatualizado || salvando === value || recarregando}
                          aria-label={`${label}: ${permissao.label}`}
                          onChange={(evento) => alterar(value, permissao.key, evento.target.value === "" ? null : evento.target.value === "true")}
                          className="h-8 min-w-32 px-2 text-xs"
                        >
                          {gravado === null && <option value="">Não configurado</option>}
                          <option value="true">Permitido</option>
                          <option value="false">Negado</option>
                        </Select>
                        {alterado !== undefined && <span className="block text-[11px] text-warning-strong">Não salvo</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

    </section>
  );
}
