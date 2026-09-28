# Catálogo vivo do orçamento de projeto: relatório de 28/09/2026

Branch `claude/catalogo-vivo-projeto`, criada a partir de `claude/budget-module-reorganization-143e54` (1.2.1).
Versão **1.2.2**. Fases **A, B, C, D e E concluídas**.

- Desenho e decisões do dono: `docs/superpowers/specs/2026-09-28-orcamento-projeto-catalogo-vivo-design.md`.
- Plano das fases A e B: `docs/superpowers/plans/2026-09-28-orcamento-projeto-catalogo-vivo.md`.

**Nada foi enviado ao GitHub, aplicado em produção ou publicado.** As migrations 0137 a 0140 estão **só no
banco local** (Docker `supabase_db_Estoque`).

## O que mudou para quem usa

### Fases A, B e D (catálogo vivo e edição do catálogo)

1. **O tipo do orçamento decide o que entra na conta.**
   - "Apenas projeto" só soma o projeto, "Apenas análises" só o laboratório, e o misto soma os dois. Os
     parâmetros entram uma vez só.
   - Um módulo fora do tipo que ainda tenha itens bloqueia a emissão com uma explicação.
   - Estar ligado a um projeto não cria mais a etapa de custos num orçamento "Apenas análises" (DC6).
2. **O catálogo aprende com cada orçamento.**
   - Ao concluir a revisão dos custos, item novo entra no catálogo e valor alterado substitui o anterior.
   - Vale o último a concluir. Linha do catálogo sem alteração não desfaz um valor mais novo.
   - Cada orçamento guarda o valor que foi colocado nele (DC5).
3. **Selos no editor:** "Novo no catálogo", "Atualiza o catálogo", "Catálogo hoje: R$ X", "Repetido neste
   orçamento", "Pessoal: aguarda permissão" e, em amarelo, "Catálogo +8 meses" (DC7).
4. **Edição do catálogo** em Orçamentos › Modelos e catálogo, tudo por ícone:
   - novo item, editar, histórico de valores, unificar repetidos, arquivar e reativar;
   - coluna "Atualizado" com o alerta de 8 meses e o filtro "mais de 8 meses".
5. **Pessoal:** a permissão "Valores de pessoal no orçamento" vale por padrão para coordenador, gestor e admin.
   Técnico não tem e vê XXX (DC2/DC8).

### Fase C (editor de custos do projeto)

6. **Campo único para lançar item:** digitar a descrição busca no catálogo da rubrica.
   - Escolher um item preenche unidade e valor. O valor pode ser mudado só para este orçamento; ao concluir, o
     catálogo passa a usar o novo valor.
   - Sem escolher, é item novo e entra no catálogo ao concluir. Se já existir igual, o campo avisa.
   - Mostra a data e a origem do valor e o alerta de 8 meses.
7. **Trocar a rubrica** de uma linha no diálogo de edição (solta o vínculo com o catálogo e limpa os meses do
   pessoal).
8. **Conferência antes de concluir**, na própria confirmação: valor zero, pessoal sem meses marcados, viagem com
   quantidade diferente da calculada, valor diferente do catálogo atual e valor do catálogo com mais de 8 meses.
   Só avisa; não impede.
9. **Análises dentro do projeto (DC3):** a caixa saiu. As análises já lançadas aparecem na aba MC, somam no
   cartão MC e podem ser removidas. Análises novas entram pela etapa Laboratório.
10. **Selos também na grade de pessoal.**

### Fase D (resto)

11. **Planilha do catálogo** em Modelos e catálogo:
    - "Exportar": uma aba por rubrica, só itens ativos; pessoal sai como XXX para quem não tem a permissão.
    - "Importar": primeiro mostra a prévia (novo, muda valor, sem mudança, repetido, sem permissão, erro), com a
      linha da planilha; só grava ao confirmar. Nada é apagado nem arquivado pela planilha. Vale a última linha
      repetida. Números no formato brasileiro.
12. **Valores de pessoal aguardando decisão:** quando alguém sem a permissão de pessoal conclui uma revisão com
    pessoal, o valor fica pendente. Quem tem "Modelos e catálogos" + pessoal vê o painel no catálogo e aplica
    (✓) ou descarta (✕).

### Fase E (tudo editável, reformulação e modelos)

13. **Reabrir revisão** em qualquer situação menos cancelado (DC4).
    - Revisado ou recusado: volta para edição.
    - **Proposta aprovada = reformulação:** o botão vira "Reformular (reabrir)" e pede o motivo (ex.: pedido do
      órgão concedente). O editor mostra "Reformulação da proposta X".
    - Na etapa Proposta final, junto de "Emitir versão final": "a versão emitida agora, quando aprovada, substitui
      a X".
    - A nova versão mostra "Reformulação da X". Aprovada (pela equipe ou pelo link), ela **substitui** a anterior:
      a anterior vira "substituído" e fica no histórico; o acompanhamento de fundos e o planejamento passam para a
      nova.
14. **Trava no banco:** linhas de custo de revisão concluída, aprovada ou cancelada não mudam (antes só a tela
    impedia).
15. **Modelos dentro da proposta:** "Usar modelo" (os itens entram com o valor atual do catálogo; nada é apagado)
    e "Salvar como modelo" (exige "Modelos e catálogos"; pessoal vai sem valor). O fluxo antigo "Usar" da página
    de Modelos, que criava orçamento solto, saiu.

### Pessoal protegido também fora do catálogo (DC8)

16. Sem a permissão de pessoal:
    - no editor, os valores de PE, o total de PE e o custo do projeto aparecem como XXX; PE fica só leitura; a
      exportação do editor não é oferecida quando há pessoal;
    - na visão interna (etapa Proposta final e versão emitida), as linhas e o subtotal de PE aparecem como XXX; a
      "Planilha interna (XLSX)" da versão não é oferecida quando há pessoal;
    - o banco recusa lançar, alterar ou remover linha de pessoal (0140).
17. **Caixas do formulário "Dados do orçamento"** mais bem delimitadas (fundo, borda e título), pedido do dono.

## Banco

| Migration | Conteúdo |
|---|---|
| 0137 `catalogo_vivo_projeto` | Identidade do item, unificação dos 3 pares repetidos (maior valor, DC1), histórico de valores, `catalogo_valor_base`, prévia e conclusão com trava, permissão de pessoal |
| 0138 `catalogo_edicao` | Salvar item, arquivar e reativar, unificar, histórico |
| 0139 `reformulacao_modelos_pendencias` | Trava das linhas de custo; reabrir e reformular (`reabrir_revisao_custos_projeto`); emissão e aprovação aceitam a reformulação e substituem a aprovada; `aplicar_modelo_orcamento_projeto`; pendências de pessoal; `catalogo_projeto_importar` |
| 0140 `pessoal_linhas_projeto` | Gatilho: linha PE só com a permissão de pessoal (vínculo com catálogo, cascata e manutenção sem usuário seguem livres) |

Todas aditivas. Rollback no cabeçalho de cada uma.

## Testes

- Unitários (vitest): **867 verdes** (115 arquivos). Novos desta rodada: ações de reabrir, modelo, item único,
  troca de rubrica, pendências e importação; leitura e montagem da planilha; conferência; máscara da visão interna.
- SQL no banco local, todos verdes e no CI: `catalogo_vivo_projeto_0137`, `catalogo_edicao_0138`,
  `reformulacao_modelos_0139` (trava, reabrir, modelo, reformulação pela equipe e pelo link, recusa sem
  reformulação, pendências, importação), `pessoal_linhas_projeto_0140`, e os anteriores do orçamento (0112, 0121,
  0122, 0126, 0132, 0135).
  - Fora do escopo e falhando só no banco local: `estoque_ciclo_0127` (regra da 0136 de outra branch aplicada no
    banco local) e `registro_backups_0134` (estado local).
- E2E com o Supabase simulado (`npm run test:e2e`, com build): **51 verdes**. O teste do editor agora usa o
  campo único (item do catálogo e item novo) e termina reabrindo a revisão.
- Conferência na tela (porta 56282, banco local), proposta nº 74:
  - campo único (sugestões com valor, escolha preenche, valor alterado, item novo);
  - selo "Atualiza o catálogo"; conferência antes de concluir (valor zero e pessoal sem meses);
  - conclusão gravou MC-165 novo e PE-8 de R$ 3.100 para R$ 3.200 no catálogo;
  - emissão bloqueada pelo item zerado; reabrir, corrigir, concluir e emitir a OF-2026-0074-v1;
  - v1 aprovada; reaberta como reformulação (sem motivo é recusada); avisos na etapa e na emissão aparecem.
  - A emissão da v2 e a substituição foram verificadas pelo teste SQL da 0139 (a janela do app ficou oculta e a
    automação não conseguiu clicar).

## Dados de teste no banco local

- Propostas 73 e 74 ("TESTE CATÁLOGO VIVO…").
- **A 74 ficou em reformulação da OF-2026-0074-v1**, com a quantidade do brinde em 2: dá para concluir, emitir a
  v2, aprovar e ver a v1 virar "substituído".
- Itens de teste no catálogo: MC-106, MC-124 (arquivado), MC-165 "TESTE brinde de campo".
- Valores alterados no banco local pelos testes: Papel toalha (MC-6) R$ 60; PE-8 R$ 3.200. O histórico mostra o
  caminho. A produção não foi tocada.

## Para levar à produção (quando o dono pedir)

1. Backup lógico de `orcamento_projeto_catalogo`, `orcamento_projeto_custos`, `orcamento_projetos`,
   `orcamento_final_versoes`, `orcamento_fundos_acompanhamento`, `orcamento_projeto_templates` e
   `permissoes_categorias`.
2. Para cada migration, na ordem **0137, 0138, 0139, 0140**:
   `npm run db:migration -- --arquivo supabase/migrations/<arquivo>.sql --env-file <produção> --ensaio`, conferir,
   e depois rodar sem `--ensaio`.
3. Integrar a branch (versão 1.2.2) e publicar. A branch nasceu da `budget-module-reorganization` (1.2.1, ainda
   sem deploy) e o PR #51 (0136, também 1.2.1) está separado: juntar os três num único deploy, conferindo a
   numeração das migrations (0136 do PR #51 antes da 0137) e a versão final.
4. Depois de publicar: abrir uma proposta de projeto, lançar um item pelo campo único e conferir o catálogo.
5. Rollback: comandos no cabeçalho de cada migration.

## Pendências e limites conhecidos

- **Leitura direta pela API:** a tela esconde o pessoal, mas quem vê orçamentos ainda consegue ler os valores de
  PE das linhas de custo e das versões emitidas chamando a API diretamente. Fechar isso exige uma visão mascarada
  e revogar a coluna, o que muda todas as leituras de custos. Proposta para uma próxima rodada.
- **Total da proposta:** o total e os percentuais continuam visíveis (são o preço); com um só profissional, o
  custo total de pessoal pode ser deduzido por subtração.
- **Modelos antigos** (vindos do app antigo) podem ter valores de pessoal gravados nos itens; os novos saem sem
  valor. Limpar os antigos é alteração de dados e fica para decisão do dono.
- **Técnico com "Criar/editar orçamentos"** por padrão: o dono disse que técnico não faz orçamento. Tirar essa
  caixinha do padrão do técnico é decisão do dono (muda permissões em produção).
- **Item com valor zero** entra no catálogo ao concluir (a conferência avisa). Pode ser arquivado no catálogo.
