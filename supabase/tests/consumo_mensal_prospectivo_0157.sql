\set ON_ERROR_STOP on
-- ORD118. NÃO EXECUTADA nesta ordem. Exclusivamente clone sintético sem seed.
-- A simulação de meses passados abaixo é fixture do owner, não backfill nem
-- capacidade da API. A API é testada para recusar início retroativo.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
do $$
begin
  if exists(select 1 from auth.users) or exists(select 1 from public.perfis)
     or exists(select 1 from public.estoque_movimentacoes) then
    raise exception '0157: fixture exige clone vazio e sintético.';
  end if;
  if exists(select 1 from kontrol_private.consumo_mensal_papeis) then
    raise exception '0157: política inicial deve ser vazia.';
  end if;
end $$;
create function pg_temp.uid157(p text) returns uuid language sql immutable
as $$select md5('ord118-'||p)::uuid$$;
create function pg_temp.ator157(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',pg_temp.uid157(p)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',pg_temp.uid157(p),'role','authenticated',
    'session_id',pg_temp.uid157('sessao-'||p),'email','ord118-'||p||'@example.invalid')::text,true);
end $$;
create function pg_temp.cert157(p_mes date,p_cobertura boolean,p_ruptura_ausente boolean)
returns jsonb language sql immutable as $$
  select jsonb_build_object('mes',p_mes,'cobertura_integral',p_cobertura,
    'sem_ruptura',p_ruptura_ausente,'prova_sha256',repeat('a',64),
    'prova_referencia','Fixture sintética ORD118: cobertura integral do mês civil; não é evidência real')
$$;
insert into auth.users(id,aud,role,email,created_at,updated_at)
select pg_temp.uid157(r),'authenticated','authenticated','ord118-'||r||'@example.invalid',now(),now()
from unnest(array['admin','gestor']) r;
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.uid157('sessao-'||r),pg_temp.uid157(r),now(),now() from unnest(array['admin','gestor']) r;
alter table public.perfis disable trigger kontrol_proteger_papel_perfil;
update public.perfis set papel=case when id=pg_temp.uid157('admin') then 'admin' else 'gestor' end,
  suspenso=false,senha_provisoria=false;
alter table public.perfis enable trigger kontrol_proteger_papel_perfil;
update public.permissoes_categorias set permissoes=permissoes||'{"estoque.ver":true,"estoque.movimentar":true}'
where papel='gestor';

do $$
declare
  i bigint; l bigint; mov bigint; ev bigint; cfg bigint;
  op uuid:=gen_random_uuid(); baixa uuid:=gen_random_uuid();
  parametros jsonb; r jsonb; manual jsonb; manual_depois jsonb; acao text;
  limite date:=date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')::date;
  m0 date; m1 date; m2 date;
begin
  m0:=(limite-interval '3 months')::date;
  m1:=(limite-interval '2 months')::date;
  m2:=(limite-interval '1 month')::date;
  insert into public.insumos(especificacao,unidade,unidade_consumo,quantidade_embalagem,fator_conversao,custo_total_embalagem,custo_unitario)
  values('ORD118 consumo','mL','mL',100,1,100,1) returning id into i;
  insert into public.lotes_estoque(insumo_id,codigo_lote,quantidade_inicial,quantidade_atual,status,modelo_quantidade,
    unidade_fisica_snapshot,conteudo_embalagem_snapshot,unidade_consumo_snapshot,fator_conversao_snapshot)
  values(i,'ORD118-L',20,20,'aceito','EMBALAGEM_FECHADA','mL',100,'mL',1) returning id into l;
  parametros:=jsonb_build_object('inicio',(limite+interval '1 month')::date,'fuso','America/Sao_Paulo',
    'janela',3,'minimo_n',2,'comparabilidade','mes_civil_integral_sem_ruptura_mesma_apresentacao',
    'conteudo',100,'unidade','mL','unidade_consumo','mL','fator',1);
  perform set_config('ord118.insumo',i::text,true);

  perform pg_temp.ator157('gestor');
  set local role authenticated;
  foreach acao in array array['configurar','certificar','executar'] loop
    begin
      perform public.operar_consumo_mensal_insumo(i,gen_random_uuid(),acao,parametros);
      raise exception '0157: escrita manual concedeu autoridade mensal implicitamente';
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    perform public.operar_consumo_mensal_insumo(null,gen_random_uuid(),'governanca',
      '{"papel":"gestor","acao":"executar","permitido":true,"motivo":"tentativa indevida"}');
    raise exception '0157: não Admin alterou política';
  exception when insufficient_privilege then null;
  end;
  r:=public.registrar_consumo_manual_insumo(i,gen_random_uuid(),0,9,100,'mL',true,'ORD118','fixture',current_date);
  manual:=public.ler_consumo_manual_insumo(i,null,1)->'vigente';
  r:=public.ler_consumo_mensal_insumo(i);
  if r->>'estado'<>'sem_leitura_comparavel' or r->'media_embalagens_mes'<>'null'::jsonb then
    raise exception '0157: ausência de prova virou zero';
  end if;
  if r->'capacidades' is distinct from
      '{"configurar":false,"certificar":false,"executar":false,"governanca":false}'::jsonb then
    raise exception '0157: capacidade inferida de manual/papel sem concessão';
  end if;
  begin
    perform public.ler_consumo_mensal_insumo(-1);
    raise exception '0157: insumo indisponível devolveu capacidade/vazio';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid157('gestor'),
    'role','authenticated','session_id',gen_random_uuid())::text,true);
  begin
    perform public.ler_consumo_mensal_insumo(i);
    raise exception '0157: capacidades sem sessão viva';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.ator157('gestor');
  reset role;

  perform pg_temp.ator157('admin');
  set local role authenticated;
  if public.ler_consumo_mensal_insumo(i)->'capacidades' is distinct from
      '{"configurar":false,"certificar":false,"executar":false,"governanca":true}'::jsonb then
    raise exception '0157: Admin herdou escrita mensal ou perdeu governança';
  end if;
  foreach acao in array array['configurar','certificar'] loop
    perform public.operar_consumo_mensal_insumo(null,gen_random_uuid(),'governanca',
      jsonb_build_object('papel','gestor','acao',acao,'permitido',true,'motivo','Fixture isolada ORD118'));
  end loop;
  reset role;
  perform pg_temp.ator157('gestor');
  set local role authenticated;
  if public.ler_consumo_mensal_insumo(i)->'capacidades' is distinct from
      '{"configurar":true,"certificar":true,"executar":false,"governanca":false}'::jsonb then
    raise exception '0157: capacidade divergente da matriz efetiva';
  end if;
  begin
    perform public.operar_consumo_mensal_insumo(i,gen_random_uuid(),'configurar',parametros||jsonb_build_object('inicio',m0));
    raise exception '0157: início retroativo aceito';
  exception when invalid_parameter_value then null;
  end;
  r:=public.operar_consumo_mensal_insumo(i,op,'configurar',parametros);
  if r->>'operacao_id' is distinct from op::text or r->>'insumo_id' is distinct from i::text
     or r->>'acao' is distinct from 'configurar' or r->>'ator_id' is distinct from pg_temp.uid157('gestor')::text
     or r->'repetida' is distinct from 'false'::jsonb then
    raise exception '0157: recibo sem correlação forte do servidor';
  end if;
  cfg:=(r->'configuracao'->>'id')::bigint;
  if public.operar_consumo_mensal_insumo(i,op,'configurar',parametros)
       is distinct from (r||'{"repetida":true,"estado_historico":true}'::jsonb) then
    raise exception '0157: replay alterou identidade/resultado histórico';
  end if;
  begin
    perform public.operar_consumo_mensal_insumo(i,gen_random_uuid(),'configurar',
      parametros||jsonb_build_object('ator_id',pg_temp.uid157('admin')));
    raise exception '0157: ator fornecido pelo cliente aceito';
  exception when invalid_parameter_value then null;
  end;
  if (public.operar_consumo_mensal_insumo(i,op,'configurar',parametros)->>'repetida')::boolean is not true then
    raise exception '0157: replay da configuração duplicado';
  end if;
  begin
    perform public.operar_consumo_mensal_insumo(i,op,'configurar',parametros||'{"janela":4}');
    raise exception '0157: UUID com payload diferente aceito';
  exception when unique_violation then null;
  end;
  begin
    perform public.operar_consumo_mensal_insumo(i,gen_random_uuid(),'certificar',
      pg_temp.cert157(m2,true,true)||'{"quantidade":100}');
    raise exception '0157: total livre aceito';
  exception when invalid_parameter_value then null;
  end;
  perform public.baixa_manual_embalagens(l,1,20,baixa,'Consumo sintético ORD118');
  perform public.baixa_manual_embalagens(l,1,20,baixa,'Consumo sintético ORD118');
  reset role;
  if (select count(*) from kontrol_private.consumo_mensal_fontes where lote_id=l)<>1
     or not exists(select 1 from kontrol_private.consumo_mensal_fontes f
       join public.estoque_movimentacoes m on m.id=f.movimento_id
       join public.eventos_status e on e.id=f.evento_id
       where f.lote_id=l and m.quantidade=1 and e.operacao_id=baixa and f.fator=1 and f.conteudo=100) then
    raise exception '0157: captura movimento/evento/replay não é íntegra';
  end if;

  -- SIMULAÇÃO EXCLUSIVA DA FIXTURE: representar passagem de meses sem relógio
  -- injetável no produto. Não é prova E2 de cronologia real nem backfill.
  update kontrol_private.consumo_mensal_configuracoes set inicio=m0 where id=cfg;
  parametros:=parametros||jsonb_build_object('inicio',m0);
  insert into public.estoque_movimentacoes(insumo_id,lote_id,tipo,quantidade,data,criado_em,motivo)
  values(i,l,'saida',4,m1+10,(m1+10)::timestamp at time zone 'America/Sao_Paulo','ORD118 saída sintética ancorada')
  returning id into mov;
  insert into public.eventos_status(entidade,entidade_id,para_status,usuario,operacao_id,criado_em)
  values('lote_embalagem_fechada',l,'15','ord118-gestor@example.invalid',gen_random_uuid(),
    (m1+10)::timestamp at time zone 'America/Sao_Paulo') returning id into ev;
  insert into kontrol_private.consumo_mensal_fontes(movimento_id,evento_id,insumo_id,lote_id,quantidade,
    ocorrido_em,conteudo,unidade,unidade_consumo,fator,evento)
  select mov,ev,i,l,4,(m1+10)::timestamp at time zone 'America/Sao_Paulo',100,'mL','mL',1,to_jsonb(e)
  from public.eventos_status e where e.id=ev;

  perform pg_temp.ator157('gestor');
  set local role authenticated;
  r:=public.operar_consumo_mensal_insumo(i,gen_random_uuid(),'certificar',pg_temp.cert157(m0,true,true));
  if r->>'qualidade'<>'media_insuficiente' or (r->>'n')::int<>1 or (r->>'media_embalagens_mes')::numeric<>0 then
    raise exception '0157: zero fechado comprovado/insuficiência incorretos';
  end if;
  r:=public.operar_consumo_mensal_insumo(i,gen_random_uuid(),'certificar',pg_temp.cert157(m1,false,true));
  if (r->>'n')::int<>1 then raise exception '0157: cobertura incompleta foi contada'; end if;
  r:=public.operar_consumo_mensal_insumo(i,gen_random_uuid(),'certificar',pg_temp.cert157(m1,true,false));
  if (r->>'n')::int<>1 then raise exception '0157: ruptura foi contada'; end if;
  r:=public.operar_consumo_mensal_insumo(i,gen_random_uuid(),'certificar',pg_temp.cert157(m1,true,true));
  if r->>'estado'<>'alta_pendente_execucao' or (r->>'media_embalagens_mes')::numeric<>2 then
    raise exception '0157: média do livro/autoridade de execução incorretas';
  end if;
  reset role;
  perform pg_temp.ator157('admin');
  set local role authenticated;
  perform public.operar_consumo_mensal_insumo(null,gen_random_uuid(),'governanca',
    '{"papel":"gestor","acao":"executar","permitido":true,"motivo":"Fixture isolada ORD118"}');
  reset role;
  perform pg_temp.ator157('gestor');
  set local role authenticated;
  r:=public.operar_consumo_mensal_insumo(i,gen_random_uuid(),'configurar',parametros);
  if r->>'estado'<>'calculado' then raise exception '0157: configuração não promoveu com prova suficiente'; end if;
  perform public.operar_consumo_mensal_insumo(i,gen_random_uuid(),'executar','{}');
  r:=public.operar_consumo_mensal_insumo(i,gen_random_uuid(),'configurar',parametros||'{"fator":2}');
  if r->>'estado'<>'reavaliacao' or r->'media_embalagens_mes'<>'null'::jsonb then
    raise exception '0157: fator incompatível continuou Alta';
  end if;
  perform public.operar_consumo_mensal_insumo(i,gen_random_uuid(),'configurar',parametros);
  reset role;
  -- Ajuste textual NÃO é estorno inequivocamente vinculado da baixa manual.
  insert into public.estoque_movimentacoes(insumo_id,lote_id,tipo,quantidade,data,motivo)
  values(i,l,'ajuste',4,m1+11,'estorno alegado sem referência canônica');
  perform pg_temp.ator157('gestor');
  set local role authenticated;
  r:=public.ler_consumo_mensal_insumo(i);
  if r->>'estado'<>'reavaliacao' then raise exception '0157: escrita tardia não invalidou prova'; end if;
  r:=public.operar_consumo_mensal_insumo(i,gen_random_uuid(),'certificar',pg_temp.cert157(m1,true,true));
  if (r->>'n')::int<>1 or r->>'estado'<>'reavaliacao' then
    raise exception '0157: ajuste ambíguo foi subtraído ou convertido em zero';
  end if;
  manual_depois:=public.ler_consumo_manual_insumo(i,null,1)->'vigente';
  if manual_depois is distinct from manual then raise exception '0157: manual apagado/alterado'; end if;
  reset role;
  if (select count(*) from kontrol_private.consumo_mensal_transicoes where insumo_id=i)<>1 then
    raise exception '0157: transição automática repetida';
  end if;
  if has_function_privilege('anon','public.operar_consumo_mensal_insumo(bigint,uuid,text,jsonb)','EXECUTE')
     or has_function_privilege('service_role','public.operar_consumo_mensal_insumo(bigint,uuid,text,jsonb)','EXECUTE')
     or has_table_privilege('authenticated','kontrol_private.consumo_mensal_fontes','INSERT')
     or has_table_privilege('authenticated','kontrol_private.consumo_mensal_papeis','UPDATE') then
    raise exception '0157: ACL indevida';
  end if;
end $$;
rollback;

-- CONCORRÊNCIA (roteiro E2 futuro, NÃO EXECUTADO):
-- Em clone sintético, manter a preparação acima antes do rollback, identificando
-- o insumo literal ORD118 consumo e as sessões sintéticas; nunca usar produção.
-- A: BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(<insumo>::text,157));
-- B: sessão authenticated gestor; certificar mês fechado do clone (UUID novo).
--    Deve aguardar A; comprovar wait_event antes de liberar A.
-- A: inserir saída/ajuste candidato naquele mês e COMMIT.
-- B: deve ler a marca nova e fechar não comparável; nenhuma Alta/transição.
-- Repetir com A registrando certificado e B mesma UUID/conteúdo: uma revisão,
-- replay=true em B. UUID igual/conteúdo diferente: 23505, nenhuma segunda revisão.
-- Revogar política enquanto B espera o lock: B deve retornar 42501 após
-- aquisição. Nenhum evento de operação aceito para a tentativa negada.
-- Descartar somente o clone sintético usado pelo ensaio autorizado.
