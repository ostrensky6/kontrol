// Central de Ajuda — orientações de uso de todos os módulos do Kontrol.
// Fonte única do conteúdo de ajuda; a tela /ajuda e a busca consomem estes tópicos.

export type AjudaSecao = {
  /** Título da seção (ex.: "Para que serve", "Passo a passo", "Boas práticas"). */
  titulo: string;
  /** Itens da seção, exibidos como lista. */
  itens: string[];
};

export type AjudaTopico = {
  /** Identificador estável para busca/seleção. */
  id: string;
  /** Título do módulo/assunto. */
  titulo: string;
  /** Grupo do menu lateral ao qual pertence. */
  grupo: string;
  /** Rota para abrir o módulo diretamente (quando aplicável). */
  href?: string;
  /** Resumo de uma linha. */
  resumo: string;
  /** Parágrafo de introdução, mais completo. */
  intro: string;
  /** Seções com orientações detalhadas. */
  secoes: AjudaSecao[];
  /** Palavras-chave extras para a busca. */
  termos?: string[];
};

export const AJUDA_TOPICOS: AjudaTopico[] = [
  // ───────────────────────────── Operação ─────────────────────────────
  {
    id: "analises",
    titulo: "Análises",
    grupo: "Operação",
    href: "/analises",
    resumo: "Catálogo técnico das análises: finalidade, matriz e método.",
    intro:
      "O módulo de Análises é o catálogo central de tudo o que o laboratório oferece. Cada análise cadastrada aqui vira a base para o cálculo de custo, para o planejamento e para os orçamentos. Manter este catálogo correto e completo é o primeiro passo para que todo o restante do sistema produza números confiáveis.",
    secoes: [
      {
        titulo: "Para que serve",
        itens: [
          "Reunir, em um só lugar, todas as análises que o laboratório executa, com sua identificação técnica.",
          "Servir de referência para custeio, planejamento e orçamentos — todos puxam dados daqui.",
          "Padronizar finalidade, matriz (tipo de amostra) e método de cada ensaio.",
        ],
      },
      {
        titulo: "Criar, duplicar e inativar",
        itens: [
          "Criar: Operação → Análises → 'Nova análise'. Comece em branco ou copiando etapas, materiais e equipamentos de outra análise.",
          "Duplicar: no menu ⋯ da linha da análise, escolha 'Duplicar' e dê um código novo.",
          "Inativar: na ficha da análise, 'Inativar' a retira de novos orçamentos e planos; o histórico é preservado.",
          "Reativar: abra a ficha da análise inativa e clique em 'Reativar'.",
          "Análise já usada em orçamento ou plano não pode ser excluída — inative-a.",
          "Criar e editar análises exige a permissão 'Editar análises' (padrão: coordenador ou acima).",
        ],
      },
      {
        titulo: "Boas práticas",
        itens: [
          "Use nomes consistentes e evite duplicar análises que são essencialmente a mesma.",
          "Antes de criar um orçamento novo, confirme que a análise está ativa e atualizada.",
          "Toda alteração relevante fica registrada na Auditoria — use isso para acompanhar mudanças.",
        ],
      },
    ],
    termos: ["ensaio", "exame", "catálogo", "método", "matriz", "nova análise", "duplicar", "inativar", "reativar", "desativar"],
  },
  {
    id: "insumos-por-analise",
    titulo: "Insumos por análise",
    grupo: "Operação",
    href: "/insumos",
    resumo: "Reagentes, controles e perdas que compõem cada análise.",
    intro:
      "Aqui você define a 'receita' de cada análise: quais reagentes e materiais ela consome, em que quantidade, quantos controles entram e qual a perda esperada. Essa composição é o que permite ao Custeio calcular o custo técnico real e ao Planejamento prever o consumo de estoque com precisão.",
    secoes: [
      {
        titulo: "Para que serve",
        itens: [
          "Descrever o consumo de insumos de cada análise, item a item.",
          "Incluir controles de qualidade e a perda percentual típica do processo.",
          "Alimentar o custo técnico (Custeio) e a previsão de consumo (Planejamento).",
        ],
      },
      {
        titulo: "Passo a passo",
        itens: [
          "Selecione a análise e adicione cada insumo com a quantidade consumida por amostra.",
          "Informe os controles necessários por corrida/lote de amostras.",
          "Defina a perda percentual esperada — o sistema ajusta o consumo previsto por cima dela.",
        ],
      },
      {
        titulo: "Boas práticas",
        itens: [
          "Mantenha as quantidades por amostra, não por lote, para o cálculo escalar corretamente.",
          "Revise a perda percentual com base no histórico real — isso evita falta ou sobra de estoque.",
          "Vincule sempre ao insumo cadastrado, para que estoque e custo conversem entre si.",
        ],
      },
    ],
    termos: ["reagente", "consumo", "perda", "controle", "receita"],
  },
  {
    id: "custeio",
    titulo: "Custeio",
    grupo: "Operação",
    href: "/custeio",
    resumo: "Custo técnico, overhead e preço base por análise.",
    intro:
      "O Custeio transforma os insumos, a mão de obra e o overhead (custos fixos do laboratório) em um custo por amostra e em um preço. É também onde você simula quantas amostras entram numa corrida para ver o custo cair com lotes maiores.",
    secoes: [
      {
        titulo: "Para que serve",
        itens: [
          "Calcular o custo de cada análise: reagentes + equipamento + pessoal + overhead.",
          "Mostrar o preço: custo total × (1 + fatores de preço).",
          "Simular o número de amostras e comparar análises no gráfico.",
        ],
      },
      {
        titulo: "Passo a passo",
        itens: [
          "Confira a tabela: custo e preço por amostra de cada análise ativa.",
          "No gráfico, escolha as análises e veja os degraus quando uma nova corrida é necessária.",
          "Os fatores de preço (margem, impostos, taxas e fundos) ficam em Operação → Parâmetros de custeio (gestor ou acima).",
        ],
      },
      {
        titulo: "Remuneração da equipe",
        itens: [
          "O salário e o custo-hora de cada técnico só aparecem para quem tem a permissão 'Ver salário dos técnicos'.",
          "Padrão: somente administrador. Para liberar a outro papel: Governança → Privilégios.",
          "Sem a permissão, o valor aparece mascarado; o custo das análises continua correto.",
        ],
      },
    ],
    termos: ["custo", "preço", "margem", "overhead", "simulação", "salário", "remuneração", "parâmetros de custeio"],
  },

  // ──────────────────────────── Suprimentos ────────────────────────────
  {
    id: "estoque",
    titulo: "Estoque",
    grupo: "Suprimentos",
    href: "/estoque",
    resumo: "Saldos, lotes, validade, quarentena e reposição.",
    intro:
      "O Estoque controla os saldos de insumos por lote, com validade, rastreio e quarentena. É daqui que sai o consumo das análises e é aqui que você decide o que precisa ser reposto. O bom uso da quarentena e da regra FEFO evita usar lote errado e reduz perdas por vencimento.",
    secoes: [
      {
        titulo: "Para que serve",
        itens: [
          "Acompanhar saldos por insumo e por lote, com data de validade.",
          "Controlar a quarentena: lotes recebidos só podem ser usados após liberação.",
          "Apontar o que está abaixo do ponto de reposição e precisa de compra.",
        ],
      },
      {
        titulo: "Entrada de lote (+ Entrada)",
        itens: [
          "Na linha do insumo, clique em '+ Entrada' e informe quantidade, validade e o número do lote do fabricante.",
          "O número do lote também pode ser informado no cadastro do insumo (Cadastros → Insumos → Lotes em estoque → '+ Entrada').",
          "O lote entra em quarentena: aceite-o depois da conferência para liberar o uso.",
        ],
      },
      {
        titulo: "Baixa avulsa (Dar baixa)",
        itens: [
          "Use para material que sai fora de um plano: consumo em análise, perda ou quebra, vencimento ou outro motivo.",
          "Onde: Estoque → 'Dar baixa' na linha do insumo, ou nas ações de um lote específico.",
          "Sem escolher o lote, a baixa sai do lote que vence antes (FEFO); escolhendo o lote, sai só dele.",
          "Lote vencido só pode sair com o motivo Vencimento.",
          "Toda baixa pede o motivo e fica no histórico do lote.",
        ],
      },
      {
        titulo: "Planilha de insumos",
        itens: [
          "Estoque → 'Planilha de insumos' baixa a lista completa de insumos em Excel.",
          "Cadastros → Insumos → 'Planilha' baixa a mesma lista.",
          "Para importar alterações, use Cadastros → Todos os cadastros → 'Planilha preenchida' → 'Importar XLSX'.",
        ],
      },
      {
        titulo: "Boas práticas",
        itens: [
          "Não pule a quarentena: usar lote não conferido compromete a rastreabilidade.",
          "Fique atento aos itens vencendo — priorize o consumo deles (o que vence primeiro sai primeiro).",
          "Use o rastreio para saber em quais análises um lote foi utilizado.",
        ],
      },
    ],
    termos: ["saldo", "lote", "validade", "quarentena", "fefo", "reposição", "rastreio", "entrada", "saída", "dar baixa", "baixa avulsa", "perda", "quebra", "descarte", "vencido", "número do lote", "planilha", "excel", "importar"],
  },
  {
    id: "planejamento",
    titulo: "Planejamento",
    grupo: "Suprimentos",
    href: "/planejamento",
    resumo: "Consumo previsto, reservas e faltas de insumos.",
    intro:
      "O Planejamento projeta o consumo de insumos a partir das análises que você pretende executar. Com base no número de amostras, controles e repetições, o sistema calcula o consumo previsto, cria reservas no estoque e ajuda a antecipar compras — evitando tanto a falta quanto o excesso.",
    secoes: [
      {
        titulo: "Para que serve",
        itens: [
          "Transformar um conjunto de análises previstas em consumo concreto de insumos.",
          "Reservar estoque para o que está planejado, evitando consumo conflitante.",
          "Antecipar compras com base no consumo previsto.",
        ],
      },
      {
        titulo: "Passo a passo",
        itens: [
          "Crie um plano, informe projeto e período e adicione as análises (só as ativas aparecem) com nº de amostras, controles e repetições.",
          "Clique em 'Reservar insumos': os lotes ficam separados, mas o saldo ainda não sai do estoque.",
          "Separe o material e escaneie os lotes para conferir com a reserva.",
          "'Retirar insumos e iniciar' tira do estoque os frascos reservados e registra quem retirou; sobras não voltam ao almoxarifado. 'Concluir análise' encerra a execução.",
        ],
      },
      {
        titulo: "Boas práticas",
        itens: [
          "Mantenha o plano realista — superestimar reserva trava estoque desnecessariamente.",
          "Libere reservas que não serão usadas para devolver saldo ao estoque.",
          "Com falta de insumo, 'Gerar pedido interno' abre o pedido de compra dos itens em falta.",
        ],
      },
    ],
    termos: ["demanda", "reserva", "previsão", "plano", "consumo"],
  },
  {
    id: "pedido",
    titulo: "Pedido",
    grupo: "Suprimentos",
    href: "/pedido",
    resumo: "Pedidos internos de compra, antes da compra formal.",
    intro:
      "O módulo Pedido é a porta de entrada dos pedidos internos de compra do laboratório. É onde a equipe registra o que precisa (materiais ou serviços), antes de virar uma compra formal. Cada pedido tem numeração própria, passa por validação e segue um fluxo de etapas até ser encaminhado para a compra de fato.",
    secoes: [
      {
        titulo: "Para que serve",
        itens: [
          "Registrar a necessidade de materiais e serviços antes da compra formal.",
          "Organizar a fila de pedidos com numeração sequencial única (Nº 0001, 0002…), que nunca se repete.",
          "Conduzir cada pedido por etapas: rascunho, validação, formalização e encaminhamento.",
        ],
      },
      {
        titulo: "Criando e consultando",
        itens: [
          "Clique em 'Novo pedido' e preencha título, projeto, urgência, fonte provável e justificativa.",
          "Na lista, o botão 'Itens (N)' abre um resumo rápido do que está sendo solicitado, sem precisar abrir o pedido.",
          "A coluna 'Nº' mostra o número sequencial do pedido; clique para abrir o detalhe completo.",
        ],
      },
      {
        titulo: "Editando itens e o pedido",
        itens: [
          "Em 'Materiais e serviços', use 'Adicionar item' para incluir cada material/serviço (especificação, modelo, volume, quantidade e orçamento prévio).",
          "Cada item tem 'Editar' (abre um formulário preenchido) e 'Remover'.",
          "Itens ficam livres para alteração em rascunho/ajuste; coordenador ou superior também pode alterá-los nas demais etapas, exceto quando o pedido está cancelado ou concluído.",
          "No topo do pedido, 'Editar' altera os dados gerais e 'Excluir' apaga o pedido inteiro (apenas coordenador+).",
        ],
      },
      {
        titulo: "Fluxo de aprovação",
        itens: [
          "Envie para validação quando o pedido estiver completo; pendências aparecem destacadas.",
          "Após validado, formalize em Compras para gerar o pedido formal.",
          "Acompanhe documentos, comunicações, aprovações e a linha do tempo dentro do pedido.",
        ],
      },
    ],
    termos: ["solicitação", "demanda interna", "material", "serviço", "compra", "numeração", "itens", "editar", "excluir"],
  },
  {
    id: "compras",
    titulo: "Compras",
    grupo: "Suprimentos",
    href: "/compras",
    resumo: "Solicitação, aprovação, envio e recebimento de pedidos.",
    intro:
      "Compras cuida do ciclo formal de aquisição: da solicitação à entrada do material no estoque. Ele recebe pedidos vindos do módulo Pedido ou de reposição automática, organiza a aprovação e o envio ao fornecedor, e registra o recebimento — que alimenta a quarentena no Estoque.",
    secoes: [
      {
        titulo: "Para que serve",
        itens: [
          "Conduzir o ciclo de compra: solicitação → aprovação → envio → recebimento.",
          "Centralizar pedidos formais, inclusive os gerados por reposição automática.",
          "Registrar a entrada de itens, que segue para conferência no Estoque.",
        ],
      },
      {
        titulo: "Passo a passo",
        itens: [
          "Revise as solicitações e os rascunhos automáticos de reposição.",
          "Aprove e envie o pedido ao fornecedor.",
          "Ao chegar, receba os itens pelo próprio pedido para dar entrada no estoque.",
          "Confira a quarentena após o recebimento antes de liberar o uso.",
        ],
      },
      {
        titulo: "Boas práticas",
        itens: [
          "Aproveite os rascunhos automáticos para não esquecer reposições críticas.",
          "Receba sempre pelo pedido — assim o rastreio do lote fica completo.",
          "Cheque divergências de quantidade no recebimento antes de fechar o pedido.",
        ],
      },
    ],
    termos: ["fornecedor", "recebimento", "aprovação", "pedido de compra"],
  },

  // ───────────────────────────── Orçamentos ────────────────────────────
  {
    id: "orcamento-demandas",
    titulo: "Orçamentos",
    grupo: "Orçamentos",
    href: "/orcamento/demandas",
    resumo: "Pedidos de cliente em andamento, antes da proposta emitida.",
    intro:
      "Este é o estágio inicial do funil comercial: registrar o pedido do cliente e completar o orçamento até que a proposta possa ser emitida. Serve para não perder oportunidades e para reunir as informações necessárias (escopo, prazo, contato).",
    secoes: [
      {
        titulo: "Para que serve",
        itens: [
          "Registrar o pedido do cliente assim que ele chega (Orçamentos → Novo orçamento).",
          "Completar escopo, prazo e dados de contato.",
          "Servir de origem para o orçamento de Análises/Lab. ou de Projetos.",
        ],
      },
      {
        titulo: "Passo a passo",
        itens: [
          "Registre o que o cliente solicitou e o contexto.",
          "Complemente com escopo e prazo para calcular o orçamento.",
          "Quando estiver completo, emita a proposta.",
        ],
      },
    ],
    termos: ["lead", "cliente", "proposta", "demanda comercial"],
  },
  {
    id: "orcamento-analises",
    titulo: "Orçamento de Análises/Lab.",
    grupo: "Orçamentos",
    href: "/orcamento",
    resumo: "Propostas com análises e quantidades; o preço fica registrado na emissão.",
    intro:
      "Aqui você monta a proposta comercial com base nas análises e seus preços. Na emissão, a proposta guarda o custo e o preço daquele momento, para que mudanças posteriores de custo não alterem o que foi enviado ao cliente. Ao ser aprovada, pode gerar um planejamento de execução.",
    secoes: [
      {
        titulo: "Para que serve",
        itens: [
          "Elaborar propostas com análises e quantidades, usando o preço do Custeio.",
          "Registrar custo e preço no momento da emissão.",
          "Conectar a venda à execução, gerando planejamento na aprovação.",
        ],
      },
      {
        titulo: "Passo a passo",
        itens: [
          "Inclua as análises e as quantidades desejadas na proposta.",
          "Revise os parâmetros econômicos (margens, impostos) antes de emitir.",
          "Emita a proposta e, ao aprovar, gere o planejamento correspondente.",
        ],
      },
      {
        titulo: "Boas práticas",
        itens: [
          "Confira a proposta antes de enviar — o preço registrado é o que vale para o cliente.",
          "Garanta que os parâmetros econômicos estejam atualizados antes de emitir em lote.",
        ],
      },
    ],
    termos: ["proposta", "preço", "snapshot", "aprovação", "venda"],
  },
  {
    id: "orcamento-projetos",
    titulo: "Orçamento de Projetos",
    grupo: "Orçamentos",
    href: "/orcamento/demandas",
    resumo: "Custos próprios do projeto por rubrica, dentro da proposta.",
    intro:
      "Os custos de projeto são uma etapa do orçamento: abra o orçamento em Orçamentos e vá para a etapa \"Custos do projeto\". Lá você lança os itens por rubrica (PE Pessoal, MC Material de consumo, MP Material permanente, ST Serviços de terceiros, VD Viagens e diárias, OU Outros), marca os meses do pessoal, informa as viagens e inclui análises laboratoriais dentro do projeto. Os valores são custo técnico; os parâmetros econômicos entram na etapa seguinte.",
    secoes: [
      {
        titulo: "Para que serve",
        itens: [
          "Montar os custos próprios do projeto por rubrica, a partir do catálogo ou de itens manuais.",
          "Calcular o pessoal por meses marcados (valor mensal × meses) e as viagens pelas entradas de campo.",
          "Exportar os custos do projeto em XLSX ou DOCX.",
        ],
      },
      {
        titulo: "Passo a passo",
        itens: [
          "Em Orçamentos, abra o orçamento e vá para a etapa \"Custos do projeto\". Se ainda não houver custos de projeto, use \"Criar orçamento de projeto\".",
          "Em cada rubrica, adicione itens do catálogo (com busca) ou manuais; edite e remova pela própria linha.",
          "No Pessoal, marque os meses na grade (paginada por ano) e clique em \"Salvar meses\". Em Viagens, preencha as entradas e clique em \"Salvar e recalcular\".",
          "Um coordenador (ou superior) usa \"Concluir revisão dos custos\": os custos ficam travados e a proposta libera parâmetros e emissão.",
        ],
      },
      {
        titulo: "Boas práticas",
        itens: [
          "Confira os totais por rubrica antes de concluir a revisão: custos revisados não voltam para edição nesta versão.",
          "Nas viagens, salvar as entradas recalcula as quantidades automáticas e substitui ajustes manuais dessas linhas.",
        ],
      },
    ],
    termos: ["projeto", "rubrica", "pessoal", "meses", "viagens", "diárias", "catálogo", "revisão"],
  },
  {
    id: "orcamento-parametros",
    titulo: "Parâmetros econômicos",
    grupo: "Orçamentos",
    href: "/orcamento/parametros",
    resumo: "Margens, impostos e fundos aplicados aos orçamentos.",
    intro:
      "Os parâmetros econômicos definem as regras financeiras que o sistema aplica ao calcular preços: margens de lucro, impostos e fundos institucionais. Por afetarem todos os novos orçamentos, devem ser revisados com cuidado, especialmente antes de campanhas comerciais ou mudanças de política de preço.",
    secoes: [
      {
        titulo: "Para que serve",
        itens: [
          "Centralizar margens, impostos e fundos usados no cálculo de preço.",
          "Garantir consistência de preços entre todos os orçamentos.",
        ],
      },
      {
        titulo: "Boas práticas",
        itens: [
          "Revise os parâmetros antes de emitir orçamentos em lote.",
          "Lembre-se: mudanças aqui afetam novos orçamentos, não as propostas já emitidas.",
          "Documente o motivo de alterações relevantes — elas ficam na Auditoria.",
        ],
      },
    ],
    termos: ["margem", "imposto", "fundo", "preço", "parâmetro"],
  },

  // ────────────────────────────── Cadastros ────────────────────────────
  {
    id: "cadastros",
    titulo: "Cadastros",
    grupo: "Cadastros",
    href: "/cadastros",
    resumo: "Bases de apoio: projetos, clientes, insumos, equipamentos e mais.",
    intro:
      "Os Cadastros são as bases de apoio que sustentam todo o app: projetos, clientes, insumos, equipamentos, fornecedores, técnicos, locais e overhead. Como praticamente todos os outros módulos consultam esses dados, mantê-los corretos e sem duplicidade é essencial para a confiabilidade de estoque, custeio e orçamentos.",
    secoes: [
      {
        titulo: "O que você cadastra aqui",
        itens: [
          "Projetos e clientes que aparecem em pedidos e orçamentos.",
          "Insumos e suas políticas de reposição, usados por estoque e custeio.",
          "Equipamentos, fornecedores, técnicos, locais e custos fixos (overhead), como a incubação UFPR mensal.",
        ],
      },
      {
        titulo: "Passo a passo",
        itens: [
          "Acesse o cadastro desejado pelo menu ou por 'Todos os cadastros'.",
          "Crie ou edite o registro com os campos solicitados.",
          "Revise periodicamente para corrigir duplicidades e dados desatualizados.",
        ],
      },
      {
        titulo: "Insumos, lotes e planilha",
        itens: [
          "Na ficha do insumo, 'Lotes em estoque' mostra cada lote com seu número, validade e saldo.",
          "'+ Entrada' registra um lote novo com o número do lote do fabricante; 'Dar baixa' retira material com motivo (consumo, perda ou quebra, vencimento).",
          "'Planilha' (no topo de cada cadastro) baixa a lista em Excel; a importação fica em 'Todos os cadastros'.",
        ],
      },
      {
        titulo: "Técnicos e salário",
        itens: [
          "Salário e custo-hora de cada técnico só aparecem para quem tem a permissão 'Ver salário dos técnicos'.",
          "Padrão: somente administrador. Para mudar: Governança → Privilégios (por papel) ou Usuários → Editar (por pessoa).",
          "Sem a permissão, o valor aparece mascarado; nome, horas e dedicação continuam visíveis.",
        ],
      },
      {
        titulo: "Boas práticas",
        itens: [
          "Evite duplicar fornecedores, insumos ou clientes — isso polui relatórios.",
          "Mantenha as políticas de reposição dos insumos atualizadas para a sugestão de compra funcionar.",
          "Confira Cadastros → Qualidade dos cadastros: lista o que falta e pode distorcer custo ou compra.",
        ],
      },
    ],
    termos: ["cadastro", "projeto", "cliente", "fornecedor", "equipamento", "técnico", "local", "overhead", "salário", "remuneração", "lote", "planilha", "excel", "importar"],
  },

  // ───────────────────────────── Governança ────────────────────────────
  {
    id: "auditoria",
    titulo: "Auditoria",
    grupo: "Governança",
    href: "/auditoria",
    resumo: "Trilha de alterações e eventos do sistema (gestor+).",
    intro:
      "A Auditoria é a trilha completa de quem alterou o quê e quando, em toda a base. Ela existe para garantir rastreabilidade e conformidade: qualquer criação, edição ou exclusão relevante fica registrada com o usuário responsável. É a primeira parada quando algo muda e ninguém sabe explicar por quê.",
    secoes: [
      {
        titulo: "Para que serve",
        itens: [
          "Mostrar o histórico de alterações e eventos do sistema.",
          "Associar cada mudança ao usuário que a executou.",
          "Apoiar investigações e exigências de conformidade.",
        ],
      },
      {
        titulo: "Como usar",
        itens: [
          "Filtre por entidade, período ou usuário para localizar um evento.",
          "Use a trilha para reconstruir a sequência de mudanças de um registro.",
        ],
      },
    ],
    termos: ["log", "trilha", "histórico", "evento", "alteração"],
  },
  {
    id: "backups",
    titulo: "Backups",
    grupo: "Governança",
    href: "/governanca/backups",
    resumo: "Cópias do app local e do banco em nuvem (admin).",
    intro:
      "O módulo de Backups concentra as cópias de segurança da aplicação e do banco. É a sua rede de proteção contra perdas: mantenha uma rotina de backup e, principalmente, gere uma cópia antes de qualquer mudança grande ou migração.",
    secoes: [
      {
        titulo: "Para que serve",
        itens: [
          "Acompanhar e gerar backups do banco e da aplicação.",
          "Reduzir o risco de perda de dados em falhas ou mudanças.",
        ],
      },
      {
        titulo: "Boas práticas",
        itens: [
          "Faça backup antes de migrações, atualizações ou operações em massa.",
          "Verifique periodicamente se as cópias estão sendo geradas como esperado.",
        ],
      },
    ],
    termos: ["backup", "cópia", "restauração", "segurança"],
  },
  {
    id: "usuarios",
    titulo: "Usuários e permissões",
    grupo: "Governança",
    href: "/usuarios",
    resumo: "Categorias técnico, coordenador, gestor e administrador, com permissões ajustáveis.",
    intro:
      "Aqui você gerencia quem acessa o sistema, assinaturas e o que cada pessoa pode fazer. A categoria define a matriz inicial de permissões, e cada usuário pode ter ajustes individuais.",
    secoes: [
      {
        titulo: "Categorias de permissão",
        itens: [
          "Técnico: operação do dia a dia (registrar, adicionar itens, executar tarefas básicas).",
          "Coordenador: valida, aprova e pode editar/excluir em mais situações.",
          "Gestor: visão de governança, incluindo Auditoria.",
          "Admin: controle total, incluindo usuários e backups.",
        ],
      },
      {
        titulo: "Como usar",
        itens: [
          "Crie o usuário e atribua a categoria adequada à função dele; ele entra com senha provisória e troca no primeiro acesso.",
          "Use os três pontinhos para editar permissões, enviar a assinatura, alterar a senha, suspender ou excluir.",
          "Confira a tabela de permissões abaixo da lista de usuários; o padrão de cada papel também pode ser editado em Governança → Privilégios.",
        ],
      },
      {
        titulo: "Permissões que merecem atenção",
        itens: [
          "'Ver salário dos técnicos': mostra salário e custo-hora dos técnicos. Padrão: somente administrador.",
          "'Editar análises': criar, duplicar, inativar e alterar análises. Padrão: coordenador ou acima.",
          "Ajuste individual (Usuários → Editar) vale acima do padrão do papel.",
        ],
      },
    ],
    termos: ["usuário", "categoria", "permissão", "perfil", "acesso", "assinatura", "privilégios", "remuneração", "salário"],
  },

  // ─────────────────────────────── Geral ───────────────────────────────
  {
    id: "navegacao-geral",
    titulo: "Navegação e atalhos",
    grupo: "Geral",
    resumo: "Como circular pelo app com rapidez e produtividade.",
    intro:
      "Algumas ferramentas atravessam todo o app e ajudam você a trabalhar mais rápido: o menu lateral agrupado por área, a busca rápida (Ctrl K), os filtros das tabelas e o tema claro/escuro.",
    secoes: [
      {
        titulo: "Recursos de navegação",
        itens: [
          "Menu lateral: acessa os módulos, organizados por área (Operação, Suprimentos, etc.).",
          "Busca rápida: Ctrl K (ou a lupa no celular) encontra qualquer tela, como Inventário, Etiquetas ou Parâmetros de custeio.",
          "Tabelas com busca e filtros: encontre registros nas filas sem rolar tudo.",
          "Tema claro/escuro: acompanha o sistema e pode ser alternado.",
        ],
      },
      {
        titulo: "Ajuda na própria tela",
        itens: [
          "O '?' ao lado de um título explica aquela parte da tela em poucas linhas.",
          "O botão de ajuda no canto inferior direito (no celular, o '?' da barra superior) resume a tela atual e leva a esta Central.",
        ],
      },
    ],
    termos: ["atalho", "command palette", "busca", "tema", "navegação", "menu", "ctrl k", "ajuda"],
  },
];

export const AJUDA_GRUPOS = [
  "Operação",
  "Suprimentos",
  "Orçamentos",
  "Cadastros",
  "Governança",
  "Geral",
] as const;
