-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1
-- e PGCLIENTENCODING=UTF8.
-- Valida a 0138: edicao do catalogo de custos de projeto na tela (criar, editar,
-- arquivar/reativar, unificar, historico), com a identidade do item da 0137, a
-- permissao "Modelos e catalogos" para gravar e "Valores de pessoal no orcamento"
-- para valores de PE. Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0138-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0138-' || p_rotulo)::uuid,
                      'email', 'ts-0138-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated',
                      'app_metadata', json_build_object('senha_provisoria', false))::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Estrutura e grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.catalogo_projeto_salvar_item(text,text,text,text,text,numeric)',
    'public.catalogo_projeto_definir_ativo(text,boolean)',
    'public.catalogo_projeto_unificar(text,text)',
    'public.catalogo_projeto_historico(text)'
  ] loop
    if to_regprocedure(f) is null then
      raise exception '0138: funcao ausente: %', f;
    end if;
    if has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '0138: anon executa %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0138: authenticated sem EXECUTE em %', f;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
do $$
declare
  v_rotulo text;
begin
  foreach v_rotulo in array array['gestor_pessoal', 'modelos_sem_pessoal', 'sem_modelos'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0138-' || v_rotulo)::uuid,
            'authenticated', 'authenticated', 'ts-0138-' || v_rotulo || '@example.invalid', now(), now());
  end loop;
  update public.perfis set papel = 'gestor', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.modelos": true, "orcamentos.pessoal": true, "tecnicos.salario.ver": false}'::jsonb
   where id = md5('kontrol-0138-gestor_pessoal')::uuid;
  update public.perfis set papel = 'gestor', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.modelos": true, "orcamentos.pessoal": false, "tecnicos.salario.ver": false}'::jsonb
   where id = md5('kontrol-0138-modelos_sem_pessoal')::uuid;
  update public.perfis set papel = 'coordenador', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.modelos": false}'::jsonb
   where id = md5('kontrol-0138-sem_modelos')::uuid;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Sem "Modelos e catalogos" nao grava
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.como('sem_modelos');

do $$
begin
  begin
    perform public.catalogo_projeto_salvar_item(null, 'MC', 'TS-0138 Sem permissao', 'un', null, 1);
    raise exception '0138: gravou sem orcamentos.modelos';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Gestor com permissao de pessoal: criar, repetir, editar, unificar, arquivar
-- ---------------------------------------------------------------------------
select pg_temp.como('gestor_pessoal');

do $$
declare
  v_a text;
  v_b text;
  v_pe text;
  v_linhas integer;
begin
  v_a := public.catalogo_projeto_salvar_item(null, 'MC', '  TS-0138 Item A ', 'un', 'Grupo TS', 10);
  if v_a !~ '^MC-[0-9]+$' then raise exception '0138: codigo do item novo fora do padrao: %', v_a; end if;
  perform set_config('ts0138.a', v_a, true);

  begin
    perform public.catalogo_projeto_salvar_item(null, 'MC', 'ts-0138 item a', 'unid', null, 11);
    raise exception '0138: aceitou item repetido (mesma rubrica, descricao e unidade)';
  exception when unique_violation then null;
  end;

  perform public.catalogo_projeto_salvar_item(v_a, 'MC', 'TS-0138 Item A', 'un', 'Grupo TS', 12);
  perform public.catalogo_projeto_salvar_item(v_a, 'MC', 'TS-0138 Item A editado', 'un', 'Grupo TS', null);

  v_b := public.catalogo_projeto_salvar_item(null, 'MC', 'TS-0138 Item B', 'un', null, 20);
  perform set_config('ts0138.b', v_b, true);
  perform public.catalogo_projeto_unificar(v_a, v_b);
  begin
    perform public.catalogo_projeto_definir_ativo(v_b, true);
    raise exception '0138: reativou item unificado';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.catalogo_projeto_salvar_item(v_b, 'MC', 'TS-0138 Item B', 'un', null, 21);
    raise exception '0138: editou item unificado';
  exception when invalid_parameter_value then null;
  end;

  perform public.catalogo_projeto_definir_ativo(v_a, false);
  perform public.catalogo_projeto_definir_ativo(v_a, true);

  v_pe := public.catalogo_projeto_salvar_item(null, 'PE', 'TS-0138 Pessoa', 'mês', 'Doutor', 5000);
  perform set_config('ts0138.pe', v_pe, true);

  select count(*) into v_linhas from public.catalogo_projeto_historico(v_a) h where h.preco_unitario is not null;
  if v_linhas < 2 then raise exception '0138: historico de A incompleto: % linhas', v_linhas; end if;
  select count(*) into v_linhas from public.catalogo_projeto_historico(v_pe) h where h.preco_unitario = 5000;
  if v_linhas <> 1 then raise exception '0138: historico do pessoal deveria mostrar o valor para quem tem permissao'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Modelos sem permissao de pessoal: PE protegido, o resto livre
-- ---------------------------------------------------------------------------
select pg_temp.como('modelos_sem_pessoal');

do $$
declare
  v_preco numeric;
begin
  begin
    perform public.catalogo_projeto_salvar_item(current_setting('ts0138.pe'), 'PE', 'TS-0138 Pessoa', 'mês', 'Doutor', 6000);
    raise exception '0138: alterou valor de pessoal sem permissao';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.catalogo_projeto_salvar_item(null, 'PE', 'TS-0138 Outra pessoa', 'mês', null, 1000);
    raise exception '0138: criou pessoal sem permissao';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.catalogo_projeto_salvar_item(current_setting('ts0138.a'), 'PE', 'TS-0138 Item A editado', 'un', null, null);
    raise exception '0138: moveu item para pessoal sem permissao';
  exception when insufficient_privilege then null;
  end;
  -- descricao do pessoal pode mudar sem tocar no valor
  perform public.catalogo_projeto_salvar_item(current_setting('ts0138.pe'), 'PE', 'TS-0138 Pessoa (doutora)', 'mês', 'Doutora', null);
  select h.preco_unitario into v_preco from public.catalogo_projeto_historico(current_setting('ts0138.pe')) h limit 1;
  if v_preco is not null then raise exception '0138: historico expos valor de pessoal sem permissao'; end if;
  perform public.catalogo_projeto_salvar_item(null, 'MC', 'TS-0138 Item C', 'cx', null, 7);
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- 5. Estado final
-- ---------------------------------------------------------------------------
do $$
declare
  v_a text := current_setting('ts0138.a');
  v_b text := current_setting('ts0138.b');
  v_pe text := current_setting('ts0138.pe');
begin
  if not exists (select 1 from public.orcamento_projeto_catalogo
                  where id = v_a and descricao = 'TS-0138 Item A editado' and preco_unitario = 12 and ativo
                    and origem = 'cadastro_catalogo' and categoria = 'Grupo TS'
                    and valor_atualizado_por = 'ts-0138-gestor_pessoal@example.invalid'
                    and valor_origem_demanda_id is null) then
    raise exception '0138: item A gravado errado';
  end if;
  if (select count(*) from public.orcamento_projeto_catalogo_valores where catalogo_item_id = v_a and evento = 'edicao_catalogo') <> 1
     or not exists (select 1 from public.orcamento_projeto_catalogo_valores
                     where catalogo_item_id = v_a and evento = 'edicao_catalogo' and preco_unitario = 12 and preco_anterior = 10)
     or not exists (select 1 from public.orcamento_projeto_catalogo_valores
                     where catalogo_item_id = v_a and evento = 'item_novo' and preco_unitario = 10) then
    raise exception '0138: historico de A errado (so a troca de valor gera linha)';
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo where id = v_b and substituido_por = v_a and not ativo)
     or not exists (select 1 from public.orcamento_projeto_catalogo_valores where catalogo_item_id = v_b and evento = 'unificacao') then
    raise exception '0138: unificacao de B em A errada';
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo
                  where id = v_pe and descricao = 'TS-0138 Pessoa (doutora)' and preco_unitario = 5000 and categoria = 'Doutora') then
    raise exception '0138: pessoal alterado indevidamente';
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo where chave_descricao = 'ts-0138 item c' and chave_unidade = 'cx') then
    raise exception '0138: item C nao foi criado';
  end if;
  if exists (select 1 from public.orcamento_projeto_catalogo where chave_descricao in ('ts-0138 sem permissao', 'ts-0138 outra pessoa')) then
    raise exception '0138: item recusado ficou gravado';
  end if;
end $$;

rollback;
