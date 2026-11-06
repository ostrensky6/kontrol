# Funções, privilégios e exclusão de registros

Guia curto para quem administra o Kontrol (versão 1.3, migrations 0144 a 0148).

## As seis funções

| Função | Nível | Para quem |
|---|---|---|
| Laboratório | 0 | Quem usa o estoque no dia a dia (era "Técnico", com as mesmas caixinhas) |
| Compra | 0 | Quem cuida de pedidos de compra |
| Cadastro | 0 | Quem mantém os cadastros (insumos, fornecedores, locais) |
| Coordenador | 1 | Coordena projetos e orçamentos |
| Gestor | 2 | Aprova e acompanha o laboratório todo |
| Administrador | 3 | Tudo, inclusive usuários, privilégios e backups |

- **Governança > Usuários**: escolhe a função de cada pessoa e faz ajustes individuais.
- **Governança > Privilégios**: matriz de caixinhas por função, separada por módulo. A coluna do
  Administrador fica travada: ele sempre pode tudo.
- A caixinha vale no banco, não só na tela. Tirar uma caixinha tira o acesso de verdade.
- Só o administrador muda funções e privilégios. Ninguém sobe a própria função.

Dê a cada pessoa a menor função que cobre o trabalho dela. Administrador só para quem
cuida do sistema.

## Inativar ou excluir um insumo

1. **Inativar** (0144) é o caminho normal. O insumo sai das listas de uso, do painel e das
   sugestões de compra, mas o histórico (lotes, movimentações, compras) fica. Dá para reativar.
2. **Excluir** simples só funciona quando o insumo não tem histórico nenhum. Se tiver, o Kontrol
   recusa e mostra o que está ligado a ele.
3. **Excluir com o histórico** (0145) apaga o insumo junto com lotes, movimentações, contagens,
   reservas e os itens dele nas compras, inclusive compras já recebidas. O total dessas compras
   muda. Use só para cadastro feito por engano. A tela pede confirmação, e cada linha apagada
   fica na Auditoria (desde a 0148, também as contagens de inventário, as conferências do
   planejamento e as leituras).

Quem pode excluir de vez muda com a 0147 (PR #63): passa a valer a caixinha de edição do
módulo, sem precisar ser administrador.

## Leitura de código de barras

- Entrada e saída pela leitura só acontecem pela tela do Kontrol (desde a 0148 o banco recusa
  uma leitura de movimento gravada por fora).
- Quem fez a leitura pode desfazê-la até 2 horas depois. Depois disso, ou para a leitura de
  outra pessoa, precisa da caixinha "Corrigir estoque".
- Desfazer uma leitura também tira o movimento do gráfico mensal do painel de Cadastros.

## Painel de insumos: "Nível crítico" e "Repor"

- **Nível crítico** (painel de Cadastros): disponível abaixo do ponto de reposição do cadastro.
- **Repor** (Estoque): a previsão sugere comprar, contando também o que já está a caminho e o
  prazo da compra.

Os dois podem mostrar números diferentes para o mesmo insumo. Um item crítico com compra a
caminho pode não aparecer em Repor.
