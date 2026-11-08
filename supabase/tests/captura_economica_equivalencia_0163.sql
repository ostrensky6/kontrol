\set ON_ERROR_STOP on
-- ORD156: NÃO EXECUTADO. Somente clone descartável/sintético, nunca produto.
-- Não inclui 0122/0149/0150, não emite/aprova e não cria projeto/plano.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $$ begin
  if exists(select 1 from auth.users) or exists(select 1 from public.tecnicos)
     or exists(select 1 from public.overhead) or exists(select 1 from public.orcamentos)
     or exists(select 1 from public.analises) or exists(select 1 from public.insumos)
     or exists(select 1 from kontrol_private.orcamento_capturas_equivalencia) then
    raise exception '0163 exige clone sintético vazio; não saneia dados existentes.';
  end if;
end $$;
create function pg_temp.ator163(p_outro boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',case when p_outro then '16300000-0000-4000-8000-000000000002' else '16300000-0000-4000-8000-000000000001' end,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),
    'role','authenticated','session_id',case when p_outro then '16300000-0000-4000-8000-000000000012' else '16300000-0000-4000-8000-000000000011' end)::text,true);
end $$;
create function pg_temp.negada163(p_estado text,p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then if sqlstate=p_estado then return; end if; raise;
  end;
  raise exception '0163: esperado SQLSTATE % em %',p_estado,p_sql;
end $$;
insert into auth.users(id,aud,role,email,created_at,updated_at) values
('16300000-0000-4000-8000-000000000001','authenticated','authenticated','ord163-a@example.invalid',now(),now()),
('16300000-0000-4000-8000-000000000002','authenticated','authenticated','ord163-b@example.invalid',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at) values
('16300000-0000-4000-8000-000000000011','16300000-0000-4000-8000-000000000001',now(),now()),
('16300000-0000-4000-8000-000000000012','16300000-0000-4000-8000-000000000002',now(),now());
update public.perfis set suspenso=false,senha_provisoria=false;
-- Configuração do ator exclusivamente sintético; nenhuma política/RLS desativada.
update public.permissoes_categorias set permissoes=permissoes||'{"analises.ver":true,"insumos.ver":true,"orcamentos.criar_editar":true,"custeio.ver":true,"tecnicos.salario.ver":true}'::jsonb
where papel='laboratorio';
insert into public.parametros(chave,valor) values('dias_uteis_ano',222),('margem_lucro',10),('impostos',5),
('taxas',0),('fundo_reserva',0),('fundo_investimento',0) on conflict(chave) do update set valor=excluded.valor;
insert into public.tecnicos(nome,valor_mes,horas_mes_base,percentual_dedicado,ativo) values('TS-ORD163-P',1700,170,100,true);
insert into public.overhead(item,custo_mensal,horas_bancada_mes,percentual_compensada) values('TS-ORD163-O',100,100,100);
insert into public.analises(codigo,ativo,ofertavel) values('TS-ORD163-A',true,true);
insert into public.etapas(codigo_analise,nome_etapa,nome_atividade,execucoes_por_dia,amostras_por_execucao,tempo_bancada_h,tempo_maquina_h)
values('TS-ORD163-A','Preparo','Mistura',1,2,0.25,0);
insert into public.equipamentos(nome,quantidade,custo_unitario,vida_util_anos,percentual_manutencao_anual)
values('TS-ORD163-E',1,2220,10,0);
insert into public.equipamento_analise(equipamento_id,codigo_analise,peso_alocacao)
select id,'TS-ORD163-A',1 from public.equipamentos where nome='TS-ORD163-E';
insert into public.insumos(especificacao,unidade,unidade_consumo,fator_conversao,custo_unitario,ativo)
values('TS-ORD163-A100','frasco','reação',100,150,true),('TS-ORD163-B30','frasco','reação',30,90,true);
insert into public.insumo_analise(codigo_analise,etapa_id,nome_etapa,nome_atividade,unidade,quantidade_por_amostra,modo_cobranca)
select 'TS-ORD163-A',id,'Preparo','Mistura','reação',2,'por_execucao' from public.etapas where codigo_analise='TS-ORD163-A';
insert into public.demandas_propostas(titulo,cliente_nome,modalidade) values('TS-ORD163-D','TS-ORD163','analises');
insert into public.orcamentos(cliente_nome,demanda_id,status,status_operacional)
select 'TS-ORD163',id,'rascunho','pendente' from public.demandas_propostas where titulo='TS-ORD163-D';
insert into public.orcamento_itens(orcamento_id,codigo_analise,n_amostras)
select id,'TS-ORD163-A',3 from public.orcamentos where cliente_nome='TS-ORD163';
select set_config('ord163.orcamento',(select id::text from public.orcamentos where cliente_nome='TS-ORD163'),true);
select set_config('ord160.demanda',(select demanda_id::text from public.orcamentos where cliente_nome='TS-ORD163'),true);
create function pg_temp.capturar163(p_op uuid,p_revisao integer default 0) returns jsonb language sql as $$
  select public.capturar_orcamento_equivalencia_v1(current_setting('ord163.orcamento')::bigint,p_revisao,
    '{"TS-ORD163-A":"metodo:163:r1"}',p_op);
$$;
-- ORD160: observador só da fixture vazia, para comparar os efeitos completos.
create function pg_temp.estado160() returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object(
    'orcamento',(select to_jsonb(o) from public.orcamentos o where id=current_setting('ord163.orcamento')::bigint),
    'itens',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from public.orcamento_itens i
      where orcamento_id=current_setting('ord163.orcamento')::bigint),
    'ledger',(select coalesce(jsonb_agg(to_jsonb(c) order by c.operacao_id),'[]') from kontrol_private.orcamento_capturas_equivalencia c
      where orcamento_id=current_setting('ord163.orcamento')::bigint),
    'origens',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from kontrol_private.orcamento_captura_em_curso c
      where backend_pid=pg_backend_pid()));
$$;
create function pg_temp.negada160(p_caso text,p_sql text) returns void language plpgsql as $$
declare antes jsonb:=pg_temp.estado160();
begin
  perform pg_temp.negada163('42501',p_sql);
  if pg_temp.estado160() is distinct from antes then raise exception '% alterou item/snapshot/revisão/ledger',p_caso; end if;
  if pg_temp.estado160()->'origens'<>'[]'::jsonb then raise exception '%: origem privada residual',p_caso; end if;
end $$;
do $$ begin
  -- Reproduz exatamente o caso perigoso: os dois writers têm owner comum.
  if (select proowner from pg_proc where oid='public.salvar_item_orcamento(bigint,text,numeric,numeric,numeric,jsonb,jsonb)'::regprocedure)
     is distinct from (select proowner from pg_proc where oid='public.capturar_orcamento_equivalencia_v1(bigint,integer,jsonb,uuid)'::regprocedure) then
    raise exception 'ORD160: fixture exige owners comuns para reproduzir a falha';
  end if;
end $$;
savepoint ord160_legado;
set local role authenticated;
select pg_temp.ator163();
do $$ declare r jsonb; begin
  r:=public.salvar_item_orcamento(current_setting('ord163.orcamento')::bigint,'TS-ORD163-A',3,2,3,'{}','{}');
  if r->>'itens'<>'1' or (pg_temp.estado160()->'orcamento'->>'custo_revisao')::integer<>1
     or (pg_temp.estado160()->'itens'->0->>'custo_unitario')::numeric<>2 then
    raise exception 'ORD160:legado_preservado: writer sem modo foi bloqueado';
  end if;
end $$;
reset role;
rollback to savepoint ord160_legado;
savepoint ord160_entrada;
update public.permissoes_categorias set permissoes='{"orcamentos.criar_editar":true}' where papel='laboratorio';
set local role authenticated;
select pg_temp.ator163();
select set_config('app.orcamento_equivalencia_operacao','16300000-0000-4000-8000-000000000021',true);
do $$ begin
  if not public.tem_permissao('orcamentos.criar_editar') or public.tem_permissao('custeio.ver')
     or public.tem_permissao('tecnicos.salario.ver') or public.tem_permissao('analises.ver')
     or public.tem_permissao('insumos.ver') then raise exception 'ORD160: ator mínimo incorreto'; end if;
end $$;
select pg_temp.negada160('ORD160:entrada_snapshot',$q$select public.salvar_item_orcamento(
  current_setting('ord163.orcamento')::bigint,'TS-ORD163-A',3,0,0,'{}','{"versao":"equivalencia-economica-v1"}')$q$);
select pg_temp.negada160('ORD160:entrada_item',$q$select public.salvar_item_orcamento(
  current_setting('ord163.orcamento')::bigint,'TS-ORD163-A',3,0,0,'{"versao":"equivalencia-economica-v1"}','{}')$q$);
select pg_temp.negada160('ORD160:entrada_insert',$q$insert into public.orcamentos(cliente_nome,demanda_id,custo_snapshot)
  values('TS-ORD160-FORJADO',current_setting('ord160.demanda')::bigint,'{"versao":"equivalencia-economica-v1"}'::jsonb)$q$);
select pg_temp.negada160('ORD160:origem_privada_negada',$q$insert into kontrol_private.orcamento_captura_em_curso
  values(pg_backend_pid(),txid_current(),current_setting('ord163.orcamento')::bigint,auth.uid(),
    '16300000-0000-4000-8000-000000000021','{"versao":"equivalencia-economica-v1"}')$q$);
reset role;
rollback to savepoint ord160_entrada;
set local role authenticated;
select pg_temp.ator163();
do $$ declare n record; i record; begin
  select * into n from public.insumo_analise where codigo_analise='TS-ORD163-A';
  for i in select * from public.insumos where especificacao like 'TS-ORD163-%' order by id loop
    perform public.registrar_equivalencia_contextual_v1('TS-ORD163-A','metodo:163:r1',jsonb_build_object(
      'necessidade_id',n.id,'etapa_id',n.etapa_id,'insumo_id',i.id,'equipamento_id',null,
      'apresentacao_ref','apresentacao:'||i.id||':r1','unidade_estoque',i.unidade,'unidade_consumo',i.unidade_consumo,
      'fator_conversao',i.fator_conversao,'evidencia_ref','laudo:163:r1','vigente_ate',null,'confirmada',true));
  end loop;
end $$;
do $$ declare r jsonb; r2 jsonb; begin
  r:=pg_temp.capturar163('16300000-0000-4000-8000-000000000021');
  -- Manual: 3 amostras, lote2 =>2 execuções, 4 reações. A=150/100*4=6;
  -- B=90/30*4=12 (maior convertido). Equip=1/dia /2*3=1,5;
  -- pessoal=0,25*2*10=5; overhead=0,25*2*1=0,5; custo19; preço19*1,15=21,85.
  if abs((r->>'custo_total')::numeric-19)>1e-9 or abs((r->>'preco_total')::numeric-21.85)>1e-9
     or r->>'revisao_aplicada'<>'1' then raise exception '0163: cálculo manual divergente: %',r; end if;
  r2:=pg_temp.capturar163('16300000-0000-4000-8000-000000000021');
  if r2-'replay' is distinct from r-'replay' or r2->'replay'<>'true'::jsonb then raise exception '0163: replay divergente'; end if;
  perform pg_temp.negada163('22023',$q$select pg_temp.capturar163('16300000-0000-4000-8000-000000000021',1)$q$);
  perform pg_temp.negada163('22023',$q$select public.capturar_orcamento_equivalencia_v1(
    current_setting('ord163.orcamento')::bigint,0,'{"TS-ORD163-A":"metodo:outro"}',
    '16300000-0000-4000-8000-000000000021')$q$);
  perform pg_temp.ator163(true);
  perform pg_temp.negada163('22023',$q$select pg_temp.capturar163('16300000-0000-4000-8000-000000000021')$q$);
  perform pg_temp.ator163();
  perform pg_temp.negada163('40001',$q$select pg_temp.capturar163('16300000-0000-4000-8000-000000000022')$q$);
  perform pg_temp.negada163('42501',$q$select public.salvar_item_orcamento(current_setting('ord163.orcamento')::bigint,'TS-ORD163-A',3,0,0,'{}','{}')$q$);
end $$;
reset role;
-- ORD160: depois de captura/replay válidos, nem o recibo conhecido nem GUC
-- forjada autorizam writer legado, ainda que ambas as funções tenham mesmo owner.
set local role authenticated;
select pg_temp.ator163();
select set_config('app.orcamento_equivalencia_operacao','16300000-0000-4000-8000-000000000021',true);
select pg_temp.negada160('ORD160:regravacao',$q$select public.salvar_item_orcamento(
  current_setting('ord163.orcamento')::bigint,'TS-ORD163-A',3,0,0,
  pg_temp.estado160()->'itens'->0->'valor_snapshot',pg_temp.estado160()->'orcamento'->'custo_snapshot')$q$);
select pg_temp.negada160('ORD160:saida',$q$select public.salvar_item_orcamento(
  current_setting('ord163.orcamento')::bigint,'TS-ORD163-A',3,0,0,'{}','{}')$q$);
select set_config('app.orcamento_equivalencia_operacao','uuid-arbitrario',true);
select pg_temp.negada160('ORD160:guc_forjada',$q$select public.salvar_item_orcamento(
  current_setting('ord163.orcamento')::bigint,'TS-ORD163-A',3,0,0,
  '{"versao":"equivalencia-economica-v1"}','{"versao":"equivalencia-economica-v1"}')$q$);
reset role;
do $$ declare s jsonb; begin
  select snapshot into s from kontrol_private.orcamento_capturas_equivalencia where operacao_id='16300000-0000-4000-8000-000000000021';
  if s->'itens'->0->'valor_snapshot'->'selecao'->0->>'quantidade_consumo'<>'4'
     or (s->'itens'->0->'valor_snapshot'->'proveniencia_dimensional'->0->>'fator_conversao')::numeric<>30
     or (s->'itens'->0->'valor_snapshot'->'proveniencia_dimensional'->0->>'quantidade_consumo')::numeric<>2 then
    raise exception '0163: origem, quantidade base/total e fator devem ser reconstruíveis';
  end if;
  perform set_config('ord163.snapshot',s::text,true);
  if (select count(*) from kontrol_private.orcamento_capturas_equivalencia)<>1 then raise exception '0163: duplicou recibo'; end if;
  if exists(select 1 from kontrol_private.orcamento_captura_em_curso) then raise exception 'ORD160: captura/replay deixou origem privada residual'; end if;
end $$;
update public.insumos set custo_unitario=300 where especificacao='TS-ORD163-B30';
set local role authenticated;
select pg_temp.ator163();
do $$ declare r jsonb; begin
  r:=pg_temp.capturar163('16300000-0000-4000-8000-000000000021');
  if abs((r->>'custo_total')::numeric-19)>1e-9 then raise exception '0163: replay consultou preço vivo'; end if;
end $$;
reset role;
do $$ begin
  if (select snapshot from kontrol_private.orcamento_capturas_equivalencia where operacao_id='16300000-0000-4000-8000-000000000021')
     is distinct from current_setting('ord163.snapshot')::jsonb then raise exception '0163: histórico mudou'; end if;
  perform pg_temp.negada163('42501',$q$update kontrol_private.orcamento_capturas_equivalencia set snapshot='{}'$q$);
end $$;
-- Falha no último efeito: item/snapshot/revisão e recibo devem voltar juntos.
create function pg_temp.falhar_recibo163() returns trigger language plpgsql as $$ begin
  raise exception 'TS-ORD163-RECIBO' using errcode='P0001'; end $$;
create trigger ts_ord163_falha before insert on kontrol_private.orcamento_capturas_equivalencia
for each row execute function pg_temp.falhar_recibo163();
set local role authenticated;
select pg_temp.negada163('P0001',$q$select pg_temp.capturar163('16300000-0000-4000-8000-000000000022',1)$q$);
reset role;
drop trigger ts_ord163_falha on kontrol_private.orcamento_capturas_equivalencia;
do $$ begin
  if (select custo_revisao from public.orcamentos where id=current_setting('ord163.orcamento')::bigint)<>1
     or (select custo_snapshot from public.orcamentos where id=current_setting('ord163.orcamento')::bigint)
        is distinct from current_setting('ord163.snapshot')::jsonb
     or (select count(*) from kontrol_private.orcamento_capturas_equivalencia)<>1 then raise exception '0163: efeito parcial'; end if;
  if exists(select 1 from kontrol_private.orcamento_captura_em_curso) then raise exception 'ORD160: rollback deixou origem privada residual'; end if;
end $$;
-- Custo ausente não é zero; preço zero explícito continua sendo um dado válido.
update public.insumos set fator_conversao=31 where especificacao='TS-ORD163-B30';
set local role authenticated;
select pg_temp.negada163('22023',$q$select pg_temp.capturar163('16300000-0000-4000-8000-000000000022',1)$q$);
reset role;
update public.insumos set fator_conversao=30 where especificacao='TS-ORD163-B30';
update public.insumos set custo_unitario=null where especificacao='TS-ORD163-B30';
set local role authenticated;
select pg_temp.negada163('22023',$q$select pg_temp.capturar163('16300000-0000-4000-8000-000000000022',1)$q$);
reset role;
update public.insumos set custo_unitario=0;
set local role authenticated;
do $$ declare r jsonb; begin
  r:=pg_temp.capturar163('16300000-0000-4000-8000-000000000022',1);
  if abs((r->>'custo_total')::numeric-7)>1e-9 then raise exception '0163: zero explícito recusado/ausência convertida'; end if;
end $$;
reset role;
-- Média da fonte vigente, não média de preços sem ponderação: 10*300 +20*600,
-- dividido por30 unidades de estoque =500; consumo500/30; 4 reações.
insert into public.lotes_estoque(insumo_id,codigo_lote,validade,quantidade_inicial,quantidade_atual,custo_unitario,status,modelo_quantidade)
select id,'TS-ORD163-L1',current_date+200,10,10,300,'aceito','LEGADO' from public.insumos where especificacao='TS-ORD163-B30';
insert into public.lotes_estoque(insumo_id,codigo_lote,validade,quantidade_inicial,quantidade_atual,custo_unitario,status,modelo_quantidade)
select id,'TS-ORD163-L2',current_date+200,20,20,600,'aceito','LEGADO' from public.insumos where especificacao='TS-ORD163-B30';
set local role authenticated;
do $$ declare r jsonb; begin
  r:=pg_temp.capturar163('16300000-0000-4000-8000-000000000023',2);
  if abs((r->>'custo_total')::numeric-(7+2000::numeric/30))>1e-9 then raise exception '0163: média ponderada divergente'; end if;
end $$;
reset role;
do $$ declare p jsonb; begin
  select snapshot->'itens'->0->'valor_snapshot'->'proveniencia_dimensional'->0 into p
  from kontrol_private.orcamento_capturas_equivalencia where operacao_id='16300000-0000-4000-8000-000000000023';
  if p->>'fonte_custo'<>'custo_medio_ponderado' or p->>'referencia_custo'<>'lotes_estoque_liberados'
     or (p->>'custo_unitario_estoque')::numeric<>500 then raise exception '0163: proveniência média perdida'; end if;
end $$;
update public.permissoes_categorias set permissoes=permissoes||'{"custeio.ver":false}' where papel='laboratorio';
set local role authenticated;
select pg_temp.negada163('42501',$q$select pg_temp.capturar163('16300000-0000-4000-8000-000000000021')$q$);
reset role;
rollback;

-- Concorrência futura em DUAS sessões de clone autorizado: seed equivalente
-- comprometido separadamente, nunca remover este ROLLBACK para usar produto.
-- A: BEGIN; UPDATE insumos SET custo_unitario=custo_unitario+1 WHERE
-- especificacao='TS-ORD163-B30'; manter transação aberta.
-- B: sessão autenticada sintética chama capturar_orcamento_equivalencia_v1
-- com UUID novo/revisão atual: exigir55P03, nenhum item/recibo/revisão alterado.
-- Repetir A com INSERT de nova decisão/etapa/lote elegível: o lock de conjunto
-- deve impedir phantom, não apenas UPDATE. ROLLBACK A; B pode repetir MESMO UUID.
-- Emissão concorrente não é executada aqui (ORD26): fronteira demanda/versão
-- necessita prova própria após autorização, sem afirmar E2 por inspeção.
