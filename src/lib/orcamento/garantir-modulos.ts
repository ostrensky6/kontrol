// Idempotência dos módulos da proposta (Fase 5).
//
// Lógica PURA de decisão (sem I/O), testável: dada a modalidade e os módulos
// ATIVOS já existentes, decide o que criar/abrir/bloquear. A criação real (I/O)
// fica nas server actions, que reusam esta decisão.
//
// Regras:
//   - cria SOMENTE o módulo aplicável que falta;
//   - se já existe 1 módulo ativo → ABRIR (não cria duplicidade);
//   - se existem >1 módulos ativos → BLOQUEAR (não escolhe canônico
//     silenciosamente; exige saneamento via preflight/dedup);
//   - módulo não aplicável à modalidade nunca é criado.
import { modalidadeExigeLaboratorio, modalidadeExigeProjeto } from "./orcamento-economico";

export type AcaoModulo = "criar" | "abrir" | "bloqueado" | "nao_aplicavel";

export type PlanoModulo = {
  aplicavel: boolean;
  ativos: number;
  multiplos: boolean; // ativos > 1 → integridade comprometida
  acao: AcaoModulo;
  moduloId: number | null; // preenchido quando acao === "abrir"
};

export type PlanoModulos = {
  laboratorio: PlanoModulo;
  projeto: PlanoModulo;
  bloqueadoPorDuplicidade: boolean;
  erros: string[];
};

const MSG_DUPLICIDADE = (tipo: string) =>
  `Há orçamentos duplicados neste registro (${tipo}). Peça ao gestor para revisar antes de continuar.`;

function planejarUm(aplicavel: boolean, ativos: number[]): PlanoModulo {
  if (!aplicavel) {
    return { aplicavel: false, ativos: ativos.length, multiplos: false, acao: "nao_aplicavel", moduloId: null };
  }
  if (ativos.length > 1) {
    return { aplicavel: true, ativos: ativos.length, multiplos: true, acao: "bloqueado", moduloId: null };
  }
  if (ativos.length === 1) {
    return { aplicavel: true, ativos: 1, multiplos: false, acao: "abrir", moduloId: ativos[0] };
  }
  return { aplicavel: true, ativos: 0, multiplos: false, acao: "criar", moduloId: null };
}

export function planejarModulosProposta(args: {
  modalidade?: string | null;
  projetoAssociado?: boolean;
  laboratorioAtivos: number[];
  projetoAtivos: number[];
}): PlanoModulos {
  const exigeLab = modalidadeExigeLaboratorio(args.modalidade);
  const exigeProj = modalidadeExigeProjeto(args.modalidade) || Boolean(args.projetoAssociado);

  const laboratorio = planejarUm(exigeLab, args.laboratorioAtivos);
  const projeto = planejarUm(exigeProj, args.projetoAtivos);

  const erros: string[] = [];
  if (laboratorio.multiplos) erros.push(MSG_DUPLICIDADE("laboratorial"));
  if (projeto.multiplos) erros.push(MSG_DUPLICIDADE("de projeto"));

  return {
    laboratorio,
    projeto,
    bloqueadoPorDuplicidade: laboratorio.multiplos || projeto.multiplos,
    erros,
  };
}
