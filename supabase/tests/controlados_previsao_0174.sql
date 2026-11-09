-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0174 (decisões D9 e D10 de 09/11/2026):
--   * produto controlado só pela FUNPAR: pedido precisa de projeto, fonte
--     FUNPAR na autorização, sem compra direta, encaminhado à FUNPAR;
--   * compra avulsa com item controlado não é aprovada;
--   * laboratório dono do insumo e almoxarifados;
--   * previsão de equipamentos acompanha o pedido ligado.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception '0174: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception '0174: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

-- passa a etapa como dono do banco (sem usuário), como as RPCs fazem
create function pg_temp.etapa(p_pedido bigint, p_status text, p_extra text default '') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.pedido_interno_transicao', 'permitida', true);
  execute format('update public.pedidos_internos set status = %L %s where id = %s', p_status, p_extra, p_pedido);
end $$;

-- ---- colunas, funções e locais ----------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'insumos' and column_name = 'controlado')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'insumos' and column_name = 'laboratorio_id') then
    raise exception '0174: insumos sem controlado ou laboratorio_id';
  end if;
  if (select count(*) from public.locais where lower(nome) in ('almoxarifado geral', 'almoxarifado do lga')) < 2 then
    raise exception '0174: almoxarifados não foram criados';
  end if;
end $$;

do $$
declare
  v_lab bigint;
  v_projeto bigint;
  v_controlado bigint;
  v_comum bigint;
  v_pedido bigint;
  v_sem_projeto bigint;
  v_compra bigint;
  v_previsao bigint;
begin
  insert into public.coordenacoes_area (nome) values ('TS-0174 Lab') returning id into v_lab;
  insert into public.projetos (nome) values ('TS-0174 projeto') returning id into v_projeto;

  insert into public.insumos (especificacao, unidade, fator_conversao, custo_unitario, controlado, laboratorio_id)
  values ('TS-0174 Clorofórmio PA', 'L', 1, 0, true, v_lab) returning id into v_controlado;
  insert into public.insumos (especificacao, unidade, fator_conversao, custo_unitario)
  values ('TS-0174 Acetonitrila HPLC', 'L', 1, 0) returning id into v_comum;

  if (select laboratorio_id from public.insumos where id = v_controlado) <> v_lab then
    raise exception '0174: laboratório dono não gravou';
  end if;

  -- itens: insumo marcado, especificação sem insumo e item comum
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa, urgencia)
  values ('TS-0174 controlado', 'rascunho', 'ts-0174@example.invalid', v_projeto, 'material_consumo_geral', 'projeto', 'teste', 'normal')
  returning id into v_pedido;
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade, insumo_id)
  values (v_pedido, 'material', 'Clorofórmio', 1, 'L', v_controlado),
         (v_pedido, 'material', 'Acetonitrila', 1, 'L', v_comum);

  insert into public.pedidos_internos (titulo, status, solicitante, natureza, objetivo, justificativa, urgencia)
  values ('TS-0174 sem projeto', 'rascunho', 'ts-0174@example.invalid', 'material_consumo_geral', 'uso_geral', 'teste', 'normal')
  returning id into v_sem_projeto;
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade)
  values (v_sem_projeto, 'material', 'Acetona 1 L', 1, 'un');

  if kontrol_private.itens_controlados_pedido(v_pedido) is distinct from 'TS-0174 Clorofórmio PA' then
    raise exception '0174: itens controlados do pedido errados: %', kontrol_private.itens_controlados_pedido(v_pedido);
  end if;
  if kontrol_private.itens_controlados_pedido(v_sem_projeto) is null then
    raise exception '0174: acetona sem insumo ligado deveria contar como controlada';
  end if;

  perform set_config('t0174.pedido', v_pedido::text, true);
  perform set_config('t0174.sem_projeto', v_sem_projeto::text, true);
  perform set_config('t0174.controlado', v_controlado::text, true);

  -- compra avulsa com item controlado
  insert into public.pedidos_compra (status, solicitante, observacao) values ('solicitado', 'ts-0174@example.invalid', 'TS-0174 avulsa')
  returning id into v_compra;
  insert into public.pedidos_compra_itens (pedido_id, insumo_id, quantidade) values (v_compra, v_controlado, 1);
  perform set_config('t0174.compra', v_compra::text, true);

  insert into public.previsao_equipamentos (nome, laboratorio_id, prioridade) values ('TS-0174 Termociclador', v_lab, 1)
  returning id into v_previsao;
  perform set_config('t0174.previsao', v_previsao::text, true);
end $$;

-- ---- pedido com controlado: projeto, fonte FUNPAR, sem compra direta, só FUNPAR --------
select pg_temp.exigir_erro(
  format('select pg_temp.etapa(%s, ''em_validacao'')', current_setting('t0174.sem_projeto')),
  '22023', 'Escolha o projeto');
select pg_temp.etapa(current_setting('t0174.pedido')::bigint, 'formalizado');
select pg_temp.exigir_erro(
  format('select pg_temp.etapa(%s, ''aprovado_compra'', '', fonte_recurso = ''''Recurso interno'''''')', current_setting('t0174.pedido')),
  '22023', 'fonte do recurso tem que ser a FUNPAR');
select pg_temp.etapa(current_setting('t0174.pedido')::bigint, 'aprovado_compra', ', fonte_recurso = ''FUNPAR''');
select pg_temp.etapa(current_setting('t0174.pedido')::bigint, 'aprovado_para_compra');
select pg_temp.exigir_erro(
  format('select pg_temp.etapa(%s, ''compra_fechada'')', current_setting('t0174.pedido')),
  '22023', 'Não pode ser compra direta');
select pg_temp.exigir_erro(
  format('select pg_temp.etapa(%s, ''encaminhado_instituicao'', '', instituicao_destino = ''''UFPR'''''')', current_setting('t0174.pedido')),
  '22023', 'Encaminhe à FUNPAR');
select pg_temp.etapa(current_setting('t0174.pedido')::bigint, 'encaminhado_instituicao', ', instituicao_destino = ''FUNPAR''');

-- ---- compra avulsa com controlado não é aprovada ----------------------------------------
select set_config('app.pedido_compra_transicao', 'permitida', true);
select pg_temp.exigir_erro(
  format('update public.pedidos_compra set status = ''aprovado'' where id = %s', current_setting('t0174.compra')),
  '22023', 'Faça pelo Pedido');

-- ---- previsão acompanha o pedido ligado ---------------------------------------------------
do $$
declare
  v_previsao bigint := current_setting('t0174.previsao')::bigint;
  v_pedido bigint := current_setting('t0174.pedido')::bigint;
begin
  update public.previsao_equipamentos set pedido_interno_id = v_pedido where id = v_previsao;
  if (select situacao from public.previsao_equipamentos where id = v_previsao) <> 'pedido' then
    raise exception '0174: ligar o pedido deveria marcar a previsão como pedido';
  end if;
  perform pg_temp.etapa(v_pedido, 'cancelado');
  if (select situacao from public.previsao_equipamentos where id = v_previsao) <> 'previsto' then
    raise exception '0174: pedido cancelado deveria voltar a previsão para previsto';
  end if;
  update public.previsao_equipamentos set situacao = 'pedido' where id = v_previsao;
  -- pagamento liberado por acordo registrado (0170), para chegar a concluído
  perform set_config('app.pedido_interno_transicao', 'permitida', true);
  update public.pedidos_internos
     set excecao_pagamento = 'TS-0174 acordo', excecao_pagamento_em = now(), excecao_pagamento_por = 'teste'
   where id = v_pedido;
  perform pg_temp.etapa(v_pedido, 'compra_concluida');
  if (select situacao from public.previsao_equipamentos where id = v_previsao) <> 'comprado' then
    raise exception '0174: pedido concluído deveria marcar a previsão como comprado';
  end if;
  begin
    insert into public.previsao_equipamentos (nome, prioridade) values ('TS-0174 inválido', 4);
    raise exception '0174: prioridade 4 deveria ser recusada';
  exception when check_violation then null;
  end;
end $$;

rollback;
