-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1
-- e PGCLIENTENCODING=UTF8.
-- Valida a 0139: trava das linhas de custo, reabrir revisao, reformulacao de proposta
-- aprovada (emissao, aprovacao pela equipe e pelo link, fundos e flag), modelo dentro da
-- proposta, pendencias de pessoal e importacao de planilha. Tudo e revertido no ROLLBACK.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0139-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0139-' || p_rotulo)::uuid,
                      'email', 'ts-0139-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated',
                      'app_metadata', json_build_object('senha_provisoria', false))::text, true);
end $$;

create function pg_temp.id(p_chave text) returns bigint language sql as $$
  select current_setting('ts0139.' || p_chave)::bigint
$$;

-- Mesma entrada do app: a versao de 12 argumentos (com operacao_id) chama a interna.
create function pg_temp.emitir(p_demanda bigint) returns jsonb language sql as $$
  select public.emitir_orcamento_final_transacional(p_demanda, 30, 0, 0, 100, 100, 100,
           jsonb_build_object('demanda', jsonb_build_object('id', p_demanda),
                              'orcamentos_analises', '[]'::jsonb, 'orcamentos_projeto', '[]'::jsonb),
           null, null, 'ts-0139@example.invalid', gen_random_uuid())
$$;

-- ---------------------------------------------------------------------------
-- 1. Estrutura e grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.reabrir_revisao_custos_projeto(bigint,text)',
    'public.aplicar_modelo_orcamento_projeto(bigint,bigint)',
    'public.catalogo_projeto_pendencias()',
    'public.catalogo_projeto_resolver_pendencia(bigint,boolean)',
    'public.catalogo_projeto_importar(jsonb,boolean)'
  ] loop
    if to_regprocedure(f) is null then raise exception '0139: funcao ausente: %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception '0139: anon executa %', f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then raise exception '0139: authenticated sem EXECUTE em %', f; end if;
  end loop;
  if has_function_privilege('authenticated', 'kontrol_private.substituir_versao_reformulada(bigint,bigint,text)', 'EXECUTE') then
    raise exception '0139: substituicao exposta a authenticated';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'kontrol_proteger_custos_projeto'
                  and tgrelid = 'public.orcamento_projeto_custos'::regclass) then
    raise exception '0139: trava das linhas de custo ausente';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
do $$
declare
  v_rotulo text;
  v_nome text;
  v_demanda bigint;
  v_projeto bigint;
  v_versao bigint;
begin
  foreach v_rotulo in array array['coord_pessoal', 'coord_sem', 'gestor', 'tecnico'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0139-' || v_rotulo)::uuid,
            'authenticated', 'authenticated', 'ts-0139-' || v_rotulo || '@example.invalid', now(), now());
  end loop;
  update public.perfis set papel = 'coordenador', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": true, "orcamentos.emitir": true, "orcamentos.pessoal": true, "orcamentos.modelos": false}'::jsonb
   where id = md5('kontrol-0139-coord_pessoal')::uuid;
  update public.perfis set papel = 'coordenador', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": true, "orcamentos.emitir": true, "orcamentos.pessoal": false, "orcamentos.modelos": false}'::jsonb
   where id = md5('kontrol-0139-coord_sem')::uuid;
  update public.perfis set papel = 'gestor', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": true, "orcamentos.emitir": true, "orcamentos.pessoal": true, "orcamentos.modelos": true}'::jsonb
   where id = md5('kontrol-0139-gestor')::uuid;
  update public.perfis set papel = 'tecnico', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": true, "orcamentos.emitir": false}'::jsonb
   where id = md5('kontrol-0139-tecnico')::uuid;

  -- R: reformulacao pela equipe; L: reformulacao pelo link; T: trava e modelo; P: pendencia; X: aprovada sem reformulacao
  foreach v_nome in array array['r', 'l', 't', 'p', 'x'] loop
    insert into public.demandas_propostas (titulo, cliente_nome, status, modalidade)
    values ('TS-0139 proposta ' || v_nome, 'Cliente TS-0139', 'orcada', 'projeto')
    returning id into v_demanda;
    insert into public.orcamento_projetos (demanda_id, titulo) values (v_demanda, 'TS-0139 projeto ' || v_nome)
    returning id into v_projeto;
    insert into public.orcamento_projeto_custos
      (orcamento_projeto_id, categoria, rubrica, descricao, quantidade, unidade, custo_unitario, preco_unitario, origem)
    values (v_projeto, 'materiais', 'MC', 'TS-0139 Material ' || v_nome, 1, 'un', 10, 10, 'manual');
    perform set_config('ts0139.demanda_' || v_nome, v_demanda::text, true);
    perform set_config('ts0139.projeto_' || v_nome, v_projeto::text, true);
  end loop;

  -- Propostas R, L e X ja aprovadas (v1), com o modulo aprovado; R tem fundos lancados.
  foreach v_nome in array array['r', 'l', 'x'] loop
    insert into public.orcamento_final_versoes (demanda_id, versao, numero, status, validade_dias, valido_ate, snapshot)
    values (current_setting('ts0139.demanda_' || v_nome)::bigint, 1, 'TS-0139-' || v_nome || '-v1', 'aprovado', 30,
            current_date + 30, '{}'::jsonb)
    returning id into v_versao;
    perform set_config('ts0139.v1_' || v_nome, v_versao::text, true);
    perform set_config('app.orcamento_projeto_transicao', 'permitida', true);
    update public.orcamento_projetos set status = 'aprovado' where id = current_setting('ts0139.projeto_' || v_nome)::bigint;
  end loop;
  insert into public.orcamento_fundos_acompanhamento (orcamento_final_versao_id, valor_recebido)
  values (current_setting('ts0139.v1_r')::bigint, 500);

  -- Catalogo e modelo
  insert into public.orcamento_projeto_catalogo (id, rubrica, descricao, unidade, preco_unitario, origem)
  values ('TS0139-CAT', 'MC', 'TS-0139 Item cat', 'un', 77, 'kontrol');
  insert into public.orcamento_projeto_templates (nome, itens)
  values ('TS-0139 modelo', jsonb_build_array(
            jsonb_build_object('rubrica', 'MC', 'descricao', 'ts-0139 ITEM cat', 'unidade', 'unid', 'quantidade', 2, 'custo_unitario', 5),
            jsonb_build_object('rubrica', 'MC', 'descricao', 'TS-0139 Sem catalogo', 'unidade', 'cx', 'quantidade', 3, 'custo_unitario', 12),
            jsonb_build_object('rubrica', 'PE', 'descricao', 'TS-0139 Pessoa', 'unidade', 'mês', 'custo_unitario', 1000,
                               'meses_selecionados', jsonb_build_array(1, 2, 99))))
  returning id into v_versao;
  perform set_config('ts0139.modelo', v_versao::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Trava das linhas e reabrir revisao (proposta sem aprovacao: T)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.como('coord_pessoal');

do $$
declare
  v_ret jsonb;
begin
  perform public.concluir_revisao_custos_projeto(pg_temp.id('projeto_t'), null);
  begin
    update public.orcamento_projeto_custos set custo_unitario = 11 where orcamento_projeto_id = pg_temp.id('projeto_t');
    raise exception '0139: alterou custo de modulo concluido';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.orcamento_projeto_custos (orcamento_projeto_id, categoria, rubrica, descricao, quantidade, custo_unitario, preco_unitario)
    values (pg_temp.id('projeto_t'), 'materiais', 'MC', 'TS-0139 intruso', 1, 1, 1);
    raise exception '0139: inseriu custo em modulo concluido';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.aplicar_modelo_orcamento_projeto(pg_temp.id('projeto_t'), pg_temp.id('modelo'));
    raise exception '0139: aplicou modelo em modulo concluido';
  exception when invalid_parameter_value then null;
  end;

  v_ret := public.reabrir_revisao_custos_projeto(pg_temp.id('projeto_t'), null);
  if (v_ret->>'reformulacao')::boolean then raise exception '0139: reabertura simples tratada como reformulacao'; end if;
  begin
    perform public.reabrir_revisao_custos_projeto(pg_temp.id('projeto_t'), null);
    raise exception '0139: reabriu modulo ja em edicao';
  exception when invalid_parameter_value then null;
  end;
  update public.orcamento_projeto_custos set custo_unitario = 11 where orcamento_projeto_id = pg_temp.id('projeto_t');
end $$;

select pg_temp.como('tecnico');
do $$
begin
  begin
    perform public.reabrir_revisao_custos_projeto(pg_temp.id('projeto_r'), 'Cliente pediu mudanca');
    raise exception '0139: tecnico sem orcamentos.emitir reabriu';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Modelo dentro da proposta (T em edicao)
-- ---------------------------------------------------------------------------
select pg_temp.como('coord_pessoal');
do $$
declare
  v_ret jsonb;
begin
  v_ret := public.aplicar_modelo_orcamento_projeto(pg_temp.id('projeto_t'), pg_temp.id('modelo'));
  if v_ret <> '{"itens": 3, "do_catalogo": 1, "sem_catalogo": 2, "pessoal_ignorado": 0}'::jsonb then
    raise exception '0139: resumo do modelo: %', v_ret;
  end if;
end $$;
select pg_temp.como('coord_sem');
do $$
declare
  v_ret jsonb;
begin
  v_ret := public.aplicar_modelo_orcamento_projeto(pg_temp.id('projeto_t'), pg_temp.id('modelo'));
  if (v_ret->>'pessoal_ignorado')::int <> 1 or (v_ret->>'itens')::int <> 2 then
    raise exception '0139: sem permissao de pessoal o modelo deveria pular o pessoal: %', v_ret;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Reformulacao pela equipe (R) e recusa sem reformulacao (X)
-- ---------------------------------------------------------------------------
select pg_temp.como('coord_pessoal');
do $$
declare
  v_ret jsonb;
begin
  -- aprovada sem reformulacao: emissao recusada (regra da 0126 preservada)
  begin
    perform pg_temp.emitir(pg_temp.id('demanda_x'));
    raise exception '0139: emitiu com proposta aprovada sem reformulacao';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.reabrir_revisao_custos_projeto(pg_temp.id('projeto_r'), null);
    raise exception '0139: reformulacao sem motivo aceita';
  exception when invalid_parameter_value then null;
  end;
  v_ret := public.reabrir_revisao_custos_projeto(pg_temp.id('projeto_r'), 'Orgao concedente pediu reformulacao');
  if not (v_ret->>'reformulacao')::boolean or v_ret->>'versao_aprovada' <> 'TS-0139-r-v1' then
    raise exception '0139: reformulacao nao reconhecida: %', v_ret;
  end if;
  update public.orcamento_projeto_custos set custo_unitario = 20 where orcamento_projeto_id = pg_temp.id('projeto_r');
  perform public.concluir_revisao_custos_projeto(pg_temp.id('projeto_r'), null);

  v_ret := pg_temp.emitir(pg_temp.id('demanda_r'));
  if (v_ret->>'reformulacao_de')::bigint is distinct from pg_temp.id('v1_r') then
    raise exception '0139: versao emitida sem vinculo com a aprovada: %', v_ret;
  end if;
  perform set_config('ts0139.v2_r', v_ret->>'id', true);

  perform public.transicionar_orcamento_final(pg_temp.id('v2_r'), 'aprovado', 'Reformulacao aceita');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Reformulacao aprovada pelo link (L)
-- ---------------------------------------------------------------------------
do $$
declare
  v_ret jsonb;
begin
  perform public.reabrir_revisao_custos_projeto(pg_temp.id('projeto_l'), 'Ajuste pedido pelo cliente');
  perform public.concluir_revisao_custos_projeto(pg_temp.id('projeto_l'), null);
  v_ret := pg_temp.emitir(pg_temp.id('demanda_l'));
  perform set_config('ts0139.v2_l', v_ret->>'id', true);
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
insert into public.orcamento_projeto_links (orcamento_final_versao_id, token_hash)
values (current_setting('ts0139.v2_l')::bigint, encode(extensions.digest('ts-0139-token-l', 'sha256'), 'hex'));

do $$
declare
  v_ret jsonb;
begin
  v_ret := public.aprovar_orcamento_publico('ts-0139-token-l', 'Cliente TS');
  if not (v_ret->>'aprovado')::boolean then raise exception '0139: link nao aprovou a reformulacao: %', v_ret; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Pendencias de pessoal (P) e importacao
-- ---------------------------------------------------------------------------
insert into public.orcamento_projeto_custos
  (orcamento_projeto_id, categoria, rubrica, descricao, quantidade, unidade, custo_unitario, preco_unitario, origem)
values (current_setting('ts0139.projeto_p')::bigint, 'mao_obra', 'PE', 'TS-0139 Bolsista', 1, 'mês', 4200, 4200, 'manual'),
       (current_setting('ts0139.projeto_p')::bigint, 'mao_obra', 'PE', 'TS-0139 Tecnica', 1, 'mês', 3000, 3000, 'manual');

set local role authenticated;
select pg_temp.como('coord_sem');
select public.concluir_revisao_custos_projeto(current_setting('ts0139.projeto_p')::bigint, null);

select pg_temp.como('coord_pessoal');
do $$
begin
  begin
    perform public.catalogo_projeto_resolver_pendencia(0, true);
    raise exception '0139: resolveu pendencia sem orcamentos.modelos';
  exception when insufficient_privilege then null;
  end;
end $$;

select pg_temp.como('gestor');
do $$
declare
  v_bolsista bigint;
  v_tecnica bigint;
  v_item text;
  v_n integer;
begin
  select p.pendencia_id into v_bolsista from public.catalogo_projeto_pendencias() p where p.descricao = 'TS-0139 Bolsista';
  select p.pendencia_id into v_tecnica from public.catalogo_projeto_pendencias() p where p.descricao = 'TS-0139 Tecnica';
  if v_bolsista is null or v_tecnica is null then raise exception '0139: pendencias de pessoal nao listadas'; end if;
  v_item := public.catalogo_projeto_resolver_pendencia(v_bolsista, true);
  perform set_config('ts0139.item_bolsista', v_item, true);
  perform public.catalogo_projeto_resolver_pendencia(v_tecnica, false);
  select count(*) into v_n from public.catalogo_projeto_pendencias() p where p.descricao like 'TS-0139 %';
  if v_n <> 0 then raise exception '0139: pendencias resolvidas continuam na lista'; end if;
  begin
    perform public.catalogo_projeto_resolver_pendencia(v_tecnica, true);
    raise exception '0139: resolveu pendencia duas vezes';
  exception when invalid_parameter_value then null;
  end;

  -- Importacao: previa nao grava; aplicar grava
  select count(*) into v_n from public.catalogo_projeto_importar(jsonb_build_array(
      jsonb_build_object('rubrica', 'MC', 'descricao', 'TS-0139 Imp A', 'unidade', 'un', 'preco', 10),
      jsonb_build_object('rubrica', 'mc', 'descricao', 'ts-0139 imp a', 'unidade', 'unid', 'preco', 11),
      jsonb_build_object('rubrica', 'XX', 'descricao', 'TS-0139 Ruim', 'preco', 1),
      jsonb_build_object('rubrica', 'MC', 'descricao', 'TS-0139 Item cat', 'unidade', 'un', 'preco', 77),
      jsonb_build_object('rubrica', 'MP', 'descricao', 'TS-0139 Equip', 'unidade', 'un', 'preco', 500, 'categoria', 'Campo')
    ), false) i
   where (i.linha = 1 and i.acao = 'repetido') or (i.linha = 2 and i.acao = 'novo')
      or (i.linha = 3 and i.acao = 'erro') or (i.linha = 4 and i.acao = 'igual')
      or (i.linha = 5 and i.acao = 'novo');
  if v_n <> 5 then raise exception '0139: previa da importacao com % linhas certas de 5', v_n; end if;
  if exists (select 1 from public.orcamento_projeto_catalogo where chave_descricao = 'ts-0139 imp a') then
    raise exception '0139: previa gravou no catalogo';
  end if;
  perform * from public.catalogo_projeto_importar(jsonb_build_array(
      jsonb_build_object('rubrica', 'MC', 'descricao', 'ts-0139 imp a', 'unidade', 'unid', 'preco', 11),
      jsonb_build_object('rubrica', 'MC', 'descricao', 'TS-0139 Item cat', 'unidade', 'un', 'preco', 80),
      jsonb_build_object('rubrica', 'MP', 'descricao', 'TS-0139 Equip', 'unidade', 'un', 'preco', 500, 'categoria', 'Campo')
    ), true);
end $$;

select pg_temp.como('coord_sem');
do $$
declare
  v_acao text;
begin
  select i.acao into v_acao from public.catalogo_projeto_importar(
    jsonb_build_array(jsonb_build_object('rubrica', 'PE', 'descricao', 'TS-0139 X', 'unidade', 'mês', 'preco', 1)), false) i;
  if v_acao is distinct from 'sem_permissao' then raise exception '0139: importacao de pessoal sem permissao: %', v_acao; end if;
exception when insufficient_privilege then
  null; -- coord_sem nem tem "Modelos e catalogos": tambem serve
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- 7. Estado final
-- ---------------------------------------------------------------------------
do $$
begin
  -- T: reaberta, editada e com o modelo aplicado duas vezes (3 + 2 linhas)
  if (select status from public.orcamento_projetos where id = pg_temp.id('projeto_t')) <> 'rascunho'
     or (select custo_unitario from public.orcamento_projeto_custos
          where orcamento_projeto_id = pg_temp.id('projeto_t') and descricao = 'TS-0139 Material t') <> 11 then
    raise exception '0139: reabertura de T nao permitiu editar';
  end if;
  if not exists (select 1 from public.orcamento_projeto_custos
                  where orcamento_projeto_id = pg_temp.id('projeto_t') and catalogo_item_id = 'TS0139-CAT'
                    and descricao = 'TS-0139 Item cat' and custo_unitario = 77 and catalogo_valor_base = 77
                    and quantidade = 2 and origem = 'template')
     or not exists (select 1 from public.orcamento_projeto_custos
                     where orcamento_projeto_id = pg_temp.id('projeto_t') and descricao = 'TS-0139 Pessoa'
                       and rubrica = 'PE' and meses_selecionados = '{1,2}' and custo_unitario = 1000)
     or not exists (select 1 from public.orcamento_projeto_custos
                     where orcamento_projeto_id = pg_temp.id('projeto_t') and descricao = 'TS-0139 Sem catalogo'
                       and custo_unitario = 12 and catalogo_item_id is null) then
    raise exception '0139: linhas do modelo gravadas errado';
  end if;

  -- R: v1 substituida, v2 aprovada com os fundos; flag limpa
  if (select status from public.orcamento_final_versoes where id = pg_temp.id('v1_r')) <> 'substituido'
     or (select status from public.orcamento_final_versoes where id = pg_temp.id('v2_r')) <> 'aprovado' then
    raise exception '0139: reformulacao aprovada nao substituiu a anterior';
  end if;
  if (select orcamento_final_versao_id from public.orcamento_fundos_acompanhamento where valor_recebido = 500
        and orcamento_final_versao_id in (pg_temp.id('v1_r'), pg_temp.id('v2_r'))) <> pg_temp.id('v2_r') then
    raise exception '0139: fundos nao acompanharam a versao aprovada vigente';
  end if;
  if (select reformulacao_de_versao_id from public.orcamento_projetos where id = pg_temp.id('projeto_r')) is not null then
    raise exception '0139: flag de reformulacao ficou no modulo';
  end if;
  if not exists (select 1 from public.eventos_status where entidade = 'orcamento_final' and entidade_id = pg_temp.id('v1_r')
                  and para_status = 'substituido') then
    raise exception '0139: substituicao sem evento';
  end if;

  -- L: aprovada pelo link, v1 substituida, modulo aprovado
  if (select status from public.orcamento_final_versoes where id = pg_temp.id('v1_l')) <> 'substituido'
     or (select status from public.orcamento_final_versoes where id = pg_temp.id('v2_l')) <> 'aprovado' then
    raise exception '0139: reformulacao pelo link nao substituiu a anterior';
  end if;

  -- X: continua so com a v1 aprovada
  if (select count(*) from public.orcamento_final_versoes where demanda_id = pg_temp.id('demanda_x')) <> 1 then
    raise exception '0139: proposta sem reformulacao ganhou versao';
  end if;

  -- P: bolsista aplicado no catalogo; tecnica descartada
  if not exists (select 1 from public.orcamento_projeto_catalogo
                  where id = current_setting('ts0139.item_bolsista') and rubrica = 'PE' and preco_unitario = 4200) then
    raise exception '0139: pendencia aplicada nao entrou no catalogo';
  end if;
  if not exists (select 1 from public.orcamento_projeto_catalogo_valores
                  where descricao = 'TS-0139 Tecnica' and evento = 'pendente_permissao'
                    and resolucao = 'descartado' and not aplicado)
     or exists (select 1 from public.orcamento_projeto_catalogo where chave_descricao = 'ts-0139 tecnica') then
    raise exception '0139: pendencia descartada errada';
  end if;

  -- Importacao aplicada
  if not exists (select 1 from public.orcamento_projeto_catalogo
                  where chave_descricao = 'ts-0139 imp a' and preco_unitario = 11 and origem = 'importacao_planilha')
     or (select preco_unitario from public.orcamento_projeto_catalogo where id = 'TS0139-CAT') <> 80
     or not exists (select 1 from public.orcamento_projeto_catalogo_valores
                     where catalogo_item_id = 'TS0139-CAT' and evento = 'edicao_catalogo' and preco_anterior = 77
                       and observacao = 'Importado de planilha.')
     or not exists (select 1 from public.orcamento_projeto_catalogo
                     where rubrica = 'MP' and chave_descricao = 'ts-0139 equip' and categoria = 'Campo') then
    raise exception '0139: importacao aplicada errada';
  end if;
end $$;

rollback;
