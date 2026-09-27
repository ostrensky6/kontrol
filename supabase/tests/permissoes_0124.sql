-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0124: a caixinha manda nos dois sentidos (concede e retira), os
-- padroes por papel reproduzem o acesso anterior e a leitura de orcamentos
-- depende de "Orcamentos: Visualizar". Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_rotulo text;
  v_uid uuid;
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.proname <> 'fn_exige_papel'
      and case when p.prokind = 'f' then pg_get_functiondef(p.oid) end ~ 'fn_exige_papel\('
  ) then
    raise exception '0124: ainda ha RPC checando so o papel';
  end if;

  foreach v_rotulo in array array['tecnico', 'tecnico_descarta', 'tecnico_sem_orcamento', 'coordenador', 'coordenador_sem_aceite'] loop
    v_uid := md5('kontrol-0124-' || v_rotulo)::uuid;
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
            'ts-0124-' || v_rotulo || '@example.invalid', now(), now());
    update public.perfis
       set papel = case when v_rotulo like 'tecnico%' then 'tecnico' else 'coordenador' end,
           suspenso = false,
           permissoes = case v_rotulo
             when 'tecnico_descarta' then '{"estoque.descartar_bloquear": true}'::jsonb
             when 'tecnico_sem_orcamento' then '{"orcamentos.visualizar": false}'::jsonb
             when 'coordenador_sem_aceite' then '{"estoque.lote.aceitar": false}'::jsonb
             else '{}'::jsonb end
     where id = v_uid;
  end loop;

  insert into public.insumos (especificacao, unidade, fator_conversao) values ('TS-0124 Insumo', 'un', 1);
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status)
  select id, c, 5, 5, s from public.insumos,
    (values ('TS-0124-A', 'aceito'), ('TS-0124-B', 'aceito'), ('TS-0124-Q', 'quarentena')) v(c, s)
  where especificacao = 'TS-0124 Insumo';
  insert into public.demandas_propostas (titulo) values ('TS-0124 proposta');
end $$;

set local role authenticated;

-- Tecnico pelo padrao do papel: da baixa, nao descarta
select set_config('request.jwt.claim.sub', md5('kontrol-0124-tecnico')::uuid::text, true);
do $$
declare
  v_perm jsonb := public.minhas_permissoes();
begin
  if (v_perm -> 'permissoes' ->> 'estoque.movimentar')::boolean is not true
     or (v_perm -> 'permissoes' ->> 'estoque.descartar_bloquear')::boolean is not false then
    raise exception '0124: padrao do tecnico nao reproduz o acesso anterior: %', v_perm;
  end if;
  perform public.baixa_manual_lote((select id from public.lotes_estoque where codigo_lote = 'TS-0124-A'), 1, 'uso');
  begin
    perform public.descartar_lote((select id from public.lotes_estoque where codigo_lote = 'TS-0124-A'), 'teste');
    raise exception '0124: tecnico sem a caixinha descartou';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.demandas_propostas where titulo = 'TS-0124 proposta') <> 1 then
    raise exception '0124: tecnico com Orcamentos: Visualizar deveria ler a proposta';
  end if;
end $$;

-- A caixinha concede alem do papel
select set_config('request.jwt.claim.sub', md5('kontrol-0124-tecnico_descarta')::uuid::text, true);
do $$
begin
  perform public.descartar_lote((select id from public.lotes_estoque where codigo_lote = 'TS-0124-B'), 'teste');
end $$;

-- A caixinha desmarcada retira o que o papel dava
select set_config('request.jwt.claim.sub', md5('kontrol-0124-tecnico_sem_orcamento')::uuid::text, true);
do $$
begin
  if (select count(*) from public.demandas_propostas where titulo = 'TS-0124 proposta') <> 0 then
    raise exception '0124: sem Orcamentos: Visualizar a proposta nao deveria aparecer';
  end if;
end $$;

select set_config('request.jwt.claim.sub', md5('kontrol-0124-coordenador_sem_aceite')::uuid::text, true);
do $$
begin
  begin
    perform public.aceitar_lote((select id from public.lotes_estoque where codigo_lote = 'TS-0124-Q'), 'x', 'y');
    raise exception '0124: coordenador sem a caixinha aceitou o lote';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 0130: sem quarentena; o lote que tentou entrar em quarentena já está disponível.
select set_config('request.jwt.claim.sub', md5('kontrol-0124-coordenador')::uuid::text, true);
do $$
begin
  if (select status from public.lotes_estoque where codigo_lote = 'TS-0124-Q') <> 'aceito' then
    raise exception '0124/0130: lote deveria entrar disponivel, sem quarentena';
  end if;
end $$;

reset role;
rollback;
