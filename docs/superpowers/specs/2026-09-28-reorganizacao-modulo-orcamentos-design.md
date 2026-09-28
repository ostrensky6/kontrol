# Reorganização do módulo Orçamentos — desenho aprovado

Data: 2026-09-28 · Base: PR #49 (`claude/kontrol-audit-review-f46258`, 1.1.9) ·
Branch: `claude/budget-module-reorganization-143e54`

Decisões tomadas com o dono na sessão de 28/09 (maquetes aprovadas na conversa).
Não é migração do app antigo `orcamento-projetos`: é reorganização de telas do
próprio Kontrol, com acréscimos de dados aditivos.

## 1. Problemas constatados (diagnóstico)

Proposta emitida (`/orcamento/final/[id]`):

- Página com ~3.000 px para 1 item; o modo interno começa após 1,4 tela.
- Interno repete 6 dados do cliente; 5 cartões de total sem detalhamento;
  parâmetros a 0% em duas fileiras; 3 tabelas separadas, sem rubrica, sem
  filtro, vazias ocupando espaço; coluna "Origem" com id interno.
- **Soma incoerente:** a tabela interna soma o laboratório pelo preço de
  referência (`page.tsx`, `TabelaAnalisesSnapshot`) e o total usa o custo técnico.
- **Snapshot incompleto:** custos do projeto sem `descricao`, `unidade`,
  `categoria` (`demandas.ts`, select da emissão); análises só com código.
- Documento do cliente só com nome/CNPJ/contato do cliente; nada da empresa
  emissora além do nome; texto único vindo do "Escopo preliminar".

Elaboração (`/orcamento/demandas/[id]`): cabeçalho com 8 caixas + 3 textos em
todas as etapas; formulário "Dados do orçamento" em 2 colunas iguais
(prioridade ocupando meia tela); etapa Proposta com 7 blocos repetindo totais.

## 2. Proposta emitida — estrutura

Cabeçalho de uma linha (número, situação, cliente, emissão) com ações
(Planejamento, Duplicar, Cancelar, Exportar, Imprimir) e **duas abas**:
**Interno** (padrão) e **Documento do cliente**. Aba em `?aba=documento`;
imprimir/PDF imprime sempre o documento, qualquer que seja a aba aberta.

### 2.1 Aba Interno

- **Quadro de totais fixo** (aparece em todas as subabas):
  - esquerda — **Custos efetivos**: subtotal por grupo (Laboratório, cada
    rubrica PE/MC/MP/ST/VD/OU presente, Análises do projeto), com % do total;
  - direita — **Custos operacionais**: cada parâmetro com tipo
    (Imposto, Taxa, Fundo, Margem), percentual e valor;
  - rodapé — **Total da proposta**.
  - Clicar numa linha abre a subaba correspondente.
- **Subabas**: Resumo (todos os grupos, recolhíveis) · uma por grupo **com
  itens** (nunca aba vazia) · **Impostos, taxas e margem** · **Fundos** (só se
  houver reserva ou investimento > 0 ou acompanhamento lançado).
- Colunas dos itens: Item (código · nome; referência de tabela em cinza para
  análises) · Qtd. (com unidade; PE = meses) · Custo unit. · Custo total ·
  Na proposta (rateio proporcional já usado na composição comercial, fechando
  exatamente com o total).
- **Impostos, taxas e margem**: Item · Tipo · % informado · % sobre o preço ·
  Valor limpo · Imposto compensado · Parte da nota; linha da fórmula
  (`preço = custos efetivos ÷ (1 − Σ%)`) e a regra da incubação
  (`% × (1 − impostos)`).
- **Fundos**: Reserva e Investimento — %, previsto (limpo), imposto
  compensado; após aprovação, **liberado, usado, saldo** lidos de
  `orcamento_fundos_acompanhamento` via `calcularFundos` (mesma regra da tela
  "Fundos e taxas", onde os lançamentos continuam sendo feitos; atalho para lá).
- **Compensação de imposto** (gross-up, DEC-ORC-001 Alt. A mantida): para cada
  linha não tributária, `parte da nota = limpo ÷ (1 − impostos%)`,
  `imposto compensado = parte − limpo`; a soma dos impostos compensados é igual
  à linha de impostos (ajuste de centavo na maior linha).
- **Alterar percentuais** (quem tem `orcamentos.emitir` + papel de parâmetros):
  inputs nas subabas de operacionais, prévia do novo total com a engine
  `calcularPropostaEconomica`; salvar **gera nova versão** (v2) pelo RPC de
  emissão existente, com os **custos congelados da versão atual**, os novos
  percentuais e os textos atuais; atualiza também os percentuais salvos no
  orçamento. Bloqueado se aprovada/cancelada/substituída.
- Link de aprovação vira linha de situação; o painel abre só quando cabe criar.
- **Auditoria e origem** recolhida no fim (fórmula, origens, orçamentos de
  origem com status, quem emitiu).
- Versões antigas: item sem descrição mostra "descrição não registrada na
  emissão" (não buscar dado atual). Versões legado (regra anterior) mostram os
  parâmetros gravados com aviso "regra econômica anterior".

### 2.2 Aba Documento do cliente (A4 retrato)

Folha clara (`.folha-documento`, PR #49), diagramada para A4 retrato, igual na
tela, na impressão/PDF, no DOCX e no link público:

1. Cabeçalho: logo, nome legal, CNPJ, endereço, telefone/e-mail/site da
   empresa emissora; "Proposta comercial", nº, versão, emissão, validade.
2. Quadro **Cliente** (razão social, CNPJ/CPF, endereço, contato, e-mail,
   telefone) + quadro **Resumo** (valor total "impostos inclusos", prazo,
   amostras).
3. Seções numeradas; seção vazia não sai:
   1. Objeto — título, modalidade e **descrição completa** (texto formatado);
   2. Escopo técnico — matriz, amostras, análises (código e nome), prazo técnico;
   3. Serviços e valores — grupos com nomes comuns (Análises laboratoriais,
      Pessoal técnico, Material de consumo…), item, qtd., valor unit., valor
      total; total "impostos inclusos". Nunca custo, % ou parâmetro;
   4. Prazos — validade (automática) + entrega dos produtos (texto padrão);
   5. Responsabilidades das partes (inclui coleta de amostras);
   6. Condições comerciais — texto padrão editável (pagamento, impostos
      inclusos, alterações de escopo);
   7. Confidencialidade e resultados;
   8. Aceite — assinaturas.
   Seções 4–7 e outras criadas pelo administrador vêm de **textos padrão por
   empresa**.
4. Rodapé em todas as páginas: empresa · CNPJ · nº/versão · "Página X de Y";
   tabelas e blocos não quebram no meio (`break-inside: avoid`).

**Edição de textos na versão emitida**: botão "Editar" na descrição e em cada
seção; editor com negrito, subtítulo e listas; salva **na própria versão**
(sem trocar número) enquanto `emitido`/`enviado`/`alterado_reenviado` e dentro
da validade; exige `orcamentos.emitir`; auditado (trigger de auditoria da
tabela). O link público mostra o texto novo.

## 3. Elaboração

- **Cabeçalho compacto**: título com nº, uma linha de resumo e etiquetas
  (situação, prioridade, completude); etapas em faixa estreita. Some o bloco
  de 8 caixas + 3 textos.
- **Dados do orçamento**: grade de 12 colunas em 4 grupos — Identificação,
  Cliente, Amostras e prazos, Textos — larguras pelo conteúdo; campos novos do
  cliente: e-mail, telefone, endereço; escolher o cliente cadastrado preenche
  os dados dele; barra de salvar fixa no pé.
- **Etapa Proposta**: mesmas abas **Interno** (quadro + subabas com valores
  vivos e percentuais editáveis direto, salvando nos parâmetros do orçamento)
  e **Documento do cliente** (prévia com o mesmo componente e textos
  editáveis). Emissão copia textos, dados do cliente e da empresa
  emissora para o snapshot.

## 4. Dados (migration 0135, aditiva)

0133 e 0134 estão reservadas por outra sessão (`claude/auditoria-27-09-restante`).

- `empresas_emissoras` (id, codigo `ATGC`/`GIA` único, nome_legal, cnpj,
  endereco, telefone, email, site, atualizado_em) — semeada com as duas
  empresas; leitura autenticada, escrita `cadastros.editar`; auditada. Editada
  em Orçamentos › Documento da proposta (junto das seções padrão; o cadastro
  genérico exigiria mexer em código compartilhado por todos os cadastros).
- `proposta_secoes_padrao` (id, empresa_codigo, chave, titulo, texto jsonb,
  ordem, ativo; único por empresa+chave) — semeada com prazos,
  responsabilidades, condições comerciais e confidencialidade para ATGC e GIA;
  escrita `orcamentos.emitir`; editada em Parâmetros do orçamento.
- `demandas_propostas`: `cliente_email`, `cliente_telefone`,
  `cliente_endereco` (text), `textos_proposta` (jsonb). Condições de pagamento
  ficam no texto da seção "Condições comerciais" (sem coluna própria).
- `orcamento_final_versoes.textos_proposta` (jsonb, nulo = usar snapshot) —
  o trigger de imutabilidade não bloqueia esta coluna; escrita só pelo RPC
  `atualizar_textos_versao_final(p_versao_id, p_textos)` (security definer,
  `orcamentos.emitir`, status vivo e dentro da validade).
- `ler_orcamento_publico` passa a devolver `textos_proposta`.
- Snapshot da emissão passa a guardar: descrição/unidade/categoria dos custos
  do projeto, nome das análises, `empresa_emissora`, `textos_proposta`,
  e dados completos do cliente (via `demanda`).

Rollback: `drop` das duas tabelas novas e das colunas novas (vazias até o uso),
restaurar `ler_orcamento_publico` da 0132, `drop function
atualizar_textos_versao_final`. Nenhum dado existente é alterado.

### Texto formatado

Documento JSON restrito (subconjunto do ProseMirror/TipTap): `doc`,
`paragraph`, `heading` (nível 3), `bulletList`, `orderedList`, `listItem`,
`hardBreak`, `text` com marca `bold`. Validado com zod no servidor; texto
legado em string vira parágrafos. Um renderizador único gera React (tela,
impressão, link) e parágrafos DOCX. Editor: TipTap (dependência nova
`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`), só no cliente.

## 5. Componentes (unidades)

- `lib/orcamento/visao-interna.ts` — função pura: snapshot/valores vivos →
  grupos de custos efetivos, operacionais com compensação, totais, rateio.
- `lib/orcamento/texto-rico.ts` — schema, normalização (string → doc),
  vazio?, conversão para DOCX.
- `lib/orcamento/documento-proposta.ts` — monta o modelo do documento A4
  (cabeçalho, cliente, resumo, seções, serviços) a partir de versão/snapshot/
  textos/empresa; usado pela página, pelo link público e pelo DOCX.
- `components/orcamento/interno/*` — QuadroTotais, AbasInterno (cliente),
  TabelaItens, TabelaOperacionais, TabelaFundos, AlterarPercentuais.
- `components/orcamento/documento/*` — DocumentoProposta (servidor),
  TextoRico (render), EditorTextoRico (cliente, TipTap), EditarTextoVersao.
- `components/orcamento/elaboracao/*` — CabecalhoOrcamento, campos do
  formulário em grade, ClienteCadastradoSelect (preenchimento).

## 6. Fora deste pacote (entrega 4)

Etapas Laboratório e Custos do projeto, etapa Parâmetros (substituída pela
edição nas abas, mantida por enquanto), lista de orçamentos.

## 7. Verificação

Unitários (vitest) para visão interna (somas, rateio, compensação, legado,
grupos vazios), texto rico (schema, legado, DOCX) e documento; teste SQL da
0135 (`supabase/tests/`); E2E simulado atualizado para as abas; `npm run
verify` verde; conferência visual no app local (A4 impresso em PDF).
