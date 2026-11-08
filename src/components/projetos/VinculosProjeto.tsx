"use client";

import { useActionState } from "react";
import { alterarVinculoProjeto } from "@/lib/actions/vinculos-projeto";
import { ESTADO_INICIAL } from "@/lib/erros";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import { LABEL_PAPEL, isPapelUsuario } from "@/lib/auth/permissions";

export type VinculoPessoa = {
  usuario_id: string;
  nome: string | null;
  email: string | null;
  papel: string;
  vinculado: boolean;
  coordenador_cadastrado: boolean;
};

function Linha({ projetoId, pessoa }: { projetoId: number; pessoa: VinculoPessoa }) {
  const [estado, enviar] = useActionState(alterarVinculoProjeto, ESTADO_INICIAL);
  const nome = pessoa.nome ?? pessoa.email ?? "Sem nome";
  const papel = isPapelUsuario(pessoa.papel) ? LABEL_PAPEL[pessoa.papel] : pessoa.papel;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-3 py-2 last:border-b-0">
      <div className="text-sm">
        <span className="font-medium">{nome}</span>{" "}
        <span className="text-xs text-muted-foreground">({papel})</span>
        {pessoa.coordenador_cadastrado && (
          <span className="ml-2 rounded bg-info-soft px-1.5 py-0.5 text-[11px] font-medium text-info-strong">Coordenador do projeto</span>
        )}
      </div>
      <form action={enviar} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="projeto_id" value={projetoId} />
        <input type="hidden" name="usuario_id" value={pessoa.usuario_id} />
        <input type="hidden" name="vinculado" value={pessoa.vinculado ? "0" : "1"} />
        <span className="text-xs text-muted-foreground">{pessoa.vinculado ? "Ligado" : "Não ligado"}</span>
        <SubmitButton pendingLabel="Salvando…" aria-label={pessoa.vinculado ? `Desligar ${nome}` : `Ligar ${nome}`}>
          {pessoa.vinculado ? "Desligar" : "Ligar"}
        </SubmitButton>
        <MensagemAcao estado={estado} />
      </form>
    </li>
  );
}

/** Quem atua no projeto: Coordenador e Gestor só alteram o projeto e validam pedidos se estiverem ligados (0160). */
export function VinculosProjeto({ projetoId, pessoas }: { projetoId: number; pessoas: VinculoPessoa[] }) {
  return (
    <section className="mt-8" aria-labelledby="vinculos-projeto-titulo">
      <h2 id="vinculos-projeto-titulo" className="mb-1 text-lg font-semibold tracking-tight">Quem atua neste projeto</h2>
      <p className="mb-2 text-xs text-muted-foreground">
        Coordenador e Gestor só alteram o projeto e validam pedidos internos dele se estiverem ligados aqui ou se forem o
        coordenador cadastrado. As outras funções seguem pelas permissões. Só o Administrador vê e altera esta lista.
      </p>
      <div className="rounded-lg border border-border bg-card shadow-sm">
        {pessoas.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground/80">Nenhum Coordenador ou Gestor cadastrado.</p>
        ) : (
          <ul>{pessoas.map((p) => <Linha key={p.usuario_id} projetoId={projetoId} pessoa={p} />)}</ul>
        )}
      </div>
    </section>
  );
}
