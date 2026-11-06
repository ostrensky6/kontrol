-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0121: acoes de orcamento aceitam "papel OU permissao efetiva".
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_papel text;
  v_uid uuid;
begin
  foreach v_papel in array array['tecnico', 'coordenador'] loop
    v_uid := md5('kontrol-0121-' || v_papel)::uuid;
    if exists (select 1 from auth.users where id = v_uid) then
      raise exception '0121: fixture % ja existe', v_papel;
    end if;
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
            'ts-0121-' || v_papel || '@example.invalid', now(), now());
    update public.perfis set papel = case when v_papel = 'tecnico' then 'laboratorio' else v_papel end, suspenso = false, permissoes = '{}'::jsonb
    where id = v_uid;
    if not found then raise exception '0121: perfil fixture % ausente', v_papel; end if;
  end loop;

  -- não depende do seed: o CI cria o banco sem dados
  insert into public.parametros (chave, valor) values ('ts_0121_parametro', 1);

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('transicionar_orcamento', 'transicionar_orcamento_projeto',
          'transicionar_orcamento_final', 'recalcular_orcamento_transacional',
          'duplicar_orcamento_final_transacional', 'emitir_orcamento_final_transacional')
        and case when p.prokind = 'f' then pg_get_functiondef(p.oid) end like '%fn_exige_papel(''coordenador'')%') > 0 then
    raise exception '0121: ainda ha RPC de orcamento exigindo so o papel';
  end if;
end $$;

set local role authenticated;

-- Tecnico sem permissao: recusado
select set_config('request.jwt.claim.sub', md5('kontrol-0121-tecnico')::uuid::text, true);
do $$
begin
  begin
    perform kontrol_private.exigir_papel_ou_permissao('coordenador', 'orcamentos.emitir');
    raise exception '0121: tecnico sem permissao passou';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.parametros set valor = valor where chave = 'ts_0121_parametro';
    if found then raise exception '0121: tecnico sem permissao alterou parametros'; end if;
  end;
end $$;

-- Coordenador sem caixas marcadas: o papel continua valendo
select set_config('request.jwt.claim.sub', md5('kontrol-0121-coordenador')::uuid::text, true);
do $$
begin
  perform kontrol_private.exigir_papel_ou_permissao('coordenador', 'orcamentos.cancelar');
end $$;

-- Tecnico com as caixas individuais marcadas: concedido
reset role;
update public.perfis
   set permissoes = '{"orcamentos.emitir": true, "orcamentos.cancelar": true, "orcamento.parametros.editar": true}'::jsonb
 where id = md5('kontrol-0121-tecnico')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', md5('kontrol-0121-tecnico')::uuid::text, true);
do $$
begin
  perform kontrol_private.exigir_papel_ou_permissao('coordenador', 'orcamentos.emitir');
  perform kontrol_private.exigir_papel_ou_permissao('coordenador', 'orcamentos.cancelar');
  update public.parametros set valor = valor where chave = 'ts_0121_parametro';
  if not found then raise exception '0121: tecnico com permissao nao alterou parametros'; end if;
end $$;

rollback;
