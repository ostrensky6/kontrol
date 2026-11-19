-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Item novo do pedido: algo que o laboratório nunca comprou (pergunta do
-- Giorgi, trazida pela Rafaela em 19/11/2026; decisão de Antonio no mesmo dia:
-- quem pede só descreve, e quem conduz a compra cadastra o insumo pelo pedido).
-- Confere, pelas mesmas funções e tabelas que o app usa:
--   * quem pede (Laboratório) escreve o item à mão, sem insumo, e envia;
--   * o pedido é aprovado com o item novo, mas a formalização é recusada;
--   * sem "Editar insumos" o cadastro do insumo é recusado (a etapa em que o
--     item ainda muda é conferida pelo app, não pelo banco);
--   * a gestora cadastra o insumo sem lote (zero embalagens) e liga o item: o
--     item passa a contar em embalagens do insumo, e a formalização passa;
--   * o insumo recém-cadastrado não ganha lote nem saldo.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- a trava do ciclo seguinte depende do dia de hoje e não é o assunto deste teste
create or replace function kontrol_private.hoje_brasilia() returns date
  language sql stable set search_path = '' as $$ select date '2999-12-01' $$;

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-in-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-in-' || p_rotulo)::uuid,
                      'email', 'ts-in-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-in-' || p_rotulo)::uuid
$$;

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'item_novo_do_pedido: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception 'item_novo_do_pedido: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

create function pg_temp.id(p_chave text) returns bigint language sql as $$
  select current_setting('tin.' || p_chave)::bigint
$$;

create function pg_temp.etapa(p_pedido bigint, p_para text, p_decisao text default 'registrado')
returns void language plpgsql as $$
begin
  perform public.registrar_etapa_pedido_interno(p_pedido, p_para, p_para, p_decisao, null, '{}'::jsonb);
end $$;

-- ---- pessoas e projeto -----------------------------------------------------------------------
do $$
declare
  v_rotulo text;
  v_projeto bigint;
begin
  -- lab: Laboratório, quem pede; gestora: Gestor, coordena o projeto e conduz a
  -- compra; adm: função Administrativo (aprova pedidos, não edita insumos)
  foreach v_rotulo in array array['lab', 'gestora', 'adm'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-in-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-IN ' || v_rotulo,
           papel = case v_rotulo when 'lab' then 'laboratorio' when 'adm' then 'administrativo' else 'gestor' end,
           suspenso = false, senha_provisoria = false, permissoes = '{}'::jsonb
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-IN projeto de teste', pg_temp.uid('gestora'))
  returning id into v_projeto;
  if to_regclass('kontrol_private.projetos_vinculos') is not null then
    execute 'insert into kontrol_private.projetos_vinculos (projeto_id, usuario_id) values ($1, $2), ($1, $3) on conflict do nothing'
      using v_projeto, pg_temp.uid('gestora'), pg_temp.uid('lab');
  end if;
  perform set_config('tin.projeto', v_projeto::text, true);
end $$;

-- ---- 1. Quem pede escreve o item à mão e envia -----------------------------------------------
select pg_temp.como('lab');
set local role authenticated;
do $$
declare
  v_pedido bigint;
  v_item bigint;
begin
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa)
  values ('TS-IN item nunca comprado', 'rascunho', 'ts-in-lab@example.invalid', pg_temp.id('projeto'),
          'material_consumo_geral', 'projeto', 'Teste do item novo.')
  returning id into v_pedido;
  -- sem insumo: o "Novo pedido" grava só a descrição
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade, volume, orcamento_previo)
  values (v_pedido, 'material', 'TS-IN tampão nunca comprado', 2, 'frasco', '500 mL', 180)
  returning id into v_item;
  perform set_config('tin.pedido', v_pedido::text, true);
  perform set_config('tin.item', v_item::text, true);
end $$;
select pg_temp.etapa(pg_temp.id('pedido'), 'em_validacao');
reset role;

-- ---- 2. O pedido é aprovado com o item novo; a formalização espera o cadastro ----------------
select pg_temp.como('gestora');
set local role authenticated;
select pg_temp.etapa(pg_temp.id('pedido'), 'validado', 'aprovado');
select pg_temp.exigir_erro(
  format('select public.formalizar_pedido_interno(%s)', pg_temp.id('pedido')), '22023', 'Vincule cada material ou equipamento a um insumo');
reset role;

-- ---- 3. Criar insumo pede "Editar insumos" ---------------------------------------------------
-- função Administrativo aprova pedidos, mas não tem "Editar insumos": o cadastro é recusado
select pg_temp.como('adm');
set local role authenticated;
select pg_temp.exigir_erro(
  $q$select public.criar_insumo_com_quantidade('{"especificacao": "TS-IN tampão nunca comprado", "unidade": "mL", "quantidade_embalagem": 500, "custo_total_embalagem": 180, "fator_conversao": 1}'::jsonb, 0, gen_random_uuid())$q$,
  '42501', 'Sem permissão para cadastrar insumos');
reset role;

-- ---- 4. A gestora cadastra o insumo e liga o item --------------------------------------------
select pg_temp.como('gestora');
set local role authenticated;
do $$
declare
  v_resultado jsonb;
  v_insumo bigint;
  v_linhas integer;
begin
  v_resultado := public.criar_insumo_com_quantidade(
    '{"especificacao": "TS-IN tampão nunca comprado", "fabricante": "TS-IN marca", "codigo_fabricante": null, "unidade": "mL", "quantidade_embalagem": 500, "custo_total_embalagem": 180, "fator_conversao": 1}'::jsonb,
    0, gen_random_uuid());
  v_insumo := (v_resultado->>'insumo_id')::bigint;
  if v_insumo is null or v_resultado->>'lote_id' is not null then
    raise exception 'item_novo_do_pedido: o cadastro deveria criar o insumo sem lote: %', v_resultado;
  end if;
  perform set_config('tin.insumo', v_insumo::text, true);

  -- o mesmo UPDATE do app: só liga se o item ainda estiver sem insumo
  update public.pedidos_internos_itens set insumo_id = v_insumo
   where id = pg_temp.id('item') and pedido_interno_id = pg_temp.id('pedido') and insumo_id is null;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'item_novo_do_pedido: a gestora deveria ligar o item ao insumo (linhas: %)', v_linhas;
  end if;
end $$;
reset role;

do $$
declare
  v_item public.pedidos_internos_itens%rowtype;
  v_insumo public.insumos%rowtype;
begin
  select * into v_item from public.pedidos_internos_itens where id = pg_temp.id('item');
  select * into v_insumo from public.insumos where id = pg_temp.id('insumo');
  -- o item passa a contar em embalagens do insumo (2 frascos de 500 mL)
  if v_item.quantidade_em is distinct from 'embalagem' or v_item.conteudo_embalagem is distinct from 500 or v_item.quantidade <> 2 then
    raise exception 'item_novo_do_pedido: o item deveria contar 2 embalagens de 500: % de % (%)',
      v_item.quantidade, v_item.conteudo_embalagem, v_item.quantidade_em;
  end if;
  if not v_insumo.ativo or v_insumo.custo_unitario is distinct from 0.36 or v_insumo.categoria_compra is distinct from 'operacional' then
    raise exception 'item_novo_do_pedido: insumo cadastrado com dados inesperados: ativo %, custo un. %, categoria %',
      v_insumo.ativo, v_insumo.custo_unitario, v_insumo.categoria_compra;
  end if;
  -- nunca recebido: sem lote e sem saldo
  if exists (select 1 from public.lotes_estoque where insumo_id = v_insumo.id) then
    raise exception 'item_novo_do_pedido: o cadastro pelo pedido não deveria criar lote';
  end if;
  if (select disponivel from public.v_estoque_saldo where insumo_id = v_insumo.id) <> 0 then
    raise exception 'item_novo_do_pedido: insumo recém-cadastrado deveria ter saldo zero';
  end if;
end $$;

-- ---- 5. Com o item ligado, a formalização passa e a compra leva o insumo ---------------------
select pg_temp.como('gestora');
set local role authenticated;
select public.formalizar_pedido_interno(pg_temp.id('pedido'));
reset role;

do $$
declare
  v_compra bigint;
begin
  select pedido_compra_id into v_compra from public.pedidos_internos where id = pg_temp.id('pedido');
  if v_compra is null then
    raise exception 'item_novo_do_pedido: a formalização deveria criar a compra';
  end if;
  if not exists (
    select 1 from public.pedidos_compra_itens
     where pedido_id = v_compra and insumo_id = pg_temp.id('insumo')
       and quantidade = 2 and quantidade_em = 'embalagem' and conteudo_embalagem = 500
  ) then
    raise exception 'item_novo_do_pedido: a compra deveria levar 2 embalagens de 500 do insumo novo';
  end if;
end $$;

rollback;
