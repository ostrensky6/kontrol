-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- 0187: campos da planilha de solicitação de compras no insumo.
--   * as seis colunas novas existem, aceitam vazio e guardam o texto;
--   * quem tem "Editar insumos" (o Administrador) grava; quem não tem não muda nada (RLS);
--   * texto acima do limite é recusado.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-pl-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-pl-' || p_rotulo)::uuid,
                      'email', 'ts-pl-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-pl-' || p_rotulo)::uuid
$$;

do $$
declare
  v_rotulo text;
  v_insumo bigint;
  v_faltam text;
begin
  select string_agg(c, ', ') into v_faltam
    from unnest(array['descricao_detalhada', 'fornecedores_sugeridos', 'observacoes_internas',
                      'justificativa_tr', 'especificacoes_tr', 'criterio_aceitabilidade']) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'insumos' and column_name = c
                        and data_type = 'text' and is_nullable = 'YES');
  if v_faltam is not null then
    raise exception '0187: colunas ausentes ou com tipo errado: %', v_faltam;
  end if;

  foreach v_rotulo in array array['adm', 'tecnico'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-pl-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-PL ' || v_rotulo,
           papel = case v_rotulo when 'adm' then 'admin' else 'laboratorio' end,
           suspenso = false, senha_provisoria = false,
           -- o técnico sem "Editar insumos", mesmo que a função dele tenha
           permissoes = case v_rotulo when 'tecnico' then '{"insumos.editar": false}'::jsonb else '{}'::jsonb end
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.insumos (especificacao, unidade, ativo, categoria_compra)
  values ('TS-PL luva nitrílica M', 'cx', true, 'operacional') returning id into v_insumo;
  perform set_config('tpl.insumo', v_insumo::text, true);
end $$;

-- ---- 1. quem edita insumos grava os textos da planilha -----------------------------------------
select pg_temp.como('adm');
set local role authenticated;
update public.insumos
   set nome_item = 'Consumíveis',
       descricao_detalhada = 'Luvas nitrilo tamanho M, sem pó.',
       fornecedores_sugeridos = 'SIL LIFE (vendas@example.invalid)',
       observacoes_internas = 'Luvas sem talco.',
       justificativa_tr = 'Proteção individual na manipulação de amostras de eDNA.',
       especificacoes_tr = 'Caixa com 100 unidades, nitrílica, sem pó.',
       criterio_aceitabilidade = '1) Prazo de entrega de até 15 dias.'
 where id = current_setting('tpl.insumo')::bigint;
reset role;

do $$
declare v record;
begin
  select * into v from public.insumos where id = current_setting('tpl.insumo')::bigint;
  if v.descricao_detalhada is distinct from 'Luvas nitrilo tamanho M, sem pó.'
     or v.criterio_aceitabilidade is distinct from '1) Prazo de entrega de até 15 dias.'
     or v.justificativa_tr is null or v.especificacoes_tr is null
     or v.fornecedores_sugeridos is null or v.observacoes_internas is null then
    raise exception '0187: o Administrador não gravou os textos da planilha: %', row_to_json(v);
  end if;
end $$;

-- ---- 2. sem "Editar insumos" nada muda ---------------------------------------------------------
select pg_temp.como('tecnico');
set local role authenticated;
update public.insumos set descricao_detalhada = 'trocado' where id = current_setting('tpl.insumo')::bigint;
reset role;

do $$
begin
  if (select descricao_detalhada from public.insumos where id = current_setting('tpl.insumo')::bigint) = 'trocado' then
    raise exception '0187: quem não tem "Editar insumos" mudou a descrição';
  end if;
end $$;

-- ---- 3. limite de tamanho ------------------------------------------------------------------------
do $$
begin
  begin
    update public.insumos set descricao_detalhada = repeat('x', 4001) where id = current_setting('tpl.insumo')::bigint;
    raise exception '0187: aceitou descrição acima de 4000 caracteres';
  exception when check_violation then
    null;
  end;
end $$;

select '0187_OK' as resultado;
rollback;
