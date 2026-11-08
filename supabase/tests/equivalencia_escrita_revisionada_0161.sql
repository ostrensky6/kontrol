\set ON_ERROR_STOP on
-- ORD141. NÃO EXECUTAR em produto/oficial. Fixture para clone sintético vazio.
-- Padrão: tudo termina em ROLLBACK. ord141_setup=1 deixa só o seed sintético
-- para as duas sessões descritas ao final; descarte o clone após essa variante.
begin;
set local lock_timeout='2s';
set local statement_timeout='25s';
create function pg_temp.uid141(p text) returns uuid language sql immutable
as $$ select md5('ord141-ator-'||p)::uuid $$;
create function pg_temp.sid141(p text) returns uuid language sql immutable
as $$ select md5('ord141-sessao-'||p)::uuid $$;
create function pg_temp.ator141(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',pg_temp.uid141(p)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid141(p),
    'role','authenticated','session_id',pg_temp.sid141(p))::text,true);
end $$;
create function pg_temp.negada141(p_estado text,p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then if sqlstate=p_estado then return; end if; raise;
  end;
  raise exception 'ORD141: esperado SQLSTATE % em %',p_estado,p_sql;
end $$;
\if :{?ord141_reusar}
-- Somente modo B da corrida; os nomes e claims são os sintéticos abaixo.
\else
do $$
begin
  if exists(select 1 from auth.users)
     or exists(select 1 from public.analises where codigo='TS-ORD141-A')
     or exists(select 1 from kontrol_private.equivalencia_insumos_decisoes)
     or exists(select 1 from kontrol_private.equivalencia_escrita_operacoes) then
    raise exception 'ORD141 exige clone sintético vazio.';
  end if;
end $$;
insert into auth.users(id,aud,role,email,created_at,updated_at)
select pg_temp.uid141(r),'authenticated','authenticated','ord141-'||r||'@example.invalid',now(),now()
from unnest(array['laboratorio','coordenador','supervisor','admin','gestor','sem_sessao','suspenso','provisorio']) r;
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.sid141(r),pg_temp.uid141(r),now(),now()
from unnest(array['laboratorio','coordenador','supervisor','admin','gestor','suspenso','provisorio']) r;
alter table public.perfis disable trigger kontrol_proteger_papel_perfil;
update public.perfis set suspenso=false,senha_provisoria=false;
update public.perfis p set papel=r from unnest(array['coordenador','supervisor','admin','gestor']) r where p.id=pg_temp.uid141(r);
alter table public.perfis enable trigger kontrol_proteger_papel_perfil;
update public.perfis set suspenso=true where id=pg_temp.uid141('suspenso');
update public.perfis set senha_provisoria=true where id=pg_temp.uid141('provisorio');
update public.permissoes_categorias set permissoes='{"analises.ver":true,"insumos.ver":true}'
where papel in ('laboratorio','coordenador','supervisor','gestor');
insert into public.analises(codigo) values('TS-ORD141-A');
insert into public.insumos(especificacao,unidade,unidade_consumo,fator_conversao,quantidade_embalagem)
values('TS-ORD141-SKU','frasco','reação',100,100);
insert into public.insumo_analise(codigo_analise,nome_etapa,nome_atividade,unidade,quantidade_por_amostra,modo_cobranca)
values('TS-ORD141-A','Sem etapa','Mistura','reação',2,'por_amostra');
\endif
create function pg_temp.dados141() returns jsonb language sql stable as $$
  select jsonb_build_object('necessidade_id',n.id,'etapa_id',null,'equipamento_id',null,
    'insumo_id',(select id from public.insumos where especificacao='TS-ORD141-SKU'),
    'apresentacao_ref','apresentacao:141:r1','unidade_estoque','frasco','unidade_consumo','reação',
    'fator_conversao',100,'evidencia_ref','laudo:141:r1','vigente_ate',null,'confirmada',true)
  from public.insumo_analise n where n.codigo_analise='TS-ORD141-A';
$$;
create function pg_temp.preparar141() returns text language sql as $$
  select public.preparar_equivalencia_revisionada_v1('registrar','TS-ORD141-A','metodo:141:r1',pg_temp.dados141())->>'revisao_esperada';
$$;
create function pg_temp.registrar141(p_revisao text,p_op uuid) returns jsonb language sql as $$
  select public.registrar_equivalencia_revisionada_v1('TS-ORD141-A','metodo:141:r1',pg_temp.dados141(),p_revisao,p_op);
$$;
\if :{?ord141_setup}
commit;
\quit
\endif
set local role authenticated;
select pg_temp.ator141('laboratorio');
\if :{?ord141_corrida_b}
-- Sessão A segura a chave da necessidade. Não há espera/bypass pelo legado.
select pg_temp.negada141('55P03',$$select pg_temp.preparar141()$$);
select pg_temp.negada141('55P03',$$select pg_temp.registrar141('equivalencia-cas-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','11111111-1111-4111-8111-111111111111')$$);
select pg_temp.negada141('55P03',$$select public.registrar_equivalencia_contextual_v1('TS-ORD141-A','metodo:141:r1',pg_temp.dados141())$$);
rollback;
\quit
\endif

do $$
declare r text; v text;
begin
  foreach r in array array['laboratorio','coordenador','supervisor'] loop
    perform pg_temp.ator141(r);
    v:=pg_temp.preparar141();
    if v is null or v !~ '^equivalencia-cas-v1:[a-f0-9]{32}$' then
      raise exception 'ORD141: preparação autorizada ausente para %',r;
    end if;
  end loop;
  perform pg_temp.ator141('laboratorio');
end $$;
do $recibos141$
declare v text; r jsonb; replay jsonb; rev text; d bigint;
begin
  v:=pg_temp.preparar141();
  perform set_config('ord141.revisao',v,true);
  r:=pg_temp.registrar141(v,'11111111-1111-4111-8111-111111111111');
  replay:=pg_temp.registrar141(v,'11111111-1111-4111-8111-111111111111');
  if r->>'estado'<>'validada' or r->'replay'<>'false'::jsonb
     or replay-'replay' is distinct from r-'replay' or replay->'replay'<>'true'::jsonb
     or r->>'ator_ref' !~ '^ator-operacao:[a-f0-9]{32}$' then raise exception 'ORD141: recibo/replay incorreto.'; end if;
  perform set_config('ord141.decisao',r->>'decisao_ref',true);
  perform pg_temp.negada141('22023',$$select public.revogar_equivalencia_revisionada_v1(
    'TS-ORD141-A','metodo:141:r1',split_part(current_setting('ord141.decisao'),':',2)::bigint,
    'Outra ação',current_setting('ord141.revisao'),'11111111-1111-4111-8111-111111111111')$$);
  perform pg_temp.negada141('22023',$$select public.registrar_equivalencia_revisionada_v1(
    'TS-ORD141-A','metodo:141:r1',pg_temp.dados141()||'{"evidencia_ref":"outro"}',
    current_setting('ord141.revisao'),'11111111-1111-4111-8111-111111111111')$$);
  perform pg_temp.ator141('coordenador');
  perform pg_temp.negada141('22023',$$select pg_temp.registrar141(current_setting('ord141.revisao'),'11111111-1111-4111-8111-111111111111')$$);
  perform pg_temp.ator141('laboratorio');
  d:=split_part(r->>'decisao_ref',':',2)::bigint;
  rev:=public.preparar_equivalencia_revisionada_v1('revogar','TS-ORD141-A','metodo:141:r1',jsonb_build_object('id',d,'motivo','Revisão')) ->>'revisao_esperada';
  r:=public.revogar_equivalencia_revisionada_v1('TS-ORD141-A','metodo:141:r1',d,'Revisão',rev,'22222222-2222-4222-8222-222222222222');
  replay:=public.revogar_equivalencia_revisionada_v1('TS-ORD141-A','metodo:141:r1',d,'Revisão',rev,'22222222-2222-4222-8222-222222222222');
  if r->>'estado'<>'revogada' or replay-'replay' is distinct from r-'replay' then raise exception 'ORD141: revogação/replay incorreto.'; end if;
  -- O recibo de registro anterior continua histórico, não revive a decisão.
  perform pg_temp.registrar141(v,'11111111-1111-4111-8111-111111111111');
end $recibos141$;
reset role;
do $$
begin
  if (select count(*) from kontrol_private.equivalencia_insumos_decisoes)<>1
     or (select count(*) from kontrol_private.equivalencia_escrita_operacoes)<>2
     or exists(select 1 from kontrol_private.equivalencia_insumos_decisoes where revogada_em is null) then
    raise exception 'ORD141: replay criou efeito extra.';
  end if;
end $$;
-- Reautorização do mesmo UUID após perda real de categoria.
update public.permissoes_categorias set permissoes='{"analises.ver":true}' where papel='laboratorio';
set local role authenticated;
select pg_temp.negada141('42501',$$select pg_temp.registrar141(current_setting('ord141.revisao'),'11111111-1111-4111-8111-111111111111')$$);
reset role;
update public.permissoes_categorias set permissoes='{"analises.ver":true,"insumos.ver":true}' where papel='laboratorio';
set local role authenticated;
do $autorizacao141$
declare r text; v text;
begin
  foreach r in array array['admin','gestor','sem_sessao','suspenso','provisorio'] loop
    perform pg_temp.ator141(r);
    perform pg_temp.negada141('42501',$$select pg_temp.preparar141()$$);
    perform pg_temp.negada141('42501',$$select pg_temp.registrar141(current_setting('ord141.revisao'),'11111111-1111-4111-8111-111111111111')$$);
  end loop;
  perform pg_temp.ator141('laboratorio');
  v:=pg_temp.preparar141();
  perform set_config('ord141.obsoleta',v,true);
  -- Legado continua compatível, mas modifica o conjunto factual do CAS novo.
  perform public.registrar_equivalencia_contextual_v1('TS-ORD141-A','metodo:141:r1',pg_temp.dados141());
  perform pg_temp.negada141('40001',$$select pg_temp.registrar141(current_setting('ord141.obsoleta'),'33333333-3333-4333-8333-333333333333')$$);
end $autorizacao141$;
reset role;
do $$
begin
  if exists(select 1 from kontrol_private.equivalencia_escrita_operacoes where operacao_id='33333333-3333-4333-8333-333333333333') then
    raise exception 'ORD141: CAS rejeitado deixou recibo.';
  end if;
end $$;
-- Fonte dimensional muda depois da preparação; comparar antes do efeito0154.
set local role authenticated;
select set_config('ord141.catalogo',pg_temp.preparar141(),true);
reset role;
update public.insumos set fator_conversao=50 where especificacao='TS-ORD141-SKU';
set local role authenticated;
select pg_temp.negada141('40001',$$select pg_temp.registrar141(current_setting('ord141.catalogo'),'44444444-4444-4444-8444-444444444444')$$);
reset role;
update public.insumos set fator_conversao=100 where especificacao='TS-ORD141-SKU';
-- Falha injetada apenas na fixture, DEPOIS do efeito e antes do recibo.
create function pg_temp.falhar_recibo141() returns trigger language plpgsql as $$
begin raise exception 'ORD141 falha sintética de recibo' using errcode='23514'; end $$;
create trigger teste_falha_recibo141 before insert on kontrol_private.equivalencia_escrita_operacoes
for each row execute function pg_temp.falhar_recibo141();
select set_config('ord141.antes',coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb)::text,true)
from kontrol_private.equivalencia_insumos_decisoes d;
set local role authenticated;
do $$
declare d bigint; rev text;
begin
  select (x->>'decisao_ref') into strict rev from jsonb_array_elements(
    public.ler_equivalencia_contextual_v1('TS-ORD141-A','metodo:141:r1')->'decisoes') x where x->>'estado'='validada';
  d:=split_part(rev,':',2)::bigint;
  rev:=public.preparar_equivalencia_revisionada_v1('revogar','TS-ORD141-A','metodo:141:r1',jsonb_build_object('id',d,'motivo','Falha')) ->>'revisao_esperada';
  perform pg_temp.negada141('23514',format('select public.revogar_equivalencia_revisionada_v1(%L,%L,%s,%L,%L,%L)',
    'TS-ORD141-A','metodo:141:r1',d,'Falha',rev,'55555555-5555-4555-8555-555555555555'));
end $$;
reset role;
do $$
begin
  if (select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb) from kontrol_private.equivalencia_insumos_decisoes d)
     is distinct from current_setting('ord141.antes')::jsonb
     or exists(select 1 from kontrol_private.equivalencia_escrita_operacoes where operacao_id='55555555-5555-4555-8555-555555555555') then
    raise exception 'ORD141: efeito parcial persistiu sem recibo.';
  end if;
end $$;
rollback;

-- Prova de duas sessões (não executada na autoria), SOMENTE clone descartável:
-- 1. Executar este arquivo com -v ord141_setup=1, que deixa somente seed.
-- 2. Sessão A: BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(
--      'equivalencia-v1:'||id,0)) FROM public.insumo_analise WHERE codigo_analise='TS-ORD141-A';
-- 3. Enquanto A permanece aberta, sessão B executa este arquivo com
--      -v ord141_reusar=1 -v ord141_corrida_b=1.
--    As três rotas (preparar, confirmar revisionada, registrar legado) exigem55P03.
-- 4. A: ROLLBACK. B pode executar o arquivo com -v ord141_reusar=1 (sem corrida_b)
--    para confirmar sucesso/replay/obsolescência/rollback. Descartar clone ao final.
-- Variante catálogo: A: BEGIN; UPDATE public.insumos SET fator_conversao=50
--    WHERE especificacao='TS-ORD141-SKU'; B preparar exige55P03 (row NOWAIT).
--    A ROLLBACK; B retoma o caso normal. Nenhuma flag de produto é alterada.
