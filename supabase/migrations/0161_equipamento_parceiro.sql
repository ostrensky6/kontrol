-- 0161: equipamento de parceiro cobrado por amostra (plano de evolução, item 12).
--
-- Quando a análise usa um equipamento de outra instituição, o parceiro cobra
-- por amostra em vez de haver depreciação e manutenção próprias. O valor
-- entra no custo de equipamento da análise (R$ por amostra × peso) e pode ser
-- marcado como estimativa, com a fonte (proposta, e-mail, tabela do parceiro).
-- Não destrutiva. Rollback: alter table public.equipamentos drop column
--   custo_parceiro_por_amostra, drop column custo_parceiro_estimado,
--   drop column custo_parceiro_fonte (colunas novas, sem dados anteriores).

alter table public.equipamentos
  add column if not exists custo_parceiro_por_amostra numeric
    check (custo_parceiro_por_amostra is null or custo_parceiro_por_amostra >= 0),
  add column if not exists custo_parceiro_estimado boolean not null default false,
  add column if not exists custo_parceiro_fonte text
    check (custo_parceiro_fonte is null or char_length(custo_parceiro_fonte) <= 300);

comment on column public.equipamentos.custo_parceiro_por_amostra is
  '0161: R$ por amostra cobrado pelo parceiro dono do equipamento. Soma ao custo de equipamento da análise (× peso).';
comment on column public.equipamentos.custo_parceiro_estimado is
  '0161: true quando o valor do parceiro é estimativa, não preço confirmado.';
