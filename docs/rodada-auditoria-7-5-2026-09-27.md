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
