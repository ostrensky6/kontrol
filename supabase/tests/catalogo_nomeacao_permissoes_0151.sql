\set ON_ERROR_STOP on
-- 0151, somente banco descartável sintético, owner da cadeia, sem seed.
-- Modo normal: todas as provas sequenciais em transação revertida.
-- Modo concorrente opcional: psql -v ord88_corrida_setup=1 -f este_arquivo
-- em OUTRO clone sem perfis. Depois executar roteiro A/B no fim deste arquivo.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';

do $$
begin
  if exists (select 1 from auth.users) or exists (select 1 from public.perfis) then
    raise exception '0151: fixture exige banco sintético sem usuários/perfis.';
  end if;
end $$;

create function pg_temp.uid88(p text) returns uuid language sql immutable
as $$ select md5('ord88-perfil-' || p)::uuid $$;
create function pg_temp.sid88(p text) returns uuid language sql immutable
as $$ select md5('ord88-sessao-' || p)::uuid $$;
create function pg_temp.ator88(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.uid88(p)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', pg_temp.uid88(p), 'role', 'authenticated', 'session_id', pg_temp.sid88(p),
    'email', 'ord88-' || p || '@example.invalid')::text, true);
end $$;
create function pg_temp.negada88(p_alvo text,p_atual text,p_destino text,p_estado text default '42501')
returns void language plpgsql as $$
begin
  begin
    perform public.nomear_papel_usuario(pg_temp.uid88(p_alvo),p_atual,p_destino);
  exception when others then
    if sqlstate = p_estado then return; end if;
    raise;
  end;
  raise exception '0151: nomeação indevidamente permitida: % -> %', p_alvo, p_destino;
end $$;
create function pg_temp.vinculo88(p_usuario text, p_vinculado boolean)
returns jsonb language sql as $$
  select public.configurar_vinculo_projeto(
    current_setting('ord88.projeto_a')::bigint,pg_temp.uid88(p_usuario),p_vinculado)
$$;

\if :{?ord88_corrida_setup}
insert into auth.users(id,aud,role,email,created_at,updated_at)
select pg_temp.uid88(r),'authenticated','authenticated','ord88-'||r||'@example.invalid',now(),now()
from unnest(array['admin-a','admin-b']) r;
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.sid88(r),pg_temp.uid88(r),now(),now() from unnest(array['admin-a','admin-b']) r;
-- Bootstrap de dois atores somente neste clone descartável. Nunca caminho da aplicação.
alter table public.perfis disable trigger kontrol_proteger_papel_perfil;
update public.perfis set papel='admin',suspenso=false,senha_provisoria=false;
alter table public.perfis enable trigger kontrol_proteger_papel_perfil;
commit;
\quit
\endif

insert into auth.users(id,aud,role,email,created_at,updated_at)
select pg_temp.uid88(r),'authenticated','authenticated','ord88-'||r||'@example.invalid',now(),now()
from unnest(array['admin-a','admin-b','supervisor','supervisor-2','coord','coord-2','gestor','compra','cadastro','lab','lab-2','suspenso','ausente','provisorio']) r;
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.sid88(r),pg_temp.uid88(r),now(),now()
from unnest(array['admin-a','admin-b','supervisor','supervisor-2','coord','coord-2','gestor','compra','cadastro','lab','lab-2','suspenso','ausente','provisorio']) r;

-- Perfis sintéticos congelados, inclusive overlays legados contraditórios.
alter table public.perfis disable trigger kontrol_proteger_papel_perfil;
update public.perfis set suspenso=false,senha_provisoria=false;
update public.perfis set papel='admin' where id in (pg_temp.uid88('admin-a'),pg_temp.uid88('admin-b'));
update public.perfis set papel='supervisor' where id in (pg_temp.uid88('supervisor'),pg_temp.uid88('supervisor-2'),pg_temp.uid88('suspenso'),pg_temp.uid88('provisorio'));
update public.perfis set papel='coordenador' where id in (pg_temp.uid88('coord'),pg_temp.uid88('coord-2'));
update public.perfis set papel='gestor' where id=pg_temp.uid88('gestor');
update public.perfis set papel='compra' where id=pg_temp.uid88('compra');
update public.perfis set papel='cadastro' where id=pg_temp.uid88('cadastro');
update public.perfis set suspenso=true where id=pg_temp.uid88('suspenso');
update public.perfis set senha_provisoria=true where id=pg_temp.uid88('provisorio');
update public.perfis set permissoes='{"estoque.ver":false,"projetos.editar":true}' where id=pg_temp.uid88('lab');
update public.perfis set permissoes='{"estoque.ver":true,"projetos.editar":false}' where id=pg_temp.uid88('lab-2');
alter table public.perfis enable trigger kontrol_proteger_papel_perfil;
delete from public.perfis where id=pg_temp.uid88('ausente');

update public.permissoes_categorias
  set permissoes='{"estoque.ver":true,"projetos.editar":false,"chave.nao_catalogada":true}'
  where papel='laboratorio';
update public.permissoes_categorias
  set permissoes='{"projetos.ver":true,"projetos.editar":true,"estoque.ver":true,"compras.aprovar":true}'
  where papel in ('coordenador','gestor','supervisor');
update public.permissoes_categorias set permissoes='{"estoque.ver":true}'
  where papel in ('compra','cadastro');

insert into public.projetos(nome,coordenador_id) values
  ('ORD88-A',pg_temp.uid88('coord')),('ORD88-B',pg_temp.uid88('coord-2'));
select set_config('ord88.projeto_a',id::text,true) from public.projetos where nome='ORD88-A';
with compra as (
  insert into public.pedidos_compra(projeto_id,solicitante,status)
    select id,'ord88-solicitante@example.invalid','solicitado' from public.projetos where nome='ORD88-A'
    returning id
)
select set_config('ord88.compra_a',id::text,true) from compra;
with compra as (
  insert into public.pedidos_compra(projeto_id,solicitante,status)
    select id,'ord88-solicitante@example.invalid','solicitado' from public.projetos where nome='ORD88-B'
    returning id
)
select set_config('ord88.compra_b',id::text,true) from compra;
with compra as (
  insert into public.pedidos_compra(compra_origem_id,solicitante,status)
    values (current_setting('ord88.compra_b')::bigint,'ord88-solicitante@example.invalid','solicitado')
    returning id
)
select set_config('ord88.compra_herdada',id::text,true) from compra;
with compra as (
  insert into public.pedidos_compra(solicitante,status)
    values ('ord88-solicitante@example.invalid','solicitado') returning id
)
select set_config('ord88.compra_sem_projeto',id::text,true) from compra;

do $$
begin
  if has_function_privilege('anon','public.nomear_papel_usuario(uuid,text,text)','EXECUTE')
     or has_function_privilege('service_role','public.nomear_papel_usuario(uuid,text,text)','EXECUTE')
     or has_function_privilege('anon','public.configurar_vinculo_projeto(bigint,uuid,boolean)','EXECUTE')
     or has_function_privilege('service_role','public.configurar_vinculo_projeto(bigint,uuid,boolean)','EXECUTE') then
    raise exception '0151: ACL indevida da nomeação';
  end if;
  if kontrol_private.tem_permissao_do_usuario(pg_temp.uid88('lab'),'estoque.ver') is distinct from true
     or kontrol_private.tem_permissao_do_usuario(pg_temp.uid88('lab'),'projetos.editar') is distinct from false
     or kontrol_private.tem_permissao_do_usuario(pg_temp.uid88('lab'),'chave.nao_catalogada') then
    raise exception '0151: resolução de terceiros diverge da matriz';
  end if;
  if not kontrol_private.tem_permissao_do_usuario(pg_temp.uid88('compra'),'estoque.ver')
     or not kontrol_private.tem_permissao_do_usuario(pg_temp.uid88('cadastro'),'estoque.ver') then
    raise exception '0151: papel operacional válido perdeu a chave da função';
  end if;
end $$;

set local role anon;
do $$
begin
  perform public.nomear_papel_usuario(null,'laboratorio','compra');
  raise exception '0151: anon executou nomeação';
exception when insufficient_privilege then null;
end $$;
reset role;

set local role authenticated;
select pg_temp.ator88('ausente');
select pg_temp.negada88('lab','laboratorio','compra');
select pg_temp.ator88('suspenso');
select pg_temp.negada88('lab','laboratorio','compra');
select pg_temp.ator88('provisorio');
select pg_temp.negada88('lab','laboratorio','compra');
select pg_temp.ator88('supervisor');
select set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{session_id}',to_jsonb(pg_temp.sid88('admin-a')))::text,true);
-- Gestor→Coordenador é válido para este Supervisor com sua sessão própria.
select pg_temp.negada88('gestor','gestor','coordenador');
select pg_temp.ator88('supervisor');
do $$
begin
  perform pg_temp.vinculo88('gestor',true);
  raise exception '0151: escopo geral do Supervisor concedeu gestão de vínculo';
exception when insufficient_privilege then null;
end $$;
select pg_temp.ator88('admin-a');
select set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{session_id}',to_jsonb(pg_temp.sid88('admin-b')))::text,true);
do $$
begin
  perform pg_temp.vinculo88('gestor',true);
  raise exception '0151: sessão trocada configurou vínculo';
exception when insufficient_privilege then null;
end $$;
select pg_temp.ator88('admin-a');
do $$
declare
  v_criou text;
  v_repetiu text;
  v_criou_revogavel text;
  v_revogou text;
  v_repetiu_revogacao text;
begin
  v_criou := pg_temp.vinculo88('gestor',true)->>'alterado';
  v_repetiu := pg_temp.vinculo88('gestor',true)->>'alterado';
  v_criou_revogavel := pg_temp.vinculo88('coord-2',true)->>'alterado';
  v_revogou := pg_temp.vinculo88('coord-2',false)->>'alterado';
  v_repetiu_revogacao := pg_temp.vinculo88('coord-2',false)->>'alterado';
  if (v_criou,v_repetiu,v_criou_revogavel,v_revogou,v_repetiu_revogacao)
     is distinct from ('true'::text,'false'::text,'true'::text,'true'::text,'false'::text) then
    raise exception '0151: ciclo transacional do vínculo divergiu';
  end if;
end $$;

select pg_temp.ator88('lab');
do $$
begin
  if not public.tem_permissao('estoque.ver') or public.tem_permissao('projetos.editar')
     or public.tem_permissao('chave.nao_catalogada')
     or (public.minhas_permissoes() -> 'permissoes') is distinct from '{"estoque.ver":true,"projetos.editar":false}'::jsonb then
    raise exception '0151: override legado ativo ou menu divergente';
  end if;
end $$;
select pg_temp.ator88('lab-2');
do $$
begin
  if not public.tem_permissao('estoque.ver') or public.tem_permissao('projetos.editar') then
    raise exception '0151: mesma função, decisões diferentes';
  end if;
end $$;

select pg_temp.ator88('gestor');
select pg_temp.negada88('lab','laboratorio','compra');
do $$
begin
  if (select array_agg(nome order by nome) from public.projetos where nome like 'ORD88-%') is distinct from array['ORD88-A'] then
    raise exception '0151: vínculo do gestor não delimitou leitura';
  end if;
  if not public.tem_permissao('estoque.ver') then raise exception '0151: vínculo afetou estoque compartilhado'; end if;
end $$;
select pg_temp.ator88('coord');
do $$
declare v_chave text;
begin
  if (select array_agg(nome order by nome) from public.projetos where nome like 'ORD88-%') is distinct from array['ORD88-A'] then
    raise exception '0151: vínculo canônico do coordenador não delimitou leitura';
  end if;
  update public.projetos set descricao='Não deve alterar' where nome='ORD88-B';
  if found then raise exception '0151: coordenador editou projeto não vinculado'; end if;
  begin
    update public.projetos set coordenador_id=pg_temp.uid88('coord-2') where nome='ORD88-A';
    raise exception '0151: edição de projeto concedeu vínculo';
  exception when insufficient_privilege then null;
  end;
  if not public.tem_permissao('compras.aprovar') then
    raise exception '0151: teste de escopo não tem chave de compra';
  end if;
  foreach v_chave in array array['ord88.compra_b','ord88.compra_herdada'] loop
    begin
      perform public.transicionar_pedido_compra(current_setting(v_chave)::bigint,'aprovado','ord88 negativo',null);
      raise exception '0151: aprovou compra de projeto alheio (%).',v_chave;
    exception when insufficient_privilege then
      if sqlerrm <> 'Compra fora do escopo de projetos desta sessão.' then raise; end if;
    end;
  end loop;
  perform public.transicionar_pedido_compra(current_setting('ord88.compra_a')::bigint,'aprovado','ord88 vinculado',null);
  perform public.transicionar_pedido_compra(current_setting('ord88.compra_sem_projeto')::bigint,'aprovado','ord88 sem projeto',null);
end $$;
select pg_temp.negada88('coord-2','coordenador','gestor');
select pg_temp.negada88('supervisor','supervisor','gestor');
select pg_temp.negada88('lab','laboratorio','coordenador');
select pg_temp.negada88('coord','coordenador','gestor');
select pg_temp.negada88('lab','laboratorio','gestor');
select pg_temp.negada88('compra','compra','gestor');
select pg_temp.negada88('cadastro','cadastro','gestor');
select pg_temp.negada88('gestor','gestor','laboratorio');
select pg_temp.negada88('gestor','gestor','compra');
select pg_temp.negada88('gestor','gestor','cadastro');
do $$
begin
  if (public.nomear_papel_usuario(pg_temp.uid88('gestor'),'gestor','gestor')->>'alterado')::boolean
     is distinct from false then
    raise exception '0151: Gestor para Gestor deveria ser um no-op';
  end if;
end $$;

select pg_temp.ator88('supervisor');
do $$
begin
  if (select count(*) from public.projetos where nome like 'ORD88-%') <> 2 then
    raise exception '0151: supervisor com chave de projeto não tem escopo geral';
  end if;
  if public.tem_permissao('usuarios.gerenciar') or (public.minhas_permissoes()->>'admin')::boolean then
    raise exception '0151: supervisor herdou Admin';
  end if;
end $$;
select pg_temp.negada88('supervisor-2','supervisor','gestor');
select pg_temp.negada88('admin-b','admin','coordenador');
select pg_temp.negada88('compra','compra','supervisor');
select pg_temp.negada88('supervisor','supervisor','coordenador');
select pg_temp.negada88('lab','laboratorio','gestor');
select pg_temp.negada88('compra','compra','coordenador');
select pg_temp.negada88('cadastro','cadastro','gestor');
select pg_temp.negada88('gestor','gestor','laboratorio');
select pg_temp.negada88('gestor','gestor','compra');
select pg_temp.negada88('gestor','gestor','cadastro');
select public.nomear_papel_usuario(pg_temp.uid88('gestor'),'gestor','coordenador');

reset role;
-- Ainda há dois perfis Admin, mas B deixa de ser apto. A não pode sair
-- por nenhum dos canais de retirada, mesmo com B no catálogo.
update public.perfis set senha_provisoria=true where id=pg_temp.uid88('admin-b');
do $$
begin
  begin
    update public.perfis set senha_provisoria=true where id=pg_temp.uid88('admin-a');
    raise exception '0151: senha provisória retirou o único Admin apto';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.perfis set suspenso=true where id=pg_temp.uid88('admin-a');
    raise exception '0151: Admin provisório foi contado para suspensão';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.perfis where id=pg_temp.uid88('admin-a');
    raise exception '0151: Admin provisório foi contado para exclusão';
  exception when insufficient_privilege then null;
  end;
end $$;
set local role authenticated;
select pg_temp.ator88('admin-a');
select pg_temp.negada88('admin-a','admin','coordenador');
select pg_temp.negada88('lab','laboratorio','tecnico','22023');
select pg_temp.negada88('compra','gestor','laboratorio','40001');
do $$
begin
  perform set_config('app.nomeacao_papel','permitida',true);
  begin
    update public.perfis set papel='supervisor' where id=pg_temp.uid88('lab');
    raise exception '0151: update direto com marcador forjado';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.perfis set permissoes='{"estoque.ver":true}' where id=pg_temp.uid88('lab');
    raise exception '0151: override legado alterado diretamente';
  exception when insufficient_privilege then null;
  end;
  perform set_config('app.nomeacao_papel','',true);
end $$;
select public.nomear_papel_usuario(pg_temp.uid88('supervisor-2'),'supervisor','gestor');
select public.nomear_papel_usuario(pg_temp.uid88('compra'),'compra','cadastro');
select public.nomear_papel_usuario(pg_temp.uid88('lab'),'laboratorio','supervisor');
select public.nomear_papel_usuario(pg_temp.uid88('lab-2'),'laboratorio','admin');
select public.nomear_papel_usuario(pg_temp.uid88('lab-2'),'admin','laboratorio');
select public.nomear_papel_usuario(pg_temp.uid88('admin-b'),'admin','gestor');
reset role;
do $$
begin
  if (select count(*) from public.perfis where papel='admin' and not suspenso and not senha_provisoria) <> 1 then
    raise exception '0151: contagem inesperada de Admin ativo';
  end if;
  if (select permissoes from public.perfis where id=pg_temp.uid88('lab')) is distinct from
     '{"estoque.ver":false,"projetos.editar":true}'::jsonb then
    raise exception '0151: nomeação regravou JSON legado';
  end if;
  if not exists (select 1 from public.auditoria where tabela='perfis'
      and registro_id=pg_temp.uid88('lab')::text and acao='update'
      and valor_anterior->>'papel'='laboratorio' and valor_novo->>'papel'='supervisor'
      and usuario='ord88-admin-a@example.invalid') then
    raise exception '0151: nomeação não deixou trilha com ator e antes/depois';
  end if;
  if (select count(*) from public.auditoria where tabela='projetos_vinculos'
      and registro_id=current_setting('ord88.projeto_a')||':'||pg_temp.uid88('coord-2')::text
      and usuario='ord88-admin-a@example.invalid') <> 2
     or exists (select 1 from kontrol_private.projetos_vinculos
       where usuario_id=pg_temp.uid88('coord-2') and projeto_id=current_setting('ord88.projeto_a')::bigint) then
    raise exception '0151: revogação/replay ou auditoria do vínculo divergiram';
  end if;
  if (select count(*) from public.pedidos_compra where id in (
        current_setting('ord88.compra_a')::bigint,current_setting('ord88.compra_sem_projeto')::bigint)
        and status='aprovado') <> 2
     or (select count(*) from public.pedidos_compra where id in (
        current_setting('ord88.compra_b')::bigint,current_setting('ord88.compra_herdada')::bigint)
        and status='solicitado') <> 2
     or exists (select 1 from public.eventos_status where entidade='pedido_compra'
       and entidade_id in (current_setting('ord88.compra_b')::bigint,current_setting('ord88.compra_herdada')::bigint)) then
    raise exception '0151: escopo de compra não preservou estado/trilha';
  end if;
  begin
    update public.perfis set suspenso=true where id=pg_temp.uid88('admin-a');
    raise exception '0151: suspendeu último Admin ativo';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.perfis where id=pg_temp.uid88('admin-a');
    raise exception '0151: apagou último Admin ativo';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- Roteiro concorrente (outro clone, após -v ord88_corrida_setup=1):
-- Sessão A: BEGIN, SET LOCAL ROLE authenticated; claims do admin-a (md5 de
-- ord88-perfil-admin-a e ord88-sessao-admin-a, role authenticated, email sintético);
-- chame nomear_papel_usuario(md5('ord88-perfil-admin-b')::uuid,'admin','gestor')
-- e mantenha a transação aberta após receber alterado=true.
-- Sessão B: mesmo contexto para admin-b, chame nomear_papel_usuario sobre admin-a.
-- Na observadora confirme pg_blocking_pids(B) contendo A (não usar sleep como prova).
-- COMMIT A; B deve falhar 42501 e fazer rollback. Verificar 1 Admin ativo
-- e exatamente 1 evento update de função em auditoria. Repetir com ROLLBACK A
-- só em outro clone limpo, esperando uma demissão válida por B.
-- Corrida entre canais (outros clones limpos): A mantém aberta a nomeação
-- admin-b→gestor; B, sessão admin-b, tenta UPDATE em admin-a para suspenso=true
-- ou senha_provisoria=true, ou DELETE. Confirmar bloqueio por pg_blocking_pids.
-- Após COMMIT A, B não pode remover o único Admin apto: 42501 ou zero linhas
-- (se RLS negar por perda do papel). Validar contagem de Admin apto e trilha.
-- Inverso: A torna B provisório (mesmo lock), B tenta nomear A. COMMIT A;
-- RPC B deve reler o perfil e negar 42501. Nenhum desvio por snapshot antigo.
