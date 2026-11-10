-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0177 (ajuste da D5 em 10/11/2026): pedido devolvido que troca o item,
-- a quantidade ou a especificação passa de novo pelo coordenador, mesmo com o
-- valor total igual; sem mudança de objeto as aprovações continuam valendo. A
-- trava do ciclo seguinte fala em "ciclo de compras".
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- a trava do ciclo depende do dia de hoje: aqui todo ciclo já está aberto,
-- salvo o do pedido "t", empurrado para depois desta data (desfeito no ROLLBACK).
create or replace function kontrol_private.hoje_brasilia() returns date
  language sql stable set search_path = '' as $$ select date '2999-12-01' $$;

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0177-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0177-' || p_rotulo)::uuid,
                      'email', 'ts-0177-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-0177-' || p_rotulo)::uuid
$$;

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception '0177: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception '0177: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

create function pg_temp.status(p_pedido bigint) returns text language sql as $$
  select status from public.pedidos_internos where id = p_pedido
$$;

do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_pedido bigint;
  v_insumo bigint;
begin
  foreach v_rotulo in array array['pedinte', 'coord', 'nath'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-0177-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-0177 ' || v_rotulo,
           papel = case v_rotulo when 'pedinte' then 'laboratorio' when 'nath' then 'compra' else 'coordenador' end,
           suspenso = false, senha_provisoria = false,
           permissoes = case v_rotulo
             when 'pedinte' then '{"pedido.criar": true}'::jsonb
             else '{"pedido.criar": true, "pedido.aprovar": true, "compras.aprovar": true}'::jsonb end
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-0177 projeto', pg_temp.uid('coord')) returning id into v_projeto;
  if to_regclass('kontrol_private.projetos_vinculos') is not null then
    execute 'insert into kontrol_private.projetos_vinculos (projeto_id, usuario_id) values ($1, $2) on conflict do nothing'
      using v_projeto, pg_temp.uid('coord');
  end if;
  insert into public.insumos (especificacao, unidade, fator_conversao, custo_unitario)
  values ('TS-0177 kit de extração', 'un', 1, 0) returning id into v_insumo;
  perform set_config('t0177.insumo', v_insumo::text, true);

  -- a: sem mudança e depois especificação nova; b: quantidade e preço trocados com o
  -- mesmo total; c: devolvido antes da 0177 (sem a marca); t: travado pelo ciclo
  foreach v_rotulo in array array['a', 'b', 'c', 't'] loop
    insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa, urgencia)
    values ('TS-0177 pedido ' || v_rotulo, 'rascunho', 'ts-0177-pedinte@example.invalid', v_projeto,
            'material_consumo_geral', 'projeto', 'Extração das amostras de campo', 'normal')
    returning id into v_pedido;
    insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade, orcamento_previo, insumo_id)
    values (v_pedido, 'material', 'TS-0177 kit', 2, 'un', 150, v_insumo);
    perform set_config('t0177.' || v_rotulo, v_pedido::text, true);
  end loop;

  update public.responsaveis_compras set usuario_id = pg_temp.uid('nath'), substituto_id = null where etapa = 'administrativo';
end $$;

set local role authenticated;

-- ---- envio e validação -------------------------------------------------------------------
select pg_temp.como('pedinte');
select public.transicionar_pedido_interno(current_setting('t0177.a')::bigint, 'em_validacao', 'Envio', 'registrado', null);
select public.transicionar_pedido_interno(current_setting('t0177.b')::bigint, 'em_validacao', 'Envio', 'registrado', null);
select public.transicionar_pedido_interno(current_setting('t0177.c')::bigint, 'em_validacao', 'Envio', 'registrado', null);
select public.transicionar_pedido_interno(current_setting('t0177.t')::bigint, 'em_validacao', 'Envio', 'registrado', null);

select pg_temp.como('coord');
select public.transicionar_pedido_interno(current_setting('t0177.a')::bigint, 'validado', 'Validação', 'aprovado', null);
select public.transicionar_pedido_interno(current_setting('t0177.b')::bigint, 'validado', 'Validação', 'aprovado', null);
select public.transicionar_pedido_interno(current_setting('t0177.c')::bigint, 'validado', 'Validação', 'aprovado', null);
select public.transicionar_pedido_interno(current_setting('t0177.t')::bigint, 'validado', 'Validação', 'aprovado', null);

-- a marca dos itens aprovados não se edita pela API
select pg_temp.exigir_erro(
  format('update public.pedidos_internos set validacao_itens = ''x'' where id = %s', current_setting('t0177.a')),
  '42501', 'foto da validação');

reset role;
do $$
declare
  v_a bigint := current_setting('t0177.a')::bigint;
begin
  if (select validacao_itens from public.pedidos_internos where id = v_a) is null
     or (select validacao_itens from public.pedidos_internos where id = v_a)
        is distinct from kontrol_private.marca_itens_pedido_interno(v_a) then
    raise exception '0177: a validação não guardou a marca dos itens';
  end if;
end $$;

-- ---- os três são devolvidos pelo administrativo ------------------------------------------
set local role authenticated;
select pg_temp.como('nath');
select public.formalizar_pedido_interno(current_setting('t0177.a')::bigint);
select public.registrar_etapa_pedido_interno(current_setting('t0177.a')::bigint, 'analise_administrativa', 'Análise', 'registrado', null,
  '{"fonte_recurso": "Projeto", "rubrica": "Material de consumo", "conformidade_admin": "ok"}'::jsonb);
select public.transicionar_pedido_interno(current_setting('t0177.a')::bigint, 'ajuste_compras', 'Análise', 'devolvido', 'Anexe o orçamento prévio.');
select public.formalizar_pedido_interno(current_setting('t0177.b')::bigint);
select public.registrar_etapa_pedido_interno(current_setting('t0177.b')::bigint, 'analise_administrativa', 'Análise', 'registrado', null,
  '{"fonte_recurso": "Projeto", "rubrica": "Material de consumo", "conformidade_admin": "ok"}'::jsonb);
select public.transicionar_pedido_interno(current_setting('t0177.b')::bigint, 'ajuste_compras', 'Análise', 'devolvido', 'Revise o pedido.');
select public.formalizar_pedido_interno(current_setting('t0177.c')::bigint);
select public.registrar_etapa_pedido_interno(current_setting('t0177.c')::bigint, 'analise_administrativa', 'Análise', 'registrado', null,
  '{"fonte_recurso": "Projeto", "rubrica": "Material de consumo", "conformidade_admin": "ok"}'::jsonb);
select public.transicionar_pedido_interno(current_setting('t0177.c')::bigint, 'ajuste_compras', 'Análise', 'devolvido', 'Revise o pedido.');

-- ---- a: mesmo objeto (regravado com outras maiúsculas e espaços) mantém as aprovações -----
reset role;
delete from public.pedidos_internos_itens where pedido_interno_id = current_setting('t0177.a')::bigint;
insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade, orcamento_previo, insumo_id, fornecedor_sugerido)
values (current_setting('t0177.a')::bigint, 'material', '  ts-0177   KIT ', 2.00, 'UN', 150, current_setting('t0177.insumo')::bigint, 'Outro fornecedor');

set local role authenticated;
select pg_temp.como('pedinte');
do $$
declare
  v_a bigint := current_setting('t0177.a')::bigint;
  v_sit jsonb := public.reenvio_mantem_aprovacoes(v_a);
  v_r jsonb;
begin
  if not (v_sit ->> 'mantem')::boolean then
    raise exception '0177: mesmo objeto deveria manter as aprovações: %', v_sit;
  end if;
  v_r := public.reenviar_pedido_interno(v_a, 'Orçamento anexado.');
  if not (v_r ->> 'aprovacoes_mantidas')::boolean or pg_temp.status(v_a) <> 'validado' then
    raise exception '0177: reenvio sem mudança deveria voltar a validado: % (status %)', v_r, pg_temp.status(v_a);
  end if;
end $$;

reset role;
do $$
begin
  if not exists (select 1 from public.pedidos_internos_aprovacoes
                  where pedido_interno_id = current_setting('t0177.a')::bigint and etapa = 'Reenvio depois do ajuste'
                    and comentario like 'Aprovações mantidas: itens, valor, justificativa e projeto iguais%') then
    raise exception '0177: o registro do reenvio deveria citar os itens';
  end if;
end $$;

-- ---- a: devolvido de novo; especificação diferente com o mesmo valor volta ao coordenador --
set local role authenticated;
select pg_temp.como('nath');
select public.formalizar_pedido_interno(current_setting('t0177.a')::bigint);
select public.registrar_etapa_pedido_interno(current_setting('t0177.a')::bigint, 'analise_administrativa', 'Análise', 'registrado', null,
  '{"fonte_recurso": "Projeto", "rubrica": "Material de consumo", "conformidade_admin": "ok"}'::jsonb);
select public.transicionar_pedido_interno(current_setting('t0177.a')::bigint, 'ajuste_compras', 'Análise', 'devolvido', 'Confira a especificação.');

reset role;
update public.pedidos_internos_itens set especificacao = 'TS-0177 kit de outra marca'
 where pedido_interno_id = current_setting('t0177.a')::bigint;

set local role authenticated;
select pg_temp.como('pedinte');
do $$
declare
  v_a bigint := current_setting('t0177.a')::bigint;
  v_sit jsonb := public.reenvio_mantem_aprovacoes(v_a);
  v_r jsonb;
begin
  if (v_sit ->> 'mantem')::boolean or not (v_sit -> 'mudou') ? 'itens' or (v_sit -> 'mudou') ? 'valor' then
    raise exception '0177: especificação nova (valor igual) deveria voltar ao coordenador só pelos itens: %', v_sit;
  end if;
  v_r := public.reenviar_pedido_interno(v_a, null);
  if (v_r ->> 'aprovacoes_mantidas')::boolean or pg_temp.status(v_a) <> 'em_validacao' then
    raise exception '0177: objeto diferente deveria ir para validação: % (status %)', v_r, pg_temp.status(v_a);
  end if;
end $$;

reset role;
do $$
begin
  if (select validacao_itens from public.pedidos_internos where id = current_setting('t0177.a')::bigint) is not null then
    raise exception '0177: voltar para validação deveria descartar a marca dos itens';
  end if;
end $$;

-- ---- b: quantidade e preço trocados com o mesmo total (1 x 300 no lugar de 2 x 150) -------
update public.pedidos_internos_itens set quantidade = 1, orcamento_previo = 300
 where pedido_interno_id = current_setting('t0177.b')::bigint;

set local role authenticated;
select pg_temp.como('pedinte');
do $$
declare
  v_b bigint := current_setting('t0177.b')::bigint;
  v_sit jsonb := public.reenvio_mantem_aprovacoes(v_b);
begin
  if (v_sit ->> 'mantem')::boolean or (v_sit -> 'mudou') <> '["itens"]'::jsonb then
    raise exception '0177: quantidade diferente com o mesmo total deveria voltar ao coordenador: %', v_sit;
  end if;
  perform public.reenviar_pedido_interno(v_b, null);
  if pg_temp.status(v_b) <> 'em_validacao' then
    raise exception '0177: pedido b deveria ir para validação (status %)', pg_temp.status(v_b);
  end if;
end $$;

-- ---- c: devolvido antes da 0177 (sem a marca): passa de novo pelo coordenador ------------
reset role;
update public.pedidos_internos set validacao_itens = null where id = current_setting('t0177.c')::bigint;

set local role authenticated;
select pg_temp.como('pedinte');
do $$
declare
  v_c bigint := current_setting('t0177.c')::bigint;
  v_sit jsonb := public.reenvio_mantem_aprovacoes(v_c);
begin
  if (v_sit ->> 'mantem')::boolean or not (v_sit -> 'mudou') ? 'itens' then
    raise exception '0177: sem a marca dos itens o pedido deveria voltar ao coordenador: %', v_sit;
  end if;
end $$;

-- ---- t: a trava do ciclo seguinte fala em ciclo de compras ------------------------------
reset role;
update public.pedidos_internos set ciclo_pagamento = date '3000-01-01' where id = current_setting('t0177.t')::bigint;

set local role authenticated;
select pg_temp.como('nath');
select pg_temp.exigir_erro(
  format('select public.formalizar_pedido_interno(%s)', current_setting('t0177.t')),
  '22023', 'entrou no ciclo de compras de');

reset role;
rollback;
