-- Cadeia orçamento → proposta → aprovação → planejamento (auditoria de
-- 2026-09-26, segunda onda; decisões do dono de 26/09).
--
-- O que muda:
--  1. ORC2-1: incluir análise e alterar a quantidade em /orcamento/[id]
--     falhavam (o gatilho de recálculo recusava a gravação do custo fora da
--     RPC). Nova RPC transacional public.salvar_item_orcamento grava o item e
--     o custo congelado do módulo na mesma transação.
--  2. ORC2-2: o plano da proposta aprovada passa a ler as análises do próprio
--     snapshot da versão (com codigo_analise); a tabela viva só vale para
--     versões antigas sem o código. Itens de módulo revisado, enviado,
--     aprovado ou cancelado não podem mais ser incluídos, trocados nem
--     apagados (gatilho kontrol_proteger_itens_modulo).
--  3. ORC-3/ORC2-3: uma versão viva por proposta. Emitir ou duplicar marca como
--     substituídas todas as versões não aprovadas (emitido, enviado,
--     alterado_reenviado) e revoga os links delas; não se emite nem se aprova
--     outra versão enquanto houver uma aprovada (é preciso cancelá-la antes).
--  4. ORC-7/ORC2-4: versão vencida não é aprovada (equipe nem link). Job
--     diário no pg_cron (kontrol-vencimento-propostas) marca como vencidas as
--     versões emitidas/enviadas fora da validade.
--  5. Cancelar proposta aprovada cancela o plano dela em rascunho ou reservado
--     (reservas liberadas por public.cancelar_planejamento); plano em execução
--     continua e o coordenador é avisado. A demanda volta a "orçada".
--  6. ORC2-12: a proposta (demandas_propostas) é travada FOR UPDATE antes de
--     aprovar, cancelar, emitir ou gerar plano: duas aprovações paralelas não
--     geram dois planos. ORC2-7: nova RPC public.gerar_planejamento_da_proposta
--     (versão aprovada sem plano ativo); aviso quando a proposta não tem
--     análises; plano cancelado não impede gerar outro.
--  7. ORC-10: índice único de módulo ativo por proposta (só criado se não
--     houver duplicidade; senão, NOTICE com as propostas a sanear).
--  8. ORC-11: aprovado_em/aprovado_por do link só mudam pela aprovação pública;
--     link revogado não volta; o link aponta sempre para a mesma versão.
--  9. ORC-2/ORC2-9: link público por versão, também para proposta sem módulo
--     de projeto (orcamento_projeto_id passa a aceitar nulo).
-- 10. ORC2-5/ORC2-6/ORC-8/ORC-9: view v_proposta_aprovada_vigente (uma linha
--     por proposta: a versão aprovada vigente e seus totais congelados).
-- 11. Item 9: proposta aprovada marca a demanda como "aprovada"; aprovação
--     pelo link avisa o coordenador.
--
-- Não remove tabelas, colunas, dados, RLS nem gatilhos de auditoria. Funções
-- recriadas por inteiro (create or replace) a partir da definição atual.
-- Rollback: reaplicar as definições anteriores de transicionar_orcamento_final,
-- aprovar_orcamento_publico, ler_orcamento_publico, validar_versao_link_orcamento,
-- emitir_orcamento_final_transacional (11 args), duplicar_orcamento_final_transacional,
-- proteger_orcamento_final_emitido, proteger_recalculo_orcamento e
-- kontrol_private.gerar_plano_da_versao_aprovada (0122); dropar as funções
-- novas, os gatilhos kontrol_proteger_itens_modulo e
-- kontrol_proteger_aprovacao_link, a view v_proposta_aprovada_vigente, os
-- índices orcamentos_modulo_ativo_uidx, orcamento_projetos_modulo_ativo_uidx e
-- planejamento_versao_final_ativo_uidx; recriar planejamento_versao_final_uidx;
-- cron.unschedule('kontrol-vencimento-propostas'). A coluna
-- orcamento_projeto_links.orcamento_projeto_id só volta a NOT NULL se não
-- houver link sem módulo de projeto.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---- 1. Itens travados de módulo revisado/enviado/aprovado/cancelado --------
create or replace function kontrol_private.proteger_itens_modulo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coluna text := case tg_table_name when 'orcamento_itens' then 'orcamento_id' else 'orcamento_projeto_id' end;
  v_ids bigint[] := '{}';
  v_id bigint;
  v_status text;
  v_status_operacional text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_ids := v_ids || nullif(to_jsonb(old) ->> v_coluna, '')::bigint;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_ids := v_ids || nullif(to_jsonb(new) ->> v_coluna, '')::bigint;
  end if;

  foreach v_id in array v_ids loop
    continue when v_id is null;
    if tg_table_name = 'orcamento_itens' then
      select status, status_operacional into v_status, v_status_operacional
      from public.orcamentos where id = v_id;
    else
      select status, null into v_status, v_status_operacional
      from public.orcamento_projetos where id = v_id;
    end if;
    -- Módulo já apagado (exclusão em cascata): nada a proteger.
    continue when not found;
    if v_status in ('enviado', 'aprovado', 'cancelado')
       or coalesce(v_status_operacional, '') in ('revisado', 'cancelado') then
      raise exception 'Análises e quantidades deste orçamento estão travadas (revisado, enviado, aprovado ou cancelado). A proposta emitida guarda o que foi enviado ao cliente.'
        using errcode = '22023';
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

revoke all on function kontrol_private.proteger_itens_modulo()
  from public, anon, authenticated, service_role;

drop trigger if exists kontrol_proteger_itens_modulo on public.orcamento_itens;
create trigger kontrol_proteger_itens_modulo
  before insert or delete or update of codigo_analise, n_amostras, orcamento_id
  on public.orcamento_itens
  for each row execute function kontrol_private.proteger_itens_modulo();

drop trigger if exists kontrol_proteger_itens_modulo on public.orcamento_projeto_analises;
create trigger kontrol_proteger_itens_modulo
  before insert or delete or update of codigo_analise, n_amostras, orcamento_projeto_id
  on public.orcamento_projeto_analises
  for each row execute function kontrol_private.proteger_itens_modulo();

-- ---- 2. ORC2-1: salvar item do orçamento laboratorial ------------------------
create or replace function public.salvar_item_orcamento(
  p_orcamento_id bigint,
  p_codigo_analise text,
  p_n_amostras numeric,
  p_custo_unitario numeric,
  p_preco_unitario numeric,
  p_valor_snapshot jsonb,
  p_custo_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_orcamento record;
  v_codigo text := btrim(coalesce(p_codigo_analise, ''));
  v_principal bigint;
  v_analise record;
  v_itens integer;
  v_remover boolean := p_n_amostras is null or p_n_amostras <= 0;
begin
  perform kontrol_private.exigir_permissao('orcamentos.criar_editar');
  if v_codigo = '' then
    raise exception 'Informe a análise.' using errcode = '22023';
  end if;

  select id, status, status_operacional
    into v_orcamento
    from public.orcamentos
   where id = p_orcamento_id
   for update;
  if not found then
    raise exception 'Orçamento não encontrado.' using errcode = 'P0002';
  end if;
  if v_orcamento.status in ('enviado', 'aprovado', 'cancelado')
     or v_orcamento.status_operacional in ('revisado', 'cancelado') then
    raise exception 'Análises e quantidades deste orçamento estão travadas (revisado, enviado, aprovado ou cancelado).'
      using errcode = '22023';
  end if;

  select id into v_principal
    from public.orcamento_itens
   where orcamento_id = p_orcamento_id and codigo_analise = v_codigo
   order by id
   limit 1;

  perform set_config('app.orcamento_custo_recalculo', 'permitido', true);

  if v_remover then
    delete from public.orcamento_itens
     where orcamento_id = p_orcamento_id and codigo_analise = v_codigo;
  else
    if p_custo_unitario is null or p_preco_unitario is null
       or p_custo_unitario < 0 or p_preco_unitario < 0 then
      raise exception 'Custo e preço da análise são obrigatórios e não podem ser negativos.' using errcode = '22023';
    end if;
    if v_principal is null then
      select ativo, ofertavel into v_analise from public.analises where codigo = v_codigo;
      if not found or not coalesce(v_analise.ativo, false) or not coalesce(v_analise.ofertavel, false) then
        raise exception 'Análise inativa ou fora da oferta; não pode entrar em novos orçamentos.' using errcode = '22023';
      end if;
      insert into public.orcamento_itens
        (orcamento_id, codigo_analise, n_amostras, custo_unitario, preco_unitario, valor_snapshot)
      values
        (p_orcamento_id, v_codigo, p_n_amostras, p_custo_unitario, p_preco_unitario,
         coalesce(p_valor_snapshot, '{}'::jsonb));
    else
      update public.orcamento_itens
         set n_amostras = p_n_amostras,
             custo_unitario = p_custo_unitario,
             preco_unitario = p_preco_unitario,
             valor_snapshot = coalesce(p_valor_snapshot, valor_snapshot)
       where id = v_principal;
      -- Linhas repetidas da mesma análise (legado) viram uma só.
      delete from public.orcamento_itens
       where orcamento_id = p_orcamento_id and codigo_analise = v_codigo and id <> v_principal;
    end if;
  end if;

  select count(*) into v_itens from public.orcamento_itens where orcamento_id = p_orcamento_id;

  update public.orcamentos
     set custo_snapshot = coalesce(p_custo_snapshot, '{}'::jsonb),
         custo_revisao = custo_revisao + 1,
         status_operacional = case when v_itens > 0 then 'preenchido' else 'pendente' end,
         status_operacional_atualizado_em = now()
   where id = p_orcamento_id;

  return jsonb_build_object(
    'orcamento_id', p_orcamento_id,
    'codigo_analise', v_codigo,
    'removido', v_remover,
    'itens', v_itens
  );
end
$function$;

revoke all on function public.salvar_item_orcamento(bigint, text, numeric, numeric, numeric, jsonb, jsonb)
  from public, anon;
grant execute on function public.salvar_item_orcamento(bigint, text, numeric, numeric, numeric, jsonb, jsonb)
  to authenticated;

create or replace function public.proteger_recalculo_orcamento()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $function$
begin
  if not public.fn_marcador_transacional_autorizado(array[
       'public.recalcular_orcamento_transacional(bigint,text,integer,text,jsonb,jsonb,uuid)'::regprocedure,
       'public.salvar_item_orcamento(bigint,text,numeric,numeric,numeric,jsonb,jsonb)'::regprocedure
     ])
     or current_setting('app.orcamento_custo_recalculo', true) is distinct from 'permitido' then
    raise exception 'Custos do orcamento exigem recalculo transacional.' using errcode = '42501';
  end if;
  return new;
end
$function$;

-- ---- 3. Plano da proposta aprovada (ORC2-2, ORC2-7, ORC2-12) ----------------
-- Plano cancelado não ocupa mais a vaga da versão: dá para gerar outro.
create unique index if not exists planejamento_versao_final_ativo_uidx
  on public.planejamento (orcamento_final_versao_id)
  where orcamento_final_versao_id is not null and status_operacional <> 'cancelado';
drop index if exists public.planejamento_versao_final_uidx;

create or replace function kontrol_private.criar_plano_da_versao(
  p_versao_id bigint,
  p_planejado_por text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_versao record;
  v_demanda jsonb;
  v_rotulo text;
  v_existente record;
  v_plano bigint;
  v_orcamento_id bigint;
  v_orcamento_projeto_id bigint;
  v_projeto_id bigint;
  v_itens jsonb;
begin
  select id, demanda_id, numero, status, snapshot
    into v_versao
    from public.orcamento_final_versoes
   where id = p_versao_id;
  if not found then
    raise exception 'Proposta não encontrada.' using errcode = 'P0002';
  end if;

  -- ORC2-12: um plano por proposta mesmo com aprovações em paralelo.
  perform 1 from public.demandas_propostas where id = v_versao.demanda_id for update;

  v_demanda := coalesce(v_versao.snapshot -> 'demanda', '{}'::jsonb);
  v_rotulo := coalesce(v_versao.numero, '#' || v_versao.id);

  select p.id, p.status_operacional, p.orcamento_final_versao_id, vv.status as versao_status
    into v_existente
    from public.planejamento p
    join public.orcamento_final_versoes vv on vv.id = p.orcamento_final_versao_id
   where vv.demanda_id = v_versao.demanda_id
     and p.status_operacional <> 'cancelado'
   order by p.id desc
   limit 1;

  if found then
    if v_existente.orcamento_final_versao_id <> v_versao.id then
      -- A versão anterior foi cancelada e o plano seguiu (em execução): o
      -- plano ativo passa a acompanhar a versão aprovada vigente.
      if v_existente.versao_status not in ('aprovado', 'convertido_projeto')
         and v_existente.status_operacional <> 'concluido' then
        update public.planejamento
           set orcamento_final_versao_id = v_versao.id
         where id = v_existente.id;
      end if;
      begin
        insert into public.notificacoes (
          tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, dedupe_key
        ) values (
          'sistema',
          'Nova versão aprovada: confira o planejamento #' || v_existente.id,
          'A proposta ' || v_rotulo || ' foi aprovada, mas já tem o planejamento #'
            || v_existente.id || '. Ajuste análises e amostras do plano se a nova versão mudou algo.',
          'planejamento', v_existente.id, 'coordenador', 'plano_versao_' || v_versao.id
        )
        on conflict do nothing;
      exception when others then
        raise warning '0126: aviso do plano nao registrado: %', sqlerrm;
      end;
    end if;
    return jsonb_build_object('plano_id', v_existente.id, 'criado', false, 'motivo', 'existente');
  end if;

  -- Análises e amostras congeladas na versão (codigo_analise no snapshot desde
  -- a 0126). Versões antigas sem o código caem na tabela viva pelo id.
  with itens as (
    select coalesce(nullif(item ->> 'codigo_analise', ''), oi.codigo_analise) as codigo_analise,
           nullif(item ->> 'n_amostras', '')::numeric as n_amostras
    from jsonb_array_elements(case jsonb_typeof(v_versao.snapshot -> 'orcamentos_analises')
                                when 'array' then v_versao.snapshot -> 'orcamentos_analises' else '[]'::jsonb end) orc
    cross join lateral jsonb_array_elements(case jsonb_typeof(orc -> 'orcamento_itens')
                                when 'array' then orc -> 'orcamento_itens' else '[]'::jsonb end) item
    left join public.orcamento_itens oi on oi.id = nullif(item ->> 'id', '')::bigint
    union all
    select coalesce(nullif(item ->> 'codigo_analise', ''), opa.codigo_analise),
           nullif(item ->> 'n_amostras', '')::numeric
    from jsonb_array_elements(case jsonb_typeof(v_versao.snapshot -> 'orcamentos_projeto')
                                when 'array' then v_versao.snapshot -> 'orcamentos_projeto' else '[]'::jsonb end) orc
    cross join lateral jsonb_array_elements(case jsonb_typeof(orc -> 'orcamento_projeto_analises')
                                when 'array' then orc -> 'orcamento_projeto_analises' else '[]'::jsonb end) item
    left join public.orcamento_projeto_analises opa on opa.id = nullif(item ->> 'id', '')::bigint
  )
  select jsonb_agg(jsonb_build_object('codigo_analise', codigo_analise, 'n_amostras', total))
    into v_itens
  from (
    select i.codigo_analise, sum(i.n_amostras) as total
    from itens i
    join public.analises a on a.codigo = i.codigo_analise
    where i.n_amostras > 0
    group by i.codigo_analise
  ) agregados;

  if v_itens is null then
    -- Proposta só com custos de projeto: não há análise para planejar. Avisa
    -- em vez de sair em silêncio.
    begin
      insert into public.notificacoes (
        tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, dedupe_key
      ) values (
        'sistema',
        'Proposta ' || v_rotulo || ' aprovada sem análises',
        'A proposta foi aprovada, mas não tem análises laboratoriais: não há planejamento a gerar. Organize a execução pelo projeto.',
        'orcamento_final', v_versao.id, 'coordenador', 'plano_sem_analises_' || v_versao.id
      )
      on conflict do nothing;
    exception when others then
      raise warning '0126: aviso sem analises nao registrado: %', sqlerrm;
    end;
    return jsonb_build_object('plano_id', null, 'criado', false, 'motivo', 'sem_analises');
  end if;

  select max(o.id) into v_orcamento_id
    from jsonb_array_elements(case jsonb_typeof(v_versao.snapshot -> 'orcamentos_analises')
                                when 'array' then v_versao.snapshot -> 'orcamentos_analises' else '[]'::jsonb end) orc
    join public.orcamentos o on o.id = nullif(orc ->> 'id', '')::bigint;
  select max(o.id) into v_orcamento_projeto_id
    from jsonb_array_elements(case jsonb_typeof(v_versao.snapshot -> 'orcamentos_projeto')
                                when 'array' then v_versao.snapshot -> 'orcamentos_projeto' else '[]'::jsonb end) orc
    join public.orcamento_projetos o on o.id = nullif(orc ->> 'id', '')::bigint;
  select p.id into v_projeto_id
    from public.projetos p
   where p.id = nullif(v_demanda ->> 'projeto_id', '')::bigint;

  insert into public.planejamento (
    nome, projeto_id, origem_planejamento, orcamento_id, orcamento_projeto_id,
    orcamento_final_versao_id, planejado_por, status_operacional
  ) values (
    left('Proposta ' || v_rotulo || ' — '
      || coalesce(nullif(v_demanda ->> 'cliente_nome', ''), nullif(v_demanda ->> 'titulo', ''), 'sem cliente'), 200),
    v_projeto_id,
    case when v_orcamento_id is null then 'orcamento_projeto' else 'orcamento' end,
    v_orcamento_id,
    v_orcamento_projeto_id,
    v_versao.id,
    coalesce(nullif(btrim(p_planejado_por), ''), 'Automático (proposta aprovada)'),
    'rascunho'
  )
  on conflict do nothing
  returning id into v_plano;

  if v_plano is null then
    select id into v_plano
      from public.planejamento
     where orcamento_final_versao_id = v_versao.id and status_operacional <> 'cancelado';
    return jsonb_build_object('plano_id', v_plano, 'criado', false, 'motivo', 'existente');
  end if;

  insert into public.planejamento_itens (planejamento_id, codigo_analise, n_amostras)
  select v_plano, x ->> 'codigo_analise', (x ->> 'n_amostras')::numeric
  from jsonb_array_elements(v_itens) x;

  -- O aviso não pode desfazer a aprovação nem o plano.
  begin
    insert into public.notificacoes (
      tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, dedupe_key
    ) values (
      'sistema',
      'Planejamento #' || v_plano || ' criado da proposta aprovada',
      'A proposta ' || v_rotulo || ' foi aprovada. O plano está em rascunho: defina datas e equipamentos e reserve os insumos.',
      'planejamento', v_plano, 'coordenador', 'plano_versao_' || v_versao.id || '_' || v_plano
    )
    on conflict do nothing;
  exception when others then
    raise warning '0126: aviso do plano nao registrado: %', sqlerrm;
  end;

  return jsonb_build_object('plano_id', v_plano, 'criado', true, 'motivo', 'criado');
end $$;

revoke all on function kontrol_private.criar_plano_da_versao(bigint, text)
  from public, anon, authenticated, service_role;

create or replace function kontrol_private.gerar_plano_da_versao_aprovada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kontrol_private.criar_plano_da_versao(new.id, null);
  -- Item 9: a demanda acompanha a proposta aprovada.
  update public.demandas_propostas
     set status = 'aprovada'
   where id = new.demanda_id
     and status in ('nova', 'em_analise', 'orcada');
  return new;
end $$;

revoke all on function kontrol_private.gerar_plano_da_versao_aprovada()
  from public, anon, authenticated, service_role;

create or replace function public.gerar_planejamento_da_proposta(p_versao_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_claims jsonb;
begin
  perform kontrol_private.exigir_permissao('planejamento.editar');
  select status into v_status from public.orcamento_final_versoes where id = p_versao_id;
  if not found then
    raise exception 'Proposta não encontrada.' using errcode = 'P0002';
  end if;
  if v_status not in ('aprovado', 'convertido_projeto') then
    raise exception 'Só proposta aprovada gera planejamento.' using errcode = '22023';
  end if;
  v_claims := coalesce(nullif(pg_catalog.current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  return kontrol_private.criar_plano_da_versao(
    p_versao_id,
    'Gerado da proposta' || coalesce(' por ' || nullif(v_claims ->> 'email', ''), '')
  );
end $$;

revoke all on function public.gerar_planejamento_da_proposta(bigint) from public, anon;
grant execute on function public.gerar_planejamento_da_proposta(bigint) to authenticated;

-- ---- 4. Uma versão viva por proposta: emissão e duplicação -----------------
create or replace function public.emitir_orcamento_final_transacional(p_demanda_id bigint, p_validade_dias integer, p_total_laboratorio_custo numeric, p_total_laboratorio_preco numeric, p_total_projeto_custo numeric, p_total_projeto_final numeric, p_total_final numeric, p_snapshot jsonb, p_parametros jsonb, p_criado_por uuid, p_usuario_email text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_status      text;
  v_versao      integer;
  v_numero      text;
  v_valido_ate  date;
  v_versao_id   bigint;
  v_de_status   text;
  v_lab_ativos  integer;
  v_proj_ativos integer;
  v_aprovada    text;
  v_substituidas bigint[];
begin
  -- EXIGÊNCIA DE SEGURANÇA: permissão efetiva no nível de banco de dados
  perform kontrol_private.exigir_permissao('orcamentos.emitir');

  -- 1. Lock da demanda + existência.
  select status into v_status
    from demandas_propostas
   where id = p_demanda_id
   for update;
  if not found then
    raise exception 'Orçamento % não encontrado.', p_demanda_id using errcode = 'no_data_found';
  end if;

  -- 2. Integridade: não emitir com duplicidade ativa inesperada.
  select count(*) into v_lab_ativos
    from orcamentos
   where demanda_id = p_demanda_id
     and coalesce(status, '') <> 'cancelado'
     and coalesce(status_operacional, '') <> 'cancelado';
  select count(*) into v_proj_ativos
    from orcamento_projetos
   where demanda_id = p_demanda_id
     and coalesce(status, '') <> 'cancelado';
  if v_lab_ativos > 1 or v_proj_ativos > 1 then
    raise exception 'Há orçamentos duplicados neste registro (laboratório=%, projeto=%). Peça revisão ao gestor antes de emitir.',
      v_lab_ativos, v_proj_ativos using errcode = 'raise_exception';
  end if;

  -- 3. Uma versão viva (0126): com proposta aprovada, não se emite outra.
  select numero into v_aprovada
    from orcamento_final_versoes
   where demanda_id = p_demanda_id and status in ('aprovado', 'convertido_projeto')
   order by versao desc
   limit 1;
  if v_aprovada is not null then
    raise exception 'A proposta % já está aprovada. Cancele a aprovação antes de emitir nova versão.', v_aprovada
      using errcode = '22023';
  end if;

  -- 4. Próxima versão SOB LOCK (serializa emissões concorrentes da mesma demanda).
  select coalesce(max(versao), 0) + 1 into v_versao
    from orcamento_final_versoes
   where demanda_id = p_demanda_id;
  v_numero := 'OF-' || extract(year from now())::int || '-' || lpad(p_demanda_id::text, 4, '0') || '-v' || v_versao;
  v_valido_ate := current_date + (coalesce(p_validade_dias, 30))::int;

  -- de_status do evento = versão viva anterior, se houver.
  select 'v' || versao into v_de_status
    from orcamento_final_versoes
   where demanda_id = p_demanda_id and status in ('emitido', 'enviado', 'alterado_reenviado')
   order by versao desc
   limit 1;

  -- 5. Substitui TODAS as versões vivas não aprovadas e revoga os links delas.
  with substituidas as (
    update orcamento_final_versoes
       set status = 'substituido'
     where demanda_id = p_demanda_id and status in ('emitido', 'enviado', 'alterado_reenviado')
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_substituidas from substituidas;

  update orcamento_projeto_links
     set revogado = true
   where orcamento_final_versao_id = any(v_substituidas)
     and not revogado
     and aprovado_em is null;

  -- 6. Insere a nova versão.
  insert into orcamento_final_versoes (
    demanda_id, versao, numero, validade_dias, valido_ate,
    total_laboratorio_custo, total_laboratorio_preco, total_projeto_custo,
    total_projeto_final, total_final, snapshot, criado_por
  ) values (
    p_demanda_id, v_versao, v_numero, coalesce(p_validade_dias, 30), v_valido_ate,
    coalesce(p_total_laboratorio_custo, 0), coalesce(p_total_laboratorio_preco, 0),
    coalesce(p_total_projeto_custo, 0), coalesce(p_total_projeto_final, 0),
    coalesce(p_total_final, 0), coalesce(p_snapshot, '{}'::jsonb), p_criado_por
  ) returning id into v_versao_id;

  -- 7. Parâmetros aplicados (quando a engine produziu um snapshot válido).
  if p_parametros is not null and p_parametros <> 'null'::jsonb then
    insert into orcamento_parametros_aplicados (
      demanda_id, orcamento_laboratorial_id, orcamento_projeto_id, orcamento_final_versao_id, versao,
      metodo_calculo, laboratorio_modo, subtotal_laboratorio, subtotal_projeto, subtotal_custos,
      total_parametros, total_final, parametros_snapshot, formula_snapshot, alertas_snapshot, criado_por
    ) values (
      p_demanda_id,
      nullif(p_parametros->>'orcamento_laboratorial_id', '')::bigint,
      nullif(p_parametros->>'orcamento_projeto_id', '')::bigint,
      v_versao_id, v_versao,
      coalesce(p_parametros->>'metodo_calculo', 'GROSS_UP'),
      coalesce(p_parametros->>'laboratorio_modo', 'CUSTO_TECNICO'),
      coalesce((p_parametros->>'subtotal_laboratorio')::numeric, 0),
      coalesce((p_parametros->>'subtotal_projeto')::numeric, 0),
      coalesce((p_parametros->>'subtotal_custos')::numeric, 0),
      coalesce((p_parametros->>'total_parametros')::numeric, 0),
      coalesce((p_parametros->>'total_final')::numeric, 0),
      coalesce(p_parametros->'parametros_snapshot', '[]'::jsonb),
      coalesce(p_parametros->'formula_snapshot', '{}'::jsonb),
      coalesce(p_parametros->'alertas_snapshot', '[]'::jsonb),
      p_criado_por
    );
  end if;

  -- 8. Status da demanda → 'orcada' apenas a partir de nova/em_analise.
  if v_status in ('nova', 'em_analise') then
    update demandas_propostas set status = 'orcada' where id = p_demanda_id;
  end if;

  -- 9. Evento/auditoria DENTRO da transação.
  insert into eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values (
    'orcamento_final', p_demanda_id, v_de_status, 'v' || v_versao, p_usuario_email,
    'Orcamento final ' || v_numero || ' emitido para demanda #' || p_demanda_id || '.'
      || case when cardinality(v_substituidas) > 0
           then ' Versões substituídas: ' || cardinality(v_substituidas) || '.' else '' end
  );

  return jsonb_build_object('id', v_versao_id, 'numero', v_numero, 'versao', v_versao);
end
$function$;

create or replace function public.duplicar_orcamento_final_transacional(p_versao_id bigint, p_validade_dias integer, p_operacao_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_original public.orcamento_final_versoes%rowtype;
  v_demanda_id bigint;
  v_versao integer;
  v_numero text;
  v_nova_id bigint;
  v_claims jsonb;
  v_ator text;
  v_ator_id uuid;
  v_payload jsonb;
  v_existente record;
  v_resultado jsonb;
  v_aprovada text;
  v_substituidas bigint[];
begin
  perform kontrol_private.exigir_permissao('orcamentos.emitir');
  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), nullif(v_claims->>'sub', ''));
  if v_ator is null then
    raise exception 'Ator autenticado obrigatorio.' using errcode = '42501';
  end if;
  if coalesce(v_claims->>'sub', '') ~ '^[0-9a-fA-F-]{36}$' then
    v_ator_id := (v_claims->>'sub')::uuid;
  end if;
  if coalesce(p_validade_dias, 0) <= 0 then
    raise exception 'Validade deve ser positiva.' using errcode = '22023';
  end if;
  if p_operacao_id is null then
    raise exception 'operacao_id obrigatoria.' using errcode = '22023';
  end if;

  v_payload := jsonb_build_object(
    'versao_id', p_versao_id,
    'validade_dias', p_validade_dias,
    'ator_id', v_ator_id
  );

  perform pg_advisory_xact_lock(hashtextextended(p_operacao_id::text, 0));
  select id, numero, versao, operacao_payload
    into v_existente
    from public.orcamento_final_versoes
   where operacao_id = p_operacao_id
   for update;

  if found then
    if v_existente.operacao_payload is distinct from v_payload then
      raise exception 'IDEMPOTENCY_CONFLICT: OPERACAO_ID_REUTILIZADA_COM_PAYLOAD_DIFERENTE'
        using errcode = '22023';
    end if;
    return jsonb_build_object('repetido', true) || jsonb_build_object(
      'id', v_existente.id,
      'numero', v_existente.numero,
      'versao', v_existente.versao
    );
  end if;

  select demanda_id into v_demanda_id
    from public.orcamento_final_versoes
   where id = p_versao_id;
  if not found then
    raise exception 'Versao final nao encontrada.' using errcode = 'P0002';
  end if;

  perform 1
    from public.demandas_propostas
   where id = v_demanda_id
   for update;

  select * into v_original
    from public.orcamento_final_versoes
   where id = p_versao_id
   for update;
  if not found then
    raise exception 'Versao final nao encontrada.' using errcode = 'P0002';
  end if;

  -- Uma versão viva (0126): com proposta aprovada, não se cria outra.
  select numero into v_aprovada
    from public.orcamento_final_versoes
   where demanda_id = v_original.demanda_id and status in ('aprovado', 'convertido_projeto')
   order by versao desc
   limit 1;
  if v_aprovada is not null then
    raise exception 'A proposta % já está aprovada. Cancele a aprovação antes de criar nova versão.', v_aprovada
      using errcode = '22023';
  end if;

  select coalesce(max(versao), 0) + 1
    into v_versao
    from public.orcamento_final_versoes
   where demanda_id = v_original.demanda_id;
  v_numero := regexp_replace(v_original.numero, '-v[0-9]+$', '') || '-v' || v_versao;

  perform set_config('app.orcamento_final_transicao', 'permitida', true);
  with substituidas as (
    update public.orcamento_final_versoes
       set status = 'substituido'
     where demanda_id = v_original.demanda_id
       and status in ('emitido', 'enviado', 'alterado_reenviado')
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_substituidas from substituidas;

  update public.orcamento_projeto_links
     set revogado = true
   where orcamento_final_versao_id = any(v_substituidas)
     and not revogado
     and aprovado_em is null;

  insert into public.orcamento_final_versoes (
    demanda_id, versao, numero, status, validade_dias, valido_ate,
    total_laboratorio_custo, total_laboratorio_preco,
    total_projeto_custo, total_projeto_final, total_final,
    snapshot, criado_por, duplicada_de_id, operacao_id, operacao_payload
  ) values (
    v_original.demanda_id, v_versao, v_numero, 'emitido', p_validade_dias,
    current_date + p_validade_dias,
    v_original.total_laboratorio_custo, v_original.total_laboratorio_preco,
    v_original.total_projeto_custo, v_original.total_projeto_final, v_original.total_final,
    v_original.snapshot, v_ator_id, v_original.id, p_operacao_id, v_payload
  ) returning id into v_nova_id;

  v_resultado := jsonb_build_object(
    'id', v_nova_id,
    'numero', v_numero,
    'versao', v_versao,
    'repetido', false
  );

  insert into public.eventos_status
    (entidade, entidade_id, de_status, para_status, usuario, observacao,
     operacao_id, operacao_payload)
  values
    ('orcamento_final', v_nova_id, 'versao_' || v_original.id, 'v' || v_versao, v_ator,
     'Versao final duplicada atomicamente a partir de #' || v_original.id || '.',
     p_operacao_id, jsonb_build_object('entrada', v_payload, 'resultado', v_resultado));

  return v_resultado;
end
$function$;

-- ---- 5. Classificação e cancelamento da versão -----------------------------
create or replace function public.transicionar_orcamento_final(p_versao_id bigint, p_status_destino text, p_motivo text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_atual record;
  v_claims jsonb;
  v_ator text;
  v_ator_id uuid;
  v_demanda_id bigint;
  v_outra text;
  v_plano record;
  v_motivo_plano text;
begin
  perform kontrol_private.exigir_permissao(case when p_status_destino = 'cancelado' then 'orcamentos.cancelar' else 'orcamentos.emitir' end);
  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), nullif(v_claims->>'sub', ''));
  if v_ator is null then
    raise exception 'Ator autenticado obrigatorio.' using errcode = '42501';
  end if;
  if coalesce(v_claims->>'sub', '') ~ '^[0-9a-fA-F-]{36}$' then
    v_ator_id := (v_claims->>'sub')::uuid;
  end if;

  -- ORC2-12: trava a proposta antes da versão (mesma ordem da emissão e do link).
  select demanda_id into v_demanda_id
    from public.orcamento_final_versoes
   where id = p_versao_id;
  if not found then
    raise exception 'Versao final nao encontrada.' using errcode = 'P0002';
  end if;
  perform 1 from public.demandas_propostas where id = v_demanda_id for update;

  select id, demanda_id, status, versao, numero, valido_ate
    into v_atual
    from public.orcamento_final_versoes
   where id = p_versao_id
   for update;
  if not found then
    raise exception 'Versao final nao encontrada.' using errcode = 'P0002';
  end if;

  if v_atual.status = p_status_destino then
    return jsonb_build_object(
      'id', p_versao_id,
      'status_origem', v_atual.status,
      'status_destino', p_status_destino,
      'alterado', false
    );
  end if;

  if not (
    (v_atual.status = 'emitido' and p_status_destino in
      ('enviado', 'alterado_reenviado', 'aprovado', 'recusado', 'rejeitado', 'cancelado', 'vencido'))
    or (v_atual.status in ('enviado', 'alterado_reenviado') and p_status_destino in
      ('alterado_reenviado', 'aprovado', 'recusado', 'rejeitado', 'cancelado', 'vencido'))
    or (v_atual.status in ('recusado', 'rejeitado') and p_status_destino in
      ('alterado_reenviado', 'cancelado'))
    or (v_atual.status = 'aprovado' and p_status_destino in
      ('convertido_projeto', 'cancelado'))
  ) then
    raise exception 'Transicao de versao final nao permitida: % -> %.',
      v_atual.status, p_status_destino using errcode = '22023';
  end if;

  -- Uma versão viva por proposta (decisões do dono, 26/09).
  if p_status_destino = 'aprovado' then
    if v_atual.valido_ate is not null and v_atual.valido_ate < current_date then
      raise exception 'A proposta % venceu em %: não pode ser aprovada. Emita uma nova versão.',
        v_atual.numero, to_char(v_atual.valido_ate, 'DD/MM/YYYY') using errcode = '22023';
    end if;
    select numero into v_outra
      from public.orcamento_final_versoes
     where demanda_id = v_atual.demanda_id and id <> v_atual.id
       and status in ('aprovado', 'convertido_projeto')
     limit 1;
    if v_outra is not null then
      raise exception 'A versão % desta proposta já está aprovada. Cancele-a antes de aprovar outra.', v_outra
        using errcode = '22023';
    end if;
  end if;
  if p_status_destino in ('enviado', 'alterado_reenviado', 'aprovado') then
    select numero into v_outra
      from public.orcamento_final_versoes
     where demanda_id = v_atual.demanda_id and id <> v_atual.id
       and status in ('emitido', 'enviado', 'alterado_reenviado', 'aprovado', 'convertido_projeto')
       and (versao > v_atual.versao or v_atual.status in ('recusado', 'rejeitado'))
     order by versao desc
     limit 1;
    if v_outra is not null then
      raise exception 'A versão % desta proposta está em vigor. Use a versão em vigor.', v_outra
        using errcode = '22023';
    end if;
  end if;

  if p_status_destino = 'cancelado' and v_atual.status = 'aprovado'
     and exists (select 1 from public.planejamento
                  where orcamento_final_versao_id = p_versao_id
                    and status_operacional in ('rascunho', 'reservado'))
     and not kontrol_private.tem_permissao_efetiva('planejamento.editar') then
    raise exception 'Cancelar esta proposta também cancela o planejamento dela. Seu perfil precisa da permissão de editar planejamento.'
      using errcode = '42501';
  end if;

  perform set_config('app.orcamento_final_transicao', 'permitida', true);
  update public.orcamento_final_versoes
     set status = p_status_destino,
         classificado_em = case
           when p_status_destino in ('enviado', 'alterado_reenviado', 'aprovado', 'recusado', 'rejeitado')
             then now()
           else classificado_em
         end,
         classificado_por = case
           when p_status_destino in ('enviado', 'alterado_reenviado', 'aprovado', 'recusado', 'rejeitado')
             then v_ator_id
           else classificado_por
         end,
         classificacao_motivo = case
           when p_status_destino in ('enviado', 'alterado_reenviado', 'aprovado', 'recusado', 'rejeitado')
             then p_motivo
           else classificacao_motivo
         end,
         cancelado_em = case when p_status_destino = 'cancelado' then now() else cancelado_em end,
         cancelado_motivo = case when p_status_destino = 'cancelado' then p_motivo else cancelado_motivo end
   where id = p_versao_id;

  insert into public.eventos_status
    (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values
    ('orcamento_final', p_versao_id, v_atual.status, p_status_destino, v_ator, p_motivo);

  if p_status_destino = 'cancelado' then
    -- Link de versão cancelada deixa de abrir (o aprovado fica como registro).
    update public.orcamento_projeto_links
       set revogado = true
     where orcamento_final_versao_id = p_versao_id
       and not revogado
       and aprovado_em is null;
  end if;

  -- Cancelar proposta aprovada (decisão do dono): plano em rascunho ou
  -- reservado é cancelado com as reservas liberadas; em execução continua e o
  -- coordenador é avisado.
  if p_status_destino = 'cancelado' and v_atual.status = 'aprovado' then
    v_motivo_plano := 'Proposta ' || v_atual.numero || ' cancelada'
      || coalesce(': ' || nullif(btrim(p_motivo), ''), '') || '.';
    for v_plano in
      select id, status_operacional
        from public.planejamento
       where orcamento_final_versao_id = p_versao_id
         and status_operacional in ('rascunho', 'reservado', 'em_execucao')
       order by id
    loop
      if v_plano.status_operacional in ('rascunho', 'reservado') then
        perform public.cancelar_planejamento(v_plano.id, v_motivo_plano);
      else
        begin
          insert into public.notificacoes (
            tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, dedupe_key
          ) values (
            'sistema',
            'Proposta cancelada com o planejamento #' || v_plano.id || ' em execução',
            'A proposta ' || v_atual.numero || ' foi cancelada, mas o planejamento #' || v_plano.id
              || ' já está em execução e continua. Decida se ele deve ser concluído ou cancelado.',
            'planejamento', v_plano.id, 'coordenador',
            'proposta_cancelada_' || p_versao_id || '_plano_' || v_plano.id
          )
          on conflict do nothing;
        exception when others then
          raise warning '0126: aviso do plano em execucao nao registrado: %', sqlerrm;
        end;
      end if;
    end loop;

    if not exists (select 1 from public.orcamento_final_versoes
                    where demanda_id = v_atual.demanda_id
                      and status in ('aprovado', 'convertido_projeto')) then
      update public.demandas_propostas
         set status = 'orcada'
       where id = v_atual.demanda_id and status = 'aprovada';
    end if;
  end if;

  return jsonb_build_object(
    'id', p_versao_id,
    'status_origem', v_atual.status,
    'status_destino', p_status_destino,
    'alterado', true
  );
end
$function$;

-- ---- 6. Link público por versão (ORC-2, ORC2-9, ORC-11, ORC2-4) ------------
alter table public.orcamento_projeto_links
  alter column orcamento_projeto_id drop not null;

comment on column public.orcamento_projeto_links.orcamento_projeto_id is
  'Módulo de projeto da proposta, quando houver. Desde a 0126 o link vale por versão final (orcamento_final_versao_id), também para proposta só de análises.';

create or replace function public.validar_versao_link_orcamento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_status text;
  v_demanda bigint;
begin
  if new.orcamento_final_versao_id is null then
    raise exception 'Novo link publico exige uma versao final.' using errcode = '23502';
  end if;

  select status, demanda_id into v_status, v_demanda
    from public.orcamento_final_versoes
   where id = new.orcamento_final_versao_id;
  if not found then
    raise exception 'Versao final inexistente.' using errcode = '23503';
  end if;

  if new.orcamento_projeto_id is not null and not exists (
    select 1
      from public.orcamento_projetos p
     where p.id = new.orcamento_projeto_id
       and p.demanda_id = v_demanda
  ) then
    raise exception 'Versao final incompativel com o orcamento de projeto.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' and v_status not in ('emitido', 'enviado', 'alterado_reenviado') then
    raise exception 'Só há link de aprovação para proposta emitida ou enviada, ainda não aprovada.' using errcode = '22023';
  end if;

  return new;
end
$function$;

create or replace function public.proteger_aprovacao_link_orcamento()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_autorizado boolean :=
    public.fn_marcador_transacional_autorizado(array[
      'public.aprovar_orcamento_publico(text,text)'::regprocedure
    ])
    and current_setting('app.orcamento_link_aprovacao', true) is not distinct from 'permitida';
begin
  if tg_op = 'INSERT' then
    if (new.aprovado_em is not null or new.aprovado_por is not null) and not v_autorizado then
      raise exception 'A aprovação pelo link só é registrada pelo próprio cliente.' using errcode = '42501';
    end if;
    return new;
  end if;

  if (new.aprovado_em is distinct from old.aprovado_em
      or new.aprovado_por is distinct from old.aprovado_por) and not v_autorizado then
    raise exception 'A aprovação pelo link só é registrada pelo próprio cliente.' using errcode = '42501';
  end if;
  if new.token_hash is distinct from old.token_hash
     or new.orcamento_final_versao_id is distinct from old.orcamento_final_versao_id then
    raise exception 'O link não pode apontar para outra proposta. Crie um novo link.' using errcode = '42501';
  end if;
  if old.revogado and not new.revogado then
    raise exception 'Link revogado não volta a valer. Crie um novo link.' using errcode = '22023';
  end if;
  return new;
end
$function$;

drop trigger if exists kontrol_proteger_aprovacao_link on public.orcamento_projeto_links;
create trigger kontrol_proteger_aprovacao_link
  before insert or update on public.orcamento_projeto_links
  for each row execute function public.proteger_aprovacao_link_orcamento();

create or replace function public.ler_orcamento_publico(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_payload jsonb;
begin
  select jsonb_build_object(
           'snapshot', v.snapshot,
           'orcamento', v.snapshot,
           'versao', jsonb_build_object(
             'id', v.id,
             'numero', v.numero,
             'versao', v.versao,
             'status', v.status,
             'valido_ate', v.valido_ate,
             'total_final', v.total_final
           ),
           'vencida', v.status = 'vencido' or (v.valido_ate is not null and v.valido_ate < current_date),
           'aprovado_em', l.aprovado_em,
           'aprovado_por', l.aprovado_por
         )
    into v_payload
    from public.orcamento_projeto_links l
    join public.orcamento_final_versoes v
      on v.id = l.orcamento_final_versao_id
    left join public.orcamento_projetos p
      on p.id = l.orcamento_projeto_id
     and p.demanda_id = v.demanda_id
   where l.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and not l.revogado
     and (l.expira_em is null or l.expira_em > now())
     and (l.orcamento_projeto_id is null or (p.id is not null and p.status not in ('recusado', 'cancelado')))
     and v.status in ('emitido', 'enviado', 'alterado_reenviado', 'aprovado', 'vencido')
   limit 1;

  return v_payload;
end
$function$;

create or replace function public.aprovar_orcamento_publico(p_token text, p_nome text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_hash text := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  v_demanda_id bigint;
  v_link record;
  v_projeto_status text;
  v_ator text := coalesce(nullif(btrim(p_nome), ''), 'Aprovador externo');
begin
  -- Trava a proposta primeiro (mesma ordem de transicionar_orcamento_final).
  select v.demanda_id into v_demanda_id
    from public.orcamento_projeto_links l
    join public.orcamento_final_versoes v on v.id = l.orcamento_final_versao_id
   where l.token_hash = v_hash;
  if not found then
    return jsonb_build_object('aprovado', false, 'repetido', false, 'motivo', 'indisponivel');
  end if;
  perform 1 from public.demandas_propostas where id = v_demanda_id for update;

  select
    l.id as link_id,
    l.aprovado_em,
    l.aprovado_por,
    l.orcamento_projeto_id as projeto_id,
    v.id as versao_id,
    v.status as versao_status,
    v.numero as versao_numero,
    v.versao,
    v.valido_ate,
    v.demanda_id
  into v_link
  from public.orcamento_projeto_links l
  join public.orcamento_final_versoes v
    on v.id = l.orcamento_final_versao_id
  where l.token_hash = v_hash
    and not l.revogado
    and (l.aprovado_em is not null or l.expira_em is null or l.expira_em > now())
  for update of l, v;

  if not found then
    return jsonb_build_object('aprovado', false, 'repetido', false, 'motivo', 'indisponivel');
  end if;

  if v_link.aprovado_em is not null then
    -- Contrato de compatibilidade: retry aprovado deve "return true" semanticamente,
    -- agora acompanhado de repetido=true no retorno estruturado.
    return jsonb_build_object(
      'aprovado', true,
      'repetido', true,
      'versao_id', v_link.versao_id,
      'numero', v_link.versao_numero
    );
  end if;

  if v_link.projeto_id is not null then
    select status into v_projeto_status
      from public.orcamento_projetos
     where id = v_link.projeto_id and demanda_id = v_link.demanda_id
     for update;
    if not found or v_projeto_status not in ('rascunho', 'enviado') then
      return jsonb_build_object('aprovado', false, 'repetido', false, 'motivo', 'indisponivel');
    end if;
  end if;

  if v_link.versao_status not in ('emitido', 'enviado', 'alterado_reenviado') then
    return jsonb_build_object('aprovado', false, 'repetido', false,
      'motivo', case when v_link.versao_status = 'vencido' then 'vencida' else 'indisponivel' end);
  end if;
  if v_link.valido_ate is not null and v_link.valido_ate < current_date then
    return jsonb_build_object('aprovado', false, 'repetido', false, 'motivo', 'vencida');
  end if;
  if exists (select 1 from public.orcamento_final_versoes
              where demanda_id = v_link.demanda_id and id <> v_link.versao_id
                and status in ('aprovado', 'convertido_projeto')) then
    return jsonb_build_object('aprovado', false, 'repetido', false, 'motivo', 'outra_aprovada');
  end if;
  if exists (select 1 from public.orcamento_final_versoes
              where demanda_id = v_link.demanda_id and versao > v_link.versao
                and status in ('emitido', 'enviado', 'alterado_reenviado')) then
    return jsonb_build_object('aprovado', false, 'repetido', false, 'motivo', 'versao_nova');
  end if;

  perform set_config('app.orcamento_projeto_transicao', 'permitida', true);
  perform set_config('app.orcamento_final_transicao', 'permitida', true);
  perform set_config('app.orcamento_link_aprovacao', 'permitida', true);

  if v_link.projeto_id is not null then
    update public.orcamento_projetos
       set status = 'aprovado'
     where id = v_link.projeto_id;
  end if;

  update public.orcamento_final_versoes
     set status = 'aprovado',
         classificado_em = now(),
         classificacao_motivo = 'Aprovacao por link publico versionado.'
   where id = v_link.versao_id;

  update public.orcamento_projeto_links
     set aprovado_em = now(),
         aprovado_por = v_ator
   where id = v_link.link_id;

  -- Contrato auditavel: o comando "insert into eventos_status" abaixo usa
  -- qualificacao explicita do schema para nao depender do search_path.
  if v_link.projeto_id is not null then
    insert into public.eventos_status
      (entidade, entidade_id, de_status, para_status, usuario, observacao)
    values
      ('orcamento_projeto', v_link.projeto_id, v_projeto_status, 'aprovado', v_ator,
       'Aprovacao publica vinculada a versao final #' || v_link.versao_id || '.');
  end if;
  insert into public.eventos_status
    (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values
    ('orcamento_final', v_link.versao_id, v_link.versao_status, 'aprovado', v_ator,
     'Versao ' || v_link.versao_numero || ' aprovada por link publico versionado.');

  -- Ninguém era avisado da aprovação pelo link (auditoria, §3).
  begin
    insert into public.notificacoes (
      tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, dedupe_key
    ) values (
      'sistema',
      'Cliente aprovou a proposta ' || v_link.versao_numero,
      v_ator || ' aprovou a proposta ' || v_link.versao_numero || ' pelo link.',
      'orcamento_final', v_link.versao_id, 'coordenador', 'aprovacao_link_' || v_link.versao_id
    )
    on conflict do nothing;
  exception when others then
    raise warning '0126: aviso da aprovacao pelo link nao registrado: %', sqlerrm;
  end;

  return jsonb_build_object(
    'aprovado', true,
    'repetido', false,
    'versao_id', v_link.versao_id,
    'numero', v_link.versao_numero
  );
end
$function$;

-- ---- 7. Vencimento diário (ORC-7, ORC2-4) ----------------------------------
create or replace function public.vencer_orcamentos_finais()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_versao record;
  v_total integer := 0;
begin
  perform set_config('app.orcamento_final_transicao', 'permitida', true);
  for v_versao in
    select id, status
      from public.orcamento_final_versoes
     where status in ('emitido', 'enviado', 'alterado_reenviado')
       and valido_ate is not null
       and valido_ate < current_date
     order by id
     for update skip locked
  loop
    update public.orcamento_final_versoes
       set status = 'vencido'
     where id = v_versao.id;
    insert into public.eventos_status
      (entidade, entidade_id, de_status, para_status, usuario, observacao)
    values
      ('orcamento_final', v_versao.id, v_versao.status, 'vencido', 'sistema',
       'Validade expirada (vencimento automático).');
    v_total := v_total + 1;
  end loop;
  return v_total;
end
$function$;

revoke all on function public.vencer_orcamentos_finais() from public, anon;
grant execute on function public.vencer_orcamentos_finais() to authenticated, service_role;

create or replace function public.proteger_orcamento_final_emitido()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  desvinculo_referencial_de_autoria boolean;
begin
  desvinculo_referencial_de_autoria :=
    pg_trigger_depth() > 1
    and old.criado_por is not null
    and new.criado_por is null
    and (to_jsonb(new) - 'criado_por') is not distinct from (to_jsonb(old) - 'criado_por');

  if new.demanda_id is distinct from old.demanda_id
     or new.versao is distinct from old.versao
     or new.numero is distinct from old.numero
     or new.validade_dias is distinct from old.validade_dias
     or new.valido_ate is distinct from old.valido_ate
     or new.total_laboratorio_custo is distinct from old.total_laboratorio_custo
     or new.total_laboratorio_preco is distinct from old.total_laboratorio_preco
     or new.total_projeto_custo is distinct from old.total_projeto_custo
     or new.total_projeto_final is distinct from old.total_projeto_final
     or new.total_final is distinct from old.total_final
     or new.snapshot is distinct from old.snapshot
     or (
       new.criado_por is distinct from old.criado_por
       and not desvinculo_referencial_de_autoria
     )
     or new.criado_em is distinct from old.criado_em then
    raise exception 'Conteudo economico de versao final emitida e imutavel.' using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     and (
       not public.fn_marcador_transacional_autorizado(array[
         'public.aprovar_orcamento_publico(text,text)'::regprocedure,
         'public.transicionar_orcamento_final(bigint,text,text)'::regprocedure,
         'public.duplicar_orcamento_final_transacional(bigint,integer,uuid)'::regprocedure,
         'public.emitir_orcamento_final_transacional(bigint,integer,numeric,numeric,numeric,numeric,numeric,jsonb,jsonb,uuid,text)'::regprocedure,
         'public.emitir_orcamento_final_transacional(bigint,integer,numeric,numeric,numeric,numeric,numeric,jsonb,jsonb,uuid,text,uuid)'::regprocedure,
         'public.vencer_orcamentos_finais()'::regprocedure
       ])
       or current_setting('app.orcamento_final_transicao', true) is distinct from 'permitida'
     ) then
    raise exception 'Status da versao final exige transicao transacional.' using errcode = '42501';
  end if;

  return new;
end
$function$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'kontrol-vencimento-propostas';
    perform cron.schedule(
      'kontrol-vencimento-propostas',
      '10 3 * * *',
      $cron$select public.vencer_orcamentos_finais();$cron$
    );
  else
    raise notice '0126: pg_cron ausente; vencimento diario das propostas nao agendado.';
  end if;
end $$;

-- ---- 8. Proposta aprovada vigente (ORC2-5, ORC2-6, ORC-8, ORC-9) -----------
create or replace view public.v_proposta_aprovada_vigente
with (security_invoker = true) as
select distinct on (v.demanda_id)
  v.demanda_id,
  v.id as versao_id,
  v.numero,
  v.versao,
  v.status,
  v.total_final,
  v.total_laboratorio_custo,
  v.total_laboratorio_preco,
  v.total_projeto_custo,
  v.total_projeto_final,
  v.valido_ate,
  v.classificado_em,
  v.criado_em,
  coalesce(d.projeto_id, nullif(v.snapshot #>> '{demanda,projeto_id}', '')::bigint) as projeto_id,
  d.cliente_id,
  coalesce(d.cliente_nome, v.snapshot #>> '{demanda,cliente_nome}') as cliente_nome,
  d.titulo
from public.orcamento_final_versoes v
join public.demandas_propostas d on d.id = v.demanda_id
where v.status in ('aprovado', 'convertido_projeto')
order by v.demanda_id, v.versao desc;

comment on view public.v_proposta_aprovada_vigente is
  'Uma linha por proposta: a versão aprovada vigente e seus totais congelados na emissão (0126).';

revoke all on public.v_proposta_aprovada_vigente from public, anon;
grant select on public.v_proposta_aprovada_vigente to authenticated, service_role;

-- ---- 9. ORC-10: um módulo ativo por proposta --------------------------------
do $$
declare
  v_lab text;
  v_proj text;
begin
  select string_agg(demanda_id::text, ', ') into v_lab
  from (
    select demanda_id from public.orcamentos
     where demanda_id is not null and status <> 'cancelado' and status_operacional <> 'cancelado'
     group by demanda_id having count(*) > 1
  ) d;
  select string_agg(demanda_id::text, ', ') into v_proj
  from (
    select demanda_id from public.orcamento_projetos
     where demanda_id is not null and status <> 'cancelado'
     group by demanda_id having count(*) > 1
  ) d;

  if v_lab is null then
    create unique index if not exists orcamentos_modulo_ativo_uidx
      on public.orcamentos (demanda_id)
      where demanda_id is not null and status <> 'cancelado' and status_operacional <> 'cancelado';
  else
    raise notice '0126: indice unico de modulo laboratorial NAO criado; propostas com duplicidade a sanear: %', v_lab;
  end if;
  if v_proj is null then
    create unique index if not exists orcamento_projetos_modulo_ativo_uidx
      on public.orcamento_projetos (demanda_id)
      where demanda_id is not null and status <> 'cancelado';
  else
    raise notice '0126: indice unico de modulo de projeto NAO criado; propostas com duplicidade a sanear: %', v_proj;
  end if;
end $$;

commit;
