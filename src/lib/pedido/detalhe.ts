import { separarSinonimos } from "@/lib/pedido/natureza";
import { type PedidoItemCatalogo } from "@/components/pedido/PedidoItemCamposAssistidos";
import { PEDIDO_INTERNO_STATUS, type PedidoInternoStatus } from "@/lib/pedido/status";
import type { Tables } from "@/lib/supabase/database.types";

/** Linha de pedidos_internos, como a tela do pedido recebe do banco. */
export type PedidoDetalhe = Tables<"pedidos_internos">;

/** Aparência dos campos soltos (select, input, textarea) dos formulários do pedido. */
export const CLASSE_CAMPO_PEDIDO = "rounded-md border border-input bg-card px-3 py-2 text-sm";

export type PedidoInternoItem = {
  id: number;
  tipo: string;
  especificacao: string;
  modelo: string | null;
  volume: string | null;
  quantidade: number;
  unidade: string | null;
  /** 0123: "embalagem" = quantidade em frascos fechados de conteudo_embalagem. */
  quantidade_em?: string | null;
  conteudo_embalagem?: number | null;
  orcamento_previo: number | null;
  fornecedor_sugerido: string | null;
  observacao: string | null;
  caracteristicas?: string | null;
  exigencia_tecnica?: string | null;
  exclusividade?: string | null;
  outros_fornecedores?: string | null;
  insumo_id: number | null;
  quantidade_recebida: number | null;
  divergencia_recebimento: string | null;
  recebido_em: string | null;
  recebido_por: string | null;
  lote_id: number | null;
  insumos: { especificacao: string | null; unidade: string | null; controlado?: boolean | null; codigo_fabricante?: string | null } | null;
  pedidos_internos_item_recebimentos?: PedidoInternoItemRecebimento[] | null;
};

type PedidoInternoItemRecebimento = {
  id: number;
  lote_id: number | null;
  quantidade: number;
  codigo_lote: string | null;
  fornecedor: string | null;
  validade: string | null;
  responsavel: string | null;
  recebido_em: string;
};

export type InsumoPedidoRaw = {
  id: number;
  especificacao: string | null;
  nome_item?: string | null;
  categoria_compra?: string | null;
  unidade: string | null;
  unidade_consumo?: string | null;
  fabricante?: string | null;
  codigo_fabricante?: string | null;
  custo_unitario?: number | null;
  quantidade_embalagem?: number | null;
  custo_total_embalagem?: number | null;
  sinonimos?: string | null;
  tipo_insumos?: { nome: string | null } | { nome: string | null }[] | null;
  fornecedores?: { nome: string | null } | { nome: string | null }[] | null;
};

export type PedidoItemHistorico = {
  insumo_id: number | null;
  especificacao: string | null;
  unidade: string | null;
  modelo: string | null;
  volume: string | null;
  fornecedor_sugerido: string | null;
};

export type FornecedorRaw = {
  id?: number;
  nome: string | null;
};

export type PedidoInternoAprovacao = {
  id: number;
  etapa: string;
  decisao: string;
  responsavel: string | null;
  papel: string | null;
  comentario: string | null;
  status_origem: string | null;
  status_destino: string | null;
  criado_em: string;
};

export type PedidoInternoAnexo = {
  id: number;
  etapa: string | null;
  tipo: string;
  titulo: string;
  url: string | null;
  arquivo_nome?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  tamanho_bytes?: number | null;
  hash_sha256?: string | null;
  observacao: string | null;
  usuario: string | null;
  criado_em: string;
  downloadUrl?: string | null;
};

export type PedidoInternoComunicacao = {
  id: number;
  etapa: string | null;
  tipo: string;
  remetente: string | null;
  destinatarios: string | null;
  assunto: string | null;
  referencia: string | null;
  observacao: string | null;
  usuario: string | null;
  criado_em: string;
};

export const URGENCIA_LABEL: Record<string, string> = {
  baixa: "Baixa",
  normal: "Normal",
  alta: "Alta",
  critica: "Crítica",
};

export const ANEXO_TIPO_LABEL: Record<string, string> = {
  orcamento_previo: "Cotação prévia",
  proposta: "Cotação do fornecedor",
  print: "Print",
  email: "E-mail",
  termo_referencia: "Termo de referência",
  oficio: "Ofício",
  boleto: "Boleto",
  nota_fiscal: "Nota fiscal",
  comprovante: "Comprovante",
  outro: "Outro",
};

export const COMUNICACAO_TIPO_LABEL: Record<string, string> = {
  email: "E-mail",
  reuniao: "Reunião",
  telefone: "Telefone",
  mensagem: "Mensagem",
  outro: "Outro",
};

export const DECISAO_LABEL: Record<string, string> = {
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  devolvido: "Devolvido",
  registrado: "Registrado",
};

/** Etapas e status gravados como código (ex.: "em_validacao") viram o rótulo do fluxo. */
export function rotuloEtapa(valor: string | null | undefined) {
  if (!valor) return null;
  return PEDIDO_INTERNO_STATUS[valor as PedidoInternoStatus]?.label ?? valor;
}

export function itemTipoLabel(tipo: string | null | undefined) {
  if (tipo === "servico") return "Serviço";
  if (tipo === "equipamento") return "Equipamento";
  return "Material";
}

function pushOpcao(map: Map<number, Set<string>>, id: number, value: string | null | undefined) {
  const valor = String(value ?? "").trim();
  if (!valor) return;
  const set = map.get(id) ?? new Set<string>();
  set.add(valor);
  map.set(id, set);
}

function primeiraRelacao<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function montarCatalogoItens(
  insumos: InsumoPedidoRaw[],
  historico: PedidoItemHistorico[],
  insumosLegado: Set<number>,
): PedidoItemCatalogo[] {
  const unidades = new Map<number, Set<string>>();
  const modelos = new Map<number, Set<string>>();
  const volumes = new Map<number, Set<string>>();
  const fornecedores = new Map<number, Set<string>>();

  for (const insumo of insumos) {
    pushOpcao(unidades, insumo.id, insumo.unidade);
    pushOpcao(unidades, insumo.id, insumo.unidade_consumo);
    pushOpcao(modelos, insumo.id, insumo.fabricante);
    pushOpcao(modelos, insumo.id, insumo.codigo_fabricante);
    pushOpcao(fornecedores, insumo.id, primeiraRelacao(insumo.fornecedores)?.nome);
    if (insumo.quantidade_embalagem && insumo.unidade) {
      pushOpcao(volumes, insumo.id, `${insumo.quantidade_embalagem} ${insumo.unidade}`);
    }
  }

  for (const item of historico) {
    if (!item.insumo_id) continue;
    pushOpcao(unidades, item.insumo_id, item.unidade);
    pushOpcao(modelos, item.insumo_id, item.modelo);
    pushOpcao(volumes, item.insumo_id, item.volume);
    pushOpcao(fornecedores, item.insumo_id, item.fornecedor_sugerido);
  }

  return insumos.map((insumo) => ({
    id: insumo.id,
    especificacao: insumo.especificacao,
    nomeItem: insumo.nome_item,
    categoriaCompra: insumo.categoria_compra,
    tipoInsumo: primeiraRelacao(insumo.tipo_insumos)?.nome,
    unidade: insumo.unidade,
    fabricante: insumo.fabricante,
    codigoFabricante: insumo.codigo_fabricante,
    custoUnitario: insumo.custo_unitario,
    // Mesma regra de kontrol_private.modelo_quantidade_insumo (0123): conta em frascos
    // quando há volume do frasco e unidade, e não restam lotes antigos por volume.
    emFrascos: !insumosLegado.has(insumo.id) && Number(insumo.quantidade_embalagem) > 0 && Boolean(insumo.unidade?.trim()),
    conteudoEmbalagem: insumo.quantidade_embalagem ?? null,
    custoEmbalagem:
      insumo.custo_total_embalagem ??
      (insumo.custo_unitario != null && insumo.quantidade_embalagem
        ? insumo.custo_unitario * insumo.quantidade_embalagem
        : null),
    unidades: [...(unidades.get(insumo.id) ?? [])],
    modelos: [...(modelos.get(insumo.id) ?? [])],
    volumes: [...(volumes.get(insumo.id) ?? [])],
    fornecedores: [...(fornecedores.get(insumo.id) ?? [])],
    sinonimos: separarSinonimos(insumo.sinonimos),
  }));
}

export function catalogoComVinculoAtual(
  catalogo: PedidoItemCatalogo[],
  item: PedidoInternoItem,
): PedidoItemCatalogo[] {
  if (!item.insumo_id || catalogo.some((insumo) => insumo.id === item.insumo_id)) return catalogo;
  return [
    {
      id: item.insumo_id,
      especificacao: `${item.insumos?.especificacao ?? item.especificacao} (inativo)`,
      unidade: item.insumos?.unidade ?? item.unidade,
    },
    ...catalogo,
  ];
}

export function montarFornecedoresPedido(fornecedores: FornecedorRaw[], insumos: InsumoPedidoRaw[], historico: PedidoItemHistorico[]) {
  const opcoes = new Set<string>();
  for (const fornecedor of fornecedores) {
    const nome = String(fornecedor.nome ?? "").trim();
    if (nome) opcoes.add(nome);
  }
  for (const insumo of insumos) {
    const nome = String(primeiraRelacao(insumo.fornecedores)?.nome ?? "").trim();
    if (nome) opcoes.add(nome);
  }
  for (const item of historico) {
    const nome = String(item.fornecedor_sugerido ?? "").trim();
    if (nome) opcoes.add(nome);
  }
  return [...opcoes].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
