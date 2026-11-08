-- ORD118: prova prospectiva. Sem seed, cron, política inicial ou backfill.
-- Cobertura/ausência de ruptura são certificações humanas de evidência
-- identificada (SHA + referência), não inferências do saldo ou da média.
-- Recorte positivo: baixa_manual_embalagens não classificada como perda.
-- Qualquer outra saída/ajuste invalida o mês: não inferir estorno do leitor.
begin;
set local lock_timeout = '5s';

create table kontrol_private.consumo_mensal_operacoes (
  operacao_id uuid primary key, ator_id uuid not null, insumo_id bigint,
  acao text not null, entrada jsonb not null, resultado jsonb not null,
  registrado_em timestamptz not null default clock_timestamp()
);
create table kontrol_private.consumo_mensal_papeis (
  papel text not null,
  acao text not null check (acao in ('configurar','certificar','executar')),
  permitido boolean not null,
  primary key (papel,acao)
);
create table kontrol_private.consumo_mensal_configuracoes (
  id bigint generated always as identity primary key,
  insumo_id bigint not null references public.insumos(id) on delete restrict,
  inicio date not null,
  fuso text not null check (fuso='America/Sao_Paulo'),
  janela integer not null check (janela between 1 and 120),
  minimo_n integer not null check (minimo_n between 1 and janela),
  comparabilidade text not null check (comparabilidade='mes_civil_integral_sem_ruptura_mesma_apresentacao'),
  conteudo numeric not null check (conteudo>0 and conteudo<'Infinity'::numeric),
  unidade text not null check (unidade<>''),
  unidade_consumo text not null check (unidade_consumo<>''),
  fator numeric not null check (fator>0 and fator<'Infinity'::numeric),
  registrado_em timestamptz not null default clock_timestamp()
);
create index on kontrol_private.consumo_mensal_configuracoes(insumo_id,id desc);
create table kontrol_private.consumo_mensal_fontes (
  movimento_id bigint primary key, evento_id bigint not null unique,
  insumo_id bigint not null, lote_id bigint not null, quantidade numeric not null,
  ocorrido_em timestamptz not null, conteudo numeric, unidade text,
  unidade_consumo text, fator numeric, evento jsonb not null
);
create table kontrol_private.consumo_mensal_marcas (
  id bigint generated always as identity primary key,
  insumo_id bigint not null, mes date not null, movimento_id bigint not null,
  alteracao boolean not null
);
create index on kontrol_private.consumo_mensal_marcas(insumo_id,mes,id desc);
create table kontrol_private.consumo_mensal_revisoes (
  id bigint generated always as identity primary key,
  insumo_id bigint not null references public.insumos(id) on delete restrict,
  configuracao_id bigint not null references kontrol_private.consumo_mensal_configuracoes(id),
  mes date not null, marca bigint not null, quantidade_embalagens numeric,
  motivo text not null, cobertura_integral boolean not null, sem_ruptura boolean not null,
  prova_sha256 text not null check (prova_sha256 ~ '^[a-f0-9]{64}$'),
  prova_referencia text not null check (char_length(prova_referencia) between 1 and 500),
  fontes jsonb not null, registrado_em timestamptz not null default clock_timestamp()
);
create index on kontrol_private.consumo_mensal_revisoes(insumo_id,mes,id desc);
create table kontrol_private.consumo_mensal_transicoes (
  insumo_id bigint primary key references public.insumos(id) on delete restrict,
  operacao_id uuid not null unique, ator_id uuid not null, prova jsonb not null,
  registrado_em timestamptz not null default clock_timestamp()
);

do $$
declare t text;
begin
  foreach t in array array['operacoes','papeis','configuracoes','fontes','marcas','revisoes','transicoes'] loop
    execute format('alter table kontrol_private.%I enable row level security','consumo_mensal_'||t);
    execute format('revoke all on table kontrol_private.%I from public,anon,authenticated,service_role','consumo_mensal_'||t);
    if t in ('configuracoes','marcas','revisoes','transicoes') then
      execute format('create policy consumo_mensal_leitura on kontrol_private.%1$I for select to authenticated
        using (kontrol_private.tem_permissao_efetiva(''estoque.ver'') and exists (
          select 1 from public.v_estoque_saldo s where s.insumo_id=%1$I.insumo_id))','consumo_mensal_'||t);
      execute format('grant select on table kontrol_private.%I to authenticated','consumo_mensal_'||t);
    end if;
  end loop;
end $$;
revoke all on sequence kontrol_private.consumo_mensal_configuracoes_id_seq,
  kontrol_private.consumo_mensal_marcas_id_seq,kontrol_private.consumo_mensal_revisoes_id_seq
from public,anon,authenticated,service_role;

-- Todas as mutações candidatas, não só a fonte positiva. Uma alteração
-- histórica jamais desaparece da prova: UPDATE/DELETE exigem reavaliação.
create function kontrol_private.marcar_movimento_mensal_0157()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  a public.estoque_movimentacoes%rowtype;
  n public.estoque_movimentacoes%rowtype;
  i bigint;
begin
  if tg_op='TRUNCATE' then
    for i in select distinct m.insumo_id from public.estoque_movimentacoes m
      where m.tipo in ('saida','ajuste') order by m.insumo_id loop
      perform pg_advisory_xact_lock(hashtextextended(i::text,157));
    end loop;
    insert into kontrol_private.consumo_mensal_marcas(insumo_id,mes,movimento_id,alteracao)
    select distinct m.insumo_id,date_trunc('month',d.d::timestamp)::date,m.id,true
    from public.estoque_movimentacoes m
    cross join lateral (values (m.data),((m.criado_em at time zone 'America/Sao_Paulo')::date)) d(d)
    where m.tipo in ('saida','ajuste');
    return null;
  end if;
  if tg_op<>'INSERT' then a:=old; end if;
  if tg_op<>'DELETE' then n:=new; end if;
  for i in select distinct q.insumo_id from (values
      (a.insumo_id,a.tipo),(n.insumo_id,n.tipo)) q(insumo_id,tipo)
    where q.tipo in ('saida','ajuste') order by q.insumo_id loop
    perform pg_advisory_xact_lock(hashtextextended(i::text,157));
  end loop;
  insert into kontrol_private.consumo_mensal_marcas(insumo_id,mes,movimento_id,alteracao)
  select distinct q.insumo_id,date_trunc('month',d.d::timestamp)::date,q.id,tg_op<>'INSERT'
  from (values (a.insumo_id,a.tipo,a.id,a.data,a.criado_em),(n.insumo_id,n.tipo,n.id,n.data,n.criado_em))
    q(insumo_id,tipo,id,data,criado_em)
  cross join lateral (values (q.data),((q.criado_em at time zone 'America/Sao_Paulo')::date)) d(d)
  where q.tipo in ('saida','ajuste');
  return null;
end $$;
create trigger kontrol_marcar_movimento_mensal_0157
after insert or update or delete on public.estoque_movimentacoes
for each row execute function kontrol_private.marcar_movimento_mensal_0157();
create trigger kontrol_marcar_truncate_mensal_0157
before truncate on public.estoque_movimentacoes
for each statement execute function kontrol_private.marcar_movimento_mensal_0157();

-- Conserva definição vigente, assinaturas e ACLs, inclusive guarda 0144.
-- Captura ids recém-gravados e a apresentação histórica do lote bloqueado;
-- a saída de replay não passa aqui. Nenhuma origem é recebida do cliente.
do $migration$
declare
  v_def text:=replace(pg_get_functiondef(
    'public.baixa_manual_embalagens(bigint,integer,integer,uuid,text)'::regprocedure),chr(13),'');
  r record;
begin
  for r in select * from (values
    ($a$  v_restante integer;$a$,$b$  v_restante integer;
  v_movimento_mensal bigint;
  v_evento_mensal bigint;$b$),
    ($a$    case when v_vencimento then 'vencido' when v_perda then 'perda' end
  );$a$,$b$    case when v_vencimento then 'vencido' when v_perda then 'perda' end
  ) returning id into v_movimento_mensal;$b$),
    ($a$    jsonb_build_object('requisicao', v_requisicao, 'resultado', v_resultado)
  );
  return v_resultado;$a$,$b$    jsonb_build_object('requisicao', v_requisicao, 'resultado', v_resultado)
  ) returning id into v_evento_mensal;
  if not v_perda then
    insert into kontrol_private.consumo_mensal_fontes(
      movimento_id,evento_id,insumo_id,lote_id,quantidade,ocorrido_em,conteudo,unidade,unidade_consumo,fator,evento)
    select m.id,e.id,m.insumo_id,m.lote_id,m.quantidade,m.criado_em,
      v_lote.conteudo_embalagem_snapshot,v_lote.unidade_fisica_snapshot,
      v_lote.unidade_consumo_snapshot,v_lote.fator_conversao_snapshot,to_jsonb(e)
    from public.estoque_movimentacoes m cross join public.eventos_status e
    where m.id=v_movimento_mensal and e.id=v_evento_mensal;
  end if;
  return v_resultado;$b$)
  ) ajustes(ancora,novo) loop
    if cardinality(string_to_array(v_def,r.ancora))<>2 then
      raise exception '0157: definição divergente em baixa_manual_embalagens';
    end if;
    v_def:=replace(v_def,r.ancora,r.novo);
  end loop;
  execute v_def;
end $migration$;

-- A média usa somente meses comparáveis fechados, nunca taxa diária x 30.
-- Os demais meses aparecem explicitamente sem quantidade, nunca como zero.
create function kontrol_private.avaliar_consumo_mensal_0157(p_insumo_id bigint)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  c kontrol_private.consumo_mensal_configuracoes%rowtype;
  limite date:=date_trunc('month',statement_timestamp() at time zone 'America/Sao_Paulo')::date;
  n integer:=0;
  media numeric;
  meses jsonb:='[]'::jsonb;
  transicao jsonb;
  qualidade text;
begin
  select * into c from kontrol_private.consumo_mensal_configuracoes
    where insumo_id=p_insumo_id order by id desc limit 1;
  if found then
    with atuais as (
      select distinct on (r.mes) r.* from kontrol_private.consumo_mensal_revisoes r
      where r.insumo_id=p_insumo_id and r.mes>=c.inicio and r.mes<limite
        and r.mes >= (limite-make_interval(months=>c.janela))::date
      order by r.mes,r.id desc
    ), qualificados as (
      select r.id,j.mes::date,r.quantidade_embalagens,coalesce(r.motivo,'sem_prova') as motivo,
        coalesce(r.quantidade_embalagens is not null
          and (x.conteudo,x.unidade,x.unidade_consumo,x.fator)=(c.conteudo,c.unidade,c.unidade_consumo,c.fator)
          and r.marca=coalesce((select max(m.id) from kontrol_private.consumo_mensal_marcas m
            where m.insumo_id=p_insumo_id and m.mes=r.mes),0),false) as valido
      from generate_series(greatest(c.inicio,(limite-make_interval(months=>c.janela))::date)::timestamp,
          limite-interval '1 month',interval '1 month') j(mes)
      left join atuais r on r.mes=j.mes::date
      left join kontrol_private.consumo_mensal_configuracoes x on x.id=r.configuracao_id
    )
    select count(*) filter(where valido),avg(quantidade_embalagens) filter(where valido),
      coalesce(jsonb_agg(jsonb_build_object('mes',mes,'revisao',id,'comparavel',valido,
        'quantidade',case when valido then quantidade_embalagens end,
        'motivo',case when not valido and quantidade_embalagens is not null then 'prova_desatualizada_ou_incomparavel' else motivo end
      ) order by mes),'[]'::jsonb)
    into n,media,meses from qualificados;
  end if;
  select to_jsonb(t)-'operacao_id'-'ator_id' into transicao
    from kontrol_private.consumo_mensal_transicoes t where t.insumo_id=p_insumo_id;
  qualidade:=case when n=0 then 'sem_leitura_comparavel'
    when n<c.minimo_n then 'media_insuficiente' else 'alta' end;
  return jsonb_build_object('configuracao',case when c.id is not null then to_jsonb(c) end,
    'estado',case when transicao is not null and qualidade<>'alta' then 'reavaliacao'
      when transicao is not null then 'calculado'
      when qualidade='alta' then 'alta_pendente_execucao' else qualidade end,
    'qualidade',qualidade,'n',n,'media_embalagens_mes',media,'meses',meses,'transicao',transicao);
end $$;

-- ORD136: mesma decisão de sessão/escopo/matriz para leitura e escrita.
-- Não expõe linhas da matriz; só capacidades efetivas do chamador.
create function kontrol_private.capacidades_consumo_mensal_0157(p_insumo_id bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  ator uuid:=kontrol_private.exigir_sessao_nomeacao();
  v_papel text;
begin
  select p.papel into v_papel from public.perfis p where p.id=ator
    and not p.suspenso and not p.senha_provisoria;
  if v_papel is null
     or not kontrol_private.tem_permissao_efetiva('estoque.ver')
     or not exists(select 1 from public.v_estoque_saldo s where s.insumo_id=p_insumo_id) then
    raise exception 'Operação mensal não autorizada.' using errcode='42501';
  end if;
    -- Mesmo contrato físico conservador da escrita 0152: não confundir o
    -- dono SECURITY DEFINER com o recorte/grants do chamador authenticated.
    if not has_schema_privilege('authenticated'::regrole,'public','USAGE')
       or not has_function_privilege('authenticated'::regrole,'public.menor_validade(date,date)'::regprocedure,'EXECUTE')
       or exists(select 1 from (values ('public.v_estoque_saldo'::regclass),('public.insumos'::regclass),
          ('public.tipo_insumos'::regclass),('public.lotes_estoque'::regclass),('public.reservas_estoque'::regclass)) f(relacao)
          where not has_table_privilege('authenticated'::regrole,f.relacao,'SELECT'))
       or not exists(select 1 from pg_class x where x.oid='public.v_estoque_saldo'::regclass
          and 'security_invoker=true'=any(x.reloptions))
       or not exists(select 1 from pg_policy x where x.polrelid='public.insumos'::regclass
          and x.polname='rls_read_insumos' and x.polpermissive and x.polcmd='r'
          and 'authenticated'::regrole::oid=any(x.polroles) and pg_get_expr(x.polqual,x.polrelid)='true')
       or exists(select 1 from pg_policy x where x.polrelid='public.insumos'::regclass
          and not x.polpermissive and x.polcmd in ('r','*')) then
      raise exception 'Escopo de estoque precisa ser reconciliado antes da prova.' using errcode='42501';
    end if;
  return jsonb_build_object(
    'configurar',exists(select 1 from kontrol_private.consumo_mensal_papeis p
      where p.papel=v_papel and p.acao='configurar' and p.permitido),
    'certificar',exists(select 1 from kontrol_private.consumo_mensal_papeis p
      where p.papel=v_papel and p.acao='certificar' and p.permitido),
    'executar',exists(select 1 from kontrol_private.consumo_mensal_papeis p
      where p.papel=v_papel and p.acao='executar' and p.permitido),
    'governanca',v_papel='admin');
end $$;


create function public.ler_consumo_mensal_insumo(p_insumo_id bigint)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if auth.uid() is null or not kontrol_private.tem_permissao_efetiva('estoque.ver')
     or not exists(select 1 from public.v_estoque_saldo s where s.insumo_id=p_insumo_id) then
    raise exception 'Insumo não disponível no estoque para esta sessão.' using errcode='42501';
  end if;
  return kontrol_private.avaliar_consumo_mensal_0157(p_insumo_id) ||
    jsonb_build_object('manual_vigente',public.ler_consumo_manual_insumo(p_insumo_id,null,1)->'vigente',
      'capacidades',kontrol_private.capacidades_consumo_mensal_0157(p_insumo_id));
end $$;

-- Envelope fechado por ação; quantidade mensal não é parâmetro.
-- Todo ato e concessão/revogação tem ator de sessão viva e UUID auditável.
create function public.operar_consumo_mensal_insumo(
  p_insumo_id bigint,p_operacao_id uuid,p_acao text,p_dados jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
<<mensal>>
declare
  ator uuid:=kontrol_private.exigir_sessao_nomeacao();
  papel text;
  anterior kontrol_private.consumo_mensal_operacoes%rowtype;
  c kontrol_private.consumo_mensal_configuracoes%rowtype;
  chaves text[];
  mes date; limite date; inicio date; janela integer; minimo integer;
  cobertura boolean; sem_ruptura boolean; ambigua boolean;
  fontes jsonb; marca bigint; quantidade numeric; motivo text; resultado jsonb;
begin
  if current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'A prova mensal exige snapshot atual.' using errcode='25000';
  end if;
  if p_operacao_id is null or jsonb_typeof(p_dados) is distinct from 'object' then
    raise exception 'Operação mensal inválida.' using errcode='22023';
  end if;
  select p.papel into papel from public.perfis p where p.id=ator
    and not p.suspenso and not p.senha_provisoria for share;
  if papel is null then raise exception 'Operação mensal não autorizada.' using errcode='42501'; end if;
  if p_acao='governanca' then
    if papel<>'admin' or p_insumo_id is not null then
      raise exception 'Somente Administrador governa a política mensal.' using errcode='42501';
    end if;
    chaves:=array['papel','acao','permitido','motivo'];
  else
    if not coalesce((kontrol_private.capacidades_consumo_mensal_0157(p_insumo_id)->>p_acao)::boolean,false) then
      raise exception 'Operação mensal não autorizada.' using errcode='42501';
    end if;
    chaves:=case p_acao
      when 'configurar' then array['inicio','fuso','janela','minimo_n','comparabilidade','conteudo','unidade','unidade_consumo','fator']
      when 'certificar' then array['mes','cobertura_integral','sem_ruptura','prova_sha256','prova_referencia']
      when 'executar' then array[]::text[] end;
  end if;
  if chaves is null or not(p_dados ?& chaves) or p_dados-chaves<>'{}'::jsonb then
    raise exception 'Campos da operação mensal inválidos.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operacao_id::text,1571));
  perform kontrol_private.exigir_sessao_nomeacao();
  if p_acao<>'governanca' then
    perform 1 from kontrol_private.consumo_mensal_papeis p
      where p.papel=mensal.papel and p.acao=p_acao and p.permitido for share;
    if not found then raise exception 'Operação mensal não autorizada.' using errcode='42501'; end if;
  end if;
  select * into anterior from kontrol_private.consumo_mensal_operacoes where operacao_id=p_operacao_id;
  if found then
    if (anterior.ator_id,anterior.insumo_id,anterior.acao,anterior.entrada)
       is distinct from (ator,p_insumo_id,p_acao,p_dados) then
      raise exception 'Operação mensal já usada com outro conteúdo.' using errcode='23505';
    end if;
    return anterior.resultado||jsonb_build_object('repetida',true,'estado_historico',true,
      'operacao_id',anterior.operacao_id,'insumo_id',anterior.insumo_id,
      'acao',anterior.acao,'ator_id',anterior.ator_id);
  end if;
  if p_acao='governanca' then
    if not coalesce(kontrol_private.papel_catalogado(p_dados->>'papel'),false)
       or coalesce(p_dados->>'acao','') not in ('configurar','certificar','executar')
       or jsonb_typeof(p_dados->'permitido') is distinct from 'boolean'
       or coalesce(char_length(btrim(p_dados->>'motivo')),0) not between 1 and 500 then
      raise exception 'Decisão de governança inválida.' using errcode='22023';
    end if;
    insert into kontrol_private.consumo_mensal_papeis(papel,acao,permitido)
    values(p_dados->>'papel',p_dados->>'acao',(p_dados->>'permitido')::boolean)
    on conflict on constraint consumo_mensal_papeis_pkey do update set permitido=excluded.permitido;
    resultado:='{"estado":"politica_registrada"}'::jsonb;
  else
    perform pg_advisory_xact_lock(hashtextextended(p_insumo_id::text,157));
    perform 1 from kontrol_private.consumo_mensal_papeis p
      where p.papel=mensal.papel and p.acao=p_acao and p.permitido for share;
    if not found then raise exception 'Operação mensal não autorizada.' using errcode='42501'; end if;
    limite:=date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')::date;
    select * into c from kontrol_private.consumo_mensal_configuracoes
      where insumo_id=p_insumo_id order by id desc limit 1;
    if p_acao='configurar' then
      inicio:=(p_dados->>'inicio')::date; janela:=(p_dados->>'janela')::integer; minimo:=(p_dados->>'minimo_n')::integer;
      if inicio is null or not isfinite(inicio) or extract(day from inicio)<>1
         or (c.id is null and inicio<=limite) or (c.id is not null and inicio is distinct from c.inicio)
         or coalesce(janela,0) not between 1 and 120 or coalesce(minimo,0) not between 1 and janela then
        raise exception 'Defina início prospectivo no primeiro dia do mês, janela e mínimo explícitos.' using errcode='22023';
      end if;
      insert into kontrol_private.consumo_mensal_configuracoes(
        insumo_id,inicio,fuso,janela,minimo_n,comparabilidade,conteudo,unidade,unidade_consumo,fator)
      values(p_insumo_id,inicio,p_dados->>'fuso',janela,minimo,p_dados->>'comparabilidade',
        (p_dados->>'conteudo')::numeric,btrim(p_dados->>'unidade'),btrim(p_dados->>'unidade_consumo'),(p_dados->>'fator')::numeric);
    elsif p_acao='certificar' then
      mes:=(p_dados->>'mes')::date;
      if c.id is null or mes is null or not isfinite(mes) or extract(day from mes)<>1
         or mes<c.inicio or mes>=limite
         or jsonb_typeof(p_dados->'cobertura_integral') is distinct from 'boolean'
         or jsonb_typeof(p_dados->'sem_ruptura') is distinct from 'boolean'
         or coalesce(p_dados->>'prova_sha256','') !~ '^[a-f0-9]{64}$'
         or coalesce(char_length(btrim(p_dados->>'prova_referencia')),0) not between 1 and 500 then
        raise exception 'Certifique mês civil fechado após o início, com prova identificada.' using errcode='22023';
      end if;
      cobertura:=(p_dados->>'cobertura_integral')::boolean; sem_ruptura:=(p_dados->>'sem_ruptura')::boolean;
      with candidatos as (
        select m.id,m.quantidade,f.evento_id,
          coalesce(m.tipo='saida' and m.categoria_saida is null
            and m.quantidade>0 and m.quantidade<'Infinity'::numeric
            and (m.insumo_id,m.lote_id,m.quantidade,m.criado_em)=(f.insumo_id,f.lote_id,f.quantidade,f.ocorrido_em)
            and (f.conteudo,f.unidade,f.unidade_consumo,f.fator)=(c.conteudo,c.unidade,c.unidade_consumo,c.fator)
            and m.data>=mes and m.data<(mes+interval '1 month')::date
            and (m.criado_em at time zone c.fuso)::date>=mes
            and (m.criado_em at time zone c.fuso)::date<(mes+interval '1 month')::date,false) as valido
        from public.estoque_movimentacoes m
        left join kontrol_private.consumo_mensal_fontes f on f.movimento_id=m.id
        where m.insumo_id=p_insumo_id and m.tipo in ('saida','ajuste')
          and (m.data>=mes and m.data<(mes+interval '1 month')::date
            or (m.criado_em at time zone c.fuso)::date>=mes
              and (m.criado_em at time zone c.fuso)::date<(mes+interval '1 month')::date)
      )
      select coalesce(bool_or(not q.valido),false),coalesce(sum(q.quantidade) filter(where q.valido),0),
        coalesce(jsonb_agg(jsonb_build_object('movimento_id',q.id,'evento_id',q.evento_id,'valido',q.valido) order by q.id),'[]'::jsonb)
      into ambigua,quantidade,fontes from candidatos q;
      select coalesce(max(m.id),0),ambigua or coalesce(bool_or(m.alteracao),false)
        into marca,ambigua from kontrol_private.consumo_mensal_marcas m where m.insumo_id=p_insumo_id and m.mes=mensal.mes;
      motivo:=case when not cobertura then 'cobertura_incompleta'
        when not sem_ruptura then 'ruptura_nao_descartada'
        when ambigua then 'livro_ambiguo_ou_apresentacao_divergente' else 'fechado_com_prova' end;
      insert into kontrol_private.consumo_mensal_revisoes(
        insumo_id,configuracao_id,mes,marca,quantidade_embalagens,motivo,cobertura_integral,sem_ruptura,prova_sha256,prova_referencia,fontes)
      values(p_insumo_id,c.id,mes,marca,case when motivo='fechado_com_prova' then quantidade end,motivo,
        cobertura,sem_ruptura,p_dados->>'prova_sha256',btrim(p_dados->>'prova_referencia'),fontes);
    end if;
    resultado:=kontrol_private.avaliar_consumo_mensal_0157(p_insumo_id);
    perform 1 from kontrol_private.consumo_mensal_papeis p
      where p.papel=mensal.papel and p.acao='executar' and p.permitido for share;
    if found and resultado->>'qualidade'='alta' then
      insert into kontrol_private.consumo_mensal_transicoes(insumo_id,operacao_id,ator_id,prova)
      values(p_insumo_id,p_operacao_id,ator,resultado) on conflict(insumo_id) do nothing;
      resultado:=kontrol_private.avaliar_consumo_mensal_0157(p_insumo_id);
    end if;
  end if;
  insert into kontrol_private.consumo_mensal_operacoes(operacao_id,ator_id,insumo_id,acao,entrada,resultado)
  values(p_operacao_id,ator,p_insumo_id,p_acao,p_dados,resultado);
  return resultado||jsonb_build_object('repetida',false,'estado_historico',false,'operacao_id',p_operacao_id,
    'insumo_id',p_insumo_id,'acao',p_acao,'ator_id',ator);
end $$;

revoke all on function kontrol_private.marcar_movimento_mensal_0157(),
  kontrol_private.capacidades_consumo_mensal_0157(bigint),
  kontrol_private.avaliar_consumo_mensal_0157(bigint),public.ler_consumo_mensal_insumo(bigint),
  public.operar_consumo_mensal_insumo(bigint,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function kontrol_private.capacidades_consumo_mensal_0157(bigint),
  kontrol_private.avaliar_consumo_mensal_0157(bigint),public.ler_consumo_mensal_insumo(bigint),
  public.operar_consumo_mensal_insumo(bigint,uuid,text,jsonb) to authenticated;
commit;
