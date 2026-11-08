\set ON_ERROR_STOP on
-- ORD149: candidata NÃO EXECUTADA; somente clone sintético vazio, owner.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
begin
  if exists(select 1 from auth.users) or exists(select 1 from public.perfis) then
    raise exception '0162: usar apenas clone sintético vazio.';
  end if;
end $$;
create function pg_temp.uid162(p text) returns uuid language sql immutable
as $$select md5('ord149-'||p)::uuid$$;
create function pg_temp.ator162(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',pg_temp.uid162(p)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid162(p),
    'role','authenticated','session_id',pg_temp.uid162('sessao-'||p))::text,true);
end $$;
create temporary table elenco162(chave text primary key,papel text,suspenso boolean,provisorio boolean) on commit drop;
insert into elenco162 values
  ('admin','admin',false,false),('admin2','admin',false,false),
  ('supervisor','supervisor',false,false),('coordenador','coordenador',false,false),
  ('gestor','gestor',false,false),('laboratorio','laboratorio',false,false),
  ('compra','compra',false,false),('cadastro','cadastro',false,false),
  ('suspenso','supervisor',true,false),('provisorio','coordenador',false,true);
insert into auth.users(id,aud,role,email,created_at,updated_at)
select pg_temp.uid162(chave),'authenticated','authenticated','ord149-'||chave||'@example.invalid',now(),now() from elenco162;
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.uid162('sessao-'||chave),pg_temp.uid162(chave),now(),now() from elenco162;
alter table public.perfis disable trigger kontrol_proteger_papel_perfil;
update public.perfis p set nome='Fixture ORD149',papel=e.papel,suspenso=e.suspenso,senha_provisoria=e.provisorio
from elenco162 e where p.id=pg_temp.uid162(e.chave);
alter table public.perfis enable trigger kontrol_proteger_papel_perfil;

do $$
declare
  ator text; r jsonb; item jsonb; alvo record; destinos text[]; encontrado jsonb;
  cursor_id uuid; anterior uuid; ids uuid[]:='{}'; paginas integer:=0;
  antes jsonb; depois jsonb; eventos bigint;
begin
  select jsonb_agg(to_jsonb(p) order by p.id) into antes from public.perfis p;
  select count(*) into eventos from public.auditoria;
  foreach ator in array array['admin','supervisor','coordenador'] loop
    perform pg_temp.ator162(ator);
    set local role authenticated;
    r:=public.listar_contexto_nomeacao(null,100);
    reset role;
    for item in select value from jsonb_array_elements(r->'itens') loop
      if item->>'usuario_id'=pg_temp.uid162(ator)::text
        or item-array['usuario_id','nome','papel_atual_esperado','suspenso','senha_provisoria','papeis_destino']<>'{}'::jsonb then
        raise exception '0162: próprio ator ou campo privado exposto';
      end if;
    end loop;
    for alvo in select * from elenco162 where chave<>ator loop
      select array_agg(x.papel order by x.ordem) into destinos
      from unnest(array['laboratorio','compra','cadastro','gestor','coordenador','supervisor','admin'])
        with ordinality x(papel,ordem)
      where ator='admin' or coalesce(
        kontrol_private.nivel_nomeacao(alvo.papel)<kontrol_private.nivel_nomeacao(ator)
        and kontrol_private.nivel_nomeacao(x.papel)<kontrol_private.nivel_nomeacao(ator),false);
      select x into encontrado from jsonb_array_elements(r->'itens') x
        where x->>'usuario_id'=pg_temp.uid162(alvo.chave)::text;
      if destinos is null then
        if encontrado is not null then raise exception '0162: alvo acima/sem hierarquia exposto'; end if;
      elsif encontrado is null or encontrado->'papeis_destino' is distinct from to_jsonb(destinos)
        or encontrado->>'papel_atual_esperado' is distinct from alvo.papel
        or (encontrado->>'suspenso')::boolean is distinct from alvo.suspenso
        or (encontrado->>'senha_provisoria')::boolean is distinct from alvo.provisorio then
        raise exception '0162: matriz/CAS/estado divergente da0151';
      end if;
    end loop;
    -- Expectativas literais independentes do cálculo comparativo acima.
    if ator='admin' and jsonb_array_length(r->'itens')<>9 then raise exception '0162: Admin perdeu alvo'; end if;
    if ator='supervisor' and exists(select 1 from jsonb_array_elements(r->'itens') x
      where x->'papeis_destino'<>'["gestor","coordenador"]'::jsonb
        or x->>'papel_atual_esperado' not in ('coordenador','gestor')) then
      raise exception '0162: Supervisor recebeu pares/operacionais/superiores';
    end if;
    if ator='coordenador' and (jsonb_array_length(r->'itens')<>1
      or r#>>'{itens,0,papel_atual_esperado}'<>'gestor'
      or r#>'{itens,0,papeis_destino}'<>'["gestor"]'::jsonb) then
      raise exception '0162: inventou hierarquia operacional para Coordenador';
    end if;
  end loop;

  foreach ator in array array['gestor','laboratorio','compra','cadastro','suspenso','provisorio'] loop
    perform pg_temp.ator162(ator);
    set local role authenticated;
    begin
      perform public.listar_contexto_nomeacao();
      raise exception '0162: ator não apto recebeu página em vez de negação';
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;
  perform pg_temp.ator162('admin');
  set local role authenticated;
  loop
    r:=public.listar_contexto_nomeacao(cursor_id,2);
    if jsonb_array_length(r->'itens')>2 then raise exception '0162: limite ignorado'; end if;
    for item in select value from jsonb_array_elements(r->'itens') loop
      if (item->>'usuario_id')::uuid=any(ids)
        or (anterior is not null and (item->>'usuario_id')::uuid<=anterior) then
        raise exception '0162: ordem/repetição na paginação';
      end if;
      anterior:=(item->>'usuario_id')::uuid; ids:=array_append(ids,anterior);
    end loop;
    paginas:=paginas+1;
    if paginas>5 then raise exception '0162: paginação não terminou'; end if;
    cursor_id:=(r->>'proximo_usuario_id')::uuid;
    exit when cursor_id is null;
    if cursor_id is distinct from anterior then raise exception '0162: cursor incorreto'; end if;
  end loop;
  if cardinality(ids)<>9 then raise exception '0162: perdeu itens entre páginas'; end if;
  r:=public.listar_contexto_nomeacao('ffffffff-ffff-ffff-ffff-ffffffffffff',1);
  if r is distinct from '{"itens":[],"proximo_usuario_id":null}'::jsonb then
    raise exception '0162: página final não é ausência explícita';
  end if;
  begin
    perform public.listar_contexto_nomeacao(null,0);
    raise exception '0162: limite inválido aceito';
  exception when invalid_parameter_value then null;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid162('admin'),
    'role','authenticated','session_id',gen_random_uuid(),'papel','admin')::text,true);
  begin
    perform public.listar_contexto_nomeacao();
    raise exception '0162: claim sem sessão real autorizou leitura';
  exception when insufficient_privilege then null;
  end;
  reset role;
  select jsonb_agg(to_jsonb(p) order by p.id) into depois from public.perfis p;
  if antes is distinct from depois or eventos<>(select count(*) from public.auditoria) then
    raise exception '0162: leitura alterou perfil/auditoria';
  end if;

  -- A foto não é autorização nem bypass de CAS. Escrita real da0151, apenas
  -- no clone transacional; uma mudança posterior torna a foto obsoleta.
  perform pg_temp.ator162('admin');
  set local role authenticated;
  perform public.nomear_papel_usuario(pg_temp.uid162('gestor'),'gestor','coordenador');
  begin
    perform public.nomear_papel_usuario(pg_temp.uid162('gestor'),'gestor','supervisor');
    raise exception '0162: foto obsoleta ignorou CAS';
  exception when serialization_failure then null;
  end;
  perform public.nomear_papel_usuario(pg_temp.uid162('gestor'),'coordenador','supervisor');
  reset role;
  perform pg_temp.ator162('supervisor');
  set local role authenticated;
  begin
    perform public.nomear_papel_usuario(pg_temp.uid162('gestor'),'gestor','coordenador');
    raise exception '0162: foto antiga permitiu nomear novo par';
  exception when insufficient_privilege then null;
  end;
  reset role;
  if has_function_privilege('anon','public.listar_contexto_nomeacao(uuid,integer)','EXECUTE')
     or has_function_privilege('service_role','public.listar_contexto_nomeacao(uuid,integer)','EXECUTE') then
    raise exception '0162: ACL indevida';
  end if;
end $$;
rollback;
