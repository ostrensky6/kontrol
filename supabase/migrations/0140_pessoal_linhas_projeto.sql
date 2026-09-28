-- =====================================================================
-- 0140 — Orçamento de projeto: linhas de pessoal (PE) só com a permissão de
-- pessoal (DC2/DC8, dono 28/09: "quem tem vê e lança valores, quem não tem
-- vê o XXX"; o técnico não faz orçamento).
--
-- O que muda:
--   1. Gatilho em orcamento_projeto_custos: inserir, alterar (descrição,
--      unidade, quantidade, valores, meses, rubrica) ou remover linha de
--      pessoal exige kontrol_private.pode_ver_pessoal_orcamento() (0137:
--      "Valores de pessoal no orçamento" ou "Ver salário dos técnicos").
--      Trocar uma linha para PE ou de PE para outra rubrica também conta.
--   2. Continua livre: vincular a linha ao catálogo na conclusão da revisão
--      (catalogo_item_id, catalogo_valor_base), a exclusão em cascata do
--      orçamento inteiro e a manutenção sem usuário (service role, SQL).
--
-- A leitura dos valores de PE nas telas é mascarada pelo app (XXX). A leitura
-- direta pela API continua possível para quem vê orçamentos: fechar isso exige
-- uma visão mascarada das linhas e revogar a coluna, o que muda todas as
-- leituras de custos (pendência registrada em docs/catalogo-vivo-projeto-2026-09-28.md).
--
-- Impacto: aditiva (uma função e um gatilho). Nada é apagado.
-- Rollback:
--   drop trigger if exists kontrol_proteger_pessoal_custos_projeto on public.orcamento_projeto_custos;
--   drop function if exists kontrol_private.proteger_pessoal_custos_projeto();
-- =====================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regprocedure('kontrol_private.pode_ver_pessoal_orcamento()') is null
    or to_regprocedure('kontrol_private.proteger_custos_projeto()') is null then
    raise exception '0140: requer as migrations 0137 e 0139';
  end if;
end $$;

create or replace function kontrol_private.proteger_pessoal_custos_projeto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_toca_pessoal boolean;
begin
  -- Manutenção sem usuário (service role, SQL do owner) e exclusão em cascata do
  -- orçamento inteiro não são lançamento de valor.
  if v_claims is null
     or coalesce(v_claims->>'sub', '') = ''
     or v_claims->>'role' = 'service_role'
     or (tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_toca_pessoal :=
    (tg_op in ('UPDATE', 'DELETE') and coalesce(old.rubrica, 'OU') = 'PE')
    or (tg_op in ('INSERT', 'UPDATE') and coalesce(new.rubrica, 'OU') = 'PE');

  if v_toca_pessoal and not kontrol_private.pode_ver_pessoal_orcamento() then
    raise exception 'Pessoal (PE) só é lançado, alterado ou removido por quem tem a permissão "Valores de pessoal no orçamento".'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

revoke all on function kontrol_private.proteger_pessoal_custos_projeto() from public, anon, authenticated, service_role;

drop trigger if exists kontrol_proteger_pessoal_custos_projeto on public.orcamento_projeto_custos;
create trigger kontrol_proteger_pessoal_custos_projeto
  before insert or delete
      or update of rubrica, descricao, unidade, quantidade, custo_unitario, preco_unitario, meses_selecionados
  on public.orcamento_projeto_custos
  for each row execute function kontrol_private.proteger_pessoal_custos_projeto();

comment on function kontrol_private.proteger_pessoal_custos_projeto() is
  'Linha de pessoal (PE) do orçamento de projeto só é lançada, alterada ou removida com a permissão de pessoal (0140).';

commit;
