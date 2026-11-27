/**
 * Orçamentos que vão junto com o pedido (Antonio e Rafaela, 27/11/2026; ordem
 * nova das aprovações, 0188): quem pede manda pelo menos 3 orçamentos de
 * fornecedores diferentes, cada um com o documento. O "Novo pedido" traz três
 * linhas e o botão para mais; aqui se leem as linhas preenchidas.
 */
import { ORCAMENTOS_EXIGIDOS } from "./orcamentos";

/** Linhas que o "Novo pedido" abre de saída (os 3 exigidos). */
export const ORCAMENTOS_INICIAIS_NOVO_PEDIDO = ORCAMENTOS_EXIGIDOS;
export const MAXIMO_ORCAMENTOS_NOVO_PEDIDO = 8;

export function campoOrcamentoNovoPedido(
  indice: number,
  campo: "fornecedor_id" | "fornecedor_nome" | "valor" | "prazo" | "arquivo",
): string {
  return `orcamento_${indice}_${campo}`;
}

export type OrcamentoNovoPedido = {
  fornecedor_id: number | null;
  /** nome escrito à mão; com fornecedor cadastrado, o servidor completa pelo cadastro */
  fornecedor_nome: string | null;
  valor_total: number;
  prazo_entrega_dias: number | null;
  arquivo: File | null;
};

function numeroBr(valor: string): number | null {
  const limpo = valor.trim().replace(/\s/g, "");
  if (!limpo) return null;
  // aceita 1234,56 e 1.234,56 (e 1234.56)
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lê as linhas de orçamento. Linha em branco não conta; linha começada pela
 * metade volta como erro, com o número da linha, para a pessoa completar.
 */
export function lerOrcamentosNovoPedido(formData: FormData): { orcamentos: OrcamentoNovoPedido[]; erro: string | null } {
  const texto = (campo: string) => String(formData.get(campo) ?? "").trim();
  const indices = String(formData.get("orcamentos_indices") ?? "")
    .split(",")
    .filter((indice) => /^\d{1,4}$/.test(indice))
    .map(Number)
    .slice(0, MAXIMO_ORCAMENTOS_NOVO_PEDIDO);
  const orcamentos: OrcamentoNovoPedido[] = [];
  for (const [posicao, indice] of indices.entries()) {
    const enviado = formData.get(campoOrcamentoNovoPedido(indice, "arquivo"));
    const arquivo = enviado instanceof File && enviado.size > 0 ? enviado : null;
    const idTexto = texto(campoOrcamentoNovoPedido(indice, "fornecedor_id"));
    const fornecedorId = /^\d+$/.test(idTexto) ? Number(idTexto) : null;
    const nome = texto(campoOrcamentoNovoPedido(indice, "fornecedor_nome")) || null;
    const valorTexto = texto(campoOrcamentoNovoPedido(indice, "valor"));
    const prazoTexto = texto(campoOrcamentoNovoPedido(indice, "prazo"));
    if (!fornecedorId && !nome && !valorTexto && !prazoTexto && !arquivo) continue;
    const linha = `Orçamento ${posicao + 1}`;
    if (!fornecedorId && !nome) return { orcamentos: [], erro: `${linha}: escolha o fornecedor ou escreva o nome dele.` };
    const valor = numeroBr(valorTexto);
    if (!(valor && valor > 0)) return { orcamentos: [], erro: `${linha}: informe o valor total (maior que zero).` };
    const prazo = prazoTexto ? numeroBr(prazoTexto) : null;
    if (prazo != null && (prazo < 0 || !Number.isInteger(prazo))) {
      return { orcamentos: [], erro: `${linha}: prazo de entrega em dias inteiros (0 ou mais).` };
    }
    orcamentos.push({ fornecedor_id: fornecedorId, fornecedor_nome: nome, valor_total: valor, prazo_entrega_dias: prazo, arquivo });
  }
  return { orcamentos, erro: null };
}

/**
 * O que falta nos orçamentos para enviar (mesma regra do banco,
 * enviar_pedido_interno): 3 fornecedores diferentes e 3 com documento.
 * `nomes` são os nomes já resolvidos (cadastro ou escrito à mão).
 */
export function faltaNosOrcamentosParaEnviar(orcamentos: ReadonlyArray<{ nome: string; comDocumento: boolean }>): string | null {
  const fornecedores = new Set(orcamentos.map((o) => o.nome.trim().toLocaleLowerCase("pt-BR")).filter(Boolean));
  const comDocumento = orcamentos.filter((o) => o.comDocumento).length;
  if (fornecedores.size < ORCAMENTOS_EXIGIDOS) {
    const faltam = ORCAMENTOS_EXIGIDOS - fornecedores.size;
    return `O pedido vai com ${ORCAMENTOS_EXIGIDOS} orçamentos de fornecedores diferentes. Falta${faltam > 1 ? "m" : ""} ${faltam}.`;
  }
  if (comDocumento < ORCAMENTOS_EXIGIDOS) {
    return `Cada um dos ${ORCAMENTOS_EXIGIDOS} orçamentos vai com o documento (PDF ou imagem do fornecedor). ${comDocumento} de ${ORCAMENTOS_EXIGIDOS} têm.`;
  }
  return null;
}
