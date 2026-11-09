-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0175 (decisão D5 de 09/11/2026): pedido devolvido e reenviado sem
-- mudar valor, justificativa e projeto mantém as aprovações; se algo mudou,
-- passa de novo pelo coordenador.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0175-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0175-' || p_rotulo)::uuid,
                      'email', 'ts-0175-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-0175-' || p_rotulo)::uuid
$$;

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception '0175: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception '0175: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

create function pg_temp.status(p_pedido bigint) returns text language sql as $$
  select status from public.pedidos_internos where id = p_pedido
$$;

create function pg_temp.avisos(p_pedido bigint, p_titulo text) returns bigint language sql as $$
  select count(*) from public.notificacoes n
   where n.entidade_tipo = 'pedido_interno' and n.entidade_id = p_pedido and n.titulo = p_titulo
$$;

do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_area bigint;
  v_pedido bigint;
  v_insumo bigint;
begin
  foreach v_rotulo in array array['pedinte', 'coord', 'lab', 'nath'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-0175-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-0175 ' || v_rotulo,
           papel = case v_rotulo when 'pedinte' then 'laboratorio' when 'nath' then 'compra' else 'coordenador' end,
           suspenso = false, senha_provisoria = false,
           permissoes = case v_rotulo
             when 'pedinte' then '{"pedido.criar": true}'::jsonb
             else '{"pedido.criar": true, "pedido.aprovar": true, "compras.aprovar": true}'::jsonb end
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-0175 projeto', pg_temp.uid('coord')) returning id into v_projeto;
  if to_regclass('kontrol_private.projetos_vinculos') is not null then
    execute 'insert into kontrol_private.projetos_vinculos (projeto_id, usuario_id) values ($1, $2) on conflict do nothing'
      using v_projeto, pg_temp.uid('coord');
  end if;
  insert into public.coordenacoes_area (nome, coordenador_id) values ('TS-0175 Lab', pg_temp.uid('lab')) returning id into v_area;
  perform set_config('t0175.projeto', v_projeto::text, true);
  insert into public.insumos (especificacao, unidade, fator_conversao, custo_unitario)
  values ('TS-0175 kit de extração', 'un', 1, 0) returning id into v_insumo;

  -- a: consumo geral; b: material de laboratório; c: devolvido já na validação
  foreach v_rotulo in array array['a', 'b', 'c'] loop
    insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, area_id, objetivo, justificativa, urgencia)
    values ('TS-0175 pedido ' || v_rotulo, 'rascunho', 'ts-0175-pedinte@example.invalid', v_projeto,
            case v_rotulo when 'b' then 'material_consumo_lab' else 'material_consumo_geral' end,
            case v_rotulo when 'b' then v_area end,
            'projeto', 'Extração das amostras de campo', 'normal')
    returning id into v_pedido;
    insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade, orcamento_previo, insumo_id)
    values (v_pedido, 'material', 'TS-0175 kit', 2, 'un', 150, v_insumo);
    perform set_config('t0175.' || v_rotulo, v_pedido::text, true);
  end loop;

  update public.responsaveis_compras set usuario_id = pg_temp.uid('nath'), substituto_id = null where etapa = 'administrativo';
end $$;

set local role authenticated;

-- ---- envio e validação -------------------------------------------------------------------
select pg_temp.como('pedinte');
select public.transicionar_pedido_interno(current_setting('t0175.a')::bigint, 'em_validacao', 'Envio', 'registrado', null);
select public.transicionar_pedido_interno(current_setting('t0175.b')::bigint, 'em_validacao', 'Envio', 'registrado', null);
select public.transicionar_pedido_interno(current_setting('t0175.c')::bigint, 'em_validacao', 'Envio', 'registrado', null);

select pg_temp.como('coord');
select public.transicionar_pedido_interno(current_setting('t0175.a')::bigint, 'validado', 'Validação', 'aprovado', null);
select public.transicionar_pedido_interno(current_setting('t0175.b')::bigint, 'validado', 'Validação', 'aprovado', null);
select public.transicionar_pedido_interno(current_setting('t0175.c')::bigint, 'ajuste_solicitante', 'Validação', 'devolvido', 'Falta o volume.');

-- a foto da validação não se edita pela API
select pg_temp.exigir_erro(
  format('update public.pedidos_internos set validacao_valor = 1 where id = %s', current_setting('t0175.a')),
  '42501', 'foto da validação');

reset role;
do $$
declare
  v_a bigint := current_setting('t0175.a')::bigint;
begin
  if (select validacao_valor from public.pedidos_internos where id = v_a) is distinct from 300.00
     or (select validacao_projeto_id from public.pedidos_internos where id = v_a) is distinct from current_setting('t0175.projeto')::bigint
     or (select validacao_registrada_em from public.pedidos_internos where id = v_a) is null then
    raise exception '0175: foto da validação não gravou: %',
      (select row_to_json(p) from (select validacao_projeto_id, validacao_justificativa, validacao_valor, validacao_registrada_em
                                     from public.pedidos_internos where id = v_a) p);
  end if;
  perform set_config('t0175.ciclo_a', (select ciclo_pagamento from public.pedidos_internos where id = v_a)::text, true);
end $$;

-- ---- a: devolvido pelo administrativo e reenviado sem mudança ----------------------------
set local role authenticated;
select pg_temp.como('nath');
select public.formalizar_pedido_interno(current_setting('t0175.a')::bigint);
select public.registrar_etapa_pedido_interno(current_setting('t0175.a')::bigint, 'analise_administrativa', 'Análise', 'registrado', null,
  '{"fonte_recurso": "Projeto", "rubrica": "Material de consumo", "conformidade_admin": "ok"}'::jsonb);
select public.transicionar_pedido_interno(current_setting('t0175.a')::bigint, 'ajuste_compras', 'Análise', 'devolvido', 'Falta o orçamento prévio assinado.');

select pg_temp.como('pedinte');
do $$
declare
  v_a bigint := current_setting('t0175.a')::bigint;
  v_sit jsonb := public.reenvio_mantem_aprovacoes(v_a);
  v_r jsonb;
begin
  if not (v_sit ->> 'mantem')::boolean then
    raise exception '0175: pedido sem mudança deveria manter as aprovações: %', v_sit;
  end if;
  v_r := public.reenviar_pedido_interno(v_a, 'Orçamento anexado.');
  if not (v_r ->> 'aprovacoes_mantidas')::boolean or pg_temp.status(v_a) <> 'validado' then
    raise exception '0175: reenvio sem mudança deveria voltar a validado: % (status %)', v_r, pg_temp.status(v_a);
  end if;
end $$;

reset role;
do $$
declare
  v_a bigint := current_setting('t0175.a')::bigint;
begin
  if not exists (select 1 from public.pedidos_internos_aprovacoes
                  where pedido_interno_id = v_a and etapa = 'Reenvio depois do ajuste'
                    and status_origem = 'ajuste_compras' and status_destino = 'validado'
                    and comentario like 'Aprovações mantidas%Orçamento anexado.') then
    raise exception '0175: reenvio não ficou registrado nas aprovações';
  end if;
  if (select ciclo_pagamento from public.pedidos_internos where id = v_a)::text is distinct from current_setting('t0175.ciclo_a') then
    raise exception '0175: aprovações mantidas deveriam manter o ciclo de pagamento';
  end if;
  if (select validacao_registrada_em from public.pedidos_internos where id = v_a) is null then
    raise exception '0175: foto da validação sumiu no reenvio sem mudança';
  end if;
  if pg_temp.avisos(v_a, 'Pedido interno aguardando validação') <> 1 then
    raise exception '0175: reenvio sem mudança não deveria pedir validação de novo';
  end if;
end $$;

-- ---- a: devolvido de novo, agora com valor diferente: volta ao coordenador ---------------
set local role authenticated;
select pg_temp.como('nath');
select public.formalizar_pedido_interno(current_setting('t0175.a')::bigint);
select public.registrar_etapa_pedido_interno(current_setting('t0175.a')::bigint, 'analise_administrativa', 'Análise', 'registrado', null,
  '{"fonte_recurso": "Projeto", "rubrica": "Material de consumo", "conformidade_admin": "ok"}'::jsonb);
select public.transicionar_pedido_interno(current_setting('t0175.a')::bigint, 'ajuste_compras', 'Análise', 'devolvido', 'Revise a quantidade.');

reset role;
update public.pedidos_internos_itens set quantidade = 3 where pedido_interno_id = current_setting('t0175.a')::bigint;

set local role authenticated;
select pg_temp.como('pedinte');
do $$
declare
  v_a bigint := current_setting('t0175.a')::bigint;
  v_sit jsonb := public.reenvio_mantem_aprovacoes(v_a);
  v_r jsonb;
begin
  if (v_sit ->> 'mantem')::boolean or not (v_sit -> 'mudou') ? 'valor' then
    raise exception '0175: valor mudou e deveria voltar ao coordenador: %', v_sit;
  end if;
  v_r := public.reenviar_pedido_interno(v_a, null);
  if (v_r ->> 'aprovacoes_mantidas')::boolean or pg_temp.status(v_a) <> 'em_validacao' then
    raise exception '0175: reenvio com valor novo deveria ir para validação: % (status %)', v_r, pg_temp.status(v_a);
  end if;
end $$;

reset role;
do $$
begin
  if (select validacao_registrada_em from public.pedidos_internos where id = current_setting('t0175.a')::bigint) is not null then
    raise exception '0175: voltar para validação deveria descartar a foto antiga';
  end if;
end $$;

-- ---- b: laboratório devolve; reenvio sem mudança volta ao laboratório -------------------
set local role authenticated;
select pg_temp.como('lab');
select public.decidir_coordenacao_laboratorio(current_setting('t0175.b')::bigint, 'devolvido', 'Use o kit do fornecedor homologado.');

select pg_temp.como('pedinte');
do $$
declare
  v_b bigint := current_setting('t0175.b')::bigint;
  v_r jsonb := public.reenviar_pedido_interno(v_b, 'Kit trocado pelo homologado, mesmo preço.');
begin
  if not (v_r ->> 'aprovacoes_mantidas')::boolean or not (v_r ->> 'aguarda_laboratorio')::boolean
     or pg_temp.status(v_b) <> 'validado' then
    raise exception '0175: reenvio ao laboratório errado: % (status %)', v_r, pg_temp.status(v_b);
  end if;
end $$;

reset role;
do $$
declare
  v_b bigint := current_setting('t0175.b')::bigint;
begin
  if (select aprovacao_area_em from public.pedidos_internos where id = v_b) is not null then
    raise exception '0175: laboratório que devolveu precisa decidir de novo';
  end if;
  if pg_temp.avisos(v_b, 'Pedido interno aguardando a coordenação do laboratório') <> 2 then
    raise exception '0175: reenvio deveria avisar a coordenação do laboratório de novo (avisos: %)',
      pg_temp.avisos(v_b, 'Pedido interno aguardando a coordenação do laboratório');
  end if;
end $$;

-- ---- b: laboratório aprova; administrativo devolve; reenvio mantém o laboratório --------
set local role authenticated;
select pg_temp.como('lab');
select public.decidir_coordenacao_laboratorio(current_setting('t0175.b')::bigint, 'aprovado', null);
select pg_temp.como('nath');
select public.formalizar_pedido_interno(current_setting('t0175.b')::bigint);
select public.registrar_etapa_pedido_interno(current_setting('t0175.b')::bigint, 'analise_administrativa', 'Análise', 'registrado', null,
  '{"fonte_recurso": "Projeto", "rubrica": "Material de consumo", "conformidade_admin": "ok"}'::jsonb);
select public.transicionar_pedido_interno(current_setting('t0175.b')::bigint, 'ajuste_compras', 'Análise', 'devolvido', 'Anexe a cotação.');
select pg_temp.como('pedinte');
select public.reenviar_pedido_interno(current_setting('t0175.b')::bigint, null);

reset role;
do $$
declare
  v_b bigint := current_setting('t0175.b')::bigint;
begin
  if pg_temp.status(v_b) <> 'validado' or (select aprovacao_area_em from public.pedidos_internos where id = v_b) is null then
    raise exception '0175: aprovação do laboratório deveria continuar valendo';
  end if;
  if pg_temp.avisos(v_b, 'Pedido interno aguardando a coordenação do laboratório') <> 2 then
    raise exception '0175: laboratório já aprovou e não deveria ser avisado de novo';
  end if;
  if not exists (select 1 from public.notificacoes
                  where entidade_tipo = 'pedido_interno' and entidade_id = v_b
                    and titulo = 'Pedido interno validado: formalizar a compra'
                    and corpo like '%Reenviado depois do ajuste%'
                    and usuario_destino = pg_temp.uid('nath')) then
    raise exception '0175: responsável do administrativo deveria saber do reenvio';
  end if;
end $$;

-- ---- c: devolvido na própria validação: reenvio passa pelo coordenador -----------------
set local role authenticated;
select pg_temp.como('pedinte');
do $$
declare
  v_c bigint := current_setting('t0175.c')::bigint;
  v_r jsonb := public.reenviar_pedido_interno(v_c, null);
begin
  if (v_r ->> 'aprovacoes_mantidas')::boolean or pg_temp.status(v_c) <> 'em_validacao' then
    raise exception '0175: sem validação anterior o reenvio vai para validação: % (status %)', v_r, pg_temp.status(v_c);
  end if;
end $$;
select pg_temp.exigir_erro(
  format('select public.reenviar_pedido_interno(%s, null)', current_setting('t0175.c')),
  '22023', 'Só pedido devolvido');

reset role;
rollback;
