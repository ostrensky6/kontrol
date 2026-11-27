-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- 0188: nova ordem das aprovações (decisão de Antonio em 27/11/2026).
--   * pedido novo nasce na ordem nova (fluxo 2); quem pede registra os 3
--     orçamentos no rascunho, cada um com o documento, e só então envia;
--   * o envio vai para o laboratório ou campo e escolhe o orçamento de menor valor;
--   * cada vez só é decidida por quem é competente (coordenação da área,
--     financeiro = função Administrativo, coordenador do projeto) ou por quem
--     conduz a compra inteira;
--   * devolver volta a quem pediu; corrigido sem mudar o que foi aprovado, volta
--     direto para quem devolveu; com item mudado, recomeça pelo laboratório;
--   * o financeiro escolhe a fonte da lista; a aprovação do projeto cria e
--     aprova a compra formal e define o ciclo;
--   * reprovar vale nas três vezes; os passos da ordem antiga são recusados;
--   * avisos e "Aguardando você" seguem as vezes novas.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- hoje fixo no começo do mês: o ciclo é o do mês corrente (sem trava do dia 10)
create or replace function kontrol_private.hoje_brasilia() returns date
  language sql stable set search_path = '' as $$ select date '2026-11-05' $$;

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-no-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-no-' || p_rotulo)::uuid,
                      'email', 'ts-no-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-no-' || p_rotulo)::uuid
$$;

create function pg_temp.id(p_chave text) returns bigint language sql as $$
  select current_setting('tno.' || p_chave)::bigint
$$;

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'nova_ordem_0188: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception 'nova_ordem_0188: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

create function pg_temp.status(p_pedido bigint) returns text language sql as $$
  select status from public.pedidos_internos where id = p_pedido
$$;

create function pg_temp.conferir(p_ok boolean, p_texto text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'nova_ordem_0188: %', p_texto;
  end if;
end $$;

-- pedido em rascunho, com um item ligado ao insumo, aberto pelo "solic" (chamar como solic)
create function pg_temp.novo_pedido(p_titulo text) returns bigint language plpgsql as $$
declare
  v_pedido bigint;
begin
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa, area_id)
  values (p_titulo, 'rascunho', 'ts-no-solic@example.invalid', pg_temp.id('projeto'),
          'material_consumo_geral', 'projeto', 'Teste da nova ordem.', pg_temp.id('area'))
  returning id into v_pedido;
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade, insumo_id, orcamento_previo)
  values (v_pedido, 'material', 'TS-NO luva nitrílica', 2, 'cx', pg_temp.id('insumo'), 45);
  return v_pedido;
end $$;

-- um orçamento com documento (chamar como solic)
create function pg_temp.orcamento(p_pedido bigint, p_fornecedor text, p_valor numeric, p_com_documento boolean default true)
returns bigint language plpgsql as $$
declare
  v_anexo bigint;
  v_id bigint;
begin
  if p_com_documento then
    insert into public.pedidos_internos_anexos (pedido_interno_id, tipo, titulo, url)
    values (p_pedido, 'proposta', 'Orçamento: ' || p_fornecedor, 'https://example.invalid/' || md5(p_fornecedor))
    returning id into v_anexo;
  end if;
  insert into public.pedidos_internos_cotacoes (pedido_interno_id, fornecedor_id, fornecedor_nome, valor_total, prazo_entrega_dias, anexo_id)
  values (p_pedido, case when p_fornecedor = 'Loja B' then pg_temp.id('fornecedor') end, p_fornecedor, p_valor, 10, v_anexo)
  returning id into v_id;
  return v_id;
end $$;

-- ---- pessoas, projeto, laboratório, fornecedor e insumo -----------------------------------
do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_area bigint;
  v_insumo bigint;
  v_fornecedor bigint;
begin
  -- solic: pede (Laboratório); labc: coordena o laboratório; fin: função
  -- Administrativo; coord: coordena o projeto; lab2: Laboratório, sem coordenar nada
  foreach v_rotulo in array array['solic', 'labc', 'fin', 'coord', 'lab2'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-no-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-NO ' || v_rotulo,
           papel = case v_rotulo when 'fin' then 'administrativo' when 'coord' then 'coordenador' else 'laboratorio' end,
           suspenso = false, senha_provisoria = false, permissoes = '{}'::jsonb
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-NO projeto', pg_temp.uid('coord'))
  returning id into v_projeto;
  perform set_config('tno.projeto', v_projeto::text, true);
  insert into public.coordenacoes_area (nome, coordenador_id) values ('TS-NO laboratório', pg_temp.uid('labc'))
  returning id into v_area;
  perform set_config('tno.area', v_area::text, true);
  insert into public.insumos (especificacao, unidade, ativo, categoria_compra)
  values ('TS-NO luva nitrílica', 'cx', true, 'operacional') returning id into v_insumo;
  perform set_config('tno.insumo', v_insumo::text, true);
  insert into public.fornecedores (nome) values ('TS-NO Loja B') returning id into v_fornecedor;
  perform set_config('tno.fornecedor', v_fornecedor::text, true);
end $$;

-- ---- 0. Lista de fontes e pedido novo na ordem nova ---------------------------------------
select pg_temp.conferir(
  (select count(*) from public.fontes_recurso where nome in ('Ineo', 'Funpar', 'ATGC', 'CNPq') and ativo) = 4,
  'as quatro fontes de pagamento deveriam estar na lista');
select pg_temp.conferir(
  (select modelo_documento from public.fontes_recurso where nome = 'Ineo') = 'solicitacao_compras'
  and (select modelo_documento from public.fontes_recurso where nome = 'Funpar') = 'termo_referencia',
  'Ineo pede a Solicitação de Compras e Funpar o Termo de Referência');

select pg_temp.como('lab2');
set local role authenticated;
select pg_temp.exigir_erro($$insert into public.fontes_recurso (nome) values ('TS-NO fonte')$$, '42501', 'row-level security');
reset role;

select pg_temp.como('solic');
set local role authenticated;
select set_config('tno.p1', pg_temp.novo_pedido('TS-NO pedido principal')::text, true);
reset role;
select pg_temp.conferir((select fluxo from public.pedidos_internos where id = pg_temp.id('p1')) = 2,
  'pedido novo deveria nascer na ordem nova (fluxo 2)');

-- ---- 1. O envio exige os 3 orçamentos, cada um com documento ------------------------------
select pg_temp.como('solic');
set local role authenticated;
select pg_temp.exigir_erro(format('select public.enviar_pedido_interno(%s)', pg_temp.id('p1')),
  '22023', 'Este pedido tem 0');
-- a ordem antiga não serve para pedido novo
select pg_temp.exigir_erro(
  format($$select public.registrar_etapa_pedido_interno(%s, 'em_validacao', 'Envio', 'registrado')$$, pg_temp.id('p1')),
  '22023', 'segue a ordem nova');
select pg_temp.orcamento(pg_temp.id('p1'), 'Loja A', 300);
select pg_temp.orcamento(pg_temp.id('p1'), 'Loja B', 250);
select set_config('tno.c3', pg_temp.orcamento(pg_temp.id('p1'), 'Loja C', 280, false)::text, true);
select pg_temp.exigir_erro(format('select public.enviar_pedido_interno(%s)', pg_temp.id('p1')),
  '22023', 'Há 2 com documento');
-- o solicitante troca o orçamento sem documento por um com documento
delete from public.pedidos_internos_cotacoes where id = pg_temp.id('c3');
select pg_temp.orcamento(pg_temp.id('p1'), 'Loja C', 280);
select public.enviar_pedido_interno(pg_temp.id('p1'));
-- enviado, o orçamento não muda mais pela mão de quem pediu
select pg_temp.exigir_erro(format('select pg_temp.orcamento(%s, %L, 200)', pg_temp.id('p1'), 'Loja D'),
  '22023', 'Os orçamentos entram com o pedido');
reset role;

do $$
declare
  v record;
begin
  select * into v from public.pedidos_internos where id = pg_temp.id('p1');
  perform pg_temp.conferir(v.status = 'aguardando_area', 'enviado, o pedido deveria aguardar o laboratório ou campo: ' || v.status);
  perform pg_temp.conferir(v.validacao_registrada_em is not null and v.validacao_valor = 90,
    'o envio deveria guardar a foto do que foi enviado');
  perform pg_temp.conferir(v.enviado_validacao_em is not null, 'o envio deveria carimbar a data');
  perform pg_temp.conferir(
    (select fornecedor_nome from public.pedidos_internos_cotacoes where pedido_interno_id = v.id and escolhida) = 'Loja B',
    'sem escolha, o envio deveria escolher o orçamento de menor valor (Loja B)');
  perform pg_temp.conferir(exists (
    select 1 from public.notificacoes n
     where n.entidade_tipo = 'pedido_interno' and n.entidade_id = v.id
       and n.usuario_destino = pg_temp.uid('labc') and n.titulo like '%laboratório ou campo%'),
    'o coordenador do laboratório deveria ser avisado');
end $$;

-- "Aguardando você" do coordenador do laboratório mostra o pedido
select pg_temp.como('labc');
set local role authenticated;
select pg_temp.conferir(exists (
  select 1 from jsonb_array_elements(public.aguardando_voce()) e
   where e ->> 'chave' = 'pedidos_laboratorio' and (e ->> 'quantidade')::int >= 1),
  'o pedido deveria aparecer em "Aguardando você" do coordenador do laboratório');
reset role;

-- ---- 2. Só quem é competente decide cada vez ------------------------------------------------
select pg_temp.como('lab2');
set local role authenticated;
select pg_temp.exigir_erro(format($$select public.decidir_aprovacao_pedido(%s, 'aprovado')$$, pg_temp.id('p1')),
  '42501', 'coordenação de TS-NO laboratório');
reset role;
select pg_temp.como('fin');
set local role authenticated;
select pg_temp.exigir_erro(format($$select public.decidir_aprovacao_pedido(%s, 'aprovado')$$, pg_temp.id('p1')),
  '42501', 'coordenação de TS-NO laboratório');
reset role;

select pg_temp.como('labc');
set local role authenticated;
select public.decidir_aprovacao_pedido(pg_temp.id('p1'), 'aprovado', 'Material necessário.');
reset role;
select pg_temp.conferir(pg_temp.status(pg_temp.id('p1')) = 'aguardando_financeiro', 'aprovado pelo laboratório, vai ao financeiro');
select pg_temp.conferir((select aprovacao_area_em is not null and aprovacao_area_por = 'ts-no-labc@example.invalid'
                           from public.pedidos_internos where id = pg_temp.id('p1')),
  'a aprovação do laboratório deveria ficar gravada');
select pg_temp.conferir(exists (
  select 1 from public.pedidos_internos_aprovacoes
   where pedido_interno_id = pg_temp.id('p1') and etapa = 'Aprovação do laboratório ou campo' and decisao = 'aprovado'),
  'a decisão deveria ficar gravada com o nome da vez');

-- ---- 3. Financeiro devolve; corrigido sem mudança, volta direto ao financeiro --------------
select pg_temp.como('coord');
set local role authenticated;
select pg_temp.exigir_erro(format($$select public.decidir_aprovacao_pedido(%s, 'aprovado')$$, pg_temp.id('p1')),
  '42501', 'Esta aprovação é do financeiro');
reset role;
select pg_temp.como('fin');
set local role authenticated;
select pg_temp.exigir_erro(format($$select public.decidir_aprovacao_pedido(%s, 'devolvido', '  ')$$, pg_temp.id('p1')),
  '22023', 'Escreva o que precisa ser corrigido');
select public.decidir_aprovacao_pedido(pg_temp.id('p1'), 'devolvido', 'Falta o número do convênio na justificativa');
reset role;
select pg_temp.conferir((select status = 'ajuste_solicitante' and devolvido_na_etapa = 'aguardando_financeiro'
                           from public.pedidos_internos where id = pg_temp.id('p1')),
  'devolvido pelo financeiro, o pedido volta a quem pediu, marcado');
select pg_temp.conferir(exists (
  select 1 from public.notificacoes n
   where n.entidade_tipo = 'pedido_interno' and n.entidade_id = pg_temp.id('p1')
     and n.usuario_destino = pg_temp.uid('solic') and n.corpo like '%aprovação financeira%'),
  'quem pediu deveria ser avisado da devolução, com a vez que devolveu');

select pg_temp.como('solic');
set local role authenticated;
select public.enviar_pedido_interno(pg_temp.id('p1'));
reset role;
select pg_temp.conferir((select status = 'aguardando_financeiro' and aprovacao_area_em is not null and devolvido_na_etapa is null
                           from public.pedidos_internos where id = pg_temp.id('p1')),
  'corrigido sem mudar itens, valor, justificativa e projeto, volta direto ao financeiro com a aprovação do laboratório');

-- ---- 4. Financeiro aprova com a fonte da lista ----------------------------------------------
select pg_temp.como('fin');
set local role authenticated;
select pg_temp.exigir_erro(format($$select public.decidir_aprovacao_pedido(%s, 'aprovado')$$, pg_temp.id('p1')),
  '22023', 'Escolha a fonte de pagamento');
select pg_temp.exigir_erro(
  format($$select public.decidir_aprovacao_pedido(%s, 'aprovado', null, '{"fonte_recurso": "Banco X"}')$$, pg_temp.id('p1')),
  '22023', 'não está na lista');
-- quem aprova troca o orçamento, com justificativa
select pg_temp.exigir_erro(
  format('select public.escolher_orcamento_pedido_interno(%s)',
         (select id from public.pedidos_internos_cotacoes where pedido_interno_id = pg_temp.id('p1') and fornecedor_nome = 'Loja C')),
  '22023', 'não é o orçamento mais barato');
select public.decidir_aprovacao_pedido(pg_temp.id('p1'), 'aprovado', null,
  '{"fonte_recurso": "ineo", "rubrica": "Material de consumo"}');
reset role;
select pg_temp.conferir((select status = 'aguardando_projeto' and fonte_recurso = 'Ineo' and rubrica = 'Material de consumo'
                                and aprovacao_financeiro_por = 'ts-no-fin@example.invalid'
                           from public.pedidos_internos where id = pg_temp.id('p1')),
  'aprovado pelo financeiro com a fonte Ineo (nome da lista), vai ao coordenador do projeto');
select pg_temp.conferir(exists (
  select 1 from public.notificacoes n
   where n.entidade_tipo = 'pedido_interno' and n.entidade_id = pg_temp.id('p1')
     and n.usuario_destino = pg_temp.uid('coord') and n.titulo like '%coordenador do projeto%'),
  'o coordenador do projeto deveria ser avisado');

-- ---- 5. Coordenador do projeto aprova: compra criada e aprovada, ciclo definido -------------
select pg_temp.como('coord');
set local role authenticated;
select public.decidir_aprovacao_pedido(pg_temp.id('p1'), 'aprovado');
reset role;
do $$
declare
  v record;
  c record;
begin
  select * into v from public.pedidos_internos where id = pg_temp.id('p1');
  perform pg_temp.conferir(v.status = 'aprovado_para_compra', 'com as três aprovações, o pedido fica aprovado para compra: ' || v.status);
  perform pg_temp.conferir(v.ciclo_pagamento = kontrol_private.ciclo_para(now(), false),
    'a aprovação do projeto deveria definir o ciclo de pagamento');
  perform pg_temp.conferir(v.aprovador_coordenador = 'ts-no-coord@example.invalid' and v.aprovacao_final_em is not null,
    'a aprovação do projeto deveria ficar gravada');
  select * into c from public.pedidos_compra where id = v.pedido_compra_id;
  perform pg_temp.conferir(c.id is not null and c.status = 'aprovado', 'a compra formal deveria nascer aprovada junto');
  perform pg_temp.conferir(c.fornecedor_id = pg_temp.id('fornecedor'), 'a compra deveria levar o fornecedor do orçamento escolhido');
  perform pg_temp.conferir((select count(*) from public.pedidos_compra_itens where pedido_id = c.id) = 1,
    'a compra deveria levar o item rastreável');
end $$;

-- ---- 6. Reprovar na vez do laboratório ------------------------------------------------------
select pg_temp.como('solic');
set local role authenticated;
select set_config('tno.p2', pg_temp.novo_pedido('TS-NO reprovado pelo laboratório')::text, true);
select pg_temp.orcamento(pg_temp.id('p2'), 'Loja A', 300);
select pg_temp.orcamento(pg_temp.id('p2'), 'Loja B', 250);
select pg_temp.orcamento(pg_temp.id('p2'), 'Loja C', 280);
select public.enviar_pedido_interno(pg_temp.id('p2'));
reset role;
select pg_temp.como('lab2');
set local role authenticated;
select pg_temp.exigir_erro(format('select public.reprovar_pedido_interno(%s, %L)', pg_temp.id('p2'), 'não'),
  '42501', 'coordenação de TS-NO laboratório');
reset role;
select pg_temp.como('labc');
set local role authenticated;
select public.reprovar_pedido_interno(pg_temp.id('p2'), 'Já há luvas sobrando no almoxarifado');
reset role;
select pg_temp.conferir(pg_temp.status(pg_temp.id('p2')) = 'cancelado', 'reprovado, o pedido acaba');
select pg_temp.conferir(exists (
  select 1 from public.pedidos_internos_aprovacoes
   where pedido_interno_id = pg_temp.id('p2') and decisao = 'reprovado'
     and etapa = 'Aprovação do laboratório ou campo' and status_origem = 'aguardando_area'),
  'a reprovação deveria ficar gravada na vez do laboratório');

-- ---- 7. Devolvido pelo projeto com item mudado: recomeça pelo laboratório -------------------
select pg_temp.como('solic');
set local role authenticated;
select set_config('tno.p3', pg_temp.novo_pedido('TS-NO item mudado')::text, true);
select pg_temp.orcamento(pg_temp.id('p3'), 'Loja A', 300);
select pg_temp.orcamento(pg_temp.id('p3'), 'Loja B', 250);
select pg_temp.orcamento(pg_temp.id('p3'), 'Loja C', 280);
select public.enviar_pedido_interno(pg_temp.id('p3'));
reset role;
select pg_temp.como('labc');
set local role authenticated;
select public.decidir_aprovacao_pedido(pg_temp.id('p3'), 'aprovado');
reset role;
select pg_temp.como('fin');
set local role authenticated;
select public.decidir_aprovacao_pedido(pg_temp.id('p3'), 'aprovado', null, '{"fonte_recurso": "ATGC"}');
reset role;
select pg_temp.como('coord');
set local role authenticated;
select public.decidir_aprovacao_pedido(pg_temp.id('p3'), 'devolvido', 'Peça 4 caixas, não 2');
reset role;
select pg_temp.como('solic');
set local role authenticated;
update public.pedidos_internos_itens set quantidade = 4 where pedido_interno_id = pg_temp.id('p3');
select public.enviar_pedido_interno(pg_temp.id('p3'));
reset role;
select pg_temp.conferir((select status = 'aguardando_area' and aprovacao_area_em is null and aprovacao_financeiro_em is null
                                and validacao_valor = 180
                           from public.pedidos_internos where id = pg_temp.id('p3')),
  'com a quantidade mudada, as três aprovações recomeçam pelo laboratório e a foto é refeita');

-- ---- 8. Pedido da ordem antiga não entra nas vezes novas ------------------------------------
do $$
declare
  v_antigo bigint;
begin
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa, area_id, fluxo)
  values ('TS-NO pedido antigo', 'rascunho', 'ts-no-solic@example.invalid', pg_temp.id('projeto'),
          'material_consumo_geral', 'projeto', 'Antigo.', pg_temp.id('area'), 1)
  returning id into v_antigo;
  perform set_config('tno.antigo', v_antigo::text, true);
end $$;
select pg_temp.como('solic');
set local role authenticated;
select pg_temp.exigir_erro(format('select public.enviar_pedido_interno(%s)', pg_temp.id('antigo')),
  '22023', 'ordem antiga');
-- e ninguém muda a ordem de um pedido pela API
select pg_temp.exigir_erro(format('update public.pedidos_internos set fluxo = 2 where id = %s', pg_temp.id('antigo')),
  '42501', 'só mudam pelos botões');
reset role;

select 'nova_ordem_aprovacoes_0188: ok' as resultado;
rollback;
