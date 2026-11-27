-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Confere se as permissões de Compras valem de verdade (pedido de Antonio em
-- 17/11/2026, depois do teste da Rafaela, Giorgi e Nathi):
--   * uma pessoa da função Gestor que coordena o projeto faz o caminho inteiro
--     do pedido sozinha, do rascunho à compra concluída, pelas mesmas funções
--     que o app chama (envio, aprovação, formalização, autorização
--     administrativa, 3 orçamentos, aprovação final, fechamento, chegada pela
--     compra, entrega e pagamento);
--   * cada caixinha manda: sem "Aprovar pedidos" a formalização é recusada;
--     sem "Registrar chegada de compras" a chegada é recusada; sem "Criar
--     pedidos" o envio é recusado; sem "Cancelar compras e pedidos" o
--     cancelamento é recusado;
--   * o que NÃO é caixinha, de propósito (decisões de 09/11/2026): a aprovação
--     do coordenador é de quem coordena o projeto (o Administrador substitui),
--     e quem pediu não aprova o próprio pedido, a não ser que coordene o
--     projeto.
-- Tudo e revertido no ROLLBACK final.
begin;
-- 0188: este teste cobre a ordem antiga de aprovações (pedidos que já estavam no meio quando a nova entrou)
alter table public.pedidos_internos alter column fluxo set default 1;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- a trava do ciclo seguinte depende do dia de hoje e não é o assunto deste
-- teste; aqui todo ciclo já está aberto (desfeito no ROLLBACK final)
create or replace function kontrol_private.hoje_brasilia() returns date
  language sql stable set search_path = '' as $$ select date '2999-12-01' $$;

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-cp-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-cp-' || p_rotulo)::uuid,
                      'email', 'ts-cp-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-cp-' || p_rotulo)::uuid
$$;

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'compras_por_permissao: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception 'compras_por_permissao: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

create function pg_temp.id(p_chave text) returns bigint language sql as $$
  select current_setting('tcp.' || p_chave)::bigint
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
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa)
  values (p_titulo, 'rascunho', 'ts-cp-' || p_rotulo || '@example.invalid', pg_temp.id('projeto'),
          'material_consumo_geral', 'projeto', 'Teste das permissões de compras.')
  returning id into v_pedido;
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade, insumo_id, orcamento_previo)
  values (v_pedido, 'material', 'TS-CP luva nitrílica', 2, 'cx', pg_temp.id('insumo'), 45);
  return v_pedido;
end $$;

-- ---- pessoas, projeto e cadastros ----------------------------------------------------------
do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_insumo bigint;
  v_local bigint;
  i integer;
  v_f bigint;
begin
  -- gestora: função Gestor, coordena o projeto do teste (o caso da Rafaela);
  -- gestor2: função Gestor, sem coordenar; lab: Laboratório; adm: Administrador
  foreach v_rotulo in array array['gestora', 'gestor2', 'lab', 'adm'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-cp-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-CP ' || v_rotulo,
           papel = case v_rotulo when 'lab' then 'laboratorio' when 'adm' then 'admin' else 'gestor' end,
           suspenso = false, senha_provisoria = false, permissoes = '{}'::jsonb
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-CP projeto de teste', pg_temp.uid('gestora'))
  returning id into v_projeto;
  if to_regclass('kontrol_private.projetos_vinculos') is not null then
    execute 'insert into kontrol_private.projetos_vinculos (projeto_id, usuario_id) values ($1, $2) on conflict do nothing'
      using v_projeto, pg_temp.uid('gestora');
  end if;
  perform set_config('tcp.projeto', v_projeto::text, true);

  insert into public.insumos (especificacao, unidade, ativo, categoria_compra)
  values ('TS-CP luva nitrílica', 'cx', true, 'operacional') returning id into v_insumo;
  perform set_config('tcp.insumo', v_insumo::text, true);
  insert into public.locais (nome) values ('TS-CP armário') returning id into v_local;
  perform set_config('tcp.local', v_local::text, true);
  for i in 1..3 loop
    insert into public.fornecedores (nome, ativo) values ('TS-CP fornecedor ' || i, true) returning id into v_f;
    perform set_config('tcp.fornecedor' || i, v_f::text, true);
  end loop;
end $$;

-- ---- 1. A gestora faz o caminho inteiro sozinha --------------------------------------------
select pg_temp.como('gestora');
set local role authenticated;

select set_config('tcp.pedido', pg_temp.novo_pedido('gestora', 'TS-CP caminho inteiro')::text, true);
-- envio (Criar pedidos)
select pg_temp.etapa(pg_temp.id('pedido'), 'em_validacao');
-- aprovação do coordenador: é o próprio pedido, mas ela coordena o projeto
select pg_temp.etapa(pg_temp.id('pedido'), 'validado', 'aprovado');
-- formalização (Aprovar pedidos): nasce a compra
select public.formalizar_pedido_interno(pg_temp.id('pedido'));
select set_config('tcp.compra', (select pedido_compra_id from public.pedidos_internos where id = pg_temp.id('pedido'))::text, true);
-- autorização administrativa e liberação para cotação
select pg_temp.etapa(pg_temp.id('pedido'), 'analise_administrativa', 'registrado',
  '{"fonte_recurso": "Projeto", "rubrica": "Material de consumo", "conformidade_admin": "Conforme"}');
select pg_temp.etapa(pg_temp.id('pedido'), 'aprovado_compra', 'aprovado');
select pg_temp.etapa(pg_temp.id('pedido'), 'orcamentos');
-- 3 orçamentos de fornecedores diferentes; com eles recebidos, escolhe o mais barato
insert into public.pedidos_internos_cotacoes (pedido_interno_id, fornecedor_id, fornecedor_nome, valor_total, prazo_entrega_dias)
values (pg_temp.id('pedido'), pg_temp.id('fornecedor1'), 'TS-CP fornecedor 1', 90, 7),
       (pg_temp.id('pedido'), pg_temp.id('fornecedor2'), 'TS-CP fornecedor 2', 95, 7),
       (pg_temp.id('pedido'), pg_temp.id('fornecedor3'), 'TS-CP fornecedor 3', 99, 7);
select pg_temp.etapa(pg_temp.id('pedido'), 'orcamentos_recebidos');
select public.escolher_orcamento_pedido_interno(
  (select id from public.pedidos_internos_cotacoes where pedido_interno_id = pg_temp.id('pedido') and valor_total = 90),
  null);
select pg_temp.etapa(pg_temp.id('pedido'), 'aguardando_aprovacao_final');
-- aprovação final: é o próprio pedido, mas ela coordena o projeto
select pg_temp.etapa(pg_temp.id('pedido'), 'aprovado_para_compra', 'aprovado');
-- fechar com o fornecedor envia a compra (0182)
select pg_temp.etapa(pg_temp.id('pedido'), 'compra_fechada', 'aprovado');

reset role;
do $$
begin
  if (select status from public.pedidos_compra where id = pg_temp.id('compra')) <> 'enviado' then
    raise exception 'compras_por_permissao: fechar o pedido deveria enviar a compra';
  end if;
  if (select fornecedor_id from public.pedidos_compra where id = pg_temp.id('compra')) <> pg_temp.id('fornecedor1') then
    raise exception 'compras_por_permissao: o fornecedor do orçamento escolhido deveria ir para a compra';
  end if;
end $$;

-- chegada pela compra (Registrar chegada de compras), entrega e pagamento
select pg_temp.como('gestora');
set local role authenticated;
select public.receber_item_pedido_compra(
  pg_temp.id('compra'),
  (select id from public.pedidos_compra_itens where pedido_id = pg_temp.id('compra') limit 1),
  gen_random_uuid(), 2, null, 'TS-CP-L1', 'TS-CP gestora', null, pg_temp.id('local'));
select public.confirmar_entrega_pedido_interno(pg_temp.id('pedido'), null);
select pg_temp.etapa(pg_temp.id('pedido'), 'aguardando_pagamento_nf');
insert into public.pedidos_internos_anexos (pedido_interno_id, etapa, tipo, titulo, url)
values (pg_temp.id('pedido'), 'Pagamento', 'nota_fiscal', 'TS-CP NF 123', 'https://example.invalid/nf-123');
select pg_temp.etapa(pg_temp.id('pedido'), 'compra_concluida', 'aprovado');
reset role;

do $$
begin
  if (select status from public.pedidos_internos where id = pg_temp.id('pedido')) <> 'compra_concluida' then
    raise exception 'compras_por_permissao: o pedido deveria terminar como compra concluída';
  end if;
  if (select status from public.pedidos_compra where id = pg_temp.id('compra')) <> 'recebido' then
    raise exception 'compras_por_permissao: a compra deveria terminar recebida, está %',
      (select status from public.pedidos_compra where id = pg_temp.id('compra'));
  end if;
  if not exists (select 1 from public.lotes_estoque l
                  where l.insumo_id = pg_temp.id('insumo') and l.local_id = pg_temp.id('local')) then
    raise exception 'compras_por_permissao: a chegada deveria criar o lote no local escolhido';
  end if;
end $$;

-- ---- 2. Cada caixinha manda ---------------------------------------------------------------
-- novo pedido da gestora, já aprovado pelo coordenador, esperando a formalização
select pg_temp.como('gestora');
set local role authenticated;
select set_config('tcp.p2', pg_temp.novo_pedido('gestora', 'TS-CP caixinhas')::text, true);
select pg_temp.etapa(pg_temp.id('p2'), 'em_validacao');
select pg_temp.etapa(pg_temp.id('p2'), 'validado', 'aprovado');
reset role;

-- sem "Aprovar pedidos" (ajuste individual em Usuários), a formalização é recusada
update public.perfis set permissoes = '{"pedido.aprovar": false}'::jsonb where id = pg_temp.uid('gestora');
select pg_temp.como('gestora');
set local role authenticated;
select pg_temp.exigir_erro(format('select public.formalizar_pedido_interno(%s)', pg_temp.id('p2')), '42501', '');
reset role;
-- com a caixinha de volta, passa
update public.perfis set permissoes = '{}'::jsonb where id = pg_temp.uid('gestora');
select pg_temp.como('gestora');
set local role authenticated;
select public.formalizar_pedido_interno(pg_temp.id('p2'));
reset role;

-- quem é do Laboratório não tem "Aprovar pedidos" por padrão; marcar a caixinha
-- para a pessoa libera a mesma etapa
select pg_temp.como('gestora');
set local role authenticated;
select set_config('tcp.p3', pg_temp.novo_pedido('gestora', 'TS-CP laboratório com caixinha')::text, true);
select pg_temp.etapa(pg_temp.id('p3'), 'em_validacao');
select pg_temp.etapa(pg_temp.id('p3'), 'validado', 'aprovado');
reset role;
select pg_temp.como('lab');
set local role authenticated;
select pg_temp.exigir_erro(format('select public.formalizar_pedido_interno(%s)', pg_temp.id('p3')), '42501', '');
reset role;
update public.perfis set permissoes = '{"pedido.aprovar": true}'::jsonb where id = pg_temp.uid('lab');
select pg_temp.como('lab');
set local role authenticated;
select public.formalizar_pedido_interno(pg_temp.id('p3'));
reset role;
update public.perfis set permissoes = '{}'::jsonb where id = pg_temp.uid('lab');

-- sem "Criar pedidos", o envio é recusado
update public.perfis set permissoes = '{"pedido.criar": false}'::jsonb where id = pg_temp.uid('gestor2');
select pg_temp.como('gestora');
set local role authenticated;
select set_config('tcp.p4', pg_temp.novo_pedido('gestora', 'TS-CP envio sem a caixinha')::text, true);
reset role;
select pg_temp.como('gestor2');
set local role authenticated;
select pg_temp.exigir_erro(format('select pg_temp.etapa(%s, ''em_validacao'')', pg_temp.id('p4')), '42501', '');
reset role;
update public.perfis set permissoes = '{}'::jsonb where id = pg_temp.uid('gestor2');

-- sem "Cancelar compras e pedidos", o cancelamento é recusado; com ela, passa
update public.perfis set permissoes = '{"compras.cancelar": false}'::jsonb where id = pg_temp.uid('gestora');
select pg_temp.como('gestora');
set local role authenticated;
select pg_temp.exigir_erro(
  format('select public.cancelar_pedido_interno_operacional(%s, ''TS-CP sem a caixinha'')', pg_temp.id('p4')), '42501', '');
reset role;
update public.perfis set permissoes = '{}'::jsonb where id = pg_temp.uid('gestora');
select pg_temp.como('gestora');
set local role authenticated;
select public.cancelar_pedido_interno_operacional(pg_temp.id('p4'), 'TS-CP com a caixinha');
reset role;

-- sem "Registrar chegada de compras", a chegada é recusada
select pg_temp.como('gestora');
set local role authenticated;
select set_config('tcp.p5', pg_temp.novo_pedido('gestora', 'TS-CP chegada sem a caixinha')::text, true);
select pg_temp.etapa(pg_temp.id('p5'), 'em_validacao');
select pg_temp.etapa(pg_temp.id('p5'), 'validado', 'aprovado');
select public.formalizar_pedido_interno(pg_temp.id('p5'));
select pg_temp.etapa(pg_temp.id('p5'), 'analise_administrativa', 'registrado',
  '{"fonte_recurso": "Projeto", "rubrica": "Material de consumo", "conformidade_admin": "Conforme"}');
select pg_temp.etapa(pg_temp.id('p5'), 'aprovado_compra', 'aprovado');
select pg_temp.etapa(pg_temp.id('p5'), 'orcamentos');
insert into public.pedidos_internos_cotacoes (pedido_interno_id, fornecedor_id, fornecedor_nome, valor_total)
values (pg_temp.id('p5'), pg_temp.id('fornecedor1'), 'TS-CP fornecedor 1', 90),
       (pg_temp.id('p5'), pg_temp.id('fornecedor2'), 'TS-CP fornecedor 2', 95),
       (pg_temp.id('p5'), pg_temp.id('fornecedor3'), 'TS-CP fornecedor 3', 99);
select pg_temp.etapa(pg_temp.id('p5'), 'orcamentos_recebidos');
select public.escolher_orcamento_pedido_interno(
  (select id from public.pedidos_internos_cotacoes where pedido_interno_id = pg_temp.id('p5') and valor_total = 90), null);
select pg_temp.etapa(pg_temp.id('p5'), 'aguardando_aprovacao_final');
select pg_temp.etapa(pg_temp.id('p5'), 'aprovado_para_compra', 'aprovado');
select pg_temp.etapa(pg_temp.id('p5'), 'compra_fechada', 'aprovado');
select set_config('tcp.c5', (select pedido_compra_id from public.pedidos_internos where id = pg_temp.id('p5'))::text, true);
reset role;
update public.perfis set permissoes = '{"compras.receber": false}'::jsonb where id = pg_temp.uid('gestora');
select pg_temp.como('gestora');
set local role authenticated;
select pg_temp.exigir_erro(
  format('select public.receber_item_pedido_compra(%s, %s, gen_random_uuid(), 1, null, ''TS-CP-L2'', null, null, %s)',
         pg_temp.id('c5'),
         (select id from public.pedidos_compra_itens where pedido_id = pg_temp.id('c5') limit 1),
         pg_temp.id('local')),
  '42501', '');
reset role;
update public.perfis set permissoes = '{}'::jsonb where id = pg_temp.uid('gestora');

-- ---- 3. O que não é caixinha, de propósito -------------------------------------------------
-- aprovação do coordenador: outra pessoa da função Gestor, com todas as
-- caixinhas, não aprova pedido de projeto que não coordena
select pg_temp.como('gestora');
set local role authenticated;
select set_config('tcp.p6', pg_temp.novo_pedido('gestora', 'TS-CP aprovação do coordenador')::text, true);
select pg_temp.etapa(pg_temp.id('p6'), 'em_validacao');
reset role;
select pg_temp.como('gestor2');
set local role authenticated;
select pg_temp.exigir_erro(format('select pg_temp.etapa(%s, ''validado'', ''aprovado'')', pg_temp.id('p6')),
  '42501', 'Este pedido é validado por TS-CP gestora');
reset role;
-- o Administrador substitui
select pg_temp.como('adm');
set local role authenticated;
select pg_temp.etapa(pg_temp.id('p6'), 'validado', 'aprovado');
reset role;

-- quem pediu e não coordena o projeto não dá a aprovação final do próprio pedido
select pg_temp.como('gestor2');
set local role authenticated;
select set_config('tcp.p7', pg_temp.novo_pedido('gestor2', 'TS-CP pedido do gestor2')::text, true);
select pg_temp.etapa(pg_temp.id('p7'), 'em_validacao');
reset role;
-- a coordenadora aprova; o resto do caminho o próprio gestor2 conduz
select pg_temp.como('gestora');
set local role authenticated;
select pg_temp.etapa(pg_temp.id('p7'), 'validado', 'aprovado');
reset role;
select pg_temp.como('gestor2');
set local role authenticated;
select public.formalizar_pedido_interno(pg_temp.id('p7'));
select pg_temp.etapa(pg_temp.id('p7'), 'analise_administrativa', 'registrado',
  '{"fonte_recurso": "Projeto", "rubrica": "Material de consumo", "conformidade_admin": "Conforme"}');
select pg_temp.etapa(pg_temp.id('p7'), 'aprovado_compra', 'aprovado');
select pg_temp.etapa(pg_temp.id('p7'), 'orcamentos');
insert into public.pedidos_internos_cotacoes (pedido_interno_id, fornecedor_id, fornecedor_nome, valor_total)
values (pg_temp.id('p7'), pg_temp.id('fornecedor1'), 'TS-CP fornecedor 1', 90),
       (pg_temp.id('p7'), pg_temp.id('fornecedor2'), 'TS-CP fornecedor 2', 95),
       (pg_temp.id('p7'), pg_temp.id('fornecedor3'), 'TS-CP fornecedor 3', 99);
select pg_temp.etapa(pg_temp.id('p7'), 'orcamentos_recebidos');
select public.escolher_orcamento_pedido_interno(
  (select id from public.pedidos_internos_cotacoes where pedido_interno_id = pg_temp.id('p7') and valor_total = 90), null);
select pg_temp.etapa(pg_temp.id('p7'), 'aguardando_aprovacao_final');
select pg_temp.exigir_erro(format('select pg_temp.etapa(%s, ''aprovado_para_compra'', ''aprovado'')', pg_temp.id('p7')),
  '42501', 'Quem pediu não pode validar nem aprovar o próprio pedido');
reset role;
-- outra pessoa com "Aprovar pedidos" (aqui, a coordenadora) dá a aprovação final
select pg_temp.como('gestora');
set local role authenticated;
select pg_temp.etapa(pg_temp.id('p7'), 'aprovado_para_compra', 'aprovado');
reset role;

do $$
begin
  if (select status from public.pedidos_internos where id = pg_temp.id('p7')) <> 'aprovado_para_compra' then
    raise exception 'compras_por_permissao: a aprovação final por outra pessoa deveria valer';
  end if;
end $$;

select 'compras_por_permissao: ok' as resultado;

rollback;
