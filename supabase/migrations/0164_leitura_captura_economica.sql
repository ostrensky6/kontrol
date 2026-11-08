-- ORD162: leitura somente. Não modifica 0163, não calcula e não ativa captura.
begin;
set local lock_timeout = '5s';

create function public.ler_captura_orcamento_equivalencia_v1(
  p_orcamento_id bigint, p_operacao_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  ator uuid := auth.uid(); sessao text := auth.jwt()->>'session_id';
  tabela text; rel regclass; b public.orcamentos%rowtype; demanda public.demandas_propostas%rowtype;
  captura kontrol_private.orcamento_capturas_equivalencia%rowtype;
  item record; metodo record; fonte jsonb; referencias jsonb; metodos jsonb; itens jsonb := '[]';
  historico jsonb; contexto jsonb; q integer; qtd_historico bigint; modo text;
  preparar boolean; referencias_ok boolean := true; marcados boolean;
begin
  if ator is null or auth.jwt()->>'role' is distinct from 'authenticated'
     or sessao is null or sessao !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
    raise exception 'Leitura não autorizada.' using errcode='42501';
  end if;
  if not exists(select 1 from auth.sessions where id=sessao::uuid and user_id=ator
       and (not_after is null or not_after>statement_timestamp()))
     or not exists(select 1 from public.perfis where id=ator and not suspenso and not senha_provisoria) then
    raise exception 'Leitura não autorizada.' using errcode='42501';
  end if;
  perform kontrol_private.exigir_permissao('orcamentos.visualizar');
  perform kontrol_private.exigir_permissao('custeio.ver');
  perform kontrol_private.exigir_permissao('tecnicos.salario.ver');
  -- Escopo global por permissão da 0124; não contornar futura restrição por linha.
  if not has_schema_privilege('authenticated','public','USAGE') then
    raise exception 'Leitura não autorizada.' using errcode='42501';
  end if;
  foreach tabela in array array['orcamentos','demandas_propostas','orcamento_itens','orcamento_final_versoes'] loop
    rel := to_regclass('public.'||tabela);
    if not coalesce(has_table_privilege('authenticated',rel,'SELECT'),false)
       or not exists(select 1 from pg_catalog.pg_class where oid=rel and relrowsecurity)
       or not exists(select 1 from pg_catalog.pg_policy p where p.polrelid=rel
         and p.polname='perm_read_'||tabela and p.polpermissive and p.polcmd='r'
         and 'authenticated'::regrole::oid=any(p.polroles)
         and pg_get_expr(p.polqual,p.polrelid)='kontrol_private.tem_permissao_efetiva(''orcamentos.visualizar''::text)')
       or exists(select 1 from pg_catalog.pg_policy p where p.polrelid=rel and not p.polpermissive and p.polcmd in ('r','*')) then
      raise exception 'Escopo de orçamento precisa ser reconciliado.' using errcode='42501';
    end if;
  end loop;
  if p_orcamento_id is null or p_orcamento_id<=0 then
    raise exception 'Identifique o orçamento.' using errcode='22023';
  end if;
  select * into b from public.orcamentos where id=p_orcamento_id;
  if not found then raise exception 'Contexto não localizado.' using errcode='P0002'; end if;
  select * into demanda from public.demandas_propostas where id=b.demanda_id;
  if not found then raise exception 'Vínculo de demanda ausente.' using errcode='P0002'; end if;

  -- Histórico independe de preço, catálogo ativo, método vigente e modo atual.
  if p_operacao_id is not null then
    select * into captura from kontrol_private.orcamento_capturas_equivalencia
      where orcamento_id=b.id and operacao_id=p_operacao_id;
    if not found then
      return jsonb_build_object('versao','captura-economica-leitura-v1','estado','nao_localizada',
        'orcamento_id',b.id,'operacao_id',p_operacao_id);
    end if;
    return jsonb_build_object('versao','captura-economica-leitura-v1','estado','historico',
      'orcamento_id',b.id,'demanda_id',b.demanda_id,'operacao_id',captura.operacao_id,
      'criado_em',captura.criado_em,'snapshot',captura.snapshot,'recibo',captura.recibo,
      'hash_confere',md5(captura.snapshot::text)=captura.recibo->>'snapshot_hash');
  end if;

  perform kontrol_private.exigir_permissao('analises.ver');
  perform kontrol_private.exigir_permissao('insumos.ver');
  if not has_function_privilege('authenticated','public.ler_equivalencia_contextual_v1(text,text)','EXECUTE')
     or not has_function_privilege('authenticated','kontrol_private.operar_equivalencia_v1(text,text,text,jsonb)','EXECUTE') then
    raise exception 'Referências não autorizadas.' using errcode='42501';
  end if;
  select count(*) into q from public.orcamento_itens where orcamento_id=b.id;
  if q>100 or (select count(*) from (
    select distinct d.codigo_analise,d.metodo_revisao_ref from kontrol_private.equivalencia_insumos_decisoes d
    where exists(select 1 from public.orcamento_itens i where i.orcamento_id=b.id and i.codigo_analise=d.codigo_analise)
  ) refs)>100 or exists(select 1 from kontrol_private.equivalencia_insumos_decisoes d
    where exists(select 1 from public.orcamento_itens i where i.orcamento_id=b.id and i.codigo_analise=d.codigo_analise)
    group by d.codigo_analise,d.metodo_revisao_ref having count(*)>200) then
    return jsonb_build_object('versao','captura-economica-leitura-v1','estado','indisponivel','motivo','limite_contexto');
  end if;
  for item in select * from public.orcamento_itens where orcamento_id=b.id order by id loop
    metodos := '[]';
    for metodo in select distinct d.metodo_revisao_ref from kontrol_private.equivalencia_insumos_decisoes d
      where d.codigo_analise=item.codigo_analise order by d.metodo_revisao_ref loop
      -- Revalida sessão, acesso/RLS ao catálogo e contexto técnico pela fonte 0154.
      fonte := public.ler_equivalencia_contextual_v1(item.codigo_analise,metodo.metodo_revisao_ref);
      select coalesce(jsonb_agg(jsonb_build_object('decisao_ref',d->'decisao_ref','evidencia_ref',d->'evidencia_ref',
        'necessidade_id',d->'necessidade_id','estado',d->'estado','vigente_desde',d->'vigente_desde',
        'vigente_ate',d->'vigente_ate') order by d->>'decisao_ref'),'[]') into referencias
        from jsonb_array_elements(fonte->'decisoes') d;
      metodos := metodos||jsonb_build_array(jsonb_build_object('metodo_revisao_ref',metodo.metodo_revisao_ref,
        'estado_validacoes',fonte->'estado','referencias',referencias,
        'contexto_ref',md5((fonte-'instante')::text),
        'tem_validacao_vigente',exists(select 1 from jsonb_array_elements(fonte->'decisoes') d
          where d->>'estado'='validada' and (d->>'vigente_desde')::numeric<=extract(epoch from statement_timestamp())*1000
          and (d->>'vigente_ate' is null or (d->>'vigente_ate')::numeric>extract(epoch from statement_timestamp())*1000))));
    end loop;
    referencias_ok := referencias_ok and exists(select 1 from jsonb_array_elements(metodos) m
      where m->>'estado_validacoes'='disponivel' and (m->>'tem_validacao_vigente')::boolean);
    itens := itens||jsonb_build_array(jsonb_build_object('id',item.id,'codigo_analise',item.codigo_analise,
      'n_amostras',item.n_amostras,'custo_unitario',item.custo_unitario,'preco_unitario',item.preco_unitario,
      'valor_snapshot',item.valor_snapshot,'metodos_documentados',metodos));
  end loop;
  select count(*) into qtd_historico from kontrol_private.orcamento_capturas_equivalencia where orcamento_id=b.id;
  select coalesce(jsonb_agg(jsonb_build_object('operacao_id',h.operacao_id,'criado_em',h.criado_em,'recibo',h.recibo)
    order by h.criado_em desc,h.operacao_id),'[]') into historico from (
      select operacao_id,criado_em,recibo from kontrol_private.orcamento_capturas_equivalencia
      where orcamento_id=b.id order by criado_em desc,operacao_id limit 20
    ) h;
  marcados := exists(select 1 from public.orcamento_itens where orcamento_id=b.id
    and valor_snapshot->>'versao'='equivalencia-economica-v1');
  modo := case
    when b.custo_snapshot->>'versao'='equivalencia-economica-v1' and qtd_historico>0 then 'equivalencia'
    when qtd_historico>0 or marcados or b.custo_snapshot->>'versao'='equivalencia-economica-v1' then 'inconsistente'
    else 'sem_captura' end;
  preparar := coalesce(kontrol_private.tem_permissao_efetiva('orcamentos.criar_editar')
    and has_function_privilege('authenticated','public.capturar_orcamento_equivalencia_v1(bigint,integer,jsonb,uuid)','EXECUTE')
    and demanda.modalidade in ('analises','analises_projeto','projeto_com_analises','projeto_analises_custos')
    and b.status='rascunho' and b.status_operacional in ('pendente','preenchido')
    and b.custo_revisao>=0 and modo<>'inconsistente' and q>0 and referencias_ok
    and not exists(select 1 from public.orcamento_final_versoes where demanda_id=b.demanda_id)
    and not exists(select 1 from public.orcamento_itens where orcamento_id=b.id
      and (n_amostras is null or n_amostras<=0 or n_amostras<>trunc(n_amostras) or n_amostras>9007199254740991))
    and not exists(select 1 from public.orcamento_itens where orcamento_id=b.id group by codigo_analise having count(*)<>1),false);
  contexto := jsonb_build_object('versao','captura-economica-leitura-v1','estado','contexto',
    'orcamento_id',b.id,'demanda',jsonb_build_object('id',demanda.id,'titulo',demanda.titulo,'modalidade',demanda.modalidade),
    'modulo','laboratorio','revisao',b.custo_revisao,'status',b.status,'status_operacional',b.status_operacional,
    'modo',modo,'edicao_legada_bloqueada',modo<>'sem_captura','itens',itens,
    'capacidades',jsonb_build_object('consultar',true,'preparar_intencao',preparar),
    'referencias_documentais','atestacao_explicita_sem_catalogo_de_revisoes',
    'fontes_economicas','nao_verificadas','historico',historico,'historico_total',qtd_historico,
    'historico_truncado',qtd_historico>20,'cas_escrita','custo_revisao');
  -- Fingerprint de leitura, NÃO CAS de preços/fontes. 0163 revalida/captura as fontes sob lock.
  return contexto||jsonb_build_object('contexto_ref','captura-contexto:'||md5(contexto::text));
end $$;
revoke all on function public.ler_captura_orcamento_equivalencia_v1(bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.ler_captura_orcamento_equivalencia_v1(bigint,uuid) to authenticated;
comment on function public.ler_captura_orcamento_equivalencia_v1(bigint,uuid) is
  'Leitura autenticada de contexto ou captura histórica, sem tabela privada exposta e sem recálculo. Capacidade de preparar não prova fontes econômicas.';
commit;
