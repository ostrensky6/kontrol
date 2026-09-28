# Orçamento de projeto: catálogo vivo de custos (desenho)

Data: 2026-09-28 · Situação: **decisões do dono tomadas (DC1–DC8); fases A, B e D (edição do catálogo)
implementadas em 28/09** na branch `claude/catalogo-vivo-projeto` (1.2.2, migrations 0137 e 0138, só no banco local).
Relatório: `docs/catalogo-vivo-projeto-2026-09-28.md`.
Base de código: branch `claude/budget-module-reorganization-143e54` (1.2.1). A execução começa depois que a sessão
aberta nessa branch fizer commit do que está editando (Modelos, Parâmetros, Governança, formulário do orçamento).

Documentos relacionados:

- Auditoria de 28/09 (nesta conversa): catálogo fixo, itens repetidos, trava depois de concluir, modelos inúteis.
- Diagnóstico comparativo do app antigo: `docs/migracao-orcamento-projetos-diagnostico-2026-09-25.md`, que já listava
  "criar e editar item do catálogo" e "importar planilha" como lacunas (Etapa C).
- Protocolo obrigatório: `docs/migracao-orcamento-projetos-protocolo.md`.
- Plano de implementação das fases A e B: `docs/superpowers/plans/2026-09-28-orcamento-projeto-catalogo-vivo.md`.

---

## 1. Princípio: dois tipos de orçamento, duas fontes de custo

| Tipo do orçamento | De onde vem o custo | Parâmetros aplicados depois |
|---|---|---|
| Apenas análises laboratoriais | **Custeio** do laboratório: custo de cada análise (reagentes, pessoal técnico, equipamentos, insumos) | impostos, incubação, reserva, investimentos e lucro |
| Apenas projeto | **Catálogo de custos de projeto**: a planilha que aprende com cada orçamento | os mesmos |
| Projeto com análises laboratoriais | os **dois**, somados | os mesmos, aplicados **uma única vez** sobre a soma |

As duas fontes são independentes. O laboratório nunca lê o catálogo e o projeto nunca lê o Custeio.
Os parâmetros (impostos, taxas, fundos e margem) incidem uma única vez sobre o custo total:
total = custo ÷ (1 − soma dos %).

**O que já está certo hoje:** o cálculo com os parâmetros é um só em todo o app, e cada proposta emitida guarda
uma cópia congelada dos valores.

**O que está errado hoje:**
- A soma inclui itens de um módulo que não pertence ao tipo. Exemplo: um orçamento mudado para "Apenas projeto"
  que ainda tem análises lançadas no laboratório. Isso é corrigido na Fase A.
- A etapa de custos de projeto aparece só porque o orçamento está ligado a um projeto, mesmo quando o tipo é
  "Apenas análises". Isso é corrigido na Fase A e depende da decisão DC6.

## 2. Regras do catálogo vivo (decididas pelo dono em 28/09)

1. **Um item é rubrica + descrição + unidade.** A comparação ignora maiúsculas, acentos e espaços repetidos, e
   trata como iguais variações comuns da unidade: `un`/`unid`/`unidade`, `L`/`litro`, `mês`/`meses` e outras da
   lista técnica. "Microtubos · un" e "Microtubos · pct c/500" são itens diferentes. Cada item tem **um valor só**.
2. **O valor vira referência ao concluir a revisão dos custos.** Rascunhos e testes abandonados nunca mexem no
   catálogo.
3. **Item novo entra no catálogo; valor diferente sobrepõe o anterior.** O valor antigo sai da lista e fica no
   histórico do item, com data, proposta e pessoa. Não aparece como segunda opção.
4. **Vale o último a concluir.** Exemplo: as propostas A e B criam o mesmo item novo, a A com R$ 100 e a B com
   R$ 120. Se a B conclui primeiro e a A depois, o catálogo fica com R$ 100, e o histórico mostra os dois
   valores. Duas conclusões nunca gravam ao mesmo tempo: a segunda espera a primeira terminar.
5. **Só conta o que foi digitado.** Uma linha que veio do catálogo e não foi alterada **não grava** na conclusão.
   Assim, um orçamento antigo não desfaz um valor mais novo que outra proposta gravou. É isso que resolve a
   desvantagem de dois orçamentos abertos ao mesmo tempo.
6. **Cada orçamento vale o valor que foi colocado nele** (DC5, decidido em 28/09).
   - O catálogo guarda sempre o valor mais atual, mas nenhum orçamento muda sozinho.
   - Quem faz um orçamento depois tem liberdade para alterar o valor naquele orçamento; o orçamento anterior
     continua com o valor dele.
   - Se o catálogo mudou depois que o item entrou num orçamento aberto, a linha mostra só uma etiqueta
     informativa ("catálogo hoje: R$ X").
7. **Propostas emitidas nunca mudam.** Cada uma guarda a cópia dos valores da época.
8. **Mostrar a origem.** Em todo lugar onde o catálogo aparece, mostrar o valor com a data e a proposta de onde
   veio. Exemplo: "R$ 130,00/litro · atualizado em 12/09/2026 na proposta 'Monitoramento Rio X'".
9. **Pessoal (PE) aparece para quem faz orçamento.** O dono decidiu em 28/09 que o valor de pessoal pode ser
   exibido para quem trabalha no orçamento e não aparece para quem não tem permissão.
   - Como o técnico já tem "Criar e editar orçamentos" por padrão, a regra usa uma **permissão própria**,
     "Orçamentos: valores de pessoal" (DC8). Decisão de 28/09: por padrão ela vale para **coordenador, gestor
     (diretoria) e admin**; **técnico não tem**, porque técnico não faz orçamento.
   - Com ela, a pessoa vê e grava os valores de pessoal normalmente. Sem ela, o valor aparece como XXX.
   - Quem já tem "Ver salário dos técnicos" continua vendo.
   - Se alguém sem a permissão concluir uma revisão, o valor de pessoal não vai para o catálogo e fica
     **pendente** para quem tem a permissão.
10. **Valor velho é sinalizado em amarelo.** Um item sem atualização há mais de **8 meses** ganha um alerta
    amarelo, "valor de mais de 8 meses: atualize", no editor e na tela do catálogo (DC7).

## 3. O que muda para quem usa

**Custos do projeto (editor)**
- Um campo só, "Item", com busca no catálogo da rubrica. Mostra o valor de referência, a data e a proposta de
  origem. Se o item não existe, ele é criado ali mesmo e marcado **Novo no catálogo**.
- Aviso "valor de mais de 8 meses: atualize" em amarelo (DC7).
- Selo em cada linha, inclusive no pessoal:
  - **Catálogo**: igual ao catálogo.
  - **Atualiza o catálogo (R$ 50 → R$ 55)**.
  - **Novo no catálogo**.
  - **Catálogo hoje: R$ 60** (só informa; o orçamento mantém o próprio valor).
  - **Repetido neste orçamento**.
  - **Pessoal: aguarda permissão**.
  - **Valor de mais de 8 meses** (amarelo).
- Dá para trocar a rubrica de uma linha sem apagar e lançar de novo.
- Antes de concluir aparece uma lista de conferência:
  - itens com valor zero;
  - pessoal sem meses marcados;
  - viagens com quantidade diferente da calculada;
  - linhas com valor antigo do catálogo.
- A conclusão mostra o que vai acontecer no catálogo ("2 itens novos, 1 valor atualizado: Papel toalha
  R$ 50 → R$ 55") e pede confirmação. Depois de concluir aparece o resumo do que foi gravado.

**Catálogo de custos (na seção "Catálogo institucional de custos" de `/orcamento/modelos`)**

Na execução de 28/09, a edição ficou onde o dono já procurava, sem rota nova. Feito nessa data:
- novo item, editar, arquivar, reativar e unificar, todos por ícone;
- histórico de valores;
- coluna "Atualizado" com alerta amarelo depois de 8 meses e o filtro correspondente.

Ficam para depois: o painel de pessoal pendente e a planilha (exportar e importar).
- Lista compacta por rubrica e grupo, com busca, valor, unidade, data e proposta de origem, e um filtro
  "valores de mais de 8 meses", destacados em amarelo.
- Criar item. Editar descrição, unidade, grupo e valor; mudar o valor grava o histórico.
- Arquivar e reativar. **Unificar** dois itens que são o mesmo: um fica e o outro aponta para ele.
- Histórico de cada item: todos os valores, com data, proposta e pessoa.
- Painel "Pessoal pendente", para quem tem a permissão de valores de pessoal aplicar ou descartar.
- Exportar planilha XLSX e importar planilha no formato do app antigo, com abas PE, MC, MP, ST, VD e OU e
  números no formato brasileiro. A importação passa pelas mesmas regras e mostra a prévia antes de gravar.

**Reabrir e reaproveitar**
- **Reabrir revisão dos custos em qualquer situação** (DC4, decidido em 28/09): tudo pode ser editado.
  - Isso vale também para a proposta **aprovada**, porque o órgão concedente pode pedir reformulação. Nesse
    caso a tela pede confirmação ("esta proposta está aprovada; a alteração vira uma reformulação").
  - Cada nova emissão gera nova versão. As versões anteriores, inclusive a aprovada, continuam congeladas no
    histórico.
  - Uma reformulação aprovada **substitui** a aprovação anterior.
  - O que acontece com o planejamento já criado a partir da versão aprovada é decidido com o dono no plano da
    Fase E.
- **Salvar como modelo** e **Usar modelo** dentro da própria proposta. O modelo guarda itens e quantidades; os
  valores vêm do catálogo no momento do uso, nunca do valor velho gravado no modelo.

**Em todo o módulo Orçamentos: ações por ícone** (pedido do dono em 28/09)
- Nas listas e tabelas, as ações aparecem como ícones, sem texto: editar (lápis), arquivar (caixa), excluir ou
  remover (lixeira), duplicar (cópias), cancelar (círculo cortado) e reativar (caixa com seta).
- Ao passar o mouse aparece o nome da ação. O leitor de tela lê o nome completo.
- Links de navegação ("Abrir / PDF", "Comparar") e os botões grandes do topo da página continuam com texto.

**Onde editar o catálogo hoje:** em lugar nenhum. A página "Modelos e catálogo" (`/orcamento/modelos`) só
lista e arquiva; criar e editar item nunca existiram no Kontrol (lacuna já registrada no diagnóstico de 25/09).
Por isso a tela de edição (Fase D) vem logo depois da Fase B.

## 4. Achados da auditoria e onde cada um é resolvido

| Achado | Fase |
|---|---|
| Soma inclui módulo que não pertence ao tipo do orçamento | A |
| Ligação com projeto força a etapa de projeto num orçamento "Apenas análises" | A (DC6) |
| Catálogo fixo: não aprende valores nem itens novos | B |
| 3 pares com mesma rubrica, descrição e unidade (Caixa térmica, Pinças, Rack para microtubo) | B (DC1) |
| Item do catálogo editado continua marcado "Catálogo" | B (selo) e C |
| Não há como criar ou editar item do catálogo | D |
| Valores suspeitos no catálogo (Frascos de coleta, Kits Bioanalyzer, Sequenciamento Illumina, Seguro, PE-2) | D: conferência do dono pela tela nova |
| Rubrica OU sem nenhum item no catálogo | B e D: passa a ser alimentada pelos orçamentos |
| Não dá para trocar a rubrica de uma linha | C |
| Cartão MC não soma as análises do projeto, mas o total e a planilha somam | C (DC3) |
| Viagens: "Salvar e recalcular" apaga ajustes manuais sem mostrar quais | C (lista de conferência) |
| Depois de concluída, a revisão não reabre (nenhuma tela marca "recusado") | E (DC4) |
| Linhas de custo protegidas só pelo app; o banco não trava edição de módulo concluído | E (trava no banco) |
| "Usar modelo" desligado e sem "Salvar como modelo" | E |
| Evento de arquivamento de item do catálogo gravado com número 0 | D |
| Ações sem tela (`salvarOrcamentoProjeto`, `cancelarOrcamentoProjeto`, `excluirOrcamentoProjeto`) | E: decidir entre religar e remover |
| Pessoal do catálogo inacessível para quem faz orçamento sem a permissão de salário | B: permissão própria "Orçamentos: valores de pessoal" (DC8); D: painel de pendências |

## 5. Fases

Cada fase é entregue e testada sozinha. **Ordem de execução: A → B → D → C → E.** A tela do catálogo (D) vem
antes do editor (C) porque o dono precisa editar o catálogo. Nenhuma fase tem deploy de produção sem pedido do
dono.

| Fase | Entrega | Banco | Critério de aceite |
|---|---|---|---|
| **A — Tipo do orçamento manda** | A soma e a emissão só consideram os módulos do tipo. Módulo fora do tipo com itens gera pendência clara ("mude o tipo ou retire os itens"). Ligação com projeto não cria etapa de custos (DC6). Ações das listas por ícone. | nenhum | testes de consolidação com os 3 tipos; orçamento "Apenas projeto" com análises esquecidas não emite |
| **B — Catálogo vivo: memória de valores** | Permissão "Orçamentos: valores de pessoal" (DC8). Migration 0137: identidade do item, histórico de valores, unificação dos repetidos, conclusão que grava no catálogo (último vence, só o digitado, pessoal com permissão). Selos por linha e resumo na conclusão. Data e origem no seletor do catálogo. | 0137 (aditiva) | teste SQL cobrindo item novo, valor alterado, vínculo, repetido, último vence, linha antiga que não desfaz, pessoal pendente e permissões; teste unitário dos selos e do resumo |
| **C — Editor que conversa com o catálogo** | Campo único com busca e valor de referência; selos no pessoal; etiqueta "catálogo hoje" sem troca automática (DC5); tirar a caixa "Análises dentro do projeto" para lançamentos novos (DC3); trocar rubrica; lista de conferência antes de concluir; alerta amarelo de valor com mais de 8 meses; cartão MC coerente. | nenhum previsto | E2E: lançar item novo, concluir, abrir outro orçamento e ver o valor sugerido com origem |
| **D — Tela do catálogo** | `/orcamento/catalogo` com criar, editar (descrição, unidade, grupo, valor), arquivar, reativar, unificar, histórico, pendências de pessoal, exportar e importar planilha; ações por ícone. O menu "Modelos e catálogo" passa a apontar para ela. | 0138: RPCs de gravação do catálogo com a mesma trava da conclusão | teste SQL das RPCs; E2E de criar, editar, ver histórico, unificar e importar |
| **E — Reabrir e reaproveitar** | Reabrir revisão em qualquer situação, inclusive aprovada, como reformulação (DC4); trava no banco para linhas de custo de módulo concluído; salvar e usar modelo na proposta com valores atuais do catálogo; limpeza das ações sem tela. | 0139: transições enviado → rascunho e aprovado → rascunho (reformulação); aprovação da reformulação substitui a anterior; trigger nas linhas | teste SQL das transições, da substituição da aprovação e da trava; E2E: concluir, reabrir, alterar, concluir de novo e ver o catálogo atualizado |
| F — opcional | Evolução de preço por item, itens mais usados, reajuste em lote (ex.: +5% em VD). | — | só se o dono pedir |

Os planos detalhados das fases C, D e E são escritos quando a fase anterior termina, sobre o código já
alterado.

## 6. Decisões do dono

Decididas pelo dono em 28/09:

| # | Decisão |
|---|---|
| — | Gravar ao concluir a revisão; vale o último a concluir; a unidade faz parte do item; mostrar a origem do valor |
| DC1 | Nos três pares repetidos (Caixa térmica R$ 150 × R$ 80; Pinças R$ 40 × R$ 30; Rack para microtubo R$ 30 × R$ 40) **fica agora o maior valor**. Daí em diante vale o valor mais recente salvo no dia a dia. Microtubos (un × pct) e EPI (MC × MP) continuam separados pela regra |
| DC2 | O valor de pessoal é exibido para quem trabalha no orçamento e oculto para quem não tem permissão. Detalhe em DC8 |
| DC4 | **Tudo pode ser editado**, inclusive a proposta aprovada (reformulação pedida pelo órgão concedente). As versões anteriores ficam congeladas no histórico |
| DC3 | **Tirar a caixa "Análises dentro do projeto"** para lançamentos novos: não pode haver dois lugares para a mesma análise. Quem precisa de análises usa o tipo "Projeto com análises" e lança na etapa Laboratório. O que já foi lançado continua valendo e aparece só para leitura |
| DC5 | **Cada orçamento vale o valor que foi colocado nele.** O catálogo guarda sempre o mais atual; nada muda sozinho num orçamento aberto; quem orça depois pode alterar o valor no orçamento dele |
| DC6 | **O tipo decide**: orçamento "Apenas análises" não mostra a etapa de custos de projeto, mesmo ligado a um projeto |
| DC7 | Valor com **mais de 8 meses** sem atualização ganha alerta **amarelo** pedindo atualização |
| DC8 | **Permissão própria**, "Orçamentos: valores de pessoal". Por padrão vale para coordenador, gestor (diretoria) e admin; técnico não tem. Com ela a pessoa vê e lança; sem ela vê XXX |

Nenhuma decisão pendente.

## 7. Arquitetura técnica

**Reaproveitamento, sem estrutura paralela (protocolo):**
- O catálogo continua sendo `orcamento_projeto_catalogo`. Ele ganha as colunas de identidade, origem e
  unificação.
- As linhas continuam em `orcamento_projeto_custos`, com a coluna nova `catalogo_valor_base`.
- A única tabela nova é `orcamento_projeto_catalogo_valores`, o histórico de valores. Ela se justifica porque:
  - a trilha genérica (`auditoria`) guarda linhas inteiras em JSON, com política restritiva para pessoal, e não
    tem proposta de origem nem estado "pendente";
  - o histórico de preço por item precisa ser listado e filtrado na tela.

**Identidade do item**
- Duas funções imutáveis no banco: `kontrol_private.normalizar_texto_catalogo` e
  `kontrol_private.normalizar_unidade_catalogo`.
- Colunas geradas `chave_descricao` e `chave_unidade`.
- Índice único parcial `(rubrica, chave_descricao, chave_unidade) where substituido_por is null`.
- O banco é a única fonte da regra; o TypeScript não repete a normalização.

**Conclusão**
- `public.previa_catalogo_revisao_projeto(id)`: somente leitura. Devolve, linha a linha, o que a conclusão faria:
  `novo`, `atualizar`, `vincular`, `inalterado`, `repetido` ou `pendente_permissao`, com o valor atual do
  catálogo (mascarado para pessoal sem permissão).
- `public.concluir_revisao_custos_projeto(id, observacao)`: uma transação só, na ordem abaixo.
  1. Confere a permissão `orcamentos.emitir`, o status e se há itens.
  2. Pega uma trava exclusiva do catálogo (`pg_advisory_xact_lock`).
  3. Aplica a prévia recalculada dentro da trava.
  4. Grava o catálogo e o histórico.
  5. Liga as linhas ao item e registra `catalogo_valor_base`.
  6. Muda o status pela função de transição existente.
- A decisão "só conta o que foi digitado" usa `catalogo_valor_base`, o valor do catálogo quando a linha foi
  lançada ou sincronizada: a linha só grava se o valor dela for diferente dessa base.

**Segurança**
- As funções são SECURITY DEFINER com `search_path` fixo e permissão checada no início.
- A regra de pessoal é aplicada dentro da função, porque o gatilho `trg_catalogo_proteger_preco_pe` não
  alcança quem roda como dono da função.
- A regra fica numa única função do banco: `kontrol_private.pode_ver_pessoal_orcamento()` = permissão
  `orcamentos.pessoal` **ou** `tecnicos.salario.ver`. A prévia, a conclusão e a listagem do catálogo usam essa
  função. No app, a permissão nova entra em `src/lib/auth/permissions.ts` no padrão de coordenador e gestor. No
  banco, a 0137 marca a permissão nas categorias coordenador e gestor (`permissoes_categorias`).
- O histórico não tem SELECT direto; será lido por uma RPC que mascara pessoal (Fase D).
- A listagem `orcamento_projeto_catalogo_listar()` é recriada com as colunas de origem e mantém a máscara e as
  permissões da 0112.

**Números**
- Migrations: 0137 (Fase B), 0138 (Fase D), 0139 (Fase E). Os números 0135 e 0136 já estão em uso.
- Versão do app: 1.2.2 na Fase B. Ajustar ao integrar com o PR #51, que também está em 1.2.1.

## 8. Plano de migração dos dados, rollback e validação (protocolo)

- **Dados preservados:**
  - Nenhum item é apagado. Os repetidos ficam `ativo = false` e `substituido_por = <item que ficou>`.
  - Linhas antigas ligadas ao catálogo recebem `catalogo_valor_base = custo_unitario`, ou seja, contam como
    "não alteradas" e nunca desfazem valores do catálogo.
  - Cada item existente ganha uma linha `carga_inicial` no histórico, com o valor e a data de hoje.
- **Antes de aplicar em produção** (com autorização do dono):
  - backup lógico de `orcamento_projeto_catalogo`, `orcamento_projeto_custos` e `orcamento_projetos`;
  - ensaio com `npm run db:migration -- --arquivo ... --ensaio`.
- **Rollback 0137:** cabeçalho da migration com os comandos. Em resumo:
  - desfazer a unificação (`update ... set substituido_por = null, ativo = true where id in (<ids unificados>)`);
  - remover o índice único, as funções novas, a tabela de histórico e a sequência;
  - recriar `orcamento_projeto_catalogo_listar()` como na 0112.
  - As colunas novas podem ficar, porque são aditivas e sem efeito para o código antigo.
- **Validação pós-migração:** o teste `supabase/tests/catalogo_vivo_projeto_0137.sql` roda no CI. Consultas de
  conferência:
  - nenhuma chave ativa repetida;
  - todo item com histórico;
  - total dos orçamentos emitidos inalterado, porque a Fase B não toca versões emitidas.

## 9. Riscos

| Risco | Mitigação |
|---|---|
| Um valor digitado errado vira referência | A prévia na conclusão mostra cada mudança e pede confirmação; o histórico permite voltar (Fase D) |
| Nome digitado diferente cria item quase igual ("Álcool 70" × "Álcool 70%") | Busca obrigatória antes de criar (Fase C); unificação na tela (Fase D) |
| Renomear item no catálogo com linha antiga ligada | Linha não alterada nunca grava; se a linha for alterada, vale a descrição da linha |
| Conflito com a sessão que edita Modelos e Parâmetros | Fase D fica em rota nova (`/orcamento/catalogo`); as fases A e B não tocam os arquivos em edição |
| Versão 1.2.1 igual em duas branches | Reajustar `APP_VERSION` ao integrar |

## 10. Fora do escopo

- Orçamento laboratorial e Custeio: nada muda.
- Importação dos orçamentos antigos do app anterior (D4 do diagnóstico de 25/09): continua dependendo do dump.
- Deploy de produção: só quando o dono pedir.
