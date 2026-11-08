-- ORD131: contexto de leitura para a UI. Não altera 0154, não ativa escrita.
begin;
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.ler_equivalencia_contextual_v1(text,text)') is null then
    raise exception '0160 exige a fonte de autorização 0154.';
  end if;
end $$;

create function kontrol_private.ler_equivalencia_contexto_autorizado_v1(p_codigo text, p_metodo_revisao_ref text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_codigo text := pg_catalog.btrim(p_codigo);
  v_metodo text := pg_catalog.btrim(p_metodo_revisao_ref);
  v_fonte jsonb;
  v_papel text;
  v_registrar boolean;
  v_revogar boolean;
  v_necessidades jsonb;
  v_equipamentos jsonb;
  v_decisoes jsonb;
  v_contexto jsonb;
begin
  -- Não contornar revogação de EXECUTE pela chamada definer -> wrapper antigo.
  if not pg_catalog.has_function_privilege('authenticated',
       'public.ler_equivalencia_contextual_v1(text,text)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',
       'kontrol_private.operar_equivalencia_v1(text,text,text,jsonb)', 'EXECUTE') then
    raise exception 'Consulta de equivalência não autorizada.' using errcode = '42501';
  end if;
  -- Reutiliza sessão real, perfil não suspenso/provisório, categoria efetiva,
  -- USAGE/SELECT/RLS e análise ativa da 0154, inclusive chamada privada direta.
  v_fonte := public.ler_equivalencia_contextual_v1(v_codigo, v_metodo);
  select p.papel into v_papel from public.perfis p where p.id = auth.uid();
  v_registrar := v_papel in ('laboratorio','coordenador','supervisor')
    and pg_catalog.has_function_privilege('authenticated',
      'public.registrar_equivalencia_contextual_v1(text,text,jsonb)', 'EXECUTE');
  v_revogar := v_papel in ('laboratorio','coordenador','supervisor')
    and pg_catalog.has_function_privilege('authenticated',
      'public.revogar_equivalencia_contextual_v1(bigint,text)', 'EXECUTE');

  -- Recorte por análise e unidade explícita; não há lista de atores, custos,
  -- catálogo privado global ou inferência de equivalência por nome/grupo.
  -- Limite falha fechado: nunca apresenta lista truncada como lista completa.
  if (select count(*) from public.insumo_analise n where n.codigo_analise = v_codigo) > 100
     or (select count(*) from public.equipamento_analise e where e.codigo_analise = v_codigo) > 100
     or (select count(*) from kontrol_private.equivalencia_insumos_decisoes d
         where d.codigo_analise = v_codigo and d.metodo_revisao_ref = v_metodo) > 200
     or exists (select 1 from public.insumo_analise n where n.codigo_analise = v_codigo
       and (select count(*) from public.insumos i
            where i.ativo and i.unidade_consumo = n.unidade) > 200) then
    return pg_catalog.jsonb_build_object('versao','equivalencia-contexto-autorizado-v1',
      'estado','indisponivel','motivo','limite_contexto');
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'necessidade_id', n.id, 'etapa_id', n.etapa_id,
    'nome_etapa', n.nome_etapa, 'nome_atividade', n.nome_atividade,
    'unidade_consumo', n.unidade, 'quantidade_por_base', n.quantidade_por_amostra,
    'modo_cobranca', n.modo_cobranca, 'base_calculo', n.base_calculo,
    'insumo_receita_id', n.insumo_id,
    'etapa_contexto', (select pg_catalog.jsonb_build_object(
      'amostras_por_execucao', e.amostras_por_execucao, 'execucoes_por_dia', e.execucoes_por_dia,
      'escopo_operacional', e.escopo_operacional)
      from public.etapas e where e.id = n.etapa_id and e.codigo_analise = v_codigo),
    'candidatos', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'insumo_id', i.id, 'especificacao', i.especificacao, 'fabricante', i.fabricante,
      'codigo_fabricante', i.codigo_fabricante, 'codigo_interno', i.codigo_interno,
      'quantidade_embalagem', i.quantidade_embalagem, 'unidade_estoque', i.unidade,
      'unidade_consumo', i.unidade_consumo, 'fator_conversao', i.fator_conversao
    ) order by i.id), '[]'::jsonb) from public.insumos i
      where i.ativo and i.unidade_consumo = n.unidade
        and kontrol_private.contexto_equivalencia_v1(v_codigo,n.id,n.etapa_id,i.id,null) is not null)
  ) order by n.id), '[]'::jsonb) into v_necessidades
  from public.insumo_analise n where n.codigo_analise = v_codigo;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'equipamento_id', e.id, 'nome', e.nome
  ) order by e.id), '[]'::jsonb) into v_equipamentos
  from public.equipamentos e where exists (
    select 1 from public.equipamento_analise a where a.codigo_analise = v_codigo and a.equipamento_id = e.id);

  -- IDs históricos servem à revogação mesmo após drift do catálogo. Não expor
  -- ator_id/revogada_por/contexto privado; validade vencida ainda pode revogar.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'decisao_ref', 'equivalencia:' || d.id, 'necessidade_id', d.necessidade_id,
    'etapa_id', d.etapa_id, 'insumo_id', d.insumo_id, 'equipamento_id', d.equipamento_id,
    'apresentacao_ref', d.apresentacao_ref, 'evidencia_ref', d.evidencia_ref,
    'unidade_estoque', d.unidade_estoque, 'unidade_consumo', d.unidade_consumo,
    'fator_conversao', d.fator_conversao,
    'vigente_desde', extract(epoch from d.vigente_desde) * 1000,
    'vigente_ate', extract(epoch from d.vigente_ate) * 1000,
    'estado', case when d.revogada_em is null then 'validada' else 'revogada' end,
    'pode_revogar', v_revogar and d.revogada_em is null
  ) order by d.id), '[]'::jsonb) into v_decisoes
  from kontrol_private.equivalencia_insumos_decisoes d
  where d.codigo_analise = v_codigo and d.metodo_revisao_ref = v_metodo;

  v_contexto := pg_catalog.jsonb_build_object(
    'versao','equivalencia-contexto-autorizado-v1', 'estado','disponivel',
    'codigo_analise',v_codigo, 'metodo_revisao_ref',v_metodo,
    'estado_validacoes',v_fonte->>'estado',
    'capacidades',pg_catalog.jsonb_build_object('consultar',true,
      'registrar',coalesce(v_registrar,false),'revogar',coalesce(v_revogar,false)),
    'necessidades',v_necessidades, 'equipamentos',v_equipamentos, 'decisoes',v_decisoes,
    'referencias_documentais','atestacao_explicita_sem_catalogo_de_revisoes',
    'candidatos_sao_equivalencias',false,
    'cas_escrita',false
  );
  -- Hash factual de conteúdo, NÃO CAS: as escritas 0154 não recebem versão
  -- esperada. Elas reautorizam e validam o contexto no momento da operação.
  return v_contexto || pg_catalog.jsonb_build_object(
    'revisao_contexto','contexto:' || pg_catalog.md5(v_contexto::text),
    'instante',v_fonte->'instante');
end $$;

create function public.ler_equivalencia_contexto_autorizado_v1(p_codigo text, p_metodo_revisao_ref text)
returns jsonb language sql security invoker set search_path = '' as $$
  select kontrol_private.ler_equivalencia_contexto_autorizado_v1(p_codigo,p_metodo_revisao_ref);
$$;
revoke all on function kontrol_private.ler_equivalencia_contexto_autorizado_v1(text,text),
  public.ler_equivalencia_contexto_autorizado_v1(text,text) from public, anon, authenticated, service_role;
grant execute on function kontrol_private.ler_equivalencia_contexto_autorizado_v1(text,text),
  public.ler_equivalencia_contexto_autorizado_v1(text,text) to authenticated;
commit;
