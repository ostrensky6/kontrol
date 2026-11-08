"use client";

import { useEffect, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { Button } from "@/components/ui/button";
import { configurarVinculoProjeto, listarVinculosProjeto, type LeituraVinculosProjeto, type PaginaVinculosProjeto } from "@/lib/actions/vinculos-projeto";
import { LABEL_PAPEL } from "@/lib/auth/permissions";

export function VinculosProjetoPainel({ projetoId }: { projetoId: number }) {
  return <VinculosDoProjeto key={projetoId} projetoId={projetoId} />;
}

function VinculosDoProjeto({ projetoId }: { projetoId: number }) {
  const [leitura, setLeitura] = useState<Extract<LeituraVinculosProjeto, { ok: true }> | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [pendente, setPendente] = useState(false);
  const trava = useRef(false);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  async function carregar(cursor: string | null = null) {
    if (trava.current) return;
    trava.current = true; setPendente(true); setLeitura(null); setMensagem("");
    try {
      const r = await listarVinculosProjeto({ projeto_id: projetoId, apos_usuario_id: cursor, limite: 20 });
      if (!vivo.current) return;
      if (r.ok && r.pagina.projeto_id === projetoId) setLeitura(r);
      else setMensagem(r.ok ? "Resposta de outro projeto descartada." : r.message);
    } catch (e) { unstable_rethrow(e); if (vivo.current) setMensagem("Leitura não confirmada. Falha não significa ausência de vínculos."); }
    finally { trava.current = false; if (vivo.current) setPendente(false); }
  }

  async function configurar(item: PaginaVinculosProjeto["itens"][number]) {
    if (trava.current || !leitura?.escrita_habilitada || !leitura.pagina.itens.includes(item)) return;
    trava.current = true; setPendente(true); setMensagem("");
    try {
      const r = await configurarVinculoProjeto({ projeto_id: projetoId, usuario_id: item.usuario_id, vinculado: !item.vinculado });
      if (vivo.current) setMensagem(r.ok ? "Operação confirmada. Releia os vínculos; o recibo não determina acesso efetivo." : `${r.message} Releia antes de outra operação.`);
    } catch (e) { unstable_rethrow(e); if (vivo.current) setMensagem("Resultado não confirmado. Releia antes de tentar novamente."); }
    finally { if (vivo.current) { setLeitura(null); setPendente(false); } trava.current = false; }
  }

  return <section aria-label="Vínculos explícitos do projeto" aria-busy={pendente} className="space-y-4 rounded-lg border border-border bg-card p-4">
    <h2 className="text-lg font-semibold">Vínculos explícitos do projeto</h2>
    <p className="text-sm text-muted-foreground">Consulta e alteração restritas a Administrador apto, verificadas pelo serviço. Coordenação direta e vínculo explícito são independentes; remover o vínculo não remove a coordenação.</p>
    <Button type="button" disabled={pendente} onClick={() => carregar()}>{pendente ? "Processando…" : "Reler vínculos do projeto"}</Button>
    {mensagem && <p role="status">{mensagem}</p>}
    {leitura && <>
      {!leitura.escrita_habilitada && <p>Escrita desligada; consulta disponível, nenhuma alteração habilitada.</p>}
      {leitura.pagina.itens.length === 0 && <p>Nenhum usuário nesta página confirmada.</p>}
      <ul className="space-y-3">{leitura.pagina.itens.map((item) => <li key={item.usuario_id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
        <div className="min-w-0"><p className="break-words font-medium">{item.nome || item.usuario_id}</p>
          <p className="text-sm">{LABEL_PAPEL[item.papel]}{item.suspenso ? " · Suspenso" : ""}{item.senha_provisoria ? " · Senha provisória" : ""}</p>
          <p className="text-sm">Vínculo explícito: {item.vinculado ? "sim" : "não"} · Coordenação direta: {item.coordenacao_direta ? "sim" : "não"}</p>
        </div>
        <Button type="button" disabled={pendente || !leitura.escrita_habilitada} onClick={() => configurar(item)}>{item.vinculado ? "Remover vínculo explícito" : "Adicionar vínculo explícito"}</Button>
      </li>)}</ul>
      <p className="text-sm text-muted-foreground">Página parcial; ausência nesta página não significa desvínculo.</p>
      {leitura.pagina.proximo_usuario_id && <Button type="button" disabled={pendente} onClick={() => carregar(leitura.pagina.proximo_usuario_id)}>Próxima página</Button>}
    </>}
  </section>;
}
