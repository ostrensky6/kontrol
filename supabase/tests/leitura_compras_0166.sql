-- Executar apenas em banco descartável, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- 0166: leitura de compras pela API segue a caixinha. Cadastro (sem caixinha de
-- compras) não lê pedido, item nem recebimento; Laboratório e Compra leem; um
-- ajuste por pessoa (compras.ver) devolve a leitura. Tudo é revertido no ROLLBACK.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_cad uuid := md5('kontrol-0166-cadastro')::uuid;
  v_lab uuid := md5('kontrol-0166-laboratorio')::uuid;
  v_com uuid := md5('kontrol-0166-compra')::uuid;
  v_insumo bigint;
  v_pedido bigint;
  v_item bigint;
begin
  insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_cad, 'authenticated', 'authenticated', 'ts-0166-cad@example.invalid', now(), now()),
         ('00000000-0000-0000-0000-000000000000', v_lab, 'authenticated', 'authenticated', 'ts-0166-lab@example.invalid', now(), now()),
         ('00000000-0000-0000-0000-000000000000', v_com, 'authenticated', 'authenticated', 'ts-0166-com@example.invalid', now(), now());
  update public.perfis set papel = 'cadastro', suspenso = false, permissoes = '{}'::jsonb where id = v_cad;
  update public.perfis set papel = 'laboratorio', suspenso = false, permissoes = '{}'::jsonb where id = v_lab;
  update public.perfis set papel = 'compra', suspenso = false, permissoes = '{}'::jsonb where id = v_com;

  insert into public.insumos (especificacao, fator_conversao) values ('TS-0166 reagente', 1) returning id into v_insumo;
  insert into public.pedidos_compra (status) values ('solicitado') returning id into v_pedido;
  insert into public.pedidos_compra_itens (pedido_id, insumo_id, quantidade, quantidade_em)
  values (v_pedido, v_insumo, 3, 'embalagem') returning id into v_item;
  perform set_config('ts0166.pedido', v_pedido::text, true);
  perform set_config('ts0166.item', v_item::text, true);
end $$;

create function pg_temp.como(p_nome text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', md5('kontrol-0166-' || p_nome)::uuid::text, true),
         set_config('request.jwt.claims', json_build_object('sub', md5('kontrol-0166-' || p_nome)::uuid,
           'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.como(text) to authenticated;

create function pg_temp.vistos() returns int language sql as $$
  select (select count(*) from public.pedidos_compra where id = current_setting('ts0166.pedido')::bigint)::int
       + (select count(*) from public.pedidos_compra_itens where id = current_setting('ts0166.item')::bigint)::int;
$$;
grant execute on function pg_temp.vistos() to authenticated;

set local role authenticated;

select pg_temp.como('cadastro');
do $$ begin
  if pg_temp.vistos() <> 0 then raise exception '0166: Cadastro leu compra pela API'; end if;
  if (select count(*) from public.pedidos_compra_item_recebimentos) <> 0 then
    raise exception '0166: Cadastro leu recebimento de compra';
  end if;
end $$;

select pg_temp.como('laboratorio');
do $$ begin
  if pg_temp.vistos() <> 2 then raise exception '0166: Laboratório deixou de ler compras'; end if;
end $$;

select pg_temp.como('compra');
do $$ begin
  if pg_temp.vistos() <> 2 then raise exception '0166: Compra deixou de ler compras'; end if;
end $$;

reset role;
-- Ajuste por pessoa continua valendo: Cadastro com "Acessar Compras" volta a ler.
update public.perfis set permissoes = '{"compras.ver": true}'::jsonb where id = md5('kontrol-0166-cadastro')::uuid;
set local role authenticated;
select pg_temp.como('cadastro');
do $$ begin
  if pg_temp.vistos() <> 2 then raise exception '0166: ajuste por pessoa não liberou a leitura (%)', pg_temp.vistos(); end if;
end $$;

reset role;
rollback;
