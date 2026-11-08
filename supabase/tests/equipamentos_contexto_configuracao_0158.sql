\set ON_ERROR_STOP on
-- ORD129: NÃO EXECUTADA na autoria. Somente clone descartável após 0151/0153/0158.
-- Exige opt-in da sessão: kontrol.fixture_descartavel = ORD129. Tudo termina em rollback.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';
do $$ begin
  if current_setting('kontrol.fixture_descartavel', true) is distinct from 'ORD129'
    or exists(select 1 from auth.users) or exists(select 1 from public.perfis)
    or exists(select 1 from public.equipamento_unidades)
    or exists(select 1 from kontrol_private.equipamento_aviso_direitos)
    or exists(select 1 from kontrol_private.equipamento_aviso_regras)
    or exists(select 1 from kontrol_private.equipamento_aviso_eventos) then
    raise exception 'ORD129 exige clone sintético vazio e opt-in explícito.';
  end if;
end $$;

create function pg_temp.uuid129(p text) returns uuid language sql immutable
as $$ select md5('ord129-sintetico-' || p)::uuid $$;
create function pg_temp.ator129(p text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', pg_temp.uuid129('u-' || p)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',pg_temp.uuid129('u-' || p),
    'role','authenticated','session_id',pg_temp.uuid129('s-' || p))::text,true);
end $$;
create function pg_temp.id129(p text) returns bigint language sql stable
as $$ select current_setting('ord129.' || p)::bigint $$;
create function pg_temp.checar129(p boolean, mensagem text) returns void language plpgsql as $$ begin
  if p is distinct from true then raise exception 'ORD129: %', mensagem; end if;
end $$;
create function pg_temp.negar129(p_sql text, esperado text) returns void language plpgsql as $$ begin
  begin execute p_sql;
  exception when others then
    if sqlstate = esperado then return; end if;
    raise;
  end;
  raise exception 'ORD129: esperado SQLSTATE %', esperado;
end $$;
create function pg_temp.contexto129(p_apos bigint, p_responsavel uuid, p_limite integer)
returns jsonb language sql stable as $$
  select public.contexto_configuracao_aviso_equipamento(pg_temp.id129('unidade'),
    'calibracao',p_apos,p_responsavel,p_limite)
$$;

-- Fixtures isoladas: não configuram política real nem contas reais.
insert into auth.users(id,aud,role,email,created_at,updated_at)
select pg_temp.uuid129('u-' || p),'authenticated','authenticated',
  'ord129-' || p || '@example.invalid',now(),now()
from unnest(array['governanca','operador','leitor','oculto','suspenso','provisorio']) p;
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.uuid129('s-' || p),pg_temp.uuid129('u-' || p),now(),now()
from unnest(array['governanca','operador','leitor','oculto','suspenso','provisorio']) p;
alter table public.perfis disable trigger kontrol_proteger_papel_perfil;
update public.perfis set suspenso=false,senha_provisoria=false,nome='Mesmo rótulo';
update public.perfis set papel='admin' where id=pg_temp.uuid129('u-governanca');
update public.perfis set papel='compra' where id=pg_temp.uuid129('u-leitor');
update public.perfis set suspenso=true where id=pg_temp.uuid129('u-suspenso');
update public.perfis set senha_provisoria=true where id=pg_temp.uuid129('u-provisorio');
alter table public.perfis enable trigger kontrol_proteger_papel_perfil;
update public.permissoes_categorias set permissoes='{"estoque.ver":true}'
where papel in ('laboratorio','compra');

do $$ declare v_e bigint; v_u bigint; v_m bigint; begin
  insert into public.equipamentos(nome) values('ORD129-SINTETICO') returning id into v_e;
  insert into public.equipamento_unidades(equipamento_id,codigo_patrimonio)
    values(v_e,'ORD129-A') returning id into v_u;
  perform set_config('ord129.unidade',v_u::text,true);
  insert into public.equipamento_unidades(equipamento_id,codigo_patrimonio)
    values(v_e,'ORD129-OCULTA') returning id into v_m;
  perform set_config('ord129.unidade_oculta',v_m::text,true);
  insert into public.equipamento_manutencoes(equipamento_unidade_id,tipo,data_programada,proxima_data,status,descricao)
    values(v_u,'calibracao',date '2026-11-07',date '2026-11-10','agendada','ORD129-A') returning id into v_m;
  perform set_config('ord129.origem_a',v_m::text,true);
  insert into public.equipamento_manutencoes(equipamento_unidade_id,tipo,data_programada,proxima_data,status,descricao)
    values(v_u,'calibracao',date '2026-11-07',date '2026-11-11','agendada','ORD129-B') returning id into v_m;
  perform set_config('ord129.origem_b',v_m::text,true);
  insert into public.equipamento_manutencoes(equipamento_unidade_id,tipo,data_programada,proxima_data,status,descricao)
    values(v_u,'calibracao',date '2026-11-07',date '2026-11-12','agendada','ORD129-OCULTA'),
          (v_u,'calibracao',date '2026-11-07',date '2026-11-13','cancelada','ORD129-CANCELADA'),
          (v_u,'calibracao',date '2026-11-07',null,'agendada','ORD129-SEM-DATA');
end $$;
-- Restritivas só nesta transação descartável, para provar RLS do chamador.
create policy ord129_perfil_oculto on public.perfis as restrictive for select to authenticated
using (id <> md5('ord129-sintetico-u-oculto')::uuid);
create policy ord129_origem_oculta on public.equipamento_manutencoes as restrictive for select to authenticated
using (descricao is distinct from 'ORD129-OCULTA');
create policy ord129_unidade_oculta on public.equipamento_unidades as restrictive for select to authenticated
using (codigo_patrimonio <> 'ORD129-OCULTA');

-- ACL técnica mínima; não confundir EXECUTE com direito funcional.
select pg_temp.checar129(not has_schema_privilege('authenticated','kontrol_aviso_api','USAGE'),'schema privado fechado');
select pg_temp.checar129(not has_function_privilege('anon',
  'public.consultar_direito_aviso_equipamento(text,text)','EXECUTE'),'anon sem governança');
select pg_temp.checar129(not has_function_privilege('service_role',
  'public.contexto_configuracao_aviso_equipamento(bigint,text,bigint,uuid,integer)','EXECUTE'),'service_role sem RPC');

set local role authenticated;
select pg_temp.ator129('governanca');
select pg_temp.checar129(public.consultar_direito_aviso_equipamento('laboratorio','configurar') =
  '{"estado":"confirmado","papel":"laboratorio","operacao":"configurar","pode_governar":true,"concessao_esperada":false}'::jsonb,
  'ausência de concessão confirmada só para governança autorizada');
select pg_temp.negar129('select pg_temp.contexto129(null,null,10)','42501');
select pg_temp.negar129($q$select public.consultar_direito_aviso_equipamento('inventado','configurar')$q$,'22023');
select public.governar_direito_aviso_equipamento('laboratorio','configurar',false,true,
  'fixture ORD129',pg_temp.uuid129('grant-configurar'));
select pg_temp.checar129((public.consultar_direito_aviso_equipamento('laboratorio','configurar')->>'concessao_esperada')::boolean,
  'concessão atual true, não default');
select pg_temp.negar129($q$select public.governar_direito_aviso_equipamento('laboratorio','configurar',false,false,
  'CAS obsoleto',pg_temp.uuid129('cas-obsoleto'))$q$,'40001');

select pg_temp.ator129('leitor');
select pg_temp.negar129('select pg_temp.contexto129(null,null,10)','42501');
select pg_temp.negar129($q$select public.consultar_direito_aviso_equipamento('laboratorio','configurar')$q$,'42501');
select pg_temp.ator129('operador');
select pg_temp.negar129($q$select public.contexto_configuracao_aviso_equipamento(
  pg_temp.id129('unidade_oculta'),'calibracao',null,null,10)$q$,'42501');
select pg_temp.negar129('select pg_temp.contexto129(null,null,0)','22023');
select pg_temp.negar129('select pg_temp.contexto129(null,null,101)','22023');
select pg_temp.negar129('select pg_temp.contexto129(-1,null,10)','22023');

do $$ declare a jsonb; b jsonb; r jsonb; begin
  a := pg_temp.contexto129(null,null,1);
  perform pg_temp.checar129(a->>'versao_esperada'='0' and a#>>'{regra,estado}'='confirmada',
    'zero apenas sem regra confirmada');
  perform pg_temp.checar129(a#>'{permissoes}'=
    '{"configurar":true,"avaliar":false,"reconhecer":false,"encaminhar":false,"governar":false}'::jsonb,
    'direitos correntes sem inferência hierárquica');
  perform pg_temp.checar129(jsonb_array_length(a#>'{origens,itens}')=1
    and a#>>'{origens,itens,0,id}'=pg_temp.id129('origem_a')::text,'primeira página de origem');
  b := pg_temp.contexto129((a#>>'{origens,proximo_apos}')::bigint,
    (a#>>'{responsaveis,proximo_apos}')::uuid,1);
  perform pg_temp.checar129(b#>>'{origens,itens,0,id}'=pg_temp.id129('origem_b')::text
    and b#>'{origens,proximo_apos}'='null'::jsonb,'segunda página sem oculto/cancelado/sem data');
  perform pg_temp.checar129(a#>>'{responsaveis,itens,0,id}' <> b#>>'{responsaveis,itens,0,id}',
    'paginação por UUID, nomes iguais não duplicam identidade');
  r := pg_temp.contexto129(null,null,100);
  perform pg_temp.checar129(jsonb_array_length(r#>'{responsaveis,itens}')=4,
    'responsáveis visíveis não suspensos, sem exclusão extra por papel/senha provisória');
  perform pg_temp.checar129(not exists(select 1 from jsonb_array_elements(r#>'{responsaveis,itens}') p
    where p->>'id' in (pg_temp.uuid129('u-oculto')::text,pg_temp.uuid129('u-suspenso')::text)
      or p - 'id' - 'nome' <> '{}'::jsonb),'RLS de perfis e projeção mínima');
end $$;

select public.configurar_aviso_equipamento(pg_temp.id129('unidade'),'calibracao',0,pg_temp.id129('origem_a'),
  date '2026-11-10',0,pg_temp.uuid129('u-operador'),'fixture ORD129',pg_temp.uuid129('configurar'));
select pg_temp.checar129(pg_temp.contexto129(pg_temp.id129('origem_b'),null,1)->>'versao_esperada'='1',
  'versão vigente independe da página de candidatos');
reset role;
update public.equipamento_manutencoes set descricao='ORD129-OCULTA' where id=pg_temp.id129('origem_a');
-- Snapshot das tabelas privadas: as leituras seguintes não podem mutá-las.
select set_config('ord129.antes',jsonb_build_array(
  (select count(*) from kontrol_private.equipamento_aviso_eventos),
  (select count(*) from kontrol_private.equipamento_aviso_regras),
  (select count(*) from kontrol_private.equipamento_aviso_direitos))::text,true);
set local role authenticated;
select pg_temp.checar129(pg_temp.contexto129(null,null,10)->'regra'='{"estado":"indisponivel"}'::jsonb
  and pg_temp.contexto129(null,null,10)->'versao_esperada'='null'::jsonb,
  'origem oculta não revela regra nem inventa versão zero');
select pg_temp.ator129('suspenso');
select pg_temp.negar129('select pg_temp.contexto129(null,null,10)','42501');
select pg_temp.ator129('provisorio');
select pg_temp.negar129('select pg_temp.contexto129(null,null,10)','42501');
select pg_temp.ator129('operador');
reset role;
update auth.sessions set not_after=now()-interval '1 second' where id=pg_temp.uuid129('s-operador');
set local role authenticated;
select pg_temp.negar129('select pg_temp.contexto129(null,null,10)','42501');
reset role;
select pg_temp.checar129(current_setting('ord129.antes')::jsonb=jsonb_build_array(
  (select count(*) from kontrol_private.equipamento_aviso_eventos),
  (select count(*) from kontrol_private.equipamento_aviso_regras),
  (select count(*) from kontrol_private.equipamento_aviso_direitos)), 'leitura sem escrita privada');
set local role authenticated;
select pg_temp.ator129('governanca');
select public.governar_direito_aviso_equipamento('laboratorio','configurar',true,false,
  'revogação fixture ORD129',pg_temp.uuid129('revogar-configurar'));
select pg_temp.checar129(public.consultar_direito_aviso_equipamento('laboratorio','configurar')
  ->'concessao_esperada'='false'::jsonb,'revogação refletida na consulta atual');
reset role;
update auth.sessions set not_after=null where id=pg_temp.uuid129('s-operador');
set local role authenticated;
select pg_temp.ator129('operador');
select pg_temp.negar129('select pg_temp.contexto129(null,null,10)','42501');
reset role;
rollback;
