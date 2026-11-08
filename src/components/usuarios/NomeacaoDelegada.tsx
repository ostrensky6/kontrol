"use client";

import { useEffect, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { Button } from "@/components/ui/button";
import { listarContextoNomeacao, type PaginaContextoNomeacao } from "@/lib/actions/nomeacao-contexto";
import { nomearPapelUsuario } from "@/lib/actions/usuarios";
import { LABEL_PAPEL } from "@/lib/auth/permissions";

export function NomeacaoDelegada() {
  const [pagina, setPagina] = useState<PaginaContextoNomeacao | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [pendente, setPendente] = useState(false);
  const trava = useRef(false);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  async function carregar(cursor: string | null = null) {
    if (trava.current) return;
    trava.current = true; setPendente(true); setPagina(null); setMensagem("");
    try {
      const r = await listarContextoNomeacao({ apos_usuario_id: cursor, limite: 20 });
      if (!vivo.current) return;
      if (r.ok) setPagina(r.pagina);
      else setMensagem(r.message);
    } catch (e) { unstable_rethrow(e); if (vivo.current) setMensagem("Consulta não confirmada. Tente reler; falha não é página vazia."); }
    finally { trava.current = false; if (vivo.current) setPendente(false); }
  }

  async function nomear(item: PaginaContextoNomeacao["itens"][number], destino: string) {
    if (trava.current || !pagina?.itens.includes(item) || destino === item.papel_atual_esperado
      || !item.papeis_destino.some((p) => p === destino)) return;
    trava.current = true; setPendente(true); setMensagem("");
    const fd = new FormData();
    fd.set("id", item.usuario_id); fd.set("papel_atual_esperado", item.papel_atual_esperado); fd.set("papel_destino", destino);
    try {
      const r = await nomearPapelUsuario({ ok: false }, fd);
      if (vivo.current) setMensagem(`${r.message || (r.ok ? "Nomeação confirmada." : "Nomeação não confirmada.")} Releia o contexto antes de outra operação.`);
    } catch (e) { unstable_rethrow(e); if (vivo.current) setMensagem("Resultado não confirmado. Releia antes de tentar novamente."); }
    finally {
      // A fotografia/CAS nunca é reutilizada depois de uma tentativa de escrita.
      if (vivo.current) { setPagina(null); setPendente(false); }
      trava.current = false;
    }
  }

  return <section aria-label="Nomeação delegada" aria-busy={pendente} className="space-y-4 rounded-lg border border-border bg-card p-4">
    <p className="text-sm text-muted-foreground">Somente funções e destinos devolvidos pelo serviço autorizado. Não permite criar, suspender ou excluir contas. O próprio ator não integra esta lista.</p>
    <p className="text-sm text-muted-foreground">Coordenador recebe apenas Gestor → Gestor: sem mudança efetiva, a nomeação permanece desabilitada.</p>
    <Button type="button" disabled={pendente} onClick={() => carregar()}>{pendente ? "Processando…" : "Reler contexto de nomeação"}</Button>
    {mensagem && <p role="status">{mensagem}</p>}
    {pagina && <>
      {pagina.itens.length === 0 && <p>Nenhum usuário nesta página confirmada.</p>}
      <ul className="space-y-3">{pagina.itens.map((item) => <li key={item.usuario_id} className="rounded-md border border-border p-3">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); void nomear(item, String(fd.get("destino") ?? "")); }}>
          <div className="min-w-0 flex-1"><p className="break-words font-medium">{item.nome || item.usuario_id}</p><p className="text-sm">Atual: {LABEL_PAPEL[item.papel_atual_esperado]}{item.suspenso ? " · Suspenso" : ""}{item.senha_provisoria ? " · Senha provisória" : ""}</p>
            <label className="mt-2 block text-sm" htmlFor={`destino-${item.usuario_id}`}>Nova função</label>
            <select id={`destino-${item.usuario_id}`} name="destino" required defaultValue="" disabled={pendente} className="min-h-11 w-full rounded-md border border-input bg-background px-3">
              <option value="" disabled>Selecione um destino</option>
              {item.papeis_destino.map((p) => <option key={p} value={p} disabled={p === item.papel_atual_esperado}>{LABEL_PAPEL[p]}{p === item.papel_atual_esperado ? " — sem mudança" : ""}</option>)}
            </select>
          </div>
          <Button type="submit" disabled={pendente || !item.papeis_destino.some((p) => p !== item.papel_atual_esperado)}>Nomear</Button>
        </form>
      </li>)}</ul>
      <p className="text-sm text-muted-foreground">Página parcial; ausência nesta página não prova inelegibilidade.</p>
      {pagina.proximo_usuario_id && <Button type="button" disabled={pendente} onClick={() => carregar(pagina.proximo_usuario_id)}>Próxima página</Button>}
    </>}
  </section>;
}
