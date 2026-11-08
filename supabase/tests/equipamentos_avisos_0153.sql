\set ON_ERROR_STOP on
-- ORD99: somente clone descartável, sem seed ou usuários reais, após 0151/0153.
-- Por padrão nada fica gravado. Prova concorrente opcional no fim do arquivo.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';

do $$
begin
  if exists (select 1 from auth.users) or exists (select 1 from public.perfis)
     or exists (select 1 from public.equipamento_unidades)
     or exists (select 1 from kontrol_private.equipamento_aviso_direitos)
     or exists (select 1 from kontrol_private.equipamento_aviso_eventos) then
    raise exception 'ORD99 exige clone sintético vazio.';
  end if;
end $$;

create function pg_temp.uuid99(p text) returns uuid language sql immutable
as $$ select md5('ord99-sintetico-' || p)::uuid $$;
create function pg_temp.ator99(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.uuid99('u-' || p)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', pg_temp.uuid99('u-' || p), 'role', 'authenticated',
    'session_id', pg_temp.uuid99('s-' || p))::text, true);
end $$;
create function pg_temp.checar99(p boolean, p_msg text) returns void language plpgsql as $$
begin
  if p is distinct from true then raise exception 'ORD99: %', p_msg; end if;
end $$;
create function pg_temp.negar99(p_sql text, p_estado text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_estado then return; end if;
    raise;
  end;
  raise exception 'ORD99: era esperado SQLSTATE %: %', p_estado, p_sql;
end $$;

insert into auth.users(id,aud,role,email,created_at,updated_at)
select pg_temp.uuid99('u-' || p),'authenticated','authenticated','ord99-' || p || '@example.invalid',now(),now()
from unnest(array['governanca','operador','leitor','sem-estoque','sem-sessao','suspenso']) p;
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.uuid99('s-' || p),pg_temp.uuid99('u-' || p),now(),now()
from unnest(array['governanca','operador','leitor','sem-estoque','suspenso']) p;

-- Bootstrap somente destes perfis sintéticos, conforme fixture 0151.
alter table public.perfis disable trigger kontrol_proteger_papel_perfil;
update public.perfis set suspenso=false,senha_provisoria=false;
update public.perfis set papel='admin' where id=pg_temp.uuid99('u-governanca');
update public.perfis set papel='compra' where id=pg_temp.uuid99('u-leitor');
update public.perfis set papel='cadastro' where id=pg_temp.uuid99('u-sem-estoque');
update public.perfis set suspenso=true where id=pg_temp.uuid99('u-suspenso');
alter table public.perfis enable trigger kontrol_proteger_papel_perfil;
update public.permissoes_categorias set permissoes='{"estoque.ver":true}'
  where papel in ('laboratorio','compra');
update public.permissoes_categorias set permissoes='{}' where papel='cadastro';

create temp table ord99_ids(chave text primary key, id bigint not null) on commit drop;
grant select on table pg_temp.ord99_ids to authenticated;
create function pg_temp.id99(p text) returns bigint language sql stable
as $$ select id from pg_temp.ord99_ids where chave = p $$;
create function pg_temp.hoje99() returns date language sql stable
as $$ select timezone('America/Sao_Paulo', statement_timestamp())::date $$;
create function pg_temp.configurar99(p_versao integer, p_data date, p_dias integer, p_op text) returns jsonb
language sql as $$
  select public.configurar_aviso_equipamento(pg_temp.id99('ORD99-A'), 'calibracao', p_versao,
    pg_temp.id99('origem-a'), p_data, p_dias, pg_temp.uuid99('u-operador'), 'fixture', pg_temp.uuid99(p_op));
$$;
create function pg_temp.avaliar99(p_versao integer, p_op text) returns jsonb
language sql as $$
  select public.avaliar_aviso_equipamento(pg_temp.id99('ORD99-A'), 'calibracao', p_versao, pg_temp.uuid99(p_op));
$$;
create function pg_temp.contexto99() returns jsonb language sql stable as $$
  select c from jsonb_array_elements(public.contextos_avisos_equipamento(pg_temp.id99('ORD99-A'))) c
  where c ->> 'tipo' = 'calibracao';
$$;

with e as (insert into public.equipamentos(nome) values ('ORD99-SINTETICO') returning id),
u as (insert into public.equipamento_unidades(equipamento_id,codigo_patrimonio)
  select e.id, p from e cross join unnest(array['ORD99-A','ORD99-OCULTA','ORD99-VAZIA']) p
  returning id,codigo_patrimonio)
insert into pg_temp.ord99_ids select codigo_patrimonio,id from u;
with m as (
  insert into public.equipamento_manutencoes(equipamento_unidade_id,tipo,data_programada,proxima_data,status)
  values (pg_temp.id99('ORD99-A'),'calibracao',pg_temp.hoje99()-10,pg_temp.hoje99(),'agendada'),
         (pg_temp.id99('ORD99-OCULTA'),'calibracao',pg_temp.hoje99(),pg_temp.hoje99(),'agendada')
  returning id,equipamento_unidade_id
)
insert into pg_temp.ord99_ids
select case when equipamento_unidade_id=pg_temp.id99('ORD99-A') then 'origem-a' else 'origem-oculta' end,id from m;
with m as (
  insert into public.equipamento_manutencoes(equipamento_unidade_id,tipo,data_programada,proxima_data,status,descricao)
  values (pg_temp.id99('ORD99-A'),'preventiva',pg_temp.hoje99(),pg_temp.hoje99(),'agendada','ORD114-ORIGEM-OCULTA')
  returning id
)
insert into pg_temp.ord99_ids select 'origem-oculta-mesma-unidade',id from m;
create policy ord99_unidade_oculta on public.equipamento_unidades as restrictive for select to authenticated
  using (codigo_patrimonio is distinct from 'ORD99-OCULTA');
create policy ord114_origem_oculta on public.equipamento_manutencoes as restrictive for select to authenticated
  using (descricao is distinct from 'ORD114-ORIGEM-OCULTA');

select pg_temp.checar99(not has_function_privilege('anon','public.contextos_avisos_equipamento(bigint)','EXECUTE')
  and not has_function_privilege('service_role','public.contextos_avisos_equipamento(bigint)','EXECUTE')
  and not has_schema_privilege('authenticated','kontrol_aviso_api','USAGE')
  and not has_table_privilege('authenticated','kontrol_private.equipamento_avisos','INSERT'),
  'ACL mínima do resumo, núcleo e tabelas');
select pg_temp.checar99((select count(*)=4 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='kontrol_private' and c.relrowsecurity and c.relname in
  ('equipamento_aviso_direitos','equipamento_aviso_regras','equipamento_avisos','equipamento_aviso_eventos')),
  'RLS nas quatro tabelas');

set local role authenticated;
select pg_temp.ator99('operador');
select pg_temp.checar99(pg_temp.contexto99() #> '{regra,dado}' = 'null'::jsonb
  and pg_temp.contexto99() #> '{avisos,dado}' = '[]'::jsonb
  and pg_temp.contexto99() #>> '{permissoes,configurar}' = 'false', 'sem configuração e sem direito inicial');
select pg_temp.checar99(public.contextos_avisos_equipamento(pg_temp.id99('ORD99-VAZIA')) = '[]',
  'unidade visível sem contexto confirma vazio');
select pg_temp.negar99('select public.contextos_avisos_equipamento(pg_temp.id99(''ORD99-OCULTA''))','42501');
select pg_temp.negar99('select kontrol_aviso_api.ler_contextos_avisos(pg_temp.id99(''ORD99-A''),''[]''::jsonb)','42501');
select pg_temp.negar99('select * from kontrol_private.equipamento_avisos','42501');
select pg_temp.negar99('delete from kontrol_private.equipamento_aviso_eventos','42501');
select pg_temp.negar99('select pg_temp.configurar99(0,pg_temp.hoje99(),0,''sem-concessao'')','42501');
select pg_temp.negar99($sql$select public.governar_direito_aviso_equipamento(
  'laboratorio','configurar',false,true,'nega escopo',pg_temp.uuid99('governanca-negada'))$sql$,'42501');
select pg_temp.ator99('sem-estoque');
select pg_temp.negar99('select pg_temp.contexto99()','42501');
select pg_temp.ator99('sem-sessao');
select pg_temp.negar99('select pg_temp.contexto99()','42501');
select pg_temp.ator99('suspenso');
select pg_temp.negar99('select pg_temp.contexto99()','42501');

select pg_temp.ator99('governanca');
select pg_temp.negar99('select pg_temp.configurar99(0,pg_temp.hoje99(),0,''admin-sem-concessao'')','42501');
do $$
declare
  v_acao text;
  v_resultado jsonb;
begin
  foreach v_acao in array array['configurar','avaliar','reconhecer','encaminhar'] loop
    v_resultado := public.governar_direito_aviso_equipamento(
      'laboratorio',v_acao,false,true,'apenas fixture',pg_temp.uuid99('grant-' || v_acao));
    perform pg_temp.checar99(v_resultado ->> 'estado' = 'direito_registrado'
      and v_resultado ->> 'concedido' = 'true','governança por função');
  end loop;
end $$;
reset role;

\if :{?ord99_corrida_setup}
-- Somente num segundo clone descartável dedicado à prova com duas sessões.
commit;
\quit
\endif

set local role authenticated;
select pg_temp.ator99('leitor');
select pg_temp.checar99(pg_temp.contexto99() #>> '{permissoes,configurar}' = 'false',
  'leitura não herda o direito de outra função');
select pg_temp.negar99('select pg_temp.avaliar99(0,''leitor-negado'')','42501');
select pg_temp.ator99('operador');
select pg_temp.checar99(pg_temp.avaliar99(0,'sem-config') = '{"estado":"nao_configurado"}',
  'avaliação explícita sem configuração');
select pg_temp.negar99('select pg_temp.configurar99(0,pg_temp.hoje99(),null,''sem-antecedencia'')','22023');
select pg_temp.negar99($sql$select public.configurar_aviso_equipamento(pg_temp.id99('ORD99-A'),'calibracao',0,
  pg_temp.id99('origem-oculta'),pg_temp.hoje99(),0,pg_temp.uuid99('u-operador'),'fixture',
  pg_temp.uuid99('origem-errada'))$sql$,'42501');
select pg_temp.checar99(exists (select 1 from public.equipamento_unidades where id=pg_temp.id99('ORD99-A'))
  and not exists (select 1 from public.equipamento_manutencoes where id=pg_temp.id99('origem-oculta-mesma-unidade'))
  and not exists (select 1 from jsonb_array_elements(public.contextos_avisos_equipamento(pg_temp.id99('ORD99-A'))) c
    where c ->> 'tipo' = 'preventiva')
  and pg_temp.contexto99() ->> 'tipo' = 'calibracao',
  'unidade visível: o resumo só descobre o tipo de ocorrência visível');
select pg_temp.negar99($sql$select public.configurar_aviso_equipamento(pg_temp.id99('ORD99-A'),'preventiva',0,
  pg_temp.id99('origem-oculta-mesma-unidade'),pg_temp.hoje99(),0,pg_temp.uuid99('u-operador'),'fixture',
  pg_temp.uuid99('cfg-rls-negada'))$sql$,'42501');

do $$
declare
  v_config jsonb;
begin
  v_config := pg_temp.configurar99(0,pg_temp.hoje99(),0,'cfg-1');
  perform pg_temp.checar99(v_config ->> 'estado' = 'configurada' and v_config ->> 'versao' = '1'
    and v_config ->> 'antecedencia_dias' = '0','zero explícito e primeira versão');
  perform pg_temp.checar99(pg_temp.configurar99(0,pg_temp.hoje99(),0,'cfg-1') = v_config,'replay de configuração');
  perform pg_temp.checar99(pg_temp.contexto99() #> '{avisos,dado}' = '[]','leitura não abre');
end $$;

-- Ocultar a origem da regra válida sem ocultar a unidade nem cancelar a fonte.
reset role;
update public.equipamento_manutencoes set descricao='ORD114-ORIGEM-OCULTA' where id=pg_temp.id99('origem-a');
set local role authenticated;
select pg_temp.checar99(pg_temp.contexto99() -> 'origem' = '{"estado":"indisponivel"}'
  and pg_temp.contexto99() -> 'regra' = '{"estado":"indisponivel"}'
  and pg_temp.contexto99() #> '{avisos,dado}' = '[]',
  'sem projeção de origem ou referência da regra quando a fonte fica oculta');
select pg_temp.negar99('select pg_temp.avaliar99(1,''avaliar-rls-negada'')','42501');
select pg_temp.negar99('select pg_temp.configurar99(0,pg_temp.hoje99(),0,''cfg-1'')','42501');
reset role;
select pg_temp.checar99((select count(*)=1 from kontrol_private.equipamento_aviso_regras)
  and not exists (select 1 from kontrol_private.equipamento_avisos)
  and not exists (select 1 from kontrol_private.equipamento_aviso_eventos where operacao_id in
    (pg_temp.uuid99('cfg-rls-negada'),pg_temp.uuid99('avaliar-rls-negada'))),
  'RLS da origem não permite gravar regra, aviso ou evento');
update public.equipamento_manutencoes set descricao=null where id=pg_temp.id99('origem-a');
set local role authenticated;
select pg_temp.checar99(pg_temp.contexto99() #>> '{origem,dado,id}' = pg_temp.id99('origem-a')::text,
  'origem visível continua projetada');
do $$
declare
  v_abertura jsonb;
  v_reenvio jsonb;
begin
  v_abertura := pg_temp.avaliar99(1,'abrir-1');
  perform pg_temp.checar99(v_abertura ->> 'estado' = 'aberto','abre no dia de referência com zero');
  perform pg_temp.checar99(pg_temp.avaliar99(1,'abrir-1') = v_abertura,'replay de abertura');
  v_reenvio := pg_temp.avaliar99(1,'abrir-2');
  perform pg_temp.checar99(v_reenvio ->> 'estado' = 'ja_existente'
    and v_reenvio -> 'aviso_id' = v_abertura -> 'aviso_id','dedupe com outra chave');
end $$;
select pg_temp.negar99('select pg_temp.configurar99(0,pg_temp.hoje99(),1,''cfg-1'')','40001');
select pg_temp.negar99('select pg_temp.configurar99(0,pg_temp.hoje99(),0,''cfg-cas-velho'')','40001');

reset role;
update public.equipamento_manutencoes set descricao='ORD114-ORIGEM-OCULTA',proxima_data=pg_temp.hoje99()+1
  where id=pg_temp.id99('origem-a');
set local role authenticated;
select pg_temp.checar99(pg_temp.contexto99() -> 'origem' = '{"estado":"indisponivel"}'
  and pg_temp.contexto99() #>> '{avisos,dado,0,estado}' = 'pendente'
  and pg_temp.contexto99() #>> '{avisos,dado,0,data_referencia}' = pg_temp.hoje99()::text,
  'histórico autorizado preserva só a referência capturada, não a data atual oculta');
select pg_temp.negar99('select pg_temp.configurar99(0,pg_temp.hoje99(),0,''cfg-1'')','42501');
select pg_temp.negar99('select pg_temp.avaliar99(1,''abrir-1'')','42501');
select pg_temp.negar99('select pg_temp.avaliar99(1,''abrir-2'')','42501');
reset role;
select pg_temp.checar99((select count(*)=1 from kontrol_private.equipamento_aviso_regras)
  and (select count(*)=1 from kontrol_private.equipamento_avisos)
  and (select count(*)=3 from kontrol_private.equipamento_aviso_eventos where operacao_id in
    (pg_temp.uuid99('cfg-1'),pg_temp.uuid99('abrir-1'),pg_temp.uuid99('abrir-2'))),
  'perda de visibilidade nega replay sem acrescentar regra, aviso ou evento');
update public.equipamento_manutencoes set descricao=null where id=pg_temp.id99('origem-a');
set local role authenticated;
select pg_temp.checar99(pg_temp.avaliar99(1,'abrir-1') ->> 'estado' = 'aberto',
  'origem novamente visível permite só o replay original, sem recalcular abertura');
select pg_temp.checar99(pg_temp.avaliar99(1,'origem-mudou')
  = '{"estado":"referencia_alterada","motivo":"proxima_data_alterada"}', 'mudança bloqueia nova abertura');
select pg_temp.checar99(pg_temp.contexto99() #>> '{avisos,dado,0,estado}' = 'pendente'
  and pg_temp.contexto99() #>> '{avisos,dado,0,data_referencia}' = pg_temp.hoje99()::text,
  'aviso anterior congelado');
select pg_temp.checar99(pg_temp.configurar99(1,pg_temp.hoje99()+1,0,'cfg-2') ->> 'versao' = '2',
  'revisão acrescenta nova versão');
select pg_temp.checar99(pg_temp.avaliar99(2,'fora') ->> 'estado' = 'fora_janela','zero não abre um dia antes');
reset role;
update public.equipamento_manutencoes set status='cancelada' where id=pg_temp.id99('origem-a');
set local role authenticated;
select pg_temp.checar99(pg_temp.avaliar99(2,'cancelada')
  = '{"estado":"referencia_alterada","motivo":"origem_cancelada"}','ocorrência cancelada não abre');
select pg_temp.negar99('select pg_temp.configurar99(2,pg_temp.hoje99()+1,0,''cfg-cancelada'')','40001');

select pg_temp.checar99(public.reconhecer_aviso_equipamento(pg_temp.id99('ORD99-A'),'calibracao',
  (pg_temp.contexto99() #>> '{avisos,dado,0,id}')::uuid,'pendente','fixture',pg_temp.uuid99('rec'))
  ->> 'estado' = 'reconhecido','reconhecer não fecha');
select pg_temp.checar99(pg_temp.contexto99() #>> '{avisos,dado,0,estado}' = 'reconhecido',
  'reconhecido ainda consultável');
reset role;
create function pg_temp.falhar_evento99() returns trigger language plpgsql as $$
begin
  if new.operacao_id = pg_temp.uuid99('falha-evento') then
    raise exception 'Falha sintética de trilha.' using errcode = 'P9901';
  end if;
  return new;
end $$;
create trigger ord99_falha_evento before insert on kontrol_private.equipamento_aviso_eventos
  for each row execute function pg_temp.falhar_evento99();
set local role authenticated;
select pg_temp.negar99($sql$select public.encaminhar_aviso_equipamento(pg_temp.id99('ORD99-A'),'calibracao',
  (pg_temp.contexto99() #>> '{avisos,dado,0,id}')::uuid,'reconhecido','fixture','destino sintético',
  pg_temp.uuid99('falha-evento'))$sql$,'P9901');
select pg_temp.checar99(pg_temp.contexto99() #>> '{avisos,dado,0,estado}' = 'reconhecido',
  'falha da trilha reverte estado');
do $$
declare
  v_id uuid := (pg_temp.contexto99() #>> '{avisos,dado,0,id}')::uuid;
  v_res jsonb;
begin
  v_res := public.encaminhar_aviso_equipamento(pg_temp.id99('ORD99-A'),'calibracao',v_id,
    'reconhecido','fixture','destino sintético',pg_temp.uuid99('enc'));
  perform pg_temp.checar99(v_res ->> 'estado' = 'encaminhado' and v_res ->> 'estado_anterior' = 'reconhecido',
    'encaminhamento explícito com CAS');
  perform pg_temp.checar99(public.encaminhar_aviso_equipamento(pg_temp.id99('ORD99-A'),'calibracao',v_id,
    'reconhecido','fixture','destino sintético',pg_temp.uuid99('enc')) = v_res, 'replay de encaminhamento');
  perform pg_temp.negar99(format($sql$select public.encaminhar_aviso_equipamento(%s,'calibracao',%L::uuid,
    'reconhecido','fixture','outro destino',%L::uuid)$sql$,pg_temp.id99('ORD99-A'),v_id,pg_temp.uuid99('enc')),'40001');
  perform pg_temp.negar99(format($sql$select public.encaminhar_aviso_equipamento(%s,'calibracao',%L::uuid,
    'reconhecido','fixture','destino sintético',%L::uuid)$sql$,pg_temp.id99('ORD99-A'),v_id,pg_temp.uuid99('enc-cas')),'40001');
end $$;
select pg_temp.checar99(pg_temp.contexto99() #>> '{avisos,dado,0,estado}' = 'encaminhado'
  and pg_temp.contexto99() #>> '{avisos,dado,0,responsavel_id}' = pg_temp.uuid99('u-operador')::text,
  'encaminhado não desaparece e mantém responsável');

reset role;
select pg_temp.checar99((select count(*)=1 from kontrol_private.equipamento_avisos)
  and (select count(*)=2 from kontrol_private.equipamento_aviso_regras)
  and (select count(*)=1 from kontrol_private.equipamento_aviso_eventos where resultado ->> 'estado'='aberto')
  and (select count(*)=1 from kontrol_private.equipamento_aviso_eventos
    where acao='encaminhar' and ator_id=pg_temp.uuid99('u-operador')
    and payload #>> '{dados,destino}'='destino sintético')
  and not exists (select 1 from kontrol_private.equipamento_aviso_eventos
    where operacao_id=pg_temp.uuid99('falha-evento')),
  'unicidade, trilha, autoria e rollback');
select pg_temp.negar99('update kontrol_private.equipamento_aviso_eventos set ator_id=ator_id','42501');
select pg_temp.negar99('delete from kontrol_private.equipamento_aviso_regras','42501');
select pg_temp.checar99((select status='cancelada' and data_conclusao is null
  from public.equipamento_manutencoes where id=pg_temp.id99('origem-a'))
  and (select status_operacional='operacional' from public.equipamento_unidades where id=pg_temp.id99('ORD99-A')),
  'encaminhar não resolve manutenção nem bloqueia equipamento');

update public.equipamento_manutencoes set status='agendada',proxima_data=pg_temp.hoje99()
  where id=pg_temp.id99('origem-a');
set local role authenticated;
select pg_temp.ator99('operador');
select pg_temp.checar99(pg_temp.configurar99(2,pg_temp.hoje99(),0,'cfg-3') ->> 'versao' = '3',
  'nova versão do mesmo ciclo');
do $$
declare
  v_res jsonb := pg_temp.avaliar99(3,'mesmo-ciclo');
begin
  perform pg_temp.checar99(v_res ->> 'estado' = 'ja_existente'
    and v_res ->> 'estado_atual' = 'encaminhado'
    and v_res ->> 'regra_id' = pg_temp.contexto99() #>> '{avisos,dado,0,regra_id}'
    and v_res ->> 'regra_id' <> pg_temp.contexto99() #>> '{regra,dado,id}',
    'revisão não reabre nem sobrescreve a versão do aviso');
end $$;
select pg_temp.ator99('governanca');
select pg_temp.checar99(public.governar_direito_aviso_equipamento(
  'laboratorio','avaliar',true,false,'revogação sintética',pg_temp.uuid99('revogar-avaliar'))
  ->> 'concedido' = 'false','revogação explícita');
select pg_temp.ator99('operador');
select pg_temp.negar99('select pg_temp.avaliar99(3,''mesmo-ciclo'')','42501');
select pg_temp.checar99(pg_temp.contexto99() #>> '{avisos,dado,0,estado}' = 'encaminhado',
  'revogar mutação não apaga nem oculta histórico do leitor autorizado');
reset role;
rollback;

-- Concorrência, manual e NÃO executada pela ORD99:
-- 1. Em clone separado, executar este arquivo com -v ord99_corrida_setup=1.
-- 2. A e B: obter a unidade pelo patrimônio ORD99-A, sua ocorrência calibracao,
--    e IDs sintéticos md5('ord99-sintetico-u-operador')::uuid e
--    md5('ord99-sintetico-s-operador')::uuid. BEGIN READ COMMITTED;
--    SET LOCAL ROLE authenticated; definir request.jwt.claim.sub e
--    request.jwt.claims (sub, role=authenticated, session_id) como ator99.
-- 3. A configura com versão 0, ocorrência explícita, data hoje SP, dias 0,
--    motivo fixture, UUID C; antes de A COMMIT, B tenta mesma chamada/UUID C.
--    B deve aguardar e receber o JSON original. Repetir em clone limpo com
--    chaves distintas: B recebe 40001, uma única versão persistida.
-- 4. Após a versão 1, A avalia com UUID X. B avalia com UUID Y antes de A
--    COMMIT: B espera e recebe ja_existente com mesmo aviso_id. Conferir uma
--    instância e um evento aberto. Em duas sessões com o mesmo estado esperado,
--    reconhecer/encaminhar concorrentes: uma transição e 40001 na perdedora.
-- 5. Encerrar ambas as sessões; não reaproveitar o clone da prova concorrente.
