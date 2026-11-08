\set ON_ERROR_STOP on
-- 0156: somente clone sintético sem seed, como owner das migrations.
-- RPCs exercitadas como authenticated; preparação e inspeção como owner.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

do $$
begin
  if exists (select 1 from auth.users) or exists (select 1 from public.perfis) then
    raise exception '0156: use somente um clone sintético sem usuários/perfis.';
  end if;
end $$;

create function pg_temp.uid156(p text) returns uuid language sql immutable
as $$ select md5('ord108-' || p)::uuid $$;

create function pg_temp.ator156(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.uid156(p)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', pg_temp.uid156(p), 'role', 'authenticated',
    'email', 'ord108-' || p || '@example.invalid')::text, true);
end $$;

insert into auth.users(id,aud,role,email,created_at,updated_at)
select pg_temp.uid156(r),'authenticated','authenticated','ord108-'||r||'@example.invalid',now(),now()
from unnest(array['a','b']) r;

-- Só para preparar os dois atores sintéticos; religar antes das RPCs.
alter table public.perfis disable trigger kontrol_proteger_papel_perfil;
update public.perfis set papel='coordenador',suspenso=false,senha_provisoria=false
where id in (pg_temp.uid156('a'),pg_temp.uid156('b'));
alter table public.perfis enable trigger kontrol_proteger_papel_perfil;
update public.permissoes_categorias
set permissoes = permissoes || '{"compras.receber":true,"compras.cancelar":true,"pedido.aprovar":true,"estoque.lote.gerir":true,"estoque.movimentar":true}'
where papel='coordenador';

-- Os mesmos payloads operáveis são usados na prova positiva e na negativa.
-- A lista de operações é só desta fixture (não é um executor de produção).
create function pg_temp.rpc156(p_canal text, d jsonb) returns jsonb language plpgsql as $$
declare
  compra bigint := (d->>'compra')::bigint;
  item bigint := (d->>'item')::bigint;
  insumo bigint := (d->>'insumo')::bigint;
  op uuid := (d->>'op')::uuid;
  leitura uuid := (d->>'leitura')::uuid;
begin
  case p_canal
    when 'receber' then
      return to_jsonb(public.receber_item_pedido_compra(compra,item,op,1,current_date+30,'ORD108-'||op));
    when 'ler' then
      return public.registrar_recebimento_por_leitura(insumo,compra,item,1,current_date+30,null,'ORD108',op);
    when 'formalizar' then
      return public.formalizar_pedido_interno((d->>'formalizar')::bigint);
    when 'cancelar' then
      return public.cancelar_pedido_interno_operacional((d->>'cancelar')::bigint,null,'ORD108');
    when 'estornar_lote' then
      perform public.estornar_recebimento_lote((d->>'lote_direto')::bigint,'ORD108');
      return '{}'::jsonb;
    when 'estornar_compra' then
      return public.estornar_recebimento_do_lote((d->>'lote_compra')::bigint,'ORD108');
    when 'estornar_interno' then
      perform public.estornar_recebimento_item_pedido_interno(
        (d->>'interno')::bigint,(d->>'item_interno')::bigint,(d->>'recebimento_interno')::bigint,'ORD108');
      return '{}'::jsonb;
    when 'desfazer' then
      return public.desfazer_leitura_estoque(leitura);
    else
      raise exception '0156: canal de fixture desconhecido %', p_canal;
  end case;
end $$;

create function pg_temp.negada156(p_canal text,d jsonb) returns void language plpgsql as $$
begin
  begin
    perform pg_temp.rpc156(p_canal,d);
  exception when insufficient_privilege then
    if sqlerrm in ('Compra fora do escopo de projetos desta sessão.',
                   'Pedido interno fora do escopo de projetos desta sessão.') then
      return;
    end if;
    raise;
  end;
  raise exception '0156: % aceitou operação fora do escopo',p_canal;
end $$;

do $$
declare
  v_grupo text;
  v_canal text;
  v_projeto_a bigint;
  v_projeto_b bigint;
  v_projeto bigint;
  v_insumo bigint;
  v_compra bigint;
  v_item bigint;
  v_formalizar bigint;
  v_cancelar bigint;
  v_interno bigint;
  v_item_interno bigint;
  v_rec bigint;
  v_lote_interno bigint;
  v_lote_compra bigint;
  v_lote_direto bigint;
  v_lote_leitura bigint;
  v_leitura uuid;
  v_op uuid;
  v_payload jsonb;
  v_a jsonb;
  v_b jsonb;
  v_plano bigint;
  v_sucessora bigint;
  v_item_sucessora bigint;
  v_antes bigint[];
  v_depois bigint[];
  v_lote bigint;
  v_resultado jsonb;
begin
  insert into public.projetos(nome,coordenador_id) values ('ORD108-A',pg_temp.uid156('a')) returning id into v_projeto_a;
  insert into public.projetos(nome,coordenador_id) values ('ORD108-B',pg_temp.uid156('b')) returning id into v_projeto_b;
  insert into public.insumos(especificacao,unidade,unidade_consumo,quantidade_embalagem,fator_conversao,custo_total_embalagem,custo_unitario)
  values ('ORD108 reagente','mL','mL',100,1,100,1) returning id into v_insumo;

  foreach v_grupo in array array['a','b','sem-projeto'] loop
    v_projeto := case v_grupo when 'a' then v_projeto_a when 'b' then v_projeto_b else null end;
    insert into public.pedidos_compra(projeto_id,status,solicitante)
    values (v_projeto,'aprovado','ord108-fixture') returning id into v_compra;
    insert into public.pedidos_compra_itens(pedido_id,insumo_id,quantidade,quantidade_em,conteudo_embalagem,custo_unitario_estimado)
    values (v_compra,v_insumo,20,'embalagem',100,100) returning id into v_item;

    insert into public.pedidos_internos(titulo,status,projeto_id,solicitante)
    values ('ORD108 formalizar '||v_grupo,'validado',v_projeto,'ord108-fixture') returning id into v_formalizar;
    insert into public.pedidos_internos_itens(pedido_interno_id,tipo,especificacao,quantidade,insumo_id)
    values (v_formalizar,'material','ORD108 material',1,v_insumo);
    insert into public.pedidos_internos(titulo,status,projeto_id,solicitante)
    values ('ORD108 cancelar '||v_grupo,'rascunho',v_projeto,'ord108-fixture') returning id into v_cancelar;
    insert into public.pedidos_internos(titulo,status,projeto_id,solicitante)
    values ('ORD108 estorno interno '||v_grupo,'formalizado',v_projeto,'ord108-fixture') returning id into v_interno;
    insert into public.lotes_estoque(insumo_id,codigo_lote,quantidade_inicial,quantidade_atual,status)
    values (v_insumo,'ORD108-INT-'||v_grupo,10,10,'aceito') returning id into v_lote_interno;
    insert into public.pedidos_internos_itens(pedido_interno_id,tipo,especificacao,quantidade,insumo_id,lote_id,quantidade_recebida,recebido_em)
    values (v_interno,'material','ORD108 material',10,v_insumo,v_lote_interno,10,now()) returning id into v_item_interno;
    insert into public.pedidos_internos_item_recebimentos(pedido_interno_id,pedido_interno_item_id,lote_id,insumo_id,quantidade)
    values (v_interno,v_item_interno,v_lote_interno,v_insumo,10) returning id into v_rec;

    -- Preparar lotes e uma leitura pelo próprio ator autorizado do projeto.
    v_leitura := gen_random_uuid();
    perform pg_temp.ator156(case when v_grupo='b' then 'b' else 'a' end);
    set local role authenticated;
    v_lote_direto := public.receber_item_pedido_compra(v_compra,v_item,gen_random_uuid(),1,current_date+30,'ORD108-D-'||v_grupo);
    v_lote_compra := public.receber_item_pedido_compra(v_compra,v_item,gen_random_uuid(),1,current_date+30,'ORD108-C-'||v_grupo);
    v_lote_leitura := (public.registrar_recebimento_por_leitura(v_insumo,v_compra,v_item,1,current_date+30,null,'ORD108',v_leitura)->>'lote_id')::bigint;
    reset role;

    v_payload := jsonb_build_object('compra',v_compra,'item',v_item,'insumo',v_insumo,
      'formalizar',v_formalizar,'cancelar',v_cancelar,'interno',v_interno,'item_interno',v_item_interno,
      'recebimento_interno',v_rec,'lote_direto',v_lote_direto,'lote_compra',v_lote_compra,'leitura',v_leitura);
    if kontrol_private.projetos_canal_0156('compra',v_compra)
        is distinct from case when v_projeto is null then '{}'::bigint[] else array[v_projeto] end
      or kontrol_private.projetos_canal_0156('interno',v_formalizar)
        is distinct from case when v_projeto is null then '{}'::bigint[] else array[v_projeto] end
      or kontrol_private.projetos_canal_0156('lote',v_lote_compra)
        is distinct from case when v_projeto is null then '{}'::bigint[] else array[v_projeto] end then
      raise exception '0156: coleta pertinente não preservou origem/sem projeto';
    end if;
    if v_grupo='a' then v_a := v_payload; end if;
    if v_grupo='b' then
      v_b := v_payload;
      continue;
    end if;

    perform pg_temp.ator156('a');
    set local role authenticated;
    v_op := gen_random_uuid();
    v_lote := (pg_temp.rpc156('receber',v_payload||jsonb_build_object('op',v_op)) #>> '{}')::bigint;
    if (pg_temp.rpc156('receber',v_payload||jsonb_build_object('op',v_op)) #>> '{}')::bigint is distinct from v_lote then
      raise exception '0156: retry de recebimento não preservou o lote';
    end if;
    if (pg_temp.rpc156('ler',v_payload||jsonb_build_object('op',v_leitura))->>'repetido')::boolean is not true then
      raise exception '0156: retry da leitura autorizada não preservou resultado';
    end if;
    v_resultado := pg_temp.rpc156('formalizar',v_payload);
    if (v_resultado->>'pedido_compra_id')::bigint is null then
      raise exception '0156: formalização autorizada não criou compra';
    end if;
    foreach v_canal in array array['cancelar','estornar_lote','estornar_compra','estornar_interno','desfazer'] loop
      perform pg_temp.rpc156(v_canal,v_payload);
    end loop;
    reset role;

    if (select status from public.pedidos_internos where id=v_formalizar) is distinct from 'formalizado'
       or (select status from public.pedidos_internos where id=v_cancelar) is distinct from 'cancelado'
       or (select count(*) from public.lotes_estoque where id in (v_lote_direto,v_lote_compra,v_lote_interno,v_lote_leitura) and status='descartado') <> 4
       or not exists (select 1 from public.pedidos_compra_item_recebimentos where lote_id=v_lote_compra and estornado_em is not null)
       or not exists (select 1 from public.pedidos_internos_item_recebimentos where id=v_rec and estornado_em is not null)
       or not exists (select 1 from public.scan_eventos where acao='desfazer_leitura' and contexto->>'operacao_id'=v_leitura::text) then
      raise exception '0156: efeito legítimo não preservado no grupo %', v_grupo;
    end if;
  end loop;

  -- Origem múltipla: filho A de compra B e interno A ligado a plano B.
  insert into public.pedidos_compra(projeto_id,compra_origem_id,status,solicitante)
  values (v_projeto_a,(v_b->>'compra')::bigint,'aprovado','ord108-fixture') returning id into v_sucessora;
  insert into public.pedidos_compra_itens(pedido_id,insumo_id,quantidade,quantidade_em,conteudo_embalagem)
  values (v_sucessora,v_insumo,4,'embalagem',100) returning id into v_item_sucessora;
  insert into public.planejamento(nome,projeto_id) values ('ORD108 plano B',v_projeto_b) returning id into v_plano;
  insert into public.pedidos_internos(titulo,status,projeto_id,planejamento_id)
  values ('ORD108 interno misto','validado',v_projeto_a,v_plano) returning id into v_formalizar;
  insert into public.pedidos_internos_itens(pedido_interno_id,tipo,especificacao,quantidade,insumo_id)
  values (v_formalizar,'material','ORD108 misto',1,v_insumo);
  if kontrol_private.projetos_canal_0156('compra',v_sucessora)
       is distinct from array[least(v_projeto_a,v_projeto_b),greatest(v_projeto_a,v_projeto_b)]
    or kontrol_private.projetos_canal_0156('interno',v_formalizar)
       is distinct from array[least(v_projeto_a,v_projeto_b),greatest(v_projeto_a,v_projeto_b)] then
    raise exception '0156: coleta perdeu ancestral/plano ou incluiu projeto alheio';
  end if;

  select array[
    (select count(*) from public.lotes_estoque), (select count(*) from public.estoque_movimentacoes),
    (select count(*) from public.eventos_status), (select count(*) from public.scan_eventos),
    (select count(*) from public.auditoria), (select count(*) from public.pedidos_compra),
    (select count(*) from public.pedidos_compra_item_recebimentos),
    (select count(*) from public.pedidos_internos_item_recebimentos)
  ] into v_antes;
  perform pg_temp.ator156('a');
  set local role authenticated;
  foreach v_canal in array array['receber','ler','formalizar','cancelar','estornar_lote','estornar_compra','estornar_interno','desfazer'] loop
    perform pg_temp.negada156(v_canal,v_b||jsonb_build_object('op',gen_random_uuid()));
  end loop;
  -- Um pedido próprio não autoriza replay do UUID efetivamente gravado para B.
  perform pg_temp.negada156('ler',v_a||jsonb_build_object('op',(v_b->>'leitura')::uuid));
  perform pg_temp.negada156('receber',v_a||jsonb_build_object('compra',v_sucessora,'item',v_item_sucessora,'op',gen_random_uuid()));
  perform pg_temp.negada156('formalizar',v_a||jsonb_build_object('formalizar',v_formalizar));
  reset role;
  select array[
    (select count(*) from public.lotes_estoque), (select count(*) from public.estoque_movimentacoes),
    (select count(*) from public.eventos_status), (select count(*) from public.scan_eventos),
    (select count(*) from public.auditoria), (select count(*) from public.pedidos_compra),
    (select count(*) from public.pedidos_compra_item_recebimentos),
    (select count(*) from public.pedidos_internos_item_recebimentos)
  ] into v_depois;
  if v_antes is distinct from v_depois
     or (select status from public.pedidos_internos where id=(v_b->>'formalizar')::bigint) is distinct from 'validado'
     or (select status from public.pedidos_internos where id=(v_b->>'cancelar')::bigint) is distinct from 'rascunho'
     or exists (select 1 from public.lotes_estoque where id in ((v_b->>'lote_direto')::bigint,(v_b->>'lote_compra')::bigint) and status='descartado') then
    raise exception '0156: negação deixou efeito de negócio';
  end if;
end $$;

rollback;

-- ORD120 — protocolo de duas sessões, NÃO EXECUTADO nesta autoria E1.
-- Executar somente num clone sintético novo, com 0156 e sem seed. Não usar
-- produção nem um banco de outro pacote. A preparação acima continua fazendo
-- ROLLBACK; o ensaio concorrente exige preparação própria confirmada no clone.
--
-- PREPARAÇÃO (owner, commit apenas no clone): criar Admin e Gestor sintéticos
-- com auth.sessions reais; conceder pedido.aprovar ao Gestor; projeto sem
-- coordenador_id com vínculo explícito do Gestor; pedido interno validado,
-- um item material com insumo, sem compra prévia. Identificar os ids literais
-- como :admin, :admin_session, :gestor, :gestor_session, :projeto, :pedido.
-- Guardar contagens/ids/hash das linhas de pedidos_compra, seus itens,
-- pedidos_internos_aprovacoes, eventos_status e estado do pedido. Nunca
-- reutilizar os pedidos já formalizados no teste sequencial acima.
--
-- SESSÃO A (owner):
-- BEGIN;
-- SELECT id FROM public.pedidos_internos WHERE id=:pedido FOR UPDATE;
-- SELECT pg_backend_pid(); -- registrar pid_A, manter a transação aberta.
--
-- SESSÃO B (psql, substituições explícitas só com ids sintéticos):
-- BEGIN;
-- SET LOCAL application_name='ord120_formalizar_b';
-- SET LOCAL statement_timeout='30s';
-- SELECT set_config('request.jwt.claim.sub', :'gestor', true);
-- SELECT set_config('request.jwt.claims',jsonb_build_object('sub',:'gestor',
--   'role','authenticated','session_id',:'gestor_session',
--   'email','ord120-gestor@example.invalid')::text,true);
-- SET LOCAL ROLE authenticated;
-- SELECT public.formalizar_pedido_interno(:pedido); -- deve aguardar A.
--
-- SESSÃO A: somente após comprovar que B espera A:
-- SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid)
-- FROM pg_stat_activity WHERE application_name='ord120_formalizar_b';
-- Exigir pid_A em pg_blocking_pids(B), não aceitar só um sleep como prova.
-- SELECT set_config('request.jwt.claim.sub', :'admin', true);
-- SELECT set_config('request.jwt.claims',jsonb_build_object('sub',:'admin',
--   'role','authenticated','session_id',:'admin_session')::text,true);
-- SET LOCAL ROLE authenticated;
-- SELECT public.configurar_vinculo_projeto(:projeto,:'gestor'::uuid,false);
-- COMMIT;
--
-- SESSÃO B: resultado obrigatório 42501, mensagem de escopo, não 55P03 nem
-- sucesso. ROLLBACK. Owner compara baseline: pedido segue validado, compra
-- ainda nula; zero novas compras/itens/aprovações/eventos de negócio. Auditoria
-- da revogação feita por A é efeito esperado e separado, não falha da prova.
-- A guarda antiga sozinha reproduz RED: formaliza após a revogação. A nova
-- guarda fica depois do primeiro FOR UPDATE e antes de validar/escrever.
--
-- CASO INVERSO: B passa guarda pós-lock e mantém transação aberta; A tenta
-- revogar. A deve aguardar o perfil/vínculo compartilhado, nunca remover a
-- autorização no meio do efeito. B conclui/COMMIT, depois A conclui. Se A já
-- possui linha de autorização antes de B estabilizá-la, B retorna 55P03 via
-- NOWAIT e rollback integral; não adquirir advisory global fora da ordem.
--
-- REPETIR o mesmo protocolo com locks iniciais reais por canal:
-- cancelar: pedidos_internos; receber/core: item+pedido ou recebimento UUID;
-- estornar_lote: lotes_estoque; estornar_do_lote: recebimento formal;
-- estornar_interno: item+pedido e livros; ler/desfazer: advisory 'leitura:' do
-- UUID. Para replay, preparar resultado autorizado, bloquear esse lock, revogar
-- vínculo, liberar: 42501, nunca conteúdo do cache. Nos waits posteriores,
-- a estabilização anterior protege a autorização até fim da transação.
-- Exercer também coordenador_id retirado e suspensão/troca de papel; alteração
-- dessas linhas em andamento deve produzir NOWAIT/rollback, não deadlock.
-- Não mudar contratos de abertura/entrada avulsa nem testar cache fora desta
-- reserva. Após evidência, descartar somente clone próprio por ordem E2.

-- ORD143: acrescentar o interleaving retirada -> reconcessão -> retirada.
-- No clone, usar coordenação DIRETA, sem vínculo explícito alternativo.
-- A mantém pedido FOR UPDATE; B passa guarda inicial e aguarda esse lock.
-- A retira a coordenação e confirma; a coleta pertinente de B deve continuar
-- contendo o projeto pelo pedido, nunca pelo filtro coordenador_id=ator.
-- Se o Admin reconceder antes de B obter SHARE na linha do projeto, B pode
-- prosseguir apenas após travá-la e reler projeto_no_escopo. Nova retirada
-- deve aguardar B até COMMIT. Se a reconcessão estiver em andamento na linha,
-- NOWAIT deve dar55P03/rollback. Se não reconcedida, guarda42501/zeroefeitos.
-- Verificar pg_locks/pg_blocking_pids nos pontos de espera; não considerar
-- apenas resultado final/sleep como prova de interleaving. O scheduler E2
-- deverá confirmar que a retirada final não conclui enquanto B está ativa.
-- Repetir no canal ligado por planejamento/ancestral e no replay com lote
-- efetivamente registrado; o grafo da operação, não o pedido livre do retry,
-- fornece todos os ids protegidos. Origem que muda durante coleta/trava dá
--40001 e não autoriza efeito. Nenhum lock em projeto não pertencente ao grafo:
-- A pode alterar projeto independente do mesmo ator enquanto B está ativa.
-- Estas são condições de aceite E2 NÃO EXECUTADAS; não acrescentar hooks/GUCs
-- de teste à RPC nem reescrever0151 para sincronizar o ensaio.
