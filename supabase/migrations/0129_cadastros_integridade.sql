-- Integridade dos cadastros (auditoria de 2026-09-26, onda 2; docs/auditoria-processos-2026-09-26.md §3).
--
-- 1. CAD2-5 (P2): excluir projeto, local, fornecedor ou cliente punha NULL no
--    histórico (FKs ON DELETE SET NULL): orçamentos, planos, compras, lotes e
--    inventários perdiam a referência sem aviso. Gatilhos BEFORE DELETE passam
--    a recusar a exclusão quando há vínculo (código 23503, como os da 0120-J),
--    com mensagem que orienta a desativar ou concluir em vez de excluir.
--    Registro sem vínculo continua podendo ser excluído.
--
-- 2. CAD2-7 (P2): técnico desligado continuava no custo da hora de pessoal.
--    Coluna aditiva tecnicos.ativo (boolean not null default true: todos os
--    técnicos atuais seguem ativos), liberada para leitura pelo mesmo
--    privilégio de coluna da 0112 (valor_mes continua sem SELECT direto), e
--    valor_hora_pessoal_total() passa a somar só técnicos ativos. A função é
--    recriada por inteiro (mesma assinatura, segurança e search_path da 0112).
--
-- 3. CAD2-9 (P3) e projeto: CHECKs de sinal e faixa NOT VALID. Linhas antigas
--    não são validadas nem alteradas (a migration só informa quantas violam);
--    linhas novas e alteradas passam a respeitar a regra. Inclui data de
--    término do projeto não anterior à de início.
--
-- 4. CAD2-6 (P2): unicidade do código de lote por insumo NÃO é criada. O
--    recebimento parcial da mesma compra (e a chegada do mesmo lote do
--    fabricante em duas entregas) grava lotes distintos com o mesmo código;
--    um índice único recusaria o segundo recebimento. A migration só informa
--    quantos códigos repetidos existem (NOTICE). Unificar ou não esses lotes é
--    decisão de negócio pendente. Os CHECKs de quantidade do lote (item 3)
--    entram.
--
-- Aditiva: não remove tabelas, colunas, dados, RLS nem gatilhos de auditoria;
-- nenhum dado existente é alterado.
-- Rollback: drop trigger kontrol_bloquear_exclusao_{projeto,local,fornecedor,cliente};
-- drop function kontrol_private.bloquear_exclusao_{projeto,local,fornecedor,cliente}_com_vinculo();
-- alter table ... drop constraint kontrol_*_check (lista no item 3); reaplicar
-- valor_hora_pessoal_total() da 0112. A coluna tecnicos.ativo pode ficar (o app
-- anterior não a lê); se for removida, antes revogar o grant de coluna.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regnamespace('kontrol_private') is null
    or to_regprocedure('public.valor_hora_pessoal_total()') is null
    or to_regprocedure('kontrol_private.bloquear_exclusao_insumo_com_historico()') is null then
    raise exception '0129: requer as migrations 0112 e 0120';
  end if;
  if exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.tecnicos'::regclass and attname = 'ativo' and not attisdropped
  ) then
    raise exception '0129: tecnicos.ativo já existe; inspecionar antes de aplicar';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Exclusão de cadastro com vínculo (CAD2-5)
-- ---------------------------------------------------------------------------
create or replace function kontrol_private.bloquear_exclusao_projeto_com_vinculo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.orcamentos where projeto_id = old.id)
    or exists (select 1 from public.orcamento_projetos where projeto_id = old.id)
    or exists (select 1 from public.demandas_propostas where projeto_id = old.id)
    or exists (select 1 from public.planejamento where projeto_id = old.id)
    or exists (select 1 from public.pedidos_compra where projeto_id = old.id)
    or exists (select 1 from public.pedidos_internos where projeto_id = old.id)
    or exists (select 1 from public.equipamento_reservas where projeto_id = old.id) then
    raise exception 'Não é possível excluir: o projeto tem orçamentos, planos, pedidos ou reservas. Mude o status para Concluído ou Cancelado.'
      using errcode = '23503';
  end if;
  return old;
end $$;

create or replace function kontrol_private.bloquear_exclusao_local_com_vinculo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.locais where parent_id = old.id)
    or exists (select 1 from public.lotes_estoque where local_id = old.id)
    or exists (select 1 from public.equipamento_unidades where local_id = old.id)
    or exists (select 1 from public.equipamento_reservas where local_id = old.id)
    or exists (select 1 from public.inventario_ciclos where local_id = old.id)
    or exists (select 1 from public.inventario_contagens where local_id = old.id) then
    raise exception 'Não é possível excluir: o local contém outros locais, lotes ou equipamentos, ou tem inventário registrado. Mova o conteúdo antes.'
      using errcode = '23503';
  end if;
  return old;
end $$;

create or replace function kontrol_private.bloquear_exclusao_fornecedor_com_vinculo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.insumos where fornecedor_id = old.id or fornecedor_alt_id = old.id)
    or exists (select 1 from public.pedidos_compra where fornecedor_id = old.id)
    or exists (select 1 from public.equipamento_manutencoes where fornecedor_id = old.id) then
    raise exception 'Não é possível excluir: o fornecedor tem insumos, compras ou manutenções. Desmarque “Ativo” para tirá-lo das listas.'
      using errcode = '23503';
  end if;
  return old;
end $$;

create or replace function kontrol_private.bloquear_exclusao_cliente_com_vinculo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.projetos where cliente_id = old.id)
    or exists (select 1 from public.orcamentos where cliente_id = old.id)
    or exists (select 1 from public.orcamento_projetos where cliente_id = old.id)
    or exists (select 1 from public.demandas_propostas where cliente_id = old.id) then
    raise exception 'Não é possível excluir: o cliente tem projetos ou orçamentos. Desmarque “Ativo” para tirá-lo das listas.'
      using errcode = '23503';
  end if;
  return old;
end $$;

revoke all on function kontrol_private.bloquear_exclusao_projeto_com_vinculo() from public, anon, authenticated;
revoke all on function kontrol_private.bloquear_exclusao_local_com_vinculo() from public, anon, authenticated;
revoke all on function kontrol_private.bloquear_exclusao_fornecedor_com_vinculo() from public, anon, authenticated;
revoke all on function kontrol_private.bloquear_exclusao_cliente_com_vinculo() from public, anon, authenticated;

drop trigger if exists kontrol_bloquear_exclusao_projeto on public.projetos;
create trigger kontrol_bloquear_exclusao_projeto
  before delete on public.projetos
  for each row execute function kontrol_private.bloquear_exclusao_projeto_com_vinculo();

drop trigger if exists kontrol_bloquear_exclusao_local on public.locais;
create trigger kontrol_bloquear_exclusao_local
  before delete on public.locais
  for each row execute function kontrol_private.bloquear_exclusao_local_com_vinculo();

drop trigger if exists kontrol_bloquear_exclusao_fornecedor on public.fornecedores;
create trigger kontrol_bloquear_exclusao_fornecedor
  before delete on public.fornecedores
  for each row execute function kontrol_private.bloquear_exclusao_fornecedor_com_vinculo();

drop trigger if exists kontrol_bloquear_exclusao_cliente on public.clientes;
create trigger kontrol_bloquear_exclusao_cliente
  before delete on public.clientes
  for each row execute function kontrol_private.bloquear_exclusao_cliente_com_vinculo();

-- ---------------------------------------------------------------------------
-- 2. Técnico ativo (CAD2-7)
-- ---------------------------------------------------------------------------
alter table public.tecnicos add column ativo boolean not null default true;
comment on column public.tecnicos.ativo is
  'Falso quando o técnico sai da equipe: deixa de entrar em valor_hora_pessoal_total(); o histórico fica.';

-- Mesmo modelo da 0112: SELECT só por coluna, nunca em valor_mes.
grant select (ativo) on public.tecnicos to authenticated;

create or replace function public.valor_hora_pessoal_total()
returns numeric
language sql stable security definer
set search_path = pg_catalog
as $$
  select coalesce(sum(t.valor_mes / t.horas_mes_base * t.percentual_dedicado / 100), 0)
  from public.tecnicos t
  where t.horas_mes_base > 0
    and t.ativo
$$;

-- ---------------------------------------------------------------------------
-- 3. Faixas e sinais (CAD2-9) e datas do projeto, NOT VALID
-- ---------------------------------------------------------------------------
alter table public.tecnicos
  add constraint kontrol_tecnicos_valores_check check (
    valor_mes >= 0 and horas_mes_base > 0
    and percentual_dedicado >= 0 and percentual_dedicado <= 100
  ) not valid;

alter table public.insumos
  add constraint kontrol_insumos_valores_check check (
    (custo_total_embalagem is null or custo_total_embalagem >= 0)
    and (custo_unitario is null or custo_unitario >= 0)
    and ponto_reposicao >= 0
    and estoque_seguranca >= 0
    and (quantidade_minima_compra is null or quantidade_minima_compra >= 0)
    and (lead_time_dias is null or lead_time_dias >= 0)
    and (prazo_entrega_max_dias is null or prazo_entrega_max_dias >= 0)
    and (validade_dias is null or validade_dias >= 0)
    and (validade_apos_abertura_dias is null or validade_apos_abertura_dias >= 0)
  ) not valid;

alter table public.lotes_estoque
  add constraint kontrol_lotes_quantidades_check check (
    quantidade_inicial >= 0 and quantidade_atual >= 0
    and (custo_unitario is null or custo_unitario >= 0)
  ) not valid;

alter table public.equipamentos
  add constraint kontrol_equipamentos_valores_check check (
    quantidade >= 0 and custo_unitario >= 0
    and (vida_util_anos is null or vida_util_anos >= 0)
    and percentual_manutencao_anual >= 0 and percentual_manutencao_anual <= 1
    and (manutencao_anual_fixa is null or manutencao_anual_fixa >= 0)
  ) not valid;

alter table public.overhead
  add constraint kontrol_overhead_valores_check check (
    custo_mensal >= 0 and horas_bancada_mes > 0
    and percentual_compensada >= 0 and percentual_compensada <= 100
  ) not valid;

alter table public.fornecedores
  add constraint kontrol_fornecedores_prazos_check check (
    (prazo_medio_dias is null or prazo_medio_dias >= 0)
    and (prazo_max_dias is null or prazo_max_dias >= 0)
  ) not valid;

alter table public.projetos
  add constraint kontrol_projetos_datas_check check (
    data_inicio is null or data_fim is null or data_fim >= data_inicio
  ) not valid;

-- ---------------------------------------------------------------------------
-- 4. Relatório (só leitura): linhas antigas fora das regras e códigos de lote
--    repetidos por insumo (CAD2-6)
-- ---------------------------------------------------------------------------
do $$
declare
  v_qtd bigint;
  v_regra record;
begin
  for v_regra in
    select c.conrelid::regclass::text as tabela, c.conname as nome
    from pg_catalog.pg_constraint c
    where c.conname in (
      'kontrol_tecnicos_valores_check', 'kontrol_insumos_valores_check',
      'kontrol_lotes_quantidades_check', 'kontrol_equipamentos_valores_check',
      'kontrol_overhead_valores_check', 'kontrol_fornecedores_prazos_check',
      'kontrol_projetos_datas_check'
    )
  loop
    execute format(
      'select count(*) from %s t where not (%s)',
      v_regra.tabela,
      regexp_replace(
        pg_catalog.pg_get_constraintdef(
          (select oid from pg_catalog.pg_constraint where conname = v_regra.nome)
        ),
        '^CHECK \((.*)\)( NOT VALID)?$', '\1'
      )
    ) into v_qtd;
    if v_qtd > 0 then
      raise notice '0129: % linha(s) antiga(s) de % fora da regra % (não validadas; corrigir ao editar).',
        v_qtd, v_regra.tabela, v_regra.nome;
    end if;
  end loop;

  select count(*) into v_qtd
  from (
    select 1
    from public.lotes_estoque
    where nullif(btrim(codigo_lote), '') is not null
    group by insumo_id, lower(btrim(codigo_lote))
    having count(*) > 1
  ) repetidos;
  raise notice '0129: % código(s) de lote repetido(s) no mesmo insumo (unicidade não aplicada; ver cabeçalho).', v_qtd;
end $$;

commit;
