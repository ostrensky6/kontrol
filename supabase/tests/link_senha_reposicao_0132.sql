-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0132: leitura do link publico so pelo servidor, conta com senha
-- provisoria sem permissoes ate a troca, validade na entrada manual em frascos,
-- receber_lote fora do alcance dos usuarios, previsao recalculada no envio e o
-- alerta "reposicao_pendente". Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text, p_provisoria boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0132-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0132-' || p_rotulo)::uuid,
                      'email', 'ts-0132-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated',
                      'app_metadata', json_build_object('senha_provisoria', p_provisoria))::text, true);
end $$;

do $$
declare
  v_rotulo text;
  v_forn bigint;
  v_frasco bigint;
  v_pend bigint;
  v_auto bigint;
  v_ped bigint;
begin
  foreach v_rotulo in array array['tecnico', 'coordenador', 'novato'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0132-' || v_rotulo)::uuid,
            'authenticated', 'authenticated', 'ts-0132-' || v_rotulo || '@example.invalid',
            case when v_rotulo = 'novato' then '{"senha_provisoria": true}'::jsonb else '{}'::jsonb end,
            now(), now());
  end loop;
  update public.perfis set papel = 'tecnico', suspenso = false,
         permissoes = '{"estoque.movimentar": true, "estoque.ver": true}'::jsonb
   where id in (md5('kontrol-0132-tecnico')::uuid, md5('kontrol-0132-novato')::uuid);
  update public.perfis set papel = 'coordenador', suspenso = false,
         permissoes = '{"compras.aprovar": true, "compras.cancelar": true}'::jsonb
   where id = md5('kontrol-0132-coordenador')::uuid;
  if not (select senha_provisoria from public.perfis where id = md5('kontrol-0132-novato')::uuid) then
    raise exception '0132: preparo — perfil do novato deveria nascer com senha provisoria';
  end if;

  insert into public.parametros (chave, valor, unidade) values ('prazo_tramitacao_compra_dias', 90, 'dias')
  on conflict (chave) do update set valor = 90;

  insert into public.fornecedores (nome, prazo_medio_dias) values ('TS-0132 Fornecedor', 20) returning id into v_forn;

  -- Insumo em frascos para a entrada manual.
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao, custo_unitario)
  values ('TS-0132 Frasco', 'mL', 'µL', 100, 1000, 5) returning id into v_frasco;

  -- Pendente: ponto 5, 1 frasco disponível, compra de 4 ainda solicitada.
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao,
                              custo_unitario, fornecedor_id, ponto_reposicao)
  values ('TS-0132 Pendente', 'mL', 'µL', 100, 1000, 5, v_forn, 5) returning id into v_pend;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_pend, 'TS-0132-P1', 1, 1, 'aceito', current_date + 300, 'EMBALAGEM_FECHADA', 'mL', 100, 'µL', 1000);
  insert into public.pedidos_compra (status, solicitante, fornecedor_id)
  values ('solicitado', 'ts-0132', v_forn) returning id into v_ped;
  insert into public.pedidos_compra_itens (pedido_id, insumo_id, quantidade, quantidade_em, conteudo_embalagem, custo_unitario_estimado)
  values (v_ped, v_pend, 4, 'embalagem', 100, 500);

  -- Automático: ponto 5, 1 frasco disponível, nada pedido (o rascunho do cron vai cobrir).
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao,
                              custo_unitario, fornecedor_id, ponto_reposicao)
  values ('TS-0132 Automatico', 'mL', 'µL', 100, 1000, 5, v_forn, 5) returning id into v_auto;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_auto, 'TS-0132-A1', 1, 1, 'aceito', current_date + 300, 'EMBALAGEM_FECHADA', 'mL', 100, 'µL', 1000);

  perform set_config('t0132.frasco', v_frasco::text, true);
  perform set_config('t0132.pend', v_pend::text, true);
  perform set_config('t0132.auto', v_auto::text, true);
  perform set_config('t0132.ped', v_ped::text, true);
end $$;

-- ---- 1. Link público: só o servidor lê; aprovar continua público -------------
do $$
begin
  if has_function_privilege('anon', 'public.ler_orcamento_publico(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ler_orcamento_publico(text)', 'EXECUTE') then
    raise exception '0132: ler_orcamento_publico ainda executavel por anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.ler_orcamento_publico(text)', 'EXECUTE') then
    raise exception '0132: service_role deveria ler o link publico';
  end if;
  if not has_function_privilege('anon', 'public.aprovar_orcamento_publico(text, text)', 'EXECUTE') then
    raise exception '0132: aprovacao pelo link deveria continuar publica';
  end if;
end $$;
set local role anon;
do $$
begin
  perform public.ler_orcamento_publico('ts-0132-qualquer');
  raise exception '0132: anon leu o snapshot do link publico';
exception when insufficient_privilege then null;
end $$;
reset role;

-- ---- 1b. Auto-cadastro nasce suspenso; cadastro do administrador nasce ativo --
do $$
begin
  insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0132-auto')::uuid,
          'authenticated', 'authenticated', 'ts-0132-auto@example.invalid',
          '{"provider": "email", "providers": ["email"]}'::jsonb, now(), now());
  insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0132-admin-cad')::uuid,
          'authenticated', 'authenticated', 'ts-0132-admin-cad@example.invalid',
          '{"provider": "email", "cadastrado_pelo_admin": true, "senha_provisoria": true}'::jsonb, now(), now());
  if not (select suspenso from public.perfis where id = md5('kontrol-0132-auto')::uuid) then
    raise exception '0132: conta criada por auto-cadastro deveria nascer suspensa';
  end if;
  if (select suspenso from public.perfis where id = md5('kontrol-0132-admin-cad')::uuid) then
    raise exception '0132: conta cadastrada pelo administrador deveria nascer ativa';
  end if;
end $$;
set local role authenticated;
select pg_temp.como('auto');
do $$
begin
  if public.tem_permissao('estoque.ver') or public.current_papel() is not null then
    raise exception '0132: conta de auto-cadastro nao deveria ter permissao nem papel';
  end if;
end $$;
reset role;
-- Sem sessão de usuário daqui até a rotina diária (como o cron).
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

-- ---- 2. receber_lote fora do alcance dos usuários ----------------------------
do $$
declare
  v_assinatura text := 'public.receber_lote(bigint, numeric, date, numeric, text, text, bigint, text, text)';
begin
  if has_function_privilege('anon', v_assinatura, 'EXECUTE')
     or has_function_privilege('authenticated', v_assinatura, 'EXECUTE') then
    raise exception '0132: receber_lote ainda executavel por usuarios';
  end if;
end $$;

-- ---- 3. Reposição aguardando aprovação ----------------------------------------
do $$
declare
  p record;
begin
  select * into p from public.v_previsao_suprimentos where insumo_id = current_setting('t0132.pend')::bigint;
  -- necessidade 5 − 1 disponível − 4 solicitados = 0 sugerido; os 4 ainda sem aprovação.
  if p.qtd_sugerida_compra <> 0 or p.qtd_pedida_aberta <> 4 or p.qtd_pedida_pendente <> 4
     or p.qtd_reposicao_pendente <> 4 then
    raise exception '0132: pendente deveria ter sugerido 0, aberto 4, pendente 4 e reposicao pendente 4 (obtido % % % %)',
      p.qtd_sugerida_compra, p.qtd_pedida_aberta, p.qtd_pedida_pendente, p.qtd_reposicao_pendente;
  end if;
  if not exists (select 1 from public.v_alertas_estoque
                 where tipo = 'reposicao_pendente' and insumo_id = current_setting('t0132.pend')::bigint)
     or exists (select 1 from public.v_alertas_estoque
                where tipo = 'reposicao' and insumo_id = current_setting('t0132.pend')::bigint) then
    raise exception '0132: compra so solicitada deveria gerar reposicao_pendente (e nao reposicao)';
  end if;
end $$;

-- Rotina diária (sem sessão, como o cron): o rascunho cobre a quantidade, mas o
-- painel continua avisando; a segunda rodada não repete o item.
do $$
declare
  r jsonb;
  v_auto bigint := current_setting('t0132.auto')::bigint;
begin
  if not exists (select 1 from public.v_alertas_estoque where tipo = 'reposicao' and insumo_id = v_auto) then
    raise exception '0132: preparo — automatico deveria comecar com alerta de reposicao';
  end if;
  r := public.gerar_reposicao_automatica();
  if (select sum(i.quantidade) from public.pedidos_compra_itens i join public.pedidos_compra p on p.id = i.pedido_id
      where p.observacao = 'Rascunho automatico de reposicao' and i.insumo_id = v_auto) <> 4 then
    raise exception '0132: rascunho automatico deveria pedir 4 (obtido %)', r;
  end if;
  if exists (select 1 from public.v_alertas_estoque where tipo = 'reposicao' and insumo_id = v_auto)
     or not exists (select 1 from public.v_alertas_estoque where tipo = 'reposicao_pendente' and insumo_id = v_auto) then
    raise exception '0132: depois do rascunho automatico o alerta deveria virar reposicao_pendente';
  end if;
  r := public.gerar_reposicao_automatica();
  if (select sum(i.quantidade) from public.pedidos_compra_itens i join public.pedidos_compra p on p.id = i.pedido_id
      where p.observacao = 'Rascunho automatico de reposicao' and i.insumo_id = v_auto) <> 4 then
    raise exception '0132: segunda rodada nao deveria repetir o item (obtido %)', r;
  end if;
end $$;

set local role authenticated;

-- ---- 4. Senha provisória: sem permissões até a troca --------------------------
select pg_temp.como('novato', true);
do $$
begin
  if public.tem_permissao('estoque.movimentar') or public.current_papel() is not null then
    raise exception '0132: conta com senha provisoria nao deveria ter permissao nem papel';
  end if;
  if (public.minhas_permissoes()->>'senha_provisoria')::boolean is not true
     or public.minhas_permissoes()->'permissoes' <> '{}'::jsonb then
    raise exception '0132: minhas_permissoes deveria vir vazio e marcado (obtido %)', public.minhas_permissoes();
  end if;
  begin
    perform public.registrar_entrada_manual_embalagens(
      current_setting('t0132.frasco')::bigint, 1, gen_random_uuid(), current_date + 100, 500, null, null, 'ts');
    raise exception '0132: conta com senha provisoria registrou entrada';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Logo depois da troca o token antigo ainda vem marcado, mas o perfil já foi
-- limpo: a conta não fica travada.
reset role;
update public.perfis set senha_provisoria = false where id = md5('kontrol-0132-novato')::uuid;
set local role authenticated;
select pg_temp.como('novato', true);
do $$
begin
  if not public.tem_permissao('estoque.movimentar') or public.current_papel() is distinct from 'tecnico' then
    raise exception '0132: perfil ja trocado nao deveria ficar travado pelo token antigo';
  end if;
end $$;

-- Se a limpeza do perfil falhar, o token renovado (sem a marca) também libera.
reset role;
update public.perfis set senha_provisoria = true where id = md5('kontrol-0132-novato')::uuid;
set local role authenticated;
select pg_temp.como('novato', false);
do $$
begin
  if not public.tem_permissao('estoque.movimentar') then
    raise exception '0132: token sem a marca nao deveria ficar travado pelo perfil';
  end if;
end $$;

-- ---- 5. Validade na entrada manual em frascos ---------------------------------
select pg_temp.como('tecnico');
do $$
declare
  v_frasco bigint := current_setting('t0132.frasco')::bigint;
  r jsonb;
begin
  begin
    perform public.registrar_entrada_manual_embalagens(v_frasco, 1, gen_random_uuid(), current_date - 1, 500, null, null, 'ts');
    raise exception '0132: entrada manual de material vencido foi aceita';
  exception when invalid_parameter_value then null;
  end;
  r := public.registrar_entrada_manual_embalagens(v_frasco, 2, gen_random_uuid(), current_date + 100, 500, 'TS-0132-M1', null, 'ts');
  if (select disponivel from public.v_estoque_saldo where insumo_id = v_frasco) <> 2 then
    raise exception '0132: entrada manual valida deveria ficar disponivel (obtido %)', r;
  end if;
  begin
    perform public.receber_lote(v_frasco, 1);
    raise exception '0132: authenticated ainda chama receber_lote';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---- 6. Previsão da compra: aprovação e envio ---------------------------------
select pg_temp.como('coordenador');
do $$
declare
  v_ped bigint := current_setting('t0132.ped')::bigint;
begin
  perform public.transicionar_pedido_compra(v_ped, 'aprovado', 'ok', current_date + 110);
  if (select data_prevista_entrega from public.pedidos_compra where id = v_ped) <> current_date + 110 then
    raise exception '0132: aprovacao deveria gravar a previsao informada';
  end if;
  if exists (select 1 from public.v_alertas_estoque
             where tipo = 'reposicao_pendente' and insumo_id = current_setting('t0132.pend')::bigint) then
    raise exception '0132: compra aprovada nao deveria mais contar como reposicao pendente';
  end if;
  perform public.transicionar_pedido_compra(v_ped, 'enviado', 'ok', current_date + 20);
  if (select data_prevista_entrega from public.pedidos_compra where id = v_ped) <> current_date + 20 then
    raise exception '0132: envio deveria recalcular a previsao (envio + prazo do fornecedor)';
  end if;
  perform public.transicionar_pedido_compra(v_ped, 'em_transito', 'ok', current_date + 5);
  if (select data_prevista_entrega from public.pedidos_compra where id = v_ped) <> current_date + 20 then
    raise exception '0132: em transito nao deveria mudar a previsao';
  end if;
end $$;

reset role;
rollback;
