-- SOMENTE clone sintético local. Exemplo: psql -X -v ON_ERROR_STOP=1
-- -v kontrol_test_local=1 -f supabase/tests/inativacao_insumos_0144.sql
-- Executar como owner da cadeia 0001–0144, nunca no oficial. Não aplica DDL
-- persistente: usuários/fixtures/efeitos e funções temporárias terminam no ROLLBACK.
\if :{?kontrol_test_local}
\else
  \echo '0144: falta acknowledgement explícito de banco descartável local.'
  \quit 3
\endif
\if :kontrol_test_local
\else
  \quit 3
\endif
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';
do $$
begin
  if inet_server_addr() is not null
     and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception '0144: conexão não local; use Unix socket dentro do clone ou loopback.';
  end if;
  if pg_get_functiondef('kontrol_private.exigir_insumo_ativo(bigint)'::regprocedure)
     !~* 'select i\.ativo[^;]*for update;' then
    raise exception '0144: guarda não obtém lock UPDATE inicial; conversão concorrente insegura';
  end if;
end $$;

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0144-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', md5('kontrol-0144-' || p_rotulo)::uuid,
    'email', 'ts-0144-' || p_rotulo || '@example.invalid', 'role', 'authenticated')::text, true);
end $$;

-- DEFAULT / referências sintéticas criadas ANTES da inativação.
do $$
declare
  v_rotulo text;
  v_a bigint;
  v_livre bigint;
  v_codigo bigint;
  v_lote bigint;
  v_ped bigint;
  v_item bigint;
  v_plano bigint;
  v_reserva bigint;
  v_familias text[];
begin
  foreach v_rotulo in array array['admin', 'negado'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0144-' || v_rotulo)::uuid,
      'authenticated', 'authenticated', 'ts-0144-' || v_rotulo || '@example.invalid', now(), now());
    update public.perfis set papel = case when v_rotulo = 'admin' then 'admin' else 'tecnico' end,
      suspenso = false, senha_provisoria = false,
      permissoes = case when v_rotulo = 'negado' then '{"insumos.editar":false,"estoque.movimentar":false}'::jsonb else '{}'::jsonb end
    where id = md5('kontrol-0144-' || v_rotulo)::uuid;
  end loop;
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem,
    fator_conversao, custo_total_embalagem, custo_unitario, ponto_reposicao)
  values ('TS-0144 ativo com história', 'mL', 'mL', 100, 1, 200, 2, 20) returning id into v_a;
  if not (select ativo from public.insumos where id = v_a) then raise exception 'DEFAULT: ativo não true'; end if;
  insert into public.insumos(especificacao) values ('TS-0144 livre') returning id into v_livre;
  insert into public.insumos(especificacao) values ('TS-0144 somente identificador') returning id into v_codigo;
  insert into public.identificadores(codigo, codigo_normalizado, formato, entidade_tipo, entidade_id, origem)
  values
    ('TS-0144-ID-UNICO', 'TS-0144-ID-UNICO', 'codigo_barras', 'insumo', v_codigo, 'fabricante'),
    ('TS-0144-ID-MISTO-1', 'TS-0144-ID-MISTO-1', 'codigo_barras', 'insumo', v_a, 'fabricante'),
    ('TS-0144-ID-MISTO-2', 'TS-0144-ID-MISTO-2', 'codigo_barras', 'insumo', v_a, 'fabricante');
  insert into public.lotes_estoque(insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_a, 'TS-0144-HIST', 5, 5, 'aceito', current_date + 20,
    'EMBALAGEM_FECHADA', 'mL', 100, 'mL', 1) returning id into v_lote;
  insert into public.planejamento(nome) values ('TS-0144 plano') returning id into v_plano;
  perform pg_temp.como('admin');
  perform public.reservar_plano(v_plano, jsonb_build_array(jsonb_build_object('insumo_id', v_a, 'quantidade', 100)));
  select id into strict v_reserva from public.reservas_estoque
    where planejamento_id = v_plano and status = 'reservado';
  insert into public.pedidos_compra(status, solicitante) values ('aprovado', 'ts-0144') returning id into v_ped;
  insert into public.pedidos_compra_itens(pedido_id, insumo_id, quantidade, quantidade_em, conteudo_embalagem, custo_unitario_estimado)
  values(v_ped, v_a, 3, 'embalagem', 100, 200) returning id into v_item;
  perform set_config('t0144.a', v_a::text, true);
  perform set_config('t0144.livre', v_livre::text, true);
  perform set_config('t0144.codigo', v_codigo::text, true);
  perform set_config('t0144.lote', v_lote::text, true);
  perform set_config('t0144.plano', v_plano::text, true);
  perform set_config('t0144.reserva', v_reserva::text, true);
  perform set_config('t0144.ped', v_ped::text, true);
  perform set_config('t0144.item', v_item::text, true);

  -- A lista deve acompanhar TODAS as FKs diretas, incluindo CASCADE/SET NULL.
  select array_agg(distinct c.relname::text order by c.relname::text) into v_familias
  from pg_constraint fk join pg_class c on c.oid = fk.conrelid
  where fk.contype = 'f' and fk.confrelid = 'public.insumos'::regclass;
  if v_familias is distinct from array[
    'estoque_config','estoque_movimentacoes','insumo_analise','inventario_contagens','lotes_estoque',
    'pedidos_compra_item_recebimentos','pedidos_compra_itens','pedidos_internos_item_recebimentos',
    'pedidos_internos_itens','planejamento_lote_conferencias','reservas_estoque']::text[] then
    raise exception 'BLOCKERS: famílias FK divergentes: %', v_familias;
  end if;
end $$;

set local role authenticated;
select pg_temp.como('negado');
-- RLS: usuário autenticado sem insumos.editar não muda estado e não exclui.
do $$
declare
  v_linhas integer;
begin
  update public.insumos set ativo = false where id = current_setting('t0144.a')::bigint;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then raise exception 'RLS: negado alterou estado'; end if;
  delete from public.insumos where id = current_setting('t0144.livre')::bigint;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then raise exception 'RLS: negado excluiu cadastro'; end if;
end $$;

select pg_temp.como('admin');
-- Inativar/reativar PERSISTE no schema; leitura histórica permanece acessível.
do $$
declare
  v_a bigint := current_setting('t0144.a')::bigint;
begin
  update public.insumos set ativo = false where id = v_a;
  if (select ativo from public.insumos where id = v_a) is distinct from false then raise exception 'RLS: inativar não persistiu'; end if;
  if not exists(select 1 from public.v_estoque_saldo where insumo_id = v_a and not ativo)
     or not exists(select 1 from public.lotes_estoque where id = current_setting('t0144.lote')::bigint)
     or not exists(select 1 from public.pedidos_compra_itens where id = current_setting('t0144.item')::bigint) then
    raise exception 'HISTORICO: inativação ocultou/removeu vínculos';
  end if;
  if exists(select 1 from public.v_previsao_suprimentos where insumo_id = v_a)
     or exists(select 1 from public.v_alertas_estoque where insumo_id = v_a) then
    raise exception 'NOVAS_OPERACOES: inativo ainda na reposição/alertas';
  end if;
  update public.insumos set ativo = true where id = v_a;
  if (select ativo from public.insumos where id = v_a) is distinct from true
     or not exists(select 1 from public.v_previsao_suprimentos where insumo_id = v_a) then
    raise exception 'RLS: reativar não restaurou seleção operacional';
  end if;
  update public.insumos set ativo = false where id = v_a;
end $$;

-- NOVAS_OPERACOES: RPC direta não contorna a UI, nem libera reservas antes
-- de falhar. Cada tentativa roda em subtransação e deve retornar 55000.
do $$
declare
  v_a bigint := current_setting('t0144.a')::bigint;
  v_lote bigint := current_setting('t0144.lote')::bigint;
  v_comando text;
  v_operacoes text[];
  v_antes_lotes bigint;
  v_antes_mov bigint;
  v_antes_eventos bigint;
begin
  select count(*) into v_antes_lotes from public.lotes_estoque where insumo_id = v_a;
  select count(*) into v_antes_mov from public.estoque_movimentacoes where insumo_id = v_a;
  select count(*) into v_antes_eventos from public.eventos_status;
  v_operacoes := array[
    format('select public.entrada_inventario(%s,1,gen_random_uuid())', v_a),
    format('select public.registrar_entrada_manual_embalagens(%s,1,gen_random_uuid(),current_date+90,200,''TS-0144-NOVO'',null,''ensaio'')', v_a),
    format('select public.registrar_entrada_por_leitura(%s,1,current_date+90,null,''TS-0144-NOVO'',gen_random_uuid())', v_a),
    format('select public.abrir_embalagem_por_leitura(%s,''TS-0144-NOVO'',gen_random_uuid())', v_a),
    format('select public.abrir_embalagem(%s,1,gen_random_uuid(),''ensaio'')', v_lote),
    format('select public.baixa_manual_lote(%s,1,''ensaio'',gen_random_uuid())', v_lote),
    format('select public.baixa_manual_embalagens(%s,1,5,gen_random_uuid(),''ensaio'')', v_lote),
    format('select public.reservar_plano(%s,''[{"insumo_id":%s,"quantidade":1}]''::jsonb)', current_setting('t0144.plano'), v_a),
    format('select public.criar_pedido_reposicao_estoque(''TS-0144'',''ensaio'',''normal'',current_date,''[{"insumo_id":%s,"quantidade":1}]''::jsonb)', v_a),
    format('select public.criar_pedido_faltas_planejamento(%s,''[{"insumo_id":%s,"quantidade":1}]''::jsonb)', current_setting('t0144.plano'), v_a),
    format('insert into public.pedidos_compra_itens(pedido_id,insumo_id,quantidade) values(%s,%s,1)', current_setting('t0144.ped'), v_a),
    format('insert into public.reservas_estoque(planejamento_id,insumo_id,lote_id,quantidade,status) values(%s,%s,%s,1,''reservado'')', current_setting('t0144.plano'), v_a, v_lote),
    format('insert into public.identificadores(codigo,codigo_normalizado,formato,entidade_tipo,entidade_id,origem) values(''TS-0144-NOVO'',''TS-0144-NOVO'',''codigo_barras'',''insumo'',%s,''fabricante'')', v_a)
  ];
  foreach v_comando in array v_operacoes loop
    begin
      execute v_comando;
      raise exception 'NOVAS_OPERACOES: operação com insumo inativo foi aceita';
    exception when object_not_in_prerequisite_state then
      if sqlerrm not like 'Insumo inativo.%' then raise; end if;
    end;
  end loop;
  if (select status from public.reservas_estoque where id = current_setting('t0144.reserva')::bigint) <> 'reservado'
     or (select quantidade_atual from public.lotes_estoque where id = v_lote) <> 5
     or (select count(*) from public.lotes_estoque where insumo_id = v_a) <> v_antes_lotes
     or (select count(*) from public.estoque_movimentacoes where insumo_id = v_a) <> v_antes_mov
     or (select count(*) from public.eventos_status) <> v_antes_eventos then
    raise exception 'ROLLBACK: operação recusada deixou escrita ou liberou reserva';
  end if;
end $$;

-- RLS também fecha INSERT direto em lotes/movimentos. RPC histórica
-- SECURITY DEFINER continua controlada pelo contrato e é exercitada abaixo.
do $$
begin
  begin
    insert into public.lotes_estoque(insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status)
    values(current_setting('t0144.a')::bigint, 'TS-0144-DIRETO', 1, 1, 'aceito');
    raise exception 'RLS: lote avulso direto contornou ativo';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.estoque_movimentacoes(insumo_id, tipo, quantidade, motivo)
    values(current_setting('t0144.a')::bigint, 'entrada', 1, 'TS-0144-DIRETO');
    raise exception 'RLS: movimento direto contornou ativo';
  exception when insufficient_privilege then null;
  end;
end $$;

-- BLOCKERS: contagem exata e zero IDs protegidos no DETAIL; sem vínculo exclui.
do $$
declare
  v_detail text;
  v_b jsonb;
begin
  -- BLOCKERS_IDENTIFICADOR_UNICO: vínculo sem FK também impede órfão.
  begin
    delete from public.insumos where id = current_setting('t0144.codigo')::bigint;
    raise exception 'BLOCKERS_IDENTIFICADOR_UNICO: insumo com código foi excluído';
  exception when foreign_key_violation then
    get stacked diagnostics v_detail = pg_exception_detail;
    v_b := v_detail::jsonb->'blockers';
    if v_b is distinct from '[{"tipo":"identificadores","rotulo":"Identificadores","contagem":1}]'::jsonb then
      raise exception 'BLOCKERS_IDENTIFICADOR_UNICO: detalhe inexato: %', v_b;
    end if;
  end;
  if not exists(select 1 from public.insumos where id = current_setting('t0144.codigo')::bigint)
     or (select count(*) from public.identificadores where entidade_tipo = 'insumo'
         and entidade_id = current_setting('t0144.codigo')::bigint) <> 1 then
    raise exception 'BLOCKERS_IDENTIFICADOR_UNICO: vínculo perdido';
  end if;
  -- BLOCKERS_IDENTIFICADOR_MISTO: duas etiquetas somam uma família às três FKs.
  begin
    delete from public.insumos where id = current_setting('t0144.a')::bigint;
    raise exception 'BLOCKERS: exclusão destruiu histórico';
  exception when foreign_key_violation then
    get stacked diagnostics v_detail = pg_exception_detail;
    v_b := v_detail::jsonb->'blockers';
    if jsonb_array_length(v_b) <> 4
       or not exists(select 1 from jsonb_array_elements(v_b) b where b->>'tipo' = 'identificadores' and (b->>'contagem')::integer = 2)
       or not exists(select 1 from jsonb_array_elements(v_b) b where b->>'tipo' = 'lotes_estoque' and (b->>'contagem')::integer = 1)
       or not exists(select 1 from jsonb_array_elements(v_b) b where b->>'tipo' = 'pedidos_compra_itens' and (b->>'contagem')::integer = 1)
       or not exists(select 1 from jsonb_array_elements(v_b) b where b->>'tipo' = 'reservas_estoque' and (b->>'contagem')::integer = 1)
       or exists(select 1 from jsonb_array_elements(v_b) b where b ? 'identificador' or b ? 'href') then
      raise exception 'BLOCKERS: contagens/detail incorretos: %', v_b;
    end if;
  end;
  if (select count(*) from public.identificadores where entidade_tipo = 'insumo'
      and entidade_id = current_setting('t0144.a')::bigint) <> 2 then
    raise exception 'BLOCKERS_IDENTIFICADOR_MISTO: códigos não preservados';
  end if;
  delete from public.insumos where id = current_setting('t0144.livre')::bigint;
  if exists(select 1 from public.insumos where id = current_setting('t0144.livre')::bigint) then raise exception 'BLOCKERS: livre não excluído'; end if;
end $$;

-- HISTORICO: update do mesmo ID + recebimento antigo + retry sem duplicação.
do $$
declare
  v_a bigint := current_setting('t0144.a')::bigint;
  v_op uuid := gen_random_uuid();
  v_r jsonb;
begin
  update public.pedidos_compra_itens set observacao = 'TS-0144 histórico mantido'
    where id = current_setting('t0144.item')::bigint;
  v_r := public.registrar_recebimento_por_leitura(v_a, current_setting('t0144.ped')::bigint,
    current_setting('t0144.item')::bigint, 1, current_date+90, null, 'TS-0144-HIST', v_op);
  v_r := public.registrar_recebimento_por_leitura(v_a, current_setting('t0144.ped')::bigint,
    current_setting('t0144.item')::bigint, 1, current_date+90, null, 'TS-0144-HIST', v_op);
  if (v_r->>'repetido')::boolean is distinct from true
     or (select quantidade_recebida from public.pedidos_compra_itens where id = current_setting('t0144.item')::bigint) <> 1
     or (select count(*) from public.pedidos_compra_item_recebimentos where pedido_compra_item_id = current_setting('t0144.item')::bigint) <> 1 then
    raise exception 'HISTORICO: recebimento/retry de pedido antigo bloqueado ou duplicado';
  end if;
end $$;

-- HISTORICO / ROLLBACK: baixa legítima de reserva existente permanece possível
-- com inativo. Reverte-se a prova material e verifica-se estoque/evento juntos.
select set_config('t0144.eventos_pre_baixa', (select count(*)::text from public.eventos_status), true);
savepoint teste_baixa_historica;
do $$
begin
  perform public.dar_baixa_plano(current_setting('t0144.plano')::bigint);
  if (select quantidade_atual from public.lotes_estoque where id = current_setting('t0144.lote')::bigint) <> 4
     or (select quantidade_consumida from public.reservas_estoque where id = current_setting('t0144.reserva')::bigint) <> 1
     or (select ativo from public.insumos where id = current_setting('t0144.a')::bigint) is distinct from false then
    raise exception 'HISTORICO: baixa de reserva antiga não preservou contrato';
  end if;
end $$;
rollback to savepoint teste_baixa_historica;
do $$
begin
  if (select quantidade_atual from public.lotes_estoque where id = current_setting('t0144.lote')::bigint) <> 5
     or (select status from public.reservas_estoque where id = current_setting('t0144.reserva')::bigint) <> 'reservado'
     or (select count(*) from public.eventos_status) <> current_setting('t0144.eventos_pre_baixa')::bigint then
    raise exception 'ROLLBACK: baixa deixou estoque/reserva/evento órfão';
  end if;
end $$;

reset role;
-- AUDITORIA: ator JWT e toggles intactos. As quantidades/FKs históricas não
-- são reescritas pela migration; operações recusadas não criam evento órfão.
do $$
begin
  if (select count(*) from public.auditoria where tabela = 'insumos'
      and registro_id = current_setting('t0144.a')
      and acao = 'update' and valor_anterior->>'ativo' is distinct from valor_novo->>'ativo') <> 3 then
    raise exception 'AUDITORIA: faltam transições ativo/reativado/inativo';
  end if;
  if not exists(select 1 from public.auditoria where tabela = 'insumos'
      and registro_id = current_setting('t0144.a') and acao = 'update'
      and usuario = 'ts-0144-admin@example.invalid') then
    raise exception 'AUDITORIA: ator JWT não preservado';
  end if;
  if has_function_privilege('anon', 'public.registrar_entrada_por_leitura(bigint,integer,date,bigint,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'kontrol_private.exigir_insumo_ativo(bigint)', 'EXECUTE') then
    raise exception 'RLS: guarda privada/RPC aberta indevidamente';
  end if;
end $$;

-- Concorrência real requer DUAS sessões; o teste Node adjacente tem a prova
-- opt-in de UPDATE versus segunda guarda/inativação (inspeção não é execução).
rollback;
