-- SOMENTE clone sintético local. Valida a 0167: consumo mensal sem leitura
-- desfeita, data do movimento em Brasília, leitura de pedidos internos,
-- leituras de código, identificadores e inventário pela caixinha, e auditoria
-- da estimativa manual e dos vínculos de projeto. Termina em ROLLBACK.
\if :{?kontrol_test_local}
\else
  \echo '0167: falta acknowledgement explícito de banco descartável local.'
  \quit 3
\endif
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $$
begin
  if inet_server_addr() is not null
     and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception '0167: conexão não local.';
  end if;
end $$;

-- ---- 1. Consumo mensal desconta a leitura desfeita --------------------------
do $$
declare
  v_mes date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  v_dia date := (v_mes - interval '1 month' + interval '9 days')::date;
  v_a bigint;
  v_lote bigint;
  r record;
begin
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao)
  values ('TS-0167 frasco', 'mL', 'mL', 100, 1) returning id into v_a;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_a, 'TS-0167-L1', 5, 3, 'aceito', current_date + 100, 'EMBALAGEM_FECHADA', 'mL', 100, 'mL', 1)
  returning id into v_lote;
  -- mês passado: duas aberturas por leitura, uma desfeita, e um ajuste comum
  insert into public.estoque_movimentacoes (insumo_id, tipo, quantidade, data, motivo, lote_id) values
    (v_a, 'saida', 1, v_dia, 'abertura de embalagem', v_lote),
    (v_a, 'saida', 1, v_dia, 'abertura de embalagem', v_lote),
    (v_a, 'ajuste', 1, v_dia, 'leitura desfeita: abertura de embalagem', v_lote),
    (v_a, 'ajuste', 2, v_dia, 'inventário', v_lote);
  select * into r from kontrol_private.consumo_mensal_calculo(array[v_a]);
  if r.meses -> 0 ->> 'mes' <> to_char(v_mes - interval '1 month', 'YYYY-MM')
     or (r.meses -> 0 ->> 'saidas')::numeric <> 1 then
    raise exception '0167: leitura desfeita deveria descontar a saída (meses %)', r.meses;
  end if;
  if r.ajustes <> 1 then
    raise exception '0167: a devolução da leitura não é ajuste de inventário (ajustes %)', r.ajustes;
  end if;

  -- mês só com devolução (desfeita na virada do mês): nunca negativo
  insert into public.estoque_movimentacoes (insumo_id, tipo, quantidade, data, motivo, lote_id)
  values (v_a, 'ajuste', 1, (v_mes - interval '2 months' + interval '3 days')::date,
          'leitura desfeita: abertura de embalagem', v_lote);
  select * into r from kontrol_private.consumo_mensal_calculo(array[v_a]);
  if exists (select 1 from jsonb_array_elements(r.meses) m where (m ->> 'saidas')::numeric < 0) then
    raise exception '0167: consumo de um mês ficou negativo (meses %)', r.meses;
  end if;
end $$;

-- ---- 2. Data do movimento em Brasília ------------------------------------------
do $$
declare
  v_id bigint;
begin
  insert into public.estoque_movimentacoes (insumo_id, tipo, quantidade, motivo)
  values ((select id from public.insumos where especificacao = 'TS-0167 frasco'), 'ajuste', 1, 'TS-0167 data')
  returning id into v_id;
  if (select data from public.estoque_movimentacoes where id = v_id)
     <> (now() at time zone 'America/Sao_Paulo')::date then
    raise exception '0167: data do movimento deveria ser a de Brasília';
  end if;
end $$;

-- ---- 3. Leitura pela caixinha ---------------------------------------------------
do $$
declare
  v_r text;
begin
  foreach v_r in array array['lab', 'cadastro', 'cego'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0167-' || v_r)::uuid, 'authenticated',
            'authenticated', 'ts-0167-' || v_r || '@example.invalid', now(), now());
  end loop;
  update public.perfis set papel = 'laboratorio', suspenso = false, permissoes = '{}'::jsonb
   where id = md5('kontrol-0167-lab')::uuid;
  update public.perfis set papel = 'cadastro', suspenso = false, permissoes = '{}'::jsonb
   where id = md5('kontrol-0167-cadastro')::uuid;
  -- Cadastro sem nenhuma caixinha de leitura do estoque ou dos cadastros
  update public.perfis set papel = 'cadastro', suspenso = false,
    permissoes = '{"estoque.ver": false, "cadastros.ver": false, "insumos.ver": false}'::jsonb
   where id = md5('kontrol-0167-cego')::uuid;

  insert into public.pedidos_internos (titulo, status, solicitante)
  values ('TS-0167 pedido', 'rascunho', 'ts-0167-lab@example.invalid');
  insert into public.inventario_ciclos (nome) values ('TS-0167 campanha');
  insert into public.scan_eventos (codigo, acao, resultado) values ('TS0167-BUSCA', 'buscar', 'nao_encontrado');
  insert into public.identificadores (codigo, codigo_normalizado, formato, entidade_tipo, entidade_id, origem)
  values ('TS0167CODIGO', 'TS0167CODIGO', 'codigo_barras', 'insumo',
          (select id from public.insumos where especificacao = 'TS-0167 frasco'), 'fabricante');
end $$;

create function pg_temp.como(p_nome text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', md5('kontrol-0167-' || p_nome)::uuid::text, true),
         set_config('request.jwt.claims', json_build_object('sub', md5('kontrol-0167-' || p_nome)::uuid,
           'role', 'authenticated')::text, true);
$$;
create function pg_temp.vistos() returns jsonb language sql as $$
  select jsonb_build_object(
    'pedido', (select count(*) from public.pedidos_internos where titulo = 'TS-0167 pedido'),
    'inventario', (select count(*) from public.inventario_ciclos where nome = 'TS-0167 campanha'),
    'leitura', (select count(*) from public.scan_eventos where codigo = 'TS0167-BUSCA'),
    'codigo', (select count(*) from public.identificadores where codigo = 'TS0167CODIGO'));
$$;
grant execute on function pg_temp.como(text), pg_temp.vistos() to authenticated;

set local role authenticated;

select pg_temp.como('lab');
do $$ begin
  if pg_temp.vistos() <> '{"pedido": 1, "inventario": 1, "leitura": 1, "codigo": 1}'::jsonb then
    raise exception '0167: Laboratório deixou de ler algo: %', pg_temp.vistos();
  end if;
end $$;

select pg_temp.como('cadastro');
do $$ begin
  if pg_temp.vistos() <> '{"pedido": 0, "inventario": 1, "leitura": 1, "codigo": 1}'::jsonb then
    raise exception '0167: Cadastro deveria ler estoque e códigos, mas não pedidos internos: %', pg_temp.vistos();
  end if;
end $$;

select pg_temp.como('cego');
do $$ begin
  if pg_temp.vistos() <> '{"pedido": 0, "inventario": 0, "leitura": 0, "codigo": 0}'::jsonb then
    raise exception '0167: sem caixinha nenhuma ainda lê: %', pg_temp.vistos();
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

-- nenhuma leitura aberta sobrou nas tabelas da 0167
do $$ begin
  if exists (select 1 from pg_policies
              where schemaname = 'public' and cmd = 'SELECT' and permissive = 'PERMISSIVE' and qual = 'true'
                and tablename in ('pedidos_internos', 'pedidos_internos_itens', 'pedidos_internos_aprovacoes',
                                  'pedidos_internos_anexos', 'pedidos_internos_comunicacoes',
                                  'pedidos_internos_item_recebimentos', 'scan_eventos', 'inventario_ciclos',
                                  'inventario_contagens', 'identificadores')) then
    raise exception '0167: sobrou leitura aberta';
  end if;
end $$;

-- ---- 4. Auditoria ----------------------------------------------------------------
do $$
declare
  v_a bigint := (select id from public.insumos where especificacao = 'TS-0167 frasco');
  v_p bigint;
  v_u uuid := md5('kontrol-0167-lab')::uuid;
begin
  insert into kontrol_private.consumo_manual_insumos(insumo_id, revisao, operacao_id, quantidade_embalagens_mes,
    conteudo_embalagem, unidade_conteudo, fonte, motivo, data_referencia, ator_id)
  values (v_a, 1, gen_random_uuid(), 3, 100, 'mL', 'TS-0167', 'teste', current_date, v_u);
  delete from kontrol_private.consumo_manual_insumos where insumo_id = v_a;
  if (select count(*) from public.auditoria where tabela = 'consumo_manual_insumos'
        and registro_id = v_a::text and acao in ('insert', 'delete')) <> 2 then
    raise exception '0167: estimativa manual deveria entrar na auditoria';
  end if;

  -- vínculo criado e depois apagado em cascata entram na trilha
  insert into public.projetos (nome) values ('TS-0167 projeto') returning id into v_p;
  insert into kontrol_private.projetos_vinculos (projeto_id, usuario_id) values (v_p, v_u);
  if not exists (select 1 from public.auditoria where tabela = 'projetos_vinculos'
                  and registro_id = v_p::text || ':' || v_u::text and acao = 'insert') then
    raise exception '0167: vínculo criado deveria entrar na auditoria';
  end if;
  delete from public.projetos where id = v_p;
  if not exists (select 1 from public.auditoria where tabela = 'projetos_vinculos'
                  and registro_id = v_p::text || ':' || v_u::text and acao = 'delete') then
    raise exception '0167: vínculo apagado em cascata deveria entrar na auditoria';
  end if;
end $$;

rollback;
