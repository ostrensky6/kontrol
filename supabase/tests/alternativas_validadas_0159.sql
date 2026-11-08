-- SOMENTE clone sintético local. Valida a 0159: validação de alternativas de
-- insumo (grupo de escolha), papéis, histórico e proteção da situação.
-- Termina em ROLLBACK.
\if :{?kontrol_test_local}
\else
  \echo '0159: falta acknowledgement explícito de banco descartável local.'
  \quit 3
\endif
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $$
begin
  if inet_server_addr() is not null
     and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception '0159: conexão não local.';
  end if;
end $$;

do $$
declare
  v_lab uuid := md5('kontrol-0159-lab')::uuid;
  v_compra uuid := md5('kontrol-0159-compra')::uuid;
  v_a bigint; v_b bigint; v_sem bigint;
  r record;
begin
  insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at) values
    ('00000000-0000-0000-0000-000000000000', v_lab, 'authenticated', 'authenticated', 'ts-0159-lab@example.invalid', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_compra, 'authenticated', 'authenticated', 'ts-0159-compra@example.invalid', now(), now());
  update public.perfis set papel = 'laboratorio', suspenso = false, senha_provisoria = false where id = v_lab;
  update public.perfis set papel = 'compra', suspenso = false, senha_provisoria = false where id = v_compra;

  insert into public.analises (codigo, nome) values ('TS-0159-AN', 'Analise TS-0159');
  insert into public.insumo_analise(codigo_analise, nome_etapa, nome_atividade, especificacao_insumo, grupo_escolha, quantidade_por_amostra, modo_cobranca)
  values ('TS-0159-AN', 'Extração', 'Extrair', 'Kit A', 'kit', 1, 'por_amostra') returning id into v_a;
  insert into public.insumo_analise(codigo_analise, nome_etapa, nome_atividade, especificacao_insumo, grupo_escolha, quantidade_por_amostra, modo_cobranca)
  values ('TS-0159-AN', 'Extração', 'Extrair', 'Kit B', 'kit', 1, 'por_amostra') returning id into v_b;
  insert into public.insumo_analise(codigo_analise, nome_etapa, nome_atividade, especificacao_insumo, grupo_escolha, quantidade_por_amostra, modo_cobranca)
  values ('TS-0159-AN', 'Extração', 'Extrair', 'Tampão', null, 2, 'por_amostra') returning id into v_sem;

  -- Inserir já com situação não vale: começa sem avaliação.
  insert into public.insumo_analise(codigo_analise, nome_etapa, nome_atividade, especificacao_insumo, grupo_escolha, alternativa_situacao)
  values ('TS-0159-AN', 'Extração', 'Extrair', 'Kit C', 'kit', 'invalida') returning alternativa_situacao into r;
  if r.alternativa_situacao is not null then raise exception '0159: inserção gravou situação'; end if;
  delete from public.insumo_analise where codigo_analise = 'TS-0159-AN' and especificacao_insumo = 'Kit C';

  -- Compra não valida.
  perform set_config('request.jwt.claim.sub', v_compra::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_compra, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.validar_alternativa_insumo(v_a, 'invalida', 'sem permissão');
    raise exception '0159: compra validou alternativa';
  exception when insufficient_privilege then null;
  end;
  -- Ninguém escreve no histórico direto.
  begin
    insert into public.insumo_analise_validacoes(insumo_analise_id, codigo_analise, grupo_escolha, decisao, observacao, papel)
    values (v_a, 'TS-0159-AN', 'kit', 'valida', 'x', 'compra');
    raise exception '0159: histórico aceitou inserção direta';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- Laboratório invalida o Kit A.
  perform set_config('request.jwt.claim.sub', v_lab::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lab, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.validar_alternativa_insumo(v_a, 'invalida', 'Kit A não amplifica nossas amostras');
  -- Não deixa o grupo sem alternativa.
  begin
    perform public.validar_alternativa_insumo(v_b, 'invalida', 'tentar zerar o grupo');
    raise exception '0159: grupo ficou sem alternativa';
  exception when check_violation then null;
  end;
  -- Linha sem grupo não é validada.
  begin
    perform public.validar_alternativa_insumo(v_sem, 'valida', 'sem grupo');
    raise exception '0159: linha sem grupo foi validada';
  exception when invalid_parameter_value then null;
  end;
  perform public.validar_alternativa_insumo(v_b, 'valida', 'Kit B confere');
  reset role;

  select * into r from public.insumo_analise where id = v_a;
  if r.alternativa_situacao is distinct from 'invalida' or r.alternativa_validada_por <> v_lab
     or r.alternativa_observacao <> 'Kit A não amplifica nossas amostras' then
    raise exception '0159: situação do Kit A errada: %', row_to_json(r);
  end if;
  if (select count(*) from public.insumo_analise_validacoes where codigo_analise = 'TS-0159-AN') <> 2 then
    raise exception '0159: histórico deveria ter 2 registros';
  end if;
  if (select papel from public.insumo_analise_validacoes where insumo_analise_id = v_a) <> 'laboratorio' then
    raise exception '0159: papel não registrado';
  end if;

  -- Update comum não mexe na situação; trocar o insumo zera.
  update public.insumo_analise set alternativa_situacao = 'valida', quantidade_por_amostra = 3 where id = v_a;
  if (select alternativa_situacao from public.insumo_analise where id = v_a) is distinct from 'invalida' then
    raise exception '0159: update direto mudou a situação';
  end if;
  update public.insumo_analise set especificacao_insumo = 'Kit A2' where id = v_a;
  if (select alternativa_situacao from public.insumo_analise where id = v_a) is not null then
    raise exception '0159: trocar o insumo deveria zerar a avaliação';
  end if;

  if not exists (select 1 from public.auditoria a where a.tabela = 'insumo_analise_validacoes') then
    raise exception '0159: validação sem auditoria';
  end if;
end $$;

rollback;
