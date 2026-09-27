-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0126: item do orcamento pela RPC, itens travados, uma versao viva por
-- proposta, validade na aprovacao, link por versao, cancelamento da aprovada com
-- o plano e geracao manual do plano. Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Fixtures (nao dependem do seed: o CI cria o banco sem dados)
-- ---------------------------------------------------------------------------
do $$
declare
  v_coord uuid := md5('kontrol-0126-coordenador')::uuid;
  v_tec uuid := md5('kontrol-0126-tecnico')::uuid;
  v_demanda bigint;
  v_orc bigint;
begin
  insert into public.analises (codigo, nome_simplificado, ativo, ofertavel)
  values ('TS-0126-A', 'TS 0126 A', true, true), ('TS-0126-B', 'TS 0126 B', true, true);

  insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_coord, 'authenticated', 'authenticated',
          'ts-0126-coordenador@example.invalid', now(), now()),
         ('00000000-0000-0000-0000-000000000000', v_tec, 'authenticated', 'authenticated',
          'ts-0126-tecnico@example.invalid', now(), now());
  update public.perfis set papel = 'coordenador', suspenso = false, permissoes = '{}'::jsonb where id = v_coord;
  update public.perfis set papel = 'tecnico', suspenso = false, permissoes = '{}'::jsonb where id = v_tec;

  insert into public.demandas_propostas (titulo, cliente_nome, status)
  values ('TS-0126 proposta', 'Cliente TS-0126', 'em_analise') returning id into v_demanda;
  insert into public.orcamentos (demanda_id, cliente_nome)
  values (v_demanda, 'Cliente TS-0126') returning id into v_orc;

  perform set_config('ts0126.demanda', v_demanda::text, true);
  perform set_config('ts0126.orc', v_orc::text, true);

  -- estrutura
  if not exists (select 1 from cron.job where jobname = 'kontrol-vencimento-propostas') then
    raise exception '0126: job diario de vencimento nao agendado';
  end if;
  if has_function_privilege('anon', 'public.salvar_item_orcamento(bigint,text,numeric,numeric,numeric,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.gerar_planejamento_da_proposta(bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.vencer_orcamentos_finais()', 'EXECUTE') then
    raise exception '0126: RPC nova executavel por anon';
  end if;
  if not has_function_privilege('anon', 'public.aprovar_orcamento_publico(text,text)', 'EXECUTE') then
    raise exception '0126: aprovacao publica deixou de ser executavel por anon';
  end if;
  if has_table_privilege('anon', 'public.v_proposta_aprovada_vigente', 'SELECT') then
    raise exception '0126: anon le a view de proposta aprovada';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A. ORC2-1: incluir analise e mudar quantidade pela RPC
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', md5('kontrol-0126-coordenador')::uuid::text, true);
select set_config('request.jwt.claims',
  json_build_object('sub', md5('kontrol-0126-coordenador')::uuid, 'email', 'ts-0126-coordenador@example.invalid',
                    'role', 'authenticated')::text, true);

do $$
declare
  v_orc bigint := current_setting('ts0126.orc')::bigint;
  v_linha record;
begin
  perform public.salvar_item_orcamento(v_orc, 'TS-0126-A', 10, 5, 8, '{"lote_padrao": 1}'::jsonb, '{"totais": {"custo": 50}}'::jsonb);
  perform public.salvar_item_orcamento(v_orc, 'TS-0126-B', 2, 3, 4, '{}'::jsonb, '{"totais": {"custo": 56}}'::jsonb);
  -- mudar a quantidade (antes falhava sempre)
  perform public.salvar_item_orcamento(v_orc, 'TS-0126-A', 12, 5, 8, '{"lote_padrao": 1}'::jsonb, '{"totais": {"custo": 66}}'::jsonb);

  select count(*) filter (where codigo_analise = 'TS-0126-A') as a,
         max(n_amostras) filter (where codigo_analise = 'TS-0126-A') as qa,
         count(*) as total
    into v_linha
    from public.orcamento_itens where orcamento_id = v_orc;
  if v_linha.a <> 1 or v_linha.qa <> 12 or v_linha.total <> 2 then
    raise exception '0126: item nao gravado pela RPC (% % %)', v_linha.a, v_linha.qa, v_linha.total;
  end if;
  if (select (custo_snapshot #>> '{totais,custo}')::numeric from public.orcamentos where id = v_orc) <> 66
     or (select status_operacional from public.orcamentos where id = v_orc) <> 'preenchido' then
    raise exception '0126: custo congelado ou status do modulo nao atualizados';
  end if;

  -- fora da RPC, o custo continua protegido
  begin
    update public.orcamento_itens set custo_unitario = 1 where orcamento_id = v_orc;
    raise exception '0126: custo alterado fora da RPC';
  exception when insufficient_privilege then null;
  end;

  -- analise inativa nao entra
  begin
    perform public.salvar_item_orcamento(v_orc, 'TS-0126-X', 1, 1, 1, '{}'::jsonb, '{}'::jsonb);
    raise exception '0126: analise inexistente entrou no orcamento';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- tecnico sem "orcamentos.criar_editar"? o padrao do tecnico tem; tira e confere
reset role;
update public.perfis set permissoes = '{"orcamentos.criar_editar": false}'::jsonb
 where id = md5('kontrol-0126-tecnico')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', md5('kontrol-0126-tecnico')::uuid::text, true);
do $$
begin
  perform public.salvar_item_orcamento(current_setting('ts0126.orc')::bigint, 'TS-0126-A', 3, 5, 8, '{}'::jsonb, '{}'::jsonb);
  raise exception '0126: tecnico sem permissao salvou item';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------------------
-- B. ORC2-2: modulo revisado trava analises e quantidades
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', md5('kontrol-0126-coordenador')::uuid::text, true);
select public.transicionar_orcamento(current_setting('ts0126.orc')::bigint, 'enviado', 'revisao TS-0126');

do $$
declare
  v_orc bigint := current_setting('ts0126.orc')::bigint;
begin
  begin
    insert into public.orcamento_itens (orcamento_id, codigo_analise, n_amostras) values (v_orc, 'TS-0126-B', 1);
    raise exception '0126: item incluido em modulo enviado';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.orcamento_itens set n_amostras = 99 where orcamento_id = v_orc;
    raise exception '0126: quantidade alterada em modulo enviado';
  exception when invalid_parameter_value then null;
  end;
  begin
    delete from public.orcamento_itens where orcamento_id = v_orc;
    raise exception '0126: item apagado de modulo enviado';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.salvar_item_orcamento(v_orc, 'TS-0126-A', 1, 5, 8, '{}'::jsonb, '{}'::jsonb);
    raise exception '0126: RPC alterou modulo enviado';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- C. Uma versao viva: emitir v1, enviar, emitir v2 substitui v1 e revoga o link
-- ---------------------------------------------------------------------------
do $$
declare
  v_demanda bigint := current_setting('ts0126.demanda')::bigint;
  v_orc bigint := current_setting('ts0126.orc')::bigint;
  -- ids ficticios: o plano deve ler o codigo do proprio snapshot (ORC2-2)
  v_snapshot jsonb := jsonb_build_object(
    'demanda', jsonb_build_object('id', v_demanda, 'titulo', 'TS-0126 proposta', 'cliente_nome', 'Cliente TS-0126'),
    'orcamentos_analises', jsonb_build_array(jsonb_build_object(
      'id', v_orc,
      'orcamento_itens', jsonb_build_array(
        jsonb_build_object('id', -1, 'codigo_analise', 'TS-0126-A', 'n_amostras', 12),
        jsonb_build_object('id', -2, 'codigo_analise', 'TS-0126-B', 'n_amostras', 2)
      )
    )),
    'orcamentos_projeto', '[]'::jsonb
  );
  v_v1 jsonb;
  v_v2 jsonb;
begin
  v_v1 := public.emitir_orcamento_final_transacional(v_demanda, 30, 1, 2, 0, 0, 100, v_snapshot, null,
    md5('kontrol-0126-coordenador')::uuid, 'ts-0126-coordenador@example.invalid', md5('ts-0126-op-v1')::uuid);
  perform public.transicionar_orcamento_final((v_v1->>'id')::bigint, 'enviado', 'enviado por e-mail');

  -- link da v1, sem modulo de projeto (ORC2-9)
  insert into public.orcamento_projeto_links (orcamento_final_versao_id, token_hash, criado_por)
  values ((v_v1->>'id')::bigint, encode(extensions.digest('ts-0126-token-v1', 'sha256'), 'hex'),
          md5('kontrol-0126-coordenador')::uuid);

  v_v2 := public.emitir_orcamento_final_transacional(v_demanda, 30, 1, 2, 0, 0, 120, v_snapshot, null,
    md5('kontrol-0126-coordenador')::uuid, 'ts-0126-coordenador@example.invalid', md5('ts-0126-op-v2')::uuid);

  if (select status from public.orcamento_final_versoes where id = (v_v1->>'id')::bigint) <> 'substituido' then
    raise exception '0126: v1 enviada nao foi substituida pela v2';
  end if;
  if not (select revogado from public.orcamento_projeto_links where orcamento_final_versao_id = (v_v1->>'id')::bigint) then
    raise exception '0126: link da v1 substituida nao foi revogado';
  end if;

  insert into public.orcamento_projeto_links (orcamento_final_versao_id, token_hash, criado_por)
  values ((v_v2->>'id')::bigint, encode(extensions.digest('ts-0126-token-v2', 'sha256'), 'hex'),
          md5('kontrol-0126-coordenador')::uuid);

  perform set_config('ts0126.v1', v_v1->>'id', true);
  perform set_config('ts0126.v2', v_v2->>'id', true);
end $$;

-- ORC-11: a equipe nao grava a aprovacao do link nem reativa link revogado
do $$
begin
  begin
    update public.orcamento_projeto_links set aprovado_em = now(), aprovado_por = 'forjado'
     where orcamento_final_versao_id = current_setting('ts0126.v2')::bigint;
    raise exception '0126: aprovacao do link gravada direto pela equipe';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orcamento_projeto_links set revogado = false
     where orcamento_final_versao_id = current_setting('ts0126.v1')::bigint;
    raise exception '0126: link revogado reativado';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- D. Cliente aprova pelo link (anon): gera o plano do snapshot
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
do $$
declare
  v_res jsonb;
begin
  v_res := public.aprovar_orcamento_publico('ts-0126-token-v1', 'Cliente');
  if (v_res->>'aprovado')::boolean then
    raise exception '0126: link revogado da v1 aprovou';
  end if;
  v_res := public.aprovar_orcamento_publico('ts-0126-token-v2', 'Cliente Aprovador');
  if not (v_res->>'aprovado')::boolean then
    raise exception '0126: link da v2 nao aprovou: %', v_res;
  end if;
end $$;
reset role;

do $$
declare
  v_v2 bigint := current_setting('ts0126.v2')::bigint;
  v_plano public.planejamento%rowtype;
begin
  select * into v_plano from public.planejamento where orcamento_final_versao_id = v_v2;
  if not found or v_plano.status_operacional <> 'rascunho' then
    raise exception '0126: aprovacao pelo link nao gerou o plano em rascunho';
  end if;
  if (select n_amostras from public.planejamento_itens where planejamento_id = v_plano.id and codigo_analise = 'TS-0126-A') <> 12
     or (select n_amostras from public.planejamento_itens where planejamento_id = v_plano.id and codigo_analise = 'TS-0126-B') <> 2 then
    raise exception '0126: plano nao saiu do snapshot da versao';
  end if;
  if (select status from public.demandas_propostas where id = current_setting('ts0126.demanda')::bigint) <> 'aprovada' then
    raise exception '0126: demanda nao ficou aprovada';
  end if;
  if not exists (select 1 from public.notificacoes where dedupe_key = 'aprovacao_link_' || v_v2) then
    raise exception '0126: coordenador nao foi avisado da aprovacao pelo link';
  end if;
  if (select versao_id from public.v_proposta_aprovada_vigente where demanda_id = current_setting('ts0126.demanda')::bigint) <> v_v2 then
    raise exception '0126: view de proposta vigente nao mostra a v2';
  end if;
  perform set_config('ts0126.plano_v2', v_plano.id::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- E. Com versao aprovada: nao emite, nao duplica, nao aprova outra
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', md5('kontrol-0126-coordenador')::uuid::text, true);
select set_config('request.jwt.claims',
  json_build_object('sub', md5('kontrol-0126-coordenador')::uuid, 'email', 'ts-0126-coordenador@example.invalid',
                    'role', 'authenticated')::text, true);
do $$
declare
  v_demanda bigint := current_setting('ts0126.demanda')::bigint;
begin
  begin
    perform public.emitir_orcamento_final_transacional(v_demanda, 30, 1, 2, 0, 0, 130, '{}'::jsonb, null,
      md5('kontrol-0126-coordenador')::uuid, 'ts-0126-coordenador@example.invalid', md5('ts-0126-op-v3a')::uuid);
    raise exception '0126: emitiu nova versao com proposta aprovada';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.duplicar_orcamento_final_transacional(current_setting('ts0126.v2')::bigint, 30, md5('ts-0126-op-dup')::uuid);
    raise exception '0126: duplicou proposta aprovada';
  exception when invalid_parameter_value then null;
  end;
  -- geracao manual com plano ativo: devolve o existente
  if (public.gerar_planejamento_da_proposta(current_setting('ts0126.v2')::bigint)->>'plano_id')::bigint
     <> current_setting('ts0126.plano_v2')::bigint then
    raise exception '0126: geracao manual nao devolveu o plano existente';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- F. Cancelar a proposta aprovada cancela o plano em rascunho
-- ---------------------------------------------------------------------------
select public.transicionar_orcamento_final(current_setting('ts0126.v2')::bigint, 'cancelado', 'cliente desistiu');
reset role;
do $$
begin
  if (select status_operacional from public.planejamento where id = current_setting('ts0126.plano_v2')::bigint) <> 'cancelado' then
    raise exception '0126: plano em rascunho nao foi cancelado com a proposta';
  end if;
  if (select status from public.demandas_propostas where id = current_setting('ts0126.demanda')::bigint) <> 'orcada' then
    raise exception '0126: demanda nao voltou a orcada';
  end if;
  if exists (select 1 from public.v_proposta_aprovada_vigente where demanda_id = current_setting('ts0126.demanda')::bigint) then
    raise exception '0126: view ainda mostra proposta cancelada';
  end if;
end $$;

-- Nova versao depois do cancelamento: aprovada pela equipe, plano novo
set local role authenticated;
do $$
declare
  v_demanda bigint := current_setting('ts0126.demanda')::bigint;
  v_v3 jsonb;
begin
  v_v3 := public.emitir_orcamento_final_transacional(v_demanda, 30, 1, 2, 0, 0, 140,
    (select snapshot from public.orcamento_final_versoes where id = current_setting('ts0126.v2')::bigint), null,
    md5('kontrol-0126-coordenador')::uuid, 'ts-0126-coordenador@example.invalid', md5('ts-0126-op-v3')::uuid);
  perform public.transicionar_orcamento_final((v_v3->>'id')::bigint, 'aprovado', 'aprovado por e-mail');
  perform set_config('ts0126.v3', v_v3->>'id', true);
end $$;
reset role;

do $$
declare
  v_plano bigint;
begin
  select id into v_plano from public.planejamento
   where orcamento_final_versao_id = current_setting('ts0126.v3')::bigint and status_operacional = 'rascunho';
  if v_plano is null then
    raise exception '0126: versao aprovada depois do cancelamento nao gerou plano';
  end if;
  -- plano em execucao: cancelar a proposta nao mexe no plano e avisa
  perform set_config('app.planejamento_transicao', 'permitida', true);
  update public.planejamento set status_operacional = 'em_execucao' where id = v_plano;
  perform set_config('app.planejamento_transicao', '', true);
  perform set_config('ts0126.plano_v3', v_plano::text, true);
end $$;

set local role authenticated;
select public.transicionar_orcamento_final(current_setting('ts0126.v3')::bigint, 'cancelado', 'cliente desistiu de novo');
reset role;
do $$
begin
  if (select status_operacional from public.planejamento where id = current_setting('ts0126.plano_v3')::bigint) <> 'em_execucao' then
    raise exception '0126: plano em execucao foi alterado pelo cancelamento da proposta';
  end if;
  if not exists (select 1 from public.notificacoes
                  where dedupe_key = 'proposta_cancelada_' || current_setting('ts0126.v3') || '_plano_' || current_setting('ts0126.plano_v3')) then
    raise exception '0126: coordenador nao foi avisado do plano em execucao';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- G. Validade: vencida nao e aprovada; job diario marca vencido
-- ---------------------------------------------------------------------------
do $$
declare
  v_demanda bigint;
  v_versao bigint;
begin
  insert into public.demandas_propostas (titulo, cliente_nome, status)
  values ('TS-0126 vencida', 'Cliente vencido', 'orcada') returning id into v_demanda;
  insert into public.orcamento_final_versoes (demanda_id, versao, numero, status, validade_dias, valido_ate, snapshot)
  values (v_demanda, 1, 'TS-0126-VENC-v1', 'enviado', 10, current_date - 10,
          jsonb_build_object('demanda', jsonb_build_object('id', v_demanda), 'orcamentos_analises', '[]'::jsonb, 'orcamentos_projeto', '[]'::jsonb))
  returning id into v_versao;
  insert into public.orcamento_projeto_links (orcamento_final_versao_id, token_hash)
  values (v_versao, encode(extensions.digest('ts-0126-token-venc', 'sha256'), 'hex'));
  perform set_config('ts0126.vencida', v_versao::text, true);
end $$;

set local role authenticated;
do $$
begin
  perform public.transicionar_orcamento_final(current_setting('ts0126.vencida')::bigint, 'aprovado', 'tarde demais');
  raise exception '0126: proposta vencida aprovada pela equipe';
exception when invalid_parameter_value then null;
end $$;
set local role anon;
do $$
declare
  v_res jsonb := public.aprovar_orcamento_publico('ts-0126-token-venc', 'Cliente');
begin
  if (v_res->>'aprovado')::boolean or v_res->>'motivo' <> 'vencida' then
    raise exception '0126: proposta vencida aprovada pelo link: %', v_res;
  end if;
  if not (public.ler_orcamento_publico('ts-0126-token-venc')->>'vencida')::boolean then
    raise exception '0126: leitura publica nao indica proposta vencida';
  end if;
end $$;
reset role;
do $$
declare
  v_vencidas integer := public.vencer_orcamentos_finais();
begin
  if v_vencidas < 1
     or (select status from public.orcamento_final_versoes where id = current_setting('ts0126.vencida')::bigint) <> 'vencido' then
    raise exception '0126: vencimento diario nao marcou a proposta vencida';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- H. Proposta so de projeto: aprovada sem plano, com aviso
-- ---------------------------------------------------------------------------
do $$
declare
  v_demanda bigint;
  v_versao bigint;
begin
  insert into public.demandas_propostas (titulo, cliente_nome, status)
  values ('TS-0126 projeto', 'Cliente projeto', 'orcada') returning id into v_demanda;
  insert into public.orcamento_final_versoes (demanda_id, versao, numero, status, validade_dias, valido_ate, snapshot)
  values (v_demanda, 1, 'TS-0126-PROJ-v1', 'emitido', 30, current_date + 30,
          jsonb_build_object('demanda', jsonb_build_object('id', v_demanda), 'orcamentos_analises', '[]'::jsonb, 'orcamentos_projeto', '[]'::jsonb))
  returning id into v_versao;
  perform set_config('ts0126.projeto', v_versao::text, true);
end $$;
set local role authenticated;
select public.transicionar_orcamento_final(current_setting('ts0126.projeto')::bigint, 'aprovado', 'ok');
do $$
begin
  if public.gerar_planejamento_da_proposta(current_setting('ts0126.projeto')::bigint)->>'motivo' <> 'sem_analises' then
    raise exception '0126: geracao manual sem analises deveria avisar';
  end if;
end $$;
reset role;
do $$
begin
  if exists (select 1 from public.planejamento where orcamento_final_versao_id = current_setting('ts0126.projeto')::bigint) then
    raise exception '0126: proposta sem analises gerou plano';
  end if;
  if not exists (select 1 from public.notificacoes where dedupe_key = 'plano_sem_analises_' || current_setting('ts0126.projeto')) then
    raise exception '0126: proposta sem analises nao gerou aviso';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- I. ORC-10: um modulo ativo por proposta
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.orcamentos_modulo_ativo_uidx') is null then
    raise notice '0126: indice de modulo ativo nao existe (havia duplicidade); teste ignorado';
    return;
  end if;
  begin
    insert into public.orcamentos (demanda_id, cliente_nome)
    values (current_setting('ts0126.demanda')::bigint, 'duplicado');
    raise exception '0126: segundo modulo laboratorial ativo aceito';
  exception when unique_violation then null;
  end;
end $$;

rollback;
