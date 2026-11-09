-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0173 (decisão D8 de 09/11/2026):
--   * responsáveis do administrativo e do pagamento: duas linhas fixas, só o
--     Administrador troca;
--   * cada passagem avisa quem age: coordenador na validação, responsável do
--     administrativo na formalização e autorização, o Administrador quando não
--     há responsável, o solicitante no cancelamento;
--   * compra que nasce do pedido não avisa "aguardando aprovação";
--   * "Aguardando você" por competência.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 0176: a trava do ciclo seguinte depende do dia de hoje e não é o assunto deste
-- teste; aqui todo ciclo já está aberto (desfeito no ROLLBACK final).
create or replace function kontrol_private.hoje_brasilia() returns date
  language sql stable set search_path = '' as $$ select date '2999-12-01' $$;

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0173-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0173-' || p_rotulo)::uuid,
                      'email', 'ts-0173-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-0173-' || p_rotulo)::uuid
$$;

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception '0173: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception '0173: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

create function pg_temp.pendencia(p_chave text, p_pedido bigint) returns boolean language sql as $$
  select exists (
    select 1 from jsonb_array_elements(public.aguardando_voce()) e
     where e ->> 'chave' = p_chave
       and e -> 'itens' @> jsonb_build_array(jsonb_build_object('id', p_pedido))
  )
$$;

create function pg_temp.aviso(p_pedido bigint, p_titulo text) returns record language sql as $$
  select n.usuario_destino, n.permissao_destino, n.papel_destino
    from public.notificacoes n
   where n.entidade_tipo = 'pedido_interno' and n.entidade_id = p_pedido and n.titulo = p_titulo
   order by n.id desc
   limit 1
$$;

-- ---- cadastro de responsáveis: duas linhas fixas --------------------------------------
do $$
begin
  if (select count(*) from public.responsaveis_compras where etapa in ('administrativo', 'pagamento')) <> 2 then
    raise exception '0173: responsaveis_compras deveria ter administrativo e pagamento';
  end if;
end $$;

do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_pedido bigint;
begin
  foreach v_rotulo in array array['pedinte', 'coord', 'nath'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-0173-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-0173 ' || v_rotulo,
           papel = case v_rotulo when 'coord' then 'coordenador' when 'nath' then 'compra' else 'laboratorio' end,
           suspenso = false, senha_provisoria = false,
           permissoes = case v_rotulo
             when 'coord' then '{"pedido.criar": true, "pedido.aprovar": true, "compras.cancelar": true}'::jsonb
             when 'nath' then '{"pedido.criar": true, "pedido.aprovar": true, "compras.aprovar": true}'::jsonb
             else '{"pedido.criar": true}'::jsonb end
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-0173 projeto', pg_temp.uid('coord')) returning id into v_projeto;
  if to_regclass('kontrol_private.projetos_vinculos') is not null then
    execute 'insert into kontrol_private.projetos_vinculos (projeto_id, usuario_id) values ($1, $2) on conflict do nothing'
      using v_projeto, pg_temp.uid('coord');
  end if;

  foreach v_rotulo in array array['a', 'b'] loop
    insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa, urgencia)
    values ('TS-0173 pedido ' || v_rotulo, 'rascunho', 'ts-0173-pedinte@example.invalid', v_projeto,
            'material_consumo_geral', 'projeto', 'teste', 'normal')
    returning id into v_pedido;
    insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade)
    values (v_pedido, 'servico', 'TS-0173 serviço', 1, 'un');
    perform set_config('t0173.' || v_rotulo, v_pedido::text, true);
  end loop;

  update public.responsaveis_compras set usuario_id = pg_temp.uid('nath'), substituto_id = null;
end $$;

-- a função de aviso respeita a ordem do destino: pessoa, permissão, papel
do $$
declare
  v_n record;
begin
  perform kontrol_private.notificar_pedido('sistema', 'TS-0173 destino', 'teste',
    current_setting('t0173.a')::bigint, null, null, 'ts-0173-destino', 'admin');
  select usuario_destino, permissao_destino, papel_destino into v_n
    from public.notificacoes where dedupe_key = 'ts-0173-destino';
  if v_n.papel_destino is distinct from 'admin' or v_n.usuario_destino is not null or v_n.permissao_destino is not null then
    raise exception '0173: aviso sem pessoa e sem permissão deveria ir ao papel admin: %', row_to_json(v_n);
  end if;
end $$;

set local role authenticated;

-- ---- só o Administrador troca os responsáveis ------------------------------------------
select pg_temp.como('coord');
update public.responsaveis_compras set usuario_id = pg_temp.uid('coord') where etapa = 'pagamento';
select pg_temp.exigir_erro(
  'insert into public.responsaveis_compras (etapa) values (''pagamento'')',
  '42501', 'responsaveis_compras');

-- ---- envio e validação -----------------------------------------------------------------
select pg_temp.como('pedinte');
select public.transicionar_pedido_interno(current_setting('t0173.a')::bigint, 'em_validacao', 'Envio', 'registrado', null);
select public.transicionar_pedido_interno(current_setting('t0173.b')::bigint, 'em_validacao', 'Envio', 'registrado', null);

select pg_temp.como('nath');
do $$
begin
  -- quem não coordena o projeto não vê o pedido para validar
  if pg_temp.pendencia('pedidos_validacao', current_setting('t0173.a')::bigint) then
    raise exception '0173: validação apareceu para quem não é o coordenador: %', public.aguardando_voce();
  end if;
end $$;

select pg_temp.como('coord');
do $$
begin
  if not pg_temp.pendencia('pedidos_validacao', current_setting('t0173.a')::bigint) then
    raise exception '0173: coordenador não vê o pedido para validar: %', public.aguardando_voce();
  end if;
end $$;
select public.transicionar_pedido_interno(current_setting('t0173.a')::bigint, 'validado', 'Validação', 'aprovado', null);

reset role;
do $$
declare
  v_n record;
begin
  select * into v_n from pg_temp.aviso(current_setting('t0173.a')::bigint, 'Pedido interno aguardando validação')
    as (usuario_destino uuid, permissao_destino text, papel_destino text);
  if v_n.usuario_destino is distinct from pg_temp.uid('coord') or v_n.permissao_destino is not null then
    raise exception '0173: aviso de validação deveria ir ao coordenador: %', row_to_json(v_n);
  end if;
  select * into v_n from pg_temp.aviso(current_setting('t0173.a')::bigint, 'Pedido interno validado: formalizar a compra')
    as (usuario_destino uuid, permissao_destino text, papel_destino text);
  if v_n.usuario_destino is distinct from pg_temp.uid('nath') then
    raise exception '0173: aviso de formalizar deveria ir ao responsável do administrativo: %', row_to_json(v_n);
  end if;
  if (select usuario_id from public.responsaveis_compras where etapa = 'pagamento') is distinct from pg_temp.uid('nath') then
    raise exception '0173: coordenador trocou o responsável do pagamento';
  end if;
end $$;

-- ---- formalização e autorização administrativa -----------------------------------------
set local role authenticated;
select pg_temp.como('nath');
do $$
begin
  if not pg_temp.pendencia('pedidos_administrativo', current_setting('t0173.a')::bigint) then
    raise exception '0173: responsável do administrativo não vê o pedido para formalizar: %', public.aguardando_voce();
  end if;
end $$;
select public.formalizar_pedido_interno(current_setting('t0173.a')::bigint);

reset role;
do $$
declare
  v_n record;
  v_compra bigint := (select pedido_compra_id from public.pedidos_internos where id = current_setting('t0173.a')::bigint);
begin
  select * into v_n from pg_temp.aviso(current_setting('t0173.a')::bigint, 'Pedido interno aguardando autorização administrativa')
    as (usuario_destino uuid, permissao_destino text, papel_destino text);
  if v_n.usuario_destino is distinct from pg_temp.uid('nath') then
    raise exception '0173: aviso da autorização administrativa deveria ir ao responsável: %', row_to_json(v_n);
  end if;
  if v_compra is null then
    raise exception '0173: formalização deveria criar a compra';
  end if;
  if exists (select 1 from public.notificacoes where entidade_tipo = 'pedido_compra' and entidade_id = v_compra
               and titulo = 'Compra aguardando aprovação') then
    raise exception '0173: compra ligada ao pedido não deveria avisar "aguardando aprovação"';
  end if;
end $$;

-- ---- sem responsável, o aviso vai ao Administrador -------------------------------------
update public.responsaveis_compras set usuario_id = null where etapa = 'administrativo';
set local role authenticated;
select pg_temp.como('coord');
select public.transicionar_pedido_interno(current_setting('t0173.b')::bigint, 'validado', 'Validação', 'aprovado', null);
-- cancelamento avisa o solicitante
select public.cancelar_pedido_interno_operacional(current_setting('t0173.b')::bigint, null, 'TS-0173 cancelado');

reset role;
do $$
declare
  v_n record;
begin
  select * into v_n from pg_temp.aviso(current_setting('t0173.b')::bigint, 'Pedido interno validado: formalizar a compra')
    as (usuario_destino uuid, permissao_destino text, papel_destino text);
  if v_n.usuario_destino is not null or v_n.permissao_destino is not null or v_n.papel_destino is distinct from 'admin' then
    raise exception '0173: sem responsável, o aviso deveria ir ao Administrador: %', row_to_json(v_n);
  end if;
  select * into v_n from pg_temp.aviso(current_setting('t0173.b')::bigint, 'Seu pedido interno foi cancelado')
    as (usuario_destino uuid, permissao_destino text, papel_destino text);
  if v_n.usuario_destino is distinct from pg_temp.uid('pedinte') then
    raise exception '0173: cancelamento deveria avisar o solicitante: %', row_to_json(v_n);
  end if;
end $$;

-- ---- quem não decide nada não tem pendência --------------------------------------------
set local role authenticated;
select pg_temp.como('pedinte');
do $$
begin
  if exists (select 1 from jsonb_array_elements(public.aguardando_voce()) e where (e ->> 'quantidade')::bigint > 0) then
    raise exception '0173: solicitante não deveria ter nada aguardando: %', public.aguardando_voce();
  end if;
end $$;

reset role;
rollback;
