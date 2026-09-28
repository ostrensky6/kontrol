-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1
-- e PGCLIENTENCODING=UTF8.
-- Valida a 0140: linha de pessoal (PE) do orcamento de projeto so e lancada, alterada ou
-- removida com a permissao de pessoal; as demais rubricas, o vinculo com o catalogo, a
-- manutencao sem usuario e a exclusao em cascata continuam livres. Tudo e revertido no ROLLBACK.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0140-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0140-' || p_rotulo)::uuid,
                      'email', 'ts-0140-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated',
                      'app_metadata', json_build_object('senha_provisoria', false))::text, true);
end $$;

create function pg_temp.sem_usuario() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create function pg_temp.recusa(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege then
  return true;
end $$;

-- Estrutura
do $$
begin
  if to_regprocedure('kontrol_private.proteger_pessoal_custos_projeto()') is null then
    raise exception '0140: funcao ausente';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'kontrol_proteger_pessoal_custos_projeto') then
    raise exception '0140: gatilho ausente';
  end if;
  if has_function_privilege('authenticated', 'kontrol_private.proteger_pessoal_custos_projeto()', 'EXECUTE') then
    raise exception '0140: funcao do gatilho exposta';
  end if;
end $$;

-- Fixtures como owner, sem usuario (manutencao livre)
do $$
declare
  v_rotulo text;
  v_demanda bigint;
  v_projeto bigint;
  v_linha bigint;
begin
  foreach v_rotulo in array array['coord', 'tecnico'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0140-' || v_rotulo)::uuid,
            'authenticated', 'authenticated', 'ts-0140-' || v_rotulo || '@example.invalid', now(), now());
  end loop;
  update public.perfis set papel = 'coordenador', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": true, "orcamentos.pessoal": true}'::jsonb
   where id = md5('kontrol-0140-coord')::uuid;
  update public.perfis set papel = 'tecnico', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": true, "orcamentos.pessoal": false, "tecnicos.salario.ver": false}'::jsonb
   where id = md5('kontrol-0140-tecnico')::uuid;

  insert into public.demandas_propostas (titulo, cliente_nome, status, modalidade)
  values ('TS-0140 proposta', 'Cliente TS-0140', 'orcada', 'projeto')
  returning id into v_demanda;
  insert into public.orcamento_projetos (demanda_id, titulo) values (v_demanda, 'TS-0140 projeto')
  returning id into v_projeto;
  perform set_config('ts0140.projeto', v_projeto::text, true);

  insert into public.orcamento_projeto_custos
    (orcamento_projeto_id, categoria, rubrica, descricao, quantidade, unidade, custo_unitario, preco_unitario, origem)
  values (v_projeto, 'mao_obra', 'PE', 'TS-0140 Pesquisador', 1, 'mês', 9000, 9000, 'manual')
  returning id into v_linha;
  perform set_config('ts0140.pe', v_linha::text, true);
  insert into public.orcamento_projeto_custos
    (orcamento_projeto_id, categoria, rubrica, descricao, quantidade, unidade, custo_unitario, preco_unitario, origem)
  values (v_projeto, 'materiais', 'MC', 'TS-0140 Reagente', 2, 'un', 100, 100, 'manual')
  returning id into v_linha;
  perform set_config('ts0140.mc', v_linha::text, true);
end $$;

-- Tecnico (sem permissao de pessoal): PE recusado, MC livre
select pg_temp.como('tecnico');
do $$
declare
  v_projeto text := current_setting('ts0140.projeto');
  v_pe text := current_setting('ts0140.pe');
  v_mc text := current_setting('ts0140.mc');
begin
  if not pg_temp.recusa(format(
       $q$insert into public.orcamento_projeto_custos (orcamento_projeto_id, categoria, rubrica, descricao, quantidade, custo_unitario, preco_unitario, origem)
          values (%s, 'mao_obra', 'PE', 'TS-0140 Bolsista', 1, 4000, 4000, 'manual')$q$, v_projeto)) then
    raise exception '0140: tecnico inseriu pessoal';
  end if;
  if not pg_temp.recusa(format('update public.orcamento_projeto_custos set custo_unitario = 1 where id = %s', v_pe)) then
    raise exception '0140: tecnico alterou valor de pessoal';
  end if;
  if not pg_temp.recusa(format('update public.orcamento_projeto_custos set meses_selecionados = ''{1,2}'' where id = %s', v_pe)) then
    raise exception '0140: tecnico marcou meses de pessoal';
  end if;
  if not pg_temp.recusa(format('update public.orcamento_projeto_custos set rubrica = ''PE'' where id = %s', v_mc)) then
    raise exception '0140: tecnico trocou linha para pessoal';
  end if;
  if not pg_temp.recusa(format('delete from public.orcamento_projeto_custos where id = %s', v_pe)) then
    raise exception '0140: tecnico removeu pessoal';
  end if;
  -- Outras rubricas e o vinculo com o catalogo seguem livres.
  update public.orcamento_projeto_custos set quantidade = 3 where id = v_mc::bigint;
  update public.orcamento_projeto_custos set catalogo_valor_base = 9000 where id = v_pe::bigint;
  insert into public.orcamento_projeto_custos (orcamento_projeto_id, categoria, rubrica, descricao, quantidade, custo_unitario, preco_unitario, origem)
  values (v_projeto::bigint, 'terceiros', 'ST', 'TS-0140 Frete', 1, 50, 50, 'manual');
end $$;

-- Coordenador com a permissao: lanca, altera e remove pessoal
select pg_temp.como('coord');
do $$
declare
  v_pe bigint := current_setting('ts0140.pe')::bigint;
  v_novo bigint;
begin
  update public.orcamento_projeto_custos set custo_unitario = 9500, preco_unitario = 9500, meses_selecionados = '{1,2,3}' where id = v_pe;
  insert into public.orcamento_projeto_custos (orcamento_projeto_id, categoria, rubrica, descricao, quantidade, custo_unitario, preco_unitario, origem)
  values (current_setting('ts0140.projeto')::bigint, 'mao_obra', 'PE', 'TS-0140 Bolsista', 1, 4000, 4000, 'manual')
  returning id into v_novo;
  delete from public.orcamento_projeto_custos where id = v_novo;
  if (select custo_unitario from public.orcamento_projeto_custos where id = v_pe) <> 9500 then
    raise exception '0140: coordenador nao alterou pessoal';
  end if;
end $$;

-- Exclusao do orcamento inteiro (cascata) nao e barrada pelo pessoal, nem sem usuario
select pg_temp.como('tecnico');
do $$
begin
  if exists (select 1 from information_schema.referential_constraints rc
               join information_schema.key_column_usage k on k.constraint_name = rc.constraint_name
              where k.table_name = 'orcamento_projeto_custos' and k.column_name = 'orcamento_projeto_id'
                and rc.delete_rule = 'CASCADE') then
    delete from public.orcamento_projetos where id = current_setting('ts0140.projeto')::bigint;
    if exists (select 1 from public.orcamento_projeto_custos where id = current_setting('ts0140.pe')::bigint) then
      raise exception '0140: cascata nao removeu pessoal';
    end if;
  end if;
end $$;

select pg_temp.sem_usuario();
do $$
begin
  update public.orcamento_projeto_custos set custo_unitario = custo_unitario where rubrica = 'PE' and descricao like 'TS-0140%';
end $$;

select '0140 ok' as resultado;
rollback;
