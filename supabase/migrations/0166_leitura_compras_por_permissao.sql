-- 0166 — leitura das compras passa a seguir a caixinha.
--
-- Decisão de Antonio (08/11/2026, recomendação "leitura aberta", opção A):
-- desde a 0124 a escrita em compras segue a caixinha, mas a leitura de
-- pedidos_compra, pedidos_compra_itens e pedidos_compra_item_recebimentos
-- continuava aberta a qualquer pessoa logada (using true). Na tela isso não
-- aparecia, mas pela API do Supabase dava para ler preço, fornecedor e valor
-- pago sem ter acesso a Compras.
--
-- Agora a leitura exige uma caixinha de compras ou de recebimento:
-- compras.ver, recebimento.ver, compras.solicitar, compras.aprovar,
-- compras.receber ou compras.cancelar (as de escrita entram para que ninguém
-- com permissão de alterar fique sem enxergar a linha que altera). Admin
-- sempre. Das seis funções padrão, só Cadastro deixa de ler compras.
-- Funções security definer (painéis, cron de reposição, avisos) não mudam.
-- Estoque continua com leitura aberta (decisão: reavaliar depois).
--
-- Aditivo: uma função e ALTER POLICY nas três políticas de leitura. RLS,
-- políticas de escrita e auditoria ficam como estão.
-- Rollback: alter policy rls_read_pedidos_compra on public.pedidos_compra using (true);
-- (idem rls_read_pedidos_compra_itens e rls_read_pedidos_compra_item_recebimentos);
-- drop function kontrol_private.pode_ler_compras();
begin;
set local lock_timeout = '10s';

create function kontrol_private.pode_ler_compras()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select kontrol_private.tem_permissao_efetiva('compras.ver')
      or kontrol_private.tem_permissao_efetiva('recebimento.ver')
      or kontrol_private.tem_permissao_efetiva('compras.solicitar')
      or kontrol_private.tem_permissao_efetiva('compras.aprovar')
      or kontrol_private.tem_permissao_efetiva('compras.receber')
      or kontrol_private.tem_permissao_efetiva('compras.cancelar');
$$;
revoke all on function kontrol_private.pode_ler_compras() from public, anon;
grant execute on function kontrol_private.pode_ler_compras() to authenticated;
comment on function kontrol_private.pode_ler_compras() is
  'Leitura de compras pela API (0166): alguma caixinha de compras ou recebimento.';

alter policy rls_read_pedidos_compra on public.pedidos_compra
  using ((select kontrol_private.pode_ler_compras()));
alter policy rls_read_pedidos_compra_itens on public.pedidos_compra_itens
  using ((select kontrol_private.pode_ler_compras()));
alter policy rls_read_pedidos_compra_item_recebimentos on public.pedidos_compra_item_recebimentos
  using ((select kontrol_private.pode_ler_compras()));

commit;
