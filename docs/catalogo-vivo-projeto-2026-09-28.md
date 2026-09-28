# Catálogo vivo do orçamento de projeto: relatório de 28/09/2026

Branch `claude/catalogo-vivo-projeto`, criada a partir de `claude/budget-module-reorganization-143e54` (1.2.1).
Versão **1.2.2**.

- Desenho e decisões do dono: `docs/superpowers/specs/2026-09-28-orcamento-projeto-catalogo-vivo-design.md`.
- Plano das fases A e B: `docs/superpowers/plans/2026-09-28-orcamento-projeto-catalogo-vivo.md`.

**Nada foi enviado ao GitHub, aplicado em produção ou publicado.** As migrations 0137 e 0138 estão **só no
banco local** (Docker `supabase_db_Estoque`).

## O que mudou para quem usa

1. **O tipo do orçamento decide o que entra na conta.**
   - "Apenas projeto" só soma o projeto, "Apenas análises" só o laboratório, e o misto soma os dois. Os
     parâmetros entram uma vez só.
   - Um módulo fora do tipo que ainda tenha itens bloqueia a emissão com uma explicação ("mude o tipo ou retire
     os itens").
   - Estar ligado a um projeto não cria mais a etapa de custos num orçamento "Apenas análises" (DC6).
2. **O catálogo aprende com cada orçamento.**
   - Ao concluir a revisão dos custos, item novo entra no catálogo e valor alterado substitui o anterior.
   - Vale o último a concluir.
   - Linha que veio do catálogo sem alteração não desfaz um valor mais novo.
   - Cada orçamento guarda o valor que foi colocado nele (DC5).
3. **Selos no editor de custos:**
   - "Novo no catálogo";
   - "Atualiza o catálogo";
   - "Catálogo hoje: R$ X" (só informa);
   - "Repetido neste orçamento";
   - "Pessoal: aguarda permissão".
4. **A confirmação de "Concluir revisão"** lista o que vai mudar no catálogo. O aviso final resume o que foi
   gravado.
5. **O seletor do catálogo** mostra a data e a origem do valor: proposta, ajuste no catálogo ou carga inicial.
   Mostra também o alerta amarelo depois de 8 meses (DC7).
6. **Edição do catálogo** na seção "Catálogo institucional de custos" de Modelos e catálogo:
   - novo item, editar (rubrica, descrição, unidade, grupo e valor);
   - histórico de valores (data, o que houve, valor, valor anterior, origem e pessoa);
   - unificar repetidos, arquivar e reativar;
   - tudo por ícone, com o nome da ação ao passar o mouse;
   - coluna "Atualizado" com o alerta de 8 meses e o filtro "mais de 8 meses".
   - Gravar exige "Modelos e catálogos".
7. **Pessoal:** a nova permissão "Valores de pessoal no orçamento" vale por padrão para coordenador, gestor e
   admin. Técnico não tem e vê XXX (DC2/DC8).
8. **Ações das listas por ícone** em Modelos e no Histórico: duplicar, arquivar e cancelar.

## Banco

| Migration | Conteúdo |
|---|---|
| 0137 `catalogo_vivo_projeto` | Identidade do item (rubrica + descrição + unidade normalizadas, índice único) |
| | Unificação dos 3 pares repetidos: MC-30→MC-14, MC-11→MC-23, MC-15→MC-29. Ficou o maior valor (DC1) |
| | Histórico de valores `orcamento_projeto_catalogo_valores`, com a carga inicial |
| | `catalogo_valor_base` nas linhas de custo |
| | Prévia e conclusão com a trava do catálogo |
| | Permissão de pessoal: função única `pode_ver_pessoal_orcamento` e padrão das categorias coordenador e gestor |
| | Listagem com a origem do valor |
| 0138 `catalogo_edicao` | Salvar item, arquivar e reativar, unificar, histórico, todos com a mesma trava e as mesmas permissões |

## Testes

- Unitários (vitest): tudo verde. Os novos cobrem:
  - consolidação por tipo;
  - leitura da prévia e selos;
  - regras de tela do catálogo;
  - ações do catálogo;
  - permissão nova;
  - mensagem de item repetido;
  - ícones.
- SQL no banco local:
  - `catalogo_vivo_projeto_0137.sql` cobre item novo, alterar, vincular, repetido, "vale o último", "linha
    antiga não desfaz", pessoal pendente e permissões;
  - `catalogo_edicao_0138.sql`;
  - `salario_tecnicos_0112.sql`, ajustado para medir só o salário.
  - Os três passam, e os três rodam no CI.
- E2E com o Supabase simulado (`npm run test:e2e`, com build): 51 testes verdes.
  - A contagem de caixinhas de permissão em `usuarios-permissoes.spec.ts` passou de 37 para 38, por causa da
    permissão nova.
  - Em `salario-tecnicos.spec.ts`, técnico vê XXX e coordenador vê o valor de pessoal.
- Conferência na tela (servidor desta branch com o banco local), com duas propostas simuladas:
  - "TESTE CATÁLOGO VIVO 28/09" (nº 73) e "TESTE CATÁLOGO VIVO 2 28/09" (nº 74);
  - selos, confirmação e aviso de conclusão;
  - catálogo atualizado e histórico;
  - a segunda proposta recebe o valor novo com a origem;
  - criar, editar, histórico, arquivar e unificar na seção do catálogo.
- Observação: durante o teste com a ferramenta de automação, o formulário de edição foi enviado duas vezes sem
  clique em "Salvar". Os dois envios não mudaram o valor, então não geraram linha no histórico.
  - Não se repetiu com a página parada nem no uso passo a passo.
  - O envio normal foi confirmado pelo registro de quem enviou ("Salvar alterações").
  - Se isso aparecer no uso real, avisar.

## Dados de teste no banco local

- Propostas 73 e 74 com projetos "TESTE CATÁLOGO VIVO…".
- Itens MC-106 "TESTE Reagente Alfa" e MC-124 "TESTE Reagente Beta" (arquivado).
- **Papel toalha (MC-6) ficou em R$ 60 no banco local**, depois dos testes (era R$ 50). O histórico mostra o
  caminho.
- A produção não foi tocada.

## Para levar à produção (quando o dono pedir)

1. Backup lógico de `orcamento_projeto_catalogo`, `orcamento_projeto_custos`, `orcamento_projetos` e
   `permissoes_categorias`.
2. `npm run db:migration -- --arquivo supabase/migrations/0137_catalogo_vivo_projeto.sql --env-file <produção> --ensaio`.
   Depois rodar sem `--ensaio`, e fazer o mesmo com a 0138.
3. Integrar a branch (versão 1.2.2; reajustar se o PR #51, também em 1.2.1, entrar antes) e publicar.
4. Rollback: comandos no cabeçalho de cada migration.

## Ficou para as próximas fases

- **C (editor):**
  - campo único de busca com criação no próprio campo;
  - selos também na grade de pessoal;
  - trocar rubrica de uma linha;
  - lista de conferência antes de concluir;
  - tirar a caixa "Análises dentro do projeto" para lançamentos novos (DC3);
  - cartão MC coerente.
- **D (resto):** painel "pessoal pendente" e planilha (exportar e importar).
- **E:**
  - reabrir a revisão em qualquer situação, inclusive aprovada, como reformulação (DC4);
  - trava no banco para linhas de custo de módulo concluído;
  - salvar e usar modelo.
