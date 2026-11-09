-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0176 (decisão de Antonio em 09/11/2026): o pedido aprovado depois
-- do prazo do dia 10 só segue para compras quando o ciclo dele abrir; a
-- urgência justificada fura a trava.
--   * "hoje" é fixado na véspera do ciclo e depois no dia em que ele abre
--     (kontrol_private.hoje_brasilia, redefinida só nesta transação);
--   * avisos de validação e do laboratório dizem quando a formalização abre;
--   * "Aguardando você" não mostra o pedido travado;
--   * formalizar trava com mensagem clara; cancelar continua livre;
--   * a urgência não muda num pedido validado;
--   * no dia 1, a rotina avisa o administrativo e o pedido segue.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0176-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0176-' || p_rotulo)::uuid,
                      'email', 'ts-0176-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-0176-' || p_rotulo)::uuid
$$;

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception '0176: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception '0176: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

create function pg_temp.avisos(p_pedido bigint, p_titulo text) returns bigint language sql as $$
  select count(*) from public.notificacoes n
   where n.entidade_tipo = 'pedido_interno' and n.entidade_id = p_pedido and n.titulo = p_titulo
     and n.usuario_destino = md5('kontrol-0176-nath')::uuid
$$;

create function pg_temp.na_fila(p_pedido bigint) returns boolean language sql as $$
  select exists (
    select 1 from jsonb_array_elements(public.aguardando_voce()) e,
                  jsonb_array_elements(e -> 'itens') i
     where e ->> 'chave' = 'pedidos_administrativo' and (i ->> 'id')::bigint = p_pedido)
$$;

-- "hoje" em Brasília fixo nesta transação
create function pg_temp.hoje(p_dia date) returns void language plpgsql as $$
begin
  execute format(
    'create or replace function kontrol_private.hoje_brasilia() returns date language sql stable set search_path = '''' as $f$ select %L::date $f$',
    p_dia);
end $$;

do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_area bigint;
  v_pedido bigint;
  v_insumo bigint;
  v_ciclo date := kontrol_private.ciclo_para(now(), false);
begin
  foreach v_rotulo in array array['pedinte', 'coord', 'lab', 'nath'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-0176-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-0176 ' || v_rotulo,
           papel = case v_rotulo when 'pedinte' then 'laboratorio' when 'nath' then 'compra' else 'coordenador' end,
           suspenso = false, senha_provisoria = false,
           permissoes = case v_rotulo
             when 'pedinte' then '{"pedido.criar": true}'::jsonb
             else '{"pedido.criar": true, "pedido.aprovar": true, "compras.aprovar": true, "compras.cancelar": true}'::jsonb end
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-0176 projeto', pg_temp.uid('coord')) returning id into v_projeto;
  if to_regclass('kontrol_private.projetos_vinculos') is not null then
    execute 'insert into kontrol_private.projetos_vinculos (projeto_id, usuario_id) values ($1, $2) on conflict do nothing'
      using v_projeto, pg_temp.uid('coord');
  end if;
  insert into public.coordenacoes_area (nome, coordenador_id) values ('TS-0176 Lab', pg_temp.uid('lab')) returning id into v_area;
  insert into public.insumos (especificacao, unidade, fator_conversao, custo_unitario)
  values ('TS-0176 kit de extração', 'un', 1, 0) returning id into v_insumo;

  -- a: normal; u: urgente justificado; b: material de laboratório; c: será cancelado
  foreach v_rotulo in array array['a', 'u', 'b', 'c'] loop
    insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, area_id, objetivo,
                                         justificativa, urgencia, urgencia_justificativa)
    values ('TS-0176 pedido ' || v_rotulo, 'rascunho', 'ts-0176-pedinte@example.invalid', v_projeto,
            case v_rotulo when 'b' then 'material_consumo_lab' else 'material_consumo_geral' end,
            case v_rotulo when 'b' then v_area end,
            'projeto', 'Extração das amostras de campo',
            case v_rotulo when 'u' then 'alta' else 'normal' end,
            case v_rotulo when 'u' then 'Coleta marcada para a semana que vem.' end)
    returning id into v_pedido;
    insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade, orcamento_previo, insumo_id)
    values (v_pedido, 'material', 'TS-0176 kit', 2, 'un', 150, v_insumo);
    perform set_config('t0176.' || v_rotulo, v_pedido::text, true);
  end loop;

  update public.responsaveis_compras set usuario_id = pg_temp.uid('nath'), substituto_id = null where etapa = 'administrativo';

  -- véspera do ciclo em que os pedidos vão cair
  perform set_config('t0176.ciclo', v_ciclo::text, true);
  perform pg_temp.hoje(v_ciclo - 1);
end $$;

-- ---- regras -----------------------------------------------------------------------------
do $$
declare
  v_ciclo date := current_setting('t0176.ciclo')::date;
begin
  if kontrol_private.ciclo_libera_em(v_ciclo, 'normal', null) is distinct from v_ciclo
     or kontrol_private.ciclo_libera_em(v_ciclo, 'alta', 'Coleta marcada para a semana que vem.') is not null
     or kontrol_private.ciclo_libera_em(v_ciclo, 'alta', 'curta') is distinct from v_ciclo
     or kontrol_private.ciclo_libera_em(v_ciclo - 1, 'normal', null) is not null
     or kontrol_private.ciclo_libera_em(null, 'normal', null) is not null then
    raise exception '0176: ciclo_libera_em errado';
  end if;
  if kontrol_private.rotulo_ciclo(date '2026-12-01') <> 'dezembro/2026'
     or kontrol_private.rotulo_ciclo(date '2027-03-01') <> 'março/2027' then
    raise exception '0176: rotulo_ciclo errado: %', kontrol_private.rotulo_ciclo(date '2026-12-01');
  end if;
end $$;

-- ---- envio e validação na véspera do ciclo ------------------------------------------------
set local role authenticated;
select pg_temp.como('pedinte');
select public.transicionar_pedido_interno(current_setting('t0176.' || r)::bigint, 'em_validacao', 'Envio', 'registrado', null)
  from unnest(array['a', 'u', 'b', 'c']) r;

select pg_temp.como('coord');
select public.transicionar_pedido_interno(current_setting('t0176.' || r)::bigint, 'validado', 'Validação', 'aprovado', null)
  from unnest(array['a', 'u', 'b', 'c']) r;

select pg_temp.como('lab');
select public.decidir_coordenacao_laboratorio(current_setting('t0176.b')::bigint, 'aprovado', null);

reset role;
do $$
declare
  v_rotulo text := kontrol_private.rotulo_ciclo(current_setting('t0176.ciclo')::date);
  v_a bigint := current_setting('t0176.a')::bigint;
  v_u bigint := current_setting('t0176.u')::bigint;
  v_b bigint := current_setting('t0176.b')::bigint;
begin
  if (select ciclo_pagamento from public.pedidos_internos where id = v_a) is distinct from current_setting('t0176.ciclo')::date then
    raise exception '0176: ciclo do pedido normal deveria ser %', current_setting('t0176.ciclo');
  end if;
  if pg_temp.avisos(v_a, 'Pedido interno validado: aguarda o ciclo de ' || v_rotulo) <> 1
     or pg_temp.avisos(v_a, 'Pedido interno validado: formalizar a compra') <> 0 then
    raise exception '0176: aviso do pedido travado deveria dizer que aguarda o ciclo';
  end if;
  if not exists (select 1 from public.notificacoes
                  where entidade_tipo = 'pedido_interno' and entidade_id = v_a
                    and corpo like '%formalização abre em ' || to_char(current_setting('t0176.ciclo')::date, 'DD/MM/YYYY') || '%') then
    raise exception '0176: aviso do pedido travado deveria dizer quando abre';
  end if;
  if pg_temp.avisos(v_u, 'Pedido interno validado: formalizar a compra') <> 1 then
    raise exception '0176: urgente justificado deveria ir direto para formalizar';
  end if;
  if pg_temp.avisos(v_b, 'Laboratório aprovou: aguarda o ciclo de ' || v_rotulo) <> 1
     or pg_temp.avisos(v_b, 'Laboratório aprovou: formalizar a compra') <> 0 then
    raise exception '0176: aviso do laboratório deveria dizer que aguarda o ciclo';
  end if;
end $$;

-- ---- na véspera: fila, formalização travada, urgência fura, cancelar livre ----------------
set local role authenticated;
select pg_temp.como('nath');
do $$
begin
  if pg_temp.na_fila(current_setting('t0176.a')::bigint) or pg_temp.na_fila(current_setting('t0176.b')::bigint) then
    raise exception '0176: pedido travado não deveria estar em "Aguardando você": %', public.aguardando_voce();
  end if;
  if not pg_temp.na_fila(current_setting('t0176.u')::bigint) then
    raise exception '0176: urgente deveria estar em "Aguardando você": %', public.aguardando_voce();
  end if;
end $$;

select pg_temp.exigir_erro(
  format('select public.formalizar_pedido_interno(%s)', current_setting('t0176.a')),
  '22023', 'segue para compras a partir de ' || to_char(current_setting('t0176.ciclo')::date, 'DD/MM/YYYY'));
select pg_temp.exigir_erro(
  format('select public.transicionar_pedido_interno(%s, ''formalizado'', ''Formalização'', ''registrado'', null)', current_setting('t0176.b')),
  '22023', 'Só pedido urgente, com justificativa, fura o ciclo');
select public.formalizar_pedido_interno(current_setting('t0176.u')::bigint);
select public.cancelar_pedido_interno_operacional(current_setting('t0176.c')::bigint, null, 'TS-0176 cancelado');

-- a urgência não muda num pedido validado (contornaria a trava)
select pg_temp.exigir_erro(
  format('update public.pedidos_internos set urgencia = ''alta'', urgencia_justificativa = ''Precisa sair antes do ciclo.'' where id = %s',
         current_setting('t0176.a')),
  '42501', 'urgência só muda');

reset role;
do $$
begin
  if (select status from public.pedidos_internos where id = current_setting('t0176.a')::bigint) <> 'validado'
     or (select status from public.pedidos_internos where id = current_setting('t0176.u')::bigint) <> 'formalizado'
     or (select status from public.pedidos_internos where id = current_setting('t0176.c')::bigint) <> 'cancelado' then
    raise exception '0176: situação errada na véspera: %',
      (select json_agg(json_build_object('id', id, 'status', status)) from public.pedidos_internos where titulo like 'TS-0176%');
  end if;
end $$;

-- ---- o ciclo abre ------------------------------------------------------------------------
select pg_temp.hoje(current_setting('t0176.ciclo')::date);
do $$
declare
  v_titulo text := 'Ciclo de ' || kontrol_private.rotulo_ciclo(current_setting('t0176.ciclo')::date) || ' aberto: formalizar a compra';
  v_a bigint := current_setting('t0176.a')::bigint;
  v_b bigint := current_setting('t0176.b')::bigint;
begin
  perform kontrol_private.avisar_ciclo_aberto();
  perform kontrol_private.avisar_ciclo_aberto();  -- de novo: a chave evita aviso repetido
  if pg_temp.avisos(v_a, v_titulo) <> 1 or pg_temp.avisos(v_b, v_titulo) <> 1 then
    raise exception '0176: no dia 1 o administrativo deveria receber um aviso por pedido liberado (a=%, b=%)',
      pg_temp.avisos(v_a, v_titulo), pg_temp.avisos(v_b, v_titulo);
  end if;
  if pg_temp.avisos(current_setting('t0176.u')::bigint, v_titulo) <> 0 then
    raise exception '0176: pedido já formalizado não recebe aviso do ciclo';
  end if;
end $$;

set local role authenticated;
select pg_temp.como('nath');
do $$
begin
  if not pg_temp.na_fila(current_setting('t0176.a')::bigint) or not pg_temp.na_fila(current_setting('t0176.b')::bigint) then
    raise exception '0176: com o ciclo aberto, o pedido deveria estar em "Aguardando você": %', public.aguardando_voce();
  end if;
end $$;
select public.formalizar_pedido_interno(current_setting('t0176.a')::bigint);
select public.formalizar_pedido_interno(current_setting('t0176.b')::bigint);

reset role;
do $$
begin
  if exists (select 1 from public.pedidos_internos
              where id in (current_setting('t0176.a')::bigint, current_setting('t0176.b')::bigint)
                and status <> 'formalizado') then
    raise exception '0176: com o ciclo aberto, o pedido deveria seguir para compras';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'kontrol-ciclo-aberto' and schedule = '0 10 1 * *') then
    raise exception '0176: rotina do dia 1 não agendada';
  end if;
end $$;

rollback;
