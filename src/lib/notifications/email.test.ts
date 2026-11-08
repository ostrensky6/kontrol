import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { dispatchPendingNotificationEmails } from "./email";

const env = {
  NOTIFICATION_EMAIL_DURABLE_ENABLED: "1",
  RESEND_API_KEY: "chave-ficticia",
  RESEND_FROM: "Kontrol <teste@kontrol.invalid>",
  NEXT_PUBLIC_APP_URL: "https://kontrol.invalid",
};
const aviso = {
  id: 10, versao: 2, tipo: "aprovacao_pendente", titulo: "Título sintético",
  corpo: "CORPO_PRIVADO_FICTICIO", entidade_tipo: "pedido_interno",
  entidade_id: 3, criado_em: "2026-09-26T10:00:00Z",
};
const agora = Date.parse("2026-11-07T12:00:00Z");
const lease = "2026-11-07T12:01:00Z";
const provedorId = "00000000-0000-4000-8000-000000000003";
const fila = "listar_email_operacional_v1";
const claim = "iniciar_post_email_operacional_v1";
const resultado = "registrar_resultado_email_operacional_v1";
const destinatarios = "destinatarios_notificacao";
const sucesso = (data: unknown) => ({ data, error: null });
const erro = { data: null, error: { message: "ERRO_PRIVADO_FICTICIO" } };

function laboratorio(options: {
  fila?: unknown;
  erroFila?: boolean;
  lista?: unknown;
  claimDelta?: Record<string, unknown>;
  perderClaim?: boolean;
  perderResultado?: boolean;
  marcadorPendente?: boolean;
  status?: number;
  falhaTransporte?: "TimeoutError" | "TypeError";
  vencerNoPost?: boolean;
} = {}) {
  let iniciou = false;
  let relogio = agora;
  let numeroOperacao = 0;
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === fila) return options.erroFila ? erro : sucesso(options.fila === undefined ? [aviso] : options.fila);
    if (fn === destinatarios) return options.lista === null ? erro : sucesso(options.lista ?? ["coord@kontrol.invalid"]);
    const id = { notificacao_id: args.p_notificacao_id, versao: args.p_versao, operacao_id: args.p_operacao_id };
    if (fn === claim) {
      if (iniciou) return sucesso({ ...id, autorizou_post: false });
      iniciou = true;
      if (options.perderClaim) throw new Error("ERRO_PRIVADO_FICTICIO");
      const payload = String(args.p_payload);
      return sucesso({
        ...id, autorizou_post: true, estado: "POST_INICIADO", geracao: 1, lease_ate: lease,
        payload_sha256: createHash("sha256").update(payload).digest("hex"),
        chave_idempotencia: "kontrol-email:10:2", ...options.claimDelta,
      });
    }
    if (fn === resultado) {
      if (options.perderResultado) return erro;
      const aceito = args.p_resultado === "ACEITO";
      return sucesso({
        ...id, geracao: args.p_geracao,
        estado: aceito ? options.marcadorPendente ? "ACEITO_MARCADOR_PENDENTE" : "ACEITE_REGISTRADO" : args.p_resultado,
        marcador_confirmado: aceito && !options.marcadorPendente,
      });
    }
    throw new Error("RPC fora da reserva sintética");
  });
  const post = vi.fn<typeof fetch>(async () => {
    if (options.vencerNoPost) relogio = Date.parse(lease);
    if (options.falhaTransporte) throw new DOMException("ERRO_PRIVADO_FICTICIO", options.falhaTransporte);
    return new Response(JSON.stringify({ id: provedorId, detalhe: "CORPO_PROVEDOR_FICTICIO" }), { status: options.status ?? 200 });
  });
  const deps = {
    env, post, now: () => relogio,
    operacaoId: () => "00000000-0000-4000-8000-" + String(++numeroOperacao).padStart(12, "0"),
  };
  return { rpc, post, deps, run: (ambiental = env) => dispatchPendingNotificationEmails({ rpc }, { ...deps, env: ambiental }) };
}

describe("dispatcher durável de email operacional", () => {
  it.each([
    { NOTIFICATION_EMAIL_DURABLE_ENABLED: "0" },
    { RESEND_API_KEY: "" },
    { RESEND_FROM: "" },
    { NEXT_PUBLIC_APP_URL: "" },
    { NEXT_PUBLIC_APP_URL: "https://usuario:senha@kontrol.invalid" },
  ])("não consulta nem envia sem configuração explícita válida", async (delta) => {
    const lab = laboratorio();
    expect(await lab.run({ ...env, ...delta })).toMatchObject({ enabled: false, sent: 0, skippedReason: "CONFIGURACAO_AUSENTE_OU_INVALIDA" });
    expect(lab.rpc).not.toHaveBeenCalled();
    expect(lab.post).not.toHaveBeenCalled();
  });

  it.each([{ erroFila: true }, { fila: [{}] }, { fila: [aviso, aviso] }])("não usa fallback se a fila não for confirmada", async (options) => {
    const lab = laboratorio(options);
    expect(await lab.run()).toMatchObject({ enabled: false, sent: 0, skippedReason: "FILA_NAO_CONFIRMADA" });
    expect(lab.rpc.mock.calls).toEqual([[fila, { p_limite: 20 }]]);
    expect(lab.post).not.toHaveBeenCalled();
  });

  it("fila nova vazia é sucesso sem envio e sem ler linhas legadas", async () => {
    const lab = laboratorio({ fila: [] });
    expect(await lab.run()).toMatchObject({ enabled: true, sent: 0, failed: 0 });
    expect(lab.rpc.mock.calls.map(([fn]) => fn)).toEqual([fila]);
    expect(lab.post).not.toHaveBeenCalled();
  });

  it("congela os mesmos bytes antes de um único POST e valida aceite e marcador", async () => {
    const lab = laboratorio();
    const r = await lab.run();
    expect(r).toMatchObject({ enabled: true, sent: 1, accepted: 1, acceptedUnconfirmed: 0, failed: 0 });
    expect(lab.rpc.mock.calls.map(([fn]) => fn)).toEqual([fila, destinatarios, claim, resultado]);
    expect(lab.rpc.mock.calls[1][1]).toEqual({ p_notificacao_id: 10 });
    const inicio = lab.rpc.mock.calls[2][1];
    const fim = lab.rpc.mock.calls[3][1];
    const [url, init] = lab.post.mock.calls[0];
    expect(lab.rpc.mock.invocationCallOrder[2]).toBeLessThan(lab.post.mock.invocationCallOrder[0]);
    expect(url).toBe("https://api.resend.com/emails");
    expect(init).toMatchObject({
      method: "POST", redirect: "error", body: inicio.p_payload,
      headers: { Authorization: "Bearer chave-ficticia", "Content-Type": "application/json", "Idempotency-Key": "kontrol-email:10:2" },
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      from: env.RESEND_FROM, to: ["coord@kontrol.invalid"], html: expect.stringContaining("https://kontrol.invalid/pedido/3"),
    });
    expect(fim).toEqual({
      p_notificacao_id: 10, p_versao: 2, p_operacao_id: inicio.p_operacao_id, p_geracao: 1,
      p_resultado: "ACEITO", p_codigo_http: 200, p_id_provedor: provedorId,
    });
    await lab.run(); // até uma fila obsoleta não obtém nova autorização.
    expect(lab.post).toHaveBeenCalledOnce();
    expect(JSON.stringify(r)).not.toMatch(/kontrol\.invalid|PRIVADO|chave-ficticia|00000000|payload/i);
  });

  it.each([
    { versao: 3 }, { operacao_id: "outra" }, { notificacao_id: 11 }, { payload_sha256: "outro" },
    { estado: "RESERVADO" }, { geracao: 0 }, { lease_ate: "2026-11-07T12:00:00Z" },
    { lease_ate: "2026-11-07T12:01:00" },
  ])("claim incompatível ou expirado não libera POST", async (claimDelta) => {
    const lab = laboratorio({ claimDelta });
    expect(await lab.run()).toMatchObject({ enabled: false, skippedReason: "CLAIM_NAO_CONFIRMADO", reconciliationRequired: 1 });
    expect(lab.post).not.toHaveBeenCalled();
    expect(lab.rpc.mock.calls.map(([fn]) => fn)).toEqual([fila, destinatarios, claim]);
  });

  it("resposta do claim perdida não libera POST nem na próxima chamada", async () => {
    const lab = laboratorio({ perderClaim: true });
    expect(await lab.run()).toMatchObject({ enabled: false, skippedReason: "CLAIM_NAO_CONFIRMADO", sent: 0 });
    await lab.run();
    expect(lab.post).not.toHaveBeenCalled();
  });

  it.each([
    [{ falhaTransporte: "TimeoutError" }, "INCERTO"],
    [{ falhaTransporte: "TypeError" }, "INCERTO"],
    [{ status: 409 }, "REVISAO_NECESSARIA"],
    [{ status: 403 }, "RECUSA_CONFIRMADA"],
  ] as const)("resultado de POST sem confirmação de aceite não reenvia: %j", async (options, estado) => {
    const lab = laboratorio(options);
    const r = await lab.run();
    expect(r).toMatchObject({ sent: 0, accepted: 0, failed: 1 });
    expect(lab.rpc.mock.calls[3][1]).toMatchObject({ p_resultado: estado, p_id_provedor: null });
    expect(JSON.stringify(r)).not.toContain("ERRO_PRIVADO_FICTICIO");
    await lab.run();
    expect(lab.post).toHaveBeenCalledOnce();
  });

  it.each([{ perderResultado: true }, { marcadorPendente: true }, { vencerNoPost: true }])(
    "aceite sem marcador confirmado nunca vira sucesso ou novo POST: %j", async (options) => {
      const lab = laboratorio(options);
      expect(await lab.run()).toMatchObject({ sent: 0, accepted: 1, acceptedUnconfirmed: 1, reconciliationRequired: 1 });
      const finalizacoes = lab.rpc.mock.calls.filter(([fn]) => fn === resultado);
      expect(finalizacoes).toHaveLength("vencerNoPost" in options ? 0 : 1);
      await lab.run();
      expect(lab.post).toHaveBeenCalledOnce();
    },
  );

  it("env fornece candidato de fallback; POST ainda depende de claim autorizado", async () => {
    const ambiental = { ...env, NOTIFICATION_EMAIL_TO: "equipe@kontrol.invalid" };
    const vazia = laboratorio({ lista: [] });
    await vazia.run(ambiental);
    expect(JSON.parse(String(vazia.post.mock.calls[0][1]?.body)).to).toEqual(["equipe@kontrol.invalid"]);
    for (const lista of [null, ["inválido"], ["coord@kontrol.invalid,outra"], []]) {
      const lab = laboratorio({ lista });
      await lab.run(Array.isArray(lista) && lista.length === 0 ? env : ambiental);
      expect(lab.post).not.toHaveBeenCalled();
      expect(lab.rpc.mock.calls.map(([fn]) => fn)).toEqual([fila, destinatarios]);
    }
  });

  it.each([
    { lista: ["coord@kontrol.invalid"], motivo: "resolvido antes e revogado no claim" },
    { lista: [], motivo: "fallback sem autorização privada" },
  ])("claim negado não posta: $motivo", async ({ lista }) => {
    const lab = laboratorio({ lista, claimDelta: { autorizou_post: false } });
    const ambiental = { ...env, NOTIFICATION_EMAIL_TO: "equipe@kontrol.invalid" };
    await lab.run(ambiental);
    expect(lab.post).not.toHaveBeenCalled();
    expect(lab.rpc.mock.calls.map(([fn]) => fn)).toEqual([fila, destinatarios, claim]);
  });
});
