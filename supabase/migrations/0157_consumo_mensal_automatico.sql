-- 0157 — consumo mensal calculado automaticamente e consumo de referência.
--
-- Substitui o "fechamento mensal certificado" do pacote de evolução por um
-- cálculo direto das saídas já registradas no estoque. Nada é digitado:
--   * soma as saídas de cada mês civil completo (fuso America/Sao_Paulo) nos
--     últimos N meses, desde o primeiro movimento do insumo;
--   * converte tudo para embalagens (frasco fechado conta 1; retirada parcial
--     de frasco antigo divide pelo conteúdo da embalagem do cadastro);
--   * ajustes de inventário não contam como consumo, só aparecem como aviso;
--   * mede a confiança (alta, média, baixa, sem dados) pelo tamanho do
--     histórico, pelos meses com saída e pela variação entre os meses;
--   * escolhe o consumo de referência: o calculado quando a confiança é alta;
--     senão a estimativa manual (0152), quando existe; senão o calculado.
-- Os limites ficam em public.parametros e podem ser ajustados pela tela de
-- parâmetros, sem nova migration.
--
-- Também corrige a exclusão em cascata (0145/0147/0148): a estimativa manual
-- da 0152 tem FK "on delete restrict" e impediria excluir o insumo.
--
-- Não altera dados existentes nem permissões de tabelas. Leitura SECURITY
-- INVOKER: quem não vê o insumo no estoque não vê o consumo.
-- Rollback: drop function public.consumo_mensal_insumo(bigint) e
-- public.consumo_mensal_insumos(bigint[]); kontrol_private.consumo_mensal_calculo(bigint[]);
-- delete from public.parametros where chave like 'consumo_mensal_%';
-- reaplicar excluir_insumo_em_cascata da 0147.
begin;
set local lock_timeout = '10s';

insert into public.parametros (chave, valor, unidade, descricao) values
  ('consumo_mensal_janela_meses', 12, 'meses', 'Quantos meses completos entram no cálculo do consumo mensal.'),
  ('consumo_mensal_meses_alta', 6, 'meses', 'Meses de histórico necessários para confiança alta.'),
  ('consumo_mensal_meses_com_saida_alta', 4, 'meses', 'Meses com saída necessários para confiança alta.'),
  ('consumo_mensal_variacao_max_alta', 0.6, 'fração', 'Variação máxima entre meses (desvio/média) para confiança alta.'),
  ('consumo_mensal_meses_media', 3, 'meses', 'Meses de histórico necessários para confiança média.')
on conflict (chave) do nothing;

-- Cálculo para uma lista de insumos. Interno; as funções públicas abaixo
-- filtram pelo que a sessão enxerga.
create function kontrol_private.consumo_mensal_calculo(p_insumos bigint[])
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
      sum(case
            when m.tipo <> 'saida' then 0
            when ini.conteudo is not null and l.modelo_quantidade = 'EMBALAGEM_FECHADA' then m.quantidade
            when ini.conteudo is not null then m.quantidade / ini.conteudo
            when l.modelo_quantidade = 'EMBALAGEM_FECHADA' then m.quantidade * coalesce(nullif(l.conteudo_embalagem_snapshot, 0), 1)
            else m.quantidade
          end) as saidas,
      count(*) filter (where m.tipo = 'ajuste') as ajustes
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

revoke all on function kontrol_private.consumo_mensal_calculo(bigint[]) from public, anon;
grant execute on function kontrol_private.consumo_mensal_calculo(bigint[]) to authenticated;

-- Leitura de vários insumos de uma vez (lista do estoque, painéis).
create function public.consumo_mensal_insumos(p_insumos bigint[])
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_resultado jsonb;
begin
  if auth.uid() is null or not kontrol_private.tem_permissao_efetiva('estoque.ver') then
    raise exception 'Sem acesso ao estoque nesta sessão.' using errcode = '42501';
  end if;
  if p_insumos is null or cardinality(p_insumos) > 500 then
    raise exception 'Informe até 500 insumos.' using errcode = '22023';
  end if;

  with visiveis as (
    select s.insumo_id from public.v_estoque_saldo s where s.insumo_id = any (p_insumos)
  ), calc as (
    select c.* from kontrol_private.consumo_mensal_calculo(array(select v.insumo_id from visiveis v)) c
  ), manual as (
    select distinct on (r.insumo_id) r.insumo_id, r.quantidade_embalagens_mes, r.conteudo_embalagem,
      r.unidade_conteudo, r.fonte, r.data_referencia, r.revisao
    from kontrol_private.consumo_manual_insumos r
    where r.insumo_id in (select v.insumo_id from visiveis v)
    order by r.insumo_id, r.revisao desc
  ), juntos as (
    select c.*, m.quantidade_embalagens_mes as manual_embalagens, m.conteudo_embalagem as manual_conteudo,
      m.unidade_conteudo as manual_unidade, m.fonte as manual_fonte, m.data_referencia as manual_data,
      m.revisao as manual_revisao
    from calc c left join manual m on m.insumo_id = c.insumo_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'insumo_id', j.insumo_id,
      'unidade', j.unidade,
      'janela_meses', j.janela_meses,
      'meses_historico', j.meses_historico,
      'meses_com_saida', j.meses_com_saida,
      'media_mensal', j.media_mensal,
      'variacao', j.variacao,
      'ajustes', j.ajustes,
      'confianca', j.confianca,
      'meses', j.meses,
      'manual', case when j.manual_revisao is null then null else jsonb_build_object(
          'embalagens_mes', j.manual_embalagens,
          'conteudo_embalagem', j.manual_conteudo,
          'unidade_conteudo', j.manual_unidade,
          'fonte', j.manual_fonte,
          'data_referencia', j.manual_data,
          'revisao', j.manual_revisao,
          -- Valor na mesma unidade do cálculo.
          'valor', case when j.unidade = 'embalagem' then j.manual_embalagens
                        else j.manual_embalagens * j.manual_conteudo end) end,
      'referencia', case
          when j.confianca = 'alta' then jsonb_build_object('origem', 'calculado', 'valor', j.media_mensal)
          when j.manual_revisao is not null then jsonb_build_object('origem', 'manual', 'valor',
            case when j.unidade = 'embalagem' then j.manual_embalagens else j.manual_embalagens * j.manual_conteudo end)
          when j.confianca in ('media', 'baixa') then jsonb_build_object('origem', 'calculado', 'valor', j.media_mensal)
          else jsonb_build_object('origem', 'nenhuma', 'valor', null) end
    ) order by j.insumo_id), '[]'::jsonb)
  into v_resultado
  from juntos j;
  return v_resultado;
end $$;

create function public.consumo_mensal_insumo(p_insumo_id bigint)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v jsonb;
begin
  v := public.consumo_mensal_insumos(array[p_insumo_id]);
  if jsonb_array_length(v) = 0 then
    raise exception 'Insumo não disponível no estoque para esta sessão.' using errcode = '42501';
  end if;
  return v -> 0;
end $$;

revoke all on function public.consumo_mensal_insumos(bigint[]) from public, anon;
revoke all on function public.consumo_mensal_insumo(bigint) from public, anon;
grant execute on function public.consumo_mensal_insumos(bigint[]) to authenticated;
grant execute on function public.consumo_mensal_insumo(bigint) to authenticated;

-- Exclusão em cascata passa a apagar também a estimativa manual (0152).
do $$
declare
  v_def text := pg_get_functiondef('public.excluir_insumo_em_cascata(bigint)'::regprocedure);
  v_ancora text := '  delete from public.lotes_estoque where insumo_id = p_insumo_id;';
begin
  if position('consumo_manual_insumos' in v_def) > 0 then
    raise notice '0157: exclusão em cascata já trata a estimativa manual';
    return;
  end if;
  if position(v_ancora in v_def) = 0 then
    raise exception '0157: trecho esperado da 0147 não encontrado em excluir_insumo_em_cascata';
  end if;
  execute replace(v_def, v_ancora,
'  -- 0157: estimativa manual de consumo (0152).
  delete from kontrol_private.consumo_manual_insumos where insumo_id = p_insumo_id;
  get diagnostics v_n = row_count;
  v_resumo := v_resumo || jsonb_build_object(''consumo_manual_insumos'', v_n);

' || v_ancora);
end $$;

commit;
