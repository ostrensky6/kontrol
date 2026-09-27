# Auditoria com notas: 27/09/2026

Base: `main` 619b733, versão 1.1.5, migrations até a 0130 (o mesmo que está em produção). A auditoria foi feita só com leitura: código, migrations e testes. Não houve acesso ao banco de produção. Por isso, configurações do Supabase Auth (por exemplo, `enable_signup`) não foram conferidas.

Verificações automáticas rodadas nesta data: typecheck ok, lint ok, **666 de 666** testes unitários ok (98 arquivos), teste de versão ok.

Escala usada em todas as áreas:

| Faixa | Significado |
|---|---|
| 9 a 10 | Pronto e robusto, sem achado P1 ou pior |
| 7 a 8,9 | Sólido, com lacunas P2 |
| 5 a 6,9 | Funciona, mas há riscos P1 ou lacunas relevantes |
| abaixo de 5 | Risco de dado errado ou de exploração simples no uso normal |

## 1. Notas

| Área | Nota | Sub-notas |
|---|---|---|
| **Estoque, compras e reposição** | **7,5** | Estoque e lotes 7,8 · Compras e pedido interno 7,4 · Reposição e previsão 7,0 |
| **Interface e usabilidade** | **7,3** | Consistência visual 6,8 · Linguagem e ajuda 8,4 · Acessibilidade 6,2 · Prevenção de erro 8,3 |
| **Orçamentos, propostas e planejamento** | **6,6** | Custeio e cálculo 7,0 · Proposta e aprovação 6,0 · Planejamento e execução 7,5 · Absorção do app antigo 6,0 (cerca de 65–70%) |
| **Segurança e permissões** | **6,3** | Autenticação 4,5 · Autorização e RLS 7,0 · Rotas públicas 7,5 · Privacidade e auditoria 6,5 |
| **Engenharia e operação** | **6,3** | Código 7,5 · Testes e CI 7,5 · Migrations e deploy 5,5 · Backup e monitoramento 4,5 · Documentação 6,0 |
| **Geral (média simples)** | **6,8** | |

**Leitura rápida.** O núcleo está bem construído. As regras de negócio vivem no banco, com travas, constraints e testes SQL que rodam no CI, e o estoque não tem risco de saldo errado pela tela. O que puxa as notas para baixo está nas bordas: a senha provisória pública, o que o link público da proposta devolve, a operação (deploy manual de migrations, restauração nunca testada, nenhum monitoramento de erro) e a acessibilidade dos formulários.

**Prontidão de uso.** Produção ainda não tem insumos cadastrados. Sem eles, a previsão de reposição e o custeio real ficam vazios. Proposta laboratorial com análise que tem receita também não pode ser emitida, porque a checagem de proveniência bloqueia. As notas medem o software, não os dados.

## 2. Prioridades (o que mais sobe as notas)

| # | Sev. | Área | Achado | Conferido por mim |
|---|---|---|---|---|
| 1 | **P1** | Segurança | A senha provisória é a mesma para todos (`GIA2026`) e aparece na tela pública de login. Quem souber o e-mail de uma conta que ainda não fez o primeiro acesso entra, troca a senha e fica com a conta. A troca obrigatória só é exigida pelo proxy, não pelo banco. | sim (`src/lib/auth/senha-provisoria.ts:8`, `src/app/login/page.tsx:46-56`) |
| 2 | **P1** | Orçamentos e segurança | `ler_orcamento_publico` entrega ao anônimo o snapshot inteiro da proposta: custos, lucro, reserva, observações internas e linhas de pessoal. A página filtra, mas a RPC não. Quem tem o link e a chave pública chama a função direto. | sim (`0126:1042-1060`, grant para anon em `0101:194`) |
| 3 | **P1** | Orçamentos | Proposta aprovada pelo link e depois cancelada: o módulo de projeto continua "aprovado" e o cancelamento não o altera. A nova versão não pode ser aprovada pelo link, porque a função exige o módulo em rascunho ou enviado. O cliente vê "link indisponível". | sim (`0126:1142-1148` e trecho de cancelamento perto de `0126:900`) |
| 4 | **P1** | Operação | O roteiro oficial (`docs/operacao-producao.md:103-104`) manda usar `supabase db push`, o que é proibido por causa da divergência da 0109. O procedimento real (psql com UTF8 e registro manual) só está num relatório de auditoria. | sim |
| 5 | **P1** | Operação | Nenhum erro chega a um monitor. `mensagemDoBanco` traduz o erro para o usuário e descarta o original. Não existem `instrumentation.ts` nem `global-error.tsx`. | sim |
| 6 | **P1** | Operação | O backup diário roda, mas a restauração nunca foi testada. Os anexos do Storage não entram no dump e não há alerta de falha. | parcial |
| 7 | **P1** | Interface | As três janelas de recebimento são feitas à mão, sem o Dialog padrão: não fecham com Esc e o foco escapa. Há cerca de 98 rótulos de campo sem ligação com o campo. | não |
| 8 | P2 | Estoque | A "+ Entrada" por frascos aceita material vencido, o que contraria a regra da 0130. | sim (`registrar_entrada_manual_embalagens`, 0109, sem checagem de validade) |
| 9 | P2 | Compras | Ao aprovar a compra, a data prevista passa a ser hoje + prazo do fornecedor, sem a tramitação. Depois de uns 20 dias surge "compra atrasada" falsa, com aviso semanal, enquanto a licitação ainda corre. | sim (`src/lib/actions/compras.ts:29-32, 262-271`) |
| 10 | P2 | Reposição | Um rascunho de compra que ninguém aprova conta como "a caminho" e silencia o "Repor" por cerca de 110 dias. | não |
| 11 | P2 | Segurança | Os anexos de orçamento ficam liberados para qualquer usuário logado ler, gravar e apagar (`0022:38-42`, já era o K4 do diagnóstico). Em pedidos internos, qualquer usuário apaga anexo de qualquer pedido. | não |
| 12 | P2 | Segurança | A leitura das tabelas de estoque, compras e planejamento é `using (true)` no banco. "A caixinha manda" vale só nas rotas. | não |
| 13 | P2 | Segurança | A mudança de privilégios (`permissoes_categorias`) não entra na trilha de auditoria. Troca de senha e exclusão de usuário ficam sem autor. | não |
| 14 | P2 | Segurança | Nenhum cabeçalho de segurança (CSP/`frame-ancestors`, nosniff). | não |
| 15 | P2 | Orçamentos | A emissão aceita os totais e os custos que a tela manda, sem recalcular no servidor. O DOCX junta o resumo interno (custo e lucro) com a parte do cliente. | não |
| 16 | P2 | Operação | O app publica sozinho ao entrar em `main`, sem esperar a migration. A tela `/governanca/backups` tem caminhos `D:\` fixos e não funciona na Vercel. | sim (`src/lib/actions/backups.ts:12-13`) |

## 3. Por área

### Estoque, compras e reposição: 7,5

**Pontos fortes**
- O usuário não grava direto em lotes, movimentações e reservas: tudo passa por RPC com checagem de permissão dentro da função.
- Saldo nunca negativo e frascos inteiros garantidos por constraint.
- Travas `FOR UPDATE`, `operacao_id` contra duplo clique e recebimento idempotente.
- FEFO na reserva e na baixa.
- D1 e o destino do que faltou impostos no banco e testados.
- Uma única fórmula de reposição, usada em todas as telas.

**Achados além da tabela**
- **P2:** a RPC antiga `receber_lote` continua liberada para o técnico. Chamada pela API, cria lote por volume num insumo contado em frascos.
- **P2:** a baixa não grava destino (laboratório, projeto, quem recebeu).
- **P3:**
  - frações de frasco no pedido interno;
  - a compra de "comprar de novo" não fica ligada ao pedido interno;
  - o estorno depois de encerrar com pendência perde a quantidade;
  - a compra cancelada deixa o pedido interno órfão;
  - o ajuste aparece sem sinal no histórico;
  - o rascunho de reposição pode sair em dobro;
  - o ponto de reposição não diz a unidade.
- **Continuam pendentes:** fechamento do inventário (EST-9), conversão dos lotes antigos por volume, teste de concorrência.

### Interface e usabilidade: 7,3

**Pontos fortes**
- Glossário respeitado: nenhum "Demanda" visível.
- "?" (`HelpTip`) em 334 lugares.
- 39 confirmações com motivo nas ações críticas, sem `alert`/`confirm` nativos.
- Link para pular ao conteúdo, foco visível, mensagens anunciadas ao leitor de tela.
- Telas de erro em linguagem simples.

**Achados além da tabela**
- O teste de acessibilidade só falha em violação crítica e não cobre recebimento, pedido, scanner nem o formulário da proposta.
- Recebimento no celular: tabela com rolagem lateral e botão de uns 24 px.
- Tabela de saldos com 11 colunas.
- "ID da entidade" digitado à mão na triagem.
- Campos marcados "Obrigatório" sem `required`.
- "Revogar link" sem confirmação.
- Pendências da rodada anterior:
  - coluna "Unidade" ambígua;
  - "frasco(s) de 1 un", com a regra repetida em 5 lugares.
- Os componentes padrão (`PageHeader`, `DataTable`, `Button`) existem, mas são pouco usados.

### Orçamentos, propostas e planejamento: 6,6

**Pontos fortes**
- Uma única regra de gross-up.
- Arredondamento com a sobra de centavos na última linha.
- Proposta emitida imutável por gatilho.
- Versão viva única, com revogação de links.
- Proposta vencida recusada.
- Cancelamento da aprovada tratado conforme o plano.
- Plano automático a partir do snapshot.
- Cerca de 280 testes unitários, mais o teste SQL da 0126.

**Achados além da tabela**
- O módulo revisado não pode ser reaberto: uma nova versão com conteúdo diferente exige cancelar e refazer.
- O preço de tabela (custo × fatores, percentual por fora) diverge da proposta (gross-up).
- A margem do plano parece maior do que é: a receita inclui impostos, e a margem desconta só insumos.
- K2 (botão "Usar" dos modelos falha) segue aberto.
- A validade da proposta não é validada na RPC.

**Faltam do app antigo:**
- criar e editar item do catálogo;
- importar planilha;
- duplicar orçamento de projeto;
- importar os orçamentos antigos;
- conferir a paridade de Fundos.

### Segurança e permissões: 6,3

**Pontos fortes**
- Salário protegido por privilégio de coluna, RPC e máscara no servidor.
- Todas as funções SECURITY DEFINER têm `search_path` e checam permissão.
- O proxy fecha em caso de falha.
- A chave service role fica só no servidor.
- O token do link tem 192 bits e o banco guarda só o hash.
- O login automático de desenvolvimento não ativa em produção.
- Rotas de cron com segredo.

**Achados além da tabela**
- **P2:** o valor de pessoal (salário PE) sai da máscara quando vira linha de orçamento, visível para quem vê Orçamentos.
- **P3:**
  - `grant select … to anon` como padrão para tabelas novas;
  - nome do aprovador sem limite de tamanho;
  - usuário suspenso com sessão válida ainda lê as tabelas abertas;
  - salários com nomes numa migration versionada.
- **Não conferido:** se o cadastro público (`enable_signup`) está desligado em produção.

### Engenharia e operação: 6,3

**Pontos fortes**
- TypeScript estrito, sem `any`, `@ts-ignore` nem TODO.
- O CI recria o banco com as 128 migrations e roda os 15 testes SQL, mais typecheck, lint, unit, build e e2e.
- Versão controlada por máquina.
- Travas nos remendos de função.
- LF forçado nos `.sql`.
- 66 dumps diários no Dropbox.

**Achados além da tabela**
- Os e2e rodam contra um mock do Supabase; nenhum teste liga o app ao banco real.
- Funções são reescritas por `replace` sobre o estado vivo do banco (`dar_baixa_plano` foi redefinida 11 vezes).
- A regra de "+1 exato" na versão faz dois PRs paralelos sempre conflitarem (caso do PR #43).
- O build roda duas vezes no CI.
- Os tipos do banco são regerados à mão.
- `package.json` diz 0.1.0.
- Documentos defasados:
  - `rodada-aperfeicoamento-2026-09-27.md` dizia "Publicado: não" (corrigido junto com este relatório, na 1.1.6);
  - o README lista só duas migrations;
  - o AGENTS.md fixava `D:\` (corrigido na 1.1.6, que absorve o PR #43).
- `src/app` e `src/components` quase sem testes (1,3% e 3%), com páginas de mais de 1.000 linhas.

## 4. Método

- Cinco auditorias por área, feitas em paralelo, só com leitura.
- Os achados P1 e parte dos P2 foram conferidos de novo no código antes de entrar neste relatório (coluna "Conferido por mim").
- Uma afirmação foi descartada depois da conferência: a de que cancelar a proposta não revoga os links. O cancelamento revoga, conforme `0126`, perto da linha 900.
- Também foi conferido que a escrita em `perfis` é restrita ao admin desde a 0006 e a 0014.
- Os achados marcados "não" vieram da leitura das auditorias por área, com arquivo e linha citados, mas não foram reconferidos um a um.
