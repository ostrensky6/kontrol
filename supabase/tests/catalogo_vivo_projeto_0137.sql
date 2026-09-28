-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1
-- e PGCLIENTENCODING=UTF8. Os valores de referencia (MC-6, MC-14, MC-30, MC-36) sao os da
-- carga da 0012 (banco novo do CI).
-- Valida a 0137: identidade do item, unificacao dos repetidos, historico, previa e
-- conclusao (item novo, valor alterado, vinculo, repetido no orcamento, vale o ultimo a
-- concluir, linha nao alterada nao desfaz valor mais novo, pessoal sem permissao pendente)
-- e permissoes. Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0137-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0137-' || p_rotulo)::uuid,
                      'email', 'ts-0137-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated',
                      'app_metadata', json_build_object('senha_provisoria', false))::text, true);
end $$;

create function pg_temp.linha(p_orc text, p_rubrica text, p_descricao text, p_unidade text,
                              p_valor numeric, p_item text default null, p_base numeric default null)
returns bigint language plpgsql as $$
declare
  v_id bigint;
begin
  insert into public.orcamento_projeto_custos
    (orcamento_projeto_id, categoria, rubrica, descricao, quantidade, unidade, custo_unitario,
     preco_unitario, catalogo_item_id, catalogo_valor_base, origem)
  values (current_setting('ts0137.' || p_orc)::bigint,
          case p_rubrica when 'PE' then 'mao_obra' when 'ST' then 'terceiros' else 'materiais' end,
          p_rubrica, p_descricao, 1, p_unidade, p_valor, p_valor, p_item, p_base,
          case when p_item is null then 'manual' else 'catalogo' end)
  returning id into v_id;
  return v_id;
end $$;

create function pg_temp.acao(p_orc text, p_linha text) returns text language sql as $$
  select acao from public.previa_catalogo_revisao_projeto(current_setting('ts0137.' || p_orc)::bigint)
   where linha_id = current_setting('ts0137.' || p_linha)::bigint
$$;

-- ---------------------------------------------------------------------------
-- 1. Estrutura, grants e normalizacao
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.previa_catalogo_revisao_projeto(bigint)',
    'public.concluir_revisao_custos_projeto(bigint,text)',
    'public.orcamento_projeto_catalogo_listar()'
  ] loop
    if to_regprocedure(f) is null then
      raise exception '0137: funcao ausente: %', f;
    end if;
    if has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '0137: anon executa %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0137: authenticated sem EXECUTE em %', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'kontrol_private.plano_catalogo_revisao(bigint)', 'EXECUTE') then
    raise exception '0137: plano interno exposto a authenticated';
  end if;
  if to_regprocedure('kontrol_private.pode_ver_pessoal_orcamento()') is null then
    raise exception '0137: regra de pessoal no orcamento ausente';
  end if;
  if (select permissoes -> 'orcamentos.pessoal' from public.permissoes_categorias where papel = 'coordenador') is distinct from 'true'::jsonb
     or (select permissoes -> 'orcamentos.pessoal' from public.permissoes_categorias where papel = 'gestor') is distinct from 'true'::jsonb
     or (select permissoes -> 'orcamentos.pessoal' from public.permissoes_categorias where papel = 'tecnico') = 'true'::jsonb then
    raise exception '0137: padrao das categorias para valores de pessoal (coordenador e gestor sim, tecnico nao)';
  end if;
  if has_table_privilege('authenticated', 'public.orcamento_projeto_catalogo_valores', 'SELECT')
     or has_table_privilege('authenticated', 'public.orcamento_projeto_catalogo_valores', 'INSERT') then
    raise exception '0137: historico de valores com acesso direto';
  end if;
  if has_column_privilege('authenticated', 'public.orcamento_projeto_catalogo', 'preco_unitario', 'SELECT') then
    raise exception '0137: preco do catalogo voltou a ser legivel direto (0112)';
  end if;
  if not has_column_privilege('authenticated', 'public.orcamento_projeto_catalogo', 'valor_atualizado_em', 'SELECT') then
    raise exception '0137: origem do valor ilegivel';
  end if;
  if to_regclass('public.orcamento_projeto_catalogo_item_unico_uidx') is null then
    raise exception '0137: indice unico do item ausente';
  end if;

  if kontrol_private.normalizar_texto_catalogo('  Álcool   ETÍLICO ') <> 'alcool etilico'
     or kontrol_private.normalizar_texto_catalogo('   ') is not null then
    raise exception '0137: normalizacao da descricao';
  end if;
  if kontrol_private.normalizar_unidade_catalogo('Litro') <> 'l'
     or kontrol_private.normalizar_unidade_catalogo('unid.') <> 'un'
     or kontrol_private.normalizar_unidade_catalogo(null) <> 'un'
     or kontrol_private.normalizar_unidade_catalogo('Meses') <> 'mes'
     or kontrol_private.normalizar_unidade_catalogo('pct c/ 500') <> 'pct c/ 500' then
    raise exception '0137: normalizacao da unidade';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Unificacao dos repetidos e carga inicial do historico
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from public.orcamento_projeto_catalogo
     where substituido_por is null and chave_descricao is not null
     group by rubrica, chave_descricao, chave_unidade
    having count(*) > 1
  ) then
    raise exception '0137: item repetido sem unificar';
  end if;
  if exists (
    select 1
      from public.orcamento_projeto_catalogo u
      join public.orcamento_projeto_catalogo k on k.id = u.substituido_por
     where u.ativo
        or k.substituido_por is not null
        or (k.rubrica, k.chave_descricao, k.chave_unidade)
           is distinct from (u.rubrica, u.chave_descricao, u.chave_unidade)
  ) then
    raise exception '0137: unificacao fora da regra (mesmo item, destino vigente, unificado inativo)';
  end if;
  if exists (select 1 from public.orcamento_projeto_catalogo where id = 'MC-14' and preco_unitario = 150)
     and exists (select 1 from public.orcamento_projeto_catalogo where id = 'MC-30' and preco_unitario = 80)
     and (select substituido_por from public.orcamento_projeto_catalogo where id = 'MC-30') is distinct from 'MC-14' then
    raise exception '0137: Caixa termica repetida nao ficou com o maior valor (DC1)';
  end if;
  if exists (
    select 1 from public.orcamento_projeto_catalogo c
     where not exists (select 1 from public.orcamento_projeto_catalogo_valores v where v.catalogo_item_id = c.id)
  ) then
    raise exception '0137: item sem historico de valor';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures (como owner; nao dependem de seed alem da carga da 0012)
-- ---------------------------------------------------------------------------
do $$
declare
  v_rotulo text;
  v_nome text;
  v_demanda bigint;
  v_projeto bigint;
begin
  foreach v_rotulo in array array['coord_pessoal', 'coord_sem', 'tecnico'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0137-' || v_rotulo)::uuid,
            'authenticated', 'authenticated', 'ts-0137-' || v_rotulo || '@example.invalid', now(), now());
  end loop;
  update public.perfis set papel = 'coordenador', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": true, "orcamentos.emitir": true, "orcamentos.pessoal": true, "tecnicos.salario.ver": false}'::jsonb
   where id = md5('kontrol-0137-coord_pessoal')::uuid;
  update public.perfis set papel = 'coordenador', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": true, "orcamentos.emitir": true, "orcamentos.pessoal": false, "tecnicos.salario.ver": false}'::jsonb
   where id = md5('kontrol-0137-coord_sem')::uuid;
  update public.perfis set papel = 'tecnico', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": true, "orcamentos.emitir": false}'::jsonb
   where id = md5('kontrol-0137-tecnico')::uuid;

  -- Um orcamento de projeto por proposta (indice de modulo ativo da 0126).
  foreach v_nome in array array['a', 'b', 'c', 'd', 'e', 'f'] loop
    insert into public.demandas_propostas (titulo, cliente_nome, status, modalidade)
    values ('TS-0137 proposta ' || v_nome, 'Cliente TS-0137', 'orcada', 'projeto')
    returning id into v_demanda;
    insert into public.orcamento_projetos (demanda_id, titulo)
    values (v_demanda, 'TS-0137 projeto ' || v_nome)
    returning id into v_projeto;
    perform set_config('ts0137.' || v_nome, v_projeto::text, true);
    perform set_config('ts0137.demanda_' || v_nome, v_demanda::text, true);
  end loop;

  -- A (coord_pessoal): novo, inalterado, atualizar, vincular, pessoal novo
  perform set_config('ts0137.a1', pg_temp.linha('a', 'MC', 'TS-0137 Reagente Alfa', 'un', 100)::text, true);
  perform set_config('ts0137.a2', pg_temp.linha('a', 'MC', 'Álcool etílico', 'litro', 130, 'MC-36', 130)::text, true);
  perform set_config('ts0137.a3', pg_temp.linha('a', 'MC', 'Papel toalha', 'fardo', 55, 'MC-6', 50)::text, true);
  perform set_config('ts0137.a4', pg_temp.linha('a', 'MC', 'alcool ETILICO', 'Litro', 130)::text, true);
  perform set_config('ts0137.a5', pg_temp.linha('a', 'PE', 'TS-0137 Pesquisador', 'mês', 9000)::text, true);
  -- B (coord_sem): pessoal sem permissao fica pendente; material novo entra
  perform set_config('ts0137.b1', pg_temp.linha('b', 'PE', 'TS-0137 Bolsista', 'mês', 4000)::text, true);
  perform set_config('ts0137.b2', pg_temp.linha('b', 'MC', 'TS-0137 Reagente Beta', 'un', 200)::text, true);
  -- C e D: mesmo item novo com valores diferentes; D conclui antes, C depois
  perform set_config('ts0137.c1', pg_temp.linha('c', 'MC', 'TS-0137 Reagente Gama', 'un', 100)::text, true);
  perform set_config('ts0137.d1', pg_temp.linha('d', 'MC', 'ts-0137 reagente  GAMA', 'UN', 120)::text, true);
  -- E: linha antiga do catalogo, sem alteracao (Papel toalha a 50)
  perform set_config('ts0137.e1', pg_temp.linha('e', 'MC', 'Papel toalha', 'fardo', 50, 'MC-6', 50)::text, true);
  -- F: o mesmo item duas vezes no mesmo orcamento; vale a ultima linha
  perform set_config('ts0137.f1', pg_temp.linha('f', 'ST', 'TS-0137 Frete', 'un', 300)::text, true);
  perform set_config('ts0137.f2', pg_temp.linha('f', 'ST', 'TS-0137 frete', 'unid', 350)::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Tecnico sem orcamentos.emitir nao conclui
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.como('tecnico');

do $$
begin
  begin
    perform public.concluir_revisao_custos_projeto(current_setting('ts0137.a')::bigint, null);
    raise exception '0137: tecnico sem orcamentos.emitir concluiu a revisao';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Coordenador com "Valores de pessoal no orcamento" (sem salario dos tecnicos):
--    previa e conclusao de A, D, C, E, F
-- ---------------------------------------------------------------------------
select pg_temp.como('coord_pessoal');

do $$
declare
  v_catalogo numeric;
  v_resultado jsonb;
begin
  if pg_temp.acao('a', 'a1') <> 'novo' then raise exception '0137: a1 deveria ser novo'; end if;
  if pg_temp.acao('a', 'a2') <> 'inalterado' then raise exception '0137: a2 deveria ser inalterado'; end if;
  if pg_temp.acao('a', 'a3') <> 'atualizar' then raise exception '0137: a3 deveria atualizar'; end if;
  if pg_temp.acao('a', 'a4') <> 'vincular' then raise exception '0137: a4 deveria vincular ao MC-36'; end if;
  if pg_temp.acao('a', 'a5') <> 'novo' then raise exception '0137: a5 (pessoal, com permissao) deveria ser novo'; end if;
  select valor_catalogo into v_catalogo
    from public.previa_catalogo_revisao_projeto(current_setting('ts0137.a')::bigint)
   where linha_id = current_setting('ts0137.a3')::bigint;
  if v_catalogo is distinct from 50 then raise exception '0137: previa sem o valor atual do catalogo (50): %', v_catalogo; end if;

  v_resultado := public.concluir_revisao_custos_projeto(current_setting('ts0137.a')::bigint, null);
  if v_resultado <> '{"novos": 2, "atualizados": 1, "pendentes": 0, "repetidos": 0}'::jsonb then
    raise exception '0137: resumo da conclusao de A: %', v_resultado;
  end if;

  begin
    perform public.concluir_revisao_custos_projeto(current_setting('ts0137.a')::bigint, null);
    raise exception '0137: concluiu de novo uma revisao ja concluida';
  exception when invalid_parameter_value then null;
  end;

  -- vale o ultimo a concluir: D (120) antes, C (100) depois
  perform public.concluir_revisao_custos_projeto(current_setting('ts0137.d')::bigint, null);
  perform public.concluir_revisao_custos_projeto(current_setting('ts0137.c')::bigint, null);

  -- linha antiga nao desfaz: E mantem 50, o catalogo ja tem 55 (de A)
  if pg_temp.acao('e', 'e1') <> 'inalterado' then raise exception '0137: e1 deveria ser inalterado'; end if;
  select valor_catalogo into v_catalogo
    from public.previa_catalogo_revisao_projeto(current_setting('ts0137.e')::bigint)
   where linha_id = current_setting('ts0137.e1')::bigint;
  if v_catalogo is distinct from 55 then raise exception '0137: e1 deveria mostrar o valor mais novo (55): %', v_catalogo; end if;
  perform public.concluir_revisao_custos_projeto(current_setting('ts0137.e')::bigint, null);

  -- repetido no mesmo orcamento
  if pg_temp.acao('f', 'f1') <> 'repetido' or pg_temp.acao('f', 'f2') <> 'novo' then
    raise exception '0137: F deveria ter f1 repetido e f2 novo';
  end if;
  v_resultado := public.concluir_revisao_custos_projeto(current_setting('ts0137.f')::bigint, null);
  if v_resultado <> '{"novos": 1, "atualizados": 0, "pendentes": 0, "repetidos": 1}'::jsonb then
    raise exception '0137: resumo da conclusao de F: %', v_resultado;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Coordenador sem "Valores de pessoal no orcamento": pessoal mascarado e pendente
-- ---------------------------------------------------------------------------
select pg_temp.como('coord_sem');

do $$
declare
  v_catalogo numeric;
  v_resultado jsonb;
begin
  if pg_temp.acao('b', 'b1') <> 'pendente_permissao' then raise exception '0137: b1 deveria ficar pendente'; end if;
  if pg_temp.acao('b', 'b2') <> 'novo' then raise exception '0137: b2 deveria ser novo'; end if;
  select valor_catalogo into v_catalogo
    from public.previa_catalogo_revisao_projeto(current_setting('ts0137.a')::bigint)
   where linha_id = current_setting('ts0137.a5')::bigint;
  if v_catalogo is not null then raise exception '0137: valor de pessoal exposto sem permissao'; end if;
  v_resultado := public.concluir_revisao_custos_projeto(current_setting('ts0137.b')::bigint, null);
  if v_resultado <> '{"novos": 1, "atualizados": 0, "pendentes": 1, "repetidos": 0}'::jsonb then
    raise exception '0137: resumo da conclusao de B: %', v_resultado;
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- 6. Estado final do catalogo, do historico e das linhas
-- ---------------------------------------------------------------------------
do $$
declare
  v_alfa text;
  v_gama text;
  v_frete text;
begin
  select id into v_alfa from public.orcamento_projeto_catalogo
   where rubrica = 'MC' and chave_descricao = 'ts-0137 reagente alfa' and substituido_por is null;
  if v_alfa is null
     or v_alfa !~ '^MC-[0-9]+$' or substring(v_alfa from 4)::int < 101
     or not exists (
       select 1 from public.orcamento_projeto_catalogo
        where id = v_alfa and preco_unitario = 100 and origem = 'revisao_custos' and ativo
          and valor_atualizado_por = 'ts-0137-coord_pessoal@example.invalid'
          and valor_origem_demanda_id = current_setting('ts0137.demanda_a')::bigint
          and valor_origem_orcamento_projeto_id = current_setting('ts0137.a')::bigint) then
    raise exception '0137: item novo de A gravado errado (%)', v_alfa;
  end if;
  if (select catalogo_item_id from public.orcamento_projeto_custos where id = current_setting('ts0137.a1')::bigint) is distinct from v_alfa
     or (select catalogo_valor_base from public.orcamento_projeto_custos where id = current_setting('ts0137.a1')::bigint) is distinct from 100 then
    raise exception '0137: linha a1 nao ficou ligada ao item novo';
  end if;
  if (select catalogo_item_id from public.orcamento_projeto_custos where id = current_setting('ts0137.a4')::bigint) is distinct from 'MC-36'
     or (select preco_unitario from public.orcamento_projeto_catalogo where id = 'MC-36') <> 130 then
    raise exception '0137: vinculo de a4 ao MC-36 errado';
  end if;
  if (select preco_unitario from public.orcamento_projeto_catalogo where id = 'MC-6') <> 55 then
    raise exception '0137: Papel toalha deveria ficar em 55 (A alterou; E, sem alteracao, nao desfaz)';
  end if;
  if not exists (
    select 1 from public.orcamento_projeto_catalogo_valores
     where catalogo_item_id = 'MC-6' and evento = 'valor_alterado' and preco_unitario = 55 and preco_anterior = 50
       and orcamento_projeto_id = current_setting('ts0137.a')::bigint and aplicado
  ) then
    raise exception '0137: historico da alteracao do MC-6 ausente';
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo
                  where rubrica = 'PE' and chave_descricao = 'ts-0137 pesquisador' and preco_unitario = 9000) then
    raise exception '0137: pessoal concluido com permissao nao entrou no catalogo';
  end if;
  if (select status from public.orcamento_projetos where id = current_setting('ts0137.a')::bigint) <> 'enviado'
     or not exists (select 1 from public.eventos_status
                     where entidade = 'orcamento_projeto' and entidade_id = current_setting('ts0137.a')::bigint
                       and para_status = 'enviado') then
    raise exception '0137: conclusao nao passou pela transicao de status';
  end if;

  -- B: pessoal pendente, sem item no catalogo
  if exists (select 1 from public.orcamento_projeto_catalogo where chave_descricao = 'ts-0137 bolsista') then
    raise exception '0137: pessoal sem permissao entrou no catalogo';
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo_valores
                  where evento = 'pendente_permissao' and not aplicado and preco_unitario = 4000
                    and descricao = 'TS-0137 Bolsista'
                    and demanda_id = current_setting('ts0137.demanda_b')::bigint) then
    raise exception '0137: pendencia de pessoal nao registrada';
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo
                  where rubrica = 'MC' and chave_descricao = 'ts-0137 reagente beta' and preco_unitario = 200) then
    raise exception '0137: material novo de B nao entrou';
  end if;

  -- C e D: vale o ultimo a concluir
  select id into v_gama from public.orcamento_projeto_catalogo
   where rubrica = 'MC' and chave_descricao = 'ts-0137 reagente gama' and substituido_por is null;
  if (select preco_unitario from public.orcamento_projeto_catalogo where id = v_gama) <> 100 then
    raise exception '0137: vale o ultimo a concluir (C = 100)';
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo_valores where catalogo_item_id = v_gama
                  and evento = 'item_novo' and preco_unitario = 120
                  and orcamento_projeto_id = current_setting('ts0137.d')::bigint)
     or not exists (select 1 from public.orcamento_projeto_catalogo_valores where catalogo_item_id = v_gama
                     and evento = 'valor_alterado' and preco_unitario = 100 and preco_anterior = 120
                     and orcamento_projeto_id = current_setting('ts0137.c')::bigint) then
    raise exception '0137: historico de C e D incompleto';
  end if;
  if (select count(*) from public.orcamento_projeto_custos
       where id in (current_setting('ts0137.c1')::bigint, current_setting('ts0137.d1')::bigint)
         and catalogo_item_id = v_gama) <> 2 then
    raise exception '0137: linhas de C e D nao ficaram no mesmo item';
  end if;

  -- F: um item so, com o valor da ultima linha; as duas linhas ligadas
  select id into v_frete from public.orcamento_projeto_catalogo
   where rubrica = 'ST' and chave_descricao = 'ts-0137 frete' and chave_unidade = 'un' and substituido_por is null;
  if (select preco_unitario from public.orcamento_projeto_catalogo where id = v_frete) <> 350 then
    raise exception '0137: repetido no orcamento deveria ficar com a ultima linha (350)';
  end if;
  if (select count(*) from public.orcamento_projeto_custos
       where id in (current_setting('ts0137.f1')::bigint, current_setting('ts0137.f2')::bigint)
         and catalogo_item_id = v_frete) <> 2
     or (select catalogo_valor_base from public.orcamento_projeto_custos
          where id = current_setting('ts0137.f1')::bigint) <> 300 then
    raise exception '0137: linhas repetidas de F nao ficaram ligadas ao item (base = valor da linha)';
  end if;

  -- listagem mostra a origem do valor
  if (select valor_origem_demanda_titulo from public.orcamento_projeto_catalogo_listar() where id = v_alfa)
     is distinct from 'TS-0137 proposta a' then
    raise exception '0137: listagem sem a proposta de origem do valor';
  end if;
end $$;

rollback;
