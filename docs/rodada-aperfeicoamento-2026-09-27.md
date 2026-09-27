# Rodada de aperfeiçoamento: 27/09/2026

Origem: avaliação externa da [auditoria da segunda onda](auditoria-completa-2026-09-26-onda2.md), conferida contra o código em 27/09, e as decisões do dono na mesma data. Migration **0130** (`0130_entrada_direta_reposicao_compra.sql`), base `main` 1.1.4 (`c9b25c5`).

## 1. Regras definidas pelo dono (27/09)

| Regra | O que significa no Kontrol |
|---|---|
| **Baixa na entrega** | O Kontrol controla o material guardado no almoxarifado. A entrega ao laboratório é a baixa definitiva. Não se acompanha abertura de frasco, sobra nem consumo de bancada. |
| **Entrada direta, sem quarentena** | Quem registra a chegada cadastra o material (insumo já cadastrado, quantidade, lote, validade) e ele fica disponível na hora. Não há aceite por segunda pessoa. Vale para recebimento de compra, recebimento de pedido interno, "+ Entrada" e estoque inicial. **Substitui a decisão de 26/09** ("quem recebe não aceita o próprio lote"). O bloqueio manual de lote continua como ação opcional. |
| **Retirada por uma pessoa** | Já era assim; nada mudou. |
| **Prazo de compra** | Compras pela universidade ou pela Fundação variam caso a caso. Levam pelo menos três meses até a licitação ou a ordem de serviço, e até uns quatro meses para o material chegar. A tramitação entra com **90 dias** e a previsão soma o prazo de entrega do fornecedor; o valor pode ser ajustado em Parâmetros. |

## 2. O que mudou

| # | Mudança | Onde |
|---|---|---|
| 1 | Todo lote novo entra **disponível**. Os lotes que estavam em quarentena passaram a disponíveis (a produção não tinha nenhum em 26/09). Material com validade vencida não entra no estoque. O painel "Aguardando você" deixou de listar lotes. O rótulo "Aceito" virou **"Disponível"**. | 0130 §1; telas de estoque, compras, recebimento, ajuda |
| 2 | **Reposição com prazo total.** O prazo passa a ser a tramitação na universidade (parâmetro novo, *Tramitação da compra na universidade*, que começa em **90 dias**) somada ao prazo de entrega do fornecedor. Se o prazo do insumo for zero, vale o prazo médio do fornecedor; antes, o zero anulava o prazo. A sugestão também considera o ponto de reposição cadastrado. O alerta "Repor", a sugestão de compra, o painel Controle de Estoque e a rotina diária usam **a mesma conta**; antes, o alerta ignorava as compras em aberto. "Consumo" virou "saídas" nas telas de reposição. | 0130 §2; `v_previsao_suprimentos`, `v_alertas_estoque`, `gerar_reposicao_automatica` |
| 3 | **Compra atrasada.** Uma compra em aberto com a entrega prevista vencida continua contando como "a caminho", para não comprar em dobro. Em troca, ela gera o alerta **"Compra atrasada"** quando o estoque já está no ponto, e um aviso semanal para quem aprova compras. Sem data prevista (compra ainda não aprovada), a previsão é a data do pedido mais a tramitação e a entrega. | 0130 §2; `v_compras_prazo` |
| 4 | **D1: o pedido interno governa a compra.** A compra que nasceu de um pedido interno só pode ser aprovada ou enviada depois que o pedido chega a "Aprovado para compra". A compra sem pedido interno segue a regra própria: basta a permissão de aprovar compras. O banco recusa, e a tela explica o motivo e leva ao pedido. | 0130 §3; `transicionar_pedido_compra`; `/compras/[id]` |
| 5 | **Destino do que faltou.** Encerrar uma compra com pendência exige escolher entre três caminhos: **comprar de novo** (a compra nova é criada na hora, ligada à original), **desistir** ou **atendido de outra forma**. A quantidade não atendida e o destino ficam gravados no item. O caminho antigo, sem destino, é recusado. | 0130 §4; `encerrar_compra_com_pendencia` |
| 6 | **Margem do plano.** A receita passou a ser a parte laboratorial do que o cliente paga na versão da proposta ligada ao plano (total final menos a parte de projeto, já com impostos, taxas e lucro). Antes era o preço de tabela das análises, que é só referência. | 0130 §5; `v_margem_real_planejamento`; `/planejamento/[id]` |

**O que era "receita do plano sem gross-up".** A "margem parcial" do plano usava como receita a soma de preço × amostras dos itens do orçamento. Esse preço de tabela vem de uma marcação simples sobre o custo com os parâmetros globais. O valor cobrado do cliente, porém, é o custo técnico multiplicado pelo fator de gross-up da proposta, com os percentuais da própria proposta. A margem mostrada no plano, portanto, não correspondia ao valor cobrado. Agora corresponde.

## 3. Situação de cada mudança

| # | Implementado | Teste automático | Testado na interface local | Publicado |
|---|---|---|---|---|
| 1 Entrada direta | sim | `entrada_reposicao_compra_0130.sql`; testes 0120, 0123, 0124, 0127 e 0128 atualizados | técnico registrou a chegada de 3 de 5 kits e o lote entrou disponível | não |
| 2 Prazo total | sim | idem (80 dias = 60 + 20; sugestão 4 e 3) | tramitação de 60 dias gravada em Parâmetros; Compras passou a sugerir 5 frascos | não |
| 3 Compra atrasada | sim | idem (alerta e aviso semanal sem repetir) | alerta em Estoque e no Controle de Estoque | não |
| 4 D1 | sim | `estoque_ciclo_0127.sql`; `status.test.ts` | compra #113 bloqueada com explicação (admin) | não |
| 5 Destino do que faltou | sim | 0120, 0127 e `compras.test.ts` | coordenação encerrou a #112 e a nova compra #114 foi criada e ligada | não |
| 6 Margem | sim | idem (receita 2.000 de 2.500 − 500) | plano mostrou receita da proposta, 85% | não |

A interface foi percorrida com três papéis reais no banco local: administrador, **técnico** e **coordenação** (usuários de teste criados só no banco local). Todas as mudanças ainda precisam ser publicadas e conferidas em produção; a situação não se altera antes disso.

## 4. Ajustes na auditoria da segunda onda

- **EST-8** ("a baixa respeita a validade após abertura") vale só para lotes antigos controlados por volume. No controle por frascos, a entrega não marca o lote como aberto, e os frascos que ficam continuam fechados. Converter os lotes antigos continua pendente.
- **INT-11 e INT-12** estavam marcados ✅, mas tinham partes pendentes: a coluna "Unidade" da lista de insumos e o responsável preenchido à mão em `/estoque/controle`. Esse aceite deixou de existir com a entrada direta. A coluna "Unidade" continua pendente.
- **D1** foi resolvida (item 4). **D4** foi resolvida pela decisão de entrada direta. **D5** perde parte do sentido: o bloqueio passou a ser só uma ação opcional.
- Os lotes com estorno depois de uma saída já eram recusados pelo banco (0120). Continua faltando um caminho de devolução ao fornecedor do que sobrou.

## 5. Pendências

| Pendência | Quem resolve |
|---|---|
| **Cadastrar os insumos reais.** Na cópia de produção de 26/09, não há insumos nem lotes, e as 463 linhas de receita das análises estão sem insumo ligado. Sem isso não há custeio real nem previsão. | Equipe |
| D2 (segregação), D3 (coordenador estruturado), D5 (permissões de bloqueio e descarte), D7 (fechamento do inventário) e D8 (proposta sem análises) | Dono decide; depois, implementação |
| Rótulo "frasco(s) de 1 un" para insumo contado por unidade (kits) | Próxima rodada |
| Campos do recebimento sem rótulo ligado ao campo (acessibilidade) | Próxima rodada |
| Concorrência com duas sessões e medição de desempenho | Próxima rodada |
