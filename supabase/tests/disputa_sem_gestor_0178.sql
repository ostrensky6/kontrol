-- SOMENTE clone sintético local. Valida a 0178 (decisão de 10/11/2026): na
-- disputa de reservas o Gestor identifica a falta e pede, mas não decide.
-- Decidem Coordenador (ligado ao projeto do plano que cede), Supervisor e
-- Administrador. Tudo é revertido no ROLLBACK final.
\if :{?kontrol_test_local}
\else
  \echo '0178: falta acknowledgement explícito de banco descartável local.'
  \quit 3
\endif
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $$
begin
  if inet_server_addr() is not null
     and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception '0178: conexão não local.';
  end if;
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-0178-' || p_rotulo)::uuid
$$;

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.uid(p_rotulo)::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.uid(p_rotulo),
                      'email', 'ts-0178-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception '0178: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception '0178: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_insumo bigint; v_lote bigint;
  v_a bigint; v_b bigint; v_c bigint; v_d bigint; v_e bigint;
  v_d1 bigint; v_d2 bigint; v_d3 bigint; v_d4 bigint;
  v_res jsonb;
  n numeric;
  v_antes bigint;
begin
  foreach v_rotulo in array array['admin', 'sup', 'coord', 'coordfora', 'coordsusp', 'gestor', 'lab'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-0178-' || v_rotulo || '@example.invalid', now(), now());
    update public.perfis
       set nome = 'TS-0178 ' || v_rotulo,
           papel = case v_rotulo
             when 'admin' then 'admin' when 'sup' then 'supervisor' when 'gestor' then 'gestor'
             when 'lab' then 'laboratorio' else 'coordenador' end,
           suspenso = (v_rotulo = 'coordsusp'), senha_provisoria = false,
           -- o Gestor recebe tudo o que precisa para pedir: a recusa é só pela função.
           permissoes = case when v_rotulo in ('gestor', 'lab')
             then '{"planejamento.executar": true, "planejamento.ver": true}'::jsonb else '{}'::jsonb end
     where id = pg_temp.uid(v_rotulo);
  end loop;

  -- Projeto do plano que cede: Coordenador e Gestor ligados; "coordfora" não.
  insert into public.projetos (nome) values ('TS-0178 projeto') returning id into v_projeto;
  insert into kontrol_private.projetos_vinculos (projeto_id, usuario_id)
  values (v_projeto, pg_temp.uid('coord')), (v_projeto, pg_temp.uid('gestor'))
  on conflict do nothing;

  insert into public.insumos (especificacao, fator_conversao) values ('TS-0178 enzima', 1) returning id into v_insumo;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade)
  values (v_insumo, 'TS-0178-L1', 10, 10, 'aceito', current_date + 200) returning id into v_lote;
  insert into public.planejamento (nome, projeto_id) values ('TS-0178 A', v_projeto) returning id into v_a;
  insert into public.planejamento (nome) values ('TS-0178 B') returning id into v_b;
  insert into public.planejamento (nome) values ('TS-0178 C') returning id into v_c;
  insert into public.planejamento (nome) values ('TS-0178 D') returning id into v_d;
  insert into public.planejamento (nome) values ('TS-0178 E') returning id into v_e;

  perform pg_temp.como('admin');
  perform public.reservar_plano(v_a, jsonb_build_array(jsonb_build_object('insumo_id', v_insumo, 'quantidade', 10)));
  perform public.reservar_plano(v_b, jsonb_build_array(jsonb_build_object('insumo_id', v_insumo, 'quantidade', 4)));
  perform public.reservar_plano(v_c, jsonb_build_array(jsonb_build_object('insumo_id', v_insumo, 'quantidade', 2)));
  perform public.reservar_plano(v_d, jsonb_build_array(jsonb_build_object('insumo_id', v_insumo, 'quantidade', 1)));
  perform public.reservar_plano(v_e, jsonb_build_array(jsonb_build_object('insumo_id', v_insumo, 'quantidade', 1)));
  if kontrol_private.falta_reservada(v_b, v_insumo) <> 4 then
    raise exception '0178: preparo errado, falta de B = %', kontrol_private.falta_reservada(v_b, v_insumo);
  end if;

  -- 1. A regra do banco, função por função.
  perform pg_temp.como('gestor');
  if kontrol_private.pode_decidir_disputa_reserva() then
    raise exception '0178: a regra ainda deixa o Gestor decidir';
  end if;
  perform pg_temp.como('lab');
  if kontrol_private.pode_decidir_disputa_reserva() then
    raise exception '0178: a regra deixa o Laboratório decidir';
  end if;
  perform pg_temp.como('coordsusp');
  if kontrol_private.pode_decidir_disputa_reserva() then
    raise exception '0178: a regra deixa Coordenador suspenso decidir';
  end if;
  foreach v_rotulo in array array['coord', 'sup', 'admin'] loop
    perform pg_temp.como(v_rotulo);
    if not kontrol_private.pode_decidir_disputa_reserva() then
      raise exception '0178: a regra barrou %', v_rotulo;
    end if;
  end loop;
  if has_function_privilege('anon', 'kontrol_private.pode_decidir_disputa_reserva()', 'execute')
     or has_function_privilege('anon', 'public.decidir_disputa_reserva(bigint,text,bigint,text)', 'execute') then
    raise exception '0178: função aberta para quem não entrou';
  end if;

  -- 2. O Gestor identifica a falta e pede: continua funcionando.
  perform pg_temp.como('gestor');
  v_d1 := public.pedir_reserva_de_outro_plano(v_b, v_insumo, 'B começa antes');
  if not exists (select 1 from public.reservas_disputas
                  where id = v_d1 and status = 'pendente' and solicitado_por = pg_temp.uid('gestor')) then
    raise exception '0178: pedido do Gestor não ficou pendente em nome dele';
  end if;
  if not exists (select 1 from public.notificacoes where entidade_tipo = 'disputa_reserva' and entidade_id = v_d1) then
    raise exception '0178: pedido do Gestor sem aviso';
  end if;

  -- 3. O Gestor não decide, nem ligado ao projeto do plano que cede:
  --    nem transferir, nem negar. Nada muda no pedido nem nas reservas.
  select count(*) into v_antes from public.reservas_estoque where insumo_id = v_insumo;
  perform pg_temp.exigir_erro(
    format('select public.decidir_disputa_reserva(%s, ''transferir'', %s, ''eu decido'')', v_d1, v_a),
    '42501', 'O Gestor identifica a falta e pede a reserva');
  perform pg_temp.exigir_erro(
    format('select public.decidir_disputa_reserva(%s, ''negar'', null, ''eu nego'')', v_d1),
    '42501', 'Somente Coordenador, Supervisor ou Administrador');
  if not exists (select 1 from public.reservas_disputas
                  where id = v_d1 and status = 'pendente' and decidido_por is null and decidido_em is null) then
    raise exception '0178: tentativa do Gestor mexeu no pedido';
  end if;
  if (select count(*) from public.reservas_estoque where insumo_id = v_insumo) <> v_antes
     or kontrol_private.falta_reservada(v_b, v_insumo) <> 4 then
    raise exception '0178: tentativa do Gestor mexeu nas reservas';
  end if;
  select sum(quantidade) into n from public.reservas_estoque
   where planejamento_id = v_a and lote_id = v_lote and status = 'reservado';
  if n is distinct from 10 then
    raise exception '0178: A ficou com % depois da tentativa do Gestor', n;
  end if;

  -- 4. Continuam sem decidir: Laboratório e Coordenador suspenso.
  perform pg_temp.como('lab');
  perform pg_temp.exigir_erro(
    format('select public.decidir_disputa_reserva(%s, ''negar'', null, ''eu nego'')', v_d1),
    '42501', 'Somente Coordenador, Supervisor ou Administrador');
  perform pg_temp.como('coordsusp');
  perform pg_temp.exigir_erro(
    format('select public.decidir_disputa_reserva(%s, ''negar'', null, ''eu nego'')', v_d1),
    '42501', 'Somente Coordenador, Supervisor ou Administrador');

  -- 5. Coordenador de fora do projeto não tira reserva do plano A (regra da 0160, mantida).
  perform pg_temp.como('coordfora');
  perform pg_temp.exigir_erro(
    format('select public.decidir_disputa_reserva(%s, ''transferir'', %s, ''tiro de A'')', v_d1, v_a),
    '42501', 'ligado ao projeto');
  if (select status from public.reservas_disputas where id = v_d1) <> 'pendente' then
    raise exception '0178: recusa do Coordenador de fora mudou o pedido';
  end if;

  -- 6. Coordenador ligado ao projeto transfere.
  perform pg_temp.como('coord');
  v_res := public.decidir_disputa_reserva(v_d1, 'transferir', v_a, 'B tem prazo de entrega');
  if v_res->>'status' <> 'transferida' or (v_res->>'transferido')::numeric <> 4 then
    raise exception '0178: Coordenador não transferiu 4 (%)', v_res;
  end if;
  if not exists (select 1 from public.reservas_disputas
                  where id = v_d1 and status = 'transferida' and decidido_por = pg_temp.uid('coord')) then
    raise exception '0178: decisão do Coordenador não ficou registrada em nome dele';
  end if;
  if kontrol_private.falta_reservada(v_b, v_insumo) <> 0 or kontrol_private.falta_reservada(v_a, v_insumo) <> 4 then
    raise exception '0178: transferência do Coordenador com falta errada';
  end if;

  -- 7. Supervisor decide (aqui, nega) o pedido que o Gestor fez.
  perform pg_temp.como('gestor');
  v_d2 := public.pedir_reserva_de_outro_plano(v_c, v_insumo, 'C também precisa');
  perform pg_temp.como('sup');
  v_res := public.decidir_disputa_reserva(v_d2, 'negar', null, 'Compra chega amanhã');
  if v_res->>'status' <> 'negada' or kontrol_private.falta_reservada(v_c, v_insumo) <> 2 then
    raise exception '0178: Supervisor não negou direito (%)', v_res;
  end if;
  if not exists (select 1 from public.notificacoes where entidade_tipo = 'disputa_reserva'
                  and entidade_id = v_d2 and usuario_destino = pg_temp.uid('gestor')) then
    raise exception '0178: o Gestor que pediu não foi avisado da decisão';
  end if;

  -- 8. Administrador transfere; Supervisor também transfere sem estar ligado ao projeto.
  perform pg_temp.como('gestor');
  v_d3 := public.pedir_reserva_de_outro_plano(v_d, v_insumo, 'D é urgente');
  v_d4 := public.pedir_reserva_de_outro_plano(v_e, v_insumo, 'E é urgente');
  perform pg_temp.como('admin');
  v_res := public.decidir_disputa_reserva(v_d3, 'transferir', v_a, 'D primeiro');
  if v_res->>'status' <> 'transferida' or (v_res->>'transferido')::numeric <> 1 then
    raise exception '0178: Administrador não transferiu 1 (%)', v_res;
  end if;
  perform pg_temp.como('sup');
  v_res := public.decidir_disputa_reserva(v_d4, 'transferir', v_a, 'E em seguida');
  if v_res->>'status' <> 'transferida' or (v_res->>'transferido')::numeric <> 1 then
    raise exception '0178: Supervisor não transferiu 1 (%)', v_res;
  end if;

  -- 9. Conta final: o lote nunca fica reservado acima do saldo e nenhuma
  --    decisão ficou em nome do Gestor.
  select sum(quantidade) into n from public.reservas_estoque where lote_id = v_lote and status = 'reservado';
  if n is distinct from 10 then
    raise exception '0178: lote com % reservado (saldo 10)', n;
  end if;
  select sum(quantidade) into n from public.reservas_estoque
   where planejamento_id = v_a and lote_id = v_lote and status = 'reservado';
  if n is distinct from 4 then
    raise exception '0178: A terminou com % reservado, esperado 4', n;
  end if;
  if exists (select 1 from public.reservas_disputas
              where id in (v_d1, v_d2, v_d3, v_d4) and decidido_por = pg_temp.uid('gestor')) then
    raise exception '0178: decisão registrada em nome do Gestor';
  end if;
  -- Decisão repetida continua recusada, agora para quem pode decidir.
  perform pg_temp.exigir_erro(
    format('select public.decidir_disputa_reserva(%s, ''negar'', null, ''tarde'')', v_d1),
    '55000', 'já foi decidido');
end $$;

rollback;
