-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0136 (decisoes do dono de 28/09): D2 autoaprovacao so do coordenador
-- do projeto; D3 coordenador como usuario e aviso de validacao para ele; D5
-- coordenador bloqueia/descarta; D7 fechamento de campanha e segunda aprovacao.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0136-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0136-' || p_rotulo)::uuid,
                      'email', 'ts-0136-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-0136-' || p_rotulo)::uuid
$$;

do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_insumo bigint;
  v_lote bigint;
  v_ciclo bigint;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'projetos' and column_name = 'coordenador_id') then
    raise exception '0136: projetos.coordenador_id ausente';
  end if;

  -- pedinte: cria e também tem permissão de aprovar (o caso da autoaprovação);
  -- coord: coordenador do projeto; outro: aprovador qualquer; chefe: admin.
  foreach v_rotulo in array array['pedinte', 'coord', 'outro', 'chefe'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-0136-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set papel = case v_rotulo when 'chefe' then 'admin' when 'pedinte' then 'tecnico' else 'coordenador' end,
           suspenso = false, senha_provisoria = false,
           permissoes = '{"pedido.criar": true, "pedido.aprovar": true, "compras.aprovar": true, "estoque.lote.gerir": true}'::jsonb
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-0136 projeto', pg_temp.uid('coord')) returning id into v_projeto;
  perform set_config('t0136.projeto', v_projeto::text, true);

  -- inventário: lote de 10 un a R$ 100 (ajuste de 10 un = R$ 1.000, acima do limite de R$ 500)
  insert into public.insumos (especificacao, unidade, custo_unitario) values ('TS-0136 reagente', 'un', 100) returning id into v_insumo;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, custo_unitario)
  values (v_insumo, 'TS-0136-L1', 20, 20, 'aceito', 100) returning id into v_lote;
  insert into public.inventario_ciclos (nome) values ('TS-0136 campanha') returning id into v_ciclo;
  perform set_config('t0136.lote', v_lote::text, true);
  perform set_config('t0136.ciclo', v_ciclo::text, true);

  -- D5
  if not coalesce((select (permissoes ->> 'estoque.descartar_bloquear')::boolean
                     from public.permissoes_categorias where papel = 'coordenador'), false) then
    raise exception '0136: coordenador sem "Bloquear e descartar lotes"';
  end if;

  -- D7: limite cadastrado
  if (select valor from public.parametros where chave = 'limite_ajuste_inventario_valor') is null then
    raise exception '0136: parâmetro limite_ajuste_inventario_valor ausente';
  end if;
  update public.parametros set valor = 500 where chave = 'limite_ajuste_inventario_valor';
end $$;

-- ---- D2 e D3: pedido interno ---------------------------------------------------
create function pg_temp.pedido_em_validacao(p_solicitante text) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  perform set_config('app.pedido_interno_transicao', 'permitida', true);
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id)
  values ('TS-0136 pedido de ' || p_solicitante, 'rascunho',
          'ts-0136-' || p_solicitante || '@example.invalid', current_setting('t0136.projeto')::bigint)
  returning id into v_id;
  update public.pedidos_internos set status = 'em_validacao' where id = v_id;
  return v_id;
end $$;

do $$
declare
  v_pedido bigint := pg_temp.pedido_em_validacao('pedinte');
begin
  -- D3: aviso de validação foi para o coordenador do projeto, não para a permissão
  if not exists (
    select 1 from public.notificacoes
     where entidade_tipo = 'pedido_interno' and entidade_id = v_pedido
       and usuario_destino = pg_temp.uid('coord') and permissao_destino is null) then
    raise exception '0136: aviso de validação não foi para o coordenador do projeto';
  end if;
  perform set_config('t0136.pedido_pedinte', v_pedido::text, true);
  perform set_config('t0136.pedido_coord', pg_temp.pedido_em_validacao('coord')::text, true);
end $$;

set local role authenticated;

-- quem pediu não valida o próprio pedido
select pg_temp.como('pedinte');
do $$
begin
  perform public.transicionar_pedido_interno(current_setting('t0136.pedido_pedinte')::bigint, 'validado', 'Validação', 'aprovado', null);
  raise exception '0136: o solicitante validou o próprio pedido';
exception when insufficient_privilege then
  if sqlerrm not like '%próprio pedido%' then raise; end if;
end $$;

-- outra pessoa valida
select pg_temp.como('outro');
select public.transicionar_pedido_interno(current_setting('t0136.pedido_pedinte')::bigint, 'validado', 'Validação', 'aprovado', null);

-- o coordenador do projeto valida o próprio pedido
select pg_temp.como('coord');
select public.transicionar_pedido_interno(current_setting('t0136.pedido_coord')::bigint, 'validado', 'Validação', 'aprovado', null);

-- ---- D2: compra ----------------------------------------------------------------
reset role;
do $$
declare v_compra bigint;
begin
  insert into public.pedidos_compra (status, solicitante, projeto_id)
  values ('solicitado', 'ts-0136-pedinte@example.invalid', current_setting('t0136.projeto')::bigint)
  returning id into v_compra;
  perform set_config('t0136.compra', v_compra::text, true);
  insert into public.pedidos_compra (status, solicitante)
  values ('solicitado', 'ts-0136-chefe@example.invalid')
  returning id into v_compra;
  perform set_config('t0136.compra_chefe', v_compra::text, true);
end $$;
set local role authenticated;

select pg_temp.como('pedinte');
do $$
begin
  perform public.transicionar_pedido_compra(current_setting('t0136.compra')::bigint, 'aprovado', null, null);
  raise exception '0136: o solicitante aprovou a própria compra';
exception when insufficient_privilege then
  if sqlerrm not like '%própria%' and sqlerrm not like '%aprová-la%' then raise; end if;
end $$;

select pg_temp.como('coord');
select public.transicionar_pedido_compra(current_setting('t0136.compra')::bigint, 'aprovado', null, null);

-- administrador fica isento
select pg_temp.como('chefe');
select public.transicionar_pedido_compra(current_setting('t0136.compra_chefe')::bigint, 'aprovado', null, null);

-- ---- D7: inventário ------------------------------------------------------------
select pg_temp.como('pedinte');
do $$
declare
  v_grande bigint;
  v_pequena bigint;
begin
  insert into public.inventario_contagens (ciclo_id, lote_id, quantidade_sistema, quantidade_contada, divergencia, justificativa, contado_por)
  values (current_setting('t0136.ciclo')::bigint, current_setting('t0136.lote')::bigint, 20, 10, -10, 'Quebra no transporte',
          'ts-0136-pedinte@example.invalid')
  returning id into v_grande;
  perform set_config('t0136.contagem_grande', v_grande::text, true);

  -- R$ 1.000 > R$ 500: quem contou não aplica
  begin
    perform public.aplicar_ajuste_inventario_contagem(v_grande);
    raise exception '0136: quem contou aplicou ajuste acima do limite';
  exception when insufficient_privilege then
    if sqlerrm not like '%segunda aprovação%' then raise; end if;
  end;

  -- campanha com diferença pendente não fecha
  begin
    perform public.fechar_ciclo_inventario(current_setting('t0136.ciclo')::bigint);
    raise exception '0136: fechou campanha com diferença sem ajuste';
  exception when invalid_parameter_value then
    if sqlerrm not like '%sem ajuste aplicado%' then raise; end if;
  end;
end $$;

select pg_temp.como('outro');
select public.aplicar_ajuste_inventario_contagem(current_setting('t0136.contagem_grande')::bigint);

select pg_temp.como('pedinte');
do $$
declare
  v_pequena bigint;
  v_r jsonb;
begin
  -- R$ 100 < R$ 500: quem contou pode aplicar
  insert into public.inventario_contagens (ciclo_id, lote_id, quantidade_sistema, quantidade_contada, divergencia, justificativa, contado_por)
  values (current_setting('t0136.ciclo')::bigint, current_setting('t0136.lote')::bigint, 10, 9, -1, 'Frasco vencido',
          'ts-0136-pedinte@example.invalid')
  returning id into v_pequena;
  v_r := public.aplicar_ajuste_inventario_contagem(v_pequena);
  if coalesce((v_r ->> 'segunda_aprovacao')::boolean, true) then
    raise exception '0136: ajuste pequeno marcado como segunda aprovação (%)', v_r;
  end if;

  v_r := public.fechar_ciclo_inventario(current_setting('t0136.ciclo')::bigint);
  if (v_r ->> 'ajustes')::int <> 2 then
    raise exception '0136: fechamento deveria contar 2 ajustes (%)', v_r;
  end if;

  -- campanha fechada não recebe contagem nova
  begin
    insert into public.inventario_contagens (ciclo_id, lote_id, quantidade_sistema, quantidade_contada, divergencia, contado_por)
    values (current_setting('t0136.ciclo')::bigint, current_setting('t0136.lote')::bigint, 9, 9, 0, 'x');
    raise exception '0136: campanha fechada aceitou contagem';
  exception when invalid_parameter_value then
    if sqlerrm not like '%não está aberta%' then raise; end if;
  end;
end $$;

reset role;
do $$
begin
  if not exists (select 1 from public.inventario_contagens
                  where id = current_setting('t0136.contagem_grande')::bigint
                    and segunda_aprovacao and valor_ajuste = 1000
                    and ajustado_por = 'ts-0136-outro@example.invalid') then
    raise exception '0136: ajuste grande sem registro da segunda aprovação';
  end if;
  if (select status from public.inventario_ciclos where id = current_setting('t0136.ciclo')::bigint) <> 'fechado' then
    raise exception '0136: campanha não ficou fechada';
  end if;
end $$;

rollback;
