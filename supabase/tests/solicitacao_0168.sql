-- Executar apenas em banco descartável, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- 0168: campos novos da solicitação (natureza, objetivo, características,
-- exigência técnica, exclusividade, outros fornecedores) e sinônimos do
-- insumo. Valores válidos gravam, inválidos são recusados, pedidos antigos
-- ficam vazios. Tudo é revertido no ROLLBACK.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_pedido bigint;
  v_item bigint;
  v_insumo bigint;
  v_ok boolean;
begin
  insert into public.pedidos_internos (titulo, solicitante) values ('TS-0168 antigo', 'ts-0168@example.invalid')
  returning id into v_pedido;
  if (select natureza is not null or objetivo is not null from public.pedidos_internos where id = v_pedido) then
    raise exception '0168: pedido sem natureza/objetivo deveria ficar vazio';
  end if;

  update public.pedidos_internos set natureza = 'diaria', objetivo = 'campo' where id = v_pedido;

  insert into public.pedidos_internos_itens (pedido_interno_id, especificacao, quantidade, unidade,
    caracteristicas, exigencia_tecnica, exclusividade, outros_fornecedores)
  values (v_pedido, 'Ponteira 200 uL', 10, 'rack', 'baixa retenção; livre de DNA e RNA; estéril',
    'Protocolo POP-12 exige a marca X', null, 'Kasvi; Labcompany')
  returning id into v_item;
  if (select exigencia_tecnica is null or exclusividade is not null from public.pedidos_internos_itens where id = v_item) then
    raise exception '0168: exigência técnica e exclusividade devem ficar separadas';
  end if;

  v_ok := false;
  begin
    update public.pedidos_internos set natureza = 'inventada' where id = v_pedido;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception '0168: natureza fora da lista foi aceita'; end if;

  v_ok := false;
  begin
    update public.pedidos_internos set objetivo = 'qualquer' where id = v_pedido;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception '0168: objetivo fora da lista foi aceito'; end if;

  v_ok := false;
  begin
    update public.pedidos_internos_itens set caracteristicas = repeat('x', 2001) where id = v_item;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception '0168: características acima de 2000 caracteres foram aceitas'; end if;

  insert into public.insumos (especificacao, fator_conversao, sinonimos)
  values ('TS-0168 ponteira', 1, 'low binding; baixa retenção') returning id into v_insumo;
  if (select sinonimos from public.insumos where id = v_insumo) <> 'low binding; baixa retenção' then
    raise exception '0168: sinônimos não gravaram';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'equipamento_unidades' and column_name = 'patrimonio_de') then
    raise exception '0168: equipamento_unidades.patrimonio_de não existe';
  end if;

  -- trilha: a auditoria grava a linha inteira, inclusive os campos novos
  if not exists (
    select 1 from public.auditoria
     where tabela = 'pedidos_internos' and registro_id = v_pedido::text
       and coalesce(valor_novo, '{}'::jsonb) ->> 'natureza' = 'diaria'
  ) then
    raise exception '0168: auditoria não registrou a natureza do pedido';
  end if;
end $$;

rollback;
