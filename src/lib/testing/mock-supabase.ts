type Row = Record<string, unknown>;
type Store = Record<string, Row[]>;

const HISTORICAL_ANALISES: Row[] = [
  {
    codigo: "Eletrof_vir_hem",
    nome: "Eletroforese hemolinfa",
    nome_simplificado: "Eletroforese hemolinfa",
    descricao: "Gel para hemolinfa",
    status: "Ativo - ainda e feito",
    ativo: true,
    ofertavel: true,
  },
  {
    codigo: "Eletrof_vir_tec",
    nome: "Eletroforese tecido",
    nome_simplificado: "Eletroforese tecido",
    descricao: "Gel para tecido",
    status: "Ativo - ainda e feito",
    ativo: true,
    ofertavel: true,
  },
  {
    codigo: "Illumina_16S_AC",
    nome: "16S alta cobertura",
    nome_simplificado: "16S alta cobertura",
    descricao: "Sequenciamento focado em microbioma, com alta cobertura",
    status: "Ativo - oferecivel; manter alta cobertura",
    ativo: true,
    ofertavel: true,
  },
  {
    codigo: "Illumina_Sh",
    nome: "Shotgun",
    nome_simplificado: "Shotgun",
    descricao: "Sequenciamento shotgun, com qualquer marcador",
    status: "Ativo - TODO tecnico: revisar quantificacao de insumos",
    ativo: true,
    ofertavel: true,
  },
  {
    codigo: "Illumina_Sh_qPCR",
    nome: "Shotgun com qPCR",
    nome_simplificado: "Shotgun com qPCR",
    descricao: "Shotgun substituindo algumas etapas por qPCR para otimizacao de tempo e custo",
    status: "Experimental - em avaliacao; nao oferecer em orcamentos",
    ativo: false,
    ofertavel: false,
  },
  {
    codigo: "RTqPCR_RNA_virus_H",
    nome: "RT-qPCR virus hemolinfa",
    nome_simplificado: "RT-qPCR virus hemolinfa",
    descricao: "PCR em tempo real de virus 1",
    status: "Ativo - ainda e feito",
    ativo: true,
    ofertavel: true,
  },
  {
    codigo: "RTqPCR_RNA_virus_T",
    nome: "RT-qPCR virus tecidos",
    nome_simplificado: "RT-qPCR virus tecidos",
    descricao: "PCR em tempo real de virus 2",
    status: "Ativo - ainda e feito",
    ativo: true,
    ofertavel: true,
  },
  {
    codigo: "Sanger",
    nome: "Sanger",
    nome_simplificado: "Sanger",
    descricao: "Sequenciamento Sanger",
    status: "Ativo - ainda pode ser oferecido",
    ativo: true,
    ofertavel: true,
  },
  {
    codigo: "qPCR_F",
    nome: "qPCR com filtracao",
    nome_simplificado: "qPCR com filtracao",
    descricao: "PCR em tempo real com filtracao",
    status: "Ativo - ainda e feito",
    ativo: true,
    ofertavel: true,
  },
  {
    codigo: "qPCR_SF",
    nome: "qPCR sem filtracao",
    nome_simplificado: "qPCR sem filtracao",
    descricao: "PCR em tempo real sem filtracao",
    status: "Ativo - ainda e feito",
    ativo: true,
    ofertavel: true,
  },
];

const HISTORICAL_ANALISE_CODES = HISTORICAL_ANALISES.map((analise) => String(analise.codigo));

const MOCK_PERMISSOES_CATEGORIAS = [
  {
    papel: "tecnico",
    permissoes: {
      "orcamentos.visualizar": true,
      "orcamentos.criar_editar": true,
      "compras.solicitar": true,
      "estoque.movimentar": true,
      "analises.ver": true,
      "insumos.ver": true,
      "custeio.ver": true,
      "estoque.ver": true,
      "planejamento.ver": true,
      "pedido.ver": true,
      "pedido.criar": true,
      "compras.ver": true,
      "recebimento.ver": true,
      "projetos.ver": true,
      "cadastros.ver": true,
      "tecnicos.salario.ver": false,
    },
  },
  {
    papel: "coordenador",
    permissoes: {
      "orcamentos.visualizar": true,
      "orcamentos.criar_editar": true,
      "orcamentos.emitir": true,
      "compras.solicitar": true,
      "compras.aprovar": true,
      "estoque.movimentar": true,
      "cadastros.editar": true,
      "analises.ver": true,
      "analises.editar": true,
      "insumos.ver": true,
      "insumos.editar": true,
      "custeio.ver": true,
      "estoque.ver": true,
      "estoque.lote.aceitar": true,
      "planejamento.ver": true,
      "planejamento.editar": true,
      "pedido.ver": true,
      "pedido.criar": true,
      "pedido.aprovar": true,
      "compras.ver": true,
      "compras.receber": true,
      "recebimento.ver": true,
      "recebimento.registrar": true,
      "projetos.ver": true,
      "projetos.editar": true,
      "cadastros.ver": true,
      "tecnicos.salario.ver": false,
    },
  },
  {
    papel: "gestor",
    permissoes: {
      "orcamentos.visualizar": true,
      "orcamentos.criar_editar": true,
      "orcamentos.emitir": true,
      "orcamentos.cancelar": true,
      "compras.solicitar": true,
      "compras.aprovar": true,
      "estoque.movimentar": true,
      "estoque.descartar_bloquear": true,
      "cadastros.editar": true,
      "auditoria.visualizar": true,
      "analises.ver": true,
      "analises.editar": true,
      "insumos.ver": true,
      "insumos.editar": true,
      "custeio.ver": true,
      "estoque.ver": true,
      "estoque.lote.aceitar": true,
      "estoque.lote.gerir": true,
      "planejamento.ver": true,
      "planejamento.editar": true,
      "pedido.ver": true,
      "pedido.criar": true,
      "pedido.aprovar": true,
      "compras.ver": true,
      "compras.receber": true,
      "compras.cancelar": true,
      "recebimento.ver": true,
      "recebimento.registrar": true,
      "orcamento.parametros.editar": true,
      "projetos.ver": true,
      "projetos.editar": true,
      "cadastros.ver": true,
      "tecnicos.salario.ver": false,
      "configuracoes.ver": true,
    },
  },
  {
    papel: "admin",
    permissoes: {
      "orcamentos.visualizar": true,
      "orcamentos.criar_editar": true,
      "orcamentos.emitir": true,
      "orcamentos.cancelar": true,
      "compras.solicitar": true,
      "compras.aprovar": true,
      "estoque.movimentar": true,
      "estoque.descartar_bloquear": true,
      "cadastros.editar": true,
      "usuarios.gerenciar": true,
      "auditoria.visualizar": true,
      "analises.ver": true,
      "analises.editar": true,
      "insumos.ver": true,
      "insumos.editar": true,
      "custeio.ver": true,
      "estoque.ver": true,
      "estoque.lote.aceitar": true,
      "estoque.lote.gerir": true,
      "planejamento.ver": true,
      "planejamento.editar": true,
      "pedido.ver": true,
      "pedido.criar": true,
      "pedido.aprovar": true,
      "compras.ver": true,
      "compras.receber": true,
      "compras.cancelar": true,
      "recebimento.ver": true,
      "recebimento.registrar": true,
      "orcamento.parametros.editar": true,
      "projetos.ver": true,
      "projetos.editar": true,
      "cadastros.ver": true,
      "tecnicos.salario.ver": true,
      "backups.gerenciar": true,
      "privilegios.gerenciar": true,
      "configuracoes.ver": true,
    },
  },
];

const baseStore = (): Store => {
  const insumos = HISTORICAL_ANALISE_CODES.map((codigo, index) => ({
    id: index + 1,
    especificacao: `Insumo mock ${codigo}`,
    custo_unitario: 20 + index,
    unidade: "un",
    unidade_consumo: "un",
    fator_conversao: 1,
  }));
  const custosEstoque = insumos.map((insumo) => ({
    insumo_id: insumo.id,
    custo_padrao: insumo.custo_unitario,
    custo_medio_ponderado: null,
    unidade_estoque: insumo.unidade,
    unidade_consumo: insumo.unidade_consumo,
    fator_conversao: insumo.fator_conversao,
    custo_origem: insumo.custo_unitario,
    custo_normalizado: insumo.custo_unitario / insumo.fator_conversao,
    fonte_custo: "custo_padrao",
    referencia_custo: `insumos:${insumo.id}`,
  }));
  const seed: Store = {
  orcamentos: [
    {
      id: 1,
      tipo: "analises",
      cliente_nome: "Cliente Demo",
      cliente_id: null,
      cliente_cnpj: null,
      cliente_endereco: null,
      cliente_contato: null,
      data_orcamento: "2026-06-14",
      validade_dias: 30,
      responsavel: "Kontrol",
      observacoes: null,
      status: "rascunho",
      projeto_id: null,
      criado_em: "2026-06-14T10:00:00.000Z",
    },
  ],
  orcamento_itens: [
    {
      id: 1,
      orcamento_id: 1,
      codigo_analise: "Illumina_16S_AC",
      n_amostras: 12,
      custo_unitario: 45,
      preco_unitario: 90,
    },
  ],
  orcamento_projetos: [],
  orcamento_final_versoes: [],
  eventos_status: [],
  orcamento_projeto_analises: [],
  orcamento_projeto_custos: [],
  orcamento_projeto_catalogo: [],
  demanda_analises: [],
  demanda_grupos_amostras: [],
  projetos: [{ id: 1, nome: "Projeto E2E" }],
  clientes: [{ id: 1, nome: "Cliente Cadastrado", ativo: true }],
  analises: HISTORICAL_ANALISES,
  insumos,
  etapas: HISTORICAL_ANALISE_CODES.map((codigo) => ({
    codigo_analise: codigo,
    nome_etapa: "Preparo",
    nome_atividade: codigo.includes("qPCR") ? "qPCR" : "Rotina laboratorial",
    execucoes_por_dia: 1,
    amostras_por_execucao: 12,
    tempo_maquina_h: 1,
    tempo_bancada_h: 2,
    escopo_operacional: "laboratorio",
  })),
  equipamentos: [{
    id: 1,
    nome: "Equipamento mock",
    quantidade: 1,
    custo_unitario: 30,
    vida_util_anos: 5,
    percentual_manutencao_anual: 0.05,
    manutencao_anual_fixa: 0,
    custo_hora: 30,
    ativo: true,
  }],
  equipamento_analise: HISTORICAL_ANALISE_CODES.map((codigo) => ({
    codigo_analise: codigo,
    equipamento_id: 1,
    peso_alocacao: 1,
    tempo_horas: 1,
    equipamentos: { custo_hora: 30 },
  })),
  tecnicos: [],
  overhead: [],
  insumo_analise: HISTORICAL_ANALISE_CODES.map((codigo, index) => ({
    codigo_analise: codigo,
    nome_etapa: "Preparo",
    nome_atividade: codigo.includes("qPCR") ? "qPCR" : "Rotina laboratorial",
    especificacao_insumo: `Insumo mock ${codigo}`,
    unidade: "un",
    grupo_escolha: null,
    quantidade_por_amostra: 1,
    modo_cobranca: "por_amostra",
    insumo_id: insumos[index].id,
    insumos: { custo_unitario: insumos[index].custo_unitario },
  })),
  v_custo_estoque_vigente: custosEstoque,
  parametros: [
    { chave: "dias_uteis_ano", valor: 222 },
    { chave: "margem_lucro", valor: 100 },
    { chave: "impostos", valor: 0 },
    { chave: "taxas", valor: 0 },
    { chave: "fundo_reserva", valor: 0 },
    { chave: "fundo_investimento", valor: 0 },
  ],
  v_estoque_saldo: [
    {
      insumo_id: 1,
      especificacao: "Mix PCR",
      unidade: "uL",
      em_maos: 0,
      em_quarentena: 0,
      reservado: 0,
      disponivel: 0,
      ponto_reposicao: 10,
    },
    {
      // Insumo no modelo de embalagens fechadas (0109), com dois lotes
      // aceitos para exercitar a baixa por embalagens e a escolha FEFO.
      insumo_id: 900,
      especificacao: "Kit extração E2E",
      unidade: "kit",
      em_maos: 60,
      em_quarentena: 0,
      reservado: 0,
      disponivel: 60,
      ponto_reposicao: 0,
    },
  ],
  v_alertas_estoque: [
    {
      tipo: "reposicao",
      insumo_id: 1,
      especificacao: "Mix PCR",
      validade: null,
      valor: 0,
      referencia: 10,
    },
  ],
  pedidos_compra: [],
  planejamento: [],
  planejamento_itens: [],
  demandas: [],
  compras: [],
  movimentacoes_estoque: [],
  lotes_estoque: [
    {
      id: 1,
      insumo_id: 900,
      codigo_lote: "EMB-E2E-A",
      validade: "2099-06-30",
      validade_apos_abertura: null,
      quantidade_inicial: 40,
      quantidade_atual: 40,
      custo_unitario: 100,
      status: "aceito",
      modelo_quantidade: "EMBALAGEM_FECHADA",
    },
    {
      id: 2,
      insumo_id: 900,
      codigo_lote: "EMB-E2E-B",
      validade: "2099-12-31",
      validade_apos_abertura: null,
      quantidade_inicial: 20,
      quantidade_atual: 20,
      custo_unitario: 100,
      status: "aceito",
      modelo_quantidade: "EMBALAGEM_FECHADA",
    },
  ],
  estoque_movimentacoes: [],
  reservas_estoque: [],
  perfis: [{ id: "user-e2e", nome: "Admin E2E", email: "admin@example.com", papel: "admin" }],
  permissoes_categorias: MOCK_PERMISSOES_CATEGORIAS,
  notificacoes: [
    {
      id: 1,
      tipo: "falta_plano",
      titulo: "Falta de estoque no planejamento",
      corpo: "Mix PCR: falta 10 uL no planejamento #1.",
      entidade_tipo: "planejamento",
      entidade_id: 1,
      papel_destino: "coordenador",
      status: "nao_lida",
      canal: "in_app",
      dedupe_key: "e2e:falta-plano",
      criado_em: "2026-06-20T10:00:00.000Z",
      lida_em: null,
    },
  ],
  v_dashboard_executivo: [
    {
      valor_estoque_ativo: 0,
      valor_vencendo_horizonte: 0,
      lotes_vencendo_horizonte: 0,
      orcamentos_rascunho: 1,
      orcamentos_enviados: 0,
      orcamentos_aprovados: 0,
      orcamentos_perdidos: 0,
      margem_media_pct: 0,
      compras_abertas_valor: 0,
      gasto_por_projeto_mes: [],
    },
  ],
  };

  // Fixtures exclusivas do modo e2e (dev server com PLAYWRIGHT_MOCK_SUPABASE=1).
  // Unit tests NAO setam esse env, entao a store minima deles permanece intacta.
  // Monta uma demanda MISTA (laboratorio + projeto) para renderizar a etapa de
  // Parametros Economicos em /orcamento/demandas/1.
  if (process.env.PLAYWRIGHT_MOCK_SUPABASE === "1") {
    seed.demandas_propostas = [
      {
        id: 1,
        titulo: "Demanda Demo — Projeto + Análises",
        cliente_id: 1,
        cliente_nome: "Cliente Demo",
        modalidade: "projeto_analises_custos",
        projeto_id: 1,
        descricao: "Demanda de demonstração para a etapa de parâmetros.",
        escopo_preliminar: "Escopo demonstrativo com laboratório e projeto.",
        matriz_amostra: "Solo",
        quantidade_amostras_estimada: 12,
        prazo_tecnico_dias: 30,
        criado_em: "2026-06-21T10:00:00.000Z",
      },
    ];
    const provenienciaDimensional = (codigo: string) => {
      const ficha = seed.insumo_analise.find((item) => item.codigo_analise === codigo);
      const custo = custosEstoque.find((item) => item.insumo_id === ficha?.insumo_id);
      if (!ficha || !custo) throw new Error(`Fixture dimensional ausente para ${codigo}.`);
      const fator = Number(custo.fator_conversao);
      const quantidade = Number(ficha.quantidade_por_amostra);
      return [{
        insumo_id: Number(ficha.insumo_id),
        unidade_estoque: custo.unidade_estoque,
        unidade_consumo: custo.unidade_consumo,
        fator_conversao: fator,
        fonte_custo: custo.fonte_custo,
        referencia_custo: custo.referencia_custo,
        custo_unitario_estoque: custo.custo_padrao,
        custo_unitario_consumo: Number(custo.custo_padrao) / fator,
        quantidade_consumo: quantidade,
        quantidade_estoque: quantidade / fator,
      }];
    };
    const provenienciaIllumina = provenienciaDimensional("Illumina_16S_AC");
    const provenienciaQpcr = provenienciaDimensional("qPCR_F");
    seed.orcamentos.push({
      id: 2,
      demanda_id: 1,
      tipo: "analises",
      cliente_nome: "Cliente Demo",
      status: "enviado",
      status_operacional: "revisado",
      fonte_custo_insumos: "custo_padrao",
      custo_snapshot: {
        fonte_custo_insumos: "custo_padrao",
        totais: { custo: 740, preco: 1480, amostras: 17 },
        linhas: [
          { codigo_analise: "Illumina_16S_AC", quantidade: 12, custo: 540, preco: 1080, proveniencia_dimensional: provenienciaIllumina },
          { codigo_analise: "qPCR_F", quantidade: 5, custo: 200, preco: 400, proveniencia_dimensional: provenienciaQpcr },
        ],
      },
      responsavel_tecnico: "Responsavel E2E",
      data_orcamento: "2026-06-21",
      criado_em: "2026-06-21T10:00:00.000Z",
    });
    seed.orcamento_itens.push({
      id: 2,
      orcamento_id: 2,
      codigo_analise: "Illumina_16S_AC",
      n_amostras: 12,
      custo_unitario: 45,
      preco_unitario: 90,
      valor_snapshot: { fonte_custo_insumos: "custo_padrao", proveniencia_dimensional: provenienciaIllumina },
    });
    seed.orcamento_itens.push({
      id: 3,
      orcamento_id: 2,
      codigo_analise: "qPCR_F",
      n_amostras: 5,
      custo_unitario: 40,
      preco_unitario: 80,
      valor_snapshot: { fonte_custo_insumos: "custo_padrao", proveniencia_dimensional: provenienciaQpcr },
    });
    seed.demanda_analises = [
      {
        id: 1,
        demanda_id: 1,
        codigo_analise: "Illumina_16S_AC",
        quantidade_amostras: 12,
        origem_quantidade: "padrao",
        status_custeio: "disponivel",
      },
      {
        id: 2,
        demanda_id: 1,
        codigo_analise: "qPCR_F",
        quantidade_amostras: 5,
        origem_quantidade: "manual",
        status_custeio: "disponivel",
      },
    ];
    seed.orcamento_projetos = [
      {
        id: 1,
        demanda_id: 1,
        titulo: "Projeto Demo",
        status: "enviado",
        data_orcamento: "2026-06-21",
        impostos: 0,
        margem_lucro: 0,
        impostos_legacy: 10,
        incubacao: 5,
        reserva: 5,
        investimentos: 5,
        lucro: 20,
        projeto_sem_custo_justificativa: null,
        criado_em: "2026-06-21T10:00:00.000Z",
      },
    ];
    seed.orcamento_projeto_custos = [
      {
        id: 1,
        orcamento_projeto_id: 1,
        rubrica: "MC",
        categoria: "materiais",
        descricao: "Material de coleta",
        quantidade: 1,
        custo_unitario: 500,
        preco_unitario: 500,
        meses_selecionados: [],
        origem: "manual",
      },
    ];
    // Salário sigiloso (migration 0112). Dedicação 0: o técnico não altera o
    // valor-hora de pessoal usado pelas demais fixtures de custeio/orçamento.
    seed.tecnicos = [
      {
        id: 1,
        nome: "Técnica E2E",
        processo: "Laboratório",
        valor_mes: 8123.45,
        horas_mes_base: 160,
        percentual_dedicado: 0,
      },
    ];

    // Proposta só de projeto com custos em edição (rascunho): usada pelo editor da
    // etapa "Custos do projeto" (e2e/orcamento-projeto-editor.spec.ts). A demanda 1
    // continua com o projeto revisado para a emissão.
    seed.demandas_propostas.push({
      id: 2,
      titulo: "Proposta Demo — Custos de projeto",
      cliente_id: 1,
      cliente_nome: "Cliente Demo",
      modalidade: "projeto",
      projeto_id: 1,
      descricao: "Proposta de demonstração para o editor de custos de projeto.",
      escopo_preliminar: "Campanha de campo com equipe e viagens.",
      criado_em: "2026-06-22T10:00:00.000Z",
    });
    seed.orcamento_projetos.push({
      id: 2,
      demanda_id: 2,
      titulo: "Projeto de campo demo",
      status: "rascunho",
      data_orcamento: "2026-06-22",
      project_months: 18,
      impostos: 0,
      margem_lucro: 0,
      impostos_legacy: 10,
      incubacao: 5,
      reserva: 5,
      investimentos: 5,
      lucro: 20,
      travel_inputs: {},
      projeto_sem_custo_justificativa: null,
      criado_em: "2026-06-22T10:00:00.000Z",
    });
    seed.orcamento_projeto_custos.push({
      id: 2,
      orcamento_projeto_id: 2,
      rubrica: "PE",
      categoria: "mao_obra",
      descricao: "Pesquisador bolsista",
      unidade: "mês",
      quantidade: 1,
      custo_unitario: 3000,
      preco_unitario: 3000,
      meses_selecionados: [],
      origem: "manual",
      etapa: "Equipe",
    });
    // Recorte do catálogo importado do app antigo (migration 0012).
    seed.orcamento_projeto_catalogo = [
      { id: "PE-1", rubrica: "PE", descricao: "Pesquisador sênior", unidade: "mês", preco_unitario: 8000, categoria: "Equipe técnica", ativo: true },
      { id: "MC-12", rubrica: "MC", descricao: "Alcool", unidade: "L", preco_unitario: 380, categoria: "Geral (coleta)", ativo: true },
      { id: "MC-30", rubrica: "MC", descricao: "Luvas nitrílicas", unidade: "cx", preco_unitario: 45, categoria: "Geral (coleta)", ativo: true },
      { id: "MC-99", rubrica: "MC", descricao: "Item arquivado", unidade: "un", preco_unitario: 1, categoria: "Geral", ativo: false },
      { id: "VD-1", rubrica: "VD", descricao: "Alimentação", unidade: "refeições", preco_unitario: 130, categoria: "Alimentação", ativo: true },
      { id: "VD-2", rubrica: "VD", descricao: "Hospedagem", unidade: "diárias de hotel", preco_unitario: 250, categoria: "Hospedagem", ativo: true },
      { id: "VD-3", rubrica: "VD", descricao: "Combustível", unidade: "L", preco_unitario: 7.2, categoria: "Deslocamento", ativo: true },
      { id: "VD-4", rubrica: "VD", descricao: "Seguro viagem", unidade: "diárias", preco_unitario: 15, categoria: "Outros", ativo: true },
      { id: "VD-5", rubrica: "VD", descricao: "Aluguel de veículo + taxa de limpeza + seguro", unidade: "diárias", preco_unitario: 390, categoria: "Deslocamento", ativo: true },
      { id: "VD-6", rubrica: "VD", descricao: "Pedágio", unidade: "un", preco_unitario: 25, categoria: "Deslocamento", ativo: true },
      // Itens E2E do salário (0112): preço PE sigiloso.
      {
        id: "PE-E2E",
        rubrica: "PE",
        descricao: "Pessoa E2E - Pesquisadora",
        unidade: "mês",
        preco_unitario: 7654.32,
        categoria: "Doutora",
        ativo: true,
        valid_from: null,
        origem: "kontrol",
        criado_em: "2026-06-21T10:00:00.000Z",
        atualizado_em: "2026-06-21T10:00:00.000Z",
      },
      {
        id: "MC-E2E",
        rubrica: "MC",
        descricao: "Material E2E",
        unidade: "un",
        preco_unitario: 12.5,
        categoria: "Geral",
        ativo: true,
        valid_from: null,
        origem: "kontrol",
        criado_em: "2026-06-21T10:00:00.000Z",
        atualizado_em: "2026-06-21T10:00:00.000Z",
      },
    ];
    // Plano que já teve baixa de material: só pode ser cancelado (0111).
    seed.planejamento = [
      {
        id: 900,
        nome: "Plano com baixa E2E",
        projeto_id: 1,
        status_operacional: "em_execucao",
        reserva_desatualizada: false,
        prioridade: "normal",
        origem_planejamento: "manual",
        data_inicio_prevista: "2026-06-22",
        data_fim_prevista: "2026-06-30",
        data_alvo: "2026-06-30",
        criado_em: "2026-06-21T10:00:00.000Z",
      },
    ];
    seed.planejamento_itens = [
      { id: 900, planejamento_id: 900, codigo_analise: "qPCR_F", n_amostras: 5, n_controles: 0, repeticoes: 1, perda_percentual: 0 },
    ];
    seed.reservas_estoque = [
      { id: 900, planejamento_id: 900, insumo_id: 1, lote_id: null, quantidade: 5, quantidade_consumida: 5, status: "consumido" },
    ];
  }

  return seed;
};

const store = (globalThis as typeof globalThis & { __kontrolMockStore?: Store }).__kontrolMockStore ?? baseStore();
(globalThis as typeof globalThis & { __kontrolMockStore?: Store }).__kontrolMockStore = store;

export function resetMockSupabaseStore() {
  const fresh = baseStore();
  for (const key of Object.keys(store)) delete store[key];
  Object.assign(store, fresh);
}

export function getMockSupabaseStore() {
  return store;
}

const nextId = (table: string) =>
  Math.max(0, ...((store[table] ?? []) as Row[]).map((row) => Number(row.id) || 0)) + 1;

function valoresIguais(a: unknown, b: unknown) {
  return a === b || String(a) === String(b);
}

function compararValores(a: unknown, b: unknown) {
  const numeroA = Number(a);
  const numeroB = Number(b);
  if (Number.isFinite(numeroA) && Number.isFinite(numeroB)) return numeroA - numeroB;
  return String(a).localeCompare(String(b));
}

function withRelations(table: string, row: Row): Row {
  if (table === "orcamentos") {
    return {
      ...row,
      orcamento_itens: store.orcamento_itens.filter((item) => item.orcamento_id === row.id),
    };
  }
  if (table === "orcamento_projetos") {
    return {
      ...row,
      orcamento_projeto_analises: store.orcamento_projeto_analises.filter((item) => item.orcamento_projeto_id === row.id),
      orcamento_projeto_custos: store.orcamento_projeto_custos.filter((item) => item.orcamento_projeto_id === row.id),
    };
  }
  if (table === "planejamento") {
    return {
      ...row,
      reservas_estoque: (store.reservas_estoque ?? []).filter((item) => valoresIguais(item.planejamento_id, row.id)),
    };
  }
  if (table === "lotes_estoque") {
    const saldo = store.v_estoque_saldo.find((item) => item.insumo_id === row.insumo_id);
    return {
      ...row,
      insumos: { especificacao: saldo?.especificacao ?? "Mix PCR", unidade: saldo?.unidade ?? "uL" },
    };
  }
  return row;
}

type MockErro = { message: string; code?: string };
type MockResultado = { data: unknown; error: MockErro | null };

/**
 * Sessão simulada. `papel` troca SOMENTE a avaliação de permissão granular
 * (tem_permissao / salário) — as checagens de papel do app continuam lendo o
 * perfil admin do mock. Usado pelo E2E via cookie `kontrol_e2e_papel`.
 */
export type SessaoMock = { papel?: string };

const MOCK_USER_ID = "user-e2e";

/** Colunas sem SELECT direto para authenticated (migration 0112). */
const COLUNAS_SIGILOSAS: Record<string, string[]> = {
  tecnicos: ["valor_mes"],
  orcamento_projeto_catalogo: ["preco_unitario"],
};

/** Mesma regra de kontrol_private.tem_permissao_efetiva (0112). */
function mockTemPermissao(chave: unknown, sessao: SessaoMock): boolean {
  if (typeof chave !== "string" || !/^[a-z_]+(\.[a-z_]+)+$/.test(chave)) return false;
  const perfil = (store.perfis ?? []).find((item) => item.id === MOCK_USER_ID);
  if (!perfil || perfil.suspenso === true) return false;
  const papel = String(sessao.papel ?? perfil.papel ?? "");
  if (papel === "admin") return true;
  if (!["tecnico", "coordenador", "gestor"].includes(papel)) return false;
  // Com papel simulado, vale só a categoria (perfil individual é do admin).
  const individuais = sessao.papel ? {} : ((perfil.permissoes ?? {}) as Row);
  const valor =
    chave in individuais
      ? individuais[chave]
      : ((store.permissoes_categorias ?? []).find((item) => item.papel === papel)?.permissoes as Row | undefined)?.[chave];
  return valor === true;
}

/** Mesma regra de public.minhas_permissoes (0124). */
function mockMinhasPermissoes(sessao: SessaoMock) {
  const perfil = (store.perfis ?? []).find((item) => item.id === MOCK_USER_ID);
  const papel = String(sessao.papel ?? perfil?.papel ?? "");
  if (!perfil || perfil.suspenso === true) return { admin: false, permissoes: {} };
  if (papel === "admin") return { admin: true, permissoes: {} };
  const categoria = ((store.permissoes_categorias ?? []).find((item) => item.papel === papel)?.permissoes ?? {}) as Row;
  const individuais = sessao.papel ? {} : ((perfil.permissoes ?? {}) as Row);
  return { admin: false, permissoes: { ...categoria, ...individuais } };
}

function podeVerSalarioMock(sessao: SessaoMock) {
  return mockTemPermissao("tecnicos.salario.ver", sessao);
}

/** Mesma forma de public.v_minhas_notificacoes (0128): estado de leitura por usuário. */
function mockMinhasNotificacoes(): Row[] {
  const leituras = (store.notificacoes_leituras ?? []).filter((row) => row.user_id === MOCK_USER_ID);
  return (store.notificacoes ?? []).map((n) => {
    const leitura = [...leituras].reverse().find((row) => row.notificacao_id === n.id);
    const status = leitura?.arquivada_em
      ? "arquivada"
      : leitura?.lida_em
        ? "lida"
        : !leitura && n.status && n.status !== "nao_lida"
          ? n.status
          : "nao_lida";
    return {
      ...n,
      permissao_destino: n.permissao_destino ?? null,
      usuario_destino: n.usuario_destino ?? null,
      status,
      lida_em: leitura?.lida_em ?? null,
      arquivada_em: leitura?.arquivada_em ?? null,
    };
  });
}

/** Mesma regra de public.aguardando_voce (0128), com os dados do mock. */
function mockAguardandoVoce(sessao: SessaoMock) {
  const saida: Row[] = [];
  const linha = (chave: string, rows: Row[], rotulo: (row: Row) => string) =>
    saida.push({
      chave,
      quantidade: rows.length,
      itens: rows.slice(0, 3).map((row) => ({ id: row.id, rotulo: rotulo(row) })),
    });
  if (mockTemPermissao("pedido.aprovar", sessao)) {
    linha(
      "pedidos_validacao",
      (store.pedidos_internos ?? []).filter((row) => row.status === "em_validacao"),
      (row) => `#${row.id} · ${row.titulo ?? "sem título"}`,
    );
  }
  if (mockTemPermissao("compras.aprovar", sessao)) {
    linha(
      "compras_aprovar",
      (store.pedidos_compra ?? []).filter((row) => row.status === "solicitado"),
      (row) => `Compra #${row.id}`,
    );
  }
  if (mockTemPermissao("compras.receber", sessao)) {
    linha(
      "compras_receber",
      (store.pedidos_compra ?? []).filter((row) => ["aprovado", "enviado", "em_transito"].includes(String(row.status))),
      (row) => `Compra #${row.id}`,
    );
  }
  if (mockTemPermissao("estoque.lote.aceitar", sessao)) {
    linha(
      "lotes_quarentena",
      (store.lotes_estoque ?? []).filter((row) => row.status === "quarentena"),
      (row) => `Lote ${row.codigo_lote ?? `#${row.id}`}`,
    );
  }
  if (mockTemPermissao("planejamento.editar", sessao)) {
    linha(
      "planos_rascunho",
      (store.planejamento ?? []).filter((row) => (row.status_operacional ?? "rascunho") === "rascunho"),
      (row) => String(row.nome ?? `Plano #${row.id}`),
    );
  }
  return saida;
}

/** Linhas de leitura de uma tabela; as visões derivadas são calculadas na hora. */
function linhasDaTabela(table: string): Row[] {
  if (table === "v_minhas_notificacoes") return mockMinhasNotificacoes();
  return store[table] ?? [];
}

/** Emula os triggers de proteção de salário/preço PE da 0112. */
function violacaoSalario(
  table: string,
  op: "insert" | "update",
  payload: Row | undefined,
  sessao: SessaoMock,
  afetadas: Row[] = [],
): MockErro | null {
  if (!payload || !COLUNAS_SIGILOSAS[table] || podeVerSalarioMock(sessao)) return null;
  if (table === "tecnicos" && "valor_mes" in payload) {
    const alterou =
      op === "insert"
        ? Number(payload.valor_mes) !== 0
        : afetadas.some((row) => Number(row.valor_mes) !== Number(payload.valor_mes));
    if (alterou) {
      return { message: "Sem permissão para alterar o salário do técnico (Ver salário dos técnicos).", code: "42501" };
    }
  }
  if (table === "orcamento_projeto_catalogo") {
    const alterou =
      op === "insert"
        ? payload.rubrica === "PE" && Number(payload.preco_unitario ?? 0) !== 0
        : afetadas.some(
            (row) =>
              (row.rubrica === "PE" || payload.rubrica === "PE") &&
              (("rubrica" in payload && payload.rubrica !== row.rubrica) ||
                ("preco_unitario" in payload && Number(payload.preco_unitario) !== Number(row.preco_unitario))),
          );
    if (alterou) {
      return { message: "Sem permissão para alterar valores de pessoal (PE) do catálogo.", code: "42501" };
    }
  }
  return null;
}

function valorHoraPessoalTotalMock() {
  return (store.tecnicos ?? []).reduce((acc, tecnico) => {
    const horas = Number(tecnico.horas_mes_base);
    if (!(horas > 0)) return acc;
    return acc + ((Number(tecnico.valor_mes) / horas) * Number(tecnico.percentual_dedicado)) / 100;
  }, 0);
}

class MockQuery {
  private filters: { column: string; value: unknown }[] = [];
  private neqFilters: { column: string; value: unknown }[] = [];
  private inFilters: { column: string; values: unknown[] }[] = [];
  private notFilters: { column: string; values: string[] }[] = [];
  private isFilters: { column: string; value: null }[] = [];
  private comparisonFilters: { column: string; operator: "gt" | "gte" | "lt" | "lte"; value: unknown }[] = [];
  private mutation: null | { type: "insert" | "update" | "delete" | "upsert"; payload?: Row | Row[] } = null;
  private columns: string[] | null = null;
  private erro: MockErro | null = null;

  constructor(
    private table: string,
    private sessao: SessaoMock = {},
  ) {}

  select(columns?: string) {
    // `select()` sem argumento equivale a "*" no supabase-js.
    this.columns = (columns ?? "*").split(",").map((coluna) => coluna.trim()).filter(Boolean);
    const sigilosas = COLUNAS_SIGILOSAS[this.table];
    if (sigilosas && this.columns.some((coluna) => coluna === "*" || sigilosas.includes(coluna))) {
      // Emula o privilégio de coluna da migration 0112 (vale até para admin).
      this.erro = {
        message: `permission denied for table ${this.table}`,
        code: "42501",
      };
    }
    return this;
  }

  order() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.neqFilters.push({ column, value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.inFilters.push({ column, values });
    return this;
  }

  is(column: string, value: null) {
    // Suporta apenas `.is(coluna, null)`, o unico uso no app.
    this.isFilters.push({ column, value });
    return this;
  }

  limit() {
    return this;
  }

  range() {
    return this;
  }

  gt(column: string, value: unknown) {
    this.comparisonFilters.push({ column, operator: "gt", value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.comparisonFilters.push({ column, operator: "gte", value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.comparisonFilters.push({ column, operator: "lt", value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.comparisonFilters.push({ column, operator: "lte", value });
    return this;
  }

  not(column: string, operator: string, rawValue: string) {
    if (operator === "in") {
      this.notFilters.push({
        column,
        values: rawValue.replace(/[()]/g, "").split(",").map((value) => value.trim()),
      });
    }
    return this;
  }

  insert(payload: Row | Row[]) {
    const rows = Array.isArray(payload) ? payload : [payload];
    for (const row of rows) {
      const erroSalario = violacaoSalario(this.table, "insert", row, this.sessao);
      if (erroSalario) {
        this.erro = erroSalario;
        return this;
      }
    }
    const inserted = rows.map((row) => ({
      id: row.id ?? nextId(this.table),
      criado_em: row.criado_em ?? new Date().toISOString(),
      status: row.status ?? "rascunho",
      // Espelha os defaults da tabela planejamento (0029/0111).
      ...(this.table === "planejamento"
        ? { status_operacional: "rascunho", reserva_desatualizada: false }
        : {}),
      ...row,
    }));
    if (this.table === "planejamento_itens") {
      this.erro = guardarItensPlanejamento(inserted);
      if (this.erro) {
        this.mutation = { type: "insert", payload: [] };
        return this;
      }
    }
    store[this.table] = [...(store[this.table] ?? []), ...inserted];
    if (this.table === "reservas_estoque") limparReservaDesatualizada(inserted);
    this.mutation = { type: "insert", payload: inserted };
    return this;
  }

  update(payload: Row) {
    this.mutation = { type: "update", payload };
    return this;
  }

  upsert(payload: Row | Row[]) {
    this.mutation = { type: "upsert", payload };
    return this;
  }

  delete() {
    this.mutation = { type: "delete" };
    return this;
  }

  single() {
    return this.then((result) => ({
      ...result,
      data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
    }));
  }

  maybeSingle() {
    return this.single();
  }

  then<TResult1 = MockResultado, TResult2 = never>(
    onfulfilled?: ((value: MockResultado) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): MockResultado {
    if (this.erro) return { data: null, error: this.erro };
    if (
      this.table === "planejamento_itens" &&
      (this.mutation?.type === "update" || this.mutation?.type === "delete")
    ) {
      const afetados = (store[this.table] ?? []).filter((row) => this.matches(row));
      const destino = this.mutation.type === "update" ? (this.mutation.payload as Row) : {};
      const erro = guardarItensPlanejamento([
        ...afetados,
        ...afetados.map((row) => ({ ...row, ...destino })),
      ]);
      if (erro) return { data: null, error: erro };
    }
    if (this.mutation?.type === "update") {
      const erroSalario = violacaoSalario(
        this.table,
        "update",
        this.mutation.payload as Row,
        this.sessao,
        (store[this.table] ?? []).filter((row) => this.matches(row)),
      );
      if (erroSalario) return { data: null, error: erroSalario };
      store[this.table] = (store[this.table] ?? []).map((row) =>
        this.matches(row) ? { ...row, ...(this.mutation?.payload as Row) } : row,
      );
    }
    let removidos: Row[] = [];
    if (this.mutation?.type === "delete") {
      removidos = (store[this.table] ?? []).filter((row) => this.matches(row));
      store[this.table] = (store[this.table] ?? []).filter((row) => !this.matches(row));
    }
    if (this.mutation?.type === "upsert") {
      const rows = Array.isArray(this.mutation.payload) ? this.mutation.payload : [this.mutation.payload];
      for (const row of rows.filter(Boolean) as Row[]) {
        const key = "chave" in row ? "chave" : "papel" in row ? "papel" : "id";
        const index = (store[this.table] ?? []).findIndex((current) => current[key] === row[key]);
        if (index >= 0) store[this.table][index] = { ...store[this.table][index], ...row };
        else store[this.table] = [...(store[this.table] ?? []), { id: row.id ?? nextId(this.table), ...row }];
      }
    }

    // como o PostgREST com .select(): delete devolve as linhas removidas
    const source =
      this.mutation?.type === "insert"
        ? (this.mutation.payload as Row[])
        : this.mutation?.type === "delete"
          ? removidos
          : linhasDaTabela(this.table).filter((row) => this.matches(row));
    const linhas = source.map((row) => withRelations(this.table, row));
    // Tabelas com coluna sigilosa: devolve só as colunas pedidas, como o
    // PostgREST faria (as demais tabelas mantêm o comportamento anterior).
    if (COLUNAS_SIGILOSAS[this.table] && this.columns) {
      const colunas = this.columns;
      return {
        data: linhas.map((row) => Object.fromEntries(colunas.map((coluna) => [coluna, row[coluna]]))),
        error: null,
      };
    }
    return { data: linhas, error: null };
  }

  private matches(row: Row) {
    return (
      this.filters.every((filter) => valoresIguais(row[filter.column], filter.value)) &&
      this.neqFilters.every((filter) => !valoresIguais(row[filter.column], filter.value)) &&
      this.inFilters.every((filter) => filter.values.some((value) => valoresIguais(row[filter.column], value))) &&
      this.notFilters.every((filter) => !filter.values.includes(String(row[filter.column]))) &&
      this.isFilters.every((filter) => (row[filter.column] ?? null) === filter.value) &&
      this.comparisonFilters.every((filter) => {
        const comparison = compararValores(row[filter.column], filter.value);
        if (filter.operator === "gt") return comparison > 0;
        if (filter.operator === "gte") return comparison >= 0;
        if (filter.operator === "lt") return comparison < 0;
        return comparison <= 0;
      })
    );
  }
}

function receiveLot(args: Row) {
  const saldo = store.v_estoque_saldo.find((item) => item.insumo_id === args.p_insumo_id);
  const lote = {
    id: nextId("lotes_estoque"),
    insumo_id: args.p_insumo_id,
    codigo_lote: args.p_codigo ?? `L-${Date.now()}`,
    validade: args.p_validade ?? null,
    quantidade_atual: Number(args.p_quantidade),
    status: "quarentena",
  };
  store.lotes_estoque.push(lote);
  if (saldo) {
    saldo.em_maos = Number(saldo.em_maos ?? 0) + lote.quantidade_atual;
    saldo.em_quarentena = Number(saldo.em_quarentena ?? 0) + lote.quantidade_atual;
  }
}

function setLotStatus(loteId: number, status: string) {
  const lote = store.lotes_estoque.find((row) => row.id === loteId);
  if (lote) lote.status = status;
}

function hojeMock() {
  return new Date().toISOString().slice(0, 10);
}

function reservadoNoLote(loteId: number) {
  return (store.reservas_estoque ?? [])
    .filter((r) => Number(r.lote_id) === loteId && ["reservado", "parcial"].includes(String(r.status)))
    .reduce((acc, r) => acc + Number(r.quantidade ?? 0) - Number(r.quantidade_consumida ?? 0), 0);
}

function registrarSaidaManual(lote: Row, quantidade: number, motivo: string, referencia: string) {
  store.estoque_movimentacoes = [
    ...(store.estoque_movimentacoes ?? []),
    {
      id: nextId("estoque_movimentacoes"),
      insumo_id: lote.insumo_id,
      lote_id: lote.id,
      tipo: "saida",
      quantidade,
      custo_unitario: lote.custo_unitario ?? null,
      motivo: `baixa manual: ${motivo.trim()}`,
      referencia,
      data: hojeMock(),
    },
  ];
  const saldo = store.v_estoque_saldo.find((item) => item.insumo_id === lote.insumo_id);
  if (saldo) {
    saldo.em_maos = Math.max(0, Number(saldo.em_maos ?? 0) - quantidade);
    saldo.disponivel = Math.max(0, Number(saldo.disponivel ?? 0) - quantidade);
  }
}

/** Espelha baixa_manual_lote (0028 + guardas de 0110). */
function baixarManualLote(args: Row) {
  const lote = store.lotes_estoque.find((row) => Number(row.id) === Number(args.p_lote_id));
  if (!lote) throw new Error("Lote não encontrado.");
  const quantidade = Number(args.p_quantidade);
  const atual = Number(lote.quantidade_atual ?? 0);
  if (!(quantidade > 0)) throw new Error("Quantidade deve ser maior que zero.");
  if (!String(args.p_motivo ?? "").trim()) throw new Error("Informe o motivo da baixa manual.");
  if (lote.modelo_quantidade === "EMBALAGEM_FECHADA") {
    throw new Error("Lote de embalagens fechadas: use a baixa por embalagens (baixa_manual_embalagens).");
  }
  if (!["aceito", "em_uso"].includes(String(lote.status))) throw new Error("Só é possível baixar lote aceito ou em uso.");
  const vencimento = /^vencimento/i.test(String(args.p_motivo ?? "").trim());
  if (lote.validade && String(lote.validade) < hojeMock() && !vencimento) {
    throw new Error("Lote vencido: registre a baixa com o motivo Vencimento.");
  }
  if (quantidade > atual) throw new Error("Quantidade maior que o saldo atual do lote.");
  if (reservadoNoLote(Number(lote.id)) > atual - quantidade) {
    throw new Error("Há reserva ativa neste lote: é possível baixar no máximo o saldo não reservado.");
  }
  lote.quantidade_atual = atual - quantidade;
  lote.status = Number(lote.quantidade_atual) <= 0 ? "consumido" : "em_uso";
  registrarSaidaManual(lote, quantidade, String(args.p_motivo), `lote ${lote.id}`);
}

/** Espelha baixa_manual_embalagens (0110), incluindo a idempotência por operacao_id. */
function baixarManualEmbalagens(args: Row) {
  const operacaoId = String(args.p_operacao_id ?? "");
  const quantidade = Number(args.p_quantidade);
  const esperada = Number(args.p_quantidade_esperada);
  const motivo = String(args.p_motivo ?? "").trim();
  if (!operacaoId || !Number.isInteger(quantidade) || quantidade <= 0 || !Number.isInteger(esperada) || esperada <= 0) {
    throw new Error("Informe o lote e uma quantidade inteira de embalagens maior que zero.");
  }
  if (!motivo) throw new Error("Informe o motivo da baixa.");
  const requisicao = { lote_id: Number(args.p_lote_id), quantidade, quantidade_esperada: esperada, motivo };
  const anterior = (store.eventos_status ?? []).find(
    (evento) => evento.entidade === "lote_embalagem_fechada" && evento.operacao_id === operacaoId,
  );
  if (anterior) {
    const payload = anterior.operacao_payload as { requisicao: unknown; resultado: Row };
    if (JSON.stringify(payload.requisicao) !== JSON.stringify(requisicao)) {
      throw new Error("Esta operação já foi registrada com dados diferentes.");
    }
    return { ...payload.resultado, repetido: true };
  }

  const lote = store.lotes_estoque.find((row) => Number(row.id) === Number(args.p_lote_id));
  if (!lote) throw new Error("Lote não encontrado.");
  if (lote.modelo_quantidade !== "EMBALAGEM_FECHADA") {
    throw new Error("Este lote é controlado por volume (modelo legado); use a baixa manual do lote.");
  }
  if (lote.status !== "aceito") throw new Error("Só é possível dar baixa em lote aceito.");
  if (lote.validade && String(lote.validade) < hojeMock() && !/^vencimento/i.test(String(args.p_motivo ?? "").trim())) {
    throw new Error("Lote vencido: registre a baixa com o motivo Vencimento.");
  }
  const atual = Number(lote.quantidade_atual ?? 0);
  if (atual !== esperada) throw new Error("A quantidade do lote mudou; recarregue e tente novamente.");
  if (quantidade > atual) throw new Error(`Quantidade maior que o saldo do lote (${atual} embalagens).`);
  const reservado = reservadoNoLote(Number(lote.id));
  if (reservado > atual - quantidade) {
    throw new Error(`Há reserva ativa neste lote: é possível baixar no máximo ${Math.max(0, Math.floor(atual - reservado))} embalagem(ns).`);
  }

  const restante = atual - quantidade;
  lote.quantidade_atual = restante;
  lote.status = restante === 0 ? "consumido" : "aceito";
  registrarSaidaManual(lote, quantidade, motivo, operacaoId);
  const resultado = {
    lote_id: lote.id,
    insumo_id: lote.insumo_id,
    quantidade_baixada: quantidade,
    quantidade_embalagens: restante,
    repetido: false,
  };
  store.eventos_status = [
    ...(store.eventos_status ?? []),
    {
      id: nextId("eventos_status"),
      entidade: "lote_embalagem_fechada",
      entidade_id: lote.id,
      de_status: String(atual),
      para_status: String(restante),
      observacao: `baixa manual: ${motivo}`,
      operacao_id: operacaoId,
      operacao_payload: { requisicao, resultado },
    },
  ];
  return resultado;
}

function ajustarSaldoLote(args: Row) {
  const lote = store.lotes_estoque.find((row) => row.id === args.p_lote_id);
  if (!lote) return;
  lote.quantidade_atual = Number(args.p_quantidade_nova);
  if (Number(lote.quantidade_atual) <= 0) lote.status = "consumido";
}

/**
 * Espelha `sincronizar_demanda_grupos` (migration 0104): substitui o
 * conjunto de grupos da demanda de uma vez, com rollback em caso de falha.
 */
function sincronizarDemandaGrupos(args: Row) {
  const demandaId = Number(args.p_demanda_id);
  const grupos = Array.isArray(args.p_grupos) ? (args.p_grupos as Row[]) : [];
  const backup = {
    demanda_grupos_amostras: [...(store.demanda_grupos_amostras ?? [])],
    demanda_analises: [...(store.demanda_analises ?? [])],
  };

  try {
    const demanda = store.demandas_propostas?.find((row) => Number(row.id) === demandaId);
    if (!demanda) throw new Error(`Demanda ${demandaId} nao encontrada`);

    store.demanda_grupos_amostras = store.demanda_grupos_amostras ?? [];

    // p_grupos null preserva (migration 0106); só [] remove todos.
    if (args.p_grupos == null) {
      const existentes = store.demanda_grupos_amostras.filter(
        (row) => Number(row.demanda_id) === demandaId,
      );
      return {
        demanda_id: demandaId,
        grupos: existentes.length,
        chaves: Object.fromEntries(existentes.map((r) => [String(r.identificacao), Number(r.id)])),
        preservado: true,
      };
    }

    const preservados: number[] = [];
    const chaves: Record<string, number> = {};

    grupos.forEach((grupo, indice) => {
      const identificacao = String(grupo.identificacao ?? "").trim();
      if (!identificacao) throw new Error(`Grupo na posicao ${indice + 1} sem identificacao`);
      const quantidade = Number(grupo.quantidade_amostras);
      if (!(quantidade > 0)) throw new Error(`Grupo "${identificacao}" com quantidade invalida`);

      const payload = {
        demanda_id: demandaId,
        identificacao,
        tipo_matriz: grupo.tipo_matriz ?? null,
        quantidade_amostras: quantidade,
        unidade: grupo.unidade ?? "amostras",
        observacao: grupo.observacao ?? null,
        ordem: indice + 1,
      };

      const idExistente = grupo.id == null ? null : Number(grupo.id);
      let id: number;
      if (idExistente != null) {
        const atual = store.demanda_grupos_amostras.find(
          (row) => Number(row.id) === idExistente && Number(row.demanda_id) === demandaId,
        );
        if (!atual) throw new Error(`Grupo ${idExistente} nao pertence a demanda ${demandaId}`);
        Object.assign(atual, payload);
        id = idExistente;
      } else {
        id = nextId("demanda_grupos_amostras");
        store.demanda_grupos_amostras.push({ id, ...payload });
      }
      preservados.push(id);
      if (grupo.chave) chaves[String(grupo.chave)] = id;
    });

    const removidos = store.demanda_grupos_amostras
      .filter((row) => Number(row.demanda_id) === demandaId && !preservados.includes(Number(row.id)))
      .map((row) => Number(row.id));

    store.demanda_grupos_amostras = store.demanda_grupos_amostras.filter(
      (row) => Number(row.demanda_id) !== demandaId || preservados.includes(Number(row.id)),
    );

    // espelha o "on delete set null" de demanda_analises.grupo_amostra_id
    for (const linha of store.demanda_analises ?? []) {
      if (removidos.includes(Number(linha.grupo_amostra_id))) linha.grupo_amostra_id = null;
    }

    return { demanda_id: demandaId, grupos: preservados.length, chaves };
  } catch (error) {
    store.demanda_grupos_amostras = backup.demanda_grupos_amostras;
    store.demanda_analises = backup.demanda_analises;
    throw error;
  }
}

/**
 * Espelha `salvar_demanda_com_grupos` (migration 0105): demanda, grupos e
 * associações análise↔grupo numa operação só, com rollback total em falha.
 */
function salvarDemandaComGrupos(args: Row) {
  const backup = {
    demandas_propostas: (store.demandas_propostas ?? []).map((r) => ({ ...r })),
    demanda_grupos_amostras: (store.demanda_grupos_amostras ?? []).map((r) => ({ ...r })),
    demanda_analises: (store.demanda_analises ?? []).map((r) => ({ ...r })),
  };

  try {
    const payload = (args.p_demanda ?? {}) as Row;
    const idEntrada = args.p_demanda_id == null ? null : Number(args.p_demanda_id);
    let demandaId: number;
    let criada = false;

    store.demandas_propostas = store.demandas_propostas ?? [];
    if (idEntrada == null) {
      demandaId = nextId("demandas_propostas");
      store.demandas_propostas.push({
        id: demandaId,
        status: "nova",
        modalidade: "analises",
        prioridade: "normal",
        data_solicitacao: new Date().toISOString().slice(0, 10),
        ...payload,
      });
      criada = true;
    } else {
      const atual = store.demandas_propostas.find((r) => Number(r.id) === idEntrada);
      if (!atual) throw new Error(`Demanda ${idEntrada} nao encontrada ou sem permissao de escrita.`);
      for (const [chave, valor] of Object.entries(payload)) {
        if (valor !== undefined) atual[chave] = valor;
      }
      demandaId = idEntrada;
    }

    const resGrupos = sincronizarDemandaGrupos({
      p_demanda_id: demandaId,
      p_grupos: args.p_grupos ?? [],
    });
    const chaves = (resGrupos.chaves ?? {}) as Record<string, number>;

    let analisesGravadas = 0;
    if (args.p_analises != null) {
      const analises = Array.isArray(args.p_analises) ? (args.p_analises as Row[]) : [];
      store.demanda_analises = (store.demanda_analises ?? []).filter(
        (r) => Number(r.demanda_id) !== demandaId,
      );
      for (const item of analises) {
        const codigo = String(item.codigo_analise ?? "").trim();
        if (!codigo) throw new Error("Item de analise sem codigo.");
        let grupoId: number | null = null;
        const chave = item.grupo_chave ? String(item.grupo_chave) : "";
        if (chave) {
          if (chaves[chave] == null) {
            throw new Error(
              `Analise ${codigo} referencia o grupo "${chave}", que nao existe nesta demanda.`,
            );
          }
          grupoId = chaves[chave];
        }
        store.demanda_analises.push({
          id: nextId("demanda_analises"),
          demanda_id: demandaId,
          codigo_analise: codigo,
          quantidade_amostras: Math.max(Number(item.quantidade_amostras) || 1, 1),
          origem_quantidade: item.origem_quantidade ?? "manual",
          status_custeio: item.status_custeio ?? "pendente",
          grupo_amostra_id: grupoId,
        });
        analisesGravadas += 1;
      }
    }

    return {
      demanda_id: demandaId,
      criada,
      grupos: resGrupos.grupos,
      chaves,
      analises: analisesGravadas,
    };
  } catch (error) {
    store.demandas_propostas = backup.demandas_propostas;
    store.demanda_grupos_amostras = backup.demanda_grupos_amostras;
    store.demanda_analises = backup.demanda_analises;
    throw error;
  }
}

/** Espelha `excluir_planejamento_rascunho` (migration 0104). */
function excluirPlanejamentoRascunho(args: Row) {
  const planId = Number(args.p_planejamento_id);
  const plano = store.planejamento?.find((row) => Number(row.id) === planId);
  if (!plano) throw new Error(`Planejamento ${planId} nao encontrado.`);
  if (plano.status_operacional !== "rascunho") {
    throw new Error(
      `Somente planejamento em rascunho pode ser excluido. Status atual: ${plano.status_operacional}.`,
    );
  }

  const vinculos = [
    ["reservas", store.reservas_estoque],
    ["equipamentos", store.equipamento_reservas],
    ["pedidos internos", store.pedidos_internos],
  ] as const;
  for (const [rotulo, tabela] of vinculos) {
    const total = (tabela ?? []).filter((row) => Number(row.planejamento_id) === planId).length;
    if (total > 0) {
      throw new Error(
        `Planejamento ${planId} possui vinculos (${rotulo}: ${total}) e nao pode ser excluido fisicamente.`,
      );
    }
  }

  const itens = (store.planejamento_itens ?? []).filter(
    (row) => Number(row.planejamento_id) === planId,
  ).length;
  store.planejamento_itens = (store.planejamento_itens ?? []).filter(
    (row) => Number(row.planejamento_id) !== planId,
  );
  store.planejamento = (store.planejamento ?? []).filter((row) => Number(row.id) !== planId);

  return { planejamento_id: planId, nome: plano.nome ?? null, itens_removidos: itens };
}

const STATUS_ITENS_EDITAVEIS = ["rascunho", "reservado"];

/**
 * Espelha o gatilho `trg_guardar_itens_planejamento_editavel` (0111): itens
 * só mudam com o plano em rascunho/reservado; mudança em plano reservado
 * marca `reserva_desatualizada`. Devolve o erro ou `null`.
 */
function guardarItensPlanejamento(itens: Row[]) {
  const planos = new Set(itens.map((item) => Number(item.planejamento_id)));
  const alvos: Row[] = [];
  for (const planId of planos) {
    const plano = store.planejamento?.find((row) => Number(row.id) === planId);
    if (!plano) return { message: `Planejamento ${planId} não encontrado.`, code: "P0002" };
    const status = String(plano.status_operacional ?? "rascunho");
    if (!STATUS_ITENS_EDITAVEIS.includes(status)) {
      return {
        message: `Itens só podem ser alterados com o plano em rascunho ou reservado (status atual: ${status}).`,
        code: "22023",
      };
    }
    alvos.push(plano);
  }
  for (const plano of alvos) {
    if (plano.status_operacional === "reservado") plano.reserva_desatualizada = true;
  }
  return null;
}

/** Espelha `trg_limpar_reserva_desatualizada` (0111). */
function limparReservaDesatualizada(reservas: Row[]) {
  for (const reserva of reservas) {
    if (!["reservado", "parcial"].includes(String(reserva.status))) continue;
    const plano = store.planejamento?.find((row) => valoresIguais(row.id, reserva.planejamento_id));
    if (plano) plano.reserva_desatualizada = false;
  }
}

function papelMockAtual() {
  const perfil = (store.perfis ?? []).find((row) => row.id === "user-e2e");
  return String(perfil?.papel ?? "tecnico");
}

function exigirCoordenadorMock() {
  if (!["coordenador", "gestor", "admin"].includes(papelMockAtual())) {
    throw Object.assign(new Error(`Sem permissão: requer papel coordenador ou superior (atual: ${papelMockAtual()}).`), { code: "42501" });
  }
}

function motivoMock(args: Row, acao: string) {
  const motivo = String(args.p_motivo ?? "").trim();
  if (motivo.length < 3) {
    throw Object.assign(new Error(`Informe o motivo ${acao}.`), { code: "22023" });
  }
  return motivo;
}

function registrarEventoPlanoMock(planId: number, de: unknown, para: string, observacao: string) {
  store.eventos_status = [
    ...(store.eventos_status ?? []),
    {
      id: nextId("eventos_status"),
      entidade: "planejamento",
      entidade_id: planId,
      de_status: de ?? null,
      para_status: para,
      usuario: "admin@example.com",
      observacao,
      criado_em: new Date().toISOString(),
    },
  ];
}

/** Espelha `excluir_planejamento` (migration 0111): "Excluir se não houve baixa". */
function excluirPlanejamento(args: Row) {
  exigirCoordenadorMock();
  const motivo = motivoMock(args, "da exclusão");
  const planId = Number(args.p_planejamento_id);
  const plano = store.planejamento?.find((row) => Number(row.id) === planId);
  if (!plano) throw Object.assign(new Error(`Planejamento ${planId} não encontrado.`), { code: "P0002" });

  const status = String(plano.status_operacional ?? "rascunho");
  const doPlano = (tabela: string) =>
    (store[tabela] ?? []).filter((row) => Number(row.planejamento_id) === planId);
  const movimentos = [...(store.estoque_movimentacoes ?? []), ...(store.movimentacoes_estoque ?? [])];
  const houveBaixa =
    status === "em_execucao" ||
    status === "concluido" ||
    doPlano("reservas_estoque").some(
      (row) => row.status === "consumido" || Number(row.quantidade_consumida ?? 0) > 0,
    ) ||
    movimentos.some(
      (row) =>
        row.tipo === "saida" &&
        (row.referencia === `plano ${planId}` || String(row.referencia ?? "").startsWith(`plano ${planId};`)),
    );
  if (houveBaixa) {
    throw Object.assign(new Error("Já houve baixa de material neste plano. Só é possível cancelar."), { code: "22023" });
  }

  const pedidos = doPlano("pedidos_internos").filter((row) => row.status !== "cancelado");
  if (pedidos.length > 0) {
    throw Object.assign(
      new Error(
        `Cancele antes os pedidos internos vinculados ao plano: ${pedidos.map((row) => `#${row.id} (${row.status})`).join(", ")}.`,
      ),
      { code: "23503" },
    );
  }

  let reservasLiberadas = 0;
  for (const reserva of doPlano("reservas_estoque")) {
    if (["reservado", "parcial"].includes(String(reserva.status))) reservasLiberadas += 1;
  }
  const itens = doPlano("planejamento_itens").length;
  registrarEventoPlanoMock(planId, status, "excluido", `Plano "${plano.nome ?? "-"}" excluído. Motivo: ${motivo}`);

  for (const tabela of ["planejamento_itens", "reservas_estoque", "equipamento_reservas", "planejamento_lote_conferencias"]) {
    if (store[tabela]) store[tabela] = store[tabela].filter((row) => Number(row.planejamento_id) !== planId);
  }
  for (const pedido of store.pedidos_internos ?? []) {
    if (Number(pedido.planejamento_id) === planId) pedido.planejamento_id = null;
  }
  store.planejamento = (store.planejamento ?? []).filter((row) => Number(row.id) !== planId);

  return {
    planejamento_id: planId,
    nome: plano.nome ?? null,
    itens_removidos: itens,
    reservas_liberadas: reservasLiberadas,
    equipamentos_liberados: 0,
  };
}

/** Espelha `cancelar_planejamento` (migration 0111). */
function cancelarPlanejamento(args: Row) {
  exigirCoordenadorMock();
  const motivo = motivoMock(args, "do cancelamento");
  const planId = Number(args.p_planejamento_id);
  const plano = store.planejamento?.find((row) => Number(row.id) === planId);
  if (!plano) throw Object.assign(new Error(`Planejamento ${planId} não encontrado.`), { code: "P0002" });
  const status = String(plano.status_operacional ?? "rascunho");
  if (status === "concluido") {
    throw Object.assign(new Error("Planejamento concluído não pode ser cancelado."), { code: "22023" });
  }
  if (status === "cancelado") {
    throw Object.assign(new Error("Planejamento já está cancelado."), { code: "22023" });
  }
  for (const reserva of store.reservas_estoque ?? []) {
    if (Number(reserva.planejamento_id) === planId && ["reservado", "parcial"].includes(String(reserva.status))) {
      reserva.status = "cancelado";
    }
  }
  plano.status_operacional = "cancelado";
  registrarEventoPlanoMock(planId, status, "cancelado", `Plano cancelado. Motivo: ${motivo}`);
  return { planejamento_id: planId, status_anterior: status, status: "cancelado" };
}

function sincronizarDemandaAnalises(args: Row) {
  const demandaId = Number(args.p_demanda_id);
  const itens = Array.isArray(args.p_itens) ? args.p_itens as Row[] : [];
  const exigeLaboratorio = args.p_exige_laboratorio !== false;
  const backup = {
    demanda_analises: [...(store.demanda_analises ?? [])],
    orcamento_itens: [...(store.orcamento_itens ?? [])],
    orcamentos: [...(store.orcamentos ?? [])],
  };

  try {
    const demanda = store.demandas_propostas?.find((row) => Number(row.id) === demandaId);
    if (!demanda) throw new Error(`Demanda ${demandaId} nao encontrada`);
    if (itens.some((item) => item.codigo_analise === "FORCAR-FALHA-RPC")) {
      throw new Error("Falha simulada na RPC de sincronização");
    }

    let orcamento = store.orcamentos.find((row) => Number(row.demanda_id) === demandaId && row.status !== "cancelado");
    if (exigeLaboratorio) {
      if (orcamento && orcamento.status !== "rascunho") {
        throw new Error("Somente orcamento laboratorial em rascunho pode ser sincronizado pela demanda");
      }
      if (!orcamento) {
        orcamento = {
          id: nextId("orcamentos"),
          demanda_id: demandaId,
          tipo: "analises",
          cliente_nome: demanda.cliente_nome ?? demanda.titulo ?? "Cliente",
          status: "rascunho",
          criado_em: new Date().toISOString(),
        };
        store.orcamentos.push(orcamento);
      }
    }

    store.demanda_analises = (store.demanda_analises ?? []).filter((row) => Number(row.demanda_id) !== demandaId);
    for (const item of itens) {
      store.demanda_analises.push({
        id: nextId("demanda_analises"),
        demanda_id: demandaId,
        codigo_analise: item.codigo_analise,
        quantidade_amostras: item.quantidade_amostras,
        origem_quantidade: item.origem_quantidade ?? "padrao",
        status_custeio: item.status_custeio ?? "pendente",
      });
    }

    if (exigeLaboratorio && orcamento) {
      const codigos = itens.map((item) => item.codigo_analise);
      store.orcamento_itens = (store.orcamento_itens ?? []).filter(
        (row) => Number(row.orcamento_id) !== Number(orcamento.id) || codigos.includes(row.codigo_analise),
      );
      for (const item of itens) {
        const existente = store.orcamento_itens.find(
          (row) => Number(row.orcamento_id) === Number(orcamento?.id) && row.codigo_analise === item.codigo_analise,
        );
        const payload = {
          orcamento_id: orcamento.id,
          codigo_analise: item.codigo_analise,
          n_amostras: item.quantidade_amostras,
          custo_unitario: item.custo_unitario ?? 0,
          preco_unitario: item.preco_unitario ?? 0,
          valor_snapshot: item.valor_snapshot ?? {},
        };
        if (existente) Object.assign(existente, payload);
        else store.orcamento_itens.push({ id: nextId("orcamento_itens"), ...payload });
      }
      orcamento.status_operacional = itens.length > 0 ? "preenchido" : "pendente";
      orcamento.status_operacional_atualizado_em = new Date().toISOString();
    }

    return {
      registradas: itens.length,
      pendentes: itens.filter((item) => item.status_custeio !== "disponivel").length,
      orcamento_id: orcamento?.id ?? null,
    };
  } catch (error) {
    store.demanda_analises = backup.demanda_analises;
    store.orcamento_itens = backup.orcamento_itens;
    store.orcamentos = backup.orcamentos;
    throw error;
  }
}

function emitirOrcamentoFinalTransacional(args: Row) {
  const demandaId = Number(args.p_demanda_id);
  const versoesDaDemanda = (store.orcamento_final_versoes ?? []).filter((row) => Number(row.demanda_id) === demandaId);
  const versao = Math.max(0, ...versoesDaDemanda.map((row) => Number(row.versao) || 0)) + 1;
  const id = nextId("orcamento_final_versoes");
  const numero = `OF-2026-${String(demandaId).padStart(4, "0")}-v${versao}`;
  const criadoEm = new Date().toISOString();
  const validadeDias = Number(args.p_validade_dias ?? 30);
  const validoAte = new Date(Date.now() + validadeDias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  store.orcamento_final_versoes = (store.orcamento_final_versoes ?? []).map((row) =>
    Number(row.demanda_id) === demandaId && row.status === "emitido"
      ? { ...row, status: "substituido", substituido_em: criadoEm }
      : row,
  );

  const versaoFinal = {
    id,
    demanda_id: demandaId,
    versao,
    numero,
    status: "emitido",
    total_laboratorio_custo: args.p_total_laboratorio_custo,
    total_laboratorio_preco: args.p_total_laboratorio_preco,
    total_projeto_custo: args.p_total_projeto_custo,
    total_projeto_final: args.p_total_projeto_final,
    total_final: args.p_total_final,
    snapshot: args.p_snapshot,
    parametros: args.p_parametros,
    criado_por: args.p_criado_por,
    criado_em: criadoEm,
    valido_ate: validoAte,
  };
  store.orcamento_final_versoes.push(versaoFinal);

  store.demandas_propostas = (store.demandas_propostas ?? []).map((row) =>
    Number(row.id) === demandaId ? { ...row, status: "orcada", atualizado_em: criadoEm } : row,
  );
  store.eventos_status = [
    ...(store.eventos_status ?? []),
    {
      id: nextId("eventos_status"),
      entidade_tipo: "demanda_proposta",
      entidade_id: demandaId,
      status_novo: "orcada",
      observacao: `Versao final ${numero} emitida via mock e2e.`,
      criado_em: criadoEm,
      usuario_email: args.p_usuario_email ?? null,
    },
  ];

  return { versao_id: id, versao, numero };
}

// Espelha as transições de public.transicionar_orcamento_projeto (migration 0090).
const TRANSICOES_ORCAMENTO_PROJETO: Record<string, string[]> = {
  rascunho: ["enviado", "cancelado"],
  enviado: ["aprovado", "recusado", "cancelado"],
  recusado: ["rascunho", "cancelado"],
  aprovado: ["cancelado"],
};

function transicionarOrcamentoProjeto(args: Row) {
  const id = Number(args.p_orcamento_projeto_id);
  const destino = String(args.p_status_destino);
  const projeto = (store.orcamento_projetos ?? []).find((row) => Number(row.id) === id);
  if (!projeto) throw new Error("Orçamento de projeto não encontrado.");
  const origem = String(projeto.status ?? "rascunho");
  if (origem === destino) return { status_origem: origem, status_destino: destino, alterado: false };
  if (!(TRANSICOES_ORCAMENTO_PROJETO[origem] ?? []).includes(destino)) {
    throw new Error(`Transição de status não permitida: ${origem} -> ${destino}.`);
  }
  projeto.status = destino;
  store.eventos_status = [
    ...(store.eventos_status ?? []),
    {
      id: nextId("eventos_status"),
      entidade: "orcamento_projeto",
      entidade_id: id,
      de_status: origem,
      para_status: destino,
      usuario: "admin@example.com",
      observacao: args.p_observacao ?? null,
      criado_em: new Date().toISOString(),
    },
  ];
  return { status_origem: origem, status_destino: destino, alterado: true };
}

export function createMockSupabaseClient(sessao: SessaoMock = {}) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: MOCK_USER_ID, email: "admin@example.com" } }, error: null }),
    },
    from: (table: string) => new MockQuery(table, sessao),
    rpc: async (fn: string, args: Row = {}) => {
      // Permissão efetiva e leituras sigilosas (migration 0112).
      if (fn === "tem_permissao") return { data: mockTemPermissao(args.p_chave, sessao), error: null };
      if (fn === "minhas_permissoes") return { data: mockMinhasPermissoes(sessao), error: null };
      // "Aguardando você" e leitura por usuário (migration 0128).
      if (fn === "aguardando_voce") return { data: mockAguardandoVoce(sessao), error: null };
      if (fn === "marcar_todas_notificacoes_lidas") {
        const agora = new Date().toISOString();
        const pendentes = mockMinhasNotificacoes().filter((row) => row.status === "nao_lida");
        for (const row of pendentes) {
          store.notificacoes_leituras = [
            ...(store.notificacoes_leituras ?? []),
            { notificacao_id: row.id, user_id: MOCK_USER_ID, lida_em: agora, arquivada_em: null },
          ];
        }
        return { data: pendentes.length, error: null };
      }
      if (fn === "tecnicos_remuneracao") {
        const pode = podeVerSalarioMock(sessao);
        return {
          data: [...(store.tecnicos ?? [])]
            .sort((a, b) => Number(a.id) - Number(b.id))
            .map((tecnico) => ({ id: tecnico.id, valor_mes: pode ? tecnico.valor_mes : null })),
          error: null,
        };
      }
      if (fn === "valor_hora_pessoal_total") return { data: valorHoraPessoalTotalMock(), error: null };
      if (fn === "orcamento_projeto_catalogo_listar") {
        const pode = podeVerSalarioMock(sessao);
        return {
          data: [...(store.orcamento_projeto_catalogo ?? [])]
            .sort((a, b) =>
              String(a.rubrica).localeCompare(String(b.rubrica)) ||
              String(a.descricao).localeCompare(String(b.descricao)) ||
              String(a.id).localeCompare(String(b.id)),
            )
            .map((item) => {
              const mascarado = item.rubrica === "PE" && !pode;
              return { ...item, preco_unitario: mascarado ? null : item.preco_unitario, preco_mascarado: mascarado };
            }),
          error: null,
        };
      }
      // Cada ramo devolve explicitamente. Antes eles apenas mutavam o
      // estado e caíam no retorno permissivo do final — o que tornava
      // indistinguível "simulado com sucesso" de "não simulado".
      if (fn === "receber_lote" || fn === "entrada_inventario") {
        receiveLot(args);
        return { data: null, error: null };
      }
      if (fn === "aceitar_lote") {
        setLotStatus(Number(args.p_lote_id), "aceito");
        return { data: null, error: null };
      }
      if (fn === "bloquear_lote") {
        setLotStatus(Number(args.p_lote_id), "bloqueado");
        return { data: null, error: null };
      }
      if (fn === "desbloquear_lote") {
        setLotStatus(Number(args.p_lote_id), "aceito");
        return { data: null, error: null };
      }
      if (fn === "descartar_lote") {
        setLotStatus(Number(args.p_lote_id), "descartado");
        return { data: null, error: null };
      }
      if (fn === "baixa_manual_lote") {
        try {
          baixarManualLote(args);
          return { data: null, error: null };
        } catch (error) {
          return { data: null, error: { message: error instanceof Error ? error.message : "Erro na RPC" } };
        }
      }
      if (fn === "baixa_manual_embalagens") {
        try {
          return { data: baixarManualEmbalagens(args), error: null };
        } catch (error) {
          return { data: null, error: { message: error instanceof Error ? error.message : "Erro na RPC" } };
        }
      }
      if (fn === "ajustar_saldo_lote") {
        ajustarSaldoLote(args);
        return { data: null, error: null };
      }
      if (fn === "sincronizar_demanda_analises") {
        try {
          return { data: sincronizarDemandaAnalises(args), error: null };
        } catch (error) {
          return { data: null, error: { message: error instanceof Error ? error.message : "Erro na RPC" } };
        }
      }
      if (fn === "emitir_orcamento_final_transacional") return { data: emitirOrcamentoFinalTransacional(args), error: null };
      if (fn === "transicionar_orcamento_projeto") {
        try {
          return { data: transicionarOrcamentoProjeto(args), error: null };
        } catch (error) {
          return { data: null, error: { message: error instanceof Error ? error.message : "Erro na RPC" } };
        }
      }
      if (fn === "sincronizar_demanda_grupos") {
        try {
          return { data: sincronizarDemandaGrupos(args), error: null };
        } catch (error) {
          return { data: null, error: { message: error instanceof Error ? error.message : "Erro na RPC" } };
        }
      }
      if (fn === "salvar_demanda_com_grupos") {
        try {
          return { data: salvarDemandaComGrupos(args), error: null };
        } catch (error) {
          return { data: null, error: { message: error instanceof Error ? error.message : "Erro na RPC" } };
        }
      }
      if (fn === "excluir_planejamento" || fn === "cancelar_planejamento") {
        try {
          const data = fn === "excluir_planejamento" ? excluirPlanejamento(args) : cancelarPlanejamento(args);
          return { data, error: null };
        } catch (error) {
          return {
            data: null,
            error: {
              message: error instanceof Error ? error.message : "Erro na RPC",
              code: (error as { code?: string }).code ?? "P0001",
            },
          };
        }
      }
      if (fn === "excluir_planejamento_rascunho") {
        try {
          return { data: excluirPlanejamentoRascunho(args), error: null };
        } catch (error) {
          return { data: null, error: { message: error instanceof Error ? error.message : "Erro na RPC" } };
        }
      }
      if (fn === "registrar_entrada_manual_embalagens") {
        const lote = {
          id: nextId("lotes_estoque"),
          insumo_id: args.p_insumo_id,
          codigo_lote: args.p_codigo_lote ?? `MANUAL-${Date.now()}`,
          validade: args.p_validade ?? null,
          quantidade_atual: Number(args.p_quantidade_embalagens),
          status: "aceito",
          modelo_quantidade: "EMBALAGEM_FECHADA",
        };
        store.lotes_estoque.push(lote);
        return { data: { insumo_id: args.p_insumo_id, lote_id: lote.id, repetido: false }, error: null };
      }
      if (fn === "duplicar_analise") {
        const origem = (store.analises ?? []).find((a) => a.codigo === args.p_origem);
        if (!origem) return { data: null, error: { message: "Análise de origem não encontrada." } };
        if ((store.analises ?? []).some((a) => a.codigo === args.p_novo)) {
          return { data: null, error: { message: `Já existe uma análise com o código ${args.p_novo}.` } };
        }
        store.analises.push({ ...origem, codigo: args.p_novo, nome: args.p_nome ?? `${origem.nome ?? origem.codigo} (cópia)`, ativo: true, ofertavel: false });
        for (const tabela of ["etapas", "equipamento_analise", "insumo_analise"]) {
          const copias = (store[tabela] ?? [])
            .filter((linha) => linha.codigo_analise === args.p_origem)
            .map((linha) => ({ ...linha, id: nextId(tabela), codigo_analise: args.p_novo }));
          store[tabela] = [...(store[tabela] ?? []), ...copias];
        }
        return { data: { codigo: args.p_novo }, error: null };
      }
      if (fn === "excluir_analise_sem_historico") {
        const usos = ["orcamento_itens", "orcamento_projeto_analises", "planejamento_itens", "demanda_analises"]
          .reduce((acc, tabela) => acc + (store[tabela] ?? []).filter((l) => l.codigo_analise === args.p_codigo).length, 0);
        if (usos > 0) {
          return { data: null, error: { message: "Esta análise aparece em orçamentos ou planos. Para preservar o histórico, inative-a em vez de excluir." } };
        }
        for (const tabela of ["etapas", "equipamento_analise", "insumo_analise"]) {
          store[tabela] = (store[tabela] ?? []).filter((linha) => linha.codigo_analise !== args.p_codigo);
        }
        store.analises = (store.analises ?? []).filter((a) => a.codigo !== args.p_codigo);
        return { data: { codigo: args.p_codigo, excluida: true }, error: null };
      }
      // Uma RPC sem simulação precisa falhar explicitamente. O fallback
      // anterior (`{ data: null, error: null }`) devolvia sucesso para
      // qualquer função desconhecida — inclusive para funções que não
      // existem no banco — e tornava impossível um teste E2E falhar por
      // causa de RPC. Ver RPCS_SIMULADAS para a lista coberta.
      return {
        data: null,
        error: {
          message: `RPC "${fn}" não tem simulação no mock. Implemente-a em mock-supabase.ts ou ajuste o teste; sucesso não é presumido.`,
          code: "MOCK_RPC_NAO_SIMULADA",
        },
      };
    },
  };
}

