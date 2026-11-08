-- Guarda de escopo dos canais restantes de compras e estornos. 0151 é a
-- fonte do predicado; nenhuma transição, chave, ACL ou executor é substituído.
begin;
set local lock_timeout = '5s';

create or replace function kontrol_private.exigir_escopo_interno_0156(p_pedido_id bigint)
returns void language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1
    from public.pedidos_internos p
    left join public.planejamento pl on pl.id = p.planejamento_id
    cross join lateral (values (p.projeto_id), (pl.projeto_id)) origem(projeto_id)
    where p.id = p_pedido_id and origem.projeto_id is not null
      and not kontrol_private.projeto_no_escopo(origem.projeto_id)
  ) then
    raise exception 'Pedido interno fora do escopo de projetos desta sessão.' using errcode = '42501';
  end if;

  perform kontrol_private.exigir_escopo_compra_0151(c.compra_id)
  from (
    select p.pedido_compra_id from public.pedidos_internos p where p.id = p_pedido_id
    union
    select ci.pedido_id from public.pedidos_compra_itens ci
      join public.pedidos_internos_itens ii on ii.id = ci.pedido_interno_item_id
      where ii.pedido_interno_id = p_pedido_id
    union
    select r.pedido_compra_id from public.pedidos_compra_item_recebimentos r
      join public.pedidos_internos_itens ii on ii.id = r.pedido_interno_item_id
      where ii.pedido_interno_id = p_pedido_id
  ) c(compra_id)
  where c.compra_id is not null;
end $$;

-- Livros (inclusive histórico estornado) e ponteiros legados de item são
-- origem. Reservas/movimentos de uso posterior não tornam estoque compartilhado
-- privado; não inferir projeto a partir de texto, e-mail ou descrição do lote.
create or replace function kontrol_private.exigir_escopo_lote_0156(p_lote_id bigint)
returns void language plpgsql set search_path = '' as $$
begin
  perform kontrol_private.exigir_escopo_compra_0151(c.compra_id)
  from (
    select r.pedido_compra_id from public.pedidos_compra_item_recebimentos r where r.lote_id = p_lote_id
    union
    select i.pedido_id from public.pedidos_compra_itens i where i.lote_id = p_lote_id
    union
    select i.pedido_id from public.pedidos_internos_item_recebimentos r
      join public.pedidos_compra_itens i on i.id = r.pedido_compra_item_id
      where r.lote_id = p_lote_id
  ) c(compra_id);

  perform kontrol_private.exigir_escopo_interno_0156(i.interno_id)
  from (
    select r.pedido_interno_id from public.pedidos_internos_item_recebimentos r where r.lote_id = p_lote_id
    union
    select i.pedido_interno_id from public.pedidos_internos_itens i where i.lote_id = p_lote_id
    union
    select i.pedido_interno_id from public.pedidos_compra_item_recebimentos r
      join public.pedidos_internos_itens i on i.id = r.pedido_interno_item_id
      where r.lote_id = p_lote_id
  ) i(interno_id);
end $$;

-- Só o contexto de entrada_pedido_leitura produzido pelo servidor é origem
-- aqui. Checar a compra gravada, e não só o pedido informado no retry.
create or replace function kontrol_private.exigir_escopo_leitura_compra_0156(p_contexto jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  perform kontrol_private.exigir_escopo_compra_0151((p_contexto->>'pedido_id')::bigint);
  perform kontrol_private.exigir_escopo_lote_0156((p_contexto->>'lote_id')::bigint);
end $$;

revoke all on function
  kontrol_private.exigir_escopo_interno_0156(bigint),
  kontrol_private.exigir_escopo_lote_0156(bigint),
  kontrol_private.exigir_escopo_leitura_compra_0156(jsonb)
from public, anon, authenticated, service_role;

-- CREATE OR REPLACE da definição vigente: a única mudança no corpo é cada
-- chamada de guarda. Âncora ausente/repetida ou assinatura ausente abortam a
-- migration inteira, em vez de desfazer redefinições posteriores da cadeia.
do $migration$
declare
  r record;
  v_def text;
begin
  for r in select * from (values
    ('public.receber_item_pedido_compra(bigint,bigint,uuid,numeric,date,text,text,numeric,bigint)',
      $a$  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operacao_id::text, 0));$a$,
      $g$  perform kontrol_private.exigir_escopo_compra_0151(p_pedido_id);$g$),
    ('kontrol_private.receber_item_compra_formal(bigint,bigint,numeric,date,text,text,numeric,bigint)',
      $a$  select
    pi.id, pi.pedido_id, pi.insumo_id, pi.quantidade,$a$,
      $g$  perform kontrol_private.exigir_escopo_compra_0151(p_pedido_id);$g$),
    ('public.registrar_recebimento_por_leitura(bigint,bigint,bigint,integer,date,bigint,text,uuid)',
      $a$  perform pg_advisory_xact_lock(hashtextextended('leitura:' || p_operacao_id::text, 0));$a$,
      $g$  perform kontrol_private.exigir_escopo_compra_0151(p_pedido_id);
  perform kontrol_private.exigir_escopo_leitura_compra_0156(e.contexto)
    from public.scan_eventos e
    where e.acao = 'entrada_pedido_leitura' and e.contexto->>'operacao_id' = p_operacao_id::text;$g$),
    ('public.registrar_recebimento_por_leitura(bigint,bigint,bigint,integer,date,bigint,text,uuid)',
      $a$    return jsonb_set(v_evento.contexto->'resultado', '{repetido}', 'true'::jsonb, true);$a$,
      $g$    if v_evento.acao = 'entrada_pedido_leitura' then
      perform kontrol_private.exigir_escopo_leitura_compra_0156(v_evento.contexto);
    end if;$g$),
    ('public.formalizar_pedido_interno(bigint)',
      $a$  select id, titulo, status, solicitante, projeto_id, pedido_compra_id$a$,
      $g$  perform kontrol_private.exigir_escopo_interno_0156(p_pedido_id);$g$),
    ('public.cancelar_pedido_interno_operacional(bigint,text,text)',
      $a$  select id, status, pedido_compra_id, recebido_em$a$,
      $g$  perform kontrol_private.exigir_escopo_interno_0156(p_pedido_id);$g$),
    ('public.estornar_recebimento_lote(bigint,text)',
      $a$  select *
    into v_lote$a$,
      $g$  perform kontrol_private.exigir_escopo_lote_0156(p_lote_id);$g$),
    ('public.estornar_recebimento_do_lote(bigint,text)',
      $a$  select r.* into v_rec$a$,
      $g$  perform kontrol_private.exigir_escopo_lote_0156(p_lote_id);$g$),
    ('public.estornar_recebimento_item_pedido_interno(bigint,bigint,bigint,text)',
      $a$  select i.id, i.quantidade, p.status$a$,
      $g$  perform kontrol_private.exigir_escopo_interno_0156(p_pedido_id);
  perform kontrol_private.exigir_escopo_lote_0156(r.lote_id)
    from public.pedidos_internos_item_recebimentos r
    where r.pedido_interno_id = p_pedido_id
      and r.pedido_interno_item_id = p_item_id
      and (p_recebimento_id is null or r.id = p_recebimento_id);$g$),
    ('public.desfazer_leitura_estoque(uuid)',
      $a$  perform pg_advisory_xact_lock(hashtextextended('leitura:' || p_operacao_id::text, 0));$a$,
      $g$  perform kontrol_private.exigir_escopo_leitura_compra_0156(e.contexto)
    from public.scan_eventos e
    where e.acao = 'entrada_pedido_leitura' and e.contexto->>'operacao_id' = p_operacao_id::text;$g$),
    ('public.desfazer_leitura_estoque(uuid)',
      $a$  if exists (
    select 1 from public.scan_eventos e
    where e.acao = 'desfazer_leitura' and e.contexto->>'operacao_id' = p_operacao_id::text$a$,
      $g$  if v_evento.acao = 'entrada_pedido_leitura' then
    perform kontrol_private.exigir_escopo_leitura_compra_0156(v_evento.contexto);
  end if;$g$)
  ) ajustes(assinatura, ancora, guarda)
  loop
    v_def := replace(pg_catalog.pg_get_functiondef(r.assinatura::regprocedure), chr(13), '');
    if pg_catalog.cardinality(pg_catalog.string_to_array(v_def, r.ancora)) <> 2 then
      raise exception '0156: âncora ausente ou não única em %.', r.assinatura;
    end if;
    execute replace(v_def, r.ancora, r.guarda || chr(10) || r.ancora);
  end loop;
end $migration$;

-- ORD120: o predicado pré-lock evita divulgação; não autoriza o efeito após
-- uma espera. Depois do lock de negócio, estabilizar apenas as fontes de
-- autorização do ator e consultar novamente os predicados canônicos 0151.
-- NOWAIT evita inverter a ordem da RPC de vínculo (perfil/projeto/vínculo):
-- revogação ainda em andamento => 55P03, rollback integral; já concluída =>
-- predicado atual nega 42501. Não tomar o advisory global de nomeação depois
-- dos locks de negócio. Nenhuma concessão, GUC ou identidade de owner nova.
-- ORD143: ids derivados das MESMAS origens físicas das guardas0151/0156,
-- nunca de uma lista de projetos informada pelo cliente ou do coordenador
-- atual. O predicado de acesso continua projeto_no_escopo da0151.
create function kontrol_private.projetos_canal_0156(p_canal text,p_id bigint)
returns bigint[] language sql stable set search_path='' as $$
  with recursive internos_raiz as (
    select p_id as id where p_canal='interno'
    union select r.pedido_interno_id from public.pedidos_internos_item_recebimentos r
      where p_canal='lote' and r.lote_id=p_id
    union select i.pedido_interno_id from public.pedidos_internos_itens i
      where p_canal='lote' and i.lote_id=p_id
    union select i.pedido_interno_id from public.pedidos_compra_item_recebimentos r
      join public.pedidos_internos_itens i on i.id=r.pedido_interno_item_id
      where p_canal='lote' and r.lote_id=p_id
  ), compras_raiz as (
    select p_id as id where p_canal='compra'
    union select r.pedido_compra_id from public.pedidos_compra_item_recebimentos r
      where p_canal='lote' and r.lote_id=p_id
    union select i.pedido_id from public.pedidos_compra_itens i
      where p_canal='lote' and i.lote_id=p_id
    union select i.pedido_id from public.pedidos_internos_item_recebimentos r
      join public.pedidos_compra_itens i on i.id=r.pedido_compra_item_id
      where p_canal='lote' and r.lote_id=p_id
    union select p.pedido_compra_id from public.pedidos_internos p join internos_raiz r on r.id=p.id
    union select ci.pedido_id from public.pedidos_compra_itens ci
      join public.pedidos_internos_itens ii on ii.id=ci.pedido_interno_item_id
      join internos_raiz r on r.id=ii.pedido_interno_id
    union select c.pedido_compra_id from public.pedidos_compra_item_recebimentos c
      join public.pedidos_internos_itens ii on ii.id=c.pedido_interno_item_id
      join internos_raiz r on r.id=ii.pedido_interno_id
  ), compras as (
    select c.id,c.compra_origem_id,c.projeto_id from public.pedidos_compra c join compras_raiz r on r.id=c.id
    union select c.id,c.compra_origem_id,c.projeto_id from public.pedidos_compra c join compras a on a.compra_origem_id=c.id
  ), internos as (
    select p.id,p.projeto_id,p.planejamento_id from public.pedidos_internos p join internos_raiz r on r.id=p.id
    union select p.id,p.projeto_id,p.planejamento_id from public.pedidos_internos p join compras c on c.id=p.pedido_compra_id
    union select p.id,p.projeto_id,p.planejamento_id from compras c
      join public.pedidos_compra_itens ci on ci.pedido_id=c.id
      join public.pedidos_internos_itens ii on ii.id=ci.pedido_interno_item_id
      join public.pedidos_internos p on p.id=ii.pedido_interno_id
  ), projetos as (
    select projeto_id from compras union select projeto_id from internos
    union select pl.projeto_id from public.planejamento pl join internos i on i.planejamento_id=pl.id
  )
  select coalesce(array_agg(projeto_id order by projeto_id),'{}'::bigint[])
  from projetos where projeto_id is not null;
$$;

create function kontrol_private.estabilizar_ator_0156(p_canal text,p_id bigint)
returns void language plpgsql set search_path='' as $$
declare v_projetos bigint[];
begin
  if current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'Escopo pós-lock exige snapshot atual.' using errcode='25000';
  end if;
  perform 1 from public.perfis p where p.id=auth.uid() for share nowait;
  if not found then raise exception 'Sessão sem perfil.' using errcode='42501'; end if;
  if p_canal is null or p_canal not in ('compra','interno','lote') then
    raise exception 'Canal de escopo inválido.' using errcode='22023';
  end if;
  v_projetos:=kontrol_private.projetos_canal_0156(p_canal,p_id);
  -- A coordenação pode ter sido retirada/reconcedida desde a coleta. Trava
  -- SEM filtro coordenador_id: a linha pertinente permanece protegida mesmo
  -- se o ator não coordenava naquele snapshot. Uma reconcessão não abre janela.
  perform 1 from public.projetos p
    where p.id=any(v_projetos) order by p.id for share nowait;
  perform 1 from kontrol_private.projetos_vinculos v
    where v.usuario_id=auth.uid() and v.projeto_id=any(v_projetos)
    order by v.projeto_id for share nowait;
  if v_projetos is distinct from kontrol_private.projetos_canal_0156(p_canal,p_id) then
    raise exception 'Origem do canal mudou durante a estabilização.' using errcode='40001';
  end if;
  -- As linhas que sustentam um acesso já existente ficam estáveis até COMMIT.
  -- Ausência não é permissão: a guarda canônica chamada a seguir decide.
end $$;
revoke all on function kontrol_private.estabilizar_ator_0156(text,bigint),
  kontrol_private.projetos_canal_0156(text,bigint)
from public,anon,authenticated,service_role;

do $pos_lock$
declare r record; v_def text; v_guarda text;
begin
  for r in select * from (values
    ('public.receber_item_pedido_compra(bigint,bigint,uuid,numeric,date,text,text,numeric,bigint)',
      $a$    if v_existente.pedido_compra_id = p_pedido_id$a$,
      'perform kontrol_private.exigir_escopo_compra_0151(p_pedido_id);'),
    ('public.receber_item_pedido_compra(bigint,bigint,uuid,numeric,date,text,text,numeric,bigint)',
      $a$  if exists (
    select 1
    from public.pedidos_internos_item_recebimentos$a$,
      'perform kontrol_private.exigir_escopo_compra_0151(p_pedido_id);'),
    ('kontrol_private.receber_item_compra_formal(bigint,bigint,numeric,date,text,text,numeric,bigint)',
      $a$  if v_item.quantidade_recebida >= v_item.quantidade then$a$,
      'perform kontrol_private.exigir_escopo_compra_0151(p_pedido_id);'),
    ('public.formalizar_pedido_interno(bigint)',
      $a$  if v_pedido.status <> 'validado' then$a$,
      'perform kontrol_private.exigir_escopo_interno_0156(p_pedido_id);'),
    ('public.formalizar_pedido_interno(bigint)',
      $a$    v_compra_id := v_compra.id;$a$,
      'perform kontrol_private.exigir_escopo_interno_0156(p_pedido_id);'),
    ('public.cancelar_pedido_interno_operacional(bigint,text,text)',
      $a$  if v_pedido.status in ('cancelado', 'compra_concluida') then$a$,
      'perform kontrol_private.exigir_escopo_interno_0156(p_pedido_id);'),
    ('public.cancelar_pedido_interno_operacional(bigint,text,text)',
      $a$      if v_compra.status = 'recebido' or exists ($a$,
      'perform kontrol_private.exigir_escopo_interno_0156(p_pedido_id);'),
    ('public.estornar_recebimento_lote(bigint,text)',
      $a$  if v_lote.status in ('consumido','descartado') then$a$,
      'perform kontrol_private.exigir_escopo_lote_0156(p_lote_id);'),
    ('public.estornar_recebimento_do_lote(bigint,text)',
      $a$    -- Lote de pedido interno sem compra formal: estorno bilateral existente.$a$,
      'perform kontrol_private.exigir_escopo_lote_0156(p_lote_id);'),
    ('public.estornar_recebimento_do_lote(bigint,text)',
      $a$  if v_rec.estornado_em is not null then$a$,
      'perform kontrol_private.exigir_escopo_lote_0156(p_lote_id);'),
    ('public.estornar_recebimento_do_lote(bigint,text)',
      $a$  select not exists (
    select 1 from pedidos_compra_itens i
    where i.pedido_id = v_compra.id
      and coalesce(i.quantidade_recebida, case$a$,
      'perform kontrol_private.exigir_escopo_lote_0156(p_lote_id);'),
    ('public.estornar_recebimento_do_lote(bigint,text)',
      $a$  select coalesce(sum(r.quantidade), 0) into v_total$a$,
      'perform kontrol_private.exigir_escopo_lote_0156(p_lote_id);'),
    ('public.estornar_recebimento_item_pedido_interno(bigint,bigint,bigint,text)',
      $a$  for v_recebimento in$a$,
      'perform kontrol_private.exigir_escopo_interno_0156(p_pedido_id);'),
    ('public.estornar_recebimento_item_pedido_interno(bigint,bigint,bigint,text)',
      $a$    perform public.estornar_recebimento_lote($a$,
      'perform kontrol_private.exigir_escopo_interno_0156(p_pedido_id); perform kontrol_private.exigir_escopo_lote_0156(v_recebimento.lote_id);'),
    ('public.registrar_recebimento_por_leitura(bigint,bigint,bigint,integer,date,bigint,text,uuid)',
      $a$    return jsonb_set(v_evento.contexto->'resultado', '{repetido}', 'true'::jsonb, true);$a$,
      'perform kontrol_private.exigir_escopo_compra_0151(p_pedido_id); if v_evento.acao=''entrada_pedido_leitura'' then perform kontrol_private.exigir_escopo_leitura_compra_0156(v_evento.contexto); end if;'),
    ('public.registrar_recebimento_por_leitura(bigint,bigint,bigint,integer,date,bigint,text,uuid)',
      $a$  insert into public.scan_eventos ($a$,
      'perform kontrol_private.exigir_escopo_compra_0151(p_pedido_id);'),
    ('public.desfazer_leitura_estoque(uuid)',
      $a$  if exists (
    select 1 from public.scan_eventos e
    where e.acao = 'desfazer_leitura' and e.contexto->>'operacao_id' = p_operacao_id::text$a$,
      'if v_evento.acao=''entrada_pedido_leitura'' then perform kontrol_private.exigir_escopo_leitura_compra_0156(v_evento.contexto); end if;'),
    ('public.desfazer_leitura_estoque(uuid)',
      $a$    perform public.estornar_recebimento_do_lote(v_lote_id, 'leitura desfeita');$a$,
      'perform kontrol_private.exigir_escopo_leitura_compra_0156(v_evento.contexto);')
  ) ajustes(assinatura,ancora,guarda) loop
    v_def:=replace(pg_get_functiondef(r.assinatura::regprocedure),chr(13),'');
    if cardinality(string_to_array(v_def,r.ancora))<>2 then
      raise exception '0156 pós-lock: âncora divergente em %.',r.assinatura;
    end if;
    v_guarda:=case
      when r.assinatura like 'public.formalizar_pedido_interno(%'
        or r.assinatura like 'public.cancelar_pedido_interno_operacional(%'
        or r.assinatura like 'public.estornar_recebimento_item_pedido_interno(%'
        then '  perform kontrol_private.estabilizar_ator_0156(''interno'',p_pedido_id);'
      when r.assinatura like 'public.estornar_recebimento_lote(%'
        or r.assinatura like 'public.estornar_recebimento_do_lote(%'
        then '  perform kontrol_private.estabilizar_ator_0156(''lote'',p_lote_id);'
      when r.assinatura='public.desfazer_leitura_estoque(uuid)' then ''
      else '  perform kontrol_private.estabilizar_ator_0156(''compra'',p_pedido_id);' end || chr(10);
    if r.assinatura like 'public.estornar_recebimento_item_pedido_interno(%'
      and r.ancora like '%perform public.estornar_recebimento_lote(%' then
      v_guarda:=v_guarda||'  perform kontrol_private.estabilizar_ator_0156(''lote'',v_recebimento.lote_id);'||chr(10);
    end if;
    if r.assinatura='public.desfazer_leitura_estoque(uuid)'
      or r.assinatura like 'public.registrar_recebimento_por_leitura(%' then
      v_guarda:=v_guarda||'  if v_evento.acao=''entrada_pedido_leitura'' then
    perform kontrol_private.estabilizar_ator_0156(''compra'',(v_evento.contexto->>''pedido_id'')::bigint);
    perform kontrol_private.estabilizar_ator_0156(''lote'',(v_evento.contexto->>''lote_id'')::bigint);
  end if;'||chr(10);
    end if;
    v_guarda:=v_guarda||'  '||r.guarda||chr(10);
    if r.assinatura='public.desfazer_leitura_estoque(uuid)' then
      v_guarda:='  if v_evento.acao=''entrada_pedido_leitura'' then' || chr(10) || v_guarda || '  end if;' || chr(10);
    end if;
    -- Âncoras ficam após o teste FOUND da leitura bloqueante, nunca entre
    -- SELECT/PERFORM e seu IF FOUND. Não muda contagens/GET DIAGNOSTICS.
    execute replace(v_def,r.ancora,v_guarda||r.ancora);
  end loop;
end $pos_lock$;

commit;
