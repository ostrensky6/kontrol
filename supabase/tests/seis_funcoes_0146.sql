-- SOMENTE banco descartável local; fixtures revertidas no ROLLBACK final.
\if :{?kontrol_test_local}
\else
  \echo '0146: falta acknowledgement de banco descartável local.'
  \quit 3
\endif
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_papel text;
  assinatura text;
  definicao text;
  uid uuid;
  n integer;
begin
  if inet_server_addr() is not null
     and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception '0146: alvo não local';
  end if;
  foreach assinatura in array array[
    'kontrol_private.tem_permissao_efetiva(text)',
    'kontrol_private.pode_editar_cadastro(text)',
    'kontrol_private.tem_permissao_do_usuario(uuid,text)'
  ] loop
    definicao := pg_get_functiondef(assinatura::regprocedure);
    -- 0151 acrescenta 'supervisor' à mesma lista; as duas formas valem.
    if (position('(''laboratorio'', ''compra'', ''cadastro'', ''coordenador'', ''gestor'')' in definicao) = 0
        and position('(''laboratorio'', ''compra'', ''cadastro'', ''coordenador'', ''gestor'', ''supervisor'')' in definicao) = 0)
       or position('(''tecnico'', ''coordenador'', ''gestor'')' in definicao) > 0 then
      raise exception '0146: reescrita ausente em %', assinatura;
    end if;
  end loop;
  select count(*) into n from pg_constraint
  where conname in ('perfis_papel_check', 'usuarios_pre_aprovados_papel_check', 'permissoes_categorias_papel_check')
    and conrelid in ('public.perfis'::regclass, 'public.usuarios_pre_aprovados'::regclass,
                    'public.permissoes_categorias'::regclass)
    and pg_get_constraintdef(oid) like '%laboratorio%'
    and pg_get_constraintdef(oid) like '%compra%'
    and pg_get_constraintdef(oid) like '%cadastro%'
    and pg_get_constraintdef(oid) not like '%tecnico%';
  if n <> 3 then raise exception '0146: CHECKs das três tabelas divergentes'; end if;
  if has_function_privilege('anon', 'kontrol_private.nivel_papel(text)', 'EXECUTE') then
    raise exception '0146: anon recebeu EXECUTE no helper';
  end if;
  if kontrol_private.nivel_papel('tecnico') <> 0
     or kontrol_private.nivel_papel('desconhecido') is not null then
    raise exception '0146: alias legado/negação de função desconhecida divergentes';
  end if;
  foreach v_papel in array array['laboratorio', 'compra', 'cadastro', 'coordenador', 'gestor', 'admin', 'suspenso'] loop
    uid := md5('kontrol-0146-' || v_papel)::uuid;
    if exists (select 1 from auth.users where id = uid) then
      raise exception '0146: fixture já existe';
    end if;
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
            'ts-0146-' || v_papel || '@example.invalid', now(), now());
    update public.perfis p
    set papel = case when v_papel = 'suspenso' then 'admin' else v_papel end,
        suspenso = (v_papel = 'suspenso'), permissoes = '{}'::jsonb
    where p.id = uid;
  end loop;
  begin
    update public.perfis set papel = 'tecnico' where id = md5('kontrol-0146-laboratorio')::uuid;
    raise exception '0146: CHECK aceitou papel antigo';
  exception when check_violation then null;
  end;
end $$;

create function pg_temp.como(papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0146-' || papel)::uuid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', md5('kontrol-0146-' || papel)::uuid, 'role', 'authenticated')::text, true);
end $$;

set local role authenticated;
do $$
declare
  papel text;
begin
  foreach papel in array array['laboratorio', 'compra', 'cadastro', 'coordenador', 'gestor', 'admin'] loop
    perform pg_temp.como(papel);
    if public.current_papel() is distinct from papel then
      raise exception '0146: identidade divergente para %', papel;
    end if;
    perform public.fn_exige_papel('tecnico'); -- alias histórico continua válido
    if papel in ('laboratorio', 'compra', 'cadastro') then
      begin
        perform public.fn_exige_papel('coordenador');
        raise exception '0146: função de base alcançou coordenador';
      exception when insufficient_privilege then null;
      end;
    else
      perform public.fn_exige_papel('coordenador');
    end if;
    if papel in ('compra', 'cadastro') then
      if public.tem_permissao('tecnicos.salario.ver')
         or public.tem_permissao('orcamentos.pessoal')
         or public.tem_permissao('orcamentos.visualizar')
         or public.tem_permissao('auditoria.visualizar') then
        raise exception '0146: função nova ganhou acesso sigiloso';
      end if;
      if papel = 'compra' and (not public.tem_permissao('compras.receber')
          or public.tem_permissao('cadastros.editar')) then
        raise exception '0146: padrão Compra divergente';
      end if;
      if papel = 'cadastro' and (not public.tem_permissao('cadastros.editar')
          or not public.tem_permissao('insumos.editar') or public.tem_permissao('compras.receber')) then
        raise exception '0146: padrão Cadastro divergente';
      end if;
    end if;
    if papel = 'admin' and not public.tem_permissao('auditoria.visualizar') then
      raise exception '0146: administrador perdeu acesso';
    end if;
  end loop;
  perform pg_temp.como('suspenso');
  if public.current_papel() is not null or public.tem_permissao('compras.receber') then
    raise exception '0146: suspenso manteve acesso';
  end if;
end $$;

reset role;
update public.perfis set permissoes = '{"compras.receber": false}'::jsonb
where id = md5('kontrol-0146-compra')::uuid;
set local role authenticated;
select pg_temp.como('compra');
do $$ begin
  if public.tem_permissao('compras.receber') then
    raise exception '0146: exceção individual negativa ignorada';
  end if;
end $$;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
do $$ begin
  if public.tem_permissao('compras.receber') or public.papel_minimo('tecnico') then
    raise exception '0146: sem sessão manteve acesso';
  end if;
end $$;
reset role;
rollback;
