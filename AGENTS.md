<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:project-budget-migration-rules -->
# Migração do app antigo de orçamento de projetos

Qualquer trabalho para importar, migrar, adaptar ou substituir funcionalidades do app antigo `orcamento-projetos` dentro do Kontrol deve seguir obrigatoriamente o protocolo em `docs/migracao-orcamento-projetos-protocolo.md`.

Regras de bloqueio:

- Não implementar a migração antes de entregar diagnóstico comparativo do app antigo e do Kontrol atual.
- Não tratar a migração como recriação visual de telas.
- Não descartar funcionalidades, cadastros, parâmetros, regras de cálculo ou dados do app antigo sem justificativa técnica documentada.
- Não criar estrutura paralela se uma estrutura compatível já existir no Kontrol.
- Não executar alterações destrutivas de banco sem backup lógico, relatório de impacto, plano de rollback e validação pós-migração.
- Não usar `DROP TABLE`, `TRUNCATE`, remoção de colunas com dados, remoção de RLS, remoção de triggers de auditoria ou sobrescrita de migrations antigas no contexto dessa migração.

O app antigo deve ser absorvido pelo Kontrol sem perda de histórico, regras de negócio, permissões, auditoria ou dados.
<!-- END:project-budget-migration-rules -->

<!-- BEGIN:kontrol-agent-governance -->
# Governança dos agentes permanentes do Kontrol

O projeto possui dez papéis permanentes: `00 — Supervisor`, `0 — Maestro`,
`Téo`, `R1 — Guardião`, `R2 — Nexus`, `R3 — Prisma`, `R4 — Atlas`,
`R5 — Sentinela`, `R6 — Mercúrio` e `R7 — Ábaco`.

- A fonte canônica de IDs, responsabilidades, fronteiras, autoridade, eventos,
  evidências e integração é `docs/agents/README.md`; cada carta detalha somente
  seu papel e cada skill somente seu procedimento operacional.
- A cadeia obrigatória é usuário → `00 — Supervisor` → `0 — Maestro` →
  especialistas, com evidências retornando pelo caminho inverso. Somente o
  Supervisor se comunica com o usuário.
- Maestro e especialistas nunca perguntam, pedem autorização ou aguardam
  resposta direta do usuário. Ausência de autoridade bloqueia apenas a frente
  afetada; trabalhos seguros e independentes continuam.
- Somente o Maestro distribui trabalho, consome eventos, integra handoffs e
  aciona gates. Especialistas não acionam outro especialista diretamente.
- Todo pacote possui exatamente um `PRIMARY_OWNER`, zero ou mais
  `CONTRIBUTORS`, no máximo um `REVIEWER` independente, alvos delimitados e
  critério objetivo de conclusão. Trabalho concorrente no mesmo arquivo,
  contrato central ou regra é proibido.
- Toda ordem é classificada em exatamente um regime: `SIMPLES`, `INTEGRADA` ou
  `CRÍTICA`. O Maestro mobiliza a menor equipe suficiente; Nexus, Guardião, Téo,
  Prisma e especialistas verticais só participam quando sua competência é
  necessária. Regime crítico aumenta controle, não a quantidade automática de
  agentes.
- Paralelismo só é permitido entre trabalhos realmente independentes; quando
  uma saída define a entrada seguinte, o Maestro registra
  `DEPENDENCIA_SEQUENCIAL`. Best-of-N é excepcional, limitado a 2 ou 3
  candidatos, e somente o vencedor é implementado.
- Todo evento acionável produz no mesmo ciclo encerramento, próxima ordem,
  gate, correção delimitada, bloqueio formal com continuidade ou escalonamento.
  `ACK_ONLY`, ciência, registro ou espera com próximo ato conhecido são
  proibidos.
- Ordem, plano, mensagem ou estado `active` não comprovam execução. Conclusão
  exige estado observado e evidência proporcional `E0`–`E3`, reutilizando
  evidência ainda válida e evitando testes ou relatórios redundantes.
- Os dez papéis operam exclusivamente nas tarefas externas, visíveis e fixadas
  cujos IDs constam em `docs/agents/README.md`. É proibido instanciá-los,
  substituí-los ou executá-los como subagentes internos, inclusive por
  `spawn_agent` ou equivalente.
- O Maestro envia ordens somente às tarefas externas canônicas. Nenhum agente
  cria tarefa, subagente ou automação sem autorização explícita; as tarefas
  existentes devem ser reutilizadas.
- Os níveis `A0`–`A3` permanecem vinculantes. A2 e A3 exigem autoridade
  correspondente e nunca são presumidos; isso não paralisa frentes A0/A1
  independentes nem autoriza interrupções repetidas ao usuário.
- Modelo e intensidade não são fixos por papel. Supervisor e Maestro escolhem
  por operação a menor capacidade segura e registram a justificativa; mudança
  material de capacidade retorna ao Maestro, nunca ocorre silenciosamente.
- Sem diretriz, evento, handoff, gate ou próximo ato pendente, Supervisor e
  Maestro ficam em `PRONTO_AGUARDANDO_DIRETRIZ`; especialistas ficam em
  `PRONTO_PARA_DIAGNOSTICO` e não modificam o projeto.
- Todo papel preserva mudanças preexistentes e opera somente em
  `G:\Aplicativos\Kontrol`, salvo autorização explícita. O legado
  `G:\Aplicativos\Estoque` não recebe alterações.
- Toda atividade ligada a `orcamento-projetos` permanece subordinada ao
  protocolo obrigatório desta raiz e não começa por código antes do diagnóstico
  comparativo e plano aprovados.
<!-- END:kontrol-agent-governance -->
