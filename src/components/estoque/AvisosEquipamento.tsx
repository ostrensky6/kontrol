import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HelpTip } from "@/components/common/HelpTip";
import { projetarAvisosEquipamento, type LeituraAvisosEquipamento } from "@/lib/equipamentos/avisos";
import { formatDate, formatDateTime } from "@/lib/formatters";
import type { createClientUntyped } from "@/lib/supabase/server";
import { OperarAvisoEquipamentoForm } from "./OperarAvisoEquipamentoForm";
import { ConfiguracaoAvisosEquipamento } from "./ConfiguracaoAvisosEquipamento";

const id = z.number().int().positive();
const texto = z.string().trim().min(1);
const dataCivil = z.iso.date();
const versao = z.number().int().min(1).max(2_147_483_647);
const tipoOperavel = z.enum(["preventiva", "corretiva", "calibracao", "qualificacao", "verificacao", "limpeza_tecnica"]);
const escopo = z.object({ equipamento_unidade_id: id, tipo: texto });
const contexto = escopo.extend({
  hoje_sp: z.unknown(), regra: z.unknown(), origem: z.unknown(), avisos: z.unknown(), permissoes: z.unknown(),
});
const regra = escopo.extend({
  ocorrencia_id: id, data_referencia: dataCivil, antecedencia_dias: z.number().int().nonnegative(),
  versao: z.unknown().optional().transform((valor) => versao.safeParse(valor).data),
}).nullable();
const origem = escopo.extend({ id, status: texto, proxima_data: dataCivil.nullable() }).nullable();
const historico = z.array(z.strictObject({
  id: texto,
  ocorrencia_id: id,
  regra_id: texto,
  data_referencia: dataCivil,
  responsavel_id: texto,
  aberto_em: z.iso.datetime({ offset: true }),
  estado: z.enum(["pendente", "reconhecido", "encaminhado"]),
}));
const permissoes = z.object({
  avaliar: z.boolean().optional(), configurar: z.boolean().optional(), reconhecer: z.boolean().optional(), encaminhar: z.boolean().optional(),
});
const leituraConfirmada = z.object({ estado: z.literal("confirmada"), dado: z.unknown() });
const indisponivel = { estado: "indisponivel" } as const;

function ler<T>(schema: z.ZodType<T>, valor: unknown) {
  const leitura = leituraConfirmada.safeParse(valor);
  if (!leitura.success) return indisponivel;
  const dado = schema.safeParse(leitura.data.dado);
  return dado.success ? { estado: "confirmada" as const, dado: dado.data } : indisponivel;
}

type ContextoAvisos = LeituraAvisosEquipamento & {
  regra: ReturnType<typeof ler<z.infer<typeof regra>>>;
  permissoes?: z.infer<typeof permissoes>;
};

export async function lerContextosAvisosEquipamento(
  supabase: Pick<Awaited<ReturnType<typeof createClientUntyped>>, "rpc">,
  unidadeId: number,
): Promise<ContextoAvisos[] | null> {
  try {
    const { data, error } = await supabase.rpc("contextos_avisos_equipamento", { p_unidade_id: unidadeId });
    if (error != null) return null;
    const contextos = z.array(contexto).safeParse(data);
    if (!contextos.success || contextos.data.some((item) => item.equipamento_unidade_id !== unidadeId)) return null;
    if (new Set(contextos.data.map((item) => item.tipo)).size !== contextos.data.length) return null;

    return contextos.data.map((item) => {
      const noEscopo = (dado: z.infer<typeof escopo> | null) =>
        dado === null || (dado.equipamento_unidade_id === unidadeId && dado.tipo === item.tipo);
      return {
        equipamento_unidade_id: unidadeId,
        tipo: item.tipo,
        hoje_sp: dataCivil.safeParse(item.hoje_sp).data ?? null,
        regra: ler(regra.refine(noEscopo), item.regra),
        origem: ler(origem.refine(noEscopo), item.origem),
        avisos: ler(historico, item.avisos),
        permissoes: permissoes.safeParse(item.permissoes).data,
      };
    });
  } catch {
    return null;
  }
}

const ROTULO_AVISO = { pendente: "Pendente", reconhecido: "Reconhecido", encaminhado: "Encaminhado" };
const MOTIVO_REFERENCIA = {
  origem_ausente: "O registro de origem não está mais disponível.",
  origem_divergente: "A ocorrência da origem não corresponde à regra.",
  origem_cancelada: "A ocorrência de origem foi cancelada.",
  proxima_data_nao_informada: "A origem não informa mais a próxima data.",
  proxima_data_alterada: "A próxima data da origem mudou.",
};

export function AvisosEquipamento({
  unidadeId,
  contextos,
  escritaHabilitada,
}: {
  unidadeId: number;
  contextos: ContextoAvisos[] | null;
  escritaHabilitada: boolean;
}) {
  return (
    <section aria-labelledby={`avisos-equipamento-${unidadeId}`} className="mt-4 border-t border-border/70 pt-3">
      <div className="flex items-center gap-1">
        <h4 id={`avisos-equipamento-${unidadeId}`} className="text-sm font-semibold">Avisos do cadastro</h4>
        <HelpTip title="Avisos do cadastro">
          <p>
            A janela usa a próxima data da origem; não é agenda nem plano de manutenção.
            Avaliar pode registrar uma pendência. Reconhecer ou encaminhar não confirma execução nem resolução,
            não bloqueia o equipamento e não envia e-mail.
          </p>
        </HelpTip>
      </div>
      <ConfiguracaoAvisosEquipamento key={unidadeId} unidadeId={unidadeId} escritaHabilitada={escritaHabilitada} />
      {contextos === null ? (
        <p className="mt-2 text-sm text-warning-strong">Avisos indisponíveis. Não foi possível confirmar a leitura desta unidade.</p>
      ) : contextos.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nenhuma regra ou aviso registrado para esta unidade.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border/70">
          {contextos.map((item) => {
            const projetado = projetarAvisosEquipamento({ equipamento_unidade_id: unidadeId, tipo: item.tipo }, item);
            const { janela } = projetado;
            const avisos: Readonly<z.infer<typeof historico>> | null = projetado.avisos;
            const podeOperar = escritaHabilitada && item.equipamento_unidade_id === unidadeId && tipoOperavel.safeParse(item.tipo).success;
            const camposEscopo = { p_unidade_id: String(unidadeId), p_tipo: item.tipo };
            const versaoLida = item.regra.estado === "confirmada" ? item.regra.dado?.versao : undefined;
            return (
              <li key={item.tipo} className="space-y-2 py-3 text-sm">
                <h5 className="font-medium capitalize">{item.tipo.replaceAll("_", " ")}</h5>
                {janela.estado === "janela_confirmada" ? (
                  <div>
                    <p>
                      Próxima data da ocorrência de origem:{" "}
                      <time dateTime={janela.data_referencia}>{formatDate(janela.data_referencia)}</time>
                    </p>
                    <p className="text-muted-foreground">
                      {janela.na_janela ? "Dentro da janela de aviso" : "Fora da janela de aviso"}
                      {" · "}antecedência de {janela.antecedencia_dias} dia(s).
                    </p>
                  </div>
                ) : janela.estado === "referencia_alterada" ? (
                  <p className="text-warning-strong">Referência alterada. {MOTIVO_REFERENCIA[janela.motivo]}</p>
                ) : janela.estado === "nao_configurado" ? (
                  <p className="text-muted-foreground">Sem regra de aviso configurada para este tipo.</p>
                ) : (
                  <p className="text-warning-strong">Referência indisponível para confirmar a janela.</p>
                )}
                {podeOperar && item.permissoes?.avaliar === true && versaoLida !== undefined && (
                  <OperarAvisoEquipamentoForm operacao="avaliar" operacaoId={randomUUID()} campos={{ ...camposEscopo, p_versao_esperada: String(versaoLida) }} />
                )}
                {avisos === null ? (
                  <p className="text-warning-strong">Histórico de avisos indisponível.</p>
                ) : avisos.length === 0 ? (
                  <p className="text-muted-foreground">Nenhum aviso registrado para este tipo.</p>
                ) : (
                  <ul className="divide-y divide-border/70 rounded-md border border-border/70 px-3">
                    {avisos.map((aviso) => {
                      const operavel = podeOperar && z.guid().safeParse(aviso.id).success;
                      const camposAviso = { ...camposEscopo, p_aviso_id: aviso.id, p_estado_esperado: aviso.estado };
                      return (
                      <li key={aviso.id} className="space-y-0.5 py-2">
                        <p className="font-medium">{ROTULO_AVISO[aviso.estado]} · Ocorrência #{aviso.ocorrencia_id}</p>
                        <p className="text-xs text-muted-foreground">
                          Aberto em <time dateTime={aviso.aberto_em}>{formatDateTime(aviso.aberto_em)}</time>
                          {" · "}Referência gravada: <time dateTime={aviso.data_referencia}>{formatDate(aviso.data_referencia)}</time>
                        </p>
                        {operavel && item.permissoes?.reconhecer === true && aviso.estado === "pendente" && (
                          <OperarAvisoEquipamentoForm operacao="reconhecer" operacaoId={randomUUID()} campos={camposAviso} />
                        )}
                        {operavel && item.permissoes?.encaminhar === true && aviso.estado !== "encaminhado" && (
                          <OperarAvisoEquipamentoForm operacao="encaminhar" operacaoId={randomUUID()} campos={camposAviso} />
                        )}
                      </li>
                    ); })}
                  </ul>
                )}
                <details>
                  <summary className="min-h-10 cursor-pointer rounded-sm py-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    Permissões informadas
                  </summary>
                  <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                    {([
                      ["Configurar", item.permissoes?.configurar],
                      ["Avaliar", item.permissoes?.avaliar],
                      ["Reconhecer", item.permissoes?.reconhecer],
                      ["Encaminhar", item.permissoes?.encaminhar],
                    ] as const).map(([rotulo, concedida]) => (
                      <div key={rotulo}>
                        <dt className="font-medium text-foreground">{rotulo}</dt>
                        <dd>{concedida === true ? (escritaHabilitada ? "Concedida na leitura" : "Concedida · só consulta aqui") : concedida === false ? "Não concedida" : "Permissão indisponível"}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
