import { z } from "zod";

const numero = z.number().finite().nonnegative();
const esquema = z.object({
  insumo_id: z.number().int().positive(),
  unidade: z.string().min(1),
  janela_meses: z.number().int().positive(),
  meses_historico: z.number().int().nonnegative(),
  meses_com_saida: z.number().int().nonnegative(),
  media_mensal: numero.nullable(),
  variacao: numero.nullable(),
  ajustes: z.number().int().nonnegative(),
  confianca: z.enum(["alta", "media", "baixa", "sem_dados"]),
  meses: z.array(z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/), saidas: numero, ajustes: z.number().int().nonnegative() })),
  manual: z.object({
    embalagens_mes: numero,
    valor: numero,
    fonte: z.string(),
    data_referencia: z.string(),
    revisao: z.number().int().positive(),
  }).passthrough().nullable(),
  referencia: z.object({
    origem: z.enum(["calculado", "manual", "nenhuma"]),
    valor: numero.nullable(),
  }),
});

export type ConsumoMensal = z.infer<typeof esquema>;
export type Confianca = ConsumoMensal["confianca"];
export type LeituraConsumoMensal = { ok: true; dados: ConsumoMensal } | { ok: false; message: string };

export function consumoMensalDoBanco(valor: unknown, insumoId: number): ConsumoMensal | null {
  const r = esquema.safeParse(valor);
  return r.success && r.data.insumo_id === insumoId ? r.data : null;
}

export const ROTULO_CONFIANCA: Record<Confianca, string> = {
  alta: "Confiança alta",
  media: "Confiança média",
  baixa: "Confiança baixa",
  sem_dados: "Sem dados",
};

/** Motivos em linguagem simples para a confiança e para a referência escolhida. */
export function explicarConsumo(c: ConsumoMensal): string[] {
  const motivos: string[] = [];
  const meses = (n: number) => `${n} ${n === 1 ? "mês" : "meses"}`;
  if (c.meses_historico === 0) {
    motivos.push("Ainda não há nenhum mês completo desde o primeiro registro deste insumo.");
  } else if (c.meses_com_saida === 0) {
    motivos.push(`Nenhuma saída registrada nos últimos ${meses(c.meses_historico)}.`);
  } else {
    motivos.push(`Calculado com ${meses(c.meses_historico)} completos; houve saída em ${meses(c.meses_com_saida)}.`);
    if (c.confianca !== "alta" && c.variacao !== null && c.variacao > 0.6) {
      motivos.push("O consumo muda muito de um mês para outro.");
    }
    if (c.confianca === "baixa" || c.confianca === "media") {
      motivos.push("Com mais meses de uso registrados a confiança sobe.");
    }
  }
  if (c.ajustes > 0) {
    motivos.push(`${c.ajustes} ${c.ajustes === 1 ? "ajuste" : "ajustes"} de estoque no período não ${c.ajustes === 1 ? "conta" : "contam"} como consumo.`);
  }
  if (c.referencia.origem === "manual") motivos.push("Por isso a referência usa a estimativa manual informada.");
  if (c.referencia.origem === "calculado" && c.confianca !== "alta") {
    motivos.push("Sem estimativa manual, a referência usa o cálculo mesmo com pouca confiança.");
  }
  if (c.referencia.origem === "nenhuma") motivos.push("Informe uma estimativa manual abaixo para ter uma referência.");
  return motivos;
}

export function rotuloUnidade(unidade: string, valor: number | null): string {
  if (unidade === "embalagem") return valor === 1 ? "embalagem" : "embalagens";
  return unidade;
}
