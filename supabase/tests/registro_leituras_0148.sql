-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0148: entrada, saida e desfazer por leitura nao entram por gravacao
-- direta em scan_eventos; a gravacao direta leva o usuario e a hora reais; o
-- fluxo normal (abrir e desfazer pelo Kontrol) continua funcionando; e as
-- tabelas que a exclusao em cascata apaga entram na auditoria.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0148-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0148-' || p_rotulo)::uuid,
                      'email', 'ts-0148-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

do $$
declare
  v_rotulo text;
  v_a bigint;
  v_lote bigint;
begin
  foreach v_rotulo in array array['lab', 'outro'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0148-' || v_rotulo)::uuid,
            'authenticated', 'authenticated', 'ts-0148-' || v_rotulo || '@example.invalid', now(), now());
    update public.perfis set papel = 'laboratorio', suspenso = false, permissoes = '{}'::jsonb
    where id = md5('kontrol-0148-' || v_rotulo)::uuid;
  end loop;

  insert into public.insumos (especificacao, unidade, unidade_consumo, quantidade_embalagem, fator_conversao,
                              custo_total_embalagem, custo_unitario)
  values ('TS-0148 Tampao', 'mL', 'µL', 100, 1000, 300, 3) returning id into v_a;
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status, validade,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot, unidade_consumo_snapshot, fator_conversao_snapshot)
  values (v_a, 'TS-0148-L1', 2, 1, 'aceito', current_date + 100, 'EMBALAGEM_FECHADA', 'mL', 100, 'µL', 1000)
  returning id into v_lote;
  insert into public.identificadores (codigo, codigo_normalizado, formato, entidade_tipo, entidade_id, origem)
  values ('TS0148CODIGO', 'TS0148CODIGO', 'codigo_barras', 'insumo', v_a, 'fabricante');

  perform set_config('t0148.a', v_a::text, true);
  perform set_config('t0148.lote', v_lote::text, true);
end $$;

set local role authenticated;
select pg_temp.como('lab');

-- ---- 1. Leitura de movimento inventada nao entra -------------------------------
do $$
declare
  v_acao text;
  v_op uuid := gen_random_uuid();
begin
  foreach v_acao in array array['saida_leitura', 'entrada_leitura', 'entrada_pedido_leitura', 'desfazer_leitura'] loop
    begin
      insert into public.scan_eventos (codigo, entidade_tipo, entidade_id, acao, resultado, contexto)
      values ('TS0148CODIGO', 'insumo', current_setting('t0148.a')::bigint, v_acao, 'encontrado',
              jsonb_build_object('operacao_id', v_op, 'lote_id', current_setting('t0148.lote')::bigint));
      raise exception '0148: gravacao direta de % deveria ser recusada', v_acao;
    exception when insufficient_privilege then null;
    end;
  end loop;

  -- e o desfazer nao acha nada para somar ao lote
  begin
    perform public.desfazer_leitura_estoque(v_op);
    raise exception '0148: desfazer de leitura inventada deveria falhar';
  exception when no_data_found then null;
  end;
  if (select quantidade_atual from public.lotes_estoque where id = current_setting('t0148.lote')::bigint) <> 1 then
    raise exception '0148: o lote nao deveria mudar com leitura inventada';
  end if;
end $$;

-- ---- 2. Leitura simples entra com o usuario e a hora reais --------------------------
do $$
declare
  v_ev public.scan_eventos%rowtype;
begin
  insert into public.scan_eventos (codigo, acao, resultado, usuario_id, criado_em)
  values ('TS0148-BUSCA', 'buscar', 'nao_encontrado', md5('kontrol-0148-outro')::uuid, now() - interval '3 hours');
  select * into v_ev from public.scan_eventos where codigo = 'TS0148-BUSCA';
  if v_ev.usuario_id is distinct from md5('kontrol-0148-lab')::uuid then
    raise exception '0148: a leitura direta deveria gravar quem leu de verdade (gravou %)', v_ev.usuario_id;
  end if;
  if v_ev.criado_em < now() - interval '1 minute' then
    raise exception '0148: a leitura direta deveria gravar a hora real (gravou %)', v_ev.criado_em;
  end if;
end $$;

-- ---- 3. Fluxo normal: abrir e desfazer pelo Kontrol -----------------------------
do $$
declare
  v_op uuid := gen_random_uuid();
  r jsonb;
begin
  r := public.abrir_embalagem_por_leitura(current_setting('t0148.a')::bigint, 'TS0148CODIGO', v_op);
  if (select quantidade_atual from public.lotes_estoque where id = current_setting('t0148.lote')::bigint) <> 0 then
    raise exception '0148: a saida pelo Kontrol deveria baixar o frasco (obtido %)', r;
  end if;
  if (select usuario_id from public.scan_eventos
       where acao = 'saida_leitura' and contexto->>'operacao_id' = v_op::text) is distinct from md5('kontrol-0148-lab')::uuid then
    raise exception '0148: a saida pelo Kontrol deveria registrar quem leu';
  end if;
  perform public.desfazer_leitura_estoque(v_op);
  if (select quantidade_atual from public.lotes_estoque where id = current_setting('t0148.lote')::bigint) <> 1 then
    raise exception '0148: desfazer pelo Kontrol deveria devolver o frasco';
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

-- ---- 4. Auditoria do que a cascata apaga -------------------------------------------
do $$
declare
  v_tabela text;
  v_id bigint;
begin
  foreach v_tabela in array array['inventario_contagens', 'planejamento_lote_conferencias', 'scan_eventos'] loop
    if not exists (select 1 from pg_trigger
                    where tgrelid = format('public.%I', v_tabela)::regclass and tgname = 'aud_' || v_tabela) then
      raise exception '0148: % deveria ter gatilho de auditoria', v_tabela;
    end if;
  end loop;

  select id into v_id from public.scan_eventos where codigo = 'TS0148-BUSCA';
  delete from public.scan_eventos where id = v_id;
  if not exists (select 1 from public.auditoria
                  where tabela = 'scan_eventos' and acao = 'delete' and registro_id = v_id::text) then
    raise exception '0148: leitura apagada deveria ficar na auditoria';
  end if;
  if exists (select 1 from public.auditoria
              where tabela = 'scan_eventos' and acao = 'insert' and valor_novo->>'codigo' = 'TS0148-BUSCA') then
    raise exception '0148: cada leitura nova nao deveria duplicar na auditoria';
  end if;
end $$;

rollback;
