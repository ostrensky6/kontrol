-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0183 (relatório de ajustes de Compras de 17/11/2026, ajuste 2):
--   * a permissão "Definir urgência do pedido" nasce marcada só para o Administrativo;
--   * quem usa o app não grava urgência nem justificativa de urgência direto
--     na tabela, nem ao criar o pedido nem depois, com ou sem "Aprovar pedidos";
--   * a função definir_urgencia_pedido_interno exige a permissão, pede
--     justificativa para Alta ou Crítica, grava quem definiu, quando e o evento;
--   * marcar a urgência num pedido que espera o ciclo libera a formalização;
--     tirar a urgência devolve o pedido ao ciclo da data da aprovação;
--   * depois de formalizado o ciclo não muda; pedido encerrado não muda de urgência;
--   * pedido gerado pelo planejamento nasce urgente e justificado.
-- Tudo e revertido no ROLLBACK final.
begin;
-- 0188: este teste cobre a ordem antiga de aprovações (pedidos que já estavam no meio quando a nova entrou)
alter table public.pedidos_internos alter column fluxo set default 1;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0183-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0183-' || p_rotulo)::uuid,
                      'email', 'ts-0183-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-0183-' || p_rotulo)::uuid
$$;

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception '0183: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception '0183: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

create function pg_temp.pedido(p_rotulo text) returns bigint language sql as $$
  select current_setting('t0183.' || p_rotulo)::bigint
$$;

create function pg_temp.eventos_de_urgencia(p_pedido bigint) returns bigint language sql as $$
  select count(*) from public.eventos_status e
   where e.entidade = 'pedido_interno' and e.entidade_id = p_pedido and e.observacao like 'Urgência: %'
$$;

-- ---- estrutura ------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgname = 'pedidos_internos_proteger_urgencia'
                    and tgrelid = 'public.pedidos_internos'::regclass and not tgisinternal) then
    raise exception '0183: gatilho da urgência não foi criado';
  end if;
  -- os gatilhos do ciclo (0172) e da trava (0176/0177) continuam no lugar
  if (select count(*) from pg_trigger
       where tgname in ('pedidos_internos_definir_ciclo', 'pedidos_internos_travar_ciclo')
         and tgrelid = 'public.pedidos_internos'::regclass and not tgisinternal) <> 2 then
    raise exception '0183: os gatilhos do ciclo sumiram';
  end if;
  if not has_function_privilege('authenticated', 'public.definir_urgencia_pedido_interno(bigint, text, text)', 'execute')
     or has_function_privilege('anon', 'public.definir_urgencia_pedido_interno(bigint, text, text)', 'execute') then
    raise exception '0183: definir_urgencia_pedido_interno deve ser chamada só por quem entrou no app';
  end if;
  if (select permissoes ->> 'pedido.urgencia' from public.permissoes_categorias where papel = 'administrativo') is distinct from 'true' then
    raise exception '0183: o Administrativo deveria nascer com "Definir urgência do pedido"';
  end if;
  -- 0184: a função Compra também passou a ter todas as caixinhas de Compras
  if exists (select 1 from public.permissoes_categorias
              where papel not in ('administrativo', 'compra') and permissoes ->> 'pedido.urgencia' = 'true') then
    raise exception '0183: só o Administrativo e a Compra nascem com "Definir urgência do pedido"';
  end if;
end $$;

-- ---- dados do cenário -----------------------------------------------------------------------
do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_plano bigint;
  v_pedido bigint;
  v_insumo bigint;
begin
  -- pedinte: só cria; coord: aprova pedidos, sem a permissão da urgência;
  -- adm: função Administrativo, sem ajuste individual (vale a marcação da função)
  foreach v_rotulo in array array['pedinte', 'coord', 'adm'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-0183-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-0183 ' || v_rotulo,
           papel = case v_rotulo when 'coord' then 'coordenador' when 'adm' then 'administrativo' else 'laboratorio' end,
           suspenso = false, senha_provisoria = false,
           permissoes = case v_rotulo
             when 'coord' then '{"pedido.criar": true, "pedido.aprovar": true}'::jsonb
             when 'adm' then '{}'::jsonb
             else '{"pedido.criar": true}'::jsonb end
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-0183 projeto', pg_temp.uid('coord')) returning id into v_projeto;
  if to_regclass('kontrol_private.projetos_vinculos') is not null then
    execute 'insert into kontrol_private.projetos_vinculos (projeto_id, usuario_id) values ($1, $2) on conflict do nothing'
      using v_projeto, pg_temp.uid('coord');
  end if;
  perform set_config('t0183.projeto', v_projeto::text, true);
  update public.responsaveis_compras set usuario_id = pg_temp.uid('adm'), substituto_id = null where etapa = 'administrativo';
  insert into public.insumos (especificacao, unidade, fator_conversao, custo_unitario)
  values ('TS-0183 kit de extração', 'un', 1, 0) returning id into v_insumo;

  -- a: rascunho de quem pede; b: vai esperar o ciclo; c: urgente aprovado em outubro
  foreach v_rotulo in array array['a', 'b', 'c'] loop
    insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa)
    values ('TS-0183 pedido ' || v_rotulo, 'rascunho', 'ts-0183-pedinte@example.invalid', v_projeto,
            'material_consumo_geral', 'projeto', 'Extração das amostras de campo')
    returning id into v_pedido;
    insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade, orcamento_previo, insumo_id)
    values (v_pedido, 'material', 'TS-0183 kit', 2, 'un', 150, v_insumo);
    perform set_config('t0183.' || v_rotulo, v_pedido::text, true);
  end loop;

  -- d: já formalizado, com o ciclo gravado; e: cancelado
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa, ciclo_pagamento)
  values ('TS-0183 pedido d', 'formalizado', 'ts-0183-pedinte@example.invalid', v_projeto,
          'material_consumo_geral', 'projeto', 'teste', date '2099-12-01')
  returning id into v_pedido;
  perform set_config('t0183.d', v_pedido::text, true);
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa)
  values ('TS-0183 pedido e', 'cancelado', 'ts-0183-pedinte@example.invalid', v_projeto,
          'material_consumo_geral', 'projeto', 'teste')
  returning id into v_pedido;
  perform set_config('t0183.e', v_pedido::text, true);

  -- pedido gerado pelo planejamento sem saldo (criado pelo sistema): nasce urgente e justificado
  insert into public.planejamento (nome) values ('TS-0183 plano') returning id into v_plano;
  insert into public.pedidos_internos (titulo, status, solicitante, planejamento_id, urgencia, justificativa)
  values ('TS-0183 do planejamento', 'rascunho', 'ts-0183-pedinte@example.invalid', v_plano, 'alta', 'falta de saldo')
  returning id into v_pedido;
  if (select urgencia from public.pedidos_internos where id = v_pedido) <> 'alta'
     or (select urgencia_justificativa from public.pedidos_internos where id = v_pedido) not like 'Falta de saldo para iniciar o planejamento%' then
    raise exception '0183: pedido do planejamento deveria nascer urgente e justificado';
  end if;
  -- a reposição de insumo crítico segue justificada pela 0172
  insert into public.pedidos_internos (titulo, status, solicitante, origem, urgencia, justificativa)
  values ('TS-0183 reposição', 'rascunho', 'ts-0183-pedinte@example.invalid', 'reposicao_estoque', 'alta', 'falta')
  returning id into v_pedido;
  if (select urgencia_justificativa from public.pedidos_internos where id = v_pedido) not like 'Reposição de insumo crítico%' then
    raise exception '0183: a reposição de insumo crítico perdeu a justificativa da 0172';
  end if;
end $$;

-- ---- quem pede: cria sem urgência e não a escreve depois --------------------------------------
set local role authenticated;
select pg_temp.como('pedinte');

insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa)
values ('TS-0183 criado pela tela', 'rascunho', 'ts-0183-pedinte@example.invalid',
        current_setting('t0183.projeto')::bigint, 'material_consumo_geral', 'projeto', 'teste');
-- o formulário antigo ainda mandava "normal" e a justificativa vazia: continua valendo
insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa, urgencia, urgencia_justificativa)
values ('TS-0183 criado pela tela antiga', 'rascunho', 'ts-0183-pedinte@example.invalid',
        current_setting('t0183.projeto')::bigint, 'material_consumo_geral', 'projeto', 'teste', 'normal', null);

select pg_temp.exigir_erro(
  format('insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, justificativa, urgencia, urgencia_justificativa)
          values (''TS-0183 urgente por quem pede'', ''rascunho'', ''ts-0183-pedinte@example.invalid'', %s, ''teste'', ''alta'', ''Preciso para amanhã sem falta.'')',
         current_setting('t0183.projeto')),
  '42501', 'Definir urgência do pedido');
select pg_temp.exigir_erro(
  format('insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, justificativa, urgencia)
          values (''TS-0183 baixa por quem pede'', ''rascunho'', ''ts-0183-pedinte@example.invalid'', %s, ''teste'', ''baixa'')',
         current_setting('t0183.projeto')),
  '42501', 'Definir urgência do pedido');
select pg_temp.exigir_erro(
  format('update public.pedidos_internos set urgencia = ''alta'', urgencia_justificativa = ''Preciso para amanhã sem falta.'' where id = %s', pg_temp.pedido('a')),
  '42501', 'Definir urgência do pedido');
select pg_temp.exigir_erro(
  format('update public.pedidos_internos set urgencia_justificativa = ''Preciso para amanhã sem falta.'' where id = %s', pg_temp.pedido('a')),
  '42501', 'Definir urgência do pedido');
select pg_temp.exigir_erro(
  format('update public.pedidos_internos set urgencia_definida_por = ''eu'' where id = %s', pg_temp.pedido('a')),
  '42501', 'Definir urgência do pedido');
select pg_temp.exigir_erro(
  format('select public.definir_urgencia_pedido_interno(%s, ''alta'', ''Preciso para amanhã sem falta.'')', pg_temp.pedido('a')),
  '42501', 'pedido.urgencia');

-- o resto do rascunho continua editável por quem pediu
update public.pedidos_internos set titulo = 'TS-0183 pedido a (editado)' where id = pg_temp.pedido('a');

-- envio dos pedidos que vão ser aprovados
select public.transicionar_pedido_interno(pg_temp.pedido(r), 'em_validacao', 'Envio', 'registrado', null)
  from unnest(array['b', 'c']) r;

-- ---- quem aprova pedidos também não define a urgência ----------------------------------------
select pg_temp.como('coord');
select pg_temp.exigir_erro(
  format('update public.pedidos_internos set urgencia = ''critica'', urgencia_justificativa = ''A coordenação decidiu que é urgente.'' where id = %s', pg_temp.pedido('b')),
  '42501', 'Definir urgência do pedido');
select pg_temp.exigir_erro(
  format('select public.definir_urgencia_pedido_interno(%s, ''critica'', ''A coordenação decidiu que é urgente.'')', pg_temp.pedido('b')),
  '42501', 'pedido.urgencia');
select public.transicionar_pedido_interno(pg_temp.pedido(r), 'validado', 'Validação', 'aprovado', null)
  from unnest(array['b', 'c']) r;

reset role;
do $$
begin
  if (select count(*) from public.pedidos_internos
       where titulo like 'TS-0183 criado pela tela%' and urgencia = 'normal' and urgencia_justificativa is null) <> 2 then
    raise exception '0183: pedido criado pela tela deveria nascer Normal e sem justificativa de urgência';
  end if;
  if exists (select 1 from public.pedidos_internos where titulo like 'TS-0183 % por quem pede') then
    raise exception '0183: pedido urgente criado por quem pede não deveria existir';
  end if;
  if (select titulo from public.pedidos_internos where id = pg_temp.pedido('a')) <> 'TS-0183 pedido a (editado)' then
    raise exception '0183: quem pediu deveria continuar editando o rascunho';
  end if;
  -- b espera o ciclo de dezembro/2099; c foi aprovado urgente em 20/10/2026, depois do prazo de outubro
  update public.pedidos_internos set ciclo_pagamento = date '2099-12-01' where id = pg_temp.pedido('b');
  update public.pedidos_internos
     set urgencia = 'alta', urgencia_justificativa = 'Coleta marcada para a semana que vem.',
         validado_em = timestamptz '2026-10-20 12:00-03', ciclo_pagamento = date '2026-10-01'
   where id = pg_temp.pedido('c');
end $$;

-- ---- quem tem a permissão define ----------------------------------------------------------------
set local role authenticated;
select pg_temp.como('adm');

select pg_temp.exigir_erro(
  format('select public.definir_urgencia_pedido_interno(%s, ''urgentissima'', null)', pg_temp.pedido('a')),
  '22023', 'Urgência inválida');
select pg_temp.exigir_erro(
  format('select public.definir_urgencia_pedido_interno(%s, ''alta'', ''curta'')', pg_temp.pedido('a')),
  '22023', 'precisa de justificativa');
select pg_temp.exigir_erro(
  format('select public.definir_urgencia_pedido_interno(%s, ''alta'', %L)', pg_temp.pedido('a'), repeat('x', 1001)),
  '22023', '1.000 caracteres');
select pg_temp.exigir_erro(
  'select public.definir_urgencia_pedido_interno(-1, ''normal'', null)',
  'P0002', 'não encontrado');
select pg_temp.exigir_erro(
  format('select public.definir_urgencia_pedido_interno(%s, ''alta'', ''Precisa sair antes do ciclo.'')', pg_temp.pedido('e')),
  '22023', 'concluído ou cancelado');
-- a permissão vale pela função; gravar direto na tabela continua recusado
select pg_temp.exigir_erro(
  format('update public.pedidos_internos set urgencia = ''alta'', urgencia_justificativa = ''Precisa sair antes do ciclo.'' where id = %s', pg_temp.pedido('a')),
  '42501', 'Definir urgência do pedido');

do $$
declare
  r jsonb;
begin
  -- rascunho: marca, repete sem mudar nada e volta a Normal
  r := public.definir_urgencia_pedido_interno(pg_temp.pedido('a'), 'Alta', '  Amostras chegam dia 15 e o reagente acabou  ');
  if (r ->> 'alterado')::boolean is not true or r ->> 'urgencia' <> 'alta' or r -> 'ciclo' <> 'null'::jsonb then
    raise exception '0183: retorno errado ao marcar a urgência: %', r;
  end if;
  r := public.definir_urgencia_pedido_interno(pg_temp.pedido('a'), 'alta', 'Amostras chegam dia 15 e o reagente acabou');
  if (r ->> 'alterado')::boolean is not false then
    raise exception '0183: repetir a mesma urgência não deveria alterar nada: %', r;
  end if;
end $$;

reset role;
do $$
declare
  v record;
begin
  select urgencia, urgencia_justificativa, urgencia_definida_por, urgencia_definida_em, ciclo_pagamento
    into v from public.pedidos_internos where id = pg_temp.pedido('a');
  if v.urgencia <> 'alta' or v.urgencia_justificativa <> 'Amostras chegam dia 15 e o reagente acabou'
     or v.urgencia_definida_por <> 'ts-0183-adm@example.invalid' or v.urgencia_definida_em is null
     or v.ciclo_pagamento is not null then
    raise exception '0183: urgência do rascunho gravada errado: %', to_jsonb(v);
  end if;
  if pg_temp.eventos_de_urgencia(pg_temp.pedido('a')) <> 1 then
    raise exception '0183: marcar a urgência deveria registrar um evento (e repetir, nenhum)';
  end if;
  if not exists (select 1 from public.eventos_status e
                  where e.entidade = 'pedido_interno' and e.entidade_id = pg_temp.pedido('a')
                    and e.de_status is null and e.para_status = 'rascunho'
                    and e.usuario = 'ts-0183-adm@example.invalid'
                    and e.observacao = 'Urgência: Normal → Alta. Motivo: Amostras chegam dia 15 e o reagente acabou') then
    raise exception '0183: evento da urgência errado: %',
      (select json_agg(e) from public.eventos_status e where e.entidade = 'pedido_interno' and e.entidade_id = pg_temp.pedido('a'));
  end if;
end $$;

set local role authenticated;
select pg_temp.como('adm');
select public.definir_urgencia_pedido_interno(pg_temp.pedido('a'), 'normal', 'texto que não vale sem urgência');

-- b espera o ciclo: a formalização trava; com a urgência definida, segue
select pg_temp.exigir_erro(
  format('select public.formalizar_pedido_interno(%s)', pg_temp.pedido('b')),
  '22023', 'segue para compras a partir de 01/12/2099');
select public.definir_urgencia_pedido_interno(pg_temp.pedido('b'), 'critica', 'Coleta de campo não pode esperar dezembro.');

reset role;
do $$
declare
  v record;
begin
  select urgencia, urgencia_justificativa from public.pedidos_internos where id = pg_temp.pedido('a') into v;
  if v.urgencia <> 'normal' or v.urgencia_justificativa is not null then
    raise exception '0183: voltar a Normal deveria limpar a justificativa: %', to_jsonb(v);
  end if;
  if pg_temp.eventos_de_urgencia(pg_temp.pedido('a')) <> 2 then
    raise exception '0183: voltar a Normal deveria registrar o segundo evento';
  end if;
  if (select ciclo_pagamento from public.pedidos_internos where id = pg_temp.pedido('b'))
       is distinct from kontrol_private.ciclo_para(now(), true) then
    raise exception '0183: pedido que espera o ciclo, marcado urgente, deveria vir para o ciclo do mês corrente';
  end if;
end $$;

set local role authenticated;
select pg_temp.como('adm');
select public.formalizar_pedido_interno(pg_temp.pedido('b'));

-- c: urgente aprovado em 20/10/2026; sem a urgência, cai no ciclo de novembro/2026
select public.definir_urgencia_pedido_interno(pg_temp.pedido('c'), 'baixa', null);
-- d: já formalizado, o ciclo gravado não muda
select public.definir_urgencia_pedido_interno(pg_temp.pedido('d'), 'alta', 'Fornecedor só entrega neste mês.');

reset role;
do $$
declare
  v record;
begin
  if (select status from public.pedidos_internos where id = pg_temp.pedido('b')) <> 'formalizado' then
    raise exception '0183: com a urgência definida, o pedido deveria seguir para compras';
  end if;
  select urgencia, urgencia_justificativa, ciclo_pagamento from public.pedidos_internos where id = pg_temp.pedido('c') into v;
  if v.urgencia <> 'baixa' or v.urgencia_justificativa is not null or v.ciclo_pagamento <> date '2026-11-01' then
    raise exception '0183: tirar a urgência deveria devolver o pedido ao ciclo da aprovação: %', to_jsonb(v);
  end if;
  select urgencia, ciclo_pagamento from public.pedidos_internos where id = pg_temp.pedido('d') into v;
  if v.urgencia <> 'alta' or v.ciclo_pagamento <> date '2099-12-01' then
    raise exception '0183: depois de formalizado o ciclo não muda: %', to_jsonb(v);
  end if;
end $$;

rollback;
