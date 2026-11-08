-- Executar apenas em banco descartável, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Ciclo da proposta (itens 13/14 do pacote de evolução + 0164):
-- taxas da proposta -> emitir v1 -> enviar -> ajustar taxas -> v1 continua com
-- as taxas e a memória de cálculo de quando foi enviada -> emitir v2 com as
-- taxas novas, v1 substituída. A memória de cálculo não aceita alteração,
-- exclusão nem inserção direta pela API. Tudo é revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_coord uuid := md5('kontrol-0164-coordenador')::uuid;
  v_demanda bigint;
  v_orc bigint;
begin
  insert into public.analises (codigo, nome_simplificado, ativo, ofertavel)
  values ('TS-0164-A', 'TS 0164 A', true, true);
  insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_coord, 'authenticated', 'authenticated',
          'ts-0164-coordenador@example.invalid', now(), now());
  update public.perfis set papel = 'coordenador', suspenso = false, permissoes = '{}'::jsonb where id = v_coord;

  insert into public.demandas_propostas (titulo, cliente_nome, status,
    param_impostos, param_incubacao, param_reserva, param_investimentos, param_lucro)
  values ('TS-0164 proposta', 'Cliente TS-0164', 'em_analise', 10, 2, 3, 4, 15)
  returning id into v_demanda;
  insert into public.orcamentos (demanda_id, cliente_nome)
  values (v_demanda, 'Cliente TS-0164') returning id into v_orc;

  perform set_config('ts0164.demanda', v_demanda::text, true);
  perform set_config('ts0164.orc', v_orc::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', md5('kontrol-0164-coordenador')::uuid::text, true);
select set_config('request.jwt.claims',
  json_build_object('sub', md5('kontrol-0164-coordenador')::uuid, 'email', 'ts-0164-coordenador@example.invalid',
                    'role', 'authenticated')::text, true);

-- A. emitir v1 com as taxas da proposta e enviar
do $$
declare
  v_demanda bigint := current_setting('ts0164.demanda')::bigint;
  v_orc bigint := current_setting('ts0164.orc')::bigint;
  v_snapshot jsonb;
  v_param jsonb;
  v_v1 jsonb;
begin
  select jsonb_build_object(
    'demanda', jsonb_build_object('id', d.id, 'titulo', d.titulo, 'param_impostos', d.param_impostos,
                                  'param_lucro', d.param_lucro),
    'orcamentos_analises', jsonb_build_array(jsonb_build_object('id', v_orc,
      'orcamento_itens', jsonb_build_array(jsonb_build_object('id', -1, 'codigo_analise', 'TS-0164-A', 'n_amostras', 5)))),
    'orcamentos_projeto', '[]'::jsonb)
    into v_snapshot from public.demandas_propostas d where d.id = v_demanda;
  v_param := jsonb_build_object('orcamento_laboratorial_id', v_orc, 'metodo_calculo', 'GROSS_UP',
    'subtotal_laboratorio', 1000, 'subtotal_custos', 1000, 'total_parametros', 34, 'total_final', 1515.15,
    'parametros_snapshot', jsonb_build_array(jsonb_build_object('chave', 'impostos', 'percentual', 10),
                                             jsonb_build_object('chave', 'lucro', 'percentual', 15)));
  v_v1 := public.emitir_orcamento_final_transacional(v_demanda, 30, 1000, 1515.15, 0, 0, 1515.15, v_snapshot, v_param,
    md5('kontrol-0164-coordenador')::uuid, 'ts-0164-coordenador@example.invalid', md5('ts-0164-op-v1')::uuid);
  perform public.transicionar_orcamento_final((v_v1->>'id')::bigint, 'enviado', 'enviado por e-mail');
  perform set_config('ts0164.v1', v_v1->>'id', true);

  if (select count(*) from public.orcamento_parametros_aplicados where orcamento_final_versao_id = (v_v1->>'id')::bigint) <> 1 then
    raise exception '0164: emissão não gravou a memória de cálculo da v1';
  end if;
end $$;

-- B. ajustar as taxas da proposta depois do envio é permitido
update public.demandas_propostas set param_impostos = 12, param_lucro = 20
 where id = current_setting('ts0164.demanda')::bigint;

do $$
declare
  v_v1 bigint := current_setting('ts0164.v1')::bigint;
begin
  if (select snapshot->'demanda'->>'param_lucro' from public.orcamento_final_versoes where id = v_v1) <> '15' then
    raise exception '0164: ajuste de taxa mudou a v1 já enviada';
  end if;
  if (select status from public.orcamento_final_versoes where id = v_v1) <> 'enviado' then
    raise exception '0164: ajuste de taxa mudou a situação da v1';
  end if;

  -- C. memória de cálculo da v1 não muda nem some pela API
  begin
    update public.orcamento_parametros_aplicados set total_final = 1 where orcamento_final_versao_id = v_v1;
    raise exception '0164: memória de cálculo da v1 alterada';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orcamento_parametros_aplicados
       set parametros_snapshot = '[{"chave":"lucro","percentual":20}]'::jsonb
     where orcamento_final_versao_id = v_v1;
    raise exception '0164: taxas registradas da v1 trocadas';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orcamento_parametros_aplicados set orcamento_final_versao_id = null
     where orcamento_final_versao_id = v_v1;
    raise exception '0164: memória de cálculo desligada da v1 pela API';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.orcamento_parametros_aplicados where orcamento_final_versao_id = v_v1;
    raise exception '0164: memória de cálculo da v1 apagada';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.orcamento_parametros_aplicados (demanda_id, orcamento_final_versao_id, metodo_calculo)
    values (current_setting('ts0164.demanda')::bigint, v_v1, 'GROSS_UP');
    raise exception '0164: memória de cálculo forjada aceita';
  exception when insufficient_privilege then null;
  end;
  if (select total_final from public.orcamento_parametros_aplicados where orcamento_final_versao_id = v_v1) <> 1515.15 then
    raise exception '0164: valores da memória de cálculo da v1 mudaram';
  end if;
end $$;

-- D. nova versão leva as taxas novas; a v1 fica substituída e intacta
do $$
declare
  v_demanda bigint := current_setting('ts0164.demanda')::bigint;
  v_v1 bigint := current_setting('ts0164.v1')::bigint;
  v_snapshot jsonb;
  v_v2 jsonb;
begin
  select jsonb_build_object('demanda', jsonb_build_object('id', d.id, 'titulo', d.titulo,
    'param_impostos', d.param_impostos, 'param_lucro', d.param_lucro),
    'orcamentos_analises', '[]'::jsonb, 'orcamentos_projeto', '[]'::jsonb)
    into v_snapshot from public.demandas_propostas d where d.id = v_demanda;
  v_v2 := public.emitir_orcamento_final_transacional(v_demanda, 30, 1000, 1612.9, 0, 0, 1612.9, v_snapshot,
    jsonb_build_object('metodo_calculo', 'GROSS_UP', 'subtotal_custos', 1000, 'total_parametros', 38, 'total_final', 1612.9,
      'parametros_snapshot', jsonb_build_array(jsonb_build_object('chave', 'lucro', 'percentual', 20))),
    md5('kontrol-0164-coordenador')::uuid, 'ts-0164-coordenador@example.invalid', md5('ts-0164-op-v2')::uuid);

  if (select status from public.orcamento_final_versoes where id = v_v1) <> 'substituido' then
    raise exception '0164: v1 enviada não foi substituída pela v2';
  end if;
  if (select versao from public.orcamento_final_versoes where id = (v_v2->>'id')::bigint) <> 2 then
    raise exception '0164: nova versão não é a 2';
  end if;
  if (select snapshot->'demanda'->>'param_lucro' from public.orcamento_final_versoes where id = (v_v2->>'id')::bigint) <> '20' then
    raise exception '0164: v2 não levou as taxas ajustadas';
  end if;
  if (select total_final from public.orcamento_parametros_aplicados where orcamento_final_versao_id = (v_v2->>'id')::bigint) <> 1612.9
     or (select total_final from public.orcamento_parametros_aplicados where orcamento_final_versao_id = v_v1) <> 1515.15 then
    raise exception '0164: memória de cálculo das versões misturada';
  end if;
end $$;

-- F. caminho de projetos: custos -> revisão concluída trava -> emissão congela
do $$
declare
  v_demanda bigint;
  v_proj bigint;
  v_custo bigint;
  v_v1 jsonb;
begin
  insert into public.demandas_propostas (titulo, cliente_nome, status, param_lucro)
  values ('TS-0164 projeto', 'Cliente TS-0164', 'em_analise', 10) returning id into v_demanda;
  insert into public.orcamento_projetos (demanda_id, titulo, cliente_nome)
  values (v_demanda, 'TS-0164 módulo de projeto', 'Cliente TS-0164') returning id into v_proj;
  insert into public.orcamento_projeto_custos (orcamento_projeto_id, categoria, descricao, quantidade, custo_unitario, preco_unitario)
  values (v_proj, 'materiais', 'Coleta em campo', 2, 300, 300) returning id into v_custo;

  perform public.transicionar_orcamento_projeto(v_proj, 'enviado', 'revisão concluída');
  begin
    update public.orcamento_projeto_custos set custo_unitario = 1 where id = v_custo;
    raise exception '0164: custo do projeto revisado alterado';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.orcamento_projeto_custos (orcamento_projeto_id, categoria, descricao, custo_unitario)
    values (v_proj, 'materiais', 'Custo novo depois da revisão', 50);
    raise exception '0164: custo incluído em projeto revisado';
  exception when invalid_parameter_value then null;
  end;

  v_v1 := public.emitir_orcamento_final_transacional(v_demanda, 30, 0, 0, 600, 666.67, 666.67,
    jsonb_build_object('demanda', jsonb_build_object('id', v_demanda), 'orcamentos_analises', '[]'::jsonb,
      'orcamentos_projeto', jsonb_build_array(jsonb_build_object('id', v_proj, 'custo_total', 600))),
    jsonb_build_object('orcamento_projeto_id', v_proj, 'metodo_calculo', 'GROSS_UP', 'subtotal_projeto', 600,
      'subtotal_custos', 600, 'total_parametros', 10, 'total_final', 666.67),
    md5('kontrol-0164-coordenador')::uuid, 'ts-0164-coordenador@example.invalid', md5('ts-0164-op-proj')::uuid);
  perform public.transicionar_orcamento_final((v_v1->>'id')::bigint, 'enviado', 'enviado por e-mail');

  if (select total_projeto_custo from public.orcamento_final_versoes where id = (v_v1->>'id')::bigint) <> 600
     or (select subtotal_projeto from public.orcamento_parametros_aplicados
          where orcamento_final_versao_id = (v_v1->>'id')::bigint) <> 600 then
    raise exception '0164: emissão do caminho de projetos não congelou os valores';
  end if;
  begin
    update public.orcamento_parametros_aplicados set subtotal_projeto = 1
     where orcamento_final_versao_id = (v_v1->>'id')::bigint;
    raise exception '0164: memória de cálculo do projeto alterada';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- E. a exclusão do usuário ainda desvincula a autoria (FK ON DELETE SET NULL)
do $$
begin
  delete from auth.users where id = md5('kontrol-0164-coordenador')::uuid;
  if exists (select 1 from public.orcamento_parametros_aplicados
              where demanda_id = current_setting('ts0164.demanda')::bigint and criado_por is not null) then
    raise exception '0164: autoria não foi desvinculada';
  end if;
  if exists (select 1 from public.orcamento_parametros_aplicados p
               join public.demandas_propostas d on d.id = p.demanda_id
              where d.titulo = 'TS-0164 projeto' and p.criado_por is not null) then
    raise exception '0164: autoria do projeto não foi desvinculada';
  end if;
  if (select count(*) from public.orcamento_parametros_aplicados
       where demanda_id = current_setting('ts0164.demanda')::bigint) <> 2 then
    raise exception '0164: memória de cálculo perdida ao excluir o usuário';
  end if;
end $$;

rollback;
