-- 0174 — produtos controlados só pela FUNPAR, laboratório dono do insumo e
-- previsão de equipamentos.
--
-- Etapa 8 do plano de adaptação do fluxo de compras (decisões de Antonio em
-- 09/11/2026):
--   * D9: a ATGC não tem licença para produtos controlados (clorofórmio e
--     acetona, por ora). Eles só são comprados pela Fundação de apoio (FUNPAR),
--     em projetos com recurso na fundação. O insumo ganha a marca
--     "controlado"; o pedido interno com item controlado precisa de projeto,
--     a autorização administrativa precisa da fonte FUNPAR, a compra não pode
--     ser direta (só "Encaminhar à instituição", com destino FUNPAR) e uma
--     compra avulsa em Compras com item controlado não é aprovada (vai pelo
--     Pedido). A reposição automática continua gerando o rascunho; a trava
--     está na aprovação.
--   * D10: um estoque só, com "a que laboratório pertence" (insumos.
--     laboratorio_id, ligado a Laboratórios e áreas) e o local físico do lote
--     (locais já existentes; entram os tipos laboratório e almoxarifado e os
--     locais "Almoxarifado geral" e "Almoxarifado do LGA", se ainda não
--     existirem).
--   * Planilha, aba EQ: previsão de equipamentos que a equipe vai precisar
--     (prioridade 1 a 3, laboratório, valor estimado, patrimônio de quem),
--     ligada ao pedido interno quando a compra começa; a situação acompanha o
--     pedido (concluído → comprado; cancelado → volta a previsto).
--
-- O patrimônio de cada unidade de equipamento já existe (0168,
-- equipamento_unidades.patrimonio_de).
--
-- Reclassificação: insumos cujo nome bate com clorofórmio ou acetona (palavra
-- inteira; acetonitrila não entra) são marcados como controlados. O app de
-- compras ainda não está em uso real (autorizado em 09/11). O NOTICE lista
-- quantos e quais.
--
-- Não destrutiva: colunas que aceitam vazio (controlado com padrão falso),
-- uma tabela nova com RLS e auditoria, funções e gatilhos; dois locais novos
-- só se não existirem.
--
-- Rollback:
--   drop trigger pedidos_internos_exigir_funpar on public.pedidos_internos;
--   drop trigger pedidos_compra_exigir_funpar on public.pedidos_compra;
--   drop trigger pedidos_internos_sincronizar_previsao on public.pedidos_internos;
--   drop function kontrol_private.exigir_funpar_pedido();
--   drop function kontrol_private.exigir_funpar_compra();
--   drop function kontrol_private.sincronizar_previsao_equipamento();
--   drop function kontrol_private.itens_controlados_pedido(bigint);
--   drop function kontrol_private.tocar_previsao_equipamento();
--   (só depois de exportar, se houver dados) drop table public.previsao_equipamentos;
--   alter table public.insumos drop column controlado, drop column laboratorio_id;
--   os locais criados ficam (podem ter lotes).

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $$
begin
  if to_regclass('public.responsaveis_compras') is null then
    raise exception '0174: requer a migration 0173';
  end if;
end $$;

-- ---- 1. Insumo controlado e laboratório dono ----------------------------------------
alter table public.insumos
  add column if not exists controlado boolean not null default false,
  add column if not exists laboratorio_id bigint references public.coordenacoes_area(id) on delete set null;

create index if not exists insumos_laboratorio_idx on public.insumos (laboratorio_id) where laboratorio_id is not null;

comment on column public.insumos.controlado is
  '0174 (D9): produto controlado (clorofórmio, acetona...). A ATGC não tem licença: só é comprado pela FUNPAR, em projeto com recurso na fundação.';
comment on column public.insumos.laboratorio_id is
  '0174 (D10): a que laboratório o insumo pertence (Laboratórios e áreas). Estoque único; o local físico fica no lote.';

do $$
declare
  v_n integer;
  v_nomes text;
begin
  with marcados as (
    update public.insumos i
       set controlado = true
     where not i.controlado
       and concat_ws(' ', i.especificacao, i.nome_item, i.sinonimos)
           ~* '\m(clorof[oó]rmio|chloroform|acetona|acetone)\M'
    returning i.especificacao
  )
  select count(*), string_agg(especificacao, '; ' order by especificacao) into v_n, v_nomes from marcados;
  raise notice '0174: % insumo(s) marcado(s) como controlado(s)%', v_n,
    case when v_n > 0 then ': ' || left(v_nomes, 800) else '' end;
end $$;

-- ---- 2. Local físico: laboratório e almoxarifados -----------------------------------
insert into public.locais (nome, tipo)
select v.nome, 'almoxarifado'
  from (values ('Almoxarifado geral'), ('Almoxarifado do LGA')) as v(nome)
 where not exists (select 1 from public.locais l where lower(btrim(l.nome)) = lower(v.nome));

-- ---- 3. Itens controlados de um pedido -----------------------------------------------
-- Insumo marcado como controlado ou, sem insumo ligado, especificação com o nome.
create or replace function kontrol_private.itens_controlados_pedido(p_pedido_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select string_agg(distinct coalesce(i.especificacao, it.especificacao), ', ')
    from public.pedidos_internos_itens it
    left join public.insumos i on i.id = it.insumo_id
   where it.pedido_interno_id = p_pedido_id
     and (coalesce(i.controlado, false)
          or (it.insumo_id is null
              and coalesce(it.especificacao, '') ~* '\m(clorof[oó]rmio|chloroform|acetona|acetone)\M'))
$function$;

revoke all on function kontrol_private.itens_controlados_pedido(bigint) from public, anon;
grant execute on function kontrol_private.itens_controlados_pedido(bigint) to authenticated, service_role;

-- ---- 4. Trava do pedido interno: só pela FUNPAR -------------------------------------
create or replace function kontrol_private.exigir_funpar_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_itens text;
  v_base text;
begin
  if new.status is not distinct from old.status
     or new.status not in ('em_validacao', 'aprovado_compra', 'compra_fechada', 'encaminhado_instituicao') then
    return new;
  end if;
  v_itens := kontrol_private.itens_controlados_pedido(new.id);
  if v_itens is null then
    return new;
  end if;
  v_base := format('Produto controlado (%s): a ATGC não tem licença, a compra só sai pela FUNPAR, em projeto com recurso na fundação.', v_itens);

  if new.status = 'em_validacao' and new.projeto_id is null then
    raise exception '% Escolha o projeto do pedido (Editar, no topo).', v_base using errcode = '22023';
  end if;
  if new.status = 'aprovado_compra' and coalesce(new.fonte_recurso, '') !~* 'funpar' then
    raise exception '% Na análise administrativa, a fonte do recurso tem que ser a FUNPAR.', v_base using errcode = '22023';
  end if;
  if new.status = 'compra_fechada' then
    raise exception '% Não pode ser compra direta: use "Encaminhar à instituição", com destino FUNPAR.', v_base using errcode = '22023';
  end if;
  if new.status = 'encaminhado_instituicao' and coalesce(new.instituicao_destino, '') !~* 'funpar' then
    raise exception '% Encaminhe à FUNPAR (instituição de destino: FUNPAR).', v_base using errcode = '22023';
  end if;
  return new;
end $function$;

revoke all on function kontrol_private.exigir_funpar_pedido() from public, anon, authenticated;

drop trigger if exists pedidos_internos_exigir_funpar on public.pedidos_internos;
create trigger pedidos_internos_exigir_funpar
  before update of status on public.pedidos_internos
  for each row execute function kontrol_private.exigir_funpar_pedido();

-- ---- 5. Compra avulsa com item controlado não é aprovada ------------------------------
create or replace function kontrol_private.exigir_funpar_compra()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_itens text;
begin
  if new.status is not distinct from old.status or new.status <> 'aprovado' then
    return new;
  end if;
  -- compra ligada a pedido interno: a trava está no pedido (seção 4)
  if exists (select 1 from public.pedidos_internos pi where pi.pedido_compra_id = new.id)
     or coalesce(new.observacao, '') like 'Formalizado a partir do pedido interno #%' then
    return new;
  end if;
  select string_agg(distinct i.especificacao, ', ') into v_itens
    from public.pedidos_compra_itens it
    join public.insumos i on i.id = it.insumo_id
   where it.pedido_id = new.id and i.controlado;
  if v_itens is not null then
    raise exception 'Produto controlado (%): a ATGC não tem licença, a compra só sai pela FUNPAR. Faça pelo Pedido (Pedido interno), que leva à FUNPAR, e cancele esta compra.', v_itens
      using errcode = '22023';
  end if;
  return new;
end $function$;

revoke all on function kontrol_private.exigir_funpar_compra() from public, anon, authenticated;

drop trigger if exists pedidos_compra_exigir_funpar on public.pedidos_compra;
create trigger pedidos_compra_exigir_funpar
  before update of status on public.pedidos_compra
  for each row execute function kontrol_private.exigir_funpar_compra();

-- ---- 6. Previsão de equipamentos (aba EQ da planilha) --------------------------------
create table if not exists public.previsao_equipamentos (
  id bigint generated always as identity primary key,
  nome text not null,
  laboratorio_id bigint references public.coordenacoes_area(id) on delete set null,
  prioridade smallint not null default 2,
  quantidade integer not null default 1,
  valor_estimado numeric(14,2),
  justificativa text,
  patrimonio_de text,
  situacao text not null default 'previsto',
  pedido_interno_id bigint references public.pedidos_internos(id) on delete set null,
  observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint previsao_equipamentos_prioridade_check check (prioridade in (1, 2, 3)),
  constraint previsao_equipamentos_quantidade_check check (quantidade > 0),
  constraint previsao_equipamentos_valor_check check (valor_estimado is null or valor_estimado >= 0),
  constraint previsao_equipamentos_situacao_check check (situacao in ('previsto', 'pedido', 'comprado', 'descartado')),
  constraint previsao_equipamentos_textos_check check (
    char_length(btrim(nome)) between 1 and 300
    and coalesce(char_length(justificativa), 0) <= 2000
    and coalesce(char_length(patrimonio_de), 0) <= 120
    and coalesce(char_length(observacoes), 0) <= 2000
  )
);

create index if not exists previsao_equipamentos_pedido_idx on public.previsao_equipamentos (pedido_interno_id) where pedido_interno_id is not null;

comment on table public.previsao_equipamentos is
  '0174: previsão de equipamentos que a equipe vai precisar (aba EQ da planilha), com prioridade 1 a 3. A compra começa por um pedido interno ligado; a situação acompanha o pedido.';

alter table public.previsao_equipamentos enable row level security;

drop policy if exists previsao_equipamentos_ler on public.previsao_equipamentos;
create policy previsao_equipamentos_ler on public.previsao_equipamentos
  for select to authenticated using (true);
drop policy if exists previsao_equipamentos_incluir on public.previsao_equipamentos;
create policy previsao_equipamentos_incluir on public.previsao_equipamentos
  for insert to authenticated with check (kontrol_private.tem_permissao_efetiva('pedido.aprovar'));
drop policy if exists previsao_equipamentos_alterar on public.previsao_equipamentos;
create policy previsao_equipamentos_alterar on public.previsao_equipamentos
  for update to authenticated
  using (kontrol_private.tem_permissao_efetiva('pedido.aprovar'))
  with check (kontrol_private.tem_permissao_efetiva('pedido.aprovar'));
drop policy if exists previsao_equipamentos_excluir on public.previsao_equipamentos;
create policy previsao_equipamentos_excluir on public.previsao_equipamentos
  for delete to authenticated using (kontrol_private.tem_permissao_efetiva('pedido.aprovar'));

grant select, insert, update, delete on public.previsao_equipamentos to authenticated;

drop trigger if exists aud_previsao_equipamentos on public.previsao_equipamentos;
create trigger aud_previsao_equipamentos
  after insert or update or delete on public.previsao_equipamentos
  for each row execute function public.fn_auditoria('id');

-- ligar um pedido marca "pedido"; a data da última troca vem do banco
create or replace function kontrol_private.tocar_previsao_equipamento()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.pedido_interno_id is not null and new.situacao = 'previsto'
     and (tg_op = 'INSERT' or old.pedido_interno_id is distinct from new.pedido_interno_id) then
    new.situacao := 'pedido';
  end if;
  new.atualizado_em := now();
  return new;
end $function$;

revoke all on function kontrol_private.tocar_previsao_equipamento() from public, anon;

drop trigger if exists previsao_equipamentos_tocar on public.previsao_equipamentos;
create trigger previsao_equipamentos_tocar
  before insert or update on public.previsao_equipamentos
  for each row execute function kontrol_private.tocar_previsao_equipamento();

-- a situação acompanha o pedido ligado
create or replace function kontrol_private.sincronizar_previsao_equipamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  if new.status = 'compra_concluida' then
    update public.previsao_equipamentos
       set situacao = 'comprado'
     where pedido_interno_id = new.id and situacao in ('previsto', 'pedido');
  elsif new.status = 'cancelado' then
    update public.previsao_equipamentos
       set situacao = 'previsto'
     where pedido_interno_id = new.id and situacao = 'pedido';
  end if;
  return null;
end $function$;

revoke all on function kontrol_private.sincronizar_previsao_equipamento() from public, anon, authenticated;

drop trigger if exists pedidos_internos_sincronizar_previsao on public.pedidos_internos;
create trigger pedidos_internos_sincronizar_previsao
  after update of status on public.pedidos_internos
  for each row execute function kontrol_private.sincronizar_previsao_equipamento();

notify pgrst, 'reload schema';

commit;
