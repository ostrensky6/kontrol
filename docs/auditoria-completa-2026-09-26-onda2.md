# Auditoria completa do Kontrol: processos, cadastros, papéis e interface. 26/09/2026, segunda onda

Base: `main` 1.1.3 (commit `da9231c`), com as migrations 0001–0124 aplicadas. Esta auditoria complementa [auditoria-processos-2026-09-26.md](auditoria-processos-2026-09-26.md), que teve as ondas 1 a 3 publicadas na versão 1.1.1. Os itens antigos são citados pelo ID original (EST-n, ORC-n, PER-n, CAD-n, UI-n) e os novos recebem sufixo 2 (EST2-n, ORC2-n, PER2-n, CAD2-n, UI2-n).

## 0. Método e grau de evidência

| Marca | Significado |
|---|---|
| **[T]** | Testado **na interface real**. O app rodou em `next dev` contra o Supabase local (Docker, migrations até 0129), com login de administrador. Cada passo foi conferido também no banco. |
| **[S]** | Simulado no banco local, chamando as mesmas RPCs e políticas do app como técnico, coordenador e admin, dentro de transação revertida. |
| **[P]** | Conferido em produção **só por leitura**, com autorização do dono em 26/09. |
| **[C]** | Verificado no código, com arquivo e linha. |
| **[I]** | Inferido; precisa de confirmação. |

**O que mudou em relação à rodada anterior.** Agora o Docker publica as portas, então o app rodou de verdade contra o banco. Os fluxos de almoxarifado foram percorridos pela interface: cadastro de insumo, pedido interno, formalização, compra, recebimento, estorno, recebimento parcial, encerramento com pendência, aceite e baixa. Foram 12 defeitos que só a interface mostrou (§4, bloco INT).

**Limitações**
- Na interface, só o papel **admin** foi usado (login automático de desenvolvimento). Os outros papéis foram validados por simulação [S], em `supabase/tests/*.sql`.
- O banco local não tem os insumos das receitas das análises, por isso reagentes aparecem com custo zero nos orçamentos locais.
- O fluxo emissão → aprovação → plano automático → reserva → retirada foi validado por simulação [S] (testes 0122 e 0126) e pelos testes E2E simulados. Na interface real, o percurso foi até o orçamento laboratorial.
- Concorrência entre usuários foi avaliada pelo código (travas `FOR UPDATE`, `operacao_id`) e por reenvio duplo na interface. Não houve duas sessões simultâneas.
- Desempenho: nada foi medido. As hipóteses estão no §4.

---

## 1. Diagnóstico prioritário

Defeitos que impediam concluir processos, corrompiam dados ou deixavam a trilha falsificável. Todos estão corrigidos nesta onda.

| # | P | Problema | Evidência | Situação |
|---|---|---|---|---|
| 1 | **P0** | **Pedido interno com insumo não gravava.** O gatilho `preencher_unidade_item` da 0123 lia uma coluna que `pedidos_internos_itens` não tem. Ficavam travados: vincular insumo, "Comprar faltas", a reposição pelo Controle de Estoque, a formalização e o recebimento de itens vindos de pedido interno. | [S] erro `record "new" has no field "pedido_interno_item_id"`; [P] função idêntica em produção (md5) | **Em produção** desde 26/09 (0125, PR #41). Nenhum pedido interno tinha sido criado depois da 0123, então não houve dado afetado. |
| 2 | **P1** | **Duas travas de permissão da 0124 não existiam.** Qualquer técnico criava insumo pela triagem e disparava a reposição automática; a reposição também aceitava chamada sem login (`anon`). O remendo da 0124 procurava `\nbegin\n`, e os arquivos foram aplicados com quebra de linha CRLF. | [S] [P] | **Em produção** (0125). `.gitattributes` passou a forçar LF em `*.sql`. |
| 3 | **P1** | **A lista de insumos do pedido interno chegava vazia.** O insumo tem duas ligações com fornecedores (principal e alternativo), e a consulta `fornecedores(nome)` era recusada pelo PostgREST com PGRST201. Na prática, nenhum item de pedido interno era vinculado a insumo pela tela. O mesmo defeito deixava "Comprar faltas" sem fornecedor e ignorava o prazo na data prevista da compra. | [T] lista vazia; [S] resposta PGRST201 | Corrigido (INT-1) |
| 4 | **P1** | **Recebimento registrava mais do que chegou.** Depois de uma recusa (por exemplo, validade obrigatória), a quantidade voltava ao total pendente. Quem corrigia só a validade e confirmava registrava 3 frascos quando tinham chegado 2. | [T] lote de 3 com 2 digitados | Corrigido (INT-3) |
| 5 | **P1** | **Qualquer recusa do servidor apagava o formulário.** O React 19 limpa os campos ao fim de todo envio de `<form action>`, mesmo quando há erro. Afetava mais de 30 formulários: cadastros, orçamento, pedido, usuários, parâmetros etc. | [T] cadastro de projeto: "Verifique os campos" e todos os campos vazios | Corrigido (INT-4) |
| 6 | **P1** | **Item de pedido interno em frascos aparecia como mL e com preço 100× menor.** "3 frascos" virava "3 mL a R$ 5", e o total previsto dava R$ 15 em vez de R$ 1.500. | [T] + [S] (`quantidade_em = embalagem`, `unidade = mL`) | Corrigido (INT-2) |
| 7 | **P1** | **Edição e exclusão de item de compra depois do recebimento.** O livro de recebimento era apagado em cascata e o lote ficava sem origem. | [S] técnico alterou e excluiu item recebido | Corrigido (0127) |
| 8 | **P1** | **Proposta: versões duplicadas e aprovação vencida.** A v1 enviada continuava aprovável depois da v2; podia haver duas aprovadas, e o Fundos somava as duas. Proposta vencida era aprovada pelo link. | [S] | Corrigido (0126) |
| 9 | **P1** | **Incluir análise ou mudar a quantidade no orçamento laboratorial sempre falhava.** O técnico caía na tela genérica de erro. | [S] | Corrigido (0126) |
| 10 | **P1** | **O plano não refletia a proposta aprovada.** Ele lia os itens vivos do módulo, que ainda podiam ser apagados ou trocados depois da emissão. | [S] plano com Y=10 quando o aprovado era X=10 e Y=4 | Corrigido (0126) |
| 11 | **P1** | **Compra encerrada com pendência não chegava ao pedido interno.** O pedido ficava aberto para sempre. | [S]; [T] depois da correção | Corrigido (0127) |
| 12 | **P1** | **Trilha de aprovação falsificável.** Técnico inseria e apagava aprovações de pedido interno e alterava os campos de aprovação pela API. | [S] | Corrigido (0128) |
| 13 | **P1** | **Mudança de papel, permissão e suspensão sem auditoria.** | [S] `perfis` sem gatilho | Corrigido (0128) |

---

## 2. Mapa dos fluxos

### 2.1 Almoxarifado: da necessidade à baixa ([T] percorrido na interface)

| Etapa | Início e dados | Responsável | Estados | Registros | Encerramento | Ruptura encontrada → situação |
|---|---|---|---|---|---|---|
| Necessidade | Alerta de reposição, previsão (consumo × prazo + segurança − disponível − em compra), falta do plano, cron diário | Sistema; técnico | — | `notificacoes` (agora por destinatário) | Vira pedido interno ou rascunho de compra | Frações de frasco (EST2-2) e telas com unidades diferentes (INT-6) → corrigidos |
| Pedido interno | Título, projeto, justificativa, fonte, urgência, itens | Técnico cria; quem tem `pedido.aprovar` valida | rascunho → aguardando coordenador → aprovado → formalizado → etapas administrativas → compra recebida | Aprovações (só por RPC), eventos, auditoria | Recebimento concluído (inclusive com pendência) | P0 do gatilho; lista vazia (INT-1); mL × frasco (INT-2) → corrigidos. **Duas trilhas paralelas** (decisão D1) |
| Formalização | Pedido validado | `pedido.aprovar` | Cria a compra formal com os itens em frascos | `pedido_compra_id` | Compra em `solicitado` | Pedido devolvido depois de formalizado travava (item 13) → corrigido. Compra nasce sem fornecedor (INT-7) → aviso e seletor |
| Compra | Itens, fornecedor, custo | `compras.aprovar` | solicitado → aprovado → enviado → recebido / cancelado / encerrada com pendência | Eventos com motivo | 100% recebido ou encerrada com motivo | Itens editáveis depois do recebimento (EST2-9) → travados |
| Recebimento | Frascos recebidos, validade (obrigatória para crítico), código do lote, volume do frasco se diferente, local | **Técnico ou coordenador** (decisão de 26/09) | Lote novo em **quarentena** | Livro de recebimento, movimentação, evento | Item completo | Quantidade voltava ao total após erro (INT-3) → corrigido. Duplo clique não duplica [T] |
| Estorno | Motivo | `estoque.lote.gerir` | Lote descartado; compra volta a aguardar | Ajuste com motivo; livro marcado `estornado_em` | Pendente reaberto | Compra formal não tinha estorno (EST-2) → RPC bilateral [T] |
| Aceite | Responsável, critério (item crítico) | `estoque.lote.aceitar`; **quem recebeu não aceita** (admin isento) | quarentena → aceito | Auditoria | Lote disponível | Aceitava lote vencido → recusa |
| Reserva | Plano → demanda em frascos inteiros | Técnico | Plano rascunho → reservado | `reservas_estoque` | Consumida na retirada ou liberada | Reserva em lote vencido zerava o disponível (EST2-4) → liberada diariamente |
| Retirada / baixa | Plano ("Retirar insumos e iniciar") ou baixa avulsa com motivo | `planejamento.executar` / `estoque.movimentar` | Lote com saldo ou consumido | Saída com `operacao_id` e autor | Saldo | Duplo clique não duplica [T]. A baixa respeita a validade após abertura (EST-8) |
| Validade / descarte | Alertas com o lote, link "Baixar por vencimento" | Técnico baixa; gestor descarta | — | Ajuste com categoria | Lote zerado | Lote em quarentena vencido agora também alerta |

**Quando o saldo muda** [T]: comprar não altera o saldo; receber cria saldo em quarentena, fora do disponível; aceitar libera; reservar tira do disponível sem tirar do lote; retirar baixa em frascos inteiros; estornar zera o lote e reabre a compra.

### 2.2 Cadeia comercial → operação

| Etapa | Responsável | Encerramento | Ruptura → situação |
|---|---|---|---|
| Orçamento (dados, grupos de amostras, análises) | Técnico (`orcamentos.criar_editar`) | Dados completos | Matriz em texto livre recusada com mensagem crua (INT-9) → lista. Status editável à mão (UI-6) → saiu |
| Orçamento laboratorial | Técnico preenche; `orcamentos.emitir` revisa | Revisado | **Nascia vazio** (INT-10) → recebe as análises escolhidas. Incluir e alterar falhavam (ORC2-1) → RPC transacional |
| Emissão da proposta | `orcamentos.emitir` | Versão emitida, snapshot imutável | Snapshot sem código da análise (ORC2-2) → corrigido. Itens ficam travados depois da revisão |
| Link público / aprovação | Emissor gera o link; cliente ou equipe aprova | Aprovada | Link sumido da tela (ORC-2) → restaurado. Vencida aprovável (ORC-7) → recusa; job diário de vencimento |
| Versões | Emissor | Uma versão viva | Nova emissão substitui as não aprovadas e revoga links. Com aprovada, é preciso cancelar antes (decisão de 26/09) |
| Planejamento | Automático na aprovação (0122) ou "Gerar planejamento desta proposta" | Plano concluído | Plano excluído não se refazia (ORC2-7) → botão. Cancelar a proposta aprovada cancela o plano não iniciado e libera as reservas (decisão) |
| Projeto e Fundos | Gestor | — | KPIs somavam módulos em vez da proposta aprovada vigente (ORC-9, ORC2-6) → `v_proposta_aprovada_vigente` |

### 2.3 Passagens de responsabilidade

| Pendência | Quem resolve | Como fica sabendo agora |
|---|---|---|
| Pedido interno em validação | `pedido.aprovar` | Aviso por permissão (gatilho 0128) e bloco **"Aguardando você"** na página inicial [T] |
| Compra solicitada | `compras.aprovar` | Aviso e "Aguardando você" |
| Compra aprovada ou enviada | `compras.receber` (técnico incluído) | Aviso e "Aguardando você" |
| Lote em quarentena | `estoque.lote.aceitar` | Aviso e "Aguardando você" |
| Proposta pronta para emitir | `orcamentos.emitir` | Aviso e "Aguardando você" |
| Cliente aprovou pelo link | Coordenador | Aviso (0126) |

Notificações agora são **por usuário**: "marcar todas como lidas" vale só para quem clicou, e o e-mail vai para quem tem a permissão.

---

## 3. Cadastros

| Cadastro | Presente e necessário | Corrigido nesta onda | Continua pendente (motivo) |
|---|---|---|---|
| Insumo | especificação, unidade da embalagem, quantidade na embalagem, unidade de consumo, fator, criticidade, reposição, validade após abertura | Unidade e quantidade na embalagem **obrigatórias** (sem elas o insumo virava "volume"); campos sem uso fora do formulário (mantidos na planilha); validade e fabricação no bloco "Estoque inicial"; coluna Validade = menor validade dos lotes; aviso de embalagem sem custo | Falta "ativo" (a exclusão já é recusada com vínculo desde a 0120). A lista mostra "Unidade: mL" ao lado de uma quantidade em frascos (INT-11) |
| Lote | código, validade, quantidades, cópia da embalagem, status, **quem recebeu** (0127) | Local e volume do frasco aceitos no recebimento; estorno bilateral | Código do lote repetido por insumo é permitido de propósito, porque recebimento parcial e duas entregas do mesmo lote de fábrica geram lotes separados (decisão D6) |
| Local | nome, tipo | "Fica dentro de" editável; a edição não apaga mais a hierarquia (CAD-6); exclusão com vínculo recusada | — |
| Fornecedor / Cliente | nome, CNPJ, contatos, ativo | Seletores só com ativos; exclusão com vínculo recusada (antes punha NULL nos pedidos) | Validação de CNPJ e unicidade de nome (P3) |
| Projeto | nome, cliente, status, datas | Fim antes do início recusado (tela e banco) | Quatro campos para o coordenador (decisão D3) |
| Técnico | salário (protegido pela 0112), horas, dedicação | Coluna `ativo`: desligado sai do custo/hora | — |
| Tipo técnico, equipamento | — | Escrita por permissão (`cadastros.editar`); auditoria | — |
| Parâmetros | margem, impostos, fundos | `/parametros` só consulta os econômicos e leva a `/orcamento/parametros`, que versiona (CAD-4); auditoria na tabela | — |
| Importação | — | Ordem de dependência; "1" não vira mais 100% | Pai de local criado na mesma planilha |

---

## 4. Tabela de achados

As colunas são: local; comportamento atual → esperado; evidência; impacto; prioridade; correção. A marca ✅ indica que o item foi corrigido e testado nesta onda.

### 4.1 Defeitos encontrados testando a interface real (INT)

| ID | Local | Atual → esperado | Evidência | Impacto | P | Correção |
|---|---|---|---|---|---|---|
| INT-1 | `pedido/[id]/page.tsx`, `compras.ts` | Lista de insumos vazia (PGRST201) → lista com os insumos | [T] [S] | Pedido interno nunca vinculado a insumo | P1 | ✅ `fornecedores!insumos_fornecedor_id_fkey` nas 3 consultas |
| INT-2 | `PedidoItemCamposAssistidos.tsx`, `pedido/[id]` | Item em frascos com "mL" e custo por mL → "frasco", R$ por frasco, "3 frascos de 100 mL" | [T] total R$ 15 → R$ 1.500 | Previsão de gasto 100× menor | P1 | ✅ |
| INT-3 | `ScannerRecebimentoCompra.tsx`, `ReceberItemPedidoInterno.tsx` | Quantidade voltava ao total após erro → mantém o digitado | [T] | Estoque maior que o físico | P1 | ✅ campos controlados; erro com `role="alert"` |
| INT-4 | 30+ formulários | Recusa do servidor apagava tudo → mantém | [T] | Retrabalho e desistência | P1 | ✅ `formularioSemPerda()` (25 arquivos) e `enviarSemReset()` (formulários com `useTransition`) |
| INT-5 | Compra × pedido interno | Compra aprovada, recebida e encerrada enquanto o pedido estava na etapa 4 de 11 | [T] | Duas trilhas sem amarração | P2 | **Decisão D1** |
| INT-6 | Controle de Estoque, Compras, página inicial | "1 mL", "pedir ~0,11 frasco" → "1 frasco(s) de 100 mL", sugestão em frascos inteiros | [T] | Leitura errada do saldo; contradiz a automação | P1 | ✅ `v_previsao_suprimentos` arredonda e expõe `unidade_saldo` |
| INT-7 | Formalização | Compra nasce sem fornecedor; o PDF sai sem ele | [T] | Pedido ao fornecedor incompleto | P2 | ✅ aviso "Compra sem fornecedor" com seletor, já sugerindo o fornecedor dos itens |
| INT-8 | `LoteAcoes.tsx` | Diálogo de estorno feito à mão, sem rótulo nem Esc, e sem dizer que a compra reabre | [T] | Acessibilidade; consequência oculta | P2 | ✅ todos os diálogos do lote no padrão, com rótulos, "Voltar" e a consequência escrita; recebimentos estornados aparecem riscados na compra |
| INT-9 | `DemandaForm.tsx`, `demandas.ts` | Matriz em texto livre; FK recusada em inglês → lista de matrizes cadastradas | [T] | Não conseguia criar o orçamento | P1 | ✅ |
| INT-10 | `gerarOrcamentoAnalisesDaDemanda` | Módulo laboratorial nascia vazio → nasce com as análises escolhidas | [T] [S] | Preenchimento duplicado e divergência | P1 | ✅ cópia pela RPC da 0126 |
| INT-11 | Lista de insumos, diálogo de baixa, histórico do lote | "Unidade mL" junto à quantidade em frascos; "embalagem(ns)"; referência em UUID | [T] | Vocabulário inconsistente | P3 | ✅ baixa e ajuste em "frascos"; referência legível no histórico. Pendente: coluna Unidade da lista de insumos |
| INT-12 | Aceite, revisão do orçamento | Responsável digitado à mão; pendência "responsável técnico" sem indicar onde preencher | [T] | Cliques e dúvida | P3 | ✅ responsável preenchido com o usuário (exceto em `/estoque/controle`); pendências da revisão viram links para o campo |
| INT-13 | Migrações pelo `psql` no Windows | Sem `PGCLIENTENCODING=UTF8`, os acentos das funções viravam "Ã©" | [S] banco local; [P] produção conferida sem o defeito | Mensagens corrompidas | P1 (processo) | Documentado no roteiro de deploy (§6) |

### 4.2 Estoque e compras (frente EST)

| ID | Situação | Resumo |
|---|---|---|
| EST2-1 | ✅ produção | Gatilho da 0123 (P0) |
| EST2-2 | ✅ produção + 0127 | Reposição e sugestão em frascos inteiros |
| EST2-3 | ✅ | "+ Entrada" respeita o modelo do insumo e usa `operacao_id` |
| EST2-4 | ✅ | Reservado só sobre lotes utilizáveis; job diário libera reservas de lotes vencidos |
| EST2-5 | ✅ | Unidade do saldo nas views e telas |
| EST2-6 / CAD2-8 | ✅ | Volume do frasco e local no recebimento, sem alterar a compra |
| EST2-7 | ✅ | Encerrar com pendência conclui o recebimento do pedido interno [T] |
| EST2-8 | ✅ | Previsão converte saídas antigas em mL para frascos |
| EST2-9 / EST-1 | ✅ | Item de compra travado depois de recebido; FKs RESTRICT; auditoria |
| Item 13 | ✅ | Pedido devolvido depois de formalizado reaproveita a compra |
| EST-2 | ✅ [T] | Estorno bilateral de compra formal |
| EST-4 | ✅ | Retirada usa o lote conferido na bancada |
| EST-5 / ORC-4 | ✅ | `operacao_id` na baixa e na entrada; "Comprar faltas" transacional e sem duplicar |
| EST-6 / EST-8 | ✅ | Alertas com lote e ação; validade após abertura |
| EST-7 | ✅ | Uma fórmula de sugestão (previsão) em Compras e na página inicial |
| EST-9 | Pendente P2 | Fechamento de campanha de inventário; `quantidade_sistema` ainda gravada pelo app |
| CAD-3 | Pendente (D4) | Lote inicial do cadastro entra aceito, sem quarentena (agora visível na tela) |
| — | Pendente P3 | Alerta de reposição que ignora compra aberta; local no recebimento de pedido interno sem compra |

### 4.3 Orçamento → operação (frente ORC)

| ID | Situação | Resumo |
|---|---|---|
| ORC2-1 | ✅ | `salvar_item_orcamento` transacional |
| ORC2-2 | ✅ | Snapshot com código da análise; plano lê o snapshot; itens travados depois da revisão |
| ORC-3 / ORC2-3 | ✅ | Uma versão viva; segunda aprovada recusada |
| ORC-7 / ORC2-4 | ✅ | Vencida recusada; job `kontrol-vencimento-propostas` |
| ORC-6 | ✅ | Cancelar a aprovada cancela o plano não iniciado e libera reservas; plano em execução só avisa |
| ORC2-5 / ORC2-6 / ORC-8 / ORC-9 | ✅ | Números a partir da proposta aprovada vigente |
| ORC2-7 | ✅ | "Gerar planejamento desta proposta" |
| ORC-2 / ORC2-9 | ✅ | Link público restaurado (criar, copiar, revogar), por versão |
| ORC2-8 | ✅ | Classificação só com transições válidas e confirmação |
| ORC-10 / ORC-11 / ORC2-12 | ✅ | Índices únicos; `aprovado_em` só pela aprovação; trava por proposta |
| Item 12 | Parcial | `orcamentos.ts` e `orcamento-historico.ts` sem `throw`; 44 pontos restam em `orcamento-projetos.ts` (modelos, anexos, exclusões) |
| — | Pendente P3 | Rótulos gravados sem acento ("Campo e logistica"), que exigem migração de dados; receita do plano sem gross-up |

### 4.4 Papéis e permissões (frente PER)

| ID | Situação | Resumo |
|---|---|---|
| PER2-1 | ✅ produção | Travas da 0124 (0125) |
| PER2-2 | ✅ | Aprovações só por RPC; pedido alterável só pelo solicitante em rascunho ou ajuste |
| PER2-4 | ✅ | `eventos_status` só em nome próprio e por usuário ativo |
| PER2-5 | ✅ | `security_invoker` nas views de painel; proxy falha fechado |
| PER2-6 / PER2-7 | ✅ | Compra alterável só em `solicitado`; orçamento excluível só em rascunho; ajuste de inventário exige permissão |
| PER2-8 / PER2-17 | ✅ | Equipamentos, identificadores e triagem por permissão |
| PER2-9 / PER-4 / PER2-10 | ✅ [T] | Notificações por usuário; avisos nas transições; "Aguardando você" |
| PER2-13 | ✅ | Botões de cadastro escondidos sem permissão |
| PER2-14 | ✅ | Suspenso perde o papel imediatamente (banco e app) |
| PER2-15 | ✅ | Exceções iguais ao padrão da categoria removidas (listadas em NOTICE) |
| CAD2-2 / CAD2-3 | ✅ | Auditoria em perfis e em 11 cadastros, sem vazar salário |
| PER2-3 | Pendente (D2) | Segregação entre solicitante e aprovador |
| PER2-11 | Pendente (D5) | Sem gestor, só o admin descarta ou bloqueia lote |

### 4.5 Hipóteses de desempenho (não medidas)

- Custeio do catálogo inteiro a cada abertura de novo orçamento, `/analises` e `/custeio`.
- Listas sem limite no servidor.
- `recharts` na página inicial.
- Primeira compilação lenta das rotas em `next dev`. Isso é ambiente de desenvolvimento, não produção.

---

## 5. Melhorias de interface feitas

- **Glossário.**
  - "Demanda" saiu da interface, inclusive do documento exportado.
  - "Cotação" substitui "orçamento" em Suprimentos.
  - "Compra #N" e "Pedidos internos" separam os dois objetos.
  - Etapas do orçamento: Dados → Laboratório → Parâmetros → Proposta.
  - Menu: "Orçamentos", "Novo orçamento", "Modelos", "Regras do orçamento".
- **Mensagens.**
  - Tradutor único `mensagemDoBanco()`: o texto técnico do Postgres nunca chega à tela, e as mensagens em português das RPCs e dos gatilhos são mantidas.
  - Ações de formulário devolvem o estado em vez de `throw`.
- **Envio.**
  - `SubmitButton` desabilita o botão durante o envio e mostra o verbo em andamento.
  - `MensagemAcao` como região viva.
  - `formularioSemPerda()` mantém o que foi digitado.
- **Confirmações.** Botão de desistir "Voltar". Motivo obrigatório ao cancelar orçamento, proposta ou compra.
- **Ajuda "?".**
  - Área de toque de 44 px, texto alinhado à esquerda, nome acessível.
  - A ajuda geral usa outro ícone (boia).
  - Removidos os "?" que repetiam a tela.
  - Acrescentados os "?" que tiram dúvida real: quantidade na embalagem, unidade da embalagem, quantidade mínima, prazo máximo, frascos recebidos, volume do frasco, margem de lucro (texto corrigido), taxa de incubação.
  - Consequências que antes ficavam escondidas no "?" agora aparecem visíveis, por exemplo "Entra direto no estoque, sem quarentena." e "Salvar recalcula as quantidades e substitui ajustes manuais."
- **Página inicial.**
  - Bloco "Aguardando você" por permissão.
  - No máximo 5 indicadores, todos clicáveis.
  - Seções aparecem conforme a permissão.

---

## 6. Plano de correção, publicação e validação

**Ordem de publicação** (deploy = merge no `main`, com as migrations aplicadas antes do app):

1. **0125**: já em produção (backup em `D:\Dropbox\Aplicativos\Kontrol\HISTORICO\deploy-0125-2026-09-26`).
2. Backup lógico de produção (`pg_dump -Fc`).
3. Aplicar **0126 → 0127 → 0128 → 0129**, nesta ordem, uma a uma com `psql -v ON_ERROR_STOP=1`, sempre com **`PGCLIENTENCODING=UTF8`** (INT-13). Registrar cada uma em `supabase_migrations.schema_migrations`. A 0129 precisa entrar **antes** do app, porque a tela de técnicos lê `tecnicos.ativo`.
4. Merge do PR (a Vercel publica).
5. Validação em produção:
   - rodar cada `supabase/tests/*.sql` dentro de transação revertida;
   - conferir que nenhuma função tem `chr(195)` (acento estragado);
   - abrir as rotas principais.

| Critério objetivo | Como verificar |
|---|---|
| Todos os testes SQL passam com 0125–0129 | CI `schema` (16 arquivos) |
| Unitários e tipos | CI `check`; 660+ testes |
| Pedido interno vincula insumo e mostra frascos | Abrir um pedido: a lista de insumos tem itens; "N frascos de V mL" |
| Recebimento parcial → encerrar com pendência → pedido interno com "recebido X de Y" | Fluxo [T] do §2.1 |
| Recusa não apaga formulário | Projeto com fim antes do início: campos continuam preenchidos |
| Uma versão viva de proposta | Emitir a v2 com a v1 enviada: v1 substituída e link revogado |
| Notificação por usuário | Técnico "marca todas como lidas": o coordenador continua vendo |

---

## 7. Decisões de negócio que ainda precisam do dono

| # | Pergunta | Proposta padrão |
|---|---|---|
| D1 | **Pedido interno × compra formal.** Depois da formalização, o pedido segue as etapas administrativas (análise, cotação, aprovação final) enquanto a compra formal já pode ser aprovada e recebida. Qual trilha manda? | A compra formal só pode ser aprovada depois de "Aprovado para compra" no pedido. Para compra direta, as etapas administrativas viram opcionais |
| D2 | Segregação: quem solicita pode validar o próprio pedido ou aprovar a própria compra? | Proibir, com admin isento, como no aceite do lote |
| D3 | Coordenador do projeto: um campo ligado ao usuário substituindo os quatro campos de texto? | Sim, e o aviso de validação vai para essa pessoa |
| D4 | Lote inicial do cadastro e entrada avulsa de frascos passam por quarentena? | Só item crítico |
| D5 | Sem gestor, descarte e bloqueio de lote ficam com o coordenador? | Dar `estoque.descartar_bloquear` à categoria coordenador |
| D6 | Lotes do mesmo código de fábrica em entregas diferentes: juntar ou manter separados? | Manter separados (é o comportamento atual) |
| D7 | Inventário: fechamento de campanha e segunda aprovação acima de um limite? | Fechamento sim; limite a definir |
| D8 | Proposta só de projeto (sem análises): deve gerar algo operacional? | Só o aviso (implementado) |
