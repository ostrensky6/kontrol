-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0125: item de pedido interno com insumo volta a gravar; travas de
-- permissao da reposicao automatica e da triagem existem; compra sugerida em
-- frascos inteiros. Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_rotulo text;
  v_uid uuid;
begin
  foreach v_rotulo in array array['tecnico', 'tecnico_sem_compras'] loop
    v_uid := md5('kontrol-0125-' || v_rotulo)::uuid;
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
            'ts-0125-' || v_rotulo || '@example.invalid', now(), now());
    update public.perfis
       set papel = 'tecnico',
           suspenso = false,
           permissoes = case v_rotulo
             when 'tecnico_sem_compras' then '{"compras.solicitar": false}'::jsonb
             else '{}'::jsonb end
     where id = v_uid;
  end loop;

  -- Insumo contado em frascos de 100 mL, sem estoque e com seguranca de 1,5 frasco
  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao,
                              custo_unitario, estoque_seguranca, lead_time_dias)
  values ('TS-0125 Tampao 100 mL', 'mL', 'µL', 100, 1000, 5, 1.5, 0);

  if has_function_privilege('anon', 'public.gerar_reposicao_automatica()', 'execute') then
    raise exception '0125: anon executa a reposicao automatica';
  end if;
end $$;

-- Reposicao automatica (sem sessao de usuario, como o cron): frascos inteiros
do $$
declare
  v_insumo bigint := (select id from public.insumos where especificacao = 'TS-0125 Tampao 100 mL');
  v_qtd numeric;
begin
  perform public.gerar_reposicao_automatica();
  select quantidade into v_qtd from public.pedidos_compra_itens where insumo_id = v_insumo;
  if v_qtd is distinct from 2 then
    raise exception '0125: sugestao de 1,5 frasco deveria virar 2 frascos inteiros (obtido %)', v_qtd;
  end if;
  delete from public.pedidos_compra_itens where insumo_id = v_insumo;
end $$;

set local role authenticated;

-- Tecnico pelo padrao do papel: cria pedido interno com item ligado a insumo
select set_config('request.jwt.claim.sub', md5('kontrol-0125-tecnico')::uuid::text, true);
select set_config('request.jwt.claims',
  json_build_object('sub', md5('kontrol-0125-tecnico')::uuid, 'email', 'ts-0125-tecnico@example.invalid',
                    'role', 'authenticated')::text, true);
do $$
declare
  v_insumo bigint := (select id from public.insumos where especificacao = 'TS-0125 Tampao 100 mL');
  v_pedido bigint;
  v_item bigint;
  v_resultado jsonb;
begin
  insert into public.pedidos_internos (titulo, status, solicitante, tipo_demanda, origem, justificativa)
  values ('TS-0125 pedido', 'rascunho', 'ts-0125-tecnico@example.invalid', 'laboratorio', 'manual', 'teste')
  returning id into v_pedido;

  -- EST2-1: antes falhava com 'record "new" has no field "pedido_interno_item_id"'
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, insumo_id)
  values (v_pedido, 'material', 'Tampao', 2, v_insumo)
  returning id into v_item;
  if (select quantidade_em from public.pedidos_internos_itens where id = v_item) <> 'embalagem'
     or (select conteudo_embalagem from public.pedidos_internos_itens where id = v_item) <> 100 then
    raise exception '0125: item de pedido interno deveria ficar em frascos de 100 mL';
  end if;

  -- Vincular insumo depois (UPDATE de insumo_id) tambem funciona
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade)
  values (v_pedido, 'material', 'Sem vinculo', 1)
  returning id into v_item;
  update public.pedidos_internos_itens set insumo_id = v_insumo where id = v_item;

  -- Pedido de reposicao pelo Controle de Estoque: frascos inteiros
  v_resultado := public.criar_pedido_reposicao_estoque(
    'TS-0125 reposicao', 'teste', 'normal', current_date + 10,
    jsonb_build_array(jsonb_build_object('insumo_id', v_insumo, 'quantidade', 5)));
  if (select quantidade from public.pedidos_internos_itens
      where pedido_interno_id = (v_resultado ->> 'pedido_id')::bigint) <> 2 then
    raise exception '0125: pedido de reposicao deveria pedir 2 frascos inteiros';
  end if;

  -- PER2-1: criar insumo pela triagem exige "Insumos: editar"
  begin
    perform public.resolver_triagem_criando_insumo(-1, 'X', 'mL', 'mL', 1, 1, null, null);
    raise exception '0125: tecnico sem Insumos: editar resolveu triagem';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Tecnico sem "Compras: solicitar" nao dispara a reposicao automatica
select set_config('request.jwt.claim.sub', md5('kontrol-0125-tecnico_sem_compras')::uuid::text, true);
do $$
begin
  begin
    perform public.gerar_reposicao_automatica();
    raise exception '0125: tecnico sem Compras: solicitar gerou reposicao';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
