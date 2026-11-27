-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- 0184: caixinha "Conduzir a compra inteira" (compras.conduzir). Pedido de
-- Antonio em 24/11/2026: quem tem a permissão de compras executa todas as
-- etapas e não para na etapa 3 (Administrativo).
--   * uma pessoa da função Compra, que não coordena o projeto nem o
--     laboratório, faz o pedido inteiro sozinha: envio, aprovação no lugar do
--     coordenador, aprovação no lugar do laboratório, formalização antes do
--     ciclo abrir (24/11, depois do dia 10), autorização, 3 orçamentos,
--     aprovação final do próprio pedido, fechamento, chegada, entrega e
--     pagamento; a passagem antes do ciclo fica na linha do tempo;
--   * envia pedido de projeto sem coordenador indicado;
--   * sem a caixinha (ajuste individual), as regras de antes valem: não
--     aprova no lugar do coordenador e a trava do ciclo segura;
--   * com a caixinha marcada só para ela (ajuste individual), uma pessoa da
--     função Gestor também substitui.
-- Tudo e revertido no ROLLBACK final.
begin;
-- 0188: este teste cobre a ordem antiga de aprovações (pedidos que já estavam no meio quando a nova entrou)
alter table public.pedidos_internos alter column fluxo set default 1;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- hoje fixo: 24/11/2026, depois do prazo do dia 10 (o ciclo seguinte trava)
create or replace function kontrol_private.hoje_brasilia() returns date
  language sql stable set search_path = '' as $$ select date '2026-11-24' $$;

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-cc-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-cc-' || p_rotulo)::uuid,
                      'email', 'ts-cc-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-cc-' || p_rotulo)::uuid
$$;

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'conduzir_compra_inteira: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception 'conduzir_compra_inteira: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

create function pg_temp.id(p_chave text) returns bigint language sql as $$
  select current_setting('tcc.' || p_chave)::bigint
$$;

-- o mesmo botão do app: registrar_etapa_pedido_interno
create function pg_temp.etapa(p_pedido bigint, p_para text, p_decisao text default 'registrado', p_dados jsonb default '{}')
returns void language plpgsql as $$
begin
  perform public.registrar_etapa_pedido_interno(p_pedido, p_para, p_para, p_decisao, null, p_dados);
end $$;

-- pedido em rascunho com um item ligado ao insumo, criado por quem está na sessão
create function pg_temp.novo_pedido(p_rotulo text, p_titulo text) returns bigint language plpgsql as $$
declare
  v_pedido bigint;
begin
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa, area_id)
  values (p_titulo, 'rascunho', 'ts-cc-' || p_rotulo || '@example.invalid', pg_temp.id('projeto'),
          'material_consumo_lab', 'projeto', 'Teste de quem conduz a compra inteira.', pg_temp.id('area'))
  returning id into v_pedido;
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade, insumo_id, orcamento_previo)
  values (v_pedido, 'material', 'TS-CC luva nitrílica', 2, 'cx', pg_temp.id('insumo'), 45);
  return v_pedido;
end $$;

-- ---- pessoas, projetos, laboratório e cadastros -------------------------------------------
do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_projeto_sem bigint;
  v_area bigint;
  v_insumo bigint;
  v_local bigint;
  i integer;
  v_f bigint;
begin
  -- compras: função Compra; coord: coordena o projeto; labc: coordena o
  -- laboratório; gestor2: função Gestor, sem coordenar nada
  foreach v_rotulo in array array['compras', 'coord', 'labc', 'gestor2'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-cc-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-CC ' || v_rotulo,
           papel = case v_rotulo when 'compras' then 'compra' when 'labc' then 'laboratorio'
                                 when 'coord' then 'coordenador' else 'gestor' end,
           suspenso = false, senha_provisoria = false, permissoes = '{}'::jsonb
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-CC projeto', pg_temp.uid('coord'))
  returning id into v_projeto;
  perform set_config('tcc.projeto', v_projeto::text, true);
  insert into public.projetos (nome) values ('TS-CC projeto sem coordenador')
  returning id into v_projeto_sem;
  perform set_config('tcc.projeto_sem', v_projeto_sem::text, true);
  insert into public.coordenacoes_area (nome, coordenador_id) values ('TS-CC laboratório', pg_temp.uid('labc'))
  returning id into v_area;
  perform set_config('tcc.area', v_area::text, true);

  insert into public.insumos (especificacao, unidade, ativo, categoria_compra)
  values ('TS-CC luva nitrílica', 'cx', true, 'operacional') returning id into v_insumo;
  perform set_config('tcc.insumo', v_insumo::text, true);
  insert into public.locais (nome) values ('TS-CC armário') returning id into v_local;
  perform set_config('tcc.local', v_local::text, true);
  for i in 1..3 loop
    insert into public.fornecedores (nome, ativo) values ('TS-CC fornecedor ' || i, true) returning id into v_f;
    perform set_config('tcc.fornecedor' || i, v_f::text, true);
  end loop;
end $$;

-- a função Compra nasce com todas as caixinhas de Compras e a nova
do $$
declare
  k text;
begin
  foreach k in array array['pedido.criar', 'pedido.aprovar', 'pedido.urgencia', 'compras.aprovar',
                           'compras.receber', 'compras.cancelar', 'compras.conduzir', 'recebimento.registrar'] loop
    if not kontrol_private.tem_permissao_do_usuario(pg_temp.uid('compras'), k) then
      raise exception 'conduzir_compra_inteira: a função Compra deveria ter "%"', k;
    end if;
  end loop;
  if kontrol_private.tem_permissao_do_usuario(pg_temp.uid('gestor2'), 'compras.conduzir') then
    raise exception 'conduzir_compra_inteira: a função Gestor não deveria nascer com "Conduzir a compra inteira"';
  end if;
end $$;

-- ---- 1. A pessoa de Compras faz o pedido inteiro sozinha -----------------------------------
select pg_temp.como('compras');
set local role authenticated;
select set_config('tcc.pedido', pg_temp.novo_pedido('compras', 'TS-CC caminho inteiro')::text, true);
select pg_temp.etapa(pg_temp.id('pedido'), 'em_validacao');
-- no lugar do coordenador do projeto (e é o próprio pedido)
select pg_temp.etapa(pg_temp.id('pedido'), 'validado', 'aprovado');
-- no lugar da coordenação do laboratório
select public.decidir_coordenacao_laboratorio(pg_temp.id('pedido'), 'aprovado', null);
reset role;

do $$
begin
  if (select ciclo_pagamento from public.pedidos_internos where id = pg_temp.id('pedido')) <> date '2026-12-01' then
    raise exception 'conduzir_compra_inteira: aprovado em 24/11, o pedido deveria cair no ciclo de dezembro, caiu em %',
      (select ciclo_pagamento from public.pedidos_internos where id = pg_temp.id('pedido'));
  end if;
end $$;

-- etapa 3: formaliza antes do ciclo abrir
select pg_temp.como('compras');
set local role authenticated;
select public.formalizar_pedido_interno(pg_temp.id('pedido'));
select set_config('tcc.compra', (select pedido_compra_id from public.pedidos_internos where id = pg_temp.id('pedido'))::text, true);
select pg_temp.etapa(pg_temp.id('pedido'), 'analise_administrativa', 'registrado',
  '{"fonte_recurso": "Projeto", "rubrica": "Material de consumo", "conformidade_admin": "Conforme"}');
select pg_temp.etapa(pg_temp.id('pedido'), 'aprovado_compra', 'aprovado');
select pg_temp.etapa(pg_temp.id('pedido'), 'orcamentos');
insert into public.pedidos_internos_cotacoes (pedido_interno_id, fornecedor_id, fornecedor_nome, valor_total, prazo_entrega_dias)
values (pg_temp.id('pedido'), pg_temp.id('fornecedor1'), 'TS-CC fornecedor 1', 90, 7),
       (pg_temp.id('pedido'), pg_temp.id('fornecedor2'), 'TS-CC fornecedor 2', 95, 7),
       (pg_temp.id('pedido'), pg_temp.id('fornecedor3'), 'TS-CC fornecedor 3', 99, 7);
select pg_temp.etapa(pg_temp.id('pedido'), 'orcamentos_recebidos');
select public.escolher_orcamento_pedido_interno(
  (select id from public.pedidos_internos_cotacoes where pedido_interno_id = pg_temp.id('pedido') and valor_total = 90),
  null);
select pg_temp.etapa(pg_temp.id('pedido'), 'aguardando_aprovacao_final');
-- aprovação final do próprio pedido
select pg_temp.etapa(pg_temp.id('pedido'), 'aprovado_para_compra', 'aprovado');
select pg_temp.etapa(pg_temp.id('pedido'), 'compra_fechada', 'aprovado');
select public.receber_item_pedido_compra(
  pg_temp.id('compra'),
  (select id from public.pedidos_compra_itens where pedido_id = pg_temp.id('compra') limit 1),
  gen_random_uuid(), 2, null, 'TS-CC-L1', 'TS-CC compras', null, pg_temp.id('local'));
select public.confirmar_entrega_pedido_interno(pg_temp.id('pedido'), null);
select pg_temp.etapa(pg_temp.id('pedido'), 'aguardando_pagamento_nf');
insert into public.pedidos_internos_anexos (pedido_interno_id, etapa, tipo, titulo, url)
values (pg_temp.id('pedido'), 'Pagamento', 'nota_fiscal', 'TS-CC NF 1', 'https://example.invalid/nf-1');
select pg_temp.etapa(pg_temp.id('pedido'), 'compra_concluida', 'aprovado');
reset role;

do $$
begin
  if (select status from public.pedidos_internos where id = pg_temp.id('pedido')) <> 'compra_concluida' then
    raise exception 'conduzir_compra_inteira: o pedido deveria terminar como compra concluída';
  end if;
  if not exists (select 1 from public.eventos_status e
                  where e.entidade = 'pedido_interno' and e.entidade_id = pg_temp.id('pedido')
                    and e.observacao like 'Seguiu para compras antes do ciclo de dezembro/2026 abrir%') then
    raise exception 'conduzir_compra_inteira: a passagem antes do ciclo deveria ficar na linha do tempo';
  end if;
  if not exists (select 1 from public.pedidos_internos_aprovacoes a
                  where a.pedido_interno_id = pg_temp.id('pedido')
                    and a.etapa = 'Aprovação da coordenação do laboratório'
                    and a.responsavel = 'ts-cc-compras@example.invalid') then
    raise exception 'conduzir_compra_inteira: a aprovação pelo laboratório deveria ficar com o nome de quem aprovou';
  end if;
end $$;

-- ---- 2. Projeto sem coordenador: quem conduz envia e aprova -------------------------------
select pg_temp.como('compras');
set local role authenticated;
select set_config('tcc.p2', pg_temp.novo_pedido('compras', 'TS-CC sem coordenador')::text, true);
update public.pedidos_internos set projeto_id = pg_temp.id('projeto_sem') where id = pg_temp.id('p2');
select pg_temp.etapa(pg_temp.id('p2'), 'em_validacao');
select pg_temp.etapa(pg_temp.id('p2'), 'validado', 'aprovado');
reset role;

-- ---- 3. Sem a caixinha, as regras de antes valem ------------------------------------------
update public.perfis set permissoes = '{"compras.conduzir": false}'::jsonb where id = pg_temp.uid('compras');
select pg_temp.como('compras');
set local role authenticated;
select set_config('tcc.p3', pg_temp.novo_pedido('compras', 'TS-CC sem a caixinha')::text, true);
select pg_temp.etapa(pg_temp.id('p3'), 'em_validacao');
select pg_temp.exigir_erro(format('select pg_temp.etapa(%s, ''validado'', ''aprovado'')', pg_temp.id('p3')),
  '42501', 'Quem pediu não pode validar nem aprovar o próprio pedido');
reset role;
-- o coordenador e o laboratório aprovam; a formalização para na trava do ciclo
select pg_temp.como('coord');
set local role authenticated;
select pg_temp.etapa(pg_temp.id('p3'), 'validado', 'aprovado');
reset role;
select pg_temp.como('labc');
set local role authenticated;
select public.decidir_coordenacao_laboratorio(pg_temp.id('p3'), 'aprovado', null);
reset role;
select pg_temp.como('compras');
set local role authenticated;
select pg_temp.exigir_erro(format('select public.formalizar_pedido_interno(%s)', pg_temp.id('p3')),
  '22023', 'Este pedido entrou no ciclo de compras de dezembro/2026');
reset role;

-- ---- 4. Caixinha marcada só para uma pessoa da função Gestor -------------------------------
update public.perfis set permissoes = '{"compras.conduzir": true}'::jsonb where id = pg_temp.uid('gestor2');
select pg_temp.como('gestor2');
set local role authenticated;
select pg_temp.etapa(pg_temp.id('p3'), 'formalizado', 'aprovado');
reset role;

do $$
begin
  if (select status from public.pedidos_internos where id = pg_temp.id('p3')) <> 'formalizado' then
    raise exception 'conduzir_compra_inteira: com a caixinha, o Gestor deveria seguir antes do ciclo';
  end if;
end $$;

select 'conduzir_compra_inteira: ok' as resultado;

rollback;
