\set ON_ERROR_STOP on
-- ORD131. NÃO EXECUTADO na autoria. Só clone sintético descartável após 0154/0160.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '25s';
do $$
begin
  if exists (select 1 from auth.users)
     or exists (select 1 from public.analises where codigo like 'TS-ORD131-%')
     or exists (select 1 from kontrol_private.equivalencia_insumos_decisoes) then
    raise exception 'ORD131 exige clone sintético vazio.';
  end if;
end $$;
create function pg_temp.uid131(p text) returns uuid language sql immutable
as $$ select md5('ord131-ator-' || p)::uuid $$;
create function pg_temp.sid131(p text) returns uuid language sql immutable
as $$ select md5('ord131-sessao-' || p)::uuid $$;
create function pg_temp.ator131(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',pg_temp.uid131(p)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid131(p),
    'role','authenticated','session_id',pg_temp.sid131(p))::text,true);
end $$;
create function pg_temp.ler131() returns jsonb language sql as $$
  select public.ler_equivalencia_contexto_autorizado_v1('TS-ORD131-A','metodo:131:r1');
$$;
create function pg_temp.negar131(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when insufficient_privilege then return;
  end;
  raise exception 'ORD131: esperava 42501: %',p_sql;
end $$;
insert into auth.users(id,aud,role,email,created_at,updated_at)
select pg_temp.uid131(r),'authenticated','authenticated','ord131-'||r||'@example.invalid',now(),now()
from unnest(array['laboratorio','coordenador','supervisor','compra','admin','gestor','sem_sessao','suspenso','provisorio']) r;
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.sid131(r),pg_temp.uid131(r),now(),now()
from unnest(array['laboratorio','coordenador','supervisor','compra','admin','gestor','suspenso','provisorio']) r;
alter table public.perfis disable trigger kontrol_proteger_papel_perfil;
update public.perfis set suspenso=false,senha_provisoria=false;
update public.perfis p set papel=r
from unnest(array['coordenador','supervisor','compra','admin','gestor']) r where p.id=pg_temp.uid131(r);
alter table public.perfis enable trigger kontrol_proteger_papel_perfil;
update public.perfis set suspenso=true where id=pg_temp.uid131('suspenso');
update public.perfis set senha_provisoria=true where id=pg_temp.uid131('provisorio');
update public.permissoes_categorias set permissoes='{"analises.ver":true,"insumos.ver":true}'
where papel in ('laboratorio','coordenador','supervisor','compra','gestor');
insert into public.analises(codigo) values ('TS-ORD131-A'),('TS-ORD131-B');
insert into public.insumo_analise(codigo_analise,nome_etapa,nome_atividade,unidade,quantidade_por_amostra,modo_cobranca)
values ('TS-ORD131-A','Sem etapa','Mistura','reação',2,'por_amostra'),('TS-ORD131-B','Outra','Outra','ml',1,'por_amostra');
insert into public.insumos(especificacao,unidade,unidade_consumo,fator_conversao,quantidade_embalagem)
values ('TS-ORD131-SKU','frasco','reação',100,100),('TS-ORD131-FORA','frasco','ml',1,1);
insert into public.equipamentos(nome) values ('TS-ORD131-EA'),('TS-ORD131-EB');
insert into public.equipamento_analise(equipamento_id,codigo_analise,peso_alocacao)
select id,case nome when 'TS-ORD131-EA' then 'TS-ORD131-A' else 'TS-ORD131-B' end,1
from public.equipamentos where nome in ('TS-ORD131-EA','TS-ORD131-EB');
select set_config('ord131.escrita',md5(pg_get_functiondef(
  'kontrol_private.operar_equivalencia_v1(text,text,text,jsonb)'::regprocedure)),true);

set local role authenticated;
do $$
declare r text; v jsonb;
begin
  foreach r in array array['laboratorio','coordenador','supervisor','compra','admin','gestor'] loop
    perform pg_temp.ator131(r);
    v := pg_temp.ler131();
    if v->>'estado' is distinct from 'disponivel'
       or (v#>>'{capacidades,registrar}')::boolean is distinct from (r in ('laboratorio','coordenador','supervisor'))
       or (v#>>'{capacidades,revogar}')::boolean is distinct from (r in ('laboratorio','coordenador','supervisor'))
       or v->'cas_escrita' is distinct from 'false'::jsonb
       or v->'candidatos_sao_equivalencias' is distinct from 'false'::jsonb then
      raise exception 'ORD131: capacidade indevida para %: %',r,v;
    end if;
  end loop;
  foreach r in array array['sem_sessao','suspenso','provisorio'] loop
    perform pg_temp.ator131(r);
    perform pg_temp.negar131('select pg_temp.ler131()');
  end loop;
end $$;
select pg_temp.ator131('laboratorio');
do $$
declare v jsonb := pg_temp.ler131(); v_reg jsonb;
begin
  if jsonb_array_length(v->'necessidades') <> 1
     or jsonb_array_length(v#>'{necessidades,0,candidatos}') <> 1
     or v#>>'{necessidades,0,candidatos,0,especificacao}' is distinct from 'TS-ORD131-SKU'
     or jsonb_array_length(v->'equipamentos') <> 1
     or v#>>'{equipamentos,0,nome}' is distinct from 'TS-ORD131-EA'
     or v->'decisoes' is distinct from '[]'::jsonb then
    raise exception 'ORD131: contexto amplo, errado ou vazio falso.';
  end if;
  perform set_config('ord131.revisao',v->>'revisao_contexto',true);
  v_reg := public.registrar_equivalencia_contextual_v1('TS-ORD131-A','metodo:131:r1',jsonb_build_object(
    'necessidade_id',v#>'{necessidades,0,necessidade_id}','etapa_id',null,'equipamento_id',null,
    'insumo_id',v#>'{necessidades,0,candidatos,0,insumo_id}',
    'unidade_estoque','frasco','unidade_consumo','reação','fator_conversao',100,
    'apresentacao_ref','apresentacao:131:r1','evidencia_ref','laudo:131:r1','vigente_ate',null,'confirmada',true));
  v := pg_temp.ler131();
  if v->>'revisao_contexto' = current_setting('ord131.revisao')
     or v#>>'{decisoes,0,decisao_ref}' is distinct from v_reg->>'decisao_ref'
     or v#>'{decisoes,0,pode_revogar}' is distinct from 'true'::jsonb
     or (v->'decisoes'->0) ?| array['ator_id','revogada_por','contexto','motivo_revogacao','custo_unitario'] then
    raise exception 'ORD131: versão, autorização por identidade ou projeção incorreta.';
  end if;
  perform set_config('ord131.decisao',v_reg->>'decisao_ref',true);
  perform set_config('ord131.revisao',v->>'revisao_contexto',true);
end $$;
reset role;
update public.insumos set quantidade_embalagem=101 where especificacao='TS-ORD131-SKU';
set local role authenticated;
do $$
declare v jsonb := pg_temp.ler131();
begin
  if v->>'estado_validacoes' is distinct from 'contexto_divergente'
     or v->>'revisao_contexto' = current_setting('ord131.revisao')
     or v#>'{decisoes,0,pode_revogar}' is distinct from 'true'::jsonb then
    raise exception 'ORD131: drift ocultado ou impediu revogação permitida pela 0154.';
  end if;
  perform public.revogar_equivalencia_contextual_v1(split_part(current_setting('ord131.decisao'),':',2)::bigint,'Revisão sintética');
  if pg_temp.ler131()#>'{decisoes,0,pode_revogar}' is distinct from 'false'::jsonb then
    raise exception 'ORD131: revogação duplicada anunciada como disponível.';
  end if;
end $$;
reset role;
update public.permissoes_categorias set permissoes='{"analises.ver":true}' where papel='laboratorio';
set local role authenticated;
select pg_temp.negar131('select pg_temp.ler131()');
reset role;
update public.permissoes_categorias set permissoes='{"analises.ver":true,"insumos.ver":true}' where papel='laboratorio';

savepoint ord131_exec;
revoke execute on function public.registrar_equivalencia_contextual_v1(text,text,jsonb) from public,authenticated;
set local role authenticated;
do $$
begin
  if pg_temp.ler131()#>'{capacidades,registrar}' is distinct from 'false'::jsonb then
    raise exception 'ORD131: capacidade ignorou revogação de EXECUTE.';
  end if;
end $$;
reset role;
rollback to savepoint ord131_exec;
release savepoint ord131_exec;
savepoint ord131_usage;
revoke usage on schema public from public,authenticated;
set local role authenticated;
select pg_temp.negar131($$select kontrol_private.ler_equivalencia_contexto_autorizado_v1('TS-ORD131-A','metodo:131:r1')$$);
reset role;
rollback to savepoint ord131_usage;
release savepoint ord131_usage;
do $$
begin
  if has_function_privilege('anon','public.ler_equivalencia_contexto_autorizado_v1(text,text)','EXECUTE')
     or has_function_privilege('service_role','kontrol_private.ler_equivalencia_contexto_autorizado_v1(text,text)','EXECUTE')
     or current_setting('ord131.escrita') is distinct from md5(pg_get_functiondef(
       'kontrol_private.operar_equivalencia_v1(text,text,text,jsonb)'::regprocedure)) then
    raise exception 'ORD131: grant indevido ou escrita0154 alterada.';
  end if;
end $$;
rollback;
