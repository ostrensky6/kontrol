-- ORD141. Aditiva: 0154/0160, decisões históricas e contratos legados preservados.
begin;
set local lock_timeout = '5s';
do $$
begin
  if pg_catalog.to_regprocedure('public.ler_equivalencia_contexto_autorizado_v1(text,text)') is null then
    raise exception '0161 exige 0154 e 0160.';
  end if;
end $$;

-- Recibos privados, não segunda tabela de decisões. Nenhuma permissão de DML
-- ao cliente. A operação e o efeito 0154 são confirmados na mesma transação.
create table kontrol_private.equivalencia_escrita_operacoes (
  operacao_id uuid primary key,
  ator_id uuid not null,
  entrada jsonb not null,
  recibo jsonb not null,
  criado_em timestamptz not null default clock_timestamp()
);
alter table kontrol_private.equivalencia_escrita_operacoes enable row level security;
revoke all on table kontrol_private.equivalencia_escrita_operacoes from public,anon,authenticated,service_role;

create function kontrol_private.operar_equivalencia_revisionada_v1(
  p_acao text, p_codigo text, p_metodo text, p_dados jsonb,
  p_revisao_esperada text, p_operacao_id uuid, p_confirmar boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_sessao text := auth.jwt()->>'session_id';
  v_papel text;
  v_tabela text;
  v_rel regclass;
  v_codigo text := pg_catalog.btrim(p_codigo);
  v_metodo text := pg_catalog.btrim(p_metodo);
  v_identidade record;
  v_decisao kontrol_private.equivalencia_insumos_decisoes%rowtype;
  v_operacao kontrol_private.equivalencia_escrita_operacoes%rowtype;
  v_entrada jsonb;
  v_contexto jsonb;
  v_estados jsonb;
  v_revisao text;
  v_resultado jsonb;
  v_recibo jsonb;
begin
  if p_confirmar is null or p_acao is null or p_acao not in ('registrar','revogar')
     or v_ator is null or auth.jwt()->>'role' is distinct from 'authenticated'
     or v_sessao is null or v_sessao !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
    raise exception 'Sessão inválida para equivalência.' using errcode='42501';
  end if;
  if pg_catalog.current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'Equivalência exige leitura atual da revisão.' using errcode='25000';
  end if;
  -- Guarda estreita para a via de replay: o executor 0154 não oferece uma
  -- autorização sem efeito. Mesmas regras, fontes e ordem; nunca JWT editável.
  perform 1 from auth.sessions s where s.id=v_sessao::uuid and s.user_id=v_ator
    and (s.not_after is null or s.not_after>pg_catalog.now()) for share nowait;
  if not found then raise exception 'Sessão inválida para equivalência.' using errcode='42501'; end if;
  select p.papel into v_papel from public.perfis p
    where p.id=v_ator and not p.suspenso and not p.senha_provisoria for share nowait;
  perform 1 from public.permissoes_categorias c where c.papel=v_papel for share nowait;
  if v_papel is null or v_papel not in ('laboratorio','coordenador','supervisor')
     or not kontrol_private.tem_permissao_efetiva('analises.ver')
     or not kontrol_private.tem_permissao_efetiva('insumos.ver')
     or not pg_catalog.has_schema_privilege('authenticated','public','USAGE')
     or not pg_catalog.has_function_privilege('authenticated',
       'kontrol_private.operar_equivalencia_v1(text,text,text,jsonb)','EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',case p_acao
       when 'registrar' then 'public.registrar_equivalencia_contextual_v1(text,text,jsonb)'
       else 'public.revogar_equivalencia_contextual_v1(bigint,text)' end,'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',case
       when not p_confirmar then 'public.preparar_equivalencia_revisionada_v1(text,text,text,jsonb)'
       when p_acao='registrar' then 'public.registrar_equivalencia_revisionada_v1(text,text,jsonb,text,uuid)'
       else 'public.revogar_equivalencia_revisionada_v1(text,text,bigint,text,text,uuid)' end,'EXECUTE') then
    raise exception 'Papel ou escopo de catálogo não autorizado.' using errcode='42501';
  end if;
  foreach v_tabela in array array['analises','insumo_analise','etapas','insumos','equipamento_analise','equipamentos'] loop
    v_rel := pg_catalog.to_regclass('public.'||v_tabela);
    if not coalesce(pg_catalog.has_table_privilege('authenticated',v_rel,'SELECT'),false)
       or not exists (select 1 from pg_catalog.pg_class c where c.oid=v_rel and c.relrowsecurity)
       or not exists (select 1 from pg_catalog.pg_policy p where p.polrelid=v_rel
          and p.polname='rls_read_'||v_tabela and p.polpermissive and p.polcmd='r'
          and 'authenticated'::regrole::oid=any(p.polroles)
          and pg_catalog.pg_get_expr(p.polqual,p.polrelid)='true')
       or exists (select 1 from pg_catalog.pg_policy p where p.polrelid=v_rel
          and not p.polpermissive and p.polcmd in ('r','*')) then
      raise exception 'Escopo do catálogo precisa ser reconciliado.' using errcode='42501';
    end if;
  end loop;
  if v_codigo is null or pg_catalog.char_length(v_codigo) not between 1 and 100
     or v_metodo is null or pg_catalog.char_length(v_metodo) not between 1 and 160
     or pg_catalog.jsonb_typeof(p_dados) is distinct from 'object' then
    raise exception 'Identifique análise, revisão e intenção.' using errcode='22023';
  end if;
  v_entrada := pg_catalog.jsonb_build_object('acao',p_acao,'codigo',v_codigo,'metodo',v_metodo,
    'dados',p_dados,'revisao_esperada',p_revisao_esperada);
  if p_confirmar then
    if p_operacao_id is null or p_revisao_esperada is null
       or p_revisao_esperada !~ '^equivalencia-cas-v1:[a-f0-9]{32}$' then
      raise exception 'Operação e revisão esperada obrigatórias.' using errcode='22023';
    end if;
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('equivalencia-op:'||p_operacao_id,0)) then
      raise exception 'Operação concorrente.' using errcode='55P03';
    end if;
    -- Reautorização acima SEMPRE precede leitura do recibo, inclusive no replay.
    select * into v_operacao from kontrol_private.equivalencia_escrita_operacoes o where o.operacao_id=p_operacao_id;
    if found then
      if v_operacao.ator_id<>v_ator or v_operacao.entrada is distinct from v_entrada then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode='22023';
      end if;
      return v_operacao.recibo || '{"replay":true}'::jsonb;
    end if;
  end if;

  if p_acao='registrar' then
    if not (p_dados ?& array['necessidade_id','etapa_id','insumo_id','equipamento_id','apresentacao_ref',
       'unidade_estoque','unidade_consumo','fator_conversao','evidencia_ref','vigente_ate','confirmada'])
       or p_dados-array['necessidade_id','etapa_id','insumo_id','equipamento_id','apresentacao_ref',
       'unidade_estoque','unidade_consumo','fator_conversao','evidencia_ref','vigente_ate','confirmada']<>'{}'::jsonb then
      raise exception 'Contexto explícito incompleto.' using errcode='22023';
    end if;
    select * into v_identidade from pg_catalog.jsonb_to_record(p_dados) as x(
      necessidade_id bigint,etapa_id bigint,insumo_id bigint,equipamento_id bigint);
  else
    if not (p_dados ?& array['id','motivo']) or p_dados-array['id','motivo']<>'{}'::jsonb then
      raise exception 'Identifique decisão e motivo.' using errcode='22023';
    end if;
    select * into v_decisao from kontrol_private.equivalencia_insumos_decisoes d
      where d.id=(p_dados->>'id')::bigint and d.codigo_analise=v_codigo and d.metodo_revisao_ref=v_metodo;
    if not found then raise exception 'Decisão indisponível no escopo.' using errcode='P0002'; end if;
    select v_decisao.necessidade_id as necessidade_id,v_decisao.etapa_id as etapa_id,
      v_decisao.insumo_id as insumo_id,v_decisao.equipamento_id as equipamento_id into v_identidade;
  end if;
  if v_identidade.necessidade_id is null or v_identidade.necessidade_id<=0
     or v_identidade.insumo_id is null or v_identidade.insumo_id<=0
     or v_identidade.etapa_id<=0 or v_identidade.equipamento_id<=0 then
    raise exception 'Identidades inválidas.' using errcode='22023';
  end if;
  -- EXATAMENTE a chave 0154: chamadas legadas não atravessam comparação/efeito.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('equivalencia-v1:'||v_identidade.necessidade_id,0)) then
    raise exception 'Necessidade concorrente.' using errcode='55P03';
  end if;
  -- Mesma ordem do registro0154. NOWAIT evita espera inversa com manutenção de
  -- catálogo. Row locks também impedem mudança do fator/lote entre CAS e efeito.
  perform 1 from public.analises a where a.codigo=v_codigo for share nowait;
  perform 1 from public.insumo_analise n where n.id=v_identidade.necessidade_id and n.codigo_analise=v_codigo for share nowait;
  perform 1 from public.etapas e where e.id=v_identidade.etapa_id and e.codigo_analise=v_codigo for share nowait;
  perform 1 from public.equipamento_analise e where e.equipamento_id=v_identidade.equipamento_id and e.codigo_analise=v_codigo for share nowait;
  perform 1 from public.equipamentos e where e.id=v_identidade.equipamento_id for share nowait;
  perform 1 from public.insumos i where i.id=v_identidade.insumo_id for share nowait;
  v_contexto := kontrol_private.contexto_equivalencia_v1(v_codigo,v_identidade.necessidade_id,
    v_identidade.etapa_id,v_identidade.insumo_id,v_identidade.equipamento_id);
  if p_acao='registrar' and v_contexto is null then
    raise exception 'Contexto indisponível.' using errcode='22023';
  end if;
  -- Revogar permanece possível após drift/exclusão de cadastro (sem inferir
  -- contexto vivo): o alvo histórico e todo seu conjunto de revisões entram no CAS.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(d)||pg_catalog.jsonb_build_object(
    'vigente_agora', d.revogada_em is null and d.vigente_desde<=pg_catalog.clock_timestamp()
      and (d.vigente_ate is null or d.vigente_ate>pg_catalog.clock_timestamp())) order by d.id),'[]'::jsonb)
    into v_estados from kontrol_private.equivalencia_insumos_decisoes d
    where d.necessidade_id=v_identidade.necessidade_id;
  v_revisao := 'equivalencia-cas-v1:'||pg_catalog.md5(pg_catalog.jsonb_build_object(
    'ator',v_ator,'acao',p_acao,'codigo',v_codigo,'metodo',v_metodo,'intencao',p_dados,
    'contexto',v_contexto,'decisoes',v_estados)::text);
  if not p_confirmar then
    return pg_catalog.jsonb_build_object('versao','equivalencia-escrita-v1','acao',p_acao,
      'codigo_analise',v_codigo,'metodo_revisao_ref',v_metodo,'necessidade_id',v_identidade.necessidade_id,
      'decisao_ref',case when p_acao='revogar' then 'equivalencia:'||v_decisao.id end,
      'revisao_esperada',v_revisao,'cas_escrita',true);
  end if;
  if v_revisao is distinct from p_revisao_esperada then
    raise exception 'EQUIVALENCIA_CONTEXT_STALE' using errcode='40001';
  end if;
  -- Autoridade e regras finais continuam no executor original; nenhum DML
  -- direto na tabela histórica. Falha posterior também desfaz efeito e recibo.
  v_resultado := kontrol_private.operar_equivalencia_v1(p_acao,v_codigo,v_metodo,p_dados);
  v_recibo := pg_catalog.jsonb_build_object('versao','equivalencia-escrita-v1',
    'operacao_id',p_operacao_id,'ator_ref','ator-operacao:'||pg_catalog.md5(p_operacao_id::text||':'||v_ator::text),
    'acao',p_acao,'codigo_analise',v_codigo,'metodo_revisao_ref',v_metodo,
    'necessidade_id',v_identidade.necessidade_id,'decisao_ref',v_resultado->>'decisao_ref',
    'estado',v_resultado->>'estado','revisao_aplicada',v_revisao,'replay',false);
  insert into kontrol_private.equivalencia_escrita_operacoes(operacao_id,ator_id,entrada,recibo)
    values(p_operacao_id,v_ator,v_entrada,v_recibo);
  return v_recibo;
end $$;

create function public.preparar_equivalencia_revisionada_v1(p_acao text,p_codigo text,p_metodo_revisao_ref text,p_dados jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select kontrol_private.operar_equivalencia_revisionada_v1(p_acao,p_codigo,p_metodo_revisao_ref,p_dados,null,null,false);
$$;
create function public.registrar_equivalencia_revisionada_v1(
  p_codigo text,p_metodo_revisao_ref text,p_contexto jsonb,p_revisao_esperada text,p_operacao_id uuid
) returns jsonb language sql security invoker set search_path='' as $$
  select kontrol_private.operar_equivalencia_revisionada_v1('registrar',p_codigo,p_metodo_revisao_ref,p_contexto,p_revisao_esperada,p_operacao_id,true);
$$;
create function public.revogar_equivalencia_revisionada_v1(
  p_codigo text,p_metodo_revisao_ref text,p_decisao_id bigint,p_motivo text,p_revisao_esperada text,p_operacao_id uuid
) returns jsonb language sql security invoker set search_path='' as $$
  select kontrol_private.operar_equivalencia_revisionada_v1('revogar',p_codigo,p_metodo_revisao_ref,
    pg_catalog.jsonb_build_object('id',p_decisao_id,'motivo',p_motivo),p_revisao_esperada,p_operacao_id,true);
$$;
revoke all on function kontrol_private.operar_equivalencia_revisionada_v1(text,text,text,jsonb,text,uuid,boolean),
  public.preparar_equivalencia_revisionada_v1(text,text,text,jsonb),
  public.registrar_equivalencia_revisionada_v1(text,text,jsonb,text,uuid),
  public.revogar_equivalencia_revisionada_v1(text,text,bigint,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function kontrol_private.operar_equivalencia_revisionada_v1(text,text,text,jsonb,text,uuid,boolean),
  public.preparar_equivalencia_revisionada_v1(text,text,text,jsonb),
  public.registrar_equivalencia_revisionada_v1(text,text,jsonb,text,uuid),
  public.revogar_equivalencia_revisionada_v1(text,text,bigint,text,text,uuid) to authenticated;
commit;
