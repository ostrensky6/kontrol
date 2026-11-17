-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0182 (auditoria de 16/11/2026, item 10, proposta 2):
--   * fechar o pedido com o fornecedor marca a compra ligada como enviada, com
--     o evento na linha do tempo, sem exigir "Aprovar compras" de quem fecha;
--   * previsão de entrega: prazo do orçamento escolhido; sem ele, o maior prazo
--     entre os itens; sem ele, o prazo do fornecedor da compra; sem prazo
--     nenhum, a previsão fica como estava;
--   * encaminhar à instituição não envia a compra (o botão continua valendo);
--   * compra de dois pedidos só segue quando os dois foram fechados;
--   * compra já enviada não é tocada; o status da compra continua travado.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0182-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0182-' || p_rotulo)::uuid,
                      'email', 'ts-0182-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-0182-' || p_rotulo)::uuid
$$;

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception '0182: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception '0182: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

-- Pedido em aprovação final com a compra solicitada ligada e um item por insumo.
-- Guarda os ids em t0182.pedido_<rotulo> e t0182.compra_<rotulo>.
create function pg_temp.cenario(p_rotulo text, p_fornecedor bigint, p_prevista date, variadic p_insumos bigint[])
returns void language plpgsql as $$
declare
  v_pedido bigint;
  v_compra bigint;
  v_insumo bigint;
  v_item bigint;
begin
  insert into public.pedidos_compra (status, solicitante, projeto_id, fornecedor_id, data_prevista_entrega)
  values ('solicitado', 'ts-0182-pedinte@example.invalid', current_setting('t0182.projeto')::bigint, p_fornecedor, p_prevista)
  returning id into v_compra;
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa, urgencia)
  values ('TS-0182 ' || p_rotulo, 'aguardando_aprovacao_final', 'ts-0182-pedinte@example.invalid',
          current_setting('t0182.projeto')::bigint, 'material_consumo_geral', 'projeto', 'teste', 'normal')
  returning id into v_pedido;
  update public.pedidos_internos set pedido_compra_id = v_compra where id = v_pedido;
  foreach v_insumo in array p_insumos loop
    insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade, insumo_id)
    values (v_pedido, 'material', 'TS-0182 item', 1, 'un', v_insumo)
    returning id into v_item;
    insert into public.pedidos_compra_itens (pedido_id, insumo_id, quantidade, pedido_interno_item_id)
    values (v_compra, v_insumo, 1, v_item);
  end loop;
  perform set_config('t0182.pedido_' || p_rotulo, v_pedido::text, true);
  perform set_config('t0182.compra_' || p_rotulo, v_compra::text, true);
end $$;

create function pg_temp.pedido(p_rotulo text) returns bigint language sql as $$
  select current_setting('t0182.pedido_' || p_rotulo)::bigint
$$;
create function pg_temp.compra(p_rotulo text) returns bigint language sql as $$
  select current_setting('t0182.compra_' || p_rotulo)::bigint
$$;

-- os botões do pedido, na ordem: aprovação final e depois o destino da compra
create function pg_temp.aprovar_final(p_rotulo text) returns void language plpgsql as $$
begin
  perform public.transicionar_pedido_interno(pg_temp.pedido(p_rotulo), 'aprovado_para_compra', 'Aprovação final', 'aprovado', null);
end $$;
create function pg_temp.fechar(p_rotulo text) returns void language plpgsql as $$
begin
  perform public.transicionar_pedido_interno(pg_temp.pedido(p_rotulo), 'compra_fechada', 'Compra', 'registrado', null);
end $$;

-- ---- a função e o gatilho existem e não ficam expostos ----------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgname = 'pedidos_internos_enviar_compra_ligada'
                    and tgrelid = 'public.pedidos_internos'::regclass and not tgisinternal) then
    raise exception '0182: gatilho de envio da compra não foi criado';
  end if;
  if has_function_privilege('authenticated', 'kontrol_private.enviar_compra_ligada()', 'execute')
     or has_function_privilege('anon', 'kontrol_private.enviar_compra_ligada()', 'execute') then
    raise exception '0182: a função do gatilho não pode ser chamada por quem usa o app';
  end if;
  -- o gatilho da 0170 continua no lugar
  if not exists (select 1 from pg_trigger
                  where tgname = 'pedidos_internos_aprovar_compra_ligada'
                    and tgrelid = 'public.pedidos_internos'::regclass and not tgisinternal) then
    raise exception '0182: o gatilho da 0170 sumiu';
  end if;
end $$;

-- ---- dados do cenário -----------------------------------------------------------------------
do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_f20 bigint;
  v_f7 bigint;
  v_fsem bigint;
  v_i12 bigint;
  v_i20 bigint;
  v_isem bigint;
  v_segundo bigint;
  v_item bigint;
begin
  foreach v_rotulo in array array['pedinte', 'coord', 'compras'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-0182-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-0182 ' || v_rotulo,
           papel = case v_rotulo when 'coord' then 'coordenador' else 'laboratorio' end,
           suspenso = false, senha_provisoria = false,
           permissoes = case v_rotulo
             -- quem fecha o pedido não tem "Aprovar compras": o gatilho não depende dela
             when 'coord' then '{"pedido.criar": true, "pedido.aprovar": true, "compras.aprovar": false}'::jsonb
             when 'compras' then '{"compras.ver": true, "compras.aprovar": true}'::jsonb
             else '{"pedido.criar": true, "pedido.aprovar": false, "compras.aprovar": false}'::jsonb end
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-0182 projeto', pg_temp.uid('coord')) returning id into v_projeto;
  if to_regclass('kontrol_private.projetos_vinculos') is not null then
    execute 'insert into kontrol_private.projetos_vinculos (projeto_id, usuario_id) values ($1, $2) on conflict do nothing'
      using v_projeto, pg_temp.uid('coord');
  end if;
  perform set_config('t0182.projeto', v_projeto::text, true);

  insert into public.fornecedores (nome, prazo_medio_dias) values ('TS-0182 fornecedor 20 dias', 20) returning id into v_f20;
  insert into public.fornecedores (nome, prazo_medio_dias) values ('TS-0182 fornecedor 7 dias', 7) returning id into v_f7;
  insert into public.fornecedores (nome) values ('TS-0182 fornecedor sem prazo') returning id into v_fsem;

  -- prazo do próprio insumo; prazo só no fornecedor do insumo; sem prazo nenhum
  insert into public.insumos (especificacao, unidade, fator_conversao, custo_unitario, lead_time_dias, fornecedor_id)
  values ('TS-0182 insumo 12 dias', 'un', 1, 0, 12, v_f20) returning id into v_i12;
  insert into public.insumos (especificacao, unidade, fator_conversao, custo_unitario, fornecedor_id)
  values ('TS-0182 insumo do fornecedor de 20 dias', 'un', 1, 0, v_f20) returning id into v_i20;
  insert into public.insumos (especificacao, unidade, fator_conversao, custo_unitario)
  values ('TS-0182 insumo sem prazo', 'un', 1, 0) returning id into v_isem;

  -- itens: 12 dias e 20 dias, vale o maior, mesmo com o fornecedor da compra dizendo 7
  perform pg_temp.cenario('itens', v_f7, null, v_i12, v_i20);
  -- orcamento: o prazo combinado (5 dias) vale antes do prazo do cadastro (12)
  perform pg_temp.cenario('orcamento', v_f20, null, v_i12);
  insert into public.pedidos_internos_cotacoes (pedido_interno_id, fornecedor_id, fornecedor_nome, valor_total, prazo_entrega_dias, escolhida)
  values (pg_temp.pedido('orcamento'), v_f20, 'TS-0182 fornecedor 20 dias', 100, 5, true);
  -- cabecalho: item sem prazo, vale o fornecedor da compra (7); o orçamento escolhido não informou prazo
  perform pg_temp.cenario('cabecalho', v_f7, null, v_isem);
  insert into public.pedidos_internos_cotacoes (pedido_interno_id, fornecedor_id, fornecedor_nome, valor_total, prazo_entrega_dias, escolhida)
  values (pg_temp.pedido('cabecalho'), v_f7, 'TS-0182 fornecedor 7 dias', 100, 0, true);
  -- semprazo: nenhum prazo em lugar nenhum, a previsão que já existia continua
  perform pg_temp.cenario('semprazo', v_fsem, date '2027-01-15', v_isem);
  -- vazio: nenhum prazo e nenhuma previsão
  perform pg_temp.cenario('vazio', null, null, v_isem);
  -- instituicao: encaminhar à instituição não envia a compra
  perform pg_temp.cenario('instituicao', v_f7, null, v_i12);
  -- jaenviada: a compra foi marcada como enviada pelo botão antes de fechar o pedido
  perform pg_temp.cenario('jaenviada', v_f7, null, v_i12);

  -- dois: a mesma compra atende dois pedidos (o segundo ligado só pelo item)
  perform pg_temp.cenario('dois', v_f7, null, v_i12);
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa, urgencia)
  values ('TS-0182 dois (segundo pedido)', 'aguardando_aprovacao_final', 'ts-0182-pedinte@example.invalid',
          v_projeto, 'material_consumo_geral', 'projeto', 'teste', 'normal')
  returning id into v_segundo;
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade, insumo_id)
  values (v_segundo, 'material', 'TS-0182 item', 1, 'un', v_i12)
  returning id into v_item;
  insert into public.pedidos_compra_itens (pedido_id, insumo_id, quantidade, pedido_interno_item_id)
  values (pg_temp.compra('dois'), v_i12, 1, v_item);
  perform set_config('t0182.pedido_dois_b', v_segundo::text, true);
end $$;

set local role authenticated;
select pg_temp.como('coord');

-- ---- a aprovação final continua aprovando a compra (0170), sem previsão -----------------
select pg_temp.aprovar_final(r) from unnest(array['itens', 'orcamento', 'cabecalho', 'semprazo', 'vazio', 'instituicao', 'jaenviada', 'dois']) as r;

do $$
begin
  if (select status from public.pedidos_compra where id = pg_temp.compra('itens')) <> 'aprovado' then
    raise exception '0182: a compra deveria estar aprovada junto com o pedido (0170)';
  end if;
  -- a compra de dois pedidos espera o segundo
  if (select status from public.pedidos_compra where id = pg_temp.compra('dois')) <> 'solicitado' then
    raise exception '0182: a compra de dois pedidos não deveria ser aprovada só com o primeiro';
  end if;
end $$;
select public.transicionar_pedido_interno(pg_temp.pedido('dois_b'), 'aprovado_para_compra', 'Aprovação final', 'aprovado', null);

-- ---- a compra já enviada pelo botão antes do fechamento ---------------------------------
select pg_temp.como('compras');
select public.transicionar_pedido_compra(pg_temp.compra('jaenviada'), 'enviado', 'Pedido enviado ao fornecedor.', date '2027-02-01');

-- ---- fechar com o fornecedor ----------------------------------------------------------------
select pg_temp.como('coord');
select pg_temp.fechar(r) from unnest(array['itens', 'orcamento', 'cabecalho', 'semprazo', 'vazio', 'jaenviada', 'dois']) as r;
select public.transicionar_pedido_interno(pg_temp.pedido('instituicao'), 'encaminhado_instituicao', 'Compra', 'registrado', null);

reset role;
do $$
declare
  v_hoje date := kontrol_private.hoje_brasilia();
  v_rotulo text;
  v_esperada date;
  v_compra record;
begin
  for v_rotulo, v_esperada in
    select * from (values
      ('itens', v_hoje + 20),
      ('orcamento', v_hoje + 5),
      ('cabecalho', v_hoje + 7),
      ('semprazo', date '2027-01-15'),
      ('vazio', null::date)) as t(rotulo, esperada)
  loop
    select status, data_prevista_entrega into v_compra from public.pedidos_compra where id = pg_temp.compra(v_rotulo);
    if v_compra.status <> 'enviado' then
      raise exception '0182 (%): a compra deveria estar enviada, está %', v_rotulo, v_compra.status;
    end if;
    if v_compra.data_prevista_entrega is distinct from v_esperada then
      raise exception '0182 (%): previsão % em vez de %', v_rotulo, v_compra.data_prevista_entrega, v_esperada;
    end if;
    if (select count(*) from public.eventos_status
         where entidade = 'pedido_compra' and entidade_id = pg_temp.compra(v_rotulo)
           and de_status = 'aprovado' and para_status = 'enviado'
           and usuario = 'ts-0182-coord@example.invalid'
           and observacao like 'Enviada ao fornecedor junto com o fechamento do pedido interno #' || pg_temp.pedido(v_rotulo) || ' %') <> 1 then
      raise exception '0182 (%): o envio não ficou na linha do tempo da compra', v_rotulo;
    end if;
  end loop;

  -- o pedido seguiu normalmente
  if (select status from public.pedidos_internos where id = pg_temp.pedido('itens')) <> 'compra_fechada' then
    raise exception '0182: o pedido não ficou como compra fechada';
  end if;

  -- instituição: a compra segue aprovada e sem evento de envio
  if (select status from public.pedidos_compra where id = pg_temp.compra('instituicao')) <> 'aprovado'
     or exists (select 1 from public.eventos_status
                 where entidade = 'pedido_compra' and entidade_id = pg_temp.compra('instituicao') and para_status = 'enviado') then
    raise exception '0182: encaminhar à instituição não deveria enviar a compra';
  end if;

  -- já enviada pelo botão: fica como estava, com um evento de envio só
  select status, data_prevista_entrega into v_compra from public.pedidos_compra where id = pg_temp.compra('jaenviada');
  if v_compra.status <> 'enviado' or v_compra.data_prevista_entrega is distinct from date '2027-02-01'
     or (select count(*) from public.eventos_status
          where entidade = 'pedido_compra' and entidade_id = pg_temp.compra('jaenviada') and para_status = 'enviado') <> 1 then
    raise exception '0182: a compra já enviada não deveria ser tocada pelo fechamento do pedido';
  end if;

  -- dois pedidos: com um só fechado, a compra espera
  if (select status from public.pedidos_compra where id = pg_temp.compra('dois')) <> 'aprovado' then
    raise exception '0182: a compra de dois pedidos não deveria seguir com um deles ainda aberto';
  end if;
end $$;

-- ---- o segundo pedido fecha e a compra segue; a instituição envia pelo botão ---------------
set local role authenticated;
select pg_temp.como('coord');
select public.transicionar_pedido_interno(pg_temp.pedido('dois_b'), 'compra_fechada', 'Compra', 'registrado', null);

select pg_temp.como('compras');
select public.transicionar_pedido_compra(pg_temp.compra('instituicao'), 'enviado', 'Instituição enviou ao fornecedor.', null);
-- o status da compra continua travado para gravação direta
select pg_temp.exigir_erro(
  format('update public.pedidos_compra set status = ''recebido'' where id = %s', pg_temp.compra('itens')),
  '42501', 'transicao transacional');

reset role;
do $$
begin
  if (select status from public.pedidos_compra where id = pg_temp.compra('dois')) <> 'enviado'
     or (select data_prevista_entrega from public.pedidos_compra where id = pg_temp.compra('dois'))
        is distinct from kontrol_private.hoje_brasilia() + 12
     or (select count(*) from public.eventos_status
          where entidade = 'pedido_compra' and entidade_id = pg_temp.compra('dois') and para_status = 'enviado') <> 1 then
    raise exception '0182: a compra de dois pedidos deveria seguir, uma vez, quando o segundo foi fechado';
  end if;
  if (select status from public.pedidos_compra where id = pg_temp.compra('instituicao')) <> 'enviado' then
    raise exception '0182: o envio pela instituição deveria continuar valendo pelo botão';
  end if;
  -- o envio feito pelo gatilho entra na auditoria da compra como qualquer outro
  if not exists (select 1 from public.auditoria
                  where tabela = 'pedidos_compra' and registro_id = pg_temp.compra('itens')::text
                    and acao = 'update'
                    and valor_anterior ->> 'status' = 'aprovado' and valor_novo ->> 'status' = 'enviado') then
    raise exception '0182: o envio pelo gatilho ficou fora da auditoria';
  end if;
  -- quem recebe é avisado, como no envio pelo botão (0173)
  if not exists (select 1 from public.notificacoes
                  where titulo = 'Compra enviada: prepare o recebimento'
                    and corpo like 'Compra #' || pg_temp.compra('itens') || ' %') then
    raise notice '0182: sem aviso de envio para a compra % (ninguém com a permissão de receber neste banco?)', pg_temp.compra('itens');
  end if;
end $$;

rollback;
