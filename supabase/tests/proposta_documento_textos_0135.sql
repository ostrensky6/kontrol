-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1
-- (e PGCLIENTENCODING=UTF8, como os testes 0131/0132).
-- Valida a 0135: empresas emissoras e secoes padrao semeadas, com leitura
-- autenticada e escrita por permissao; colunas novas da proposta e da versao;
-- RPC atualizar_textos_versao_final (so versao viva e dentro da validade, com
-- orcamentos.emitir, auditada); link publico devolve versao.textos_proposta.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0135-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0135-' || p_rotulo)::uuid,
                      'email', 'ts-0135-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated',
                      'app_metadata', json_build_object('senha_provisoria', false))::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Estrutura, seeds e privilegios
-- ---------------------------------------------------------------------------
do $$
declare
  v_coluna record;
begin
  if (select count(*) from public.empresas_emissoras where codigo in ('ATGC', 'GIA')) <> 2 then
    raise exception '0135: empresas ATGC e GIA nao semeadas';
  end if;
  if not exists (select 1 from public.empresas_emissoras
                 where codigo = 'ATGC' and nome_legal like 'ATGC Gen%tica Ambiental Ltda.')
     or not exists (select 1 from public.empresas_emissoras
                    where codigo = 'GIA' and nome_legal = 'Grupo Integrado de Aquicultura e Estudos Ambientais') then
    raise exception '0135: nome legal das empresas diferente da identidade institucional';
  end if;

  if (select count(*) from public.proposta_secoes_padrao
      where empresa_codigo in ('ATGC', 'GIA')
        and chave in ('prazos', 'responsabilidades', 'condicoes', 'confidencialidade')
        and ativo) <> 8 then
    raise exception '0135: as 8 secoes padrao (4 por empresa) nao foram semeadas';
  end if;
  if exists (
    select 1 from public.proposta_secoes_padrao s
    where s.empresa_codigo in ('ATGC', 'GIA')
      and s.chave in ('prazos', 'responsabilidades', 'condicoes', 'confidencialidade')
      and (s.texto->>'type' <> 'doc'
           or jsonb_typeof(s.texto->'content') <> 'array'
           or jsonb_array_length(s.texto->'content') = 0
           or s.ordem <> case s.chave when 'prazos' then 10 when 'responsabilidades' then 20
                                      when 'condicoes' then 30 else 40 end)
  ) then
    raise exception '0135: secao padrao sem texto formatado ou fora de ordem';
  end if;
  if not exists (select 1 from public.proposta_secoes_padrao
                 where empresa_codigo = 'ATGC' and chave = 'condicoes'
                   and texto::text like '%Pagamento: 50%') then
    raise exception '0135: condicoes comerciais sem a regra de pagamento padrao';
  end if;

  for v_coluna in
    select * from (values
      ('demandas_propostas', 'cliente_email', 'text'),
      ('demandas_propostas', 'cliente_telefone', 'text'),
      ('demandas_propostas', 'cliente_endereco', 'text'),
      ('demandas_propostas', 'textos_proposta', 'jsonb'),
      ('orcamento_final_versoes', 'textos_proposta', 'jsonb')
    ) as t(tabela, coluna, tipo)
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_coluna.tabela
        and column_name = v_coluna.coluna and data_type = v_coluna.tipo and is_nullable = 'YES'
    ) then
      raise exception '0135: coluna %.% (%) ausente', v_coluna.tabela, v_coluna.coluna, v_coluna.tipo;
    end if;
  end loop;

  if not (select relrowsecurity from pg_class where oid = 'public.empresas_emissoras'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.proposta_secoes_padrao'::regclass) then
    raise exception '0135: RLS desligada nas tabelas novas';
  end if;
  if has_table_privilege('anon', 'public.empresas_emissoras', 'SELECT')
     or has_table_privilege('anon', 'public.proposta_secoes_padrao', 'SELECT') then
    raise exception '0135: anon le as tabelas novas';
  end if;
  if (select count(*) from pg_trigger
      where tgname in ('aud_empresas_emissoras', 'aud_proposta_secoes_padrao') and not tgisinternal) <> 2 then
    raise exception '0135: gatilhos de auditoria ausentes nas tabelas novas';
  end if;

  if has_function_privilege('anon', 'public.atualizar_textos_versao_final(bigint, jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.atualizar_textos_versao_final(bigint, jsonb)', 'EXECUTE') then
    raise exception '0135: grants do RPC atualizar_textos_versao_final incorretos';
  end if;
  if has_function_privilege('anon', 'public.ler_orcamento_publico(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ler_orcamento_publico(text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.ler_orcamento_publico(text)', 'EXECUTE') then
    raise exception '0135: grants de ler_orcamento_publico diferentes da 0132';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures (nao dependem do seed de dados: o CI cria o banco vazio)
-- ---------------------------------------------------------------------------
do $$
declare
  v_rotulo text;
  v_demanda bigint;
  v_aprovada bigint;
  v_emitida bigint;
  v_vencida bigint;
  v_snapshot jsonb;
begin
  foreach v_rotulo in array array['coordenador', 'tecnico'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0135-' || v_rotulo)::uuid,
            'authenticated', 'authenticated', 'ts-0135-' || v_rotulo || '@example.invalid', now(), now());
  end loop;
  -- padrao das categorias: coordenador tem orcamentos.emitir e cadastros.editar; tecnico nao
  update public.perfis set papel = 'coordenador', suspenso = false, senha_provisoria = false, permissoes = '{}'::jsonb
   where id = md5('kontrol-0135-coordenador')::uuid;
  update public.perfis set papel = 'tecnico', suspenso = false, senha_provisoria = false, permissoes = '{}'::jsonb
   where id = md5('kontrol-0135-tecnico')::uuid;

  insert into public.demandas_propostas (titulo, cliente_nome, status, cliente_email, cliente_telefone, cliente_endereco)
  values ('TS-0135 proposta', 'Cliente TS-0135', 'orcada', 'cliente@example.invalid', '(41) 3333-0000', 'Rua TS, 135')
  returning id into v_demanda;

  v_snapshot := jsonb_build_object('demanda', jsonb_build_object('id', v_demanda),
                                   'orcamentos_analises', '[]'::jsonb, 'orcamentos_projeto', '[]'::jsonb);
  insert into public.orcamento_final_versoes (demanda_id, versao, numero, status, validade_dias, valido_ate, snapshot)
  values (v_demanda, 1, 'TS-0135-v1', 'aprovado', 30, current_date + 30, v_snapshot)
  returning id into v_aprovada;
  insert into public.orcamento_final_versoes (demanda_id, versao, numero, status, validade_dias, valido_ate, snapshot)
  values (v_demanda, 2, 'TS-0135-v2', 'emitido', 30, current_date + 30, v_snapshot)
  returning id into v_emitida;
  insert into public.orcamento_final_versoes (demanda_id, versao, numero, status, validade_dias, valido_ate, snapshot)
  values (v_demanda, 3, 'TS-0135-v3', 'enviado', 10, current_date - 1, v_snapshot)
  returning id into v_vencida;

  insert into public.orcamento_projeto_links (orcamento_final_versao_id, token_hash)
  values (v_emitida, encode(extensions.digest('ts-0135-token-v2', 'sha256'), 'hex'));

  perform set_config('ts0135.aprovada', v_aprovada::text, true);
  perform set_config('ts0135.emitida', v_emitida::text, true);
  perform set_config('ts0135.vencida', v_vencida::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- 2. RPC: recusas (coordenador, com orcamentos.emitir)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.como('coordenador');

do $$
declare
  v_textos jsonb := '{"descricao": {"type": "doc", "content": []}, "secoes": []}'::jsonb;
begin
  begin
    perform public.atualizar_textos_versao_final(current_setting('ts0135.aprovada')::bigint, v_textos);
    raise exception '0135: RPC editou textos de versao aprovada';
  exception when invalid_parameter_value then
    if sqlerrm not like '%aprovada%' then
      raise exception '0135: mensagem inesperada para versao aprovada: %', sqlerrm;
    end if;
  end;

  begin
    perform public.atualizar_textos_versao_final(current_setting('ts0135.vencida')::bigint, v_textos);
    raise exception '0135: RPC editou textos de versao vencida';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.atualizar_textos_versao_final(current_setting('ts0135.emitida')::bigint, '[]'::jsonb);
    raise exception '0135: RPC aceitou textos que nao sao objeto';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.atualizar_textos_versao_final(current_setting('ts0135.emitida')::bigint,
      jsonb_build_object('descricao', repeat('x', 200001)));
    raise exception '0135: RPC aceitou textos acima do limite';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.atualizar_textos_versao_final(-1, v_textos);
    raise exception '0135: RPC aceitou versao inexistente';
  exception when no_data_found then null;
  end;

  if (select textos_proposta from public.orcamento_final_versoes
      where id = current_setting('ts0135.aprovada')::bigint) is not null then
    raise exception '0135: versao aprovada ficou com textos gravados';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. RPC: aceita versao emitida dentro da validade; escrita direta bloqueada
-- ---------------------------------------------------------------------------
do $$
declare
  v_textos jsonb := '{"descricao": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "TS-0135 texto editado"}]}]}, "secoes": []}'::jsonb;
  v_resultado jsonb;
  v_linhas integer;
begin
  v_resultado := public.atualizar_textos_versao_final(current_setting('ts0135.emitida')::bigint, v_textos);
  if (v_resultado->>'id')::bigint <> current_setting('ts0135.emitida')::bigint
     or v_resultado->>'status' <> 'emitido' then
    raise exception '0135: retorno inesperado do RPC: %', v_resultado;
  end if;
  if (select textos_proposta from public.orcamento_final_versoes
      where id = current_setting('ts0135.emitida')::bigint) is distinct from v_textos then
    raise exception '0135: textos nao gravados na versao emitida';
  end if;
  if (select status from public.orcamento_final_versoes
      where id = current_setting('ts0135.emitida')::bigint) <> 'emitido' then
    raise exception '0135: RPC mudou o status da versao';
  end if;

  begin
    update public.orcamento_final_versoes set textos_proposta = '{}'::jsonb
     where id = current_setting('ts0135.emitida')::bigint;
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception '0135: usuario gravou textos direto na versao, sem o RPC';
    end if;
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Escrita nas tabelas novas pelo coordenador (tem as permissoes)
-- ---------------------------------------------------------------------------
do $$
declare
  v_linhas integer;
begin
  update public.empresas_emissoras set cnpj = '00.000.000/0001-35', atualizado_em = now() where codigo = 'ATGC';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception '0135: coordenador (cadastros.editar) nao editou a empresa emissora';
  end if;

  update public.proposta_secoes_padrao
     set titulo = 'Prazos e entregas (TS-0135)', atualizado_em = now()
   where empresa_codigo = 'GIA' and chave = 'prazos';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception '0135: coordenador (orcamentos.emitir) nao editou a secao padrao';
  end if;

  insert into public.proposta_secoes_padrao (empresa_codigo, chave, titulo, ordem)
  values ('ATGC', 'ts_0135', 'Secao TS-0135', 50);

  begin
    insert into public.proposta_secoes_padrao (empresa_codigo, chave, titulo)
    values ('ATGC', 'Chave Invalida', 'Secao invalida');
    raise exception '0135: chave de secao fora do formato aceita';
  exception when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Tecnico (sem orcamentos.emitir nem cadastros.editar): le, nao escreve
-- ---------------------------------------------------------------------------
select pg_temp.como('tecnico');

do $$
declare
  v_linhas integer;
begin
  if (select count(*) from public.empresas_emissoras) < 2
     or (select count(*) from public.proposta_secoes_padrao where empresa_codigo in ('ATGC', 'GIA')) < 8 then
    raise exception '0135: usuario autenticado nao le empresas e secoes padrao';
  end if;

  begin
    perform public.atualizar_textos_versao_final(current_setting('ts0135.emitida')::bigint, '{}'::jsonb);
    raise exception '0135: tecnico sem orcamentos.emitir editou textos da versao';
  exception when insufficient_privilege then null;
  end;

  update public.empresas_emissoras set site = 'https://ts-0135.invalid' where codigo = 'GIA';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then
    raise exception '0135: tecnico sem cadastros.editar editou empresa emissora';
  end if;

  update public.proposta_secoes_padrao set ativo = false where empresa_codigo = 'ATGC';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then
    raise exception '0135: tecnico sem orcamentos.emitir editou secao padrao';
  end if;

  begin
    insert into public.proposta_secoes_padrao (empresa_codigo, chave, titulo)
    values ('GIA', 'ts_0135_tecnico', 'Secao do tecnico');
    raise exception '0135: tecnico sem orcamentos.emitir criou secao padrao';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- 6. Auditoria e link publico
-- ---------------------------------------------------------------------------
do $$
declare
  v_payload jsonb;
begin
  if not exists (
    select 1 from public.auditoria
    where tabela = 'orcamento_final_versoes' and acao = 'update'
      and registro_id = current_setting('ts0135.emitida')
      and valor_anterior->'textos_proposta' = 'null'::jsonb
      and jsonb_typeof(valor_novo->'textos_proposta') = 'object'
      and usuario = 'ts-0135-coordenador@example.invalid'
  ) then
    raise exception '0135: edicao dos textos da versao nao ficou na auditoria';
  end if;
  if not exists (select 1 from public.auditoria where tabela = 'empresas_emissoras' and acao = 'update')
     or not exists (select 1 from public.auditoria where tabela = 'proposta_secoes_padrao' and acao = 'insert'
                    and valor_novo->>'chave' = 'ts_0135') then
    raise exception '0135: tabelas novas sem auditoria';
  end if;

  v_payload := public.ler_orcamento_publico('ts-0135-token-v2');
  if v_payload is null then
    raise exception '0135: link publico da versao emitida nao encontrado';
  end if;
  if v_payload #>> '{versao,textos_proposta,descricao,content,0,content,0,text}' is distinct from 'TS-0135 texto editado' then
    raise exception '0135: link publico nao devolve versao.textos_proposta: %', v_payload->'versao';
  end if;
  if (v_payload->'versao'->>'id')::bigint <> current_setting('ts0135.emitida')::bigint
     or v_payload->'versao'->>'numero' <> 'TS-0135-v2'
     or v_payload->'snapshot' is null
     or v_payload->>'vencida' <> 'false' then
    raise exception '0135: payload do link publico mudou alem de textos_proposta: %', v_payload;
  end if;
end $$;

select '0135 ok' as resultado;

rollback;
