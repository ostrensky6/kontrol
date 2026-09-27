# Rodada do parecer técnico de 27/09/2026 (versão 1.1.7 → 1.1.8)

Parecer externo (Codex) sobre `main` em `41b7531`, com notas 6,0 no backend e
6,6 no front-end. Cada achado foi conferido no código antes de qualquer
mudança; só entrou o que se confirmou.

## O que mudou

| Achado | Conferência | Correção |
|---|---|---|
| Link público entrega custos | Confirmado: `ler_orcamento_publico` devolvia o snapshot inteiro a quem tivesse o link, chamando o banco direto | 0132: só o `service_role` lê; a página `/aprovar/[token]` lê no servidor e entrega ao navegador apenas o que o cliente vê. A aprovação pelo link continua pública |
| Senha provisória opera no banco | Confirmado: a troca era exigida só pelo proxy do app | 0132: conta com senha provisória (perfil e token marcados) fica sem permissões, sem papel e com menu vazio até trocar a senha. Complementa o PR #47 |
| Auto-cadastro (achado novo nesta conferência) | Produção aceita cadastro por e-mail (`disable_signup = false`) e o perfil nascia técnico ativo | 0132: perfil criado fora do cadastro do administrador nasce suspenso. **Falta desligar o cadastro no painel do Supabase** |
| Rascunho silencia a reposição | Confirmado: o rascunho automático diário (compra "solicitada") contava como material a caminho e o alerta sumia | 0132: a quantidade sugerida continua descontando o rascunho (o robô não repete itens), mas o painel mostra "Reposição aguardando aprovação" até a compra ser aprovada |
| Aprovação sem os 90 dias | Confirmado: a compra é aprovada antes da tramitação e a previsão era hoje + prazo do fornecedor | App: a aprovação soma a tramitação; "Enviado ao fornecedor" recalcula hoje + prazo do fornecedor (0132 aceita a data no envio) |
| Validade nas entradas | Em parte: "+ Entrada", compra e pedido interno já recusavam vencido (0130); a entrada manual em frascos e a RPC antiga `receber_lote` não | 0132: entrada em frascos recusa vencido; `receber_lote` (sem uso no app) sai do alcance dos usuários |
| Alertas somem dos filtros | Confirmado e maior que o descrito: sem estoque não contava em "Repor"; filtro de lotes ignorava 3 das 4 opções | Filtros e contadores por sinal (`src/lib/estoque/situacao-insumo.ts`); filtro de lotes com Vencido, Vence em breve e Sem validade; tabela de saldo filtra por condição |
| Botões sem permissão | Confirmado (o banco já recusava) | "Dar baixa", "+ Entrada", "Abrir pedido" e "Corrigir quantidade" só aparecem para quem tem a permissão |
| Painéis de recebimento | Confirmado nos três painéis; rótulos só nos dois de "Receber" ("+ Entrada" já estava certo) | Os três usam o diálogo padrão (Esc, foco, leitor de tela); campos com rótulo ligado; câmera desliga em qualquer forma de fechar |
| Roteiro manda `db push` | Confirmado | `docs/operacao-producao.md` com o procedimento real (psql, UTF8, backup, registro) |
| Termos de consumo | Confirmado | Motivo "Entrega ao laboratório"; lote zerado aparece como "Esgotado" (no banco segue `consumido`) |

## O que não mudou, e por quê

- **Leitura aberta a qualquer usuário logado** (estoque, lotes, compras): é
  escolha de política, não defeito; equipe pequena e decisão do dono de reduzir
  burocracia. Com o auto-cadastro fechado, só entra quem o administrador cadastra.
- **Proteção da `main` no GitHub**: os PRs já rodam o CI antes do merge; exigir
  CI verde é configuração do dono no GitHub (repositório privado pode exigir
  plano pago).
- **Mensagens distintas no login** (senha antiga/vencida): não ajudam um
  atacante, que já pode testar senhas direto no Auth.

## Pendências para publicar

1. Mesclar o PR #47 (senha individual) e subir este PR para 1.1.9, ou o
   contrário: a versão avança uma unidade por PR.
2. Aplicar a 0132 em produção pelo procedimento de `docs/operacao-producao.md`
   (backup antes), **antes** do merge deste PR: a página do link público passa
   a depender do `service_role` e a previsão de compra da data no envio.
3. Desligar "Allow new users to sign up" no Supabase (Authentication →
   Sign In / Providers). O cadastro pelo administrador continua funcionando.

## Observado e deixado para depois

- `saldoColumns()` em `EstoqueTables.tsx` recria as células a cada
  renderização; o botão "+ Entrada" remonta depois de salvar e a tela de
  sucesso some logo. Existia antes desta rodada.
