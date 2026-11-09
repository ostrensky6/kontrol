-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0172 (decisão D1 de 09/11/2026):
--   * prazo do ciclo no dia 10; sábado e domingo vão para a segunda;
--   * aprovação de coordenação depois do prazo passa ao ciclo seguinte;
--   * urgência fura o ciclo e precisa de justificativa no envio;
--   * o ciclo é gravado pelo banco e recomeça no reenvio.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0172-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0172-' || p_rotulo)::uuid,
                      'email', 'ts-0172-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-0172-' || p_rotulo)::uuid
$$;

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception '0172: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception '0172: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

create function pg_temp.pedido(p_natureza text, p_urgencia text, p_area bigint default null) returns bigint
language plpgsql as $$
declare v_id bigint;
begin
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa, urgencia, area_id)
  values ('TS-0172 ' || p_natureza, 'rascunho', 'ts-0172-pedinte@example.invalid',
          current_setting('t0172.projeto')::bigint, p_natureza, 'projeto', 'teste', p_urgencia, p_area)
  returning id into v_id;
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade)
  values (v_id, 'material', 'TS-0172 item', 1, 'un');
  return v_id;
end $$;

-- ---- regras do ciclo (funções puras) -------------------------------------------------
do $$
begin
  if kontrol_private.prazo_do_ciclo('2026-11-01') <> '2026-11-10'      -- terça
     or kontrol_private.prazo_do_ciclo('2026-10-20') <> '2026-10-12'   -- dia 10 no sábado
     or kontrol_private.prazo_do_ciclo('2027-01-01') <> '2027-01-11' then -- dia 10 no domingo
    raise exception '0172: prazo do ciclo errado';
  end if;
  if kontrol_private.ciclo_para('2026-10-12 23:00-03', false) <> '2026-10-01'
     or kontrol_private.ciclo_para('2026-10-13 00:30-03', false) <> '2026-11-01'
     or kontrol_private.ciclo_para('2026-11-11 01:00+00', false) <> '2026-11-01' -- 22h do dia 10 em Brasília
     or kontrol_private.ciclo_para('2026-11-20 10:00-03', true) <> '2026-11-01'  -- urgência fura o ciclo
     or kontrol_private.ciclo_para('2026-12-31 12:00-03', false) <> '2027-01-01' then
    raise exception '0172: ciclo calculado errado';
  end if;
  if (public.ciclo_pagamento_para('2026-11-11 12:00-03', false) ->> 'prazo') <> '2026-12-10' then
    raise exception '0172: consulta do ciclo para a tela errada';
  end if;
end $$;

do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_area bigint;
  v_repo bigint;
begin
  foreach v_rotulo in array array['pedinte', 'coord', 'lab'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-0172-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-0172 ' || v_rotulo,
           papel = case v_rotulo when 'coord' then 'coordenador' else 'laboratorio' end,
           suspenso = false, senha_provisoria = false,
           permissoes = case v_rotulo
             when 'coord' then '{"pedido.criar": true, "pedido.aprovar": true}'::jsonb
             else '{"pedido.criar": true}'::jsonb end
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-0172 projeto', pg_temp.uid('coord')) returning id into v_projeto;
  if to_regclass('kontrol_private.projetos_vinculos') is not null then
    execute 'insert into kontrol_private.projetos_vinculos (projeto_id, usuario_id) values ($1, $2) on conflict do nothing'
      using v_projeto, pg_temp.uid('coord');
  end if;
  insert into public.coordenacoes_area (nome, coordenador_id) values ('TS-0172 Lab', pg_temp.uid('lab')) returning id into v_area;
  perform set_config('t0172.projeto', v_projeto::text, true);

  perform set_config('t0172.urgente', pg_temp.pedido('material_consumo_geral', 'alta')::text, true);
  perform set_config('t0172.normal', pg_temp.pedido('material_consumo_geral', 'normal')::text, true);
  perform set_config('t0172.lab', pg_temp.pedido('material_consumo_lab', 'normal', v_area)::text, true);

  -- reposição automática de insumo crítico já nasce justificada
  insert into public.pedidos_internos (titulo, status, solicitante, origem, urgencia, justificativa)
  values ('TS-0172 reposição', 'rascunho', 'ts-0172-pedinte@example.invalid', 'reposicao_estoque', 'alta', 'falta')
  returning id into v_repo;
  if (select urgencia_justificativa from public.pedidos_internos where id = v_repo) is null then
    raise exception '0172: reposição urgente nasceu sem justificativa';
  end if;
end $$;

set local role authenticated;

-- ---- urgência precisa de justificativa -----------------------------------------------
select pg_temp.como('pedinte');
select pg_temp.exigir_erro(
  format('select public.transicionar_pedido_interno(%s, ''em_validacao'', ''Envio'', ''registrado'', null)', current_setting('t0172.urgente')),
  '22023', 'precisa de justificativa');
select pg_temp.exigir_erro(
  format('update public.pedidos_internos set ciclo_pagamento = ''2026-01-01'' where id = %s', current_setting('t0172.normal')),
  '42501', 'ciclo de pagamento');
update public.pedidos_internos
   set urgencia_justificativa = 'Amostras da campanha chegam dia 15 e o reagente acabou'
 where id = current_setting('t0172.urgente')::bigint;
select public.transicionar_pedido_interno(current_setting('t0172.urgente')::bigint, 'em_validacao', 'Envio', 'registrado', null);
select public.transicionar_pedido_interno(current_setting('t0172.normal')::bigint, 'em_validacao', 'Envio', 'registrado', null);
select public.transicionar_pedido_interno(current_setting('t0172.lab')::bigint, 'em_validacao', 'Envio', 'registrado', null);

-- ---- a validação do coordenador grava o ciclo ------------------------------------------
select pg_temp.como('coord');
select public.transicionar_pedido_interno(current_setting('t0172.urgente')::bigint, 'validado', 'Validação', 'aprovado', null);
select public.transicionar_pedido_interno(current_setting('t0172.normal')::bigint, 'validado', 'Validação', 'aprovado', null);
select public.transicionar_pedido_interno(current_setting('t0172.lab')::bigint, 'validado', 'Validação', 'aprovado', null);

-- ---- devolução e reenvio recomeçam o ciclo ---------------------------------------------
select pg_temp.como('lab');
select public.decidir_coordenacao_laboratorio(current_setting('t0172.lab')::bigint, 'devolvido', 'Falta a marca do reagente');
select pg_temp.como('pedinte');
select public.transicionar_pedido_interno(current_setting('t0172.lab')::bigint, 'em_validacao', 'Envio', 'registrado', null);

reset role;
do $$
declare
  v_mes date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
begin
  if (select ciclo_pagamento from public.pedidos_internos where id = current_setting('t0172.urgente')::bigint) <> v_mes then
    raise exception '0172: urgência deveria ficar no ciclo do mês';
  end if;
  if (select ciclo_pagamento from public.pedidos_internos where id = current_setting('t0172.normal')::bigint)
       is distinct from kontrol_private.ciclo_para(now(), false) then
    raise exception '0172: ciclo do pedido normal errado';
  end if;
  if (select ciclo_pagamento from public.pedidos_internos where id = current_setting('t0172.lab')::bigint) is not null then
    raise exception '0172: reenvio deveria limpar o ciclo';
  end if;

  -- a aprovação do laboratório (última aprovação de coordenação) redefine o ciclo;
  -- aqui como dono do banco, sem usuário, para fixar a data da aprovação
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.pedido_interno_transicao', 'permitida', true);
  update public.pedidos_internos set status = 'validado' where id = current_setting('t0172.lab')::bigint;
  update public.pedidos_internos set aprovacao_area_em = '2026-10-13 10:00-03' where id = current_setting('t0172.lab')::bigint;
  if (select ciclo_pagamento from public.pedidos_internos where id = current_setting('t0172.lab')::bigint) <> '2026-11-01' then
    raise exception '0172: aprovação do laboratório depois do prazo deveria ir ao ciclo seguinte';
  end if;
end $$;

rollback;
