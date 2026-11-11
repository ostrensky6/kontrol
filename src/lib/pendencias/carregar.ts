import "server-only";

import { cache } from "react";

import {
  montarPendenciaDoApp,
  montarPendencias,
  type Pendencia,
  type PendenciaDoApp,
} from "@/components/dashboard/aguardando";
import { minhasPermissoes, temNaLista } from "@/lib/auth/permissao-efetiva";
import { decideDisputaReserva } from "@/lib/auth/permissions";
import { usuarioAtual } from "@/lib/auth/roles";
import { rotuloTipo } from "@/lib/equipamentos/avisos";
import { caminhoNotificacao } from "@/lib/notifications/links";
import { AVISOS_VAZIOS, type AvisosDoSino } from "@/lib/pendencias/tipos";
import { createClientUntyped } from "@/lib/supabase/server";

/** Teto de leitura de cada pendência do app; acima disso o número já diz "muitos". */
const TETO = 50;

type Linhas = Array<{ id: number; rotulo: string }>;

/**
 * Pendências que a função do banco não cobre (revisão de 11/11, F8). Cada uma
 * só aparece para quem tem a mesma permissão que a ação de destino exige; se
 * a leitura falhar, a pendência fica de fora sem derrubar a tela.
 */
async function pendenciasDoApp(): Promise<Pendencia[]> {
  const [efetivas, usuario, supabase] = await Promise.all([minhasPermissoes(), usuarioAtual(), createClientUntyped()]);
  if (!usuario || usuario.suspenso) return [];
  const tem = (chave: Parameters<typeof temNaLista>[1]) => temNaLista(efetivas, chave);
  const verEstoque = tem("estoque.ver");

  const leituras: Array<Promise<[PendenciaDoApp, Linhas]>> = [];

  if (verEstoque && tem("estoque.lote.aceitar")) {
    leituras.push(
      (async () => {
        const { data } = await supabase
          .from("lotes_estoque")
          .select("id, codigo_lote, insumos(especificacao)")
          .eq("status", "quarentena")
          .order("id", { ascending: true })
          .limit(TETO);
        const linhas = ((data ?? []) as Array<{ id: number; codigo_lote: string | null; insumos: unknown }>).map((lote) => {
          const insumo = Array.isArray(lote.insumos) ? lote.insumos[0] : lote.insumos;
          const nome = (insumo as { especificacao?: string | null } | null)?.especificacao;
          return { id: Number(lote.id), rotulo: [nome, lote.codigo_lote ? `lote ${lote.codigo_lote}` : `lote #${lote.id}`].filter(Boolean).join(" · ") };
        });
        return ["lotes_quarentena", linhas];
      })(),
    );
  }

  if (decideDisputaReserva(usuario.papel) && (tem("planejamento.ver") || tem("planejamento.executar"))) {
    leituras.push(
      (async () => {
        const { data } = await supabase
          .from("reservas_disputas")
          .select("id, planejamento_destino_id")
          .eq("status", "pendente")
          .order("solicitado_em", { ascending: true })
          .limit(TETO);
        const linhas = ((data ?? []) as Array<{ id: number; planejamento_destino_id: number | null }>).map((d) => ({
          id: Number(d.id),
          rotulo: d.planejamento_destino_id ? `Disputa #${d.id} · plano #${d.planejamento_destino_id}` : `Disputa #${d.id}`,
        }));
        return ["disputas_decidir", linhas];
      })(),
    );
  }

  if (verEstoque && (tem("cadastros.editar") || tem("insumos.editar"))) {
    leituras.push(
      (async () => {
        const { data } = await supabase
          .from("cadastros_triagem")
          .select("id, codigo")
          .in("status", ["pendente", "em_analise"])
          .order("criado_em", { ascending: true })
          .limit(TETO);
        const linhas = ((data ?? []) as Array<{ id: number; codigo: string | null }>).map((t) => ({
          id: Number(t.id),
          rotulo: t.codigo ? `Código ${t.codigo}` : `Código #${t.id}`,
        }));
        return ["codigos_triagem", linhas];
      })(),
    );
  }

  if (verEstoque && tem("cadastros.editar")) {
    leituras.push(
      (async () => {
        const { data } = await supabase
          .from("v_equipamento_avisos")
          .select("equipamento_unidade_id, tipo, situacao, encaminhado")
          .eq("situacao", "vencido")
          .limit(TETO);
        const avisos = ((data ?? []) as Array<{ equipamento_unidade_id: number; tipo: string; encaminhado: boolean | null }>).filter(
          (a) => a.encaminhado !== true,
        );
        if (avisos.length === 0) return ["equipamentos_vencidos", []];
        const ids = [...new Set(avisos.map((a) => Number(a.equipamento_unidade_id)))];
        const { data: unidades } = await supabase
          .from("equipamento_unidades")
          .select("id, codigo_patrimonio, equipamentos(nome)")
          .in("id", ids);
        const nomes = new Map(
          ((unidades ?? []) as Array<{ id: number; codigo_patrimonio: string | null; equipamentos: unknown }>).map((u) => {
            const equipamento = Array.isArray(u.equipamentos) ? u.equipamentos[0] : u.equipamentos;
            const nome = (equipamento as { nome?: string | null } | null)?.nome ?? `Unidade #${u.id}`;
            return [Number(u.id), u.codigo_patrimonio ? `${nome} (${u.codigo_patrimonio})` : nome];
          }),
        );
        const linhas = avisos.map((a) => ({
          id: Number(a.equipamento_unidade_id),
          rotulo: `${rotuloTipo(a.tipo)} · ${nomes.get(Number(a.equipamento_unidade_id)) ?? `unidade #${a.equipamento_unidade_id}`}`,
        }));
        return ["equipamentos_vencidos", linhas];
      })(),
    );
  }

  const resultados = await Promise.allSettled(leituras);
  return resultados.flatMap((resultado) => {
    if (resultado.status !== "fulfilled") return [];
    const [chave, linhas] = resultado.value;
    const pendencia = montarPendenciaDoApp(chave, linhas.filter((linha) => Number.isInteger(linha.id) && linha.id > 0));
    return pendencia ? [pendencia] : [];
  });
}

/**
 * Tudo o que espera a pessoa: a função do banco mais as pendências lidas pelo
 * app. Uma leitura por requisição, mesmo que o layout (sino) e a tela peçam.
 */
export const carregarPendencias = cache(async (): Promise<Pendencia[]> => {
  const supabase = await createClientUntyped();
  const [banco, doApp] = await Promise.all([supabase.rpc("aguardando_voce"), pendenciasDoApp()]);
  return [...montarPendencias(banco.data), ...doApp];
});

const AVISOS_NO_SINO = 5;

/** Para o layout: o sino nunca derruba a tela; se a leitura falhar, começa vazio e relê no navegador. */
export async function carregarAvisosDoSinoSeguro(): Promise<AvisosDoSino> {
  try {
    return await carregarAvisosDoSino();
  } catch {
    return AVISOS_VAZIOS;
  }
}

/** O que o sino mostra em todas as telas: Aguardando você e os avisos não lidos (F9). */
export async function carregarAvisosDoSino(): Promise<AvisosDoSino> {
  const supabase = await createClientUntyped();
  const [pendencias, notificacoes] = await Promise.all([
    carregarPendencias(),
    supabase
      .from("v_minhas_notificacoes")
      .select("id, titulo, corpo, entidade_tipo, entidade_id, status, criado_em")
      .eq("status", "nao_lida")
      .order("criado_em", { ascending: false })
      .limit(TETO),
  ]);
  const naoLidas = (notificacoes.data ?? []) as Array<{
    id: number;
    titulo: string;
    corpo: string | null;
    entidade_tipo: string | null;
    entidade_id: number | null;
    criado_em: string;
  }>;
  return {
    pendencias,
    naoLidos: naoLidas.length,
    avisos: naoLidas.slice(0, AVISOS_NO_SINO).map((n) => ({
      id: Number(n.id),
      titulo: n.titulo,
      corpo: n.corpo,
      href: caminhoNotificacao(n.entidade_tipo, n.entidade_id),
      criadoEm: n.criado_em,
    })),
  };
}
