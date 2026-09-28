-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Todas as fixtures e operacoes sao revertidas no ROLLBACK final.
-- Cobre a 0112: SELECT de coluna negado, leituras mascaradas/agregadas,
-- escrita do salario/preco PE so com permissao e auditoria sem vazamento.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
declare
  rotulo text;
  uid uuid;
  f text;
begin
  foreach f in array array[
    'kontrol_private.tem_permissao_efetiva(text)', 'kontrol_private.pode_ver_salario()',
    'public.tem_permissao(text)', 'public.tecnicos_remuneracao()',
    'public.valor_hora_pessoal_total()', 'public.orcamento_projeto_catalogo_listar()'
  ] loop
    if to_regprocedure(f) is null then
      raise exception '0112: funcao ausente: %', f;
    end if;
    if has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '0112: anon executa %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0112: authenticated sem EXECUTE em %', f;
    end if;
  end loop;
  if to_regprocedure('public.__sal0112_probe(text,boolean,boolean,boolean,boolean)') is not null then
    raise exception '0112: probe ja existente';
  end if;

  if has_column_privilege('authenticated', 'public.tecnicos', 'valor_mes', 'SELECT')
    or has_column_privilege('anon', 'public.tecnicos', 'valor_mes', 'SELECT')
    or has_column_privilege('authenticated', 'public.orcamento_projeto_catalogo', 'preco_unitario', 'SELECT')
    or has_table_privilege('anon', 'public.tecnicos', 'SELECT') then
    raise exception '0112: SELECT sigiloso ainda concedido';
  end if;
  if not has_column_privilege('authenticated', 'public.tecnicos', 'percentual_dedicado', 'SELECT')
    or not has_column_privilege('authenticated', 'public.orcamento_projeto_catalogo', 'descricao', 'SELECT')
    or not has_column_privilege('authenticated', 'public.tecnicos', 'valor_mes', 'UPDATE') then
    raise exception '0112: colunas publicas/escrita sem privilegio';
  end if;
  if (select permissoes -> 'tecnicos.salario.ver' from public.permissoes_categorias where papel = 'admin')
      is distinct from 'true'::jsonb
    or exists (
      select 1 from public.permissoes_categorias
      where papel in ('tecnico', 'coordenador', 'gestor')
        and permissoes -> 'tecnicos.salario.ver' is distinct from 'false'::jsonb) then
    raise exception '0112: padrao da permissao divergente (somente admin)';
  end if;

  -- Fixtures (owner: triggers de protecao nao se aplicam).
  insert into public.tecnicos (nome, processo, valor_mes, horas_mes_base, percentual_dedicado)
  values ('TS-0112-A', 'Laboratorio', 8000, 160, 50),
         ('TS-0112-B', 'Bioinformatica', 5000, 100, 10);
  insert into public.orcamento_projeto_catalogo (id, rubrica, descricao, unidade, preco_unitario)
  values ('TS0112-PE', 'PE', 'TS-0112 Pessoa', 'mes', 7000),
         ('TS0112-MC', 'MC', 'TS-0112 Material', 'un', 50);
  perform set_config('sal0112.total',
    (select coalesce(sum(valor_mes / horas_mes_base * percentual_dedicado / 100), 0)::text
     from public.tecnicos where horas_mes_base > 0), true);
  perform set_config('sal0112.id_a',
    (select id::text from public.tecnicos where nome = 'TS-0112-A'), true);

  foreach rotulo in array array[
    'admin', 'tecnico_padrao', 'coordenador_sem', 'gestor_sem', 'gestor_com',
    'tecnico_com', 'suspenso', 'categoria', 'sem_perfil'
  ] loop
    uid := md5('kontrol-sal-0112-' || rotulo)::uuid;
    if exists(select 1 from auth.users where id = uid) then
      raise exception '0112: fixture id ja existe para %', rotulo;
    end if;
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      format('ts-sal-0112-%s@example.invalid', rotulo), now(), now());
    if rotulo = 'sem_perfil' then
      delete from public.perfis where id = uid;
      continue;
    end if;
    update public.perfis
    set papel = case
        when rotulo in ('admin', 'suspenso') then 'admin'
        when rotulo like 'tecnico_%' then 'tecnico'
        when rotulo like 'gestor_%' then 'gestor'
        else 'coordenador' end,
      suspenso = (rotulo = 'suspenso'),
      permissoes = case rotulo
        when 'tecnico_padrao' then '{}'::jsonb
        when 'gestor_com' then '{"cadastros.editar": true, "tecnicos.salario.ver": true}'::jsonb
        when 'tecnico_com' then '{"cadastros.editar": true, "tecnicos.salario.ver": true}'::jsonb
        -- desde a 0124 o catálogo de projeto exige a permissão "Modelos e catálogos"
        when 'coordenador_sem' then '{"cadastros.editar": true, "orcamentos.modelos": true}'::jsonb
        when 'suspenso' then '{"cadastros.editar": true, "tecnicos.salario.ver": true}'::jsonb
        else '{"cadastros.editar": true}'::jsonb end
        -- 0137: valores de pessoal no orçamento têm permissão própria; aqui só o salário conta.
        || '{"orcamentos.pessoal": false}'::jsonb
    where id = uid;
    if not found then raise exception '0112: perfil fixture ausente para %', rotulo; end if;
  end loop;
end $$;

-- SECURITY INVOKER: roda com o papel/JWT sintetico, passando pelos privilegios
-- de coluna, RLS e triggers reais.
create function public.__sal0112_probe(
  p_rotulo text, p_pode boolean, p_edita boolean, p_edita_catalogo boolean, p_audita boolean
)
returns void language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  n bigint;
  v numeric;
  b boolean;
  id_a bigint := current_setting('sal0112.id_a')::bigint;
begin
  -- 1. Nenhum usuario do PostgREST le a coluna diretamente (nem admin).
  begin
    perform valor_mes from public.tecnicos limit 1;
    raise exception '0112: SELECT valor_mes indevido para %', p_rotulo;
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.tecnicos limit 1;
    raise exception '0112: SELECT * em tecnicos indevido para %', p_rotulo;
  exception when insufficient_privilege then null;
  end;
  begin
    perform preco_unitario from public.orcamento_projeto_catalogo limit 1;
    raise exception '0112: SELECT preco_unitario indevido para %', p_rotulo;
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.tecnicos where nome like 'TS-0112-%'
    and horas_mes_base > 0 and percentual_dedicado >= 0 and processo is not null;
  if n <> 2 then raise exception '0112: colunas publicas ilegiveis para %: %', p_rotulo, n; end if;

  -- 2. Permissao efetiva igual no app (tem_permissao) e no banco.
  if public.tem_permissao('tecnicos.salario.ver') is distinct from p_pode
    or kontrol_private.pode_ver_salario() is distinct from p_pode then
    raise exception '0112: permissao efetiva divergente para %', p_rotulo;
  end if;
  if public.tem_permissao(null) or public.tem_permissao('x; drop') then
    raise exception '0112: chave invalida aceita para %', p_rotulo;
  end if;

  -- 3. Leituras mascaradas / agregadas.
  select r.valor_mes into v from public.tecnicos_remuneracao() r where r.id = id_a;
  if v is distinct from (case when p_pode then 8000 end) then
    raise exception '0112: tecnicos_remuneracao divergente para %: %', p_rotulo, v;
  end if;
  if public.valor_hora_pessoal_total() <> current_setting('sal0112.total')::numeric then
    raise exception '0112: agregado divergente para %', p_rotulo;
  end if;
  select c.preco_unitario, c.preco_mascarado into v, b
  from public.orcamento_projeto_catalogo_listar() c where c.id = 'TS0112-PE';
  if v is distinct from (case when p_pode then 7000 end) or b is distinct from not p_pode then
    raise exception '0112: preco PE divergente para %: % %', p_rotulo, v, b;
  end if;
  select c.preco_unitario, c.preco_mascarado into v, b
  from public.orcamento_projeto_catalogo_listar() c where c.id = 'TS0112-MC';
  if v is distinct from 50 or b then
    raise exception '0112: preco MC nao deveria ser mascarado para %', p_rotulo;
  end if;

  -- 4. Escrita em tecnicos (cadastros.editar): salario so com permissao.
  if p_edita then
    update public.tecnicos set nome = nome, percentual_dedicado = 50 where nome = 'TS-0112-A';
    get diagnostics n = row_count;
    if n <> 1 then raise exception '0112: edicao sem salario bloqueada para %', p_rotulo; end if;

    begin
      update public.tecnicos set valor_mes = 8001 where nome = 'TS-0112-A';
      if not p_pode then raise exception '0112: salario alterado sem permissao por %', p_rotulo; end if;
      update public.tecnicos set valor_mes = 8000 where nome = 'TS-0112-A';
    exception when insufficient_privilege then
      if p_pode then raise; end if;
    end;

    insert into public.tecnicos (nome) values ('TS-0112-INS-' || p_rotulo);
    begin
      insert into public.tecnicos (nome, valor_mes) values ('TS-0112-SAL-' || p_rotulo, 100);
      if not p_pode then raise exception '0112: salario definido sem permissao por %', p_rotulo; end if;
    exception when insufficient_privilege then
      if p_pode then raise; end if;
    end;
  end if;

  -- 5. Catalogo (coordenador+): preco/rubrica PE so com permissao.
  if p_edita_catalogo then
    update public.orcamento_projeto_catalogo set preco_unitario = 51 where id = 'TS0112-MC';
    get diagnostics n = row_count;
    if n <> 1 then raise exception '0112: preco MC bloqueado para %', p_rotulo; end if;
    update public.orcamento_projeto_catalogo set preco_unitario = 50 where id = 'TS0112-MC';
    update public.orcamento_projeto_catalogo set descricao = descricao where id = 'TS0112-PE';

    begin
      update public.orcamento_projeto_catalogo set preco_unitario = 7001 where id = 'TS0112-PE';
      if not p_pode then raise exception '0112: preco PE alterado sem permissao por %', p_rotulo; end if;
      update public.orcamento_projeto_catalogo set preco_unitario = 7000 where id = 'TS0112-PE';
    exception when insufficient_privilege then
      if p_pode then raise; end if;
    end;
    begin
      update public.orcamento_projeto_catalogo set rubrica = 'MC' where id = 'TS0112-PE';
      if not p_pode then raise exception '0112: rubrica PE trocada sem permissao por %', p_rotulo; end if;
      update public.orcamento_projeto_catalogo set rubrica = 'PE' where id = 'TS0112-PE';
    exception when insufficient_privilege then
      if p_pode then raise; end if;
    end;
  end if;

  -- 6. Auditoria (gestor+): salario e historico PE so com permissao.
  if p_audita then
    select count(*) into n from public.auditoria
    where tabela = 'tecnicos' and registro_id = id_a::text;
    if n = 0 then raise exception '0112: auditoria de tecnicos invisivel para %', p_rotulo; end if;
    select count(*) into n from public.auditoria
    where tabela = 'tecnicos' and (valor_novo ->> 'valor_mes' is distinct from 'XXX'
      and valor_novo is not null);
    if n <> 0 then raise exception '0112: auditoria de tecnicos expoe salario para %', p_rotulo; end if;

    select count(*) into n from public.auditoria
    where tabela = 'tecnicos_remuneracao' and registro_id = id_a::text;
    if (n > 0) is distinct from p_pode then
      raise exception '0112: linha de remuneracao visivel=% para % (pode=%)', n > 0, p_rotulo, p_pode;
    end if;
    select count(*) into n from public.auditoria
    where tabela = 'orcamento_projeto_catalogo' and registro_id = 'TS0112-PE';
    if (n > 0) is distinct from p_pode then
      raise exception '0112: historico PE visivel=% para % (pode=%)', n > 0, p_rotulo, p_pode;
    end if;
    select count(*) into n from public.auditoria
    where tabela = 'orcamento_projeto_catalogo' and registro_id = 'TS0112-MC';
    if n = 0 then raise exception '0112: historico MC escondido indevidamente para %', p_rotulo; end if;
  end if;
end $$;

revoke all on function public.__sal0112_probe(text, boolean, boolean, boolean, boolean) from public;
grant execute on function public.__sal0112_probe(text, boolean, boolean, boolean, boolean) to authenticated, anon;

set local role authenticated;
--                                                                      pode   edita  catal. audita
select set_config('request.jwt.claim.sub', md5('kontrol-sal-0112-admin')::uuid::text, true);
select public.__sal0112_probe('admin',                                  true,  true,  true,  true);
select set_config('request.jwt.claim.sub', md5('kontrol-sal-0112-tecnico_padrao')::uuid::text, true);
select public.__sal0112_probe('tecnico_padrao',                         false, false, false, false);
select set_config('request.jwt.claim.sub', md5('kontrol-sal-0112-coordenador_sem')::uuid::text, true);
select public.__sal0112_probe('coordenador_sem',                        false, true,  true,  false);
select set_config('request.jwt.claim.sub', md5('kontrol-sal-0112-gestor_sem')::uuid::text, true);
select public.__sal0112_probe('gestor_sem',                             false, true,  true,  true);
select set_config('request.jwt.claim.sub', md5('kontrol-sal-0112-gestor_com')::uuid::text, true);
select public.__sal0112_probe('gestor_com',                             true,  true,  true,  true);
select set_config('request.jwt.claim.sub', md5('kontrol-sal-0112-tecnico_com')::uuid::text, true);
select public.__sal0112_probe('tecnico_com',                            true,  true,  false, false);
select set_config('request.jwt.claim.sub', md5('kontrol-sal-0112-suspenso')::uuid::text, true);
select public.__sal0112_probe('suspenso',                               false, false, false, false);
select set_config('request.jwt.claim.sub', md5('kontrol-sal-0112-sem_perfil')::uuid::text, true);
select public.__sal0112_probe('sem_perfil',                             false, false, false, false);
reset role;

-- Concessao pela categoria (sem chave no perfil) libera o salario.
update public.permissoes_categorias
set permissoes = permissoes || '{"tecnicos.salario.ver": true, "orcamentos.modelos": true}'::jsonb
where papel = 'coordenador';

set local role authenticated;
select set_config('request.jwt.claim.sub', md5('kontrol-sal-0112-categoria')::uuid::text, true);
select public.__sal0112_probe('categoria',                              true,  true,  true,  false);
reset role;

-- anon: nenhuma leitura sigilosa nem RPC.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform public.tecnicos_remuneracao();
    raise exception '0112: anon executou tecnicos_remuneracao';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.valor_hora_pessoal_total();
    raise exception '0112: anon executou valor_hora_pessoal_total';
  exception when insufficient_privilege then null;
  end;
  begin
    perform id from public.tecnicos limit 1;
    raise exception '0112: anon leu tecnicos';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$
begin
  if (select valor_mes from public.tecnicos where nome = 'TS-0112-A') <> 8000
    or (select preco_unitario from public.orcamento_projeto_catalogo where id = 'TS0112-PE') <> 7000
    or (select rubrica from public.orcamento_projeto_catalogo where id = 'TS0112-PE') <> 'PE' then
    raise exception '0112: valores sigilosos alterados indevidamente';
  end if;
  if exists (select 1 from public.tecnicos where nome like 'TS-0112-INS-%' and valor_mes <> 0) then
    raise exception '0112: insert sem salario gravou valor diferente de 0';
  end if;
  if (select count(*) from public.tecnicos where nome like 'TS-0112-SAL-%') <> 4 then
    -- admin, gestor_com, tecnico_com e categoria definem salario na criacao
    raise exception '0112: insert com salario divergente';
  end if;
  if exists (
    select 1 from public.auditoria
    where tabela = 'tecnicos'
      and (jsonb_typeof(valor_anterior -> 'valor_mes') = 'number'
           or jsonb_typeof(valor_novo -> 'valor_mes') = 'number')) then
    raise exception '0112: auditoria de tecnicos gravou salario na linha publica';
  end if;
  if not exists (
    select 1 from public.auditoria
    where tabela = 'tecnicos_remuneracao' and acao = 'update'
      and valor_anterior ->> 'valor_mes' = '8000' and valor_novo ->> 'valor_mes' = '8001') then
    raise exception '0112: alteracao de salario nao auditada';
  end if;
end $$;

rollback;
