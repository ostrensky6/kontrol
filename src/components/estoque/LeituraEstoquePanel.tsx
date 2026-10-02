"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Camera, CheckCircle2, Keyboard, Link2, Loader2, PackageMinus, PackagePlus, Plus, Undo2 } from "lucide-react";

import {
  desfazerLeitura,
  identificarCodigoLeitura,
  registrarEntradaLeitura,
  registrarSaidaLeitura,
  vincularCodigoLeitura,
  type InsumoLeitura,
  type ResultadoIdentificacao,
} from "@/lib/actions/leitura-estoque";
import { iniciarLeitorCamera, type ScannerCameraControls } from "@/components/scanner/zxing-adapter";
import { chaveCodigoBarras } from "@/lib/scanner/codigo-barras";
import { formatDate } from "@/lib/formatters";

export type ModoLeitura = "entrada" | "saida";

export type OpcaoSimples = { id: number; nome: string };

/** Mesmo código lido de novo dentro desta janela pede confirmação (leitura dupla do leitor). */
export const JANELA_LEITURA_REPETIDA_MS = 10_000;

type Identificado = Extract<ResultadoIdentificacao, { ok: true; encontrado: true }>;
type NaoIdentificado = Extract<ResultadoIdentificacao, { ok: true; encontrado: false }>;

type Registro = {
  operacaoId: string;
  tipo: ModoLeitura;
  message: string;
  quando: number;
  desfeito: boolean;
};

type Etapa =
  | { tipo: "aguardando" }
  | { tipo: "repetida"; codigo: string; segundos: number }
  | { tipo: "identificado"; leitura: Identificado; operacaoId: string }
  | { tipo: "desconhecido"; leitura: NaoIdentificado };

function novaOperacao() {
  return crypto.randomUUID();
}

export function LeituraEstoquePanel({
  modoInicial,
  insumos,
  locais,
  podeMovimentar,
  podeReceber,
  podeVincular,
}: {
  modoInicial: ModoLeitura;
  insumos: OpcaoSimples[];
  locais: OpcaoSimples[];
  podeMovimentar: boolean;
  podeReceber: boolean;
  podeVincular: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<ScannerCameraControls | null>(null);
  const cameraLigadaRef = useRef(false);
  const ultimaLeituraRef = useRef<{ chave: string; quando: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const [modo, setModo] = useState<ModoLeitura>(modoInicial);
  const [codigo, setCodigo] = useState("");
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "aguardando" });
  const [erro, setErro] = useState<string | null>(null);
  const [cameraStatus, setCameraStatus] = useState<"parada" | "iniciando" | "ativa">("parada");
  const [cameraMensagem, setCameraMensagem] = useState<string | null>(null);
  const [historico, setHistorico] = useState<Registro[]>([]);

  // formulário de entrada
  const [quantidade, setQuantidade] = useState("1");
  const [validade, setValidade] = useState("");
  const [localId, setLocalId] = useState("");
  const [pedidoEscolhido, setPedidoEscolhido] = useState("");

  // vínculo de código desconhecido
  const [busca, setBusca] = useState("");
  const [insumoVinculo, setInsumoVinculo] = useState("");

  const insumosFiltrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    const lista = termo
      ? insumos.filter((i) => i.nome.toLocaleLowerCase("pt-BR").includes(termo) || String(i.id) === termo)
      : insumos;
    return lista.slice(0, 80);
  }, [busca, insumos]);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, []);

  function voltarParaLeitura() {
    setEtapa({ tipo: "aguardando" });
    setCodigo("");
    if (cameraLigadaRef.current) void ligarCamera();
    else requestAnimationFrame(() => inputRef.current?.focus());
  }

  function pararCamera() {
    cameraLigadaRef.current = false;
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraStatus("parada");
  }

  async function ligarCamera() {
    const video = videoRef.current;
    if (!video) return;
    controlsRef.current?.stop();
    setCameraStatus("iniciando");
    setCameraMensagem(null);
    try {
      controlsRef.current = await iniciarLeitorCamera(video, (lido) => {
        // o leitor para sozinho após cada código; volta a ler ao fim do registro
        controlsRef.current = null;
        setCodigo(lido);
        lerCodigo(lido);
      });
      cameraLigadaRef.current = true;
      setCameraStatus("ativa");
    } catch (error) {
      cameraLigadaRef.current = false;
      setCameraStatus("parada");
      setCameraMensagem(
        error instanceof Error ? error.message : "Não foi possível acessar a câmera. Use o leitor USB ou digite o código.",
      );
    }
  }

  function prepararEntrada(leitura: Identificado) {
    setQuantidade("1");
    setValidade(leitura.validadeLida ?? "");
    setLocalId("");
    // pedido em aberto do insumo: oferecido primeiro, para não lançar em dobro
    const pedido = podeReceber ? leitura.insumo.pedidosAbertos.find((p) => p.emEmbalagens) : undefined;
    setPedidoEscolhido(pedido ? `${pedido.pedidoId}:${pedido.itemId}` : "");
  }

  function identificar(lido: string) {
    setErro(null);
    startTransition(async () => {
      const resultado = await identificarCodigoLeitura(lido);
      if (!resultado.ok) {
        setErro(resultado.message);
        setEtapa({ tipo: "aguardando" });
        return;
      }
      if (!resultado.encontrado) {
        setBusca("");
        setInsumoVinculo("");
        setEtapa({ tipo: "desconhecido", leitura: resultado });
        return;
      }
      prepararEntrada(resultado);
      setEtapa({ tipo: "identificado", leitura: resultado, operacaoId: novaOperacao() });
    });
  }

  function lerCodigo(bruto: string, confirmarRepetida = false) {
    const lido = bruto.trim();
    if (!lido) return;
    const chave = chaveCodigoBarras(lido);
    const agora = Date.now();
    const ultima = ultimaLeituraRef.current;
    if (!confirmarRepetida && ultima && ultima.chave === chave && agora - ultima.quando < JANELA_LEITURA_REPETIDA_MS) {
      setEtapa({ tipo: "repetida", codigo: lido, segundos: Math.max(1, Math.round((agora - ultima.quando) / 1000)) });
      return;
    }
    ultimaLeituraRef.current = { chave, quando: agora };
    identificar(lido);
  }

  function concluir(message: string, operacaoId: string, tipo: ModoLeitura) {
    setHistorico((atual) => [{ operacaoId, tipo, message, quando: Date.now(), desfeito: false }, ...atual].slice(0, 10));
    router.refresh();
    voltarParaLeitura();
  }

  function confirmarSaida(leitura: Identificado, operacaoId: string) {
    setErro(null);
    startTransition(async () => {
      const r = await registrarSaidaLeitura({ codigo: leitura.codigo, insumoId: leitura.insumo.id, operacaoId });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      concluir(`${r.message}${r.codigoLote ? ` Lote ${r.codigoLote}.` : ""} Restam ${r.fechadas} fechada(s).`, operacaoId, "saida");
    });
  }

  function confirmarEntrada(leitura: Identificado, operacaoId: string) {
    setErro(null);
    const qtd = Number(quantidade);
    const [pedidoId, itemId] = pedidoEscolhido ? pedidoEscolhido.split(":").map(Number) : [];
    startTransition(async () => {
      const r = await registrarEntradaLeitura({
        codigo: leitura.codigo,
        insumoId: leitura.insumo.id,
        quantidade: qtd,
        validade: validade || null,
        localId: localId ? Number(localId) : null,
        pedido: pedidoId && itemId ? { pedidoId, itemId } : null,
        operacaoId,
      });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      concluir(`${r.message}${r.codigoLote ? ` Lote ${r.codigoLote}.` : ""}`, operacaoId, "entrada");
    });
  }

  function vincular(leitura: NaoIdentificado) {
    setErro(null);
    const id = Number(insumoVinculo);
    startTransition(async () => {
      const r = await vincularCodigoLeitura({ codigo: leitura.codigo, insumoId: id });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      if (!r.encontrado) return;
      prepararEntrada(r);
      setEtapa({ tipo: "identificado", leitura: r, operacaoId: novaOperacao() });
    });
  }

  function desfazer(registro: Registro) {
    setErro(null);
    startTransition(async () => {
      const r = await desfazerLeitura(registro.operacaoId);
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      setHistorico((atual) =>
        atual.map((item) =>
          item.operacaoId === registro.operacaoId ? { ...item, desfeito: true, message: `${item.message} ${r.message}` } : item,
        ),
      );
      router.refresh();
    });
  }

  const inp =
    "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const botaoPrimario =
    "inline-flex items-center justify-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50";
  const botaoSecundario =
    "inline-flex items-center justify-center gap-1.5 rounded-md border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50";

  const ultimo = historico.find((item) => !item.desfeito) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div role="radiogroup" aria-label="Tipo de movimento" className="inline-flex rounded-lg border border-input p-1">
          {(
            [
              ["entrada", "Entrada", PackagePlus],
              ["saida", "Saída (abrir embalagem)", PackageMinus],
            ] as const
          ).map(([valor, rotulo, Icone]) => (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={modo === valor}
              onClick={() => {
                setModo(valor);
                setErro(null);
                if (etapa.tipo !== "identificado") voltarParaLeitura();
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
                modo === valor ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <Icone className="h-4 w-4" />
              {rotulo}
            </button>
          ))}
        </div>

        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            lerCodigo(codigo);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Keyboard className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/80" />
            <label htmlFor={`${uid}-codigo`} className="sr-only">
              Código de barras
            </label>
            <input
              ref={inputRef}
              id={`${uid}-codigo`}
              value={codigo}
              onChange={(event) => setCodigo(event.target.value)}
              autoComplete="off"
              inputMode="text"
              placeholder="Leia com o leitor USB ou digite e tecle Enter"
              className={`${inp} mt-0 pl-8`}
              disabled={pending}
            />
          </div>
          <button type="submit" disabled={pending || codigo.trim().length === 0} className={botaoPrimario}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Ler
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {cameraStatus === "parada" ? (
            <button type="button" onClick={() => void ligarCamera()} className={botaoSecundario}>
              <Camera className="h-4 w-4" />
              Usar câmera do celular
            </button>
          ) : (
            <button type="button" onClick={pararCamera} className={botaoSecundario}>
              Parar câmera
            </button>
          )}
          {cameraStatus === "iniciando" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <div className={`mt-3 overflow-hidden rounded-md border border-border ${cameraStatus === "parada" ? "hidden" : ""}`}>
          <video ref={videoRef} muted playsInline className="aspect-video w-full bg-card object-cover" />
        </div>
        <div aria-live="polite">
          {cameraMensagem && (
            <p className="mt-3 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-strong">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {cameraMensagem}
            </p>
          )}
        </div>

        <div role="status" aria-live="polite" className="mt-4">
          {erro && (
            <p className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {erro}
            </p>
          )}
        </div>

        {etapa.tipo === "repetida" && (
          <div className="mt-4 rounded-lg border border-warning-strong/30 bg-warning-soft p-4 text-sm text-warning-strong">
            <p className="font-medium">
              Este código foi lido há {etapa.segundos} s. É outra embalagem?
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => lerCodigo(etapa.codigo, true)}
                className={botaoPrimario}
              >
                Sim, registrar outra
              </button>
              <button type="button" onClick={voltarParaLeitura} className={botaoSecundario}>
                Não, foi leitura repetida
              </button>
            </div>
          </div>
        )}

        {etapa.tipo === "identificado" && (
          <CartaoIdentificado
            uid={uid}
            modo={modo}
            leitura={etapa.leitura}
            pending={pending}
            podeMovimentar={podeMovimentar}
            podeReceber={podeReceber}
            locais={locais}
            quantidade={quantidade}
            setQuantidade={setQuantidade}
            validade={validade}
            setValidade={setValidade}
            localId={localId}
            setLocalId={setLocalId}
            pedidoEscolhido={pedidoEscolhido}
            setPedidoEscolhido={setPedidoEscolhido}
            onConfirmarEntrada={() => confirmarEntrada(etapa.leitura, etapa.operacaoId)}
            onConfirmarSaida={() => confirmarSaida(etapa.leitura, etapa.operacaoId)}
            onCancelar={voltarParaLeitura}
            inp={inp}
            botaoPrimario={botaoPrimario}
            botaoSecundario={botaoSecundario}
          />
        )}

        {etapa.tipo === "desconhecido" && (
          <div className="mt-4 rounded-lg border border-border p-4 text-sm">
            <p className="font-medium">Código {etapa.leitura.chave} não está vinculado a nenhum insumo.</p>
            <p className="mt-1 text-muted-foreground">{etapa.leitura.message}</p>
            {!etapa.leitura.outroCadastro && (
              <>
                {podeVincular ? (
                  <div className="mt-3 grid gap-2">
                    <label htmlFor={`${uid}-busca`} className="text-xs font-medium text-muted-foreground">
                      Vincular a um insumo existente
                    </label>
                    <input
                      id={`${uid}-busca`}
                      value={busca}
                      onChange={(event) => setBusca(event.target.value)}
                      placeholder="Procure pelo nome"
                      className={inp}
                    />
                    <select
                      aria-label="Insumo"
                      value={insumoVinculo}
                      onChange={(event) => setInsumoVinculo(event.target.value)}
                      size={Math.min(6, Math.max(2, insumosFiltrados.length))}
                      className={inp}
                    >
                      {insumosFiltrados.map((insumo) => (
                        <option key={insumo.id} value={insumo.id}>
                          {insumo.nome}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => vincular(etapa.leitura)}
                      disabled={pending || !insumoVinculo}
                      className={botaoPrimario}
                    >
                      <Link2 className="h-4 w-4" />
                      Vincular código e continuar
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Vincular código a insumo exige a permissão “Editar insumos”.
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {podeVincular && (
                    <Link
                      href={`/cadastros/insumos?novo=1&codigo=${encodeURIComponent(etapa.leitura.chave)}`}
                      className={botaoSecundario}
                    >
                      <Plus className="h-4 w-4" />
                      Cadastrar novo insumo com este código
                    </Link>
                  )}
                  <Link
                    href={`/scanner/desconhecido?codigo=${encodeURIComponent(etapa.leitura.codigo)}`}
                    className={botaoSecundario}
                  >
                    Mandar para Códigos não reconhecidos
                  </Link>
                </div>
              </>
            )}
            <button type="button" onClick={voltarParaLeitura} className="mt-3 text-xs text-muted-foreground underline">
              Ler outro código
            </button>
          </div>
        )}
      </section>

      <aside aria-label="Leituras desta sessão" className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Leituras desta sessão</h2>
          {ultimo && (
            <button
              type="button"
              onClick={() => desfazer(ultimo)}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Desfazer a última
            </button>
          )}
        </div>
        {historico.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nenhuma leitura registrada ainda.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {historico.map((item) => (
              <li
                key={item.operacaoId}
                className={`rounded-md px-3 py-2 text-xs ${item.desfeito ? "bg-muted text-muted-foreground line-through decoration-1" : "bg-brand-50 text-brand-800 dark:bg-brand-950/30 dark:text-brand-300"}`}
              >
                <span className="inline-flex items-center gap-1 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {item.tipo === "entrada" ? "Entrada" : "Saída"} ·{" "}
                  {new Date(item.quando).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="block">{item.message}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Tudo que é lido aqui fica na Auditoria com usuário, data e hora. Desfazer vale para quem leu, por até 2 horas.
        </p>
      </aside>
    </div>
  );
}

function CartaoIdentificado({
  uid,
  modo,
  leitura,
  pending,
  podeMovimentar,
  podeReceber,
  locais,
  quantidade,
  setQuantidade,
  validade,
  setValidade,
  localId,
  setLocalId,
  pedidoEscolhido,
  setPedidoEscolhido,
  onConfirmarEntrada,
  onConfirmarSaida,
  onCancelar,
  inp,
  botaoPrimario,
  botaoSecundario,
}: {
  uid: string;
  modo: ModoLeitura;
  leitura: Identificado;
  pending: boolean;
  podeMovimentar: boolean;
  podeReceber: boolean;
  locais: OpcaoSimples[];
  quantidade: string;
  setQuantidade: (v: string) => void;
  validade: string;
  setValidade: (v: string) => void;
  localId: string;
  setLocalId: (v: string) => void;
  pedidoEscolhido: string;
  setPedidoEscolhido: (v: string) => void;
  onConfirmarEntrada: () => void;
  onConfirmarSaida: () => void;
  onCancelar: () => void;
  inp: string;
  botaoPrimario: string;
  botaoSecundario: string;
}) {
  const insumo: InsumoLeitura = leitura.insumo;
  const pedidos = insumo.pedidosAbertos.filter((p) => p.emEmbalagens);
  const pedidosOutraUnidade = insumo.pedidosAbertos.length - pedidos.length;

  return (
    <div className="mt-4 rounded-lg border border-brand-500/30 p-4 text-sm">
      <p className="text-base font-semibold">{insumo.especificacao}</p>
      <p className="mt-1 text-muted-foreground">
        Em estoque: <b>{insumo.fechadas}</b> {insumo.unidadeSaldo} fechado(s)
      </p>

      {modo === "saida" ? (
        insumo.motivoSemSaida ? (
          <>
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-warning-strong">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {insumo.motivoSemSaida} Nada foi registrado.
            </p>
            <button type="button" autoFocus onClick={onCancelar} className={`${botaoSecundario} mt-3`}>
              Ler outro código
            </button>
          </>
        ) : (
          <>
            <p className="mt-3">
              Abrir <b>1 embalagem</b>
              {insumo.proximaSaida && (
                <>
                  {" "}do lote <b>{insumo.proximaSaida.codigoLote}</b>
                  {insumo.proximaSaida.validade ? ` (vence em ${formatDate(insumo.proximaSaida.validade)})` : ""}
                </>
              )}
              . O lote que vence primeiro sai antes.
            </p>
            {!podeMovimentar && (
              <p className="mt-2 text-xs text-danger-strong">Seu perfil não pode movimentar o estoque.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                autoFocus
                onClick={onConfirmarSaida}
                disabled={pending || !podeMovimentar}
                className={botaoPrimario}
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirmar abertura
              </button>
              <button type="button" onClick={onCancelar} className={botaoSecundario}>
                Cancelar
              </button>
            </div>
          </>
        )
      ) : insumo.modelo === "LEGADO" ? (
        <>
          <p role="alert" className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-warning-strong">
            Este insumo ainda é controlado por volume (modelo antigo). Registre a entrada pelo Controle de Estoque.
          </p>
          <button type="button" autoFocus onClick={onCancelar} className={`${botaoSecundario} mt-3`}>
            Ler outro código
          </button>
        </>
      ) : (
        <form
          className="mt-3 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirmarEntrada();
          }}
        >
          {pedidos.length > 0 && podeReceber && (
            <fieldset className="rounded-md border border-border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">Há pedido de compra em aberto</legend>
              <div className="grid gap-1.5">
                {pedidos.map((p) => (
                  <label key={`${p.pedidoId}:${p.itemId}`} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="pedido"
                      checked={pedidoEscolhido === `${p.pedidoId}:${p.itemId}`}
                      onChange={() => setPedidoEscolhido(`${p.pedidoId}:${p.itemId}`)}
                    />
                    Receber pelo pedido #{p.pedidoId}
                    {p.fornecedor ? ` (${p.fornecedor})` : ""} · faltam {p.pendente}
                  </label>
                ))}
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="pedido"
                    checked={pedidoEscolhido === ""}
                    onChange={() => setPedidoEscolhido("")}
                  />
                  Entrada avulsa (sem pedido)
                </label>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Pelo pedido, a entrada conta como recebimento e não é lançada duas vezes.
              </p>
            </fieldset>
          )}
          {pedidosOutraUnidade > 0 && (
            <p className="text-xs text-muted-foreground">
              Há pedido deste insumo comprado por volume; receba-o em Recebimento.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-quantidade`} className="block text-xs font-medium text-muted-foreground">
                Embalagens recebidas
              </label>
              <input
                id={`${uid}-quantidade`}
                type="number"
                min={1}
                step={1}
                required
                autoFocus
                value={quantidade}
                onChange={(event) => setQuantidade(event.target.value)}
                className={inp}
              />
            </div>
            <div>
              <label htmlFor={`${uid}-validade`} className="block text-xs font-medium text-muted-foreground">
                Validade
              </label>
              <input
                id={`${uid}-validade`}
                type="date"
                value={validade}
                onChange={(event) => setValidade(event.target.value)}
                className={inp}
              />
              {leitura.validadeLida && (
                <p className="mt-1 text-[11px] text-muted-foreground">Lida do código de barras.</p>
              )}
            </div>
          </div>
          <div>
            <label htmlFor={`${uid}-local`} className="block text-xs font-medium text-muted-foreground">
              Local (opcional)
            </label>
            <select
              id={`${uid}-local`}
              value={localId}
              onChange={(event) => setLocalId(event.target.value)}
              className={inp}
            >
              <option value="">Sem local</option>
              {locais.map((local) => (
                <option key={local.id} value={local.id}>
                  {local.nome}
                </option>
              ))}
            </select>
          </div>
          {!(pedidoEscolhido ? podeReceber : podeMovimentar) && (
            <p className="text-xs text-danger-strong">Seu perfil não pode registrar esta entrada.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pending || !(pedidoEscolhido ? podeReceber : podeMovimentar)}
              className={botaoPrimario}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar entrada
            </button>
            <button type="button" onClick={onCancelar} className={botaoSecundario}>
              Cancelar
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            O lote é criado sozinho (código LEIT-…); sem validade, o alerta de vencimento não vale para ele.
          </p>
        </form>
      )}
    </div>
  );
}
