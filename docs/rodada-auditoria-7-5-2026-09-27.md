# Rodada da auditoria 7,5/10 de 27/09/2026 (versão 1.1.8 → 1.1.9)

Auditoria externa sobre `main` em `aef8420` (nota geral 7,5), com adendo sobre o
layout do módulo Orçamentos. Cada achado foi conferido no código antes da
mudança. Esta rodada cobre o **pacote 1** (sucesso falso) e a **onda A**
(proposta do cliente e PDF). Nenhuma migration, nenhum dado e nenhuma fórmula
foram alterados.

## Pacote 1: nada de "concluído" quando algo falhou

| Achado | Conferência | Correção |
|---|---|---|
| Cadastro de usuário | Confirmado: falha ao ajustar o perfil era ignorada; a conta ficava com o papel padrão (técnico) e a tela dizia "criado" | `criarUsuario` e `criarUsuarioPreAprovado` conferem o perfil (erro ou nenhuma linha). Na falha, a conta é desfeita; se nem isso der, ela fica suspensa e a mensagem diz o que fazer |
| Suspensão | Confirmado: o login era bloqueado e a falha no perfil ignorada, sem nenhum retorno na tela | `alternarSuspensao` devolve o resultado (aviso na tela) e desfaz o bloqueio do login quando o perfil não acompanha |
| Edição de usuário | O nome no login era gravado mesmo com o perfil recusado | O login só muda depois do perfil |
| Remover assinatura | Falha ao apagar o arquivo era ignorada | Arquivo que não sai mantém o cadastro e avisa |
| Revisão do laboratório | Em parte: repetir já recuperava. Falhas de leitura viravam "adicione uma análise" e o andamento era gravado numa segunda escrita sem conferência | Leituras conferidas; responsável e andamento numa única gravação |
| Cancelamento do laboratório | O andamento podia ficar para trás sem aviso | Erro explícito e botão "Concluir cancelamento" para corrigir (repetir acerta o andamento) |
| Anexos e exclusão do orçamento de projeto | Confirmado, mas **essas ações não são usadas por nenhuma tela hoje** | Resultado do Storage e do banco conferido; anexo procurado só no próprio orçamento; exclusão que o banco não confirma não vira sucesso |
| Aprovação pública | Botão sem estado de envio | "Aprovando…", desabilitado durante o envio, alvo de 44 px |

Testes novos: `usuarios-consistencia.test.ts`, `orcamentos-andamento.test.ts`,
`orcamento-projetos-exclusoes.test.ts` (todos vistos falhando antes da correção).

## Onda A: proposta do cliente e PDF

Defeitos corrigidos (pelo CSS, confirmados no PDF gerado):

- o quadro "Total da proposta" sumia do PDF (era `<aside>`, e a impressão esconde `aside`);
- o cabeçalho escuro com texto branco saía em branco no branco com a opção padrão do Chrome;
- o atalho "Ir para o conteúdo principal" saía impresso em toda página do app;
- em tema escuro, a impressão herdava as cores escuras.

Nova folha (`src/app/orcamento/final/[id]/page.tsx`, `.folha-documento` em `globals.css`):

- sempre clara, nos dois temas, igual na tela, no papel e no PDF;
- cabeçalho institucional com faixa na cor da instituição, número e versão;
- faixa com valor total em destaque, emissão e validade (as datas aparecem uma vez);
- proponente e cliente lado a lado; objeto e escopo; serviços e valores; condições; campos de aceite; rodapé com número;
- número de página no PDF ("Página 1 de 2"); tabela longa pode quebrar entre páginas, as demais seções não;
- no celular, a tabela cabe sem rolagem (o componente vai acima da descrição);
- o modo interno passou a usar as cores do tema, sem cinza fixo;
- barra de ações com "Imprimir / PDF" como ação principal.

**Decisão tomada por padrão:** a coluna "Participação" (percentual do custo
técnico de cada item) saiu da proposta do cliente, igualando o DOCX, que já não
a mostrava. Ela continua no modo interno e na etapa final do orçamento. Os
valores de cada linha e o total não mudaram.

Evidência visual: capturas em 1280 px (claro e escuro) e 375 px, e PDF A4 sem
gráficos de fundo, na prévia simulada (`PLAYWRIGHT_MOCK_SUPABASE`).

## DOCX só do cliente (decisão do dono, 27/09)

"O documento que vai para o cliente não traz a margem de lucro; a margem fica
registrada no app." O DOCX da proposta (`exportOrcamentoFinalDocx`) tinha
"Resumo econômico (interno)", "Parâmetros econômicos" e a fórmula do gross-up.
Agora ele segue a folha impressa: proponente, cliente, datas legíveis (antes
saíam como `2026-06-21T08:00:00Z`), objeto, serviços e valores, condições,
aceite e rodapé com "Página X de Y". O aviso interno de regra econômica
anterior não vai mais ao cliente (nem ao papel).

- Arquivos: `proposta-<número>.docx` (cliente) e `orcamento-interno-<número>.xlsx`
  (planilha interna, sem mudança de conteúdo); botões "Proposta (DOCX)" e
  "Planilha interna (XLSX)".
- A margem continua no modo interno da proposta e na etapa final do orçamento.
- Teste: `final-exporters.test.ts` abre o DOCX e confere que não há margem,
  parâmetros, custo técnico nem gross-up.

## Pendências e decisões do dono

- O DOCX do editor de custos do projeto ("Orçamento de projeto — ATGC Genética
  Ambiental") é documento de trabalho e inclui o total de parâmetros; o título
  diz ATGC mesmo em orçamento GIA. Não mudou nesta rodada.
- A aprovação pública não pôde ser exercitada na prévia simulada: a página lê
  com a chave de serviço, que a simulação não emula.
- PR #47 (senha individual) mexe em `usuarios.ts`: quem entrar por último sobe
  a versão.
- Próximos pacotes, na ordem combinada: script de migration que aplica e
  registra de uma vez; alerta de falha no backup, ensaio de restauração e cópia
  do Storage; ondas B (elaboração) e C (lista, histórico e celular); quantidades
  (item 5) e revisão numa única função do banco, na próxima migration.

## Segunda parte — 28/09/2026 (1.1.9 → 1.2.0)

Fecha os itens restantes da auditoria, as pendências soltas e a onda C. A onda
B (tela de elaboração) fica de fora, por decisão do dono.

| Item | O que mudou |
|---|---|
| 4. Migration à prova de interrupção | `npm run db:migration` aplica **e registra** na mesma transação (cair no meio = nada aplicado nem registrado); `--ensaio` termina em rollback; `--situacao` mostra o que falta registrar; `--somente-registrar` para o caso antigo. Achou a 0132 aplicada e não registrada no banco local (o caso real do achado) e acertou. |
| 5. Quantidades | 0133: o pedido de faltas recusa insumo fora das análises do plano e quantidade acima de um teto folgado da demanda; a compra solicitada acompanha ajuste só de embalagem. |
| 3. Backup e recuperação | 0134 registra cada backup e avisa os administradores (Notificações, 8h) quando o último bom passou de 26 h ou houve falha. O script do banco registra e chama a cópia dos arquivos do Storage (anexos e assinaturas), que o `pg_dump` não levava. `npm run backup:ensaio` restaura o backup num banco descartável, confere e mede o tempo (ensaio com esquema real: 66 tabelas, 6,6 s). |
| Acabamentos | Busca e filtros das tabelas guardados ao recarregar; busca com nome acessível; contagem e avisos do scanner anunciados ao leitor de tela; rótulos ligados no inventário. |
| Pendência: DOCX do projeto | Marcado "Uso interno", título com a instituição certa (antes dizia ATGC sempre), arquivos `orcamento-projeto-interno-*`. |
| Onda C | Lista com fases (uma por orçamento; o funil soma a tabela e filtra), colunas Valor e Fase, "Novo orçamento" no topo; histórico de 18 colunas vira lista com "Ver detalhes"; catálogo de análises em cartões no celular; estados "Salvando…/Duplicando…"; telas de erro com "Tentar de novo". |

Testes novos: `scripts/*.test.mjs` (migration, cópia do Storage, ensaio),
`supabase/tests/quantidades_conferidas_0133.sql`, `registro_backups_0134.sql`,
`src/lib/tabela-filtros.test.ts`, `src/lib/orcamento/fase-orcamento.test.ts`,
E2E `acabamentos-auditoria.spec.ts` e `orcamento-onda-c.spec.ts` (as checagens
de largura foram vistas falhando contra o layout antigo).

### Para produção (precisa de autorização do dono)

1. Aplicar 0133 e 0134 com `npm run db:migration` (ensaio antes, backup antes).
2. Na pasta principal `G:\Aplicativos\Kontrol`: atualizar a `main` para a tarefa
   agendada usar o script novo, e conferir no `.env.local` as chaves
   `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` da nuvem (sem elas a
   cópia dos arquivos registra falha e o aviso aparece).
3. Rodar `npm run backup:ensaio` uma vez com o backup real e guardar o relatório.

### Decisões ainda abertas (rodadas anteriores)

D2 (quem solicita pode validar/aprovar a própria compra?), D3 (coordenador do
projeto como usuário), D5 (descarte e bloqueio de lote com o coordenador) e D7
(inventário: fechamento de campanha e segunda aprovação acima de um limite).
