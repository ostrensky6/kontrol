-- 0167 — correções de banco da auditoria de 08/11/2026.
--
-- 1. Consumo mensal (0157) não conta leitura desfeita. Desfazer uma saída por
--    leitura (0143) devolve o frasco com um 'ajuste' de motivo
--    'leitura desfeita: abertura de embalagem'; o cálculo somava a saída e
--    ignorava a devolução, inflando o consumo. Agora a devolução desconta no
--    mês em que foi lançada (nunca abaixo de zero) e não conta como ajuste.
--
-- 2. estoque_movimentacoes.data passa a nascer na data de Brasília. O padrão
--    era current_date do servidor (UTC): uma saída depois das 21h caía no dia
--    seguinte e, no último dia do mês, no mês seguinte.
--
-- 3. Leitura pela caixinha, como a 0166 fez com compras (recomendação da
--    auditoria aprovada por Antonio em 08/11):
--      * pedidos internos e tabelas filhas: pedido.ver, pedido.criar,
--        pedido.aprovar ou quem lê compras (pode_ler_compras, 0166);
--      * leituras de código (scan_eventos) e inventário: estoque.ver;
--      * identificadores: estoque.ver, cadastros.ver ou insumos.ver.
--    Das seis funções padrão, só Cadastro deixa de ler pedidos internos
--    (como já não lê compras); as demais leituras todas as funções têm.
--    Só muda a política de leitura aberta (using true); escrita, RLS e
--    funções security definer ficam como estão. Lotes e reservas continuam
--    abertos (decisão de 08/11).
--
-- 4. Auditoria do que faltava: estimativa manual de consumo (0152, apagada
--    pela exclusão em cascata da 0157) e vínculos de projeto (0151) quando
--    mudam por gatilho ou cascata. A configuração pelo Admin
--    (configurar_vinculo_projeto) já grava a própria trilha e não duplica.
--
-- Rollback: restaurar consumo_mensal_calculo da 0157; alter table
-- public.estoque_movimentacoes alter column data set default current_date;
-- alter policy <cada política listada em kontrol_private.leituras_0167>
-- using (true); drop trigger aud_consumo_manual_insumos on
-- kontrol_private.consumo_manual_insumos; drop trigger aud_projetos_vinculos
-- on kontrol_private.projetos_vinculos; drop function
-- kontrol_private.auditar_vinculo_projeto(), kontrol_private.pode_ler_pedidos_internos();
begin;
set local lock_timeout = '10s';

-- ---- 1. Consumo mensal sem leitura desfeita --------------------------------
create or replace function kontrol_private.consumo_mensal_calculo(p_insumos bigint[])
returns table (
  insumo_id bigint,
  unidade text,
  janela_meses integer,
  meses_historico integer,
  meses_com_saida integer,
  media_mensal numeric,
  variacao numeric,
  ajustes integer,
  confianca text,
  meses jsonb
)
language sql stable security invoker set search_path = '' as $$
  with cfg as (
    select
      coalesce((select p.valor::integer from public.parametros p where p.chave = 'consumo_mensal_janela_meses'), 12) as janela,
      coalesce((select p.valor::integer from public.parametros p where p.chave = 'consumo_mensal_meses_alta'), 6) as meses_alta,
      coalesce((select p.valor::integer from public.parametros p where p.chave = 'consumo_mensal_meses_com_saida_alta'), 4) as saida_alta,
      coalesce((select p.valor from public.parametros p where p.chave = 'consumo_mensal_variacao_max_alta'), 0.6) as variacao_alta,
      coalesce((select p.valor::integer from public.parametros p where p.chave = 'consumo_mensal_meses_media'), 3) as meses_media,
      date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date as mes_atual
  ), alvo as (
    select i.id as insumo_id, nullif(i.quantidade_embalagem, 0) as conteudo, i.unidade
    from public.insumos i
    where i.id = any (p_insumos)
  ), inicio as (
    select a.insumo_id, a.conteudo, a.unidade,
      greatest(
        (cfg.mes_atual - make_interval(months => greatest(cfg.janela, 1)))::date,
        coalesce((select date_trunc('month', min(m.data))::date
                  from public.estoque_movimentacoes m where m.insumo_id = a.insumo_id), cfg.mes_atual)
      ) as primeiro_mes
    from alvo a cross join cfg
  ), calendario as (
    select ini.insumo_id, g::date as mes
    from inicio ini cross join cfg
    cross join lateral generate_series(ini.primeiro_mes, (cfg.mes_atual - interval '1 month')::date, interval '1 month') g
  ), movimentos as (
    select m.insumo_id, date_trunc('month', m.data)::date as mes,
      greatest(sum(
        case
          when m.tipo = 'saida' then 1
          when m.tipo = 'ajuste' and m.motivo = 'leitura desfeita: abertura de embalagem' then -1
          else 0
        end
        * case
            when ini.conteudo is not null and l.modelo_quantidade = 'EMBALAGEM_FECHADA' then m.quantidade
            when ini.conteudo is not null then m.quantidade / ini.conteudo
            when l.modelo_quantidade = 'EMBALAGEM_FECHADA' then m.quantidade * coalesce(nullif(l.conteudo_embalagem_snapshot, 0), 1)
            else m.quantidade
          end), 0) as saidas,
      count(*) filter (where m.tipo = 'ajuste'
                         and m.motivo is distinct from 'leitura desfeita: abertura de embalagem') as ajustes
    from public.estoque_movimentacoes m
    join inicio ini on ini.insumo_id = m.insumo_id
    cross join cfg
    left join public.lotes_estoque l on l.id = m.lote_id
    where m.data >= ini.primeiro_mes and m.data < cfg.mes_atual
    group by m.insumo_id, date_trunc('month', m.data)
  ), serie as (
    select c.insumo_id, c.mes, coalesce(mv.saidas, 0) as saidas, coalesce(mv.ajustes, 0) as ajustes
    from calendario c
    left join movimentos mv on mv.insumo_id = c.insumo_id and mv.mes = c.mes
  ), resumo as (
    select s.insumo_id,
      count(*)::integer as n,
      count(*) filter (where s.saidas > 0)::integer as com_saida,
      avg(s.saidas) as media,
      stddev_pop(s.saidas) as desvio,
      sum(s.ajustes)::integer as ajustes,
      jsonb_agg(jsonb_build_object('mes', to_char(s.mes, 'YYYY-MM'), 'saidas', round(s.saidas, 4), 'ajustes', s.ajustes)
                order by s.mes desc) as meses
    from serie s
    group by s.insumo_id
  )
  select ini.insumo_id,
    case when ini.conteudo is not null then 'embalagem' else ini.unidade end,
    cfg.janela,
    coalesce(r.n, 0),
    coalesce(r.com_saida, 0),
    case when coalesce(r.com_saida, 0) > 0 then round(r.media, 4) end,
    case when coalesce(r.com_saida, 0) > 0 and r.media > 0 then round(r.desvio / r.media, 4) end,
    coalesce(r.ajustes, 0),
    case
      when coalesce(r.com_saida, 0) = 0 then 'sem_dados'
      when r.n >= cfg.meses_alta and r.com_saida >= cfg.saida_alta
           and r.desvio / r.media <= cfg.variacao_alta then 'alta'
      when r.n >= cfg.meses_media and r.com_saida >= 2 then 'media'
      else 'baixa'
    end,
    coalesce(r.meses, '[]'::jsonb)
  from inicio ini
  cross join cfg
  left join resumo r on r.insumo_id = ini.insumo_id;
$$;

-- ---- 2. Data do movimento em Brasília ---------------------------------------
alter table public.estoque_movimentacoes
  alter column data set default ((now() at time zone 'America/Sao_Paulo')::date);

-- ---- 3. Leitura pela caixinha --------------------------------------------------
create function kontrol_private.pode_ler_pedidos_internos()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select kontrol_private.tem_permissao_efetiva('pedido.ver')
      or kontrol_private.tem_permissao_efetiva('pedido.criar')
      or kontrol_private.tem_permissao_efetiva('pedido.aprovar')
      or kontrol_private.pode_ler_compras();
$$;
revoke all on function kontrol_private.pode_ler_pedidos_internos() from public, anon;
grant execute on function kontrol_private.pode_ler_pedidos_internos() to authenticated;
comment on function kontrol_private.pode_ler_pedidos_internos() is
  'Leitura de pedidos internos pela API (0167): caixinha de pedido ou de compras.';

-- Registro das políticas trocadas, para o rollback e para o teste.
create table kontrol_private.leituras_0167 (
  tabela text not null,
  politica text not null,
  primary key (tabela, politica)
);
revoke all on table kontrol_private.leituras_0167 from public, anon, authenticated;

do $$
declare
  v_regra record;
  v_pol record;
  n integer;
begin
  for v_regra in
    select * from (values
      ('pedidos_internos', '(select kontrol_private.pode_ler_pedidos_internos())'),
      ('pedidos_internos_itens', '(select kontrol_private.pode_ler_pedidos_internos())'),
      ('pedidos_internos_aprovacoes', '(select kontrol_private.pode_ler_pedidos_internos())'),
      ('pedidos_internos_anexos', '(select kontrol_private.pode_ler_pedidos_internos())'),
      ('pedidos_internos_comunicacoes', '(select kontrol_private.pode_ler_pedidos_internos())'),
      ('pedidos_internos_item_recebimentos', '(select kontrol_private.pode_ler_pedidos_internos())'),
      ('scan_eventos', '(select kontrol_private.tem_permissao_efetiva(''estoque.ver''))'),
      ('inventario_ciclos', '(select kontrol_private.tem_permissao_efetiva(''estoque.ver''))'),
      ('inventario_contagens', '(select kontrol_private.tem_permissao_efetiva(''estoque.ver''))'),
      ('identificadores', '((select kontrol_private.tem_permissao_efetiva(''estoque.ver''))'
                          ' or (select kontrol_private.tem_permissao_efetiva(''cadastros.ver''))'
                          ' or (select kontrol_private.tem_permissao_efetiva(''insumos.ver'')))')
    ) as t(tabela, condicao)
  loop
    n := 0;
    for v_pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = v_regra.tabela
        and cmd = 'SELECT' and permissive = 'PERMISSIVE' and qual = 'true'
    loop
      execute format('alter policy %I on public.%I using (%s)', v_pol.policyname, v_regra.tabela, v_regra.condicao);
      insert into kontrol_private.leituras_0167 values (v_regra.tabela, v_pol.policyname);
      n := n + 1;
    end loop;
    if n = 0 then
      raise notice '0167: % sem leitura aberta; nada a trocar', v_regra.tabela;
    end if;
  end loop;
end $$;

-- ---- 4. Auditoria do que faltava ------------------------------------------------
drop trigger if exists aud_consumo_manual_insumos on kontrol_private.consumo_manual_insumos;
create trigger aud_consumo_manual_insumos
  after insert or update or delete on kontrol_private.consumo_manual_insumos
  for each row execute function public.fn_auditoria('insumo_id');

-- Vínculo criado pelo gatilho de projeto novo (0160) ou apagado em cascata
-- (projeto ou perfil excluído). A mudança direta pelo Admin passa por
-- configurar_vinculo_projeto, que já grava a trilha: só entra aqui o que
-- vem de outro gatilho (pg_trigger_depth > 1).
create function kontrol_private.auditar_vinculo_projeto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chave text;
  v_usuario text;
begin
  if pg_catalog.pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      v_chave := old.projeto_id::text || ':' || old.usuario_id::text;
    else
      v_chave := new.projeto_id::text || ':' || new.usuario_id::text;
    end if;
    begin
      v_usuario := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
    exception when others then
      v_usuario := null;
    end;
    insert into public.auditoria(tabela, registro_id, acao, valor_anterior, valor_novo, usuario)
    values ('projetos_vinculos', v_chave,
            pg_catalog.lower(tg_op),
            case when tg_op = 'DELETE' then pg_catalog.to_jsonb(old) end,
            case when tg_op = 'INSERT' then pg_catalog.to_jsonb(new) end,
            coalesce(v_usuario, pg_catalog.current_setting('app.usuario', true)));
  end if;
  return null;
end $$;
revoke all on function kontrol_private.auditar_vinculo_projeto() from public, anon, authenticated;

drop trigger if exists aud_projetos_vinculos on kontrol_private.projetos_vinculos;
create trigger aud_projetos_vinculos
  after insert or delete on kontrol_private.projetos_vinculos
  for each row execute function kontrol_private.auditar_vinculo_projeto();

commit;
