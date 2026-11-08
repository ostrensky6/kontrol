\set ON_ERROR_STOP on
-- 0152: somente PostgreSQL descartável, sem seed. Modo padrão termina em rollback.
-- Para a corrida em OUTRO clone, passar -v ord93_corrida_setup=1 e seguir o roteiro final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '25s';

do $$
begin
  if exists (select 1 from auth.users)
     or exists (select 1 from kontrol_private.consumo_manual_insumos) then
    raise exception '0152: fixture exige clone sintético vazio.';
  end if;
end $$;

create function pg_temp.uid93(p text) returns uuid language sql immutable
as $$ select md5('ord93-perfil-' || p)::uuid $$;
create function pg_temp.sid93(p text) returns uuid language sql immutable
as $$ select md5('ord93-sessao-' || p)::uuid $$;
create function pg_temp.ator93(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.uid93(p)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', pg_temp.uid93(p), 'role', 'authenticated', 'session_id', pg_temp.sid93(p))::text, true);
end $$;

insert into auth.users(id,aud,role,email,created_at,updated_at)
select pg_temp.uid93(r),'authenticated','authenticated','ord93-'||r||'@example.invalid',now(),now()
from unnest(array['laboratorio','gestor','coordenador','supervisor','admin','compra','cadastro','suspenso','provisorio','sem_perfil','sem_sessao']) r;
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.sid93(r),pg_temp.uid93(r),now(),now()
from unnest(array['laboratorio','gestor','coordenador','supervisor','admin','compra','cadastro','suspenso','provisorio','sem_perfil']) r;

-- Bootstrap do cenário sintético; nenhuma alternativa de produto é habilitada.
alter table public.perfis disable trigger kontrol_proteger_papel_perfil;
update public.perfis set suspenso=false,senha_provisoria=false;
update public.perfis p set papel=r
from unnest(array['gestor','coordenador','supervisor','admin','compra','cadastro']) r
where p.id=pg_temp.uid93(r);
alter table public.perfis enable trigger kontrol_proteger_papel_perfil;
update public.perfis set suspenso=true where id=pg_temp.uid93('suspenso');
update public.perfis set senha_provisoria=true where id=pg_temp.uid93('provisorio');
delete from public.perfis where id=pg_temp.uid93('sem_perfil');

update public.permissoes_categorias set permissoes='{"estoque.ver":true}'
where papel in ('laboratorio','gestor','coordenador','supervisor','compra','cadastro');
insert into public.insumos(especificacao,unidade,quantidade_embalagem,fator_conversao)
values ('ORD93-REFERENCIA','mL',100,1),('ORD93-DEFAULT','un',1,1);

\if :{?ord93_corrida_setup}
commit;
\quit
\endif

create function pg_temp.insumo93(p text default 'ORD93-REFERENCIA') returns bigint
language sql stable as $$ select id from public.insumos where especificacao = p $$;
create function pg_temp.reg93(
  p_op text,p_esperada bigint,p_valor numeric,p_conteudo numeric default 100,
  p_unidade text default 'mL',p_confirmada boolean default true,p_item text default 'ORD93-REFERENCIA'
) returns jsonb language sql as $$
  select public.registrar_consumo_manual_insumo(
    pg_temp.insumo93(p_item),md5('ord93-op-'||p_op)::uuid,p_esperada,p_valor,p_conteudo,
    p_unidade,p_confirmada,'Referência sintética','Conferência sintética',date '2026-11-07')
$$;
create function pg_temp.negada93(
  p_estado text,p_op text,p_esperada bigint,p_valor numeric,p_conteudo numeric default 100,
  p_unidade text default 'mL',p_confirmada boolean default true,p_item text default 'ORD93-REFERENCIA'
) returns void language plpgsql as $$
begin
  begin
    perform pg_temp.reg93(p_op,p_esperada,p_valor,p_conteudo,p_unidade,p_confirmada,p_item);
  exception when others then
    if sqlstate = p_estado then return; end if;
    raise;
  end;
  raise exception '0152: escrita não negada, esperado % (%).',p_estado,p_op;
end $$;

do $$
declare v_assinatura text := 'public.registrar_consumo_manual_insumo(bigint,uuid,bigint,numeric,numeric,text,boolean,text,text,date)';
begin
  if has_function_privilege('anon',v_assinatura,'EXECUTE')
     or has_function_privilege('service_role',v_assinatura,'EXECUTE')
     or has_function_privilege('anon','public.ler_consumo_manual_insumo(bigint,bigint,integer)','EXECUTE')
     or has_table_privilege('authenticated','kontrol_private.consumo_manual_insumos','INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('anon','kontrol_private.consumo_manual_insumos','SELECT,INSERT') then
    raise exception '0152: grants de bypass.';
  end if;
end $$;

set local role authenticated;
select pg_temp.ator93('laboratorio');
do $$
declare v jsonb := public.ler_consumo_manual_insumo(pg_temp.insumo93());
begin
  if v is distinct from '{"estado":"nenhuma","vigente":null,"historico":[],"proxima_antes_da_revisao":null}'::jsonb then
    raise exception '0152: ausência confundida com zero ou erro.';
  end if;
end $$;
select pg_temp.negada93('22023','negativo',0,-1);
select pg_temp.negada93('22023','nan',0,'NaN'::numeric);
select pg_temp.negada93('22023','infinito',0,'Infinity'::numeric);
select pg_temp.negada93('22023','conteudo-diverge',0,1,99);
select pg_temp.negada93('22023','unidade-diverge',0,1,100,'L');
select pg_temp.negada93('22023','default-sem-confirmacao',0,1,1,'un',false,'ORD93-DEFAULT');
select pg_temp.negada93('42501','fora-da-view',0,1,100,'mL',true,'ORD93-NAO-EXISTE');

do $$
declare
  v_papel text;
  v_esperada bigint := 0;
  v jsonb;
begin
  foreach v_papel in array array['laboratorio','gestor','coordenador','supervisor','admin'] loop
    perform pg_temp.ator93(v_papel);
    v := pg_temp.reg93(v_papel,v_esperada,v_esperada::numeric);
    if v->>'repetida' is distinct from 'false'
       or (v#>>'{registro,revisao}')::bigint is distinct from v_esperada + 1
       or (v#>>'{registro,quantidade_embalagens_mes}')::numeric is distinct from v_esperada::numeric
       or (v#>>'{registro,ator_id}')::uuid is distinct from pg_temp.uid93(v_papel) then
      raise exception '0152: registro por % divergente: %',v_papel,v;
    end if;
    v_esperada := v_esperada + 1;
  end loop;
  foreach v_papel in array array['compra','cadastro','suspenso','provisorio','sem_perfil','sem_sessao'] loop
    perform pg_temp.ator93(v_papel);
    perform pg_temp.negada93('42501',v_papel,5,3);
  end loop;
  perform pg_temp.ator93('compra');
  perform set_config('request.jwt.claims',
    jsonb_set(auth.jwt(),'{user_metadata}','{"papel":"supervisor"}'::jsonb)::text,true);
  perform pg_temp.negada93('42501','papel-alegado',5,3);
end $$;
select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','',true);
select pg_temp.negada93('42501','sem-identidade',5,1);

select pg_temp.ator93('compra');
do $$
begin
  if public.ler_consumo_manual_insumo(pg_temp.insumo93())->>'estado' is distinct from 'registrada' then
    raise exception '0152: papel com leitura perdeu acesso por não poder escrever';
  end if;
end $$;

reset role;
update public.permissoes_categorias set permissoes='{"estoque.ver":false}' where papel='supervisor';
set local role authenticated;
select pg_temp.ator93('supervisor');
select pg_temp.negada93('42501','escrita-nao-concede-leitura',5,1);
do $$
begin
  perform public.ler_consumo_manual_insumo(pg_temp.insumo93());
  raise exception '0152: papel escritor recebeu leitura sem estoque.ver';
exception when insufficient_privilege then null;
end $$;
reset role;
update public.permissoes_categorias set permissoes='{"estoque.ver":true}' where papel='supervisor';

-- Prova de visibilidade no invoker e defesa do executor privado: uma policy
-- sintética temporária restringe a linha que de outro modo estaria visível.
select set_config('ord93.insumo_oculto',pg_temp.insumo93()::text,true);
create policy ord93_ocultar_referencia on public.insumos as restrictive
  for select to authenticated using (especificacao <> 'ORD93-REFERENCIA');
set local role authenticated;
select pg_temp.ator93('admin');
do $$
declare v_id bigint := current_setting('ord93.insumo_oculto',true)::bigint;
begin
  begin
    perform public.ler_consumo_manual_insumo(v_id);
    raise exception '0152: leu insumo invisível pela view';
  exception when insufficient_privilege then null;
  end;
  begin
    perform kontrol_private.registrar_consumo_manual_insumo(
      v_id,md5('ord93-op-bypass')::uuid,5,1,100,'mL',true,'Sintética','Teste',date '2026-11-07');
    raise exception '0152: executor privado aceitou insumo invisível';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
drop policy ord93_ocultar_referencia on public.insumos;

-- ORD103: só a ACL da view muda; rls_read_insumos permanece como na base.
-- Mesmo com EXECUTE no executor privado, a sessão não pode criar revisão.
savepoint ord103_acl_view;
revoke select on public.v_estoque_saldo from authenticated, public;
do $$
begin
  if has_table_privilege('authenticated','public.v_estoque_saldo','SELECT') then
    raise exception '0152: ACL da view ainda concede leitura no cenário negativo';
  end if;
  if not exists (
    select 1 from pg_policy p where p.polrelid='public.insumos'::regclass
      and p.polname='rls_read_insumos' and p.polpermissive and p.polcmd='r'
      and pg_get_expr(p.polqual,p.polrelid)='true'
  ) then
    raise exception '0152: cenário de ACL alterou a policy de insumos';
  end if;
end $$;
set local role authenticated;
select pg_temp.ator93('admin');
do $$
declare
  v_id bigint := current_setting('ord93.insumo_oculto')::bigint;
  v_op uuid := md5('ord103-acl-view')::uuid;
begin
  begin
    perform public.registrar_consumo_manual_insumo(
      v_id,v_op,5,1,100,'mL',true,'Sintética','ACL revogada',date '2026-11-07');
    raise exception '0152: wrapper gravou sem SELECT na view';
  exception when insufficient_privilege then null;
  end;
  begin
    perform kontrol_private.registrar_consumo_manual_insumo(
      v_id,v_op,5,1,100,'mL',true,'Sintética','ACL revogada',date '2026-11-07');
    raise exception '0152: executor privado gravou sem SELECT na view';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  if (select count(*) from kontrol_private.consumo_manual_insumos) <> 5
     or exists (select 1 from kontrol_private.consumo_manual_insumos
                where operacao_id=md5('ord103-acl-view')::uuid) then
    raise exception '0152: cenário de ACL deixou revisão';
  end if;
end $$;
rollback to savepoint ord103_acl_view;
release savepoint ord103_acl_view;

update public.insumos set quantidade_embalagem=200,unidade='g' where especificacao='ORD93-REFERENCIA';
set local role authenticated;
select pg_temp.ator93('laboratorio');
do $$
declare v jsonb := pg_temp.reg93('laboratorio',0,0.00,100.0,' mL ');
begin
  if v->>'repetida' is distinct from 'true' or v#>>'{registro,revisao}' is distinct from '1'
     or v#>>'{registro,unidade_conteudo}' is distinct from 'mL'
     or (v#>>'{registro,conteudo_embalagem}')::numeric is distinct from 100
     or (v#>>'{registro,quantidade_embalagens_mes}')::numeric is distinct from 0 then
    raise exception '0152: replay não preservou zero ou snapshot anterior';
  end if;
end $$;
select pg_temp.negada93('23505','laboratorio',0,1);
select pg_temp.negada93('40001','stale',4,6,200,'g');
select pg_temp.reg93('nova-apresentacao',5,2.5,200,'g');
do $$
declare
  v jsonb := public.ler_consumo_manual_insumo(pg_temp.insumo93(),null,1);
  h jsonb := public.ler_consumo_manual_insumo(pg_temp.insumo93(),6,100);
begin
  if v#>>'{vigente,revisao}' is distinct from '6'
     or v#>>'{vigente,unidade_conteudo}' is distinct from 'g'
     or v->>'proxima_antes_da_revisao' is distinct from '6'
     or jsonb_array_length(v->'historico') <> 1
     or jsonb_array_length(h->'historico') <> 5
     or h#>>'{historico,4,unidade_conteudo}' is distinct from 'mL'
     or (h#>>'{historico,4,conteudo_embalagem}')::numeric is distinct from 100 then
    raise exception '0152: história, cursor ou snapshot divergente';
  end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from kontrol_private.consumo_manual_insumos) <> 6 then
    raise exception '0152: replay/conflito/criação geraram contagem inesperada.';
  end if;
end $$;
rollback;

-- Depois do rollback: nenhuma revisão/fixture persistida; o teste não grava
-- movimentos, reservas nem seleção de origem. Em laboratório, comparar hashes
-- dos livros antes/depois e confirmar as seis revisões zeradas.

-- Roteiro concorrente, outro clone com -v ord93_corrida_setup=1:
-- 1. Duas sessões BEGIN, SET LOCAL ROLE authenticated, JWT sintético válido
--    (auth.users/auth.sessions do laboratorio ou gestor gerados pela fixture).
-- 2. A chama registrar para ORD93-REFERENCIA com revisão 0, valor 2, conteúdo
--    100 mL confirmado, UUID nova e fonte/motivo/data literais; mantém aberta.
--    B faz o mesmo com UUID distinta e mesma revisão esperada. A observadora
--    confirma pg_blocking_pids(B) contendo A antes de COMMIT A. B: 40001,
--    rollback; uma revisão, sem sobrescrita.
-- 3. Repetir em clone limpo com mesma UUID e payload/ator: B retorna a mesma
--    revisão com repetida=true. Mesma UUID e payload diferente: B recebe 23505.
-- 4. No clone, repetir disputa com edição de catálogo em A (100→200); B
--    confirma 100. Após COMMIT A, B rejeita com 22023, sem criar revisão.
