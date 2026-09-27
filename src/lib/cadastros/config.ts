/**
 * Configuração declarativa dos cadastros (elementos de custo).
 * Dados serializáveis — compartilhados entre Server Components (páginas) e
 * Client Components (formulário/drawer). Sem imports de servidor aqui.
 *
 * Cada categoria lista os campos da tabela, agrupados por seção. Campos sem
 * uso demonstrado ficam fora do formulário (`oculto`), mas continuam na
 * planilha; ao salvar, o app revalida o que depende (custeio, orçamentos,
 * estoque…).
 */

export type CampoTipo =
  | "text"
  | "textarea"
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "select"
  | "checkbox";

export type Campo = {
  name: string;
  label: string;
  tipo: CampoTipo;
  obrigatorio?: boolean;
  step?: string;
  min?: number;
  max?: number;
  /**
   * `inativo`: registro desativado (fornecedor, cliente, tipo técnico). Só
   * aparece no seletor quando já é o valor atual do registro editado.
   */
  opcoes?: { value: string; label: string; inativo?: boolean }[];
  /** preenche as opções dinamicamente no servidor (ex.: lista de fornecedores) */
  opcoesDe?: "fornecedores" | "clientes" | "projetos" | "tipo_insumos" | "locais";
  /**
   * fora do formulário (sem uso demonstrado), mas mantido na planilha de
   * exportação/importação; a edição pelo formulário não altera o valor gravado.
   */
  oculto?: boolean;
  /** exibido no formulário, mas calculado: não é editável nem enviado */
  somenteLeitura?: boolean;
  /**
   * "estoque_inicial": dado do primeiro lote. Aparece só ao criar o registro,
   * no bloco "Estoque inicial"; na edição, lotes são mantidos em Estoque.
   */
  bloco?: "estoque_inicial";
  /** rótulos de versões anteriores, aceitos no cabeçalho da planilha importada */
  rotulosAntigos?: string[];
  /** texto curto sempre visível sob o campo (consequência que não pode ficar escondida no "?") */
  aviso?: string;
  /** explicação curta exibida no "?" ao lado do rótulo */
  ajuda?: string;
  /** exemplo curto exibido junto da ajuda */
  exemplo?: string;
  colSpan?: 1 | 2;
  placeholder?: string;
  /** título de seção; o primeiro campo de cada seção carrega o rótulo */
  grupo?: string;
  /** checkbox marcado por padrão ao criar um novo registro */
  padraoLigado?: boolean;
  /** valor inicial ao criar um novo registro */
  valorPadrao?: string | number;
  /** inclui o campo nas planilhas XLSX */
  exportar?: boolean;
  /**
   * valor sigiloso sem permissão (definido no servidor): o formulário mostra
   * "XXX" desabilitado e não envia o campo — o valor atual é preservado.
   */
  mascarado?: boolean;
};

export type Coluna = {
  key: string;
  label: string;
  tipo?: CampoTipo;
  alinhar?: "left" | "right";
  largura?: "xs" | "sm" | "md" | "lg";
  /** coluna calculada (somente leitura, destacada) */
  calculada?: boolean;
};

export type CadastroConfig = {
  slug: string;
  tabela: string;
  titulo: string;
  singular: string;
  subtitulo: string;
  /** coluna usada como rótulo nas confirmações */
  rotulo: string;
  colunas: Coluna[];
  colunasXlsx?: Coluna[];
  campos: Campo[];
};

export const CADASTROS: Record<string, CadastroConfig> = {
  clientes: {
    slug: "clientes",
    tabela: "clientes",
    titulo: "Clientes",
    singular: "cliente",
    subtitulo:
      "Quem contrata o laboratório. Cada cliente se liga às **propostas** e, pelos projetos, aos planejamentos e compras.",
    rotulo: "nome",
    colunas: [
      { key: "nome", label: "Cliente" },
      { key: "cnpj", label: "CNPJ" },
      { key: "contato", label: "Contato" },
      { key: "email", label: "E-mail" },
      { key: "telefone", label: "Telefone" },
      { key: "ativo", label: "Ativo", tipo: "checkbox" },
    ],
    campos: [
      { name: "nome", label: "Razão social / nome", tipo: "text", obrigatorio: true, colSpan: 2, grupo: "Identificação" },
      { name: "cnpj", label: "CNPJ / CPF", tipo: "text", placeholder: "00.000.000/0000-00" },
      { name: "ativo", label: "Ativo", tipo: "checkbox", padraoLigado: true },

      { name: "contato", label: "Responsável / comprador", tipo: "text", colSpan: 2, grupo: "Contato" },
      { name: "email", label: "E-mail", tipo: "text" },
      { name: "telefone", label: "Telefone", tipo: "text" },

      { name: "endereco", label: "Endereço", tipo: "text", colSpan: 2, grupo: "Endereço" },

      { name: "observacoes", label: "Observações", tipo: "textarea", colSpan: 2, grupo: "Observações" },
    ],
  },

  projetos: {
    slug: "projetos",
    tabela: "projetos",
    titulo: "Projetos",
    singular: "projeto",
    subtitulo:
      "Trabalhos do laboratório. Cada projeto pertence a um **cliente** e reúne orçamentos, planejamentos e compras.",
    rotulo: "nome",
    colunas: [
      { key: "nome", label: "Projeto" },
      { key: "cliente_nome", label: "Cliente" },
      { key: "responsavel", label: "Responsável" },
      { key: "data_inicio", label: "Início", tipo: "date" },
      { key: "data_fim", label: "Fim", tipo: "date" },
      { key: "status", label: "Status" },
    ],
    campos: [
      { name: "nome", label: "Nome do projeto", tipo: "text", obrigatorio: true, colSpan: 2, grupo: "Identificação" },
      { name: "cliente_id", label: "Cliente", tipo: "select", opcoesDe: "clientes" },
      { name: "responsavel", label: "Responsável (laboratório)", tipo: "text" },
      {
        name: "status",
        label: "Status",
        tipo: "select",
        opcoes: [
          { value: "proposto", label: "Proposto" },
          { value: "ativo", label: "Ativo" },
          { value: "concluido", label: "Concluído" },
          { value: "cancelado", label: "Cancelado" },
        ],
      },

      { name: "data_inicio", label: "Data de início", tipo: "date", grupo: "Prazos" },
      { name: "data_fim", label: "Data de término", tipo: "date", ajuda: "Não pode ser anterior à data de início." },

      { name: "descricao", label: "Descrição / escopo", tipo: "textarea", colSpan: 2, grupo: "Descrição" },
    ],
  },

  equipamentos: {
    slug: "equipamentos",
    tabela: "equipamentos",
    titulo: "Equipamentos",
    singular: "equipamento",
    subtitulo:
      "Equipamentos do laboratório. O **custo/dia** soma a depreciação pela vida útil e a manutenção, dividido pelos dias úteis do ano.",
    rotulo: "nome",
    colunas: [
      { key: "nome", label: "Equipamento" },
      { key: "quantidade", label: "Qtd", tipo: "number", alinhar: "right" },
      { key: "custo_unitario", label: "Custo un.", tipo: "currency", alinhar: "right" },
      { key: "vida_util_anos", label: "Vida útil (anos)", tipo: "number", alinhar: "right" },
      { key: "data_validade", label: "Validade", tipo: "date" },
      { key: "tempo_para_validade", label: "Tempo restante", calculada: true },
      { key: "custo_dia", label: "Custo/dia", tipo: "currency", alinhar: "right", calculada: true },
    ],
    campos: [
      { name: "nome", label: "Nome", tipo: "text", obrigatorio: true, colSpan: 2, grupo: "Identificação" },
      { name: "possui", label: "Possui no laboratório", tipo: "checkbox" },

      { name: "quantidade", label: "Quantidade", tipo: "number", obrigatorio: true, min: 0, step: "1", grupo: "Aquisição e valor" },
      { name: "custo_unitario", label: "Custo unitário (R$)", tipo: "currency", obrigatorio: true, min: 0 },
      { name: "data_aquisicao", label: "Data de aquisição", tipo: "date" },
      { name: "vida_util_anos", label: "Vida útil (anos)", tipo: "number", min: 0, step: "0.5", ajuda: "Anos até o equipamento ser totalmente **depreciado**; o valor é dividido igualmente entre eles.", exemplo: "Equipamento de R$ 100.000 com vida útil de 10 anos → R$ 10.000 por ano." },
      {
        name: "data_validade",
        label: "Data de validade / fim da vida útil",
        tipo: "date",
        somenteLeitura: true,
        ajuda: "Calculada somando a **vida útil** à data de aquisição. Para mudar, altere uma das duas.",
      },

      {
        name: "percentual_manutencao_anual",
        label: "Manutenção anual (fração)",
        tipo: "number",
        min: 0,
        max: 1,
        step: "0.01",
        ajuda: "Parte do valor do equipamento gasta com manutenção por ano, em fração: **0,05 = 5%**.",
        exemplo: "Equipamento de R$ 100.000 com 0,05 → R$ 5.000 por ano de manutenção.",
        grupo: "Manutenção",
      },
      {
        name: "manutencao_anual_fixa",
        label: "Manutenção anual fixa (R$)",
        tipo: "currency",
        min: 0,
        ajuda: "Valor anual de um contrato de manutenção. Quando preenchido, **substitui** a fração acima.",
      },
    ],
  },

  insumos: {
    slug: "insumos",
    tabela: "insumos",
    titulo: "Insumos",
    singular: "insumo",
    subtitulo:
      "Catálogo de reagentes e consumíveis, com embalagem, fornecedor, reposição e armazenamento. O **custo unitário** é o valor da embalagem dividido pela quantidade.",
    rotulo: "especificacao",
    colunas: [
      { key: "especificacao", label: "Item específico / SKU", largura: "lg" },
      { key: "fabricante", label: "Marca / fabricante", largura: "sm" },
      { key: "unidade", label: "Unidade", largura: "xs" },
      { key: "quantidade", label: "Quantidade", tipo: "number", alinhar: "right", largura: "sm", calculada: true },
      { key: "custo_unitario", label: "Custo un.", tipo: "currency", alinhar: "right", largura: "sm", calculada: true },
      { key: "validade_lotes", label: "Validade", tipo: "date", largura: "sm", calculada: true },
      { key: "ponto_reposicao", label: "Repos.", tipo: "number", alinhar: "right", largura: "xs" },
    ],
    colunasXlsx: [
      { key: "especificacao", label: "Item específico / SKU" },
      { key: "fabricante", label: "Marca / fabricante" },
      { key: "unidade", label: "Unidade da embalagem" },
      // Só vale para itens novos na importação (estoque inicial); para itens
      // existentes é informativa — entradas e baixas passam pelo Estoque.
      { key: "quantidade", label: "Quantidade (embalagens fechadas)", tipo: "number" },
    ],
    campos: [
      {
        name: "tipo_insumo_id",
        label: "Tipo técnico",
        tipo: "select",
        opcoesDe: "tipo_insumos",
        grupo: "Identificação",
        ajuda: "Nome padronizado que **agrupa itens equivalentes** (outra marca ou embalagem) nos cálculos e relatórios.",
        exportar: false,
      },
      { name: "nome_item", label: "Categoria curta", tipo: "text", placeholder: "Ladder, Beads, Kit Illumina…" },
      { name: "especificacao", label: "Item específico / SKU", tipo: "text", obrigatorio: true, colSpan: 2, ajuda: "Nome exato do item comprado (marca e apresentação). É ele que aparece na compra, no estoque e nos **lotes**." },
      { name: "fabricante", label: "Marca / fabricante", tipo: "text", placeholder: "Qiagen, Illumina, KASVI…" },
      { name: "codigo_fabricante", label: "Código do fabricante", tipo: "text", placeholder: "Catálogo / part number" },
      // Sem uso demonstrado (auditoria 26/09 §3): fora do formulário; o valor gravado é preservado.
      { name: "codigo_interno", label: "Código interno", tipo: "text", oculto: true, exportar: false },

      {
        name: "custo_total_embalagem",
        label: "Valor da embalagem (R$)",
        tipo: "currency",
        obrigatorio: true,
        min: 0,
        grupo: "Embalagem e custo",
        ajuda: "Preço de uma embalagem fechada. O **custo unitário** é este valor dividido pela quantidade na embalagem. Com R$ 0, o insumo entra **sem custo** nas análises.",
        exemplo: "R$ 500 por frasco de 100 mL → R$ 5,00 por mL.",
      },
      {
        name: "quantidade_embalagem",
        label: "Quantidade na embalagem",
        tipo: "number",
        obrigatorio: true,
        min: 0.000001,
        step: "any",
        ajuda: "Quanto vem em 1 embalagem fechada, na unidade da embalagem.",
        exemplo: "Frasco de 500 mL → 500.",
      },
      {
        name: "unidade",
        label: "Unidade da embalagem",
        tipo: "text",
        obrigatorio: true,
        placeholder: "mL, un, reações…",
        ajuda: "Unidade em que a embalagem é vendida (mL, un, reações). A de consumo pode ser outra; o fator converte.",
      },
      {
        name: "unidade_consumo",
        label: "Unidade de consumo",
        tipo: "text",
        placeholder: "µL, reações, un, mL…",
        ajuda: "Unidade usada nas **receitas** das análises e no consumo do estoque. Se ficar vazia, vale a unidade da embalagem.",
        exemplo: "Embalagem em mL, receita em µL → unidade de consumo: µL.",
      },
      {
        name: "fator_conversao",
        label: "Fator de conversão",
        tipo: "number",
        obrigatorio: true,
        min: 0.000001,
        step: "0.000001",
        valorPadrao: 1,
        ajuda: "Quantas unidades de consumo cabem em **1 unidade da embalagem**. Use 1 quando as unidades forem iguais.",
        exemplo: "Embalagem em mL e consumo em µL → 1 mL = 1000 µL → fator **1000**.",
      },

      { name: "fornecedor_id", label: "Fornecedor principal", tipo: "select", opcoesDe: "fornecedores", grupo: "Compra e fornecedor" },
      { name: "fornecedor_alt_id", label: "Fornecedor alternativo", tipo: "select", opcoesDe: "fornecedores", oculto: true },
      {
        name: "categoria_compra",
        label: "Categoria de compra",
        tipo: "select",
        opcoes: [
          { value: "critico", label: "Crítico" },
          { value: "operacional", label: "Operacional" },
          { value: "eventual", label: "Eventual" },
        ],
        ajuda: "**Crítico** ganha destaque nas sugestões de compra. Ao aceitar um lote crítico, é preciso informar responsável e critério de aceite.",
      },
      {
        name: "quantidade_minima_compra",
        label: "Quantidade mínima de compra",
        tipo: "number",
        min: 0,
        ajuda: "Em embalagens fechadas.",
        exemplo: "Fornecedor só vende caixas de 5 → 5.",
      },
      {
        name: "prazo_entrega_max_dias",
        label: "Prazo de entrega máx. (dias)",
        tipo: "number",
        min: 0,
        step: "1",
        ajuda: "Prazo aceito no contrato. O cálculo da compra usa o **Lead time**.",
      },

      { name: "ponto_reposicao", label: "Ponto de reposição", tipo: "number", min: 0, ajuda: "Quando o **disponível** chega a este número, o insumo aparece como Repor e entra nas sugestões de compra.", exemplo: "Ponto de reposição 2: com 2 frascos ou menos, o sistema sugere comprar.", grupo: "Estoque e reposição" },
      {
        name: "estoque_seguranca",
        label: "Estoque de segurança",
        tipo: "number",
        min: 0,
        ajuda: "Em embalagens fechadas. Margem para imprevistos (atraso, consumo maior). Entra no **ponto sugerido** junto com o consumo durante o lead time.",
        exemplo: "Consumo de 2/dia, lead time de 10 dias e segurança 5 → ponto sugerido 25.",
      },
      { name: "lead_time_dias", label: "Lead time (dias)", tipo: "number", min: 0, step: "1", ajuda: "Dias entre fazer o pedido e o insumo chegar. Usado para **antecipar a compra**; se ficar vazio, vale o prazo médio do fornecedor." },

      {
        name: "condicao_armazenamento",
        label: "Condição de armazenamento",
        tipo: "text",
        colSpan: 2,
        placeholder: "−20 °C, 2–8 °C, temperatura ambiente…",
        grupo: "Armazenamento",
        oculto: true,
      },
      {
        name: "validade_apos_abertura_dias",
        label: "Validade após abertura (dias)",
        tipo: "number",
        min: 0,
        step: "1",
        grupo: "Armazenamento",
        ajuda: "Prazo de uso depois que a embalagem é aberta. Vale a data que **vencer primeiro**: a do lote ou a da abertura.",
        exemplo: "Aberto em 10/09 com 30 dias → usar até 10/10, mesmo que o lote vença depois.",
      },
      { name: "sds_url", label: "Ficha de segurança (URL do SDS)", tipo: "text", colSpan: 2, oculto: true },

      // Dados do primeiro lote (auditoria 26/09 §3: validade, fabricação e
      // aquisição são do lote, não do produto). Só aparecem ao criar o insumo.
      { name: "data_aquisicao", label: "Data de aquisição", tipo: "date", bloco: "estoque_inicial", rotulosAntigos: ["Data da última compra"] },
      { name: "data_fabricacao", label: "Data de fabricação", tipo: "date", bloco: "estoque_inicial" },
      {
        name: "validade_dias",
        label: "Validade após fabricação/aquisição (dias)",
        tipo: "number",
        min: 0,
        step: "1",
        bloco: "estoque_inicial",
        ajuda: "Se a data de validade ficar vazia, ela é **calculada** somando estes dias à fabricação (ou à aquisição).",
        exemplo: "Fabricado em 01/09/2026 + 180 dias → validade 28/02/2027.",
      },
      {
        name: "data_validade",
        label: "Data de validade",
        tipo: "date",
        bloco: "estoque_inicial",
        ajuda: "Data **impressa na embalagem**. Se ficar vazia, é calculada pela validade em dias. Obrigatória para item **crítico** com quantidade.",
      },
    ],
  },

  tipo_insumos: {
    slug: "tipo_insumos",
    tabela: "tipo_insumos",
    titulo: "Tipos técnicos",
    singular: "tipo técnico",
    subtitulo:
      "Nomes padronizados usados nos cálculos e relatórios. Cada tipo técnico **agrupa itens equivalentes** do catálogo de insumos (marcas ou embalagens diferentes).",
    rotulo: "nome",
    colunas: [
      { key: "nome", label: "Tipo técnico" },
      { key: "classe", label: "Classe" },
      { key: "unidade_referencia", label: "Unidade ref." },
      { key: "finalidade", label: "Finalidade" },
      { key: "ativo", label: "Ativo", tipo: "checkbox" },
    ],
    campos: [
      { name: "nome", label: "Nome técnico", tipo: "text", obrigatorio: true, colSpan: 2, grupo: "Identificação" },
      {
        name: "classe",
        label: "Classe",
        tipo: "select",
        opcoes: [
          { value: "reagente", label: "Reagente" },
          { value: "consumivel", label: "Consumível" },
          { value: "material", label: "Material" },
          { value: "equipamento_consumivel", label: "Consumível de equipamento" },
          { value: "servico", label: "Serviço" },
          { value: "insumo", label: "Insumo" },
        ],
      },
      { name: "ativo", label: "Ativo", tipo: "checkbox", padraoLigado: true },
      { name: "unidade_referencia", label: "Unidade de referência", tipo: "text", placeholder: "uL, mL, un, reação…" },
      { name: "finalidade", label: "Finalidade técnica", tipo: "text", colSpan: 2 },
      { name: "observacoes", label: "Observações", tipo: "textarea", colSpan: 2, grupo: "Governança" },
    ],
  },

  tecnicos: {
    slug: "tecnicos",
    tabela: "tecnicos",
    titulo: "Técnicos",
    singular: "técnico",
    subtitulo:
      "Equipe do laboratório e sua dedicação. O **valor HH** (custo da hora × % dedicado) entra no custo das análises.",
    rotulo: "nome",
    colunas: [
      { key: "nome", label: "Nome" },
      { key: "processo", label: "Processo" },
      { key: "valor_mes", label: "Valor/mês", tipo: "currency", alinhar: "right" },
      { key: "horas_mes_base", label: "Horas/mês", tipo: "number", alinhar: "right" },
      { key: "percentual_dedicado", label: "% dedicado", tipo: "percent", alinhar: "right" },
      { key: "custo_hora", label: "Custo/hora", tipo: "currency", alinhar: "right", calculada: true },
      { key: "valor_hh", label: "Valor HH", tipo: "currency", alinhar: "right", calculada: true },
      { key: "ativo", label: "Ativo", tipo: "checkbox" },
    ],
    campos: [
      { name: "nome", label: "Nome", tipo: "text", obrigatorio: true, colSpan: 2, grupo: "Identificação" },
      {
        name: "processo",
        label: "Processo",
        tipo: "select",
        opcoes: [
          { value: "Laboratório", label: "Laboratório" },
          { value: "Bioinformática", label: "Bioinformática" },
        ],
      },
      {
        name: "ativo",
        label: "Ativo",
        tipo: "checkbox",
        padraoLigado: true,
        ajuda: "Desmarque quando o técnico sair da equipe: ele deixa de entrar no **custo da hora de pessoal** das análises, e o histórico fica preservado.",
      },

      { name: "valor_mes", label: "Valor mensal (R$)", tipo: "currency", obrigatorio: true, min: 0, grupo: "Custo e dedicação" },
      { name: "horas_mes_base", label: "Horas/mês base", tipo: "number", obrigatorio: true, min: 1, ajuda: "Horas de trabalho por mês usadas para calcular o **custo da hora**.", exemplo: "44 h por semana ≈ 176 h/mês." },
      {
        name: "percentual_dedicado",
        label: "% dedicado ao laboratório",
        tipo: "percent",
        obrigatorio: true,
        min: 0,
        max: 100,
        ajuda: "Parte do tempo do técnico dedicada ao laboratório. O **valor HH** é o custo da hora multiplicado por este percentual.",
        exemplo: "R$ 8.800/mês ÷ 176 h = R$ 50/h; com 50% dedicado → valor HH de R$ 25.",
      },
    ],
  },

  fornecedores: {
    slug: "fornecedores",
    tabela: "fornecedores",
    titulo: "Fornecedores",
    singular: "fornecedor",
    subtitulo:
      "Empresas que vendem ao laboratório, com dados fiscais, contato e prazos. Usados nos insumos, nas compras e no **ponto de reposição**.",
    rotulo: "nome",
    colunas: [
      { key: "nome", label: "Fornecedor" },
      { key: "cnpj", label: "CNPJ" },
      { key: "email", label: "E-mail" },
      { key: "telefone", label: "Telefone" },
      { key: "prazo_medio_dias", label: "Prazo médio (dias)", tipo: "number", alinhar: "right" },
      { key: "ativo", label: "Ativo", tipo: "checkbox" },
    ],
    campos: [
      { name: "nome", label: "Razão social / nome", tipo: "text", obrigatorio: true, colSpan: 2, grupo: "Identificação" },
      { name: "cnpj", label: "CNPJ", tipo: "text", placeholder: "00.000.000/0000-00" },
      { name: "ativo", label: "Ativo", tipo: "checkbox", padraoLigado: true },

      { name: "contato", label: "Vendedor / representante", tipo: "text", colSpan: 2, grupo: "Contato" },
      { name: "email", label: "E-mail", tipo: "text" },
      { name: "telefone", label: "Telefone", tipo: "text" },
      { name: "site", label: "Site", tipo: "text", colSpan: 2, oculto: true },

      { name: "endereco", label: "Endereço", tipo: "text", colSpan: 2, grupo: "Endereço" },

      { name: "catalogo_padrao", label: "Catálogo padrão", tipo: "text", grupo: "Compras e prazos", oculto: true },
      { name: "prazo_medio_dias", label: "Prazo médio (dias)", tipo: "number", min: 0, ajuda: "Tempo usual entre o pedido e a entrega. Vale como **lead time** dos insumos deste fornecedor que não têm um próprio." },
      { name: "prazo_max_dias", label: "Prazo máximo (dias)", tipo: "number", min: 0, oculto: true },

      { name: "observacoes", label: "Observações", tipo: "textarea", colSpan: 2, grupo: "Observações" },
    ],
  },

  locais: {
    slug: "locais",
    tabela: "locais",
    titulo: "Locais",
    singular: "local",
    subtitulo:
      "Onde o material fica guardado: prédio, sala, freezer, geladeira, gaveta, caixa ou posição. Usados no **inventário** e na localização dos lotes.",
    rotulo: "nome",
    colunas: [
      { key: "nome", label: "Local" },
      { key: "tipo", label: "Tipo" },
      { key: "parent_nome", label: "Dentro de" },
      { key: "condicao_armazenamento", label: "Condição" },
    ],
    campos: [
      { name: "nome", label: "Nome do local", tipo: "text", obrigatorio: true, colSpan: 2, grupo: "Identificação" },
      {
        name: "tipo",
        label: "Tipo",
        tipo: "select",
        opcoes: [
          { value: "predio", label: "Prédio" },
          { value: "sala", label: "Sala" },
          { value: "freezer", label: "Freezer" },
          { value: "geladeira", label: "Geladeira" },
          { value: "armario", label: "Armário" },
          { value: "gaveta", label: "Gaveta" },
          { value: "caixa", label: "Caixa" },
          { value: "rack", label: "Rack" },
          { value: "posicao", label: "Posição" },
        ],
      },
      {
        name: "condicao_armazenamento",
        label: "Condição de armazenamento",
        tipo: "text",
        placeholder: "−20 °C, 2–8 °C, ambiente…",
      },
      {
        name: "parent_id",
        label: "Fica dentro de",
        tipo: "select",
        opcoesDe: "locais",
        ajuda: "Local maior que contém este (ex.: a gaveta fica dentro do armário). Deixe vazio para um local de primeiro nível.",
      },
    ],
  },

  overhead: {
    slug: "overhead",
    tabela: "overhead",
    titulo: "Overhead",
    singular: "item de overhead",
    subtitulo:
      "Custos fixos mensais (aluguel, energia, incubação UFPR…) rateados por **hora de bancada**. A taxa de incubação em % da proposta fica em Parâmetros de custeio.",
    rotulo: "item",
    colunas: [
      { key: "item", label: "Item" },
      { key: "custo_mensal", label: "Custo/mês", tipo: "currency", alinhar: "right" },
      { key: "percentual_compensada", label: "% compensada", tipo: "percent", alinhar: "right" },
      { key: "horas_bancada_mes", label: "Horas bancada/mês", tipo: "number", alinhar: "right" },
      { key: "custo_hora_bancada", label: "Custo/hora", tipo: "currency", alinhar: "right", calculada: true },
    ],
    campos: [
      { name: "item", label: "Item", tipo: "text", obrigatorio: true, colSpan: 2, grupo: "Identificação" },
      { name: "custo_mensal", label: "Custo mensal (R$)", tipo: "currency", obrigatorio: true, min: 0, grupo: "Rateio" },
      {
        name: "percentual_compensada",
        label: "% compensada",
        tipo: "percent",
        obrigatorio: true,
        min: 0,
        max: 100,
        ajuda: "Parte deste custo que é **repassada às análises**. O restante não entra no preço.",
        exemplo: "Aluguel de R$ 5.000 com 50% → R$ 2.500 entram no rateio.",
      },
      {
        name: "horas_bancada_mes",
        label: "Horas de bancada/mês",
        tipo: "number",
        obrigatorio: true,
        min: 1,
        ajuda: "Horas de uso da bancada por mês. A parte compensada é **dividida por estas horas** para dar o custo/hora.",
        exemplo: "R$ 2.500 ÷ 450 h ≈ R$ 5,56 por hora de bancada.",
      },
    ],
  },
};

export const ORDEM_CADASTROS = [
  "projetos",
  "clientes",
  "tipo_insumos",
  "insumos",
  "equipamentos",
  "fornecedores",
  "tecnicos",
  "locais",
  "overhead",
] as const;

/**
 * Ordem da importação por planilha: cada aba vem depois das que ela referencia
 * (fornecedor e tipo técnico antes de insumo; cliente antes de projeto), para
 * que registros novos da mesma planilha já existam quando forem citados.
 */
export const ORDEM_IMPORTACAO = [
  "clientes",
  "fornecedores",
  "tipo_insumos",
  "locais",
  "projetos",
  "insumos",
  "equipamentos",
  "tecnicos",
  "overhead",
] as const;

export function getCadastrosParaImportacao(): CadastroConfig[] {
  const vistos = new Set<string>(ORDEM_IMPORTACAO);
  return [
    ...ORDEM_IMPORTACAO.map((slug) => CADASTROS[slug]).filter(Boolean),
    ...Object.values(CADASTROS).filter((cadastro) => !vistos.has(cadastro.slug)),
  ];
}

export function getCadastrosOrdenados(): CadastroConfig[] {
  const slugsOrdenados = new Set<string>(ORDEM_CADASTROS);
  const cadastrosOrdenados = ORDEM_CADASTROS.map((slug) => CADASTROS[slug]).filter(
    Boolean,
  );
  const cadastrosRestantes = Object.values(CADASTROS).filter(
    (cadastro) => !slugsOrdenados.has(cadastro.slug),
  );

  return [...cadastrosOrdenados, ...cadastrosRestantes];
}
