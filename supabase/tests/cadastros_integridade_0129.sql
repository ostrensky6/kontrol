-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0129: exclusao de projeto, local, fornecedor e cliente com vinculo e
-- recusada (23503) e sem vinculo continua possivel; tecnico inativo sai do
-- valor-hora de pessoal; tecnicos.ativo legivel sem abrir valor_mes; CHECKs
-- NOT VALID recusam valores novos fora da faixa. Tudo e revertido no ROLLBACK.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ---- 1. Exclusao com vinculo ------------------------------------------------
do $$
declare
  v_cliente bigint;
  v_cliente_livre bigint;
  v_projeto bigint;
  v_projeto_livre bigint;
  v_fornecedor bigint;
  v_fornecedor_livre bigint;
  v_local_pai bigint;
  v_local_filho bigint;
  v_msg text;
begin
  insert into public.clientes (nome, ativo) values ('TS-0129 cliente', true) returning id into v_cliente;
  insert into public.clientes (nome, ativo) values ('TS-0129 cliente livre', true) returning id into v_cliente_livre;
  insert into public.projetos (nome, cliente_id) values ('TS-0129 projeto', v_cliente) returning id into v_projeto;
  insert into public.projetos (nome) values ('TS-0129 projeto livre') returning id into v_projeto_livre;
  insert into public.planejamento (projeto_id) values (v_projeto);
  insert into public.fornecedores (nome, ativo) values ('TS-0129 fornecedor', true) returning id into v_fornecedor;
  insert into public.fornecedores (nome, ativo) values ('TS-0129 fornecedor livre', true) returning id into v_fornecedor_livre;
  insert into public.insumos (especificacao, fornecedor_id, fator_conversao) values ('TS-0129 insumo', v_fornecedor, 1);
  insert into public.locais (nome, tipo) values ('TS-0129 armário', 'armario') returning id into v_local_pai;
  insert into public.locais (nome, tipo, parent_id) values ('TS-0129 gaveta', 'gaveta', v_local_pai) returning id into v_local_filho;

  begin
    delete from public.clientes where id = v_cliente;
    raise exception '0129: cliente com projeto foi excluido';
  exception when foreign_key_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Não é possível excluir: o cliente%' then raise exception '0129: mensagem do cliente: %', v_msg; end if;
  end;

  begin
    delete from public.projetos where id = v_projeto;
    raise exception '0129: projeto com plano foi excluido';
  exception when foreign_key_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Não é possível excluir: o projeto%' then raise exception '0129: mensagem do projeto: %', v_msg; end if;
  end;

  begin
    delete from public.fornecedores where id = v_fornecedor;
    raise exception '0129: fornecedor com insumo foi excluido';
  exception when foreign_key_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Não é possível excluir: o fornecedor%' then raise exception '0129: mensagem do fornecedor: %', v_msg; end if;
  end;

  begin
    delete from public.locais where id = v_local_pai;
    raise exception '0129: local com sublocal foi excluido';
  exception when foreign_key_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Não é possível excluir: o local%' then raise exception '0129: mensagem do local: %', v_msg; end if;
  end;

  -- o historico continua apontando para o registro
  if not exists (select 1 from public.planejamento where projeto_id = v_projeto)
    or not exists (select 1 from public.projetos where id = v_projeto and cliente_id = v_cliente)
    or not exists (select 1 from public.locais where id = v_local_filho and parent_id = v_local_pai) then
    raise exception '0129: vinculo perdido apos exclusao recusada';
  end if;

  -- sem vinculo, excluir continua possivel
  delete from public.locais where id = v_local_filho;
  delete from public.locais where id = v_local_pai;
  delete from public.projetos where id = v_projeto_livre;
  delete from public.fornecedores where id = v_fornecedor_livre;
  delete from public.clientes where id = v_cliente_livre;
  if exists (select 1 from public.locais where id in (v_local_pai, v_local_filho))
    or exists (select 1 from public.projetos where id = v_projeto_livre)
    or exists (select 1 from public.fornecedores where id = v_fornecedor_livre)
    or exists (select 1 from public.clientes where id = v_cliente_livre) then
    raise exception '0129: registro sem vinculo nao foi excluido';
  end if;
end $$;

-- ---- 2. Tecnico ativo -------------------------------------------------------
do $$
declare
  v_antes numeric;
  v_com numeric;
  v_sem numeric;
  v_id bigint;
begin
  if not has_column_privilege('authenticated', 'public.tecnicos', 'ativo', 'SELECT') then
    raise exception '0129: authenticated sem leitura de tecnicos.ativo';
  end if;
  if has_column_privilege('authenticated', 'public.tecnicos', 'valor_mes', 'SELECT')
    or has_table_privilege('anon', 'public.tecnicos', 'SELECT') then
    raise exception '0129: grant de coluna abriu valor_mes ou anon';
  end if;
  if exists (select 1 from public.tecnicos where not ativo) then
    raise exception '0129: tecnico existente nasceu inativo';
  end if;

  v_antes := public.valor_hora_pessoal_total();
  insert into public.tecnicos (nome, valor_mes, horas_mes_base, percentual_dedicado)
  values ('TS-0129 técnico', 8000, 160, 50) returning id into v_id;
  v_com := public.valor_hora_pessoal_total();
  if v_com - v_antes <> 25 then
    raise exception '0129: tecnico ativo nao entrou no valor-hora (% -> %)', v_antes, v_com;
  end if;
  update public.tecnicos set ativo = false where id = v_id;
  v_sem := public.valor_hora_pessoal_total();
  if v_sem <> v_antes then
    raise exception '0129: tecnico inativo continua no valor-hora (% <> %)', v_sem, v_antes;
  end if;
  if not exists (
    select 1 from public.auditoria
    where tabela = 'tecnicos' and registro_id = v_id::text and acao = 'update'
      and valor_novo ->> 'ativo' = 'false' and valor_novo ->> 'valor_mes' = 'XXX'
  ) then
    raise exception '0129: desativacao sem auditoria mascarada';
  end if;
end $$;

-- ---- 3. CHECKs NOT VALID ----------------------------------------------------
do $$
declare
  v_insumo bigint;
begin
  begin
    insert into public.tecnicos (nome, valor_mes, horas_mes_base, percentual_dedicado)
    values ('TS-0129 fora da faixa', 1000, 160, 150);
    raise exception '0129: percentual dedicado 150 aceito';
  exception when check_violation then null;
  end;

  begin
    insert into public.projetos (nome, data_inicio, data_fim) values ('TS-0129 datas', '2026-10-10', '2026-10-01');
    raise exception '0129: projeto com fim antes do inicio aceito';
  exception when check_violation then null;
  end;
  insert into public.projetos (nome, data_inicio, data_fim) values ('TS-0129 datas ok', '2026-10-01', '2026-10-01');

  insert into public.insumos (especificacao, fator_conversao) values ('TS-0129 insumo lote', 1) returning id into v_insumo;
  begin
    insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual)
    values (v_insumo, 'TS-0129', 1, -1);
    raise exception '0129: lote com saldo negativo aceito';
  exception when check_violation then null;
  end;

  begin
    update public.insumos set ponto_reposicao = -1 where id = v_insumo;
    raise exception '0129: ponto de reposicao negativo aceito';
  exception when check_violation then null;
  end;

  begin
    insert into public.overhead (item, custo_mensal, percentual_compensada, horas_bancada_mes)
    values ('TS-0129', 100, 50, 0);
    raise exception '0129: overhead com 0 hora aceito';
  exception when check_violation then null;
  end;

  -- mesmo codigo de lote em dois recebimentos continua aceito (sem unicidade)
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual)
  values (v_insumo, 'TS-0129-REP', 1, 1), (v_insumo, 'TS-0129-REP', 2, 2);

  -- as regras novas existem e nao foram validadas contra linhas antigas
  if (select count(*) from pg_catalog.pg_constraint
      where conname like 'kontrol\_%\_check' escape '\' and conname in (
        'kontrol_tecnicos_valores_check', 'kontrol_insumos_valores_check',
        'kontrol_lotes_quantidades_check', 'kontrol_equipamentos_valores_check',
        'kontrol_overhead_valores_check', 'kontrol_fornecedores_prazos_check',
        'kontrol_projetos_datas_check')
        and not convalidated) <> 7 then
    raise exception '0129: CHECKs NOT VALID ausentes';
  end if;
end $$;

rollback;
