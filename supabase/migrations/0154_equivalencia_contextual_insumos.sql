-- ORD100. Depende do catálogo de funções da 0151. Não ativa custeio, emissão ou replay.
begin;
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('kontrol_private.papel_catalogado(text)') is null then
    raise exception '0154 exige o catálogo de funções da 0151.';
  end if;
end $$;

create table kontrol_private.equivalencia_insumos_decisoes (
  id bigint generated always as identity primary key,
  codigo_analise text not null,
  necessidade_id bigint not null check (necessidade_id > 0),
  etapa_id bigint check (etapa_id > 0),
  insumo_id bigint not null check (insumo_id > 0),
  equipamento_id bigint check (equipamento_id > 0),
  metodo_revisao_ref text not null check (char_length(btrim(metodo_revisao_ref)) between 1 and 160),
  apresentacao_ref text not null check (char_length(btrim(apresentacao_ref)) between 1 and 160),
  contexto jsonb not null check (jsonb_typeof(contexto) = 'object'),
  unidade_estoque text not null check (btrim(unidade_estoque) <> ''),
  unidade_consumo text not null check (btrim(unidade_consumo) <> ''),
  fator_conversao numeric not null check (fator_conversao > 0 and fator_conversao < 'Infinity'::numeric),
  evidencia_ref text not null check (char_length(btrim(evidencia_ref)) between 1 and 240),
  ator_id uuid not null,
  papel_validador text not null check (papel_validador in ('laboratorio','coordenador','supervisor')),
  vigente_desde timestamptz not null check (isfinite(vigente_desde)),
  vigente_ate timestamptz check (isfinite(vigente_ate) and vigente_ate > vigente_desde),
  revogada_em timestamptz,
  revogada_por uuid,
  motivo_revogacao text,
  check ((revogada_em is null and revogada_por is null and motivo_revogacao is null)
      or (revogada_em is not null and isfinite(revogada_em) and revogada_em >= vigente_desde
          and revogada_por is not null and motivo_revogacao is not null
          and char_length(btrim(motivo_revogacao)) between 1 and 500))
);
comment on table kontrol_private.equivalencia_insumos_decisoes is
  'Revisões técnicas congeladas; somente marca de revogação pode mudar. IDs de catálogo são referências históricas, sem cascata nem bloqueio novo à exclusão de cadastro; o uso exige contexto vivo íntegro.';
create index equivalencia_decisao_contexto_idx on kontrol_private.equivalencia_insumos_decisoes
  (codigo_analise, metodo_revisao_ref, necessidade_id, etapa_id, insumo_id, equipamento_id, id desc);
alter table kontrol_private.equivalencia_insumos_decisoes enable row level security;
revoke all on table kontrol_private.equivalencia_insumos_decisoes from public, anon, authenticated, service_role;
revoke all on sequence kontrol_private.equivalencia_insumos_decisoes_id_seq from public, anon, authenticated, service_role;

-- Método e apresentação são referências de revisão documental explicitamente
-- atestadas, não entidades inferidas de rótulos. Equipamento é ID de catálogo
-- vinculado à análise, não unidade física. NULL é ausência explícita, não coringa.
create function kontrol_private.contexto_equivalencia_v1(
  p_codigo text, p_necessidade bigint, p_etapa bigint, p_insumo bigint, p_equipamento bigint
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'necessidade', pg_catalog.jsonb_build_array(n.insumo_id, n.unidade, n.quantidade_por_amostra, n.modo_cobranca, n.base_calculo),
    'etapa', case when e.id is not null then pg_catalog.jsonb_build_array(e.amostras_por_execucao, e.execucoes_por_dia, e.escopo_operacional) end,
    'equipamento', case when q.id is not null then pg_catalog.jsonb_build_array(q.id, q.nome) end,
    'apresentacao', pg_catalog.jsonb_build_object(
      'especificacao', i.especificacao, 'fabricante', i.fabricante, 'codigo_fabricante', i.codigo_fabricante,
      'codigo_interno', i.codigo_interno, 'quantidade_embalagem', i.quantidade_embalagem,
      'unidade_estoque', i.unidade, 'unidade_consumo', i.unidade_consumo, 'fator_conversao', i.fator_conversao)
  )
  from public.analises a
  join public.insumo_analise n on n.codigo_analise = a.codigo and n.id = p_necessidade
  join public.insumos i on i.id = p_insumo and i.ativo
  left join public.etapas e on e.id = p_etapa and e.codigo_analise = a.codigo
  left join public.equipamento_analise ea on ea.codigo_analise = a.codigo and ea.equipamento_id = p_equipamento
  left join public.equipamentos q on q.id = ea.equipamento_id
  where a.codigo = p_codigo and a.ativo and n.etapa_id is not distinct from p_etapa
    and (p_etapa is null or e.id is not null)
    and (p_equipamento is null or q.id is not null)
    and n.modo_cobranca in ('por_amostra','por_execucao')
    and n.quantidade_por_amostra > 0 and n.quantidade_por_amostra < 'Infinity'::numeric
    and nullif(pg_catalog.btrim(i.unidade), '') is not null
    and nullif(pg_catalog.btrim(i.unidade_consumo), '') is not null
    and n.unidade = i.unidade_consumo
    and i.fator_conversao > 0 and i.fator_conversao < 'Infinity'::numeric;
$$;

-- Executor privado: wrappers são invoker. A autorização abaixo também se aplica
-- a qualquer chamada SQL direta do executor (schema não exposto no Data API).
create function kontrol_private.operar_equivalencia_v1(
  p_acao text, p_codigo text, p_metodo text, p_dados jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_sessao text := auth.jwt() ->> 'session_id';
  v_papel text;
  v_tabela text;
  v_rel regclass;
  v_codigo text := pg_catalog.btrim(p_codigo);
  v_metodo text := pg_catalog.btrim(p_metodo);
  v_agora timestamptz;
  v_contexto jsonb;
  v_decisao kontrol_private.equivalencia_insumos_decisoes%rowtype;
  v_dados record;
  v_itens jsonb;
  v_divergente boolean;
begin
  if p_acao is null or p_acao not in ('ler','registrar','revogar')
     or v_ator is null or auth.jwt() ->> 'role' is distinct from 'authenticated'
     or v_sessao is null or v_sessao !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
    raise exception 'Sessão inválida para equivalência.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.sessions s where s.id = v_sessao::uuid and s.user_id = v_ator
                   and (s.not_after is null or s.not_after > pg_catalog.now())) then
    raise exception 'Sessão inválida para equivalência.' using errcode = '42501';
  end if;
  if not pg_catalog.has_schema_privilege('authenticated', 'public', 'USAGE') then
    raise exception 'Escopo do schema public não autorizado.' using errcode = '42501';
  end if;
  if p_acao = 'ler' then
    select p.papel into v_papel from public.perfis p
    where p.id = v_ator and not p.suspenso and not p.senha_provisoria;
  else
    if pg_catalog.current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
      raise exception 'Equivalência exige leitura atual da revisão.' using errcode = '25000';
    end if;
    perform 1 from auth.sessions s where s.id = v_sessao::uuid and s.user_id = v_ator
      and (s.not_after is null or s.not_after > pg_catalog.now()) for share;
    if not found then raise exception 'Sessão inválida para equivalência.' using errcode = '42501'; end if;
    select p.papel into v_papel from public.perfis p
    where p.id = v_ator and not p.suspenso and not p.senha_provisoria for share;
    perform 1 from public.permissoes_categorias c where c.papel = v_papel for share;
  end if;
  if v_papel is null or not kontrol_private.tem_permissao_efetiva('analises.ver')
     or not kontrol_private.tem_permissao_efetiva('insumos.ver')
     or (p_acao <> 'ler' and v_papel not in ('laboratorio','coordenador','supervisor')) then
    raise exception 'Papel ou escopo de catálogo não autorizado.' using errcode = '42501';
  end if;

  -- A 0014 dá leitura global de catálogo ao autenticado. Se esse escopo mudar,
  -- um definer não deve contornar a nova política. Sem concessões novas.
  foreach v_tabela in array array['analises','insumo_analise','etapas','insumos','equipamento_analise','equipamentos'] loop
    v_rel := pg_catalog.to_regclass('public.' || v_tabela);
    if not coalesce(pg_catalog.has_table_privilege('authenticated', v_rel, 'SELECT'), false)
       or not exists (select 1 from pg_catalog.pg_class c where c.oid = v_rel and c.relrowsecurity)
       or not exists (
         select 1 from pg_catalog.pg_policy p where p.polrelid = v_rel
           and p.polname = 'rls_read_' || v_tabela and p.polpermissive and p.polcmd = 'r'
           and 'authenticated'::regrole::oid = any(p.polroles)
           and pg_catalog.pg_get_expr(p.polqual, p.polrelid) = 'true'
       ) or exists (
         select 1 from pg_catalog.pg_policy p where p.polrelid = v_rel
           and not p.polpermissive and p.polcmd in ('r','*')
       ) then
      raise exception 'Escopo do catálogo precisa ser reconciliado.' using errcode = '42501';
    end if;
  end loop;

  if p_acao <> 'revogar' and (
    v_codigo is null or pg_catalog.char_length(v_codigo) not between 1 and 100
    or v_metodo is null or pg_catalog.char_length(v_metodo) not between 1 and 160
  ) then
    raise exception 'Identifique a análise e a revisão do método.' using errcode = '22023';
  end if;

  if p_acao = 'ler' then
    if not exists (select 1 from public.analises a where a.codigo = v_codigo and a.ativo) then
      raise exception 'Análise indisponível para equivalência.' using errcode = '42501';
    end if;
    v_agora := pg_catalog.statement_timestamp();
    with ultimas as (
      select distinct on (d.necessidade_id, d.etapa_id, d.insumo_id, d.equipamento_id) d.*
      from kontrol_private.equivalencia_insumos_decisoes d
      where d.codigo_analise = v_codigo and d.metodo_revisao_ref = v_metodo
      order by d.necessidade_id, d.etapa_id, d.insumo_id, d.equipamento_id, d.id desc
    )
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'codigo_analise', d.codigo_analise, 'necessidade_id', d.necessidade_id, 'etapa_id', d.etapa_id,
      'metodo_revisao_ref', d.metodo_revisao_ref, 'equipamento_ref', 'equipamento:' || d.equipamento_id,
      'insumo_id', d.insumo_id, 'apresentacao_ref', d.apresentacao_ref, 'decisao_ref', 'equivalencia:' || d.id,
      'evidencia_ref', d.evidencia_ref,
      'validador_id', 'ator-decisao:' || pg_catalog.md5(d.id::text || ':' || d.ator_id::text),
      'papel_validador', d.papel_validador, 'estado', case when d.revogada_em is null then 'validada' else 'revogada' end,
      'unidade_estoque', d.unidade_estoque, 'unidade_consumo', d.unidade_consumo, 'fator_conversao', d.fator_conversao,
      'vigente_desde', extract(epoch from d.vigente_desde) * 1000,
      'vigente_ate', extract(epoch from d.vigente_ate) * 1000
    ) order by d.id), '[]'::jsonb), coalesce(pg_catalog.bool_or(
      d.revogada_em is null and (d.vigente_ate is null or d.vigente_ate > v_agora)
      and d.contexto is distinct from kontrol_private.contexto_equivalencia_v1(
        d.codigo_analise, d.necessidade_id, d.etapa_id, d.insumo_id, d.equipamento_id)
    ), false)
    into v_itens, v_divergente from ultimas d;
    return pg_catalog.jsonb_build_object(
      'versao', 'equivalencia-contextual-v1', 'instante', extract(epoch from v_agora) * 1000,
      'estado', case when v_divergente then 'contexto_divergente' else 'disponivel' end,
      'decisoes', case when v_divergente then '[]'::jsonb else v_itens end);
  end if;

  if p_acao = 'revogar' then
    select * into v_dados from pg_catalog.jsonb_to_record(p_dados) as x(id bigint, motivo text);
    if v_dados.id is null or v_dados.id <= 0 or v_dados.motivo is null
       or pg_catalog.char_length(pg_catalog.btrim(v_dados.motivo)) not between 1 and 500 then
      raise exception 'Identifique a decisão e justifique a revogação.' using errcode = '22023';
    end if;
    select * into v_decisao from kontrol_private.equivalencia_insumos_decisoes d where d.id = v_dados.id;
    if not found then raise exception 'Decisão indisponível.' using errcode = 'P0002'; end if;
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('equivalencia-v1:' || v_decisao.necessidade_id, 0)) then
      raise exception 'Validação concorrente da necessidade.' using errcode = '55P03';
    end if;
    update kontrol_private.equivalencia_insumos_decisoes d
    set revogada_em = pg_catalog.clock_timestamp(), revogada_por = v_ator, motivo_revogacao = pg_catalog.btrim(v_dados.motivo)
    where d.id = v_decisao.id and d.revogada_em is null;
    if not found then raise exception 'Decisão já revogada.' using errcode = '55000'; end if;
    return pg_catalog.jsonb_build_object('decisao_ref', 'equivalencia:' || v_decisao.id, 'estado', 'revogada');
  end if;

  if pg_catalog.jsonb_typeof(p_dados) is distinct from 'object'
     or not (p_dados ?& array['necessidade_id','etapa_id','insumo_id','equipamento_id','apresentacao_ref',
       'unidade_estoque','unidade_consumo','fator_conversao','evidencia_ref','vigente_ate','confirmada'])
     or p_dados - array['necessidade_id','etapa_id','insumo_id','equipamento_id','apresentacao_ref',
       'unidade_estoque','unidade_consumo','fator_conversao','evidencia_ref','vigente_ate','confirmada'] <> '{}'::jsonb then
    raise exception 'Contexto explícito incompleto ou campo não autorizado.' using errcode = '22023';
  end if;
  select * into v_dados from pg_catalog.jsonb_to_record(p_dados) as x(
    necessidade_id bigint, etapa_id bigint, insumo_id bigint, equipamento_id bigint, apresentacao_ref text,
    unidade_estoque text, unidade_consumo text, fator_conversao numeric, evidencia_ref text,
    vigente_ate timestamptz, confirmada boolean
  );
  if v_dados.confirmada is distinct from true or v_dados.necessidade_id is null or v_dados.necessidade_id <= 0
     or v_dados.insumo_id is null or v_dados.insumo_id <= 0
     or v_dados.etapa_id <= 0 or v_dados.equipamento_id <= 0
     or v_dados.apresentacao_ref is null or pg_catalog.char_length(pg_catalog.btrim(v_dados.apresentacao_ref)) not between 1 and 160
     or v_dados.evidencia_ref is null or pg_catalog.char_length(pg_catalog.btrim(v_dados.evidencia_ref)) not between 1 and 240
     or v_dados.fator_conversao is null or v_dados.fator_conversao <= 0 or v_dados.fator_conversao >= 'Infinity'::numeric then
    raise exception 'Confirme a revisão, apresentação e conversão com evidência.' using errcode = '22023';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('equivalencia-v1:' || v_dados.necessidade_id, 0)) then
    raise exception 'Validação concorrente da necessidade.' using errcode = '55P03';
  end if;

  -- Travar fontes enquanto a revisão é congelada; não travar o catálogo inteiro.
  perform 1 from public.analises a where a.codigo = v_codigo for share;
  perform 1 from public.insumo_analise n where n.id = v_dados.necessidade_id and n.codigo_analise = v_codigo for share;
  perform 1 from public.etapas e where e.id = v_dados.etapa_id and e.codigo_analise = v_codigo for share;
  perform 1 from public.equipamento_analise e where e.equipamento_id = v_dados.equipamento_id and e.codigo_analise = v_codigo for share;
  perform 1 from public.equipamentos q where q.id = v_dados.equipamento_id for share;
  perform 1 from public.insumos i where i.id = v_dados.insumo_id for share;
  v_contexto := kontrol_private.contexto_equivalencia_v1(
    v_codigo, v_dados.necessidade_id, v_dados.etapa_id, v_dados.insumo_id, v_dados.equipamento_id);
  if v_contexto is null
     or (v_contexto #>> '{apresentacao,unidade_estoque}') is distinct from v_dados.unidade_estoque
     or (v_contexto #>> '{apresentacao,unidade_consumo}') is distinct from v_dados.unidade_consumo
     or (v_contexto #>> '{apresentacao,fator_conversao}')::numeric is distinct from v_dados.fator_conversao then
    raise exception 'Necessidade, etapa, equipamento, apresentação ou fator divergem do catálogo.' using errcode = '22023';
  end if;
  v_agora := pg_catalog.clock_timestamp();
  if v_dados.vigente_ate is not null and (not pg_catalog.isfinite(v_dados.vigente_ate) or v_dados.vigente_ate <= v_agora) then
    raise exception 'Fim de vigência deve ser futuro e finito.' using errcode = '22023';
  end if;
  if exists (
    select 1 from kontrol_private.equivalencia_insumos_decisoes d
    where d.codigo_analise = v_codigo and d.metodo_revisao_ref = v_metodo
      and d.necessidade_id = v_dados.necessidade_id and d.etapa_id is not distinct from v_dados.etapa_id
      and d.insumo_id = v_dados.insumo_id and d.equipamento_id is not distinct from v_dados.equipamento_id
      and d.revogada_em is null and (d.vigente_ate is null or d.vigente_ate > v_agora)
  ) then
    raise exception 'Já existe uma decisão efetiva para este contexto e SKU.' using errcode = '23505';
  end if;
  insert into kontrol_private.equivalencia_insumos_decisoes (
    codigo_analise, necessidade_id, etapa_id, insumo_id, equipamento_id, metodo_revisao_ref,
    apresentacao_ref, contexto, unidade_estoque, unidade_consumo, fator_conversao, evidencia_ref,
    ator_id, papel_validador, vigente_desde, vigente_ate
  ) values (
    v_codigo, v_dados.necessidade_id, v_dados.etapa_id, v_dados.insumo_id, v_dados.equipamento_id, v_metodo,
    pg_catalog.btrim(v_dados.apresentacao_ref), v_contexto, v_dados.unidade_estoque, v_dados.unidade_consumo,
    v_dados.fator_conversao, pg_catalog.btrim(v_dados.evidencia_ref),
    v_ator, v_papel, v_agora, v_dados.vigente_ate
  ) returning * into v_decisao;
  return pg_catalog.jsonb_build_object('decisao_ref', 'equivalencia:' || v_decisao.id, 'estado', 'validada');
end $$;

create function public.ler_equivalencia_contextual_v1(p_codigo text, p_metodo_revisao_ref text)
returns jsonb language sql security invoker set search_path = '' as $$
  select kontrol_private.operar_equivalencia_v1('ler', p_codigo, p_metodo_revisao_ref, '{}'::jsonb);
$$;
create function public.registrar_equivalencia_contextual_v1(p_codigo text, p_metodo_revisao_ref text, p_contexto jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select kontrol_private.operar_equivalencia_v1('registrar', p_codigo, p_metodo_revisao_ref, p_contexto);
$$;
create function public.revogar_equivalencia_contextual_v1(p_decisao_id bigint, p_motivo text)
returns jsonb language sql security invoker set search_path = '' as $$
  select kontrol_private.operar_equivalencia_v1('revogar', null, null,
    pg_catalog.jsonb_build_object('id', p_decisao_id, 'motivo', p_motivo));
$$;

revoke all on function kontrol_private.contexto_equivalencia_v1(text,bigint,bigint,bigint,bigint),
  kontrol_private.operar_equivalencia_v1(text,text,text,jsonb),
  public.ler_equivalencia_contextual_v1(text,text),
  public.registrar_equivalencia_contextual_v1(text,text,jsonb),
  public.revogar_equivalencia_contextual_v1(bigint,text)
  from public, anon, authenticated, service_role;
grant execute on function kontrol_private.operar_equivalencia_v1(text,text,text,jsonb),
  public.ler_equivalencia_contextual_v1(text,text),
  public.registrar_equivalencia_contextual_v1(text,text,jsonb),
  public.revogar_equivalencia_contextual_v1(bigint,text) to authenticated;
commit;
