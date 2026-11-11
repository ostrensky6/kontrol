-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1
-- e PGCLIENTENCODING=UTF8. Itens, insumos, tecnico e usuarios proprios do teste (TS-0179);
-- tudo e revertido no ROLLBACK final.
-- Valida a 0179: ligar e desfazer o vinculo do catalogo com Insumos e Tecnicos, o cadastro
-- mandando no valor (inclusive quando muda depois), cadastro sem custo nao substitui, item
-- ligado nao aprende o valor digitado na revisao nem na planilha, proposta lancada nao muda,
-- salario nao vaza, gravacao direta recusada e insumo excluido deixando o item livre.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0179-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0179-' || p_rotulo)::uuid,
                      'email', 'ts-0179-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated',
                      'app_metadata', json_build_object('senha_provisoria', false))::text, true);
end $$;

create function pg_temp.preco(p_id text) returns numeric language sql as $$
  select preco_unitario from public.orcamento_projeto_catalogo where id = p_id
$$;

create function pg_temp.id(p_chave text) returns bigint language sql as $$
  select current_setting('ts0179.' || p_chave)::bigint
$$;

-- ---------------------------------------------------------------------------
-- 1. Estrutura, grants e funcoes internas fechadas
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
  c text;
begin
  foreach f in array array[
    'public.catalogo_projeto_vincular(text,bigint,bigint,text)',
    'public.orcamento_projeto_catalogo_vinculos()'
  ] loop
    if to_regprocedure(f) is null then
      raise exception '0179: funcao ausente: %', f;
    end if;
    if has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '0179: anon executa %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0179: authenticated sem EXECUTE em %', f;
    end if;
  end loop;
  foreach f in array array[
    'kontrol_private.valor_cadastro_catalogo(bigint,bigint,text)',
    'kontrol_private.aplicar_valor_cadastro_catalogo(text,text,text)',
    'kontrol_private.plano_catalogo_revisao(bigint)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '0179: funcao interna exposta: %', f;
    end if;
  end loop;
  foreach c in array array['insumo_id', 'tecnico_id', 'vinculo_base', 'vinculo_em', 'vinculo_por'] loop
    if not has_column_privilege('authenticated', 'public.orcamento_projeto_catalogo', c, 'SELECT') then
      raise exception '0179: coluna % ilegivel', c;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.orcamento_projeto_catalogo', 'preco_unitario', 'SELECT') then
    raise exception '0179: preco do catalogo voltou a ser legivel direto (0112)';
  end if;
  if has_column_privilege('authenticated', 'public.tecnicos', 'valor_mes', 'SELECT') then
    raise exception '0179: salario legivel direto (0112)';
  end if;
  if exists (select 1 from public.orcamento_projeto_catalogo where insumo_id is not null or tecnico_id is not null) then
    raise exception '0179: item nasceu ligado ao aplicar a migration';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'aud_orcamento_projeto_catalogo' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'trg_catalogo_proteger_preco_pe' and not tgisinternal) then
    raise exception '0179: gatilho de auditoria ou de pessoal do catalogo sumiu';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures (como owner)
-- ---------------------------------------------------------------------------
do $$
declare
  v_rotulo text;
  v_id bigint;
  v_demanda bigint;
begin
  foreach v_rotulo in array array['modelos_salario', 'modelos_pessoal', 'coord_sem_pessoal', 'leitor'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0179-' || v_rotulo)::uuid,
            'authenticated', 'authenticated', 'ts-0179-' || v_rotulo || '@example.invalid', now(), now());
  end loop;
  update public.perfis set papel = 'coordenador', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": true, "orcamentos.emitir": true, "orcamentos.modelos": true, "orcamentos.pessoal": true, "tecnicos.salario.ver": true}'::jsonb
   where id = md5('kontrol-0179-modelos_salario')::uuid;
  update public.perfis set papel = 'coordenador', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": true, "orcamentos.emitir": true, "orcamentos.modelos": true, "orcamentos.pessoal": true, "tecnicos.salario.ver": false}'::jsonb
   where id = md5('kontrol-0179-modelos_pessoal')::uuid;
  update public.perfis set papel = 'coordenador', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": true, "orcamentos.emitir": true, "orcamentos.modelos": true, "orcamentos.pessoal": false, "tecnicos.salario.ver": false}'::jsonb
   where id = md5('kontrol-0179-coord_sem_pessoal')::uuid;
  update public.perfis set papel = 'laboratorio', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.modelos": false}'::jsonb
   where id = md5('kontrol-0179-leitor')::uuid;

  insert into public.insumos (especificacao, nome_item, unidade, unidade_consumo, quantidade_embalagem, fator_conversao,
                              custo_total_embalagem, custo_unitario)
  values ('TS-0179 Luva nitrilica M caixa com 100', 'TS-0179 Luva', 'cx', 'un', 100, 1, 90, 0.9)
  returning id into v_id;
  perform set_config('ts0179.insumo_luva', v_id::text, true);
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao,
                              custo_total_embalagem, custo_unitario)
  values ('TS-0179 Insumo sem custo', 'un', 'un', 1, 1, 0, 0)
  returning id into v_id;
  perform set_config('ts0179.insumo_zero', v_id::text, true);
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao,
                              custo_total_embalagem, custo_unitario, ativo)
  values ('TS-0179 Insumo inativo', 'un', 'un', 1, 1, 10, 10, false)
  returning id into v_id;
  perform set_config('ts0179.insumo_inativo', v_id::text, true);

  insert into public.tecnicos (nome, valor_mes, horas_mes_base, percentual_dedicado)
  values ('TS-0179 Tecnica', 8000, 160, 100)
  returning id into v_id;
  perform set_config('ts0179.tecnico', v_id::text, true);

  insert into public.orcamento_projeto_catalogo (id, rubrica, descricao, unidade, preco_unitario, origem)
  values ('TS0179-LUV', 'MC', 'TS-0179 Luva nitrílica', 'cx', 80, 'kontrol'),
         ('TS0179-ZER', 'MC', 'TS-0179 Item sem custo', 'un', 40, 'kontrol'),
         ('TS0179-PES', 'PE', 'TS-0179 Pesquisadora', 'mês', 7000, 'kontrol'),
         ('TS0179-FRE', 'ST', 'TS-0179 Frete', 'un', 300, 'kontrol');

  insert into public.demandas_propostas (titulo, cliente_nome, status, modalidade)
  values ('TS-0179 proposta', 'Cliente TS-0179', 'orcada', 'projeto')
  returning id into v_demanda;
  insert into public.orcamento_projetos (demanda_id, titulo)
  values (v_demanda, 'TS-0179 projeto')
  returning id into v_id;
  perform set_config('ts0179.orc', v_id::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Sem "Modelos e catalogos" nao liga
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.como('leitor');

do $$
begin
  begin
    perform public.catalogo_projeto_vincular('TS0179-LUV', pg_temp.id('insumo_luva'), null, 'embalagem');
    raise exception '0179: sem orcamentos.modelos ligou o item';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Com "Modelos e catalogos" (sem salario): MC liga, valida e traz o valor
-- ---------------------------------------------------------------------------
select pg_temp.como('modelos_pessoal');

do $$
declare
  v_r jsonb;
begin
  -- recusas de forma
  begin
    perform public.catalogo_projeto_vincular('TS0179-LUV', pg_temp.id('insumo_luva'), pg_temp.id('tecnico'), 'embalagem');
    raise exception '0179: ligou a insumo e tecnico ao mesmo tempo';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.catalogo_projeto_vincular('TS0179-LUV', pg_temp.id('insumo_luva'), null, 'mes');
    raise exception '0179: aceitou base mes para insumo';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.catalogo_projeto_vincular('TS0179-FRE', pg_temp.id('insumo_luva'), null, 'embalagem');
    raise exception '0179: ligou servico (ST) a insumo';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.catalogo_projeto_vincular('TS0179-LUV', pg_temp.id('insumo_inativo'), null, 'unidade');
    raise exception '0179: ligou a insumo inativo';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.catalogo_projeto_vincular('TS0179-NAO', pg_temp.id('insumo_luva'), null, 'embalagem');
    raise exception '0179: ligou item inexistente';
  exception when no_data_found then null;
  end;
  -- pessoal exige "Ver salario dos tecnicos"
  begin
    perform public.catalogo_projeto_vincular('TS0179-PES', null, pg_temp.id('tecnico'), 'mes');
    raise exception '0179: ligou pessoal sem Ver salario';
  exception when insufficient_privilege then null;
  end;

  v_r := public.catalogo_projeto_vincular('TS0179-LUV', pg_temp.id('insumo_luva'), null, 'embalagem');
  if v_r <> '{"ligado": true, "aplicado": true, "sem_custo": false}'::jsonb then
    raise exception '0179: resposta ao ligar LUV: %', v_r;
  end if;
  -- mesmo vinculo de novo: nada muda
  v_r := public.catalogo_projeto_vincular('TS0179-LUV', pg_temp.id('insumo_luva'), null, 'embalagem');
  if v_r <> '{"ligado": true, "aplicado": false, "sem_custo": false}'::jsonb then
    raise exception '0179: religar igual deveria ser neutro: %', v_r;
  end if;

  -- cadastro sem custo nao substitui o valor do catalogo
  v_r := public.catalogo_projeto_vincular('TS0179-ZER', pg_temp.id('insumo_zero'), null, 'unidade');
  if v_r <> '{"ligado": true, "aplicado": false, "sem_custo": true}'::jsonb then
    raise exception '0179: resposta ao ligar ZER: %', v_r;
  end if;

  if not exists (select 1 from public.orcamento_projeto_catalogo_vinculos()
                  where catalogo_item_id = 'TS0179-LUV' and insumo_id = pg_temp.id('insumo_luva')
                    and insumo_nome = 'TS-0179 Luva nitrilica M caixa com 100' and vinculo_base = 'embalagem' and cadastro_sem_custo = false)
     or not exists (select 1 from public.orcamento_projeto_catalogo_vinculos()
                     where catalogo_item_id = 'TS0179-ZER' and cadastro_sem_custo = true) then
    raise exception '0179: leitura dos vinculos errada';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Gravacao direta (API) nao liga, nao desfaz e nao muda valor de item ligado
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    update public.orcamento_projeto_catalogo set preco_unitario = 1 where id = 'TS0179-LUV';
    raise exception '0179: valor de item ligado mudou por gravacao direta';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.orcamento_projeto_catalogo set insumo_id = null, vinculo_base = null where id = 'TS0179-LUV';
    raise exception '0179: desfez vinculo por gravacao direta';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orcamento_projeto_catalogo set insumo_id = pg_temp.id('insumo_luva'), vinculo_base = 'unidade'
     where id = 'TS0179-FRE';
    raise exception '0179: ligou por gravacao direta';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.orcamento_projeto_catalogo (id, rubrica, descricao, unidade, preco_unitario, origem, insumo_id, vinculo_base)
    values ('TS0179-DIR', 'MC', 'TS-0179 Direto', 'un', 1, 'kontrol', pg_temp.id('insumo_luva'), 'unidade');
    raise exception '0179: item novo nasceu ligado por gravacao direta';
  exception when insufficient_privilege then null;
  end;
  -- tela do catalogo: valor de item ligado e rubrica recusados; descricao e grupo seguem editaveis
  begin
    perform public.catalogo_projeto_salvar_item('TS0179-LUV', 'MC', 'TS-0179 Luva nitrílica', 'cx', null, 95);
    raise exception '0179: tela mudou o valor de item ligado';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.catalogo_projeto_salvar_item('TS0179-LUV', 'MP', 'TS-0179 Luva nitrílica', 'cx', null, null);
    raise exception '0179: tela mudou a rubrica de item ligado';
  exception when invalid_parameter_value then null;
  end;
  perform public.catalogo_projeto_salvar_item('TS0179-LUV', 'MC', 'TS-0179 Luva nitrílica', 'cx', 'EPI', null);
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

do $$
begin
  if pg_temp.preco('TS0179-LUV') <> 90 then
    raise exception '0179: LUV deveria ter o custo da embalagem do insumo (90): %', pg_temp.preco('TS0179-LUV');
  end if;
  if (select categoria from public.orcamento_projeto_catalogo where id = 'TS0179-LUV') is distinct from 'EPI' then
    raise exception '0179: grupo de item ligado deveria seguir editavel';
  end if;
  if pg_temp.preco('TS0179-ZER') <> 40 then
    raise exception '0179: cadastro sem custo substituiu o catalogo: %', pg_temp.preco('TS0179-ZER');
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo
                  where id = 'TS0179-LUV' and vinculo_por = 'ts-0179-modelos_pessoal@example.invalid'
                    and vinculo_em is not null and valor_atualizado_por = 'ts-0179-modelos_pessoal@example.invalid') then
    raise exception '0179: quem ligou e quando nao ficou registrado';
  end if;
  if (select count(*) from public.orcamento_projeto_catalogo_valores
       where catalogo_item_id = 'TS0179-LUV' and evento = 'vinculo_cadastro') <> 1
     or not exists (select 1 from public.orcamento_projeto_catalogo_valores
                     where catalogo_item_id = 'TS0179-LUV' and evento = 'valor_cadastro'
                       and preco_unitario = 90 and preco_anterior = 80) then
    raise exception '0179: historico do vinculo de LUV errado';
  end if;
  if exists (select 1 from public.orcamento_projeto_catalogo_valores
              where catalogo_item_id = 'TS0179-ZER' and evento = 'valor_cadastro') then
    raise exception '0179: cadastro sem custo gravou valor no historico';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. O cadastro mudou depois: o catalogo acompanha; custo zero nao apaga
-- ---------------------------------------------------------------------------
update public.insumos set custo_total_embalagem = 120, custo_unitario = 1.2 where id = pg_temp.id('insumo_luva');
do $$
begin
  if pg_temp.preco('TS0179-LUV') <> 120 then
    raise exception '0179: catalogo nao acompanhou o insumo (120): %', pg_temp.preco('TS0179-LUV');
  end if;
end $$;
update public.insumos set custo_total_embalagem = 0, custo_unitario = 0 where id = pg_temp.id('insumo_luva');
do $$
begin
  if pg_temp.preco('TS0179-LUV') <> 120 then
    raise exception '0179: insumo zerado apagou o valor do catalogo: %', pg_temp.preco('TS0179-LUV');
  end if;
end $$;
update public.insumos set custo_total_embalagem = 120, custo_unitario = 1.2 where id = pg_temp.id('insumo_luva');
update public.insumos set custo_total_embalagem = 30, custo_unitario = 30 where id = pg_temp.id('insumo_zero');
do $$
begin
  if pg_temp.preco('TS0179-ZER') <> 30 then
    raise exception '0179: insumo que ganhou custo nao atualizou o catalogo: %', pg_temp.preco('TS0179-ZER');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Pessoal: liga so com "Ver salario"; sem "Valores de pessoal" nada vaza
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.como('modelos_salario');

do $$
declare
  v_r jsonb;
begin
  v_r := public.catalogo_projeto_vincular('TS0179-PES', null, pg_temp.id('tecnico'), 'mes');
  if v_r <> '{"ligado": true, "aplicado": true, "sem_custo": false}'::jsonb then
    raise exception '0179: resposta ao ligar PES: %', v_r;
  end if;
  if (select preco_unitario from public.orcamento_projeto_catalogo_listar() where id = 'TS0179-PES') is distinct from 8000 then
    raise exception '0179: PES deveria valer o mes do tecnico para quem ve salario';
  end if;
  begin
    perform public.catalogo_projeto_vincular('TS0179-LUV', null, pg_temp.id('tecnico'), 'mes');
    raise exception '0179: ligou material (MC) a tecnico';
  exception when invalid_parameter_value then null;
  end;
end $$;

select pg_temp.como('coord_sem_pessoal');

do $$
begin
  if (select cadastro_sem_custo from public.orcamento_projeto_catalogo_vinculos() where catalogo_item_id = 'TS0179-PES') is not null then
    raise exception '0179: sem Valores de pessoal, a leitura dos vinculos disse se o tecnico tem valor';
  end if;
  if (select preco_unitario from public.orcamento_projeto_catalogo_listar() where id = 'TS0179-PES') is not null then
    raise exception '0179: valor de pessoal ligado exposto sem permissao';
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo_vinculos()
                  where catalogo_item_id = 'TS0179-PES' and tecnico_nome = 'TS-0179 Tecnica' and vinculo_base = 'mes') then
    raise exception '0179: vinculo de pessoal deveria aparecer (sem valor)';
  end if;
  begin
    perform public.catalogo_projeto_vincular('TS0179-PES', null, null, null);
    raise exception '0179: desfez vinculo de pessoal sem Ver salario';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

update public.tecnicos set valor_mes = 8500 where id = pg_temp.id('tecnico');
do $$
begin
  if pg_temp.preco('TS0179-PES') <> 8500 then
    raise exception '0179: catalogo nao acompanhou o tecnico (8500): %', pg_temp.preco('TS0179-PES');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Revisao de custos: item ligado nao aprende o valor digitado; a linha guarda o seu
-- ---------------------------------------------------------------------------
do $$
declare
  v_id bigint;
begin
  -- linha ligada ao item e com valor alterado so nesta proposta
  insert into public.orcamento_projeto_custos
    (orcamento_projeto_id, categoria, rubrica, descricao, quantidade, unidade, custo_unitario,
     preco_unitario, catalogo_item_id, catalogo_valor_base, origem)
  values (pg_temp.id('orc'), 'materiais', 'MC', 'TS-0179 Luva nitrílica', 2, 'cx', 150, 150, 'TS0179-LUV', 120, 'catalogo')
  returning id into v_id;
  perform set_config('ts0179.l_luv', v_id::text, true);
  -- linha digitada com o mesmo item e outro valor
  insert into public.orcamento_projeto_custos
    (orcamento_projeto_id, categoria, rubrica, descricao, quantidade, unidade, custo_unitario, preco_unitario, origem)
  values (pg_temp.id('orc'), 'materiais', 'MC', 'ts-0179 luva NITRILICA', 1, 'CX', 200, 200, 'manual')
  returning id into v_id;
  perform set_config('ts0179.l_luv2', v_id::text, true);
  -- pessoal ligado, digitado por quem nao tem Valores de pessoal
  insert into public.orcamento_projeto_custos
    (orcamento_projeto_id, categoria, rubrica, descricao, quantidade, unidade, custo_unitario, preco_unitario, origem)
  values (pg_temp.id('orc'), 'mao_obra', 'PE', 'TS-0179 Pesquisadora', 1, 'mês', 9999, 9999, 'manual')
  returning id into v_id;
  perform set_config('ts0179.l_pes', v_id::text, true);
  -- item livre segue aprendendo
  insert into public.orcamento_projeto_custos
    (orcamento_projeto_id, categoria, rubrica, descricao, quantidade, unidade, custo_unitario,
     preco_unitario, catalogo_item_id, catalogo_valor_base, origem)
  values (pg_temp.id('orc'), 'terceiros', 'ST', 'TS-0179 Frete', 1, 'un', 350, 350, 'TS0179-FRE', 300, 'catalogo')
  returning id into v_id;
  perform set_config('ts0179.l_fre', v_id::text, true);
end $$;

set local role authenticated;
select pg_temp.como('coord_sem_pessoal');

do $$
declare
  v_acao text;
  v_resultado jsonb;
begin
  select acao into v_acao from public.previa_catalogo_revisao_projeto(pg_temp.id('orc')) where linha_id = pg_temp.id('l_luv');
  if v_acao is distinct from 'inalterado' then raise exception '0179: linha ligada e alterada deveria ser inalterado: %', v_acao; end if;
  select acao into v_acao from public.previa_catalogo_revisao_projeto(pg_temp.id('orc')) where linha_id = pg_temp.id('l_luv2');
  if v_acao is distinct from 'vincular' then raise exception '0179: linha digitada do item ligado deveria vincular: %', v_acao; end if;
  select acao into v_acao from public.previa_catalogo_revisao_projeto(pg_temp.id('orc')) where linha_id = pg_temp.id('l_pes');
  if v_acao is distinct from 'vincular' then raise exception '0179: pessoal ligado deveria vincular sem pendencia: %', v_acao; end if;
  select acao into v_acao from public.previa_catalogo_revisao_projeto(pg_temp.id('orc')) where linha_id = pg_temp.id('l_fre');
  if v_acao is distinct from 'atualizar' then raise exception '0179: item livre deveria seguir atualizando: %', v_acao; end if;

  v_resultado := public.concluir_revisao_custos_projeto(pg_temp.id('orc'), null);
  if v_resultado <> '{"novos": 0, "atualizados": 1, "pendentes": 0, "repetidos": 0}'::jsonb then
    raise exception '0179: resumo da conclusao: %', v_resultado;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Planilha: item ligado nao muda de valor
-- ---------------------------------------------------------------------------
select pg_temp.como('modelos_pessoal');

do $$
declare
  v_r record;
begin
  select * into v_r from public.catalogo_projeto_importar(
    '[{"rubrica": "MC", "descricao": "TS-0179 Luva nitrílica", "unidade": "cx", "preco": 999}]'::jsonb, true);
  if v_r.acao is distinct from 'cadastro' or v_r.mensagem not like 'Segue o cadastro de Insumos%' then
    raise exception '0179: planilha deveria marcar item ligado como cadastro: % / %', v_r.acao, v_r.mensagem;
  end if;
  select * into v_r from public.catalogo_projeto_importar(
    '[{"rubrica": "MC", "descricao": "TS-0179 Luva nitrílica", "unidade": "cx", "preco": 120}]'::jsonb, false);
  if v_r.acao is distinct from 'igual' then
    raise exception '0179: valor igual ao do cadastro deveria ser igual: %', v_r.acao;
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

do $$
begin
  if pg_temp.preco('TS0179-LUV') <> 120 then
    raise exception '0179: revisao ou planilha mudou o valor de item ligado: %', pg_temp.preco('TS0179-LUV');
  end if;
  if pg_temp.preco('TS0179-PES') <> 8500 then
    raise exception '0179: revisao mudou o valor de pessoal ligado: %', pg_temp.preco('TS0179-PES');
  end if;
  if pg_temp.preco('TS0179-FRE') <> 350 then
    raise exception '0179: item livre deixou de aprender o valor da revisao: %', pg_temp.preco('TS0179-FRE');
  end if;
  if (select custo_unitario from public.orcamento_projeto_custos where id = pg_temp.id('l_luv')) <> 150
     or (select custo_unitario from public.orcamento_projeto_custos where id = pg_temp.id('l_luv2')) <> 200
     or (select custo_unitario from public.orcamento_projeto_custos where id = pg_temp.id('l_pes')) <> 9999 then
    raise exception '0179: a linha do orcamento perdeu o valor lancado';
  end if;
  if (select catalogo_item_id from public.orcamento_projeto_custos where id = pg_temp.id('l_luv2')) is distinct from 'TS0179-LUV'
     or (select catalogo_item_id from public.orcamento_projeto_custos where id = pg_temp.id('l_pes')) is distinct from 'TS0179-PES' then
    raise exception '0179: linhas digitadas nao ficaram ligadas aos itens';
  end if;
  if exists (select 1 from public.orcamento_projeto_catalogo_valores
              where catalogo_item_id = 'TS0179-PES' and evento = 'pendente_permissao') then
    raise exception '0179: pessoal ligado virou pendencia';
  end if;
end $$;

-- proposta lancada nao muda quando o cadastro muda
update public.insumos set custo_total_embalagem = 130, custo_unitario = 1.3 where id = pg_temp.id('insumo_luva');
do $$
begin
  if pg_temp.preco('TS0179-LUV') <> 130 then
    raise exception '0179: catalogo nao acompanhou o insumo (130)';
  end if;
  if (select custo_unitario from public.orcamento_projeto_custos where id = pg_temp.id('l_luv')) <> 150
     or (select catalogo_valor_base from public.orcamento_projeto_custos where id = pg_temp.id('l_luv')) <> 120 then
    raise exception '0179: mudanca no cadastro alterou linha ja lancada';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Trocar a base, desfazer e insumo excluido
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.como('modelos_salario');

do $$
declare
  v_r jsonb;
begin
  v_r := public.catalogo_projeto_vincular('TS0179-PES', null, pg_temp.id('tecnico'), 'hora');
  if v_r <> '{"ligado": true, "aplicado": true, "sem_custo": false}'::jsonb then
    raise exception '0179: resposta ao trocar PES para hora: %', v_r;
  end if;
  v_r := public.catalogo_projeto_vincular('TS0179-LUV', null, null, null);
  if v_r <> '{"ligado": false, "aplicado": false, "sem_custo": false}'::jsonb then
    raise exception '0179: resposta ao desfazer LUV: %', v_r;
  end if;
  -- desfeito: volta a aceitar valor digitado na tela
  perform public.catalogo_projeto_salvar_item('TS0179-LUV', 'MC', 'TS-0179 Luva nitrílica', 'cx', 'EPI', 125);
  v_r := public.catalogo_projeto_vincular('TS0179-ZER', pg_temp.id('insumo_zero'), null, 'embalagem');
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

update public.insumos set custo_total_embalagem = 140, custo_unitario = 1.4 where id = pg_temp.id('insumo_luva');
delete from public.insumos where id = pg_temp.id('insumo_zero');

do $$
begin
  if not exists (select 1 from public.orcamento_projeto_catalogo
                  where id = 'TS0179-PES' and tecnico_id = pg_temp.id('tecnico') and vinculo_base = 'hora'
                    and preco_unitario = round(8500::numeric / 160, 2)) then
    raise exception '0179: base por hora do tecnico errada: %', pg_temp.preco('TS0179-PES');
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo
                  where id = 'TS0179-LUV' and insumo_id is null and vinculo_base is null and preco_unitario = 125) then
    raise exception '0179: desfazer deveria deixar o item livre e parar de acompanhar o insumo: %', pg_temp.preco('TS0179-LUV');
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo_valores
                  where catalogo_item_id = 'TS0179-LUV' and evento = 'vinculo_cadastro' and observacao like 'Vínculo com o cadastro desfeito%') then
    raise exception '0179: desfazer sem historico';
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo
                  where id = 'TS0179-ZER' and insumo_id is null and vinculo_base is null and preco_unitario = 30) then
    raise exception '0179: insumo excluido deveria deixar o item livre com o ultimo valor';
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo_valores
                  where catalogo_item_id = 'TS0179-ZER' and evento = 'vinculo_cadastro' and observacao like '%foi excluído%') then
    raise exception '0179: exclusao do insumo sem historico no catalogo';
  end if;
end $$;

rollback;
