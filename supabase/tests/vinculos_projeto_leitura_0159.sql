\set ON_ERROR_STOP on
-- ORD130: candidata E1 NÃO EXECUTADA. Somente clone sintético vazio com0151/0159.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
begin
  if exists(select 1 from auth.users) or exists(select 1 from public.perfis)
    or exists(select 1 from public.projetos) then
    raise exception '0159: usar clone sintético vazio, nunca dados reais.';
  end if;
end $$;
create function pg_temp.uid159(p text) returns uuid language sql immutable
as $$select md5('ord130-'||p)::uuid$$;
create function pg_temp.ator159(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',pg_temp.uid159(p)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid159(p),
    'role','authenticated','session_id',pg_temp.uid159('sessao-'||p))::text,true);
end $$;
insert into auth.users(id,aud,role,email,created_at,updated_at)
select pg_temp.uid159(r),'authenticated','authenticated','ord130-'||r||'@example.invalid',now(),now()
from unnest(array['admin','admin-reserva','coord','gestor','ex-vinculado','suspenso','provisorio','fora']) r;
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.uid159('sessao-'||r),pg_temp.uid159(r),now(),now()
from unnest(array['admin','coord','gestor','ex-vinculado','suspenso','provisorio','fora']) r;
alter table public.perfis disable trigger kontrol_proteger_papel_perfil;
update public.perfis set nome='Fixture ORD130',suspenso=false,senha_provisoria=false,
  papel=case when id in (pg_temp.uid159('admin'),pg_temp.uid159('admin-reserva')) then 'admin'
    when id=pg_temp.uid159('coord') then 'coordenador'
    when id in (pg_temp.uid159('gestor'),pg_temp.uid159('suspenso'),pg_temp.uid159('provisorio')) then 'gestor'
    else 'laboratorio' end;
update public.perfis set suspenso=true where id=pg_temp.uid159('suspenso');
update public.perfis set senha_provisoria=true where id=pg_temp.uid159('provisorio');
alter table public.perfis enable trigger kontrol_proteger_papel_perfil;

do $$
declare
  projeto bigint; outro bigint; r jsonb; todos jsonb:='[]'; item jsonb;
  cursor_id uuid; anterior uuid; ids uuid[]:='{}'; n integer:=0; antes bigint;
begin
  insert into public.projetos(nome,coordenador_id) values('ORD130-A',pg_temp.uid159('coord')) returning id into projeto;
  insert into public.projetos(nome) values('ORD130-B') returning id into outro;
  -- Legado com vínculo e papel que mudou: deve aparecer para remoção, não
  -- como candidato implicitamente elegível a conceder um vínculo novo.
  insert into kontrol_private.projetos_vinculos values(projeto,pg_temp.uid159('ex-vinculado'));
  insert into kontrol_private.projetos_vinculos values(outro,pg_temp.uid159('fora'));
  select count(*) into antes from public.auditoria;

  perform pg_temp.ator159('gestor');
  set local role authenticated;
  begin
    perform public.listar_vinculos_projeto(projeto);
    raise exception '0159: não Admin leu vínculos';
  exception when insufficient_privilege then null;
  end;
  -- Mesmo uma claim informal de papel não substitui o perfil servidor.
  perform set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||'{"papel":"admin"}')::text,true);
  begin
    perform public.listar_vinculos_projeto(projeto);
    raise exception '0159: papel de cliente autorizou leitura';
  exception when insufficient_privilege then null;
  end;
  reset role;
  -- Existe outro Admin apto: não violar guarda de último Admin na preparação.
  perform pg_temp.ator159('admin');
  update public.perfis set suspenso=true where id=pg_temp.uid159('admin');
  set local role authenticated;
  begin
    perform public.listar_vinculos_projeto(projeto);
    raise exception '0159: Admin suspenso leu vínculos';
  exception when insufficient_privilege then null;
  end;
  reset role;
  update public.perfis set suspenso=false,senha_provisoria=true where id=pg_temp.uid159('admin');
  set local role authenticated;
  begin
    perform public.listar_vinculos_projeto(projeto);
    raise exception '0159: Admin provisório leu vínculos';
  exception when insufficient_privilege then null;
  end;
  reset role;
  update public.perfis set senha_provisoria=false where id=pg_temp.uid159('admin');
  select count(*) into antes from public.auditoria;

  perform pg_temp.ator159('admin');
  set local role authenticated;
  loop
    r:=public.listar_vinculos_projeto(projeto,cursor_id,2);
    if r->>'projeto_id' is distinct from projeto::text or jsonb_array_length(r->'itens')>2 then
      raise exception '0159: envelope/limite incorreto';
    end if;
    for item in select value from jsonb_array_elements(r->'itens') loop
      if item ? 'email' or item ? 'permissoes'
         or item-array['usuario_id','nome','papel','suspenso','senha_provisoria','vinculado','coordenacao_direta']<>'{}'::jsonb then
        raise exception '0159: projeção ampliou dados';
      end if;
      if (item->>'usuario_id')::uuid=any(ids)
         or (anterior is not null and (item->>'usuario_id')::uuid<=anterior) then
        raise exception '0159: repetição/ordem de página incorreta';
      end if;
      anterior:=(item->>'usuario_id')::uuid;
      ids:=array_append(ids,anterior); todos:=todos||jsonb_build_array(item);
    end loop;
    n:=n+1;
    if n>5 then raise exception '0159: cursor não terminou'; end if;
    cursor_id:=(r->>'proximo_usuario_id')::uuid;
    exit when cursor_id is null;
    if cursor_id is distinct from anterior then raise exception '0159: cursor não é último emitido'; end if;
  end loop;
  if cardinality(ids)<>5 or pg_temp.uid159('fora')=any(ids) or pg_temp.uid159('admin')=any(ids) then
    raise exception '0159: candidatos/vínculos de outro projeto vazaram';
  end if;
  if not exists(select 1 from jsonb_array_elements(todos) x where x->>'usuario_id'=pg_temp.uid159('coord')::text
      and x->'coordenacao_direta'='true'::jsonb and x->'vinculado'='false'::jsonb)
    or not exists(select 1 from jsonb_array_elements(todos) x where x->>'usuario_id'=pg_temp.uid159('ex-vinculado')::text
      and x->>'papel'='laboratorio' and x->'vinculado'='true'::jsonb)
    or not exists(select 1 from jsonb_array_elements(todos) x where x->>'usuario_id'=pg_temp.uid159('suspenso')::text and x->'suspenso'='true'::jsonb)
    or not exists(select 1 from jsonb_array_elements(todos) x where x->>'usuario_id'=pg_temp.uid159('provisorio')::text and x->'senha_provisoria'='true'::jsonb) then
    raise exception '0159: flags/candidato removível/coordenador incorretos';
  end if;
  r:=public.listar_vinculos_projeto(projeto,'ffffffff-ffff-ffff-ffff-ffffffffffff',2);
  if r->'itens'<>'[]'::jsonb or r->'proximo_usuario_id'<>'null'::jsonb then
    raise exception '0159: página final não é vazia explícita';
  end if;
  begin
    perform public.listar_vinculos_projeto(projeto,null,101);
    raise exception '0159: limite inválido aceito';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.listar_vinculos_projeto(9223372036854775807);
    raise exception '0159: projeto inexistente virou página vazia';
  exception when no_data_found then null;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid159('admin'),
    'role','authenticated','session_id',gen_random_uuid())::text,true);
  begin
    perform public.listar_vinculos_projeto(projeto);
    raise exception '0159: Admin sem sessão real aceito';
  exception when insufficient_privilege then null;
  end;
  reset role;
  if (select count(*) from public.auditoria)<>antes
     or (select count(*) from kontrol_private.projetos_vinculos)<>2 then
    raise exception '0159: consulta escreveu estado';
  end if;
  if has_function_privilege('anon','public.listar_vinculos_projeto(bigint,uuid,integer)','EXECUTE')
    or has_function_privilege('service_role','public.listar_vinculos_projeto(bigint,uuid,integer)','EXECUTE')
    or has_table_privilege('authenticated','kontrol_private.projetos_vinculos','SELECT') then
    raise exception '0159: ACL ampliada';
  end if;
end $$;
rollback;
