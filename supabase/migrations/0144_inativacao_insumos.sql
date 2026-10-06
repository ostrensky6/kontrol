-- BUGS19/20: ciclo de vida sem perda de histórico. Não reaplicar isoladamente.
-- As definições vigentes são preservadas; âncoras ausentes/duplicadas abortam
-- toda a transação em vez de substituir silenciosamente um contrato diferente.
begin;
set local lock_timeout = '10s';
set local search_path = pg_catalog;

alter table public.insumos add column ativo boolean not null default true;
comment on column public.insumos.ativo is
  'Inativo permanece no histórico, mas não inicia novos vínculos, reservas ou operações de estoque.';

drop policy rls_permissao_insert_insumos on public.insumos;
create policy rls_permissao_insert_insumos on public.insumos for insert to authenticated
  with check (kontrol_private.tem_permissao_efetiva('insumos.editar'));
drop policy rls_permissao_update_insumos on public.insumos;
create policy rls_permissao_update_insumos on public.insumos for update to authenticated
  using (kontrol_private.tem_permissao_efetiva('insumos.editar'))
  with check (kontrol_private.tem_permissao_efetiva('insumos.editar'));
drop policy rls_permissao_delete_insumos on public.insumos;
create policy rls_permissao_delete_insumos on public.insumos for delete to authenticated
  using (kontrol_private.tem_permissao_efetiva('insumos.editar'));

-- Escrita direta autenticada não é a exceção histórica de uma RPC controlada.
-- Policies RESTRICTIVE somam a condição às permissões existentes, sem abrir
-- grants nem bloquear a manutenção/compensação de linhas já existentes.
create policy kontrol_insumo_ativo_lote_novo on public.lotes_estoque
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.insumos i where i.id = insumo_id and i.ativo));
create policy kontrol_insumo_ativo_movimento_novo on public.estoque_movimentacoes
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.insumos i where i.id = insumo_id and i.ativo));

create function kontrol_private.exigir_insumo_ativo(p_insumo_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ativo boolean;
begin
  -- Obtém desde já o lock usado pelas RPCs: duas guardas não podem adquirir
  -- SHARE juntas e depois disputar a conversão para UPDATE. Também serializa
  -- a inativação; o lock permanece até COMMIT/ROLLBACK.
  select i.ativo into v_ativo from public.insumos i where i.id = p_insumo_id for update;
  if not found then
    raise exception 'Insumo não encontrado.' using errcode = 'P0002';
  end if;
  if not v_ativo then
    raise exception 'Insumo inativo. Reative o cadastro para iniciar uma nova operação.' using errcode = '55000';
  end if;
end $$;
revoke all on function kontrol_private.exigir_insumo_ativo(bigint) from public, anon, authenticated;

create function kontrol_private.proteger_novo_vinculo_insumo()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Atualizar quantidade/status do MESMO item não transforma histórico em
  -- vínculo novo. INSERT e troca do insumo passam pela mesma guarda física.
  if tg_op = 'UPDATE' then
    if new.insumo_id is not distinct from old.insumo_id then
      return new;
    end if;
  end if;
  if new.insumo_id is not null then
    perform kontrol_private.exigir_insumo_ativo(new.insumo_id);
  end if;
  return new;
end $$;
revoke all on function kontrol_private.proteger_novo_vinculo_insumo() from public, anon, authenticated;
create trigger kontrol_insumo_ativo_analise
  before insert or update of insumo_id on public.insumo_analise
  for each row execute function kontrol_private.proteger_novo_vinculo_insumo();
create trigger kontrol_insumo_ativo_compra
  before insert or update of insumo_id on public.pedidos_compra_itens
  for each row execute function kontrol_private.proteger_novo_vinculo_insumo();
create trigger kontrol_insumo_ativo_pedido
  before insert or update of insumo_id on public.pedidos_internos_itens
  for each row execute function kontrol_private.proteger_novo_vinculo_insumo();
create trigger kontrol_insumo_ativo_reserva
  before insert or update of insumo_id on public.reservas_estoque
  for each row execute function kontrol_private.proteger_novo_vinculo_insumo();

create function kontrol_private.proteger_novo_codigo_insumo()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.entidade_tipo is not distinct from old.entidade_tipo
       and new.entidade_id is not distinct from old.entidade_id then
      return new;
    end if;
  end if;
  if new.entidade_tipo = 'insumo' and new.entidade_id is not null then
    perform kontrol_private.exigir_insumo_ativo(new.entidade_id);
  end if;
  return new;
end $$;
revoke all on function kontrol_private.proteger_novo_codigo_insumo() from public, anon, authenticated;
create trigger kontrol_insumo_ativo_codigo
  before insert or update of entidade_tipo, entidade_id on public.identificadores
  for each row execute function kontrol_private.proteger_novo_codigo_insumo();

-- Mantém o BEFORE DELETE existente, FKs e auditoria. O lock do DELETE no pai
-- serializa referências FK concorrentes. Não retornamos identificadores de
-- linhas protegidas: somente tipo/rótulo/contagem agregada real.
create or replace function kontrol_private.bloquear_exclusao_insumo_com_historico()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_blockers jsonb;
  v_resumo text;
begin
  select jsonb_agg(jsonb_build_object('tipo', tipo, 'rotulo', rotulo, 'contagem', contagem) order by tipo),
         string_agg(rotulo || ': ' || contagem, '; ' order by tipo)
    into v_blockers, v_resumo
    from (
      select 'insumo_analise' as tipo, 'Análises' as rotulo, count(*) as contagem from public.insumo_analise where insumo_id = old.id
      union all select 'estoque_movimentacoes', 'Movimentações de estoque', count(*) from public.estoque_movimentacoes where insumo_id = old.id
      union all select 'estoque_config', 'Configurações de estoque', count(*) from public.estoque_config where insumo_id = old.id
      union all select 'lotes_estoque', 'Lotes de estoque', count(*) from public.lotes_estoque where insumo_id = old.id
      union all select 'reservas_estoque', 'Reservas de estoque', count(*) from public.reservas_estoque where insumo_id = old.id
      union all select 'pedidos_compra_itens', 'Itens de compras', count(*) from public.pedidos_compra_itens where insumo_id = old.id
      union all select 'pedidos_internos_itens', 'Itens de pedidos internos', count(*) from public.pedidos_internos_itens where insumo_id = old.id
      union all select 'planejamento_lote_conferencias', 'Conferências de planejamento', count(*) from public.planejamento_lote_conferencias where insumo_id = old.id
      union all select 'pedidos_internos_item_recebimentos', 'Recebimentos internos', count(*) from public.pedidos_internos_item_recebimentos where insumo_id = old.id
      union all select 'pedidos_compra_item_recebimentos', 'Recebimentos de compras', count(*) from public.pedidos_compra_item_recebimentos where insumo_id = old.id
      union all select 'inventario_contagens', 'Contagens de inventário', count(*) from public.inventario_contagens where insumo_id = old.id
      union all select 'identificadores', 'Identificadores', count(*) from public.identificadores where entidade_tipo = 'insumo' and entidade_id = old.id
    ) vinculos where contagem > 0;
  if v_blockers is not null then
    raise exception 'Não é possível excluir este insumo. Vínculos existentes: %. Inative o cadastro para preservar o histórico.', v_resumo
      using errcode = '23503', detail = jsonb_build_object('blockers', v_blockers)::text;
  end if;
  return old;
end $$;
revoke all on function kontrol_private.bloquear_exclusao_insumo_com_historico() from public, anon, authenticated;

-- Reutiliza as contas vigentes (0127/0132), mantendo ordem/tipos/ACL das
-- colunas. pg_catalog como search_path faz pg_get_viewdef qualificar fontes.
-- Saldo NÃO filtra histórico; ativo é exclusivamente uma coluna nova final.
do $$
declare
  v_def text;
  v_nome text;
begin
  v_def := rtrim(pg_get_viewdef('public.v_estoque_saldo'::regclass, true), E';\n ');
  execute format('create or replace view public.v_estoque_saldo with (security_invoker=true) as select anterior.*, i.ativo from (%s) anterior join public.insumos i on i.id=anterior.insumo_id', v_def);
  foreach v_nome in array array['v_previsao_suprimentos', 'v_alertas_estoque'] loop
    v_def := rtrim(pg_get_viewdef(('public.' || v_nome)::regclass, true), E';\n ');
    execute format('create or replace view public.%I with (security_invoker=true) as select anterior.* from (%s) anterior join public.insumos i on i.id=anterior.insumo_id where i.ativo', v_nome, v_def);
  end loop;
end $$;

-- Cada entrada é um patch exato de uma definição existente, não um novo
-- dispatcher. Conserva papel/permissão, assinaturas, ACLs, idempotência e
-- auditoria anteriores. Nenhuma rota histórica de recebimento/estorno é
-- redefinida. Não há bypass por nome de owner nem marcador GUC.
do $$
declare
  r record;
  v_def text;
  v_func regprocedure;
begin
  for r in select * from (values
    ('public.receber_lote(bigint,numeric,date,numeric,text,text,bigint,text,text)',
      $anchor$  insert into lotes_estoque(insumo_id, codigo_lote, validade, quantidade_inicial,$anchor$,
      $guard$  perform kontrol_private.exigir_insumo_ativo(p_insumo_id);
  insert into lotes_estoque(insumo_id, codigo_lote, validade, quantidade_inicial,$guard$),
    ('public.entrada_inventario(bigint,numeric,uuid,date,numeric,text,text,text,bigint)',
      $anchor$  select id, categoria_compra into v_insumo$anchor$,
      $guard$  perform kontrol_private.exigir_insumo_ativo(p_insumo_id);
  select id, categoria_compra into v_insumo$guard$),
    ('public.registrar_entrada_manual_embalagens(bigint,integer,uuid,date,numeric,text,text,text)',
      $anchor$  select * into v_insumo
  from public.insumos i$anchor$,
      $guard$  perform kontrol_private.exigir_insumo_ativo(p_insumo_id);
  select * into v_insumo
  from public.insumos i$guard$),
    ('public.registrar_entrada_por_leitura(bigint,integer,date,bigint,text,uuid)',
      $anchor$  select * into v_insumo from public.insumos where id = p_insumo_id;$anchor$,
      $guard$  perform kontrol_private.exigir_insumo_ativo(p_insumo_id);
  select * into v_insumo from public.insumos where id = p_insumo_id;$guard$),
    ('public.abrir_embalagem_por_leitura(bigint,text,uuid)',
      $anchor$  select * into v_insumo from public.insumos where id = p_insumo_id for update;$anchor$,
      $guard$  perform kontrol_private.exigir_insumo_ativo(p_insumo_id);
  select * into v_insumo from public.insumos where id = p_insumo_id for update;$guard$),
    ('public.abrir_embalagem(bigint,integer,uuid,text)',
      $anchor$  select * into v_lote
  from public.lotes_estoque l$anchor$,
      $guard$  perform kontrol_private.exigir_insumo_ativo((select l.insumo_id from public.lotes_estoque l where l.id = p_lote_id));
  select * into v_lote
  from public.lotes_estoque l$guard$),
    ('public.baixa_manual_lote(bigint,numeric,text,uuid)',
      $anchor$  select l.*, i.validade_apos_abertura_dias$anchor$,
      $guard$  perform kontrol_private.exigir_insumo_ativo((select l.insumo_id from public.lotes_estoque l where l.id = p_lote_id));
  select l.*, i.validade_apos_abertura_dias$guard$),
    ('public.baixa_manual_embalagens(bigint,integer,integer,uuid,text)',
      $anchor$  select * into v_lote
  from public.lotes_estoque l$anchor$,
      $guard$  perform kontrol_private.exigir_insumo_ativo((select l.insumo_id from public.lotes_estoque l where l.id = p_lote_id));
  select * into v_lote
  from public.lotes_estoque l$guard$),
    ('public.reservar_plano(bigint,jsonb)',
      $anchor$  update public.reservas_estoque
     set status = 'liberado',$anchor$,
      $guard$  -- Valida TODOS antes de liberar qualquer reserva anterior.
  perform kontrol_private.exigir_insumo_ativo(q.insumo_id)
  from (
    select distinct (x->>'insumo_id')::bigint as insumo_id
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) x
    where nullif(x->>'insumo_id', '') is not null
      and nullif(x->>'quantidade', '') is not null
      and (x->>'quantidade')::numeric > 0
  ) q order by q.insumo_id;
  update public.reservas_estoque
     set status = 'liberado',$guard$),
    ('public.criar_pedido_reposicao_estoque(text,text,text,date,jsonb)',
      $anchor$    perform pg_advisory_xact_lock(8100000000000000 + v_insumo_id);$anchor$,
      $guard$    perform kontrol_private.exigir_insumo_ativo(v_insumo_id);
    perform pg_advisory_xact_lock(8100000000000000 + v_insumo_id);$guard$),
    ('public.criar_pedido_faltas_planejamento(bigint,jsonb)',
      $anchor$  for v_item in select * from jsonb_array_elements(p_itens)$anchor$,
      $guard$  perform kontrol_private.exigir_insumo_ativo(q.insumo_id)
  from (
    select distinct (x->>'insumo_id')::bigint as insumo_id
    from jsonb_array_elements(p_itens) x
    where nullif(x->>'insumo_id', '') is not null
      and nullif(x->>'quantidade', '') is not null
      and (x->>'quantidade')::numeric > 0
  ) q order by q.insumo_id;
  for v_item in select * from jsonb_array_elements(p_itens)$guard$),
    ('public.gerar_reposicao_automatica()',
      $anchor$    select p.id into v_pedido_id$anchor$,
      $guard$    perform kontrol_private.exigir_insumo_ativo(r.insumo_id);
    select p.id into v_pedido_id$guard$),
    ('public.gerar_reposicao_automatica()',
      $anchor$  from kontrol_private.v_compras_atrasadas c
  where not exists ($anchor$,
      $guard$  from kontrol_private.v_compras_atrasadas c
  where exists (
    select 1 from public.pedidos_compra_itens item
    join public.insumos i on i.id = item.insumo_id
    where item.pedido_id = c.pedido_id and i.ativo
  ) and not exists ($guard$)
  ) patches(assinatura, ancora, substituto) loop
    v_func := r.assinatura::regprocedure;
    v_def := replace(pg_get_functiondef(v_func), chr(13), '');
    if array_length(string_to_array(v_def, r.ancora), 1) <> 2 then
      raise exception '0144: definição divergente; âncora deve ocorrer uma vez em %.', r.assinatura;
    end if;
    execute replace(v_def, r.ancora, r.substituto);
    -- CREATE OR REPLACE conserva ACL: nunca reabre a rota receber_lote já
    -- revogada de authenticated pela 0132 (service_role conserva sua ACL).
    execute format('revoke all on function %s from public, anon', v_func);
  end loop;
end $$;

commit;
