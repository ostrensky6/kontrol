-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1
-- e PGCLIENTENCODING=UTF8.
-- Valida a 0142: anexos de orcamento e de pedido interno no Storage seguem as permissoes,
-- e a proposta aprovada cancelada devolve o modulo de projeto para "enviado", de modo que
-- a nova versao pode ser aprovada pelo link. Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
-- O Storage recusa DELETE direto em SQL (a API faz o mesmo DELETE sob as mesmas policies).
set local storage.allow_delete_query = 'true';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0142-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0142-' || p_rotulo)::uuid,
                      'email', 'ts-0142-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated',
                      'app_metadata', json_build_object('senha_provisoria', false))::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns text language sql as $$
  select md5('kontrol-0142-' || p_rotulo)::uuid::text
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: usuarios, arquivos e uma proposta aprovada com modulo de projeto
-- ---------------------------------------------------------------------------
do $$
declare
  v_rotulo text;
  v_demanda bigint;
  v_projeto bigint;
  v_versao bigint;
begin
  foreach v_rotulo in array array['coord', 'leitor', 'sem', 'pedinte', 'outro'] loop
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0142-' || v_rotulo)::uuid,
            'authenticated', 'authenticated', 'ts-0142-' || v_rotulo || '@example.invalid', now(), now());
  end loop;
  update public.perfis set papel = 'coordenador', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": true, "orcamentos.emitir": true, "orcamentos.cancelar": true, "pedido.ver": true, "pedido.criar": true, "pedido.aprovar": true}'::jsonb
   where id = md5('kontrol-0142-coord')::uuid;
  update public.perfis set papel = 'tecnico', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": true, "orcamentos.criar_editar": false, "pedido.ver": true, "pedido.criar": false, "pedido.aprovar": false}'::jsonb
   where id = md5('kontrol-0142-leitor')::uuid;
  update public.perfis set papel = 'tecnico', suspenso = false, senha_provisoria = false,
         permissoes = '{"orcamentos.visualizar": false, "orcamentos.criar_editar": false, "pedido.ver": false, "pedido.criar": false, "pedido.aprovar": false}'::jsonb
   where id = md5('kontrol-0142-sem')::uuid;
  foreach v_rotulo in array array['pedinte', 'outro'] loop
    update public.perfis set papel = 'tecnico', suspenso = false, senha_provisoria = false,
           permissoes = '{"pedido.ver": true, "pedido.criar": true, "pedido.aprovar": false}'::jsonb
     where id = md5('kontrol-0142-' || v_rotulo)::uuid;
  end loop;

  insert into storage.objects (bucket_id, name, owner_id)
  values ('orcamento-anexos', 'ts-0142/orc.pdf', pg_temp.uid('coord')),
         ('pedidos-internos-anexos', 'ts-0142/do-pedinte.pdf', pg_temp.uid('pedinte')),
         ('pedidos-internos-anexos', 'ts-0142/do-outro.pdf', pg_temp.uid('outro'));

  insert into public.demandas_propostas (titulo, cliente_nome, status, modalidade)
  values ('TS-0142 proposta', 'Cliente TS-0142', 'aprovada', 'projeto')
  returning id into v_demanda;
  insert into public.orcamento_projetos (demanda_id, titulo) values (v_demanda, 'TS-0142 projeto')
  returning id into v_projeto;
  insert into public.orcamento_final_versoes (demanda_id, versao, numero, status, validade_dias, valido_ate, snapshot)
  values (v_demanda, 1, 'TS-0142-v1', 'aprovado', 30, current_date + 30, '{}'::jsonb)
  returning id into v_versao;
  perform set_config('app.orcamento_projeto_transicao', 'permitida', true);
  update public.orcamento_projetos set status = 'aprovado' where id = v_projeto;
  perform set_config('app.orcamento_projeto_transicao', '', true);

  perform set_config('ts0142.demanda', v_demanda::text, true);
  perform set_config('ts0142.projeto', v_projeto::text, true);
  perform set_config('ts0142.v1', v_versao::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Anexos de orcamento
-- ---------------------------------------------------------------------------
set local role authenticated;

select pg_temp.como('sem');
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'orcamento-anexos' and name like 'ts-0142/%') then
    raise exception '0142: sem orcamentos.visualizar enxerga anexo de orcamento';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'pedidos-internos-anexos' and name like 'ts-0142/%') then
    raise exception '0142: sem pedido.ver enxerga anexo de pedido';
  end if;
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('orcamento-anexos', 'ts-0142/intruso.pdf', pg_temp.uid('sem'));
    raise exception '0142: sem permissao gravou anexo de orcamento';
  exception when insufficient_privilege then null;
  end;
end $$;

select pg_temp.como('leitor');
do $$
declare
  v_n integer;
begin
  if not exists (select 1 from storage.objects where bucket_id = 'orcamento-anexos' and name = 'ts-0142/orc.pdf') then
    raise exception '0142: quem ve orcamentos nao le o anexo';
  end if;
  delete from storage.objects where bucket_id = 'orcamento-anexos' and name = 'ts-0142/orc.pdf';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception '0142: so leitura apagou anexo de orcamento'; end if;
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('orcamento-anexos', 'ts-0142/leitor.pdf', pg_temp.uid('leitor'));
    raise exception '0142: so leitura gravou anexo de orcamento';
  exception when insufficient_privilege then null;
  end;
end $$;

select pg_temp.como('coord');
do $$
declare
  v_n integer;
begin
  insert into storage.objects (bucket_id, name, owner_id) values ('orcamento-anexos', 'ts-0142/novo.pdf', pg_temp.uid('coord'));
  delete from storage.objects where bucket_id = 'orcamento-anexos' and name = 'ts-0142/orc.pdf';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception '0142: quem edita orcamentos nao apagou o anexo'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Anexos de pedido interno: apaga o proprio; o dos outros so quem aprova
-- ---------------------------------------------------------------------------
select pg_temp.como('pedinte');
do $$
declare
  v_n integer;
begin
  delete from storage.objects where bucket_id = 'pedidos-internos-anexos' and name = 'ts-0142/do-outro.pdf';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception '0142: apagou anexo de pedido de outra pessoa'; end if;
  delete from storage.objects where bucket_id = 'pedidos-internos-anexos' and name = 'ts-0142/do-pedinte.pdf';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception '0142: nao apagou o proprio anexo de pedido'; end if;
end $$;

select pg_temp.como('coord');
do $$
declare
  v_n integer;
begin
  delete from storage.objects where bucket_id = 'pedidos-internos-anexos' and name = 'ts-0142/do-outro.pdf';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception '0142: quem aprova pedidos nao apagou o anexo'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Proposta aprovada cancelada: modulo volta para enviado; nova versao aprovavel
-- ---------------------------------------------------------------------------
do $$
declare
  v_status text;
begin
  perform public.transicionar_orcamento_final(current_setting('ts0142.v1')::bigint, 'cancelado', 'Cliente desistiu desta versao');
  select status into v_status from public.orcamento_projetos where id = current_setting('ts0142.projeto')::bigint;
  if v_status <> 'enviado' then
    raise exception '0142: modulo ficou % depois de cancelar a proposta aprovada', v_status;
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

do $$
declare
  v_v2 bigint;
  v_ret jsonb;
begin
  insert into public.orcamento_final_versoes (demanda_id, versao, numero, status, validade_dias, valido_ate, snapshot)
  values (current_setting('ts0142.demanda')::bigint, 2, 'TS-0142-v2', 'enviado', 30, current_date + 30, '{}'::jsonb)
  returning id into v_v2;
  insert into public.orcamento_projeto_links (orcamento_projeto_id, orcamento_final_versao_id, token_hash)
  values (current_setting('ts0142.projeto')::bigint, v_v2, encode(extensions.digest('ts-0142-token', 'sha256'), 'hex'));

  v_ret := public.aprovar_orcamento_publico('ts-0142-token', 'Cliente TS-0142');
  if not coalesce((v_ret->>'aprovado')::boolean, false) then
    raise exception '0142: nova versao nao foi aprovada pelo link depois do cancelamento: %', v_ret;
  end if;
  if (select status from public.orcamento_projetos where id = current_setting('ts0142.projeto')::bigint) <> 'aprovado' then
    raise exception '0142: aprovacao pelo link nao marcou o modulo como aprovado';
  end if;
end $$;

rollback;
