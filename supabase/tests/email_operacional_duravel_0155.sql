\set ON_ERROR_STOP on
-- ORD109: apenas clone PostgreSQL sintético vazio, após a 0155. Zero HTTP/POST.
-- A disputa abaixo simula dois candidatos em sequência; corrida real requer duas sessões.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '25s';

do $$
begin
  if exists (select 1 from auth.users) or exists (select 1 from public.notificacoes)
     or exists (select 1 from kontrol_private.email_operacional_v1) then
    raise exception '0155: fixture exige clone sintético vazio.';
  end if;
end $$;

create function pg_temp.uid109(p text) returns uuid language sql immutable
as $$ select md5('ord109-usuario-' || p)::uuid $$;
create function pg_temp.op109(p integer) returns uuid language sql immutable
as $$ select md5('ord109-operacao-' || p)::uuid $$;
create function pg_temp.payload109(p integer) returns text language sql immutable as $$
  select format(' { "to": ["ord109-a@example.invalid"], "from": "ord109@example.invalid", "subject": "[Kontrol] ORD109-%s", "html": "Confirmação sintética" } ', p)
$$;
create function pg_temp.exigir109(p_ok boolean, p_caso text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception '0155: %', p_caso; end if;
end $$;

do $$
declare
  v_rpc text;
  v_papel text;
  v_tabela constant text := 'kontrol_private.email_operacional_v1';
  v_projecao constant text := 'public.meus_estados_email_operacional_v1(bigint[])';
begin
  foreach v_rpc in array array[
    'public.listar_email_operacional_v1(integer)',
    'public.iniciar_post_email_operacional_v1(bigint,bigint,uuid,text)',
    'public.registrar_resultado_email_operacional_v1(bigint,bigint,uuid,bigint,text,integer,uuid)'
  ] loop
    perform pg_temp.exigir109(has_function_privilege('service_role', v_rpc, 'EXECUTE')
      and not has_function_privilege('authenticated', v_rpc, 'EXECUTE')
      and not has_function_privilege('anon', v_rpc, 'EXECUTE'), 'ACL transporte: ' || v_rpc);
  end loop;
  perform pg_temp.exigir109(has_function_privilege('authenticated', v_projecao, 'EXECUTE')
    and not has_function_privilege('anon', v_projecao, 'EXECUTE')
    and not has_function_privilege('service_role', v_projecao, 'EXECUTE'), 'ACL projeção');
  foreach v_papel in array array['authenticated','anon','service_role'] loop
    perform pg_temp.exigir109(not has_table_privilege(v_papel, v_tabela, 'INSERT, UPDATE, DELETE, TRUNCATE')
      and not has_any_column_privilege(v_papel, v_tabela, 'INSERT, UPDATE')
      and not has_column_privilege(v_papel, v_tabela, 'payload', 'SELECT')
      and not has_column_privilege(v_papel, v_tabela, 'operacao_id', 'SELECT')
      and not has_column_privilege(v_papel, v_tabela, 'id_provedor', 'SELECT'), 'ACL tabela: ' || v_papel);
  end loop;
end $$;

insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
select pg_temp.uid109(p), 'authenticated', 'authenticated', 'ord109-' || p || '@example.invalid',
  '{"cadastrado_pelo_admin":true}'::jsonb, now(), now()
from unnest(array['a','b']) p;

-- Legado anterior à 0155: com e sem marcador, ambos fora da fila nova.
alter table public.notificacoes disable trigger enfileirar_email_operacional_v1;
insert into public.notificacoes(id,tipo,titulo,usuario_destino,email_enviado_em) overriding system value
values (155001,'sistema','ORD109-155001',pg_temp.uid109('a'),null),
       (155002,'sistema','ORD109-155002',pg_temp.uid109('a'),now());
alter table public.notificacoes enable trigger enfileirar_email_operacional_v1;

insert into public.notificacoes(id,tipo,titulo,usuario_destino) overriding system value
select id, 'sistema', 'ORD109-' || id, pg_temp.uid109(case when id = 155008 then 'b' else 'a' end)
from generate_series(155003,155011) id;
insert into public.notificacoes_leituras(notificacao_id,user_id,arquivada_em)
values (155009,pg_temp.uid109('a'),now());

create function pg_temp.falha_marcador109() returns trigger language plpgsql as $$
begin
  raise exception '0155: falha sintética do marcador';
end $$;
create trigger ord109_falha_marcador before update of email_enviado_em on public.notificacoes
for each row when (old.id = 155004) execute function pg_temp.falha_marcador109();

set local role service_role;
do $$
declare
  v_fila jsonb := public.listar_email_operacional_v1(20);
  v_claim jsonb;
  v_resultado jsonb;
  v_id integer;
  v_provedor constant uuid := pg_temp.op109(900);
begin
  perform pg_temp.exigir109(jsonb_array_length(v_fila) = 9 and not exists (
    select 1 from jsonb_array_elements(v_fila) j
    where (j->>'id')::bigint not between 155003 and 155011
      or j->>'versao' is distinct from '1'
      or j ?| array['usuario_destino','papel_destino','permissao_destino','canal']
  ), 'candidatos novos, sem legado e sem campos de destino');
  perform pg_temp.exigir109((public.iniciar_post_email_operacional_v1(155001,1,pg_temp.op109(1),
    pg_temp.payload109(155001))->>'autorizou_post') = 'false', 'legado sem autorização');
  perform pg_temp.exigir109((public.iniciar_post_email_operacional_v1(155003,1,pg_temp.op109(99),
    replace(pg_temp.payload109(155003), 'ord109-a@', 'ord109-b@'))->>'autorizou_post') = 'false', 'destino trocado');

  for v_id in 155003..155007 loop
    v_claim := public.iniciar_post_email_operacional_v1(v_id,1,pg_temp.op109(v_id),pg_temp.payload109(v_id));
    perform pg_temp.exigir109(v_claim @> jsonb_build_object('autorizou_post',true,'notificacao_id',v_id,
      'versao',1,'operacao_id',pg_temp.op109(v_id),'geracao',1,'estado','POST_INICIADO',
      'payload_sha256',encode(sha256(convert_to(pg_temp.payload109(v_id),'UTF8')),'hex'))
      and (v_claim->>'lease_ate')::timestamptz > clock_timestamp()
      and nullif(v_claim->>'chave_idempotencia','') is not null, 'claim com correlação, lease e hash dos bytes');
  end loop;
  perform pg_temp.exigir109((public.iniciar_post_email_operacional_v1(155003,1,pg_temp.op109(155003),
    btrim(pg_temp.payload109(155003)))->>'autorizou_post') = 'false', 'replay não altera envelope');
  perform pg_temp.exigir109((public.iniciar_post_email_operacional_v1(155003,1,pg_temp.op109(901),
    pg_temp.payload109(155003))->>'autorizou_post') = 'false', 'segundo candidato não autoriza');
  perform pg_temp.exigir109((public.iniciar_post_email_operacional_v1(155010,1,pg_temp.op109(155003),
    pg_temp.payload109(155010))->>'autorizou_post') = 'false', 'UUID não reutilizável em outro aviso');

  begin
    perform public.registrar_resultado_email_operacional_v1(155003,1,pg_temp.op109(901),1,'ACEITO',202,v_provedor);
    raise exception '0155: operação incorreta aceita';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.registrar_resultado_email_operacional_v1(155003,1,pg_temp.op109(155003),2,'ACEITO',202,v_provedor);
    raise exception '0155: geração incorreta aceita';
  exception when invalid_parameter_value then null;
  end;

  v_resultado := public.registrar_resultado_email_operacional_v1(155003,1,pg_temp.op109(155003),1,'ACEITO',202,v_provedor);
  perform pg_temp.exigir109(v_resultado @> jsonb_build_object('estado','ACEITE_REGISTRADO','marcador_confirmado',true,
    'notificacao_id',155003,'versao',1,'operacao_id',pg_temp.op109(155003),'geracao',1), 'aceite e marcador');
  perform pg_temp.exigir109(v_resultado = public.registrar_resultado_email_operacional_v1(
    155003,1,pg_temp.op109(155003),1,'ACEITO',202,v_provedor), 'replay idêntico do resultado');
  begin
    perform public.registrar_resultado_email_operacional_v1(155003,1,pg_temp.op109(155003),1,'ACEITO',201,v_provedor);
    raise exception '0155: resultado conflitante aceito';
  exception when serialization_failure then null;
  end;

  perform pg_temp.exigir109(public.registrar_resultado_email_operacional_v1(155004,1,pg_temp.op109(155004),1,
    'ACEITO',202,v_provedor) @> '{"estado":"ACEITO_MARCADOR_PENDENTE","marcador_confirmado":false}', 'aceite sem marcador');
  perform pg_temp.exigir109(public.registrar_resultado_email_operacional_v1(155005,1,pg_temp.op109(155005),1,
    'INCERTO',null,null) @> '{"estado":"INCERTO","marcador_confirmado":false}', 'timeout');
  perform pg_temp.exigir109(public.registrar_resultado_email_operacional_v1(155006,1,pg_temp.op109(155006),1,
    'REVISAO_NECESSARIA',409,null) @> '{"estado":"REVISAO_NECESSARIA","marcador_confirmado":false}', 'conflito HTTP');
  perform pg_temp.exigir109((public.iniciar_post_email_operacional_v1(155011,1,pg_temp.op109(155011),
    pg_temp.payload109(155011))->>'autorizou_post') = 'true', 'reserva anterior ao rollback de resultado');
end $$;

savepoint ord109_resultado;
select pg_temp.exigir109(public.registrar_resultado_email_operacional_v1(155011,1,pg_temp.op109(155011),1,
  'ACEITO',202,pg_temp.op109(900)) @> '{"estado":"ACEITE_REGISTRADO"}', 'marcador antes do rollback');
rollback to savepoint ord109_resultado;
reset role;

select pg_temp.exigir109((select estado = 'POST_INICIADO' and resultado is null
  from kontrol_private.email_operacional_v1 where notificacao_id = 155011)
  and (select email_enviado_em is null and email_tentativas = 0 from public.notificacoes where id = 155011),
  'rollback restaura resultado e marcador, sem apagar autorização anterior');
select pg_temp.exigir109((select convert_to(payload,'UTF8') = convert_to(pg_temp.payload109(155003),'UTF8')
  from kontrol_private.email_operacional_v1 where notificacao_id = 155003)
  and (select email_enviado_em is not null and email_tentativas = 1 from public.notificacoes where id = 155003),
  'bytes imutados e replay sem novo marcador');
select pg_temp.exigir109((select estado = 'ACEITO_MARCADOR_PENDENTE' and resultado = 'ACEITO'
  and id_provedor = pg_temp.op109(900) from kontrol_private.email_operacional_v1 where notificacao_id = 155004)
  and (select email_enviado_em is null and email_tentativas = 0 from public.notificacoes where id = 155004),
  'falha do marcador preserva aceite durável');

-- Somente o proprietário da fixture sintetiza tempo vencido. Nenhum RPC o rearma.
update kontrol_private.email_operacional_v1
set post_iniciado_em = clock_timestamp() - interval '120 seconds', lease_ate = clock_timestamp() - interval '60 seconds'
where notificacao_id = 155007;

set local role service_role;
do $$
declare v_id integer;
begin
  foreach v_id in array array[155004,155005,155006,155007,155011] loop
    perform pg_temp.exigir109((public.iniciar_post_email_operacional_v1(v_id,1,pg_temp.op109(902),
      pg_temp.payload109(v_id))->>'autorizou_post') = 'false', 'sem reautorizar após resultado, expiração ou rollback');
  end loop;
  perform pg_temp.exigir109(not exists (select 1 from jsonb_array_elements(public.listar_email_operacional_v1(20)) j
    where (j->>'id')::integer not in (155008,155009,155010)), 'estado incerto não retorna à fila');
  begin
    perform public.registrar_resultado_email_operacional_v1(155007,1,pg_temp.op109(155007),1,'ACEITO',202,null);
    raise exception '0155: posse expirada aceita';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.uid109('a')::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid109('a'),'role','authenticated')::text,true);
do $$
declare
  v_resultado jsonb := public.meus_estados_email_operacional_v1(
    array[155001,155002,155003,155004,155005,155006,155007,155008,155009,155010,155010]::bigint[]);
  v_esperado constant jsonb := '[
    {"notificacao_id":155001,"estado":"REVISAO_NECESSARIA"},
    {"notificacao_id":155002,"estado":"ACEITE_REGISTRADO"},
    {"notificacao_id":155003,"estado":"ACEITE_REGISTRADO"},
    {"notificacao_id":155004,"estado":"ACEITO_MARCADOR_PENDENTE"},
    {"notificacao_id":155005,"estado":"INCERTO"},
    {"notificacao_id":155006,"estado":"REVISAO_NECESSARIA"},
    {"notificacao_id":155007,"estado":"INCERTO"},
    {"notificacao_id":155010,"estado":"PENDENTE"}]';
begin
  perform pg_temp.exigir109(v_resultado = v_esperado, 'projeção exata: própria, não arquivada, sem IDs de terceiros');
  perform pg_temp.exigir109(not exists (select 1 from kontrol_private.email_operacional_v1
    where notificacao_id in (155008,155009)), 'RLS no acesso direto às colunas de projeção');
  perform pg_temp.exigir109(public.meus_estados_email_operacional_v1(array[]::bigint[]) = '[]', 'recorte vazio');
  begin
    perform public.meus_estados_email_operacional_v1(array_fill(155001::bigint,array[81]));
    raise exception '0155: limite de 80 não aplicado';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

-- ORD125: resolução anterior positiva -> suspensão -> vazio não autoriza.
-- Acrescentado após as asserções de cardinalidade da fixture original.
insert into public.notificacoes(id,tipo,titulo,usuario_destino) overriding system value
values (155012,'sistema','ORD109-155012',pg_temp.uid109('a')),
       (155013,'sistema','ORD109-155013',null),
       (155014,'sistema','ORD109-155014',null);
select pg_temp.exigir109(exists (
  select 1 from public.destinatarios_notificacao(155012) d(email)
  where d.email = 'ord109-a@example.invalid'), 'ORD125: destinatário previamente resolvido');
update public.perfis set suspenso = true where id = pg_temp.uid109('a');
-- Até uma autorização privada de fallback NÃO suplanta destino revogado.
update kontrol_private.email_operacional_v1
set fallback_destinatarios_autorizados = array['ord109-a@example.invalid']
where notificacao_id in (155012,155013);
select pg_temp.exigir109(not has_column_privilege('service_role',
  'kontrol_private.email_operacional_v1','fallback_destinatarios_autorizados','UPDATE')
  and not has_column_privilege('authenticated',
  'kontrol_private.email_operacional_v1','fallback_destinatarios_autorizados','SELECT'),
  'ORD125: fallback não é configurável pelo executor nem exposto à sessão');

set local role service_role;
do $$
begin
  perform pg_temp.exigir109(not exists (select 1 from public.destinatarios_notificacao(155012)),
    'ORD125: suspensão tornou resolução vazia');
  perform pg_temp.exigir109((public.iniciar_post_email_operacional_v1(155012,1,pg_temp.op109(155012),
    pg_temp.payload109(155012))->>'autorizou_post') = 'false', 'ORD125: endereço obsoleto negado');
  perform pg_temp.exigir109((public.iniciar_post_email_operacional_v1(155014,1,pg_temp.op109(155014),
    pg_temp.payload109(155014))->>'autorizou_post') = 'false', 'ORD125: vazio sem autorização privada negado');
  perform pg_temp.exigir109((public.iniciar_post_email_operacional_v1(155013,1,pg_temp.op109(155013),
    replace(pg_temp.payload109(155013),'ord109-a@','ord109-b@'))->>'autorizou_post') = 'false',
    'ORD125: fallback diferente do autorizado negado');
  perform pg_temp.exigir109((public.iniciar_post_email_operacional_v1(155013,1,pg_temp.op109(155013),
    pg_temp.payload109(155013))->>'autorizou_post') = 'true',
    'ORD125: fallback exato autorizado para aviso sem destino');
end $$;
reset role;
select pg_temp.exigir109((select count(*) = 2 from kontrol_private.email_operacional_v1
  where notificacao_id in (155012,155014) and estado = 'PENDENTE' and operacao_id is null
    and geracao = 0 and payload is null and post_iniciado_em is null),
  'ORD125: negativas não iniciam POST nem consomem geração');

rollback;
