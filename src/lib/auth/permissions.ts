export const PAPEIS = [
  { value: "tecnico", label: "Técnico" },
  { value: "coordenador", label: "Coordenador" },
  { value: "gestor", label: "Gestor" },
  { value: "admin", label: "Administrador" },
] as const;

export type PapelUsuario = (typeof PAPEIS)[number]["value"];
export type PermissaoUsuario =
  | "orcamentos.visualizar"
  | "orcamentos.criar_editar"
  | "orcamentos.emitir"
  | "orcamentos.cancelar"
  | "compras.solicitar"
  | "compras.aprovar"
  | "estoque.movimentar"
  | "estoque.descartar_bloquear"
  | "cadastros.editar"
  | "usuarios.gerenciar"
  | "auditoria.visualizar"
  | "analises.ver"
  | "analises.editar"
  | "insumos.ver"
  | "insumos.editar"
  | "custeio.ver"
  | "estoque.ver"
  | "estoque.lote.aceitar"
  | "estoque.lote.gerir"
  | "planejamento.ver"
  | "planejamento.editar"
  | "pedido.ver"
  | "pedido.criar"
  | "pedido.aprovar"
  | "compras.ver"
  | "compras.receber"
  | "compras.cancelar"
  | "recebimento.ver"
  | "recebimento.registrar"
  | "orcamento.parametros.editar"
  | "projetos.ver"
  | "projetos.editar"
  | "cadastros.ver"
  | "tecnicos.salario.ver"
  | "backups.gerenciar"
  | "privilegios.gerenciar"
  | "configuracoes.ver"
  | "planejamento.executar"
  | "orcamentos.fundos"
  | "orcamentos.modelos";

export const HISTORICAL_ROLE_RECONCILIATION = [
  {
    historico: "usuário",
    atual: "tecnico",
    observacao: "Perfil operacional basico; capacidades historicas de consulta foram recuperadas como permissoes granulares.",
  },
  {
    historico: "coordenador",
    atual: "coordenador",
    observacao: "Equivalencia nominal mantida com permissoes operacionais e de aprovacao.",
  },
  {
    historico: "administrativo",
    atual: "sem papel dedicado",
    observacao:
      "O papel historico nao existe no check atual de perfis; foi preservado como conjunto de capacidades editaveis, sem recriar papel no banco nesta reconciliacao.",
  },
  {
    historico: "gerente",
    atual: "gestor",
    observacao: "Papel gerencial atual absorve as capacidades amplas do gerente historico.",
  },
  {
    historico: "administrador",
    atual: "admin",
    observacao: "Administrador segue como superconjunto; no UI todas as permissoes ficam habilitadas.",
  },
] as const;

export const PERMISSOES: Array<{
  key: PermissaoUsuario;
  modulo: string;
  label: string;
  descricao: string;
}> = [
  // ---- Cadastros ----
  { key: "cadastros.ver", modulo: "Cadastros", label: "Acessar Cadastros", descricao: "Ver o módulo Cadastros (clientes, fornecedores, equipamentos, locais…)." },
  { key: "cadastros.editar", modulo: "Cadastros", label: "Editar cadastros", descricao: "Criar, editar e excluir registros dos cadastros." },
  { key: "projetos.ver", modulo: "Cadastros", label: "Acessar Projetos", descricao: "Ver a visão por projeto." },
  { key: "projetos.editar", modulo: "Cadastros", label: "Editar projetos", descricao: "Criar e editar projetos." },
  {
    // Padrão: somente admin. O banco aplica a mesma regra (migration 0112).
    key: "tecnicos.salario.ver",
    modulo: "Cadastros",
    label: "Ver salário dos técnicos",
    descricao:
      "Ver e alterar o salário dos técnicos e os valores de pessoal (PE) do catálogo. Sem ela, o valor aparece como XXX.",
  },
  // ---- Operação ----
  { key: "analises.ver", modulo: "Operação", label: "Acessar Análises", descricao: "Ver o catálogo de análises, etapas e receitas." },
  { key: "analises.editar", modulo: "Operação", label: "Editar análises", descricao: "Criar, duplicar, editar e excluir análises e receitas." },
  { key: "insumos.ver", modulo: "Operação", label: "Acessar Insumos por análise", descricao: "Ver os insumos de cada análise." },
  { key: "insumos.editar", modulo: "Operação", label: "Editar insumos", descricao: "Criar e editar insumos do cadastro." },
  { key: "custeio.ver", modulo: "Operação", label: "Acessar Custeio", descricao: "Ver o custo técnico das análises." },
  { key: "configuracoes.ver", modulo: "Operação", label: "Acessar Parâmetros de custeio", descricao: "Ver os parâmetros de custeio (horas, rateios, percentuais)." },
  // ---- Suprimentos ----
  { key: "estoque.ver", modulo: "Suprimentos", label: "Acessar Estoque", descricao: "Ver saldos, lotes, inventário, etiquetas e equipamentos." },
  { key: "estoque.movimentar", modulo: "Suprimentos", label: "Dar baixa e registrar entradas", descricao: "Retirar material, abrir frascos, dar baixa e lançar entradas manuais." },
  { key: "estoque.lote.aceitar", modulo: "Suprimentos", label: "Aceitar lotes", descricao: "Liberar lotes em quarentena para uso." },
  { key: "estoque.lote.gerir", modulo: "Suprimentos", label: "Corrigir estoque", descricao: "Ajustar saldos, inventário e estornar recebimentos." },
  { key: "estoque.descartar_bloquear", modulo: "Suprimentos", label: "Bloquear e descartar lotes", descricao: "Bloquear, desbloquear e descartar lotes." },
  { key: "planejamento.ver", modulo: "Suprimentos", label: "Acessar Planejamento", descricao: "Ver planos, reservas e faltas." },
  { key: "planejamento.editar", modulo: "Suprimentos", label: "Montar planejamento", descricao: "Criar e editar planos; liberar, cancelar e excluir." },
  { key: "planejamento.executar", modulo: "Suprimentos", label: "Executar planejamento", descricao: "Reservar insumos e equipamentos, retirar e concluir análises." },
  { key: "pedido.ver", modulo: "Suprimentos", label: "Acessar Pedidos internos", descricao: "Ver pedidos internos e suas etapas." },
  { key: "pedido.criar", modulo: "Suprimentos", label: "Criar pedidos internos", descricao: "Abrir pedidos, anexar documentos e enviar para validação." },
  { key: "pedido.aprovar", modulo: "Suprimentos", label: "Aprovar pedidos internos", descricao: "Validar, devolver, formalizar e conduzir as etapas de compra." },
  { key: "compras.ver", modulo: "Suprimentos", label: "Acessar Compras", descricao: "Ver compras e o painel de Suprimentos." },
  { key: "compras.solicitar", modulo: "Suprimentos", label: "Solicitar compras", descricao: "Criar compras, incluir itens e gerar reposição." },
  { key: "compras.aprovar", modulo: "Suprimentos", label: "Aprovar compras", descricao: "Aprovar, enviar ao fornecedor e encerrar compras com pendência." },
  { key: "compras.receber", modulo: "Suprimentos", label: "Receber compras", descricao: "Registrar a chegada dos itens de uma compra." },
  { key: "compras.cancelar", modulo: "Suprimentos", label: "Cancelar compras e pedidos", descricao: "Cancelar compras e pedidos internos." },
  { key: "recebimento.ver", modulo: "Suprimentos", label: "Acessar Recebimento", descricao: "Ver o que falta chegar." },
  { key: "recebimento.registrar", modulo: "Suprimentos", label: "Receber pedidos internos", descricao: "Registrar a chegada de itens de pedido interno sem compra formal." },
  // ---- Orçamentos ----
  { key: "orcamentos.visualizar", modulo: "Orçamentos", label: "Acessar Orçamentos", descricao: "Ver orçamentos, propostas e valores." },
  { key: "orcamentos.criar_editar", modulo: "Orçamentos", label: "Criar e editar orçamentos", descricao: "Criar orçamentos e preencher análises e custos." },
  { key: "orcamentos.emitir", modulo: "Orçamentos", label: "Revisar e emitir propostas", descricao: "Revisar, recalcular, emitir, classificar e duplicar propostas." },
  { key: "orcamentos.cancelar", modulo: "Orçamentos", label: "Cancelar orçamentos", descricao: "Cancelar orçamentos, módulos e propostas." },
  { key: "orcamento.parametros.editar", modulo: "Orçamentos", label: "Editar parâmetros econômicos", descricao: "Alterar margem, impostos, fundos e parâmetros globais." },
  { key: "orcamentos.fundos", modulo: "Orçamentos", label: "Fundos e taxas", descricao: "Registrar recebimentos, impostos pagos e execução de fundos." },
  { key: "orcamentos.modelos", modulo: "Orçamentos", label: "Modelos e catálogos", descricao: "Manter modelos e o catálogo de custos de projeto." },
  // ---- Governança ----
  { key: "auditoria.visualizar", modulo: "Governança", label: "Ver auditoria", descricao: "Ver a trilha de auditoria e a governança de orçamentos." },
];

const TECNICO: PermissaoUsuario[] = [
  "cadastros.ver",
  "analises.ver",
  "insumos.ver",
  "custeio.ver",
  "estoque.ver",
  "planejamento.ver",
  "pedido.ver",
  "compras.ver",
  "recebimento.ver",
  "orcamentos.visualizar",
  "projetos.ver",
  "orcamentos.criar_editar",
  "compras.solicitar",
  "pedido.criar",
  "recebimento.registrar",
  // 0127: o técnico registra a chegada da compra; o aceite do lote segue com o coordenador.
  "compras.receber",
  "estoque.movimentar",
  "planejamento.executar",
];

const COORDENADOR: PermissaoUsuario[] = [
  ...TECNICO,
  "analises.editar",
  "insumos.editar",
  "projetos.editar",
  "cadastros.editar",
  "orcamentos.emitir",
  "orcamentos.cancelar",
  "compras.aprovar",
  "compras.cancelar",
  "pedido.aprovar",
  "estoque.lote.aceitar",
  "estoque.lote.gerir",
  "planejamento.editar",
];

/**
 * Marcação inicial de cada papel. Reproduz o que cada papel fazia antes da
 * migration 0124 (quando só o papel valia); desde então a caixinha manda e o
 * administrador ajusta por categoria ou por pessoa. Usuários, privilégios e
 * backups ficam só com o admin (não são delegáveis).
 */
const DEFAULT_PERMISSIONS_BY_ROLE: Record<PapelUsuario, PermissaoUsuario[]> = {
  tecnico: TECNICO,
  coordenador: COORDENADOR,
  gestor: [
    ...COORDENADOR,
    "estoque.descartar_bloquear",
    "orcamento.parametros.editar",
    "orcamentos.fundos",
    "orcamentos.modelos",
    "auditoria.visualizar",
    "configuracoes.ver",
  ],
  admin: PERMISSOES.map((permissao) => permissao.key),
};

export function defaultPermissionsForRole(papel: string): PermissaoUsuario[] {
  return DEFAULT_PERMISSIONS_BY_ROLE[(papel as PapelUsuario) || "tecnico"] ?? DEFAULT_PERMISSIONS_BY_ROLE.tecnico;
}

export function normalizePermissions(papel: string, permissoes: unknown): Record<PermissaoUsuario, boolean> {
  const defaults = new Set(defaultPermissionsForRole(papel));
  const raw = typeof permissoes === "object" && permissoes !== null ? (permissoes as Record<string, unknown>) : {};
  return Object.fromEntries(
    PERMISSOES.map((permissao) => [
      permissao.key,
      typeof raw[permissao.key] === "boolean" ? Boolean(raw[permissao.key]) : defaults.has(permissao.key),
    ]),
  ) as Record<PermissaoUsuario, boolean>;
}

export function selectedPermissionsFromForm(formData: FormData, papel: string) {
  const submitted = formData.getAll("permissoes").map(String);
  const explicitamentePresentes = formData.get("permissoes_presentes") === "1";
  const selected = new Set(
    submitted.length > 0 || explicitamentePresentes
      ? submitted
      : defaultPermissionsForRole(papel),
  );
  return Object.fromEntries(
    PERMISSOES.map((permissao) => [
      permissao.key,
      selected.has(permissao.key) || papel === "admin",
    ]),
  );
}
