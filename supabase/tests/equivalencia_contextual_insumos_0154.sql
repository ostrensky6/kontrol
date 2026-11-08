\set ON_ERROR_STOP on
-- Somente clone sintético descartável, após 0151 e 0154. Não é seed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '25s';

do $$
begin
  if exists (select 1 from auth.users)
     or exists (select 1 from public.analises where codigo in ('TS-ORD100-A','TS-ORD100-B'))
     or exists (select 1 from kontrol_private.equivalencia_insumos_decisoes) then
    raise exception '0154: fixture exige clone sintético vazio.';
  end if;
end $$;

create function pg_temp.uid100(p text) returns uuid language sql immutable
as $$ select md5('ord100-perfil-' || p)::uuid $$;
create function pg_temp.sid100(p text) returns uuid language sql immutable
as $$ select md5('ord100-sessao-' || p)::uuid $$;
create function pg_temp.ator100(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.uid100(p)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', pg_temp.uid100(p), 'role', 'authenticated', 'session_id', pg_temp.sid100(p))::text, true);
end $$;
insert into auth.users(id,aud,role,email,created_at,updated_at)
select pg_temp.uid100(r),'authenticated','authenticated','ord100-'||r||'@example.invalid',now(),now()
from unnest(array['laboratorio','coordenador','supervisor','compra','admin','gestor',
  'sem_sessao','suspenso','provisorio']) r;
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.sid100(r),pg_temp.uid100(r),now(),now()
from unnest(array['laboratorio','coordenador','supervisor','compra','admin','gestor','suspenso','provisorio']) r;

alter table public.perfis disable trigger kontrol_proteger_papel_perfil;
update public.perfis set suspenso=false, senha_provisoria=false;
update public.perfis p set papel=r
from unnest(array['coordenador','supervisor','compra','admin','gestor']) r
where p.id=pg_temp.uid100(r);
alter table public.perfis enable trigger kontrol_proteger_papel_perfil;
update public.perfis set suspenso=true where id=pg_temp.uid100('suspenso');
update public.perfis set senha_provisoria=true where id=pg_temp.uid100('provisorio');
update public.permissoes_categorias set permissoes='{"analises.ver":true,"insumos.ver":true}'
where papel in ('laboratorio','coordenador','supervisor','compra','gestor');

insert into public.analises(codigo) values ('TS-ORD100-A'),('TS-ORD100-B');
insert into public.etapas(codigo_analise,nome_etapa,nome_atividade,amostras_por_execucao)
values ('TS-ORD100-A','Preparo','Mistura',2),('TS-ORD100-B','Preparo','Mistura',2);
insert into public.equipamentos(nome) values ('TS-ORD100-Equip-A'),('TS-ORD100-Equip-B');
insert into public.equipamento_analise(equipamento_id,codigo_analise,peso_alocacao)
select id, case nome when 'TS-ORD100-Equip-A' then 'TS-ORD100-A' else 'TS-ORD100-B' end, 1
from public.equipamentos where nome in ('TS-ORD100-Equip-A','TS-ORD100-Equip-B');
insert into public.insumos(especificacao,unidade,unidade_consumo,fator_conversao,quantidade_embalagem)
values ('TS-ORD100-SKU','frasco','reação',100,100),('TS-ORD100-DEFAULT','un','un',1,1);
insert into public.insumo_analise(codigo_analise,etapa_id,nome_etapa,nome_atividade,unidade,quantidade_por_amostra,modo_cobranca)
select codigo_analise,id,nome_etapa,nome_atividade,'reação',2,'por_execucao'
from public.etapas where codigo_analise in ('TS-ORD100-A','TS-ORD100-B');
insert into public.insumo_analise(codigo_analise,nome_etapa,nome_atividade,unidade,quantidade_por_amostra,modo_cobranca)
values ('TS-ORD100-A','Sem etapa','Mistura','un',1,'por_amostra');

do $$
declare v_id bigint;
begin
  insert into public.demandas_propostas(titulo,cliente_nome,status)
    values ('TS-ORD100 legado','Cliente sintético','orcada') returning id into v_id;
  insert into public.orcamento_final_versoes(demanda_id,versao,numero,status,validade_dias,valido_ate,snapshot)
    values (v_id,1,'TS-ORD100-v1','emitido',30,current_date+30,'{"legado":{"fator":9,"valor":17}}');
  perform set_config('ord100.replay', md5(pg_get_functiondef(
    'public.recalcular_orcamento_transacional(bigint,text,integer,text,jsonb,jsonb,uuid)'::regprocedure)), true);
end $$;

-- Corrida, em OUTRO clone descartável: rodar com -v ord100_corrida_setup=1.
-- Os dados de apoio ficam disponíveis para duas conexões; descartar o clone.
\if :{?ord100_corrida_setup}
commit;
\quit
\endif

create function pg_temp.contexto100() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'necessidade_id', n.id, 'etapa_id', n.etapa_id,
    'insumo_id', (select id from public.insumos where especificacao='TS-ORD100-SKU'),
    'equipamento_id', (select id from public.equipamentos where nome='TS-ORD100-Equip-A'),
    'apresentacao_ref','apresentacao:sku:r1','unidade_estoque','frasco','unidade_consumo','reação',
    'fator_conversao',100,'evidencia_ref','laudo:sintetico:r1','vigente_ate',null,'confirmada',true)
  from public.insumo_analise n where n.codigo_analise='TS-ORD100-A' and n.etapa_id is not null;
$$;
create function pg_temp.reg100(p_delta jsonb default '{}'::jsonb, p_metodo text default 'metodo:M1:r1')
returns jsonb language sql as $$
  select public.registrar_equivalencia_contextual_v1('TS-ORD100-A',p_metodo,pg_temp.contexto100() || p_delta);
$$;
create function pg_temp.negada100(p_estado text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_estado then return; end if;
    raise;
  end;
  raise exception '0154: esperava SQLSTATE %, mas a operação passou: %', p_estado, p_sql;
end $$;

do $$
begin
  if has_table_privilege('authenticated','kontrol_private.equivalencia_insumos_decisoes','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or has_function_privilege('anon','public.ler_equivalencia_contextual_v1(text,text)','EXECUTE')
     or has_function_privilege('service_role','public.registrar_equivalencia_contextual_v1(text,text,jsonb)','EXECUTE') then
    raise exception '0154: grant de bypass.';
  end if;
end $$;

set local role authenticated;
select pg_temp.ator100('laboratorio');
select pg_temp.negada100('22023', $$select pg_temp.reg100('{"fator_conversao":1}')$$);
select pg_temp.negada100('22023', $$select pg_temp.reg100('{"confirmada":false}')$$);
select pg_temp.negada100('22023', $$select pg_temp.reg100('{"unidade_consumo":"frasco"}')$$);
select pg_temp.negada100('22023', $$select pg_temp.reg100('{"ator_id":"falsificado"}')$$);
select pg_temp.negada100('22023', $$select pg_temp.reg100(jsonb_build_object('vigente_ate',now()-interval '1 day'))$$);
select pg_temp.negada100('22023', $$select pg_temp.reg100(jsonb_build_object('etapa_id',(select id from public.etapas where codigo_analise='TS-ORD100-B')))$$);
select pg_temp.negada100('22023', $$select pg_temp.reg100(jsonb_build_object('equipamento_id',(select id from public.equipamentos where nome='TS-ORD100-Equip-B')))$$);

do $$
declare v jsonb;
begin
  v := pg_temp.reg100();
  perform set_config('ord100.decisao', split_part(v->>'decisao_ref',':',2),true);
  v := public.ler_equivalencia_contextual_v1('TS-ORD100-A','metodo:M1:r1');
  if v->>'estado' is distinct from 'disponivel' or jsonb_array_length(v->'decisoes') <> 1
     or v#>>'{decisoes,0,papel_validador}' is distinct from 'laboratorio'
     or (v#>>'{decisoes,0,fator_conversao}')::numeric is distinct from 100
     or v#>>'{decisoes,0,validador_id}' is null
     or v#>>'{decisoes,0,validador_id}' !~ '^ator-decisao:[0-9a-f]{32}$'
     or (v->'decisoes'->0) ?| array['ator_id','revogada_por','contexto','motivo_revogacao'] then
    raise exception '0154: projeção incorreta ou expôs dados privados.';
  end if;
  if public.ler_equivalencia_contextual_v1('TS-ORD100-A','metodo:M1:r0')->'decisoes'
    is distinct from '[]'::jsonb then raise exception '0154: revisão errada recebeu decisão.'; end if;
end $$;
select pg_temp.negada100('23505', $$select pg_temp.reg100()$$);
select pg_temp.negada100('23505', $$select pg_temp.reg100('{"apresentacao_ref":"apresentacao:sku:r2"}')$$);
select pg_temp.negada100('42501', $$select * from kontrol_private.equivalencia_insumos_decisoes$$);
do $$
declare v_contexto jsonb;
begin
  v_contexto := jsonb_build_object(
    'necessidade_id',(select id from public.insumo_analise where codigo_analise='TS-ORD100-A' and etapa_id is null),
    'etapa_id',null,'equipamento_id',null,
    'insumo_id',(select id from public.insumos where especificacao='TS-ORD100-DEFAULT'),
    'apresentacao_ref','apresentacao:default:r1','unidade_estoque','un','unidade_consumo','un',
    'fator_conversao',1,'evidencia_ref','laudo:fator-1:r1','vigente_ate',null,'confirmada',false);
  perform pg_temp.negada100('22023', format(
    'select public.registrar_equivalencia_contextual_v1(%L,%L,%L::jsonb)',
    'TS-ORD100-A','metodo:M2:r1',v_contexto::text));
  perform public.registrar_equivalencia_contextual_v1(
    'TS-ORD100-A','metodo:M2:r1',v_contexto || '{"confirmada":true}'::jsonb);
  if public.ler_equivalencia_contextual_v1('TS-ORD100-A','metodo:M2:r1')#>'{decisoes,0,etapa_id}' is distinct from 'null'::jsonb
     or public.ler_equivalencia_contextual_v1('TS-ORD100-A','metodo:M2:r1')#>'{decisoes,0,equipamento_ref}' is distinct from 'null'::jsonb then
    raise exception '0154: ausência explícita virou vínculo.';
  end if;
end $$;

do $$
declare r text;
begin
  foreach r in array array['compra','gestor','admin','sem_sessao','suspenso','provisorio'] loop
    perform pg_temp.ator100(r);
    perform pg_temp.negada100('42501','select pg_temp.reg100()');
    perform pg_temp.negada100('42501',
      'select public.revogar_equivalencia_contextual_v1(current_setting(''ord100.decisao'')::bigint,''negada'')');
  end loop;
end $$;

reset role;
-- ORD111: a chamada direta ao executor não pode contornar a perda de USAGE
-- que bloquearia o wrapper. O savepoint restaura as ACLs para os outros casos.
savepoint ord111_sem_usage;
select set_config('ord111.contexto', pg_temp.contexto100()::text, true);
select set_config('ord111.decisoes_antes', coalesce(jsonb_agg(to_jsonb(d) order by d.id), '[]'::jsonb)::text, true)
from kontrol_private.equivalencia_insumos_decisoes d;
revoke usage on schema public from public, authenticated;
do $$
declare v_rel regclass;
begin
  if has_schema_privilege('authenticated', 'public', 'USAGE')
     or not has_schema_privilege('authenticated', 'kontrol_private', 'USAGE')
     or not has_function_privilege('authenticated',
       'kontrol_private.operar_equivalencia_v1(text,text,text,jsonb)', 'EXECUTE') then
    raise exception 'ORD111: cenário de ACL não isolou o USAGE em public.';
  end if;
  foreach v_rel in array array['public.analises'::regclass, 'public.insumo_analise'::regclass,
    'public.etapas'::regclass, 'public.insumos'::regclass, 'public.equipamento_analise'::regclass,
    'public.equipamentos'::regclass] loop
    if not has_table_privilege('authenticated', v_rel, 'SELECT') then
      raise exception 'ORD111: SELECT deveria permanecer em %.', v_rel;
    end if;
  end loop;
end $$;
set local role authenticated;
select pg_temp.ator100('laboratorio');
do $ord111$
declare v_sql text;
begin
  foreach v_sql in array array[
    $$select kontrol_private.operar_equivalencia_v1('ler','TS-ORD100-A','metodo:M1:r1','{}'::jsonb)$$,
    $$select kontrol_private.operar_equivalencia_v1('registrar','TS-ORD100-A','metodo:ORD111:r1',current_setting('ord111.contexto')::jsonb)$$,
    $$select kontrol_private.operar_equivalencia_v1('revogar',null,null,jsonb_build_object('id',current_setting('ord100.decisao')::bigint,'motivo','não deve revogar'))$$
  ] loop
    begin
      execute v_sql;
    exception when others then
      if sqlstate <> '42501' or sqlerrm <> 'Escopo do schema public não autorizado.' then raise; end if;
      continue;
    end;
    raise exception 'ORD111: executor privado passou sem USAGE em public: %', v_sql;
  end loop;
end $ord111$;
reset role;
do $$
begin
  if (select coalesce(jsonb_agg(to_jsonb(d) order by d.id), '[]'::jsonb)
      from kontrol_private.equivalencia_insumos_decisoes d)
    is distinct from current_setting('ord111.decisoes_antes')::jsonb then
    raise exception 'ORD111: executor alterou decisões sem USAGE em public.';
  end if;
end $$;
rollback to savepoint ord111_sem_usage;
release savepoint ord111_sem_usage;

update public.permissoes_categorias set permissoes='{"analises.ver":true}' where papel='coordenador';
set local role authenticated;
select pg_temp.ator100('coordenador');
select pg_temp.negada100('42501', $$select pg_temp.reg100()$$);
select pg_temp.negada100('42501', $$select public.ler_equivalencia_contextual_v1('TS-ORD100-A','metodo:M1:r1')$$);
reset role;
update public.permissoes_categorias set permissoes='{"analises.ver":true,"insumos.ver":true}' where papel='coordenador';

update public.insumos set quantidade_embalagem=101 where especificacao='TS-ORD100-SKU';
set local role authenticated;
select pg_temp.ator100('coordenador');
do $$
begin
  if public.ler_equivalencia_contextual_v1('TS-ORD100-A','metodo:M1:r1')->>'estado'
     is distinct from 'contexto_divergente' then raise exception '0154: apresentação alterada foi aceita.'; end if;
end $$;
reset role;
update public.insumos set quantidade_embalagem=100 where especificacao='TS-ORD100-SKU';
update public.insumos set fator_conversao=50 where especificacao='TS-ORD100-SKU';
set local role authenticated;
select pg_temp.ator100('coordenador');
do $$
begin
  if public.ler_equivalencia_contextual_v1('TS-ORD100-A','metodo:M1:r1')->>'estado'
     is distinct from 'contexto_divergente' then raise exception '0154: fator alterado foi aceito.'; end if;
  perform public.revogar_equivalencia_contextual_v1(current_setting('ord100.decisao')::bigint,'Revisar fator');
  if public.ler_equivalencia_contextual_v1('TS-ORD100-A','metodo:M1:r1')#>>'{decisoes,0,estado}'
     is distinct from 'revogada' then raise exception '0154: revogação invisível.'; end if;
end $$;
select pg_temp.negada100('55000', $$select public.revogar_equivalencia_contextual_v1(current_setting('ord100.decisao')::bigint,'segunda')$$);
select pg_temp.reg100(jsonb_build_object('fator_conversao',50,'apresentacao_ref','apresentacao:sku:r2'));
select pg_temp.ator100('supervisor');
select pg_temp.reg100(jsonb_build_object('fator_conversao',50,'vigente_ate',clock_timestamp()+interval '1 day'),'metodo:M1:r2');

reset role;
-- Simula expiração sem esperar um dia, somente na fixture.
update kontrol_private.equivalencia_insumos_decisoes
set vigente_desde=now()-interval '2 days', vigente_ate=now()-interval '1 day'
where metodo_revisao_ref='metodo:M1:r2';
set local role authenticated;
select pg_temp.ator100('supervisor');
do $$
declare v jsonb := public.ler_equivalencia_contextual_v1('TS-ORD100-A','metodo:M1:r2');
begin
  if (v#>>'{decisoes,0,vigente_ate}')::numeric >= (v->>'instante')::numeric then
    raise exception '0154: relógio de vigência incompatível com v1.';
  end if;
  perform pg_temp.reg100(jsonb_build_object('fator_conversao',50),'metodo:M1:r2');
end $$;

reset role;
do $$
begin
  if not exists (select 1 from kontrol_private.equivalencia_insumos_decisoes
      where id=current_setting('ord100.decisao')::bigint and fator_conversao=100
        and ator_id=pg_temp.uid100('laboratorio') and revogada_por=pg_temp.uid100('coordenador'))
     or not exists (select 1 from public.orcamento_final_versoes
      where numero='TS-ORD100-v1' and snapshot='{"legado":{"fator":9,"valor":17}}'::jsonb)
     or current_setting('ord100.replay') is distinct from md5(pg_get_functiondef(
       'public.recalcular_orcamento_transacional(bigint,text,integer,text,jsonb,jsonb,uuid)'::regprocedure)) then
    raise exception '0154: trilha técnica, snapshot ou definição de replay não preservados.';
  end if;
end $$;
rollback;

-- Corrida em duas sessões após o setup opcional (fixture não executa isso
-- automaticamente). A, como dono do clone, BEGIN e adquire exatamente:
-- select pg_advisory_xact_lock(hashtextextended('equivalencia-v1:'||id,0))
-- from public.insumo_analise where codigo_analise='TS-ORD100-A' and etapa_id is not null;
-- B: BEGIN; SET LOCAL ROLE authenticated; usa os claims sintéticos de
-- Laboratório acima e chama registrar com o JSON de pg_temp.contexto100().
-- Esperado 55P03 enquanto A segura o lock. A: ROLLBACK. B: ROLLBACK e nova
-- transação idêntica, agora deve registrar uma vez; ROLLBACK e descartar clone.
