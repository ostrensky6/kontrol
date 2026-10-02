# Entrada e saída por código de barras (02/10/2026, versão 1.2.7)

Origem: "Relatório de bugs do Kontrol", item 18 (severidade alta). Migration
**0143**.

## O que muda para quem usa

| Onde | O quê |
|---|---|
| Estoque > **Entrada e saída por leitura** (`/estoque/leitura`) | Tela nova. Leitor USB (digita e tecla Enter) ou câmera do celular. |
| Entrada | Lê o código → mostra o insumo → embalagens (padrão 1), validade (vem do DataMatrix GS1 quando o código traz) e local → confirma. O lote é criado sozinho (`LEIT-…`). Com pedido de compra em aberto do insumo, a entrada pode ir pelo pedido (conta como recebimento, sem lançar duas vezes). |
| Saída | Cada leitura registra a abertura de 1 embalagem fechada, com usuário, data e hora. O sistema escolhe o lote: o que vence primeiro; sem validade, o mais antigo. Sem embalagem fechada (ou só vencidas ou reservadas para planejamento), avisa e não registra nada. |
| Erros de leitura | O mesmo código lido de novo em menos de 10 s pede confirmação. "Desfazer a última" desfaz a leitura (quem leu, até 2 horas; ou quem tem Corrigir estoque). |
| Código desconhecido | Vincular a um insumo existente (a próxima leitura já reconhece e a triagem pendente do código é resolvida), cadastrar insumo novo já com o código, ou mandar para **Códigos não reconhecidos**. |
| Cadastro do insumo (Novo/Editar) | Campo próprio **Códigos de barras** (vários por insumo), separado do "Código do fabricante". Leitor USB, câmera ou digitação. |
| Planilha XLSX de cadastros | Coluna **Códigos de barras** na exportação e na importação (vários separados por `;`). A importação só acrescenta códigos; código de outro insumo vira aviso. |
| Inventário | Contagem **por insumo, sem lote** (total de embalagens fechadas), além da contagem por lote. Lendo o código de barras do fabricante, o insumo é escolhido sozinho. O ajuste corrige o total do insumo. |
| Inventário (unidade) | Lotes de embalagens fechadas aparecem como no Controle de Estoque: "3 frasco(s) de 1000 Un", não "3 Un". |
| Auditoria | Novos filtros **Movimentações de estoque** e **Códigos de barras**; cada linha mostra o insumo. |

## O que estava quebrado e foi corrigido junto

- Vincular um código pela triagem (Códigos não reconhecidos) falhava: a tabela
  `identificadores` da 0067 exige `tipo` e `valor`, que o app não mandava.
- Nenhuma leitura de scanner ficava registrada: `scan_eventos.valor_lido` (0067)
  é obrigatório e o app não mandava; o erro era engolido.

A 0143 completa essas colunas no banco (gatilhos) e o app passou a mandá-las.

## Ligações conferidas

Leitura → Controle de Estoque, Estoque, Suprimentos, Inventário (saldo e
"Sistema" caem 1 embalagem na mesma unidade), Planejamento (embalagem aberta não
conta como disponível, regra já existente de `v_estoque_disponivel_unidade`),
Recebimento/Compras (entrada pelo pedido), Cadastros > Insumos (códigos no
formulário e na planilha), Códigos não reconhecidos (vínculo resolve a triagem),
Auditoria, alertas de validade (lote criado com a validade lida). Menu de
Suprimentos, atalhos do Controle de Estoque e de Suprimentos e ajuda de contexto
apontam para a tela nova.

## Testes

- `supabase/tests/leitura_codigo_barras_0143.sql` (no CI): entrada com lote
  interno e validade, recusa de vencido, saída FEFO, leitura repetida
  idempotente, recusa sem embalagem livre, desfazer (permissão e repetição),
  recebimento pelo pedido, inventário por insumo e auditoria.
- Vitest: leitura de GS1/EAN/GTIN, unidade do lote, importação da coluna.
- Playwright (mock): saída com confirmação de leitura repetida e desfazer;
  entrada com validade; código desconhecido.

## Para produção (passo do dono)

Mesmo roteiro de `docs/operacao-producao.md` ("Como aplicar uma migration em
producao"), depois das migrations até a 0142:

1. Backup (`pg_dump -Fc`).
2. Ensaio: `npm run db:migration -- --arquivo supabase/migrations/0143_leitura_codigo_barras_estoque.sql --ensaio --env-file G:\Aplicativos\Kontrol\.env.local`.
3. Aplicar com `--log <pasta do backup>`.
4. Conferir: abrir **Estoque > Entrada e saída por leitura**, ler um código,
   vincular a um insumo e ler de novo (deve reconhecer).

Sem a 0143 aplicada, a tela nova responde com erro do banco ao confirmar, e o
inventário por insumo é recusado; o resto do app segue igual.

Rollback: descrito no cabeçalho da migration (não remove dados existentes; as
contagens por insumo precisam de backup antes de restaurar `lote_id not null`).
