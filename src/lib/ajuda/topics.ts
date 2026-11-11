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

/** Busca textual da Central; a associação contextual continua em ContextHelp. */
export function topicoCasa(topico: AjudaTopico, termo: string) {
  const normalizar = (texto: string) => texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const consulta = termo.trim();
  if (!consulta) return true;
  const alvo = normalizar([topico.titulo, topico.href, topico.grupo, topico.resumo, topico.intro,
    ...topico.secoes.flatMap((s) => [s.titulo, ...s.itens]), ...(topico.termos ?? [])].join(" "));
  return normalizar(consulta).split(/\s+/).every((palavra) => alvo.includes(palavra));
}

export const AJUDA_TOPICOS: AjudaTopico[] = [
  // ──────────────────────── Análises e custeio ────────────────────────
  {
    id: "analises",
    titulo: "Análises",
    grupo: "Análises e custeio",
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
          "Criar: Análises e custeio → Análises → 'Nova análise'. Comece em branco ou copiando etapas, materiais e equipamentos de outra análise.",
          "Duplicar: no menu ⋯ da linha da análise, escolha 'Duplicar' e dê um código novo.",
          "Inativar: na ficha da análise, 'Inativar' a retira de novos orçamentos e planos; o histórico é preservado.",
          "Reativar: abra a ficha da análise inativa e clique em 'Reativar'.",
          "Análise já usada em orçamento ou plano não pode ser excluída — inative-a.",
          "Criar e editar análises exige a permissão 'Editar análises' (padrão: coordenador ou acima).",
        ],
      },
      {
        titulo: "Reagentes alternativos",
        itens: [
          "Insumos com o mesmo 'Grupo' na aba Insumos são alternativas: o orçamento usa só uma, a mais cara entre as que servem (padrão de segurança).",
          "Insumo sem preço cadastrado não conta como zero: a análise e o orçamento avisam, e a revisão do orçamento fica bloqueada até cadastrar o preço.",
          "Para tirar uma alternativa do cálculo, abra a análise → Insumos → 'Alternativas', escolha 'Não serve' e escreva o motivo. O grupo sempre fica com pelo menos uma.",
          "Laboratório, Coordenador, Supervisor e Administrador registram essa decisão; cada registro fica no histórico e na Auditoria. Trocar o insumo da linha zera a avaliação.",
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
    termos: ["ensaio", "exame", "catálogo", "método", "matriz", "nova análise", "duplicar", "inativar", "reativar", "desativar", "alternativa", "grupo de escolha", "sem preço"],
  },
  {
    id: "insumos-por-analise",
    titulo: "Insumos por análise",
    grupo: "Análises e custeio",
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
    grupo: "Análises e custeio",
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
          "Os fatores de preço (margem, impostos, taxas e fundos) ficam em Análises e custeio → Parâmetros de custeio (gestor ou acima).",
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
      {
        titulo: "Equipamento de parceiro",
        itens: [
          "Quando a análise usa equipamento de outra instituição que cobra por amostra, cadastre o equipamento em Cadastros → Equipamentos e preencha 'Custo do parceiro por amostra'.",
          "O valor entra no custo de equipamento da análise (valor × peso do vínculo na aba Equipamentos da análise).",
          "Se o valor ainda não foi confirmado, marque 'Valor do parceiro é estimativa' e diga de onde veio; a análise mostra o aviso até a confirmação.",
        ],
      },
      {
        titulo: "Resolver custo pendente no orçamento",
        itens: [
          "Se aparecer custo pendente em 'Novo orçamento' ou em 'Parâmetros econômicos', não trate a falta de base como custo zero nem use a prévia incompleta como total da proposta.",
          "Abra a ficha em Análises e confira os insumos usados. Verifique o preço, a unidade cadastrada e a conversão para a unidade de consumo. Em Custeio, confira o custo da análise antes de voltar ao orçamento.",
        ],
      },
    ],
    termos: ["custo", "preço", "margem", "overhead", "simulação", "salário", "remuneração", "parâmetros de custeio"],
  },

  // ──────────────────────────── Suprimentos ────────────────────────────
  {
    id: "suprimentos",
    titulo: "Suprimentos: visão geral",
    grupo: "Suprimentos",
    href: "/suprimentos",
    resumo: "O que espera você e o que temos em estoque.",
    intro:
      "A visão geral de Suprimentos responde duas perguntas: o que espera a sua ação e o que temos disponível em estoque. Cada assunto do módulo tem um lugar só, na barra de cima: Visão geral, Estoque, Planejamento, Pedidos, Recebimento e Equipamentos.",
    secoes: [
      {
        titulo: "Onde fica cada coisa",
        itens: [
          "Visão geral: a linha 'Sua vez', o total de pedidos em andamento e a tabela 'Estoque disponível'.",
          "Estoque: saldo e lotes, entradas e baixas. A barra do Estoque reúne Controle de Estoque, entrada e saída por leitura, inventário e etiquetas. Os códigos não reconhecidos ficam dentro de Entrada e saída por leitura, no botão ao lado do título, com o número dos que esperam cadastro.",
          "Planejamento: reservas de insumo para as análises previstas.",
          "Pedidos: cada pedido e a etapa em que está. Compras formais e Prazos de compra são abas dessa tela, logo abaixo da barra.",
          "Recebimento: registrar o que chegou. Equipamentos: calibração e manutenção.",
          "Notificações saíram desta barra: os avisos vêm de todos os módulos e abrem pelo sino, no topo de qualquer tela.",
        ],
      },
      {
        titulo: "Sua vez e pedidos em andamento",
        itens: [
          "A linha 'Sua vez' aparece só quando algo de Suprimentos depende de você: pedidos para aprovar (coordenador do projeto ou coordenação do laboratório), autorizar, cotar ou pagar, compras para receber, planos em rascunho, lotes em quarentena, disputas de reserva, códigos lidos sem cadastro e manutenção vencida. Clique para abrir o registro ou a lista. O quadro completo, 'Aguardando você', fica no Início e no sino.",
          "O total de pedidos em andamento leva a Pedidos, onde cada uma das seis etapas (solicitação, aprovação, administrativo, cotação, compra e entrega, pagamento) abre a sua lista.",
          "As seis etapas são as mesmas na lista de Pedidos e na página de cada pedido.",
        ],
      },
      {
        titulo: "Estoque disponível",
        itens: [
          "Uma linha por insumo ativo: disponível (em mãos menos o reservado), reservado, a caminho, mínimo, validade mais próxima e situação.",
          "Os botões acima da tabela filtram por situação: repor, sem estoque, vencido ou vencendo e em dia. As regras são as mesmas do Controle de Estoque.",
          "O número em cada botão diz quantos insumos estão naquela situação; o aviso de reposição da página inicial já abre a tabela filtrada.",
          "Para dar entrada, baixa ou ver os lotes, use o Estoque.",
        ],
      },
    ],
    termos: ["visão geral", "disponível", "a caminho", "mínimo", "repor", "onde fica", "navegação", "menu", "aguardando você", "andamento", "etapas"],
  },
  {
    id: "estoque",
    titulo: "Estoque",
    grupo: "Suprimentos",
    href: "/estoque",
    resumo: "Saldos, lotes, validade e reposição.",
    intro:
      "O Estoque controla o material guardado no almoxarifado, por lote, com validade e rastreio. A entrega ao laboratório é a baixa definitiva: o Kontrol não acompanha o uso depois disso. As saídas alimentam a previsão de reposição, que avisa com antecedência considerando a demora das compras da universidade. A regra FEFO (o que vence primeiro sai primeiro) reduz perdas por vencimento.",
    secoes: [
      {
        titulo: "Para que serve",
        itens: [
          "Acompanhar saldos por insumo e por lote, com data de validade.",
          "Registrar a chegada: quem recebe cadastra o lote e ele já fica disponível, sem etapa de aceite.",
          "Apontar o que precisa ser comprado já, contando o prazo total da compra (tramitação na universidade + entrega) e o que está a caminho.",
        ],
      },
      {
        titulo: "Entrada de lote (+ Entrada)",
        itens: [
          "Na linha do insumo, clique em '+ Entrada' e informe quantidade, validade e o número do lote do fabricante.",
          "O número do lote também pode ser informado no cadastro do insumo (Cadastros → Insumos → Lotes em estoque → '+ Entrada').",
          "O lote entra disponível na hora. Material com validade vencida não entra.",
        ],
      },
      {
        titulo: "Baixa avulsa (Dar baixa)",
        itens: [
          "Use para material que sai fora de um plano: entrega ao laboratório, perda ou quebra, vencimento ou outro motivo.",
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
          "Para importar alterações, use Cadastros → 'Importar XLSX' (no topo do painel de insumos, ao lado de 'Cadastrar insumo'); escolher o arquivo já envia.",
        ],
      },
      {
        titulo: "Boas práticas",
        itens: [
          "Confira o material ao registrar a chegada: número do lote, validade e quantidade ficam no histórico.",
          "Fique atento aos itens vencendo — priorize o consumo deles (o que vence primeiro sai primeiro).",
          "Use o rastreio para saber em quais análises um lote foi utilizado.",
        ],
      },
      {
        titulo: "Equipamentos: calibração e manutenção",
        itens: [
          "Em Suprimentos → Equipamentos, cada aparelho físico é uma unidade, com patrimônio ou número de série. Use '+ Cadastrar unidade física' para incluir uma.",
          "Na ficha da unidade, 'Definir frequência e aviso' diz de quantos em quantos dias a calibração ou manutenção é feita e com quantos dias de antecedência avisar.",
          "Depois de cada serviço, use 'Registrar manutenção ou calibração'. Se o certificado traz a próxima data, informe-a; senão o Kontrol soma a frequência.",
          "Os avisos aparecem no topo da página quando o vencimento se aproxima e ficam lá até alguém agendar o serviço ou clicar em 'Encaminhar' e dizer o que foi decidido.",
          "Nada é bloqueado sozinho. Registrar exige a permissão de editar cadastros.",
        ],
      },
      {
        titulo: "Consumo mensal",
        itens: [
          "Na página do Estoque, clique em 'Consumo mensal' (ao lado de 'Saldo por insumo' e 'Lotes em estoque'), escolha o insumo e clique em 'Ver consumo'.",
          "O Kontrol soma sozinho as saídas de cada mês completo dos últimos 12 meses. Ajustes de inventário não contam como consumo.",
          "A confiança sobe com o histórico: alta com 6 meses ou mais, saída em pelo menos 4 deles e consumo parecido de um mês para outro.",
          "O consumo de referência é o calculado quando a confiança é alta. Antes disso, vale a estimativa manual em embalagens por mês, se alguém a registrou.",
          "Uma nova estimativa manual não apaga as anteriores. Os limites do cálculo ficam em Parâmetros.",
          "Quando o insumo tem prazo de compra e as unidades conferem, o painel mostra quanto falta para cobrir o prazo com o consumo de referência (inclusive a estimativa manual), já descontando o disponível e os pedidos abertos.",
        ],
      },
      {
        titulo: "Conferir saldo e estoque físico",
        itens: [
          "Saldo registrado zero significa que o sistema mostra zero naquele registro. Saldo não conferido ou indisponível significa que ainda não dá para afirmar a quantidade. Nenhum dos dois substitui a contagem do estoque físico.",
          "Para conferir o material no local, vá a Suprimentos → Estoque → Inventário. Registre a contagem do item ou lote e compare com o saldo do sistema, conforme seu acesso.",
        ],
      },
    ],
    termos: ["saldo", "lote", "validade", "fefo", "calibração", "manutenção", "equipamento", "consumo mensal", "estimativa", "confiança", "reposição", "rastreio", "entrada", "saída", "dar baixa", "baixa avulsa", "perda", "quebra", "descarte", "vencido", "número do lote", "planilha", "excel", "importar"],
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
          "Clique em 'Novo plano', no topo da lista, informe projeto e período e adicione as análises (só as ativas aparecem) com nº de amostras, controles e repetições.",
          "Na lista, 'Ver' e 'Editar' ficam à vista; excluir ou cancelar um plano fica no menu '…' da linha e dentro do próprio plano, sempre com motivo.",
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
          "Na coluna de falta aparece 'Mesmo tipo com saldo' quando outra marca ou apresentação do mesmo tipo técnico tem estoque. Trocar o insumo da análise é decisão sua; o aviso só mostra que existe a alternativa.",
        ],
      },
      {
        titulo: "Falta que outro plano segura (disputa de reserva)",
        itens: [
          "Se o plano reservado ficou com falta e outro plano reservado segura o mesmo insumo, use 'Pedir reserva de outro plano' na página do plano e diga o motivo.",
          "Coordenador, Supervisor ou Administrador decide na aba 'Disputas de reserva' do Planejamento: transferir (escolhendo o plano que cede) ou negar, sempre com o motivo. A aba mostra quantas disputas esperam a sua decisão, o mesmo número do sino. O Gestor identifica a falta e pede a reserva, mas não decide.",
          "A transferência move a reserva lote por lote, validade mais curta primeiro; embalagem fechada vai inteira. O plano que cede fica com a falta e precisa repor ou reservar de novo antes de iniciar.",
          "Se duas pessoas decidirem ao mesmo tempo, só a primeira vale. Quem pediu recebe o aviso da decisão, e tudo fica na Auditoria.",
        ],
      },
    ],
    termos: ["demanda", "reserva", "previsão", "plano", "consumo", "disputa", "transferir reserva", "falta"],
  },
  {
    id: "pedido",
    titulo: "Pedidos",
    grupo: "Suprimentos",
    href: "/pedido",
    resumo: "Do pedido ao pagamento, num acompanhamento só.",
    intro:
      "Pedidos é onde a equipe registra o que precisa comprar (materiais, serviços ou equipamentos) e acompanha cada pedido até o pagamento. Cada pedido tem número próprio e passa por seis etapas. A tela sempre mostra com quem ele está, o que falta e o motivo de qualquer bloqueio.",
    secoes: [
      {
        titulo: "Para que serve",
        itens: [
          "Registrar a necessidade de materiais, serviços e equipamentos e acompanhar até o pagamento.",
          "Organizar a fila de pedidos com numeração sequencial única (Nº 0001, 0002…), que nunca se repete.",
          "Conduzir cada pedido pelas seis etapas: solicitação, aprovação, administrativo, cotação, compra e entrega, e pagamento.",
          "Na lista, os cartões das etapas mostram quantos pedidos há em cada uma; clique num cartão para ver só os pedidos dela. 'Em andamento', 'Concluídos', 'Cancelados' e 'Todos' trocam o conjunto.",
          "Cada linha mostra a barra das etapas (verde = cumprida, amarelo = atual), o status por escrito e o próximo passo, com quem está.",
        ],
      },
      {
        titulo: "Regras e exceções em resumo",
        itens: [
          "Ciclo de compras: o que a coordenação aprova até o dia 10 entra no ciclo do mês. Dia 10 no sábado ou no domingo vale até a segunda. Depois do prazo, o pedido fica para o ciclo seguinte e só segue no dia 1. Feriado ainda não entra na conta.",
          "Urgência Alta ou Crítica fura o ciclo, com justificativa por escrito.",
          "Quem aprova: o coordenador do projeto. Sem projeto, a Supervisão. Na ausência, o Administrador, com registro. Material de consumo de laboratório passa também pela coordenação do laboratório.",
          "Todo pedido precisa de 3 orçamentos de fornecedores diferentes. Não há dispensa por tipo de despesa.",
          "Pedido devolvido e reenviado: a aprovação continua valendo só se itens, valor, justificativa e projeto não mudaram.",
          "Pagamento: produto depois da entrega, serviço depois da prestação, diária antes da viagem. Outra exceção só com acordo registrado no pedido.",
          "Produto controlado (clorofórmio, acetona) só pela FUNPAR, em projeto com recurso na fundação.",
          "\"A caminho\" conta só o que foi comprado ou autorizado. Pedido que ainda espera aprovação aparece à parte e não garante entrega.",
        ],
      },
      {
        titulo: "Onde o coordenador aprova",
        itens: [
          "O pedido enviado aparece para quem aprova em 'Aguardando você', no Início e no sino do topo, e na linha 'Sua vez' da visão geral de Suprimentos e de Pedidos. O coordenador também recebe um aviso em Notificações e por e-mail.",
          "Clique no nome do pedido para abrir. Logo abaixo do cabeçalho ficam a trilha das seis etapas e o quadro 'O que falta agora', com o próximo passo, com quem está e o que vem depois.",
          "Quando o passo depende de você, o quadro mostra 'Sua vez' e os botões ficam ali mesmo: 'Aprovar pedido' ou 'Devolver ao solicitante' (com o motivo). Os itens para conferir ficam logo abaixo.",
          "Quem não é o responsável vê 'Aguardando aprovação' e o nome de quem aprova. O Administrador pode aprovar na ausência do coordenador, e isso fica registrado.",
        ],
      },
      {
        titulo: "Criando e consultando",
        itens: [
          "Clique em 'Novo pedido' e preencha título, projeto, tipo de material ou despesa, objetivo, urgência e justificativa. A fonte é só uma sugestão: quem define fonte e rubrica é o administrativo.",
          "Ciclo de compras: o que a coordenação aprova até o dia 10 entra no ciclo do mês; depois disso, no ciclo seguinte. Vale a data da última aprovação da coordenação (a do coordenador do projeto e, em material de laboratório, a da coordenação do laboratório). Se o dia 10 cair no sábado ou no domingo, o prazo vai para a segunda. Feriado ainda não entra na conta. O pedido mostra a data da solicitação, a da aprovação e o ciclo.",
          "Pedido do ciclo seguinte fica travado em 'Validado': o administrativo só formaliza a partir do dia 1 do mês do ciclo. O pedido mostra a data, ele não aparece em 'Aguardando você' antes disso, e no dia 1 o responsável do administrativo recebe um aviso. A urgência só muda com o pedido em rascunho ou devolvido para ajuste.",
          "Urgência Alta ou Crítica fura o ciclo do dia 10 e exige justificativa por escrito (por que não pode esperar o próximo ciclo).",
          "Pedido sem projeto é validado pela Supervisão. Material de consumo de laboratório pede também o laboratório (Genética, LAPOA, LHM, LQA, Campo...).",
          "Na lista, o botão 'Itens (N)' abre um resumo rápido do que está sendo solicitado, sem precisar abrir o pedido.",
          "A coluna 'Nº' mostra o número sequencial do pedido; clique para abrir o detalhe completo.",
        ],
      },
      {
        titulo: "Editando itens e o pedido",
        itens: [
          "Em 'Materiais e serviços', use 'Adicionar item' para incluir cada material/serviço (especificação, modelo, volume, quantidade e orçamento prévio).",
          "Cada item tem 'Editar' (abre um formulário preenchido) e 'Remover'.",
          "Antes da compra, o item mostra 'Já há no estoque, mesmo tipo' quando outra marca ou apresentação do mesmo tipo técnico tem saldo. Vale conferir antes de comprar.",
          "Ao escolher um insumo existente, o pedido mostra o disponível, o reservado para planos, o que já está pedido e a caminho (com atraso, se houver) e onde o insumo está guardado. Confira antes de pedir de novo.",
          "Itens ficam livres para alteração em rascunho/ajuste; coordenador ou superior também pode alterá-los nas demais etapas, exceto quando o pedido está cancelado ou concluído.",
          "No topo do pedido, 'Editar' altera os dados gerais e 'Excluir' apaga o pedido inteiro (apenas coordenador+).",
        ],
      },
      {
        titulo: "Fluxo de aprovação",
        itens: [
          "Envie para aprovação quando o pedido estiver completo; o que falta aparece destacado.",
          "Pedido devolvido para ajuste: corrija e use 'Reenviar'. Se itens (item, quantidade e especificação), valor, justificativa e projeto continuarem iguais aos da aprovação, as aprovações continuam valendo e o pedido volta direto para onde parou (a coordenação do laboratório, se foi ela que devolveu). Se algum deles mudou, passa de novo pelo coordenador: a aprovação antiga não vale para um objeto diferente. O pedido avisa antes, por escrito, o que vai acontecer.",
          "O quadro 'Quem aprova' mostra, por escrito, quem aprova e em que situação está cada etapa. Se o projeto não tiver coordenador cadastrado (ou o laboratório não tiver coordenação), o envio trava com a explicação.",
          "Só o coordenador do projeto aprova; sem projeto, a Supervisão. Na ausência, o Administrador aprova como substituto e fica registrado.",
          "Material de consumo de laboratório passa depois pela coordenação do laboratório, que aprova ou devolve com motivo. Só então o pedido segue para compras. O substituto cadastrado também decide.",
          "Após validado (e aprovado pelo laboratório, quando for o caso), formalize em Compras para gerar o pedido formal.",
          "Toda compra tem 3 orçamentos de fornecedores diferentes (inclusive FUNPAR e Petrobras). Registre cada um no quadro 'Orçamentos' do pedido, com valor, prazo e o documento anexado. 'Marcar cotações recebidas' só libera com os 3.",
          "Antes da aprovação final, escolha um orçamento. Se não for o de menor valor, escreva a justificativa (prazo, qualidade, exclusividade). Quem escolheu, quando e por quê ficam registrados, e o fornecedor escolhido vai para a compra.",
          "Caminho único: a compra formal ligada ao pedido é aprovada junto com ele, quando o pedido chega a 'Aprovado para compra'. Não há segunda aprovação em Compras.",
          "Pagamento só depois da entrega: materiais e equipamentos precisam ter a chegada registrada; serviço precisa de 'Confirmar entrega (serviço prestado)'. Diária é paga antes da viagem.",
          "Pagar antes da entrega só com acordo específico: 'Registrar exceção (pagar antes)' pede o acordo por escrito (com quem, o quê e por quê) e fica registrado com quem e quando.",
          "Acompanhe documentos, comunicações, aprovações e a linha do tempo dentro do pedido.",
        ],
      },
      {
        titulo: "Produtos controlados (clorofórmio, acetona)",
        itens: [
          "A ATGC não tem licença para comprar produto controlado. A compra só sai pela FUNPAR, em projeto com recurso na fundação.",
          "Essa trava é uma regra operacional do laboratório. Ela não comprova o atendimento às exigências legais do produto: isso continua com a FUNPAR e com os responsáveis.",
          "O pedido mostra a faixa 'Produto controlado' quando algum item é controlado: o insumo marcado em Cadastros > Insumos ou, sem insumo escolhido, um item com clorofórmio ou acetona no nome.",
          "Pedido com controlado precisa de projeto. Na autorização administrativa a fonte do recurso tem que ser a FUNPAR (o campo já vem preenchido).",
          "Não pode ser compra direta: 'Fechar com fornecedor' fica bloqueado. Use 'Encaminhar à instituição', com destino FUNPAR.",
          "Compra avulsa (em Compras, sem pedido) com item controlado não é aprovada. Faça pelo Pedido e cancele a compra avulsa.",
        ],
      },
    ],
    termos: ["solicitação", "demanda interna", "material", "serviço", "compra", "numeração", "itens", "editar", "excluir", "pagamento", "entrega", "exceção", "orçamentos", "cotações", "fornecedor", "ciclo", "dia 10", "ciclo seguinte", "trava", "urgência", "devolução", "reenviar", "ajuste", "controlado", "clorofórmio", "acetona", "funpar"],
  },
  {
    id: "compras",
    titulo: "Compras",
    grupo: "Suprimentos",
    href: "/compras",
    resumo: "A compra formal de cada pedido: fornecedor, envio e recebimento.",
    intro:
      "A compra formal é o registro da compra feita ao fornecedor. Ela nasce de um pedido aprovado (ou da reposição automática) e segue com ele: aqui você acompanha o envio ao fornecedor e registra o recebimento, que põe o material no Estoque. Fica em Suprimentos → Pedidos → Compras formais.",
    secoes: [
      {
        titulo: "Para que serve",
        itens: [
          "Acompanhar a compra depois que o pedido foi aprovado: fornecedor, envio e recebimento.",
          "Reunir as compras formais, inclusive as geradas por reposição automática.",
          "Registrar a entrada de itens, que já ficam disponíveis no Estoque.",
          "No Painel de insumos, o quadro 'A caminho' lista as compras feitas e não recebidas: quanto foi pedido, recebido e falta receber, a previsão (informada na compra ou estimada pelo prazo) e os atrasos.",
        ],
      },
      {
        titulo: "Passo a passo",
        itens: [
          "Abra a compra pelo pedido (botão 'Formalizar em compras') ou na aba 'Compras formais' de Pedidos. Para registrar uma compra avulsa, use 'Nova compra', no topo da lista.",
          "Confira fornecedor, itens e quantidades e envie ao fornecedor.",
          "Ao chegar, receba os itens pelo próprio pedido para dar entrada no estoque.",
          "Se faltar algo, encerre com pendência e escolha o destino: comprar de novo, desistir ou atendido de outra forma.",
        ],
      },
      {
        titulo: "Boas práticas",
        itens: [
          "A compra ligada a um pedido é aprovada junto com ele, sem segunda aprovação aqui. Compra criada direto em Compras ainda passa pela aprovação administrativa.",
          "Aproveite os rascunhos automáticos para não esquecer reposições críticas.",
          "Receba sempre pela compra ou pelo pedido, assim o rastreio do lote fica completo.",
          "Cheque divergências de quantidade no recebimento antes de fechar o pedido.",
          "Registrou um recebimento por engano? Use 'Estornar' ao lado do item. O app mostra o que será desfeito e pede confirmação: o lote sai do estoque e o item volta a ficar pendente.",
        ],
      },
      {
        titulo: "Prazos de compra (ATGC, Funpar e outros caminhos)",
        itens: [
          "Na aba 'Prazos de compra' de Pedidos, veja quanto tempo as compras levaram, do envio do pedido interno para validação até o recebimento.",
          "O prazo aparece por caminho (Funpar, compra direta ATGC, universidade...), por categoria e por insumo, com o número de compras medidas e a confiança.",
          "Curto: metade das compras chegou até ali. Intermediário: 3 de cada 4. Conservador: 9 de cada 10. Para insumo crítico, planeje pelo conservador.",
          "Pedido aberto, atrasado ou cancelado não entra na conta. Informe a instituição ou a modalidade no pedido para o caminho sair certo.",
        ],
      },
    ],
    termos: ["fornecedor", "recebimento", "aprovação", "pedido de compra", "prazo", "funpar", "lead time", "tempo de compra"],
  },

  // ───────────────────────────── Orçamentos ────────────────────────────
  {
    id: "orcamento-demandas",
    titulo: "Criar e revisar um orçamento",
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
        titulo: "Criar e revisar antes de emitir",
        itens: [
          "Registre o que o cliente solicitou e o contexto.",
          "Complemente com escopo e prazo para calcular o orçamento.",
          "Criar o orçamento não emite a proposta. Revise os custos e, quando a etapa se aplicar, confira os Parâmetros econômicos antes de seguir para Proposta final.",
          "A emissão é uma ação separada na etapa Proposta final. Para consultar uma versão já emitida, use o Histórico de Orçamentos.",
        ],
      },
      {
        titulo: "Conferir um salvamento sem confirmação",
        itens: [
          "Ao editar em 'Dados do orçamento', se a tela avisar que não foi possível confirmar o salvamento, os campos continuam nesta aba. Confira o registro em outra aba antes de tentar novamente: a falta de confirmação não diz se a alteração foi gravada.",
          "Se aparecer 'Alterações não enviadas' por falta de conexão, não houve envio. Mantenha o formulário aberto e tente novamente quando houver conexão.",
        ],
      },
    ],
    termos: ["lead", "cliente", "proposta", "demanda comercial", "criar orçamento sem emitir", "salvamento não confirmado"],
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
          "Emita a proposta. Depois da aprovação, o Coordenador recebe um aviso e cria o planejamento pelo botão 'Gerar planejamento desta proposta'; nada é criado sozinho.",
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
    id: "orcamento-historico",
    titulo: "Consultar uma proposta já emitida",
    grupo: "Orçamentos",
    href: "/orcamento/historico",
    resumo: "Localize a versão emitida, abra o documento e compare com a anterior.",
    intro:
      "Consulte os custos, parâmetros e valores gravados na emissão. Não recalcule esses valores com os cadastros atuais: eles podem ter mudado desde então.",
    secoes: [
      {
        titulo: "Passo a passo",
        itens: [
          "Em 'Histórico de Orçamentos', busque por 'Número, título ou cliente' e clique em 'Filtrar'. Confira a versão (v1, v2…) e a data de emissão.",
          "Clique no número da proposta ou abra 'Detalhes' → 'Abrir / PDF' para consultar a emissão.",
          "Se houver uma versão anterior disponível, abra 'Detalhes' → 'Comparar com a anterior' para ver as duas lado a lado.",
        ],
      },
      {
        titulo: "Se não encontrar a proposta",
        itens: [
          "Use 'Limpar' se houver filtros ativos. Confira os dados da busca, se a proposta chegou a ser emitida e se você tem acesso a ela.",
        ],
      },
      {
        titulo: "Ajustar taxas de uma proposta já enviada",
        itens: [
          "A versão enviada não muda: valores, taxas e memória de cálculo ficam congelados na emissão, e nem o banco aceita alterá-los.",
          "Para mudar impostos, incubação, fundos ou lucro, ajuste os parâmetros na própria proposta e emita de novo. Sai uma nova versão (v2, v3…) e a anterior fica como 'substituída', com o link antigo desativado.",
          "Use 'Comparar com a anterior' para mostrar ao cliente o que mudou entre as versões.",
        ],
      },
    ],
    termos: ["histórico", "proposta emitida", "versão anterior", "segunda via", "PDF", "nova versão", "ajustar taxa", "reemitir"],
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
          "Fica em Orçamentos → Configurações, ao lado de Documento da proposta e Modelos e catálogo.",
          "Garantir consistência de preços entre todos os orçamentos.",
        ],
      },
      {
        titulo: "Boas práticas",
        itens: [
          "Revise os parâmetros antes de emitir orçamentos em lote.",
          "Lembre-se: mudanças aqui afetam novos orçamentos, não as propostas já emitidas.",
          "Para uma proposta só, ajuste as taxas dentro dela, na etapa de parâmetros. Se ela já foi enviada, a mudança vale na próxima versão emitida.",
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
        titulo: "Painel de insumos",
        itens: [
          "O painel usa o mesmo saldo da tela de Estoque. Ele mostra o que está registrado no sistema, que pode diferir do que está na prateleira até alguém conferir.",
          "Crítico no sistema é o disponível abaixo do ponto de reposição, inclusive zero. Zero sem ponto de reposição aparece em Sem mínimo definido.",
          "Saldo não conferido significa que não há dado de saldo nesta leitura. Saldo indisponível indica falha de leitura ou valor inválido. Confira no Inventário, em Estoque, se você tiver acesso.",
          "Repor é uma sugestão para análise: considera consumo, pedidos abertos e prazo cadastrado. Não gera compra automática nem garante a data de chegada.",
          "Filtre os alertas por categoria de compra ou categoria curta. O gráfico de movimentos conta registros dos últimos 12 meses e fica indisponível se a leitura estiver incompleta.",
        ],
      },
      {
        titulo: "Passo a passo",
        itens: [
          "A barra de Cadastros tem 4 grupos: Materiais (insumos, tipos técnicos, equipamentos, previsão de equipamentos e locais), Pessoas e áreas (técnicos, laboratórios e áreas, responsáveis por etapa), Comercial (clientes, projetos e fornecedores) e Custos (overhead). O grupo abre o primeiro cadastro; as abas logo abaixo levam aos outros.",
          "Os mesmos grupos aparecem em 'Todos os cadastros', no fim do painel de insumos, e a busca (Ctrl+K) abre qualquer cadastro pelo nome.",
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
        titulo: "Laboratório dono, almoxarifados e controlados",
        itens: [
          "O estoque é um só. Na ficha do insumo, 'Laboratório dono' diz de qual laboratório ele é, e 'Local' diz onde está guardado (laboratório, Almoxarifado geral ou Almoxarifado do LGA).",
          "Marque 'Produto controlado (só pela FUNPAR)' nos insumos que exigem licença, como clorofórmio e acetona. O pedido de compra com esse insumo só segue pela FUNPAR.",
          "Os locais ficam em Cadastros > Locais, com o tipo Laboratório ou Almoxarifado.",
        ],
      },
      {
        titulo: "Previsão de equipamentos",
        itens: [
          "Em Cadastros > Previsão de equipamentos, liste o que o laboratório pretende comprar, com prioridade (1 alta, 2 média, 3 baixa), quantidade, valor estimado, justificativa e 'Patrimônio de' (de quem o equipamento será).",
          "Quem aprova pedidos (pedido.aprovar) cadastra e edita; todos veem.",
          "Ao ligar a previsão a um pedido interno, ela passa a 'Pedido'. Pedido concluído vira 'Comprado'; pedido cancelado volta a 'Previsto'.",
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
          "Confira Qualidade dos cadastros, no cartão do topo de Cadastros: ele mostra quantas pendências existem e a tela lista o que falta e pode distorcer custo ou compra.",
        ],
      },
    ],
    termos: ["cadastro", "projeto", "cliente", "fornecedor", "equipamento", "técnico", "local", "overhead", "salário", "remuneração", "lote", "planilha", "excel", "importar", "almoxarifado", "laboratório dono", "controlado", "previsão de equipamentos", "patrimônio"],
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
          "Para orçamentos, Governança → Regras do orçamento mostra quem pode fazer cada ação sensível e quem alterou cada campo.",
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
      {
        titulo: "Restaurar e testar a cópia",
        itens: [
          "Uma cópia só vale se restaurar. Teste de vez em quando num banco descartável, nunca em cima da produção.",
          "Ao restaurar, as tabelas do Kontrol, as regras de acesso e o histórico voltam. Agendamentos automáticos do banco e segredos guardados no cofre do Supabase precisam ser recriados à parte.",
          "Confira depois da restauração: número de insumos, lotes, movimentações e registros da Auditoria.",
        ],
      },
    ],
    termos: ["backup", "cópia", "restauração", "restaurar", "segurança", "recuperar"],
  },
  {
    id: "usuarios",
    titulo: "Usuários",
    grupo: "Governança",
    href: "/usuarios",
    resumo: "Quem acessa o Kontrol, em que função, com assinatura e senha provisória.",
    intro:
      "Aqui você gerencia quem acessa o sistema, a função de cada pessoa, assinaturas e senhas. O que cada função pode fazer fica em Governança → Privilégios; aqui você só ajusta uma pessoa específica.",
    secoes: [
      {
        titulo: "Funções",
        itens: [
          "Laboratório: operação do dia a dia (análises, retiradas, baixas, pedidos e recebimentos). Antes se chamava Técnico.",
          "Compra: acompanha o que falta, solicita, conduz e recebe compras.",
          "Cadastro: mantém cadastros, insumos e projetos.",
          "Coordenador: valida, aprova e faz orçamentos.",
          "Gestor: tudo do coordenador mais parâmetros econômicos, fundos, modelos e Auditoria.",
          "Supervisor: acima de Coordenador e Gestor; começa com as permissões do Gestor e não precisa estar ligado aos projetos.",
          "Administrador: controle total, incluindo usuários, privilégios e backups.",
        ],
      },
      {
        titulo: "Quem atua em cada projeto",
        itens: [
          "Coordenador e Gestor só alteram um projeto e só validam pedidos internos dele se estiverem ligados ao projeto ou forem o coordenador cadastrado.",
          "Na página do projeto, em 'Quem atua neste projeto', o Administrador liga ou desliga cada pessoa.",
          "Em Cadastros > Laboratórios e áreas, o Administrador indica a coordenação de cada laboratório e o substituto.",
          "Quem cria um projeto já fica ligado a ele. Ver os projetos continua igual para todos.",
        ],
      },
      {
        titulo: "Como usar",
        itens: [
          "Clique em 'Novo usuário', no topo da lista, e escolha a função; a pessoa entra com senha provisória e troca no primeiro acesso.",
          "Use os três pontinhos para editar a função, ajustar permissões só daquela pessoa, enviar a assinatura, alterar a senha, suspender ou excluir.",
          "Para mudar o que uma função inteira pode fazer, use Governança → Privilégios.",
          "Toda segunda-feira, Coordenador, Gestor, Supervisor e Administrador recebem em Notificações (e por e-mail, quando configurado) o resumo da semana: insumos abaixo do mínimo ou vencidos, pedidos internos aguardando validação e manutenções de equipamento a vencer sem encaminhamento.",
        ],
      },
    ],
    termos: ["usuário", "função", "categoria", "papel", "perfil", "acesso", "assinatura", "senha"],
  },
  {
    id: "notificacoes",
    titulo: "Avisos e e-mails",
    grupo: "Governança",
    href: "/notificacoes",
    resumo: "O que chega no sino de Notificações e por e-mail, e para quem.",
    intro:
      "O Kontrol avisa quando algo pede atenção: etapa esperando sua decisão, insumo abaixo do mínimo, lote vencendo, falta para um planejamento, incidente e outros avisos do sistema. Cada aviso vai para uma pessoa, para quem tem um privilégio ou para uma função e as acima dela.",
    secoes: [
      {
        titulo: "Onde ver",
        itens: [
          "O sino, no topo de qualquer tela, mostra o que está aguardando você e os avisos sem ler; o número soma os dois. A tela Notificações lista todos os avisos, com link para o registro de origem.",
          "Aprovações pendentes aparecem primeiro; depois faltas, reposições e vencimentos.",
          "Marque como lido quando tratar o aviso. Ele continua no histórico.",
        ],
      },
      {
        titulo: "Pedido de compra: quem é avisado em cada passagem",
        itens: [
          "Enviado para aprovação: o coordenador do projeto (sem projeto, a Supervisão). Material de consumo de laboratório: depois, a coordenação do laboratório.",
          "Formalizar, autorizar (fonte e rubrica), pedir os 3 orçamentos, escolher, aprovação final e fechar a compra: o responsável do administrativo. Sem responsável indicado, o Administrador.",
          "Entrega registrada e pagamento/nota fiscal: o responsável do pagamento. Sem responsável indicado, o Administrador.",
          "O solicitante é avisado quando o pedido volta para ajuste, é aprovado para compra, está a caminho, é concluído ou cancelado.",
          "Os responsáveis do administrativo e do pagamento (e os substitutos) são escolhidos pelo Administrador em Cadastros > Pessoas e áreas > Responsáveis por etapa.",
          "'Aguardando você', no Início e no sino, mostra só o que cabe a você decidir.",
        ],
      },
      {
        titulo: "E-mails",
        itens: [
          "Os avisos também saem por e-mail para as mesmas pessoas, com link direto para a tela certa. Nas passagens do pedido de compra o e-mail sai logo depois da ação; os demais saem no envio diário.",
          "Cada aviso é enviado uma vez só, mesmo que o envio seja repetido.",
          "Toda segunda-feira, Coordenador, Gestor, Supervisor e Administrador recebem um resumo da semana: insumos abaixo do mínimo ou vencendo, pedidos em validação e equipamentos com calibração ou manutenção vencida.",
        ],
      },
    ],
    termos: ["notificação", "aviso", "sino", "e-mail", "email", "resumo semanal", "alerta", "lembrete", "responsável do pagamento", "administrativo"],
  },
  {
    id: "incidentes",
    titulo: "Incidentes",
    grupo: "Governança",
    href: "/governanca/incidentes",
    resumo: "Registrar o que atrapalhou o trabalho, avisar quem foi afetado e dizer o que fazer.",
    intro:
      "Um incidente é algo que atrapalha o uso do app ou do laboratório: sistema fora do ar, dado errado, equipamento parado, falta de energia. Todos veem os incidentes; Coordenador, Gestor, Supervisor e Administrador registram e acompanham.",
    secoes: [
      {
        titulo: "Como registrar",
        itens: [
          "Em Governança → Incidentes, preencha o que aconteceu, quem ou o que foi afetado e o que as pessoas devem fazer enquanto isso.",
          "Escolha quem recebe o aviso: todas as pessoas, ou só uma função e as acima dela. O aviso chega no sino de Notificações.",
          "Se a causa ainda não foi confirmada, deixe o campo em branco: a tela mostra 'Causa ainda desconhecida'. Não escreva palpite como causa.",
        ],
      },
      {
        titulo: "Acompanhamento",
        itens: [
          "Cada incidente tem a lista de passos: aberto, em andamento, resolvido (e reaberto, se voltar).",
          "Cada passo avisa as mesmas pessoas e pode trazer a causa confirmada ou uma nova orientação.",
          "Enquanto houver incidente em aberto, uma faixa vermelha no topo de todas as telas mostra o mais recente e o que fazer.",
          "Tudo fica na Auditoria; nada é apagado.",
        ],
      },
    ],
    termos: ["incidente", "problema", "falha", "pane", "fora do ar", "aviso", "ocorrência"],
  },
  {
    id: "privilegios",
    titulo: "Privilégios",
    grupo: "Governança",
    href: "/governanca/privilegios",
    resumo: "O que cada uma das seis funções pode ver e fazer, módulo por módulo.",
    intro:
      "Uma tabela com uma caixinha por função e privilégio, separada por módulo (Cadastros, Análises e custeio, Suprimentos, Orçamentos e Governança) em faixas alternadas. Caixinha marcada é pode; vazia é não pode.",
    secoes: [
      {
        titulo: "Como usar",
        itens: [
          "Marque ou desmarque as caixinhas e clique em Salvar alterações. Vale para todos da função.",
          "O administrador sempre tem tudo; a coluna dele não muda.",
          "Ajuste individual (Usuários → Editar) vale acima do padrão da função.",
        ],
      },
      {
        titulo: "Privilégios que merecem atenção",
        itens: [
          "'Ver salário dos técnicos': mostra salário e custo-hora dos técnicos. Padrão: somente administrador.",
          "'Editar análises': criar, duplicar, inativar e alterar análises. Padrão: coordenador ou acima.",
          "'Acessar Compras' e 'Acessar Recebimento': além da tela, liberam ver preços, fornecedores e valores pagos das compras. Sem nenhuma caixinha de compras (padrão da função Cadastro), a pessoa não vê compras nem pela tela nem pelo sistema.",
          "'Editar insumos' e 'Corrigir estoque' também permitem excluir insumos e lotes. Deixe marcadas só para quem pode apagar.",
        ],
      },
    ],
    termos: ["privilégio", "permissão", "função", "categoria", "papel", "matriz", "caixinha", "remuneração", "salário"],
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
          "Menu lateral: Início, Orçamentos, Projetos, Suprimentos, Análises e custeio, Cadastros, Governança e Ajuda. Cada um abre a sua barra, no topo da tela.",
          "Projetos reúne os orçamentos, planejamentos e compras de cada projeto.",
          "Barra do topo: à esquerda, os lugares do módulo aberto; à direita, a busca, o sino e a ajuda.",
          "Busca rápida: Ctrl K (ou a lupa) encontra qualquer tela, como Inventário, Etiquetas ou Parâmetros de custeio.",
          "Sino: o que está aguardando você e os avisos não lidos, de todos os módulos.",
          "Tabelas com busca e filtros: encontre registros nas filas sem rolar tudo.",
          "Tema claro/escuro: acompanha o sistema e pode ser alternado.",
        ],
      },
      {
        titulo: "Início",
        itens: [
          "'Aguardando você' vem primeiro: é o que depende da sua decisão. O mesmo quadro abre pelo sino, em qualquer tela.",
          "Cada número abre a lista completa daquele assunto.",
          "'Precisa de atenção hoje' junta numa lista só o que está vencido, sem validade, com compra sugerida ou vencendo.",
          "Os gráficos aparecem para Gestor, Supervisor e Administrador, e só quando há dados.",
        ],
      },
      {
        titulo: "Listas e formulários",
        itens: [
          "As listas abrem primeiro; para criar, use o botão 'Novo…' no canto direito do cabeçalho. O formulário abre logo abaixo, com o cursor no primeiro campo.",
          "Nas tabelas, clique no título de uma coluna para ordenar e use 'Compacta' para ver mais linhas. Ao rolar a tabela para o lado, a primeira coluna continua visível.",
          "Na linha, a ação mais comum fica à vista; excluir ou cancelar fica no menu '…', sempre com confirmação.",
          "Abas logo abaixo da barra do módulo levam às telas irmãs: por exemplo, Planos e Disputas de reserva em Planejamento.",
        ],
      },
      {
        titulo: "Ajuda na própria tela",
        itens: [
          "O '?' ao lado de um título explica aquela parte da tela em poucas linhas.",
          "O '?' no canto direito da barra do topo resume a tela atual e leva a esta Central.",
        ],
      },
    ],
    termos: ["atalho", "command palette", "busca", "tema", "navegação", "menu", "ctrl k", "ajuda"],
  },
];

export const AJUDA_GRUPOS = [
  "Orçamentos",
  "Suprimentos",
  "Análises e custeio",
  "Cadastros",
  "Governança",
  "Geral",
] as const;
