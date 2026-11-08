-- ORD129: leitura apenas; depende de 0151/0153. Nenhuma concessão funcional.
-- Os corpos SQL preanalisados preservam o schema kontrol_aviso_api sem USAGE.
begin;

create function kontrol_aviso_api.preparar_configuracao_aviso(
  p_unidade_id bigint, p_tipo text, p_origem_apos bigint,
  p_responsavel_apos uuid, p_limite integer
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ator uuid := kontrol_private.aviso_ator();
  v_regra jsonb;
begin
  perform kontrol_private.aviso_unidade_visivel(p_unidade_id);
  if not kontrol_private.aviso_direito(v_ator, 'configurar') then
    raise exception 'Configuração de avisos não autorizada.' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in
      ('preventiva','corretiva','calibracao','qualificacao','verificacao','limpeza_tecnica')
    or p_limite is null or p_limite not between 1 and 100
    or (p_origem_apos is not null and p_origem_apos not between 1 and 9007199254740991) then
    raise exception 'Tipo ou paginação inválidos.' using errcode = '22023';
  end if;
  select pg_catalog.jsonb_build_object('id', r.id, 'versao', r.versao,
    'ocorrencia_id', r.ocorrencia_id) into v_regra
  from kontrol_private.equipamento_aviso_regras r
  where r.equipamento_unidade_id = p_unidade_id and r.tipo = p_tipo
  order by r.versao desc limit 1;
  return pg_catalog.jsonb_build_object(
    'equipamento_unidade_id', p_unidade_id, 'tipo', p_tipo, 'limite', p_limite,
    'origem_apos', p_origem_apos, 'responsavel_apos', p_responsavel_apos,
    'regra', v_regra, 'permissoes', pg_catalog.jsonb_build_object(
      'configurar', true,
      'avaliar', kontrol_private.aviso_direito(v_ator, 'avaliar'),
      'reconhecer', kontrol_private.aviso_direito(v_ator, 'reconhecer'),
      'encaminhar', kontrol_private.aviso_direito(v_ator, 'encaminhar'),
      'governar', kontrol_private.tem_permissao_efetiva('privilegios.gerenciar')));
end $$;

-- NULL nos cursores = primeira página. Sem busca por nome ou IDs como prova.
-- Estado/CAS refletem este snapshot; a escrita 0153 revalida sessão/direito/CAS.
create function public.contexto_configuracao_aviso_equipamento(
  p_unidade_id bigint, p_tipo text, p_origem_apos bigint,
  p_responsavel_apos uuid, p_limite integer
) returns jsonb language sql stable security invoker set search_path = ''
return (
  with autorizado as materialized (
    select kontrol_aviso_api.preparar_configuracao_aviso(
      kontrol_private.aviso_unidade_visivel(p_unidade_id), p_tipo,
      p_origem_apos, p_responsavel_apos, p_limite) as dado
  )
  select pg_catalog.jsonb_build_object(
    'estado', 'confirmado', 'equipamento_unidade_id', p_unidade_id, 'tipo', p_tipo,
    'permissoes', a.dado -> 'permissoes',
    'regra', case
      when a.dado -> 'regra' = 'null'::jsonb then
        pg_catalog.jsonb_build_object('estado', 'confirmada', 'dado', null)
      when atual.id is null then pg_catalog.jsonb_build_object('estado', 'indisponivel')
      else pg_catalog.jsonb_build_object('estado', 'confirmada',
        'dado', (a.dado -> 'regra') - 'ocorrencia_id') end,
    'versao_esperada', case
      when a.dado -> 'regra' = 'null'::jsonb then 0
      when atual.id is not null then (a.dado #>> '{regra,versao}')::integer end,
    'origens', origens.pagina,
    'responsaveis', responsaveis.pagina)
  from autorizado a
  -- Visibilidade da origem vigente é independente da página de candidatos.
  -- Não devolve identidade/versão da regra cuja origem esteja oculta/ausente.
  left join public.equipamento_manutencoes atual
    on atual.id = (a.dado #>> '{regra,ocorrencia_id}')::bigint
      and atual.equipamento_unidade_id = (a.dado ->> 'equipamento_unidade_id')::bigint
      and atual.tipo = a.dado ->> 'tipo'
  cross join lateral (
    with candidatos as materialized (
      select m.id, m.tipo, m.status, m.proxima_data
      from public.equipamento_manutencoes m
      where m.equipamento_unidade_id = (a.dado ->> 'equipamento_unidade_id')::bigint
        and m.tipo = a.dado ->> 'tipo'
        and m.id between 1 and 9007199254740991
        and m.status <> 'cancelada'
        and m.proxima_data between date '0001-01-01' and date '9999-12-31'
        and ((a.dado ->> 'origem_apos') is null or m.id > (a.dado ->> 'origem_apos')::bigint)
      order by m.id limit ((a.dado ->> 'limite')::integer + 1)
    ), pagina as (
      select * from candidatos order by id limit (a.dado ->> 'limite')::integer
    )
    select pg_catalog.jsonb_build_object(
      'itens', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.id)
        from pagina p), '[]'::jsonb),
      'proximo_apos', case when (select count(*) from candidatos) > (a.dado ->> 'limite')::integer
        then (select max(id) from pagina) end) as pagina
  ) origens
  cross join lateral (
    with candidatos as materialized (
      -- Exatamente a elegibilidade de responsável da 0153: perfil não suspenso.
      -- RLS continua aplicável. Não inferir elegibilidade por papel/hierarquia.
      select p.id, p.nome from public.perfis p
      where not p.suspenso
        and ((a.dado ->> 'responsavel_apos') is null or p.id > (a.dado ->> 'responsavel_apos')::uuid)
      order by p.id limit ((a.dado ->> 'limite')::integer + 1)
    ), pagina as (
      select * from candidatos order by id limit (a.dado ->> 'limite')::integer
    )
    select pg_catalog.jsonb_build_object(
      'itens', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.id)
        from pagina p), '[]'::jsonb),
      'proximo_apos', case when (select count(*) from candidatos) > (a.dado ->> 'limite')::integer
        then (select id from pagina order by id desc limit 1) end) as pagina
  ) responsaveis
);

create function kontrol_aviso_api.consultar_direito_aviso(p_papel text, p_operacao text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ator uuid := kontrol_private.aviso_ator();
  v_concedido boolean;
begin
  if not kontrol_private.tem_permissao_efetiva('privilegios.gerenciar') then
    raise exception 'Governança de avisos não autorizada.' using errcode = '42501';
  end if;
  if p_papel is null or not kontrol_private.papel_catalogado(p_papel)
    or p_operacao is null or p_operacao not in ('configurar','avaliar','reconhecer','encaminhar') then
    raise exception 'Papel ou operação inválidos.' using errcode = '22023';
  end if;
  select exists(select 1 from kontrol_private.equipamento_aviso_direitos d
    where d.papel = p_papel and d.operacao = p_operacao) into v_concedido;
  -- false é ausência confirmada após autorização, nunca fallback de erro/RLS.
  return pg_catalog.jsonb_build_object('estado', 'confirmado', 'papel', p_papel,
    'operacao', p_operacao, 'pode_governar', true, 'concessao_esperada', v_concedido);
end $$;

create function public.consultar_direito_aviso_equipamento(p_papel text, p_operacao text)
returns jsonb language sql stable security invoker set search_path = ''
return kontrol_aviso_api.consultar_direito_aviso(p_papel, p_operacao);

-- ACL técnica nominada autorizada na clarificação ORD129. Nenhum USAGE novo,
-- SELECT privado, política, default, seed ou alteração de direito de negócio.
revoke all on function
  kontrol_aviso_api.preparar_configuracao_aviso(bigint,text,bigint,uuid,integer),
  kontrol_aviso_api.consultar_direito_aviso(text,text),
  public.contexto_configuracao_aviso_equipamento(bigint,text,bigint,uuid,integer),
  public.consultar_direito_aviso_equipamento(text,text)
  from public, anon, authenticated, service_role;
grant execute on function
  kontrol_aviso_api.preparar_configuracao_aviso(bigint,text,bigint,uuid,integer),
  kontrol_aviso_api.consultar_direito_aviso(text,text),
  public.contexto_configuracao_aviso_equipamento(bigint,text,bigint,uuid,integer),
  public.consultar_direito_aviso_equipamento(text,text)
  to authenticated;
commit;
