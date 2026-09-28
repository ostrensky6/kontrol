-- 0136 — decisões D2, D3, D5 e D7 do dono (28/09/2026; auditoria onda 2).
--
-- D3: o coordenador do projeto passa a ser um usuário (projetos.coordenador_id),
--     preenchido a partir do e-mail antigo quando ele bate com um usuário. Os
--     campos de texto ficam como reserva. O aviso "Pedido interno aguardando
--     validação" vai para o coordenador (sem coordenador: para quem aprova).
-- D2: quem pediu não valida nem aprova o próprio pedido interno nem a própria
--     compra — salvo o coordenador do projeto (ou administrador).
-- D5: a categoria coordenador ganha "Bloquear e descartar lotes".
-- D7: campanha de inventário pode ser fechada (com as diferenças já ajustadas);
--     contagem nova só em campanha aberta. Sem limite de valor para o ajuste
--     (dono, 28/09): toda diferença é mostrada e alertada no app, de qualquer tamanho.
--
-- Não apaga nada. Rollback: recriar transicionar_pedido_interno (0131),
-- transicionar_pedido_compra (0132) e avisar_passagem_etapa (0128); drop das
-- funções/gatilho novos; projetos.coordenador_id pode ficar (sem uso) ou sair com drop column.

begin;

-- ---- D3: coordenador como usuário ------------------------------------------------
alter table public.projetos
  add column if not exists coordenador_id uuid references public.perfis(id) on delete set null;
create index if not exists projetos_coordenador_id_idx on public.projetos (coordenador_id);
comment on column public.projetos.coordenador_id is
  'Coordenador do projeto (usuário). Recebe o aviso de validação e pode validar/aprovar o próprio pedido (D2/D3, 0136).';

-- e-mail antigo que bate com um usuário vira o vínculo
update public.projetos p
   set coordenador_id = pf.id
  from public.perfis pf
 where p.coordenador_id is null
   and lower(pf.email) = lower(coalesce(
         nullif(btrim(p.coordenador_email), ''),
         case when position('@' in coalesce(p.coordenador, '')) > 0 then btrim(p.coordenador) end));

-- ---- D2: autoaprovação -----------------------------------------------------------
create or replace function kontrol_private.pode_decidir_proprio_pedido(p_solicitante text, p_projeto_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select lower(btrim(coalesce(p_solicitante, ''))) is distinct from lower(coalesce(auth.jwt() ->> 'email', '-'))
      or public.current_papel() = 'admin'
      or exists (
           select 1 from public.projetos pr
            where pr.id = p_projeto_id and pr.coordenador_id = auth.uid());
$function$;

revoke all on function kontrol_private.pode_decidir_proprio_pedido(text, bigint) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.transicionar_pedido_interno(p_pedido_id bigint, p_status_destino text, p_etapa text, p_decisao text, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status_origem text;
  v_solicitante text;
  v_projeto_id bigint;
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
begin
  if p_status_destino = 'em_validacao' then
    perform kontrol_private.exigir_permissao('pedido.criar');
  else
    perform kontrol_private.exigir_permissao('pedido.aprovar');
  end if;

  if p_decisao not in ('aprovado', 'reprovado', 'devolvido', 'registrado') then
    raise exception 'Decisao de aprovacao invalida.' using errcode = '22023';
  end if;

  select status, solicitante, projeto_id
    into v_status_origem, v_solicitante, v_projeto_id
  from pedidos_internos
  where id = p_pedido_id
  for update;

  if not found then
    raise exception 'Pedido interno nao encontrado.' using errcode = 'P0002';
  end if;

  -- 0136 (D2): quem pediu não valida nem aprova o próprio pedido, a não ser que
  -- seja o coordenador do projeto (ou administrador).
  if p_status_destino in ('validado', 'aprovado_para_compra')
     and not kontrol_private.pode_decidir_proprio_pedido(v_solicitante, v_projeto_id) then
    raise exception 'Quem pediu não pode validar nem aprovar o próprio pedido. Peça ao coordenador do projeto ou a outra pessoa com a permissão.'
      using errcode = '42501';
  end if;

  if not (
    (v_status_origem in ('rascunho', 'ajuste_solicitante', 'ajuste_compras') and p_status_destino = 'em_validacao')
    or (v_status_origem = 'em_validacao' and p_status_destino in ('validado', 'ajuste_solicitante'))
    or (v_status_origem = 'validado' and p_status_destino = 'formalizado')
    or (v_status_origem = 'formalizado' and p_status_destino = 'analise_administrativa')
    or (v_status_origem = 'analise_administrativa' and p_status_destino in ('aprovado_compra', 'ajuste_compras'))
    or (v_status_origem = 'aprovado_compra' and p_status_destino = 'orcamentos')
    or (v_status_origem = 'orcamentos' and p_status_destino = 'orcamentos_recebidos')
    or (v_status_origem = 'orcamentos_recebidos' and p_status_destino = 'aguardando_aprovacao_final')
    or (v_status_origem = 'aguardando_aprovacao_final' and p_status_destino = 'aprovado_para_compra')
    or (v_status_origem = 'aprovado_para_compra' and p_status_destino in ('compra_fechada', 'encaminhado_instituicao'))
    or (v_status_origem in ('compra_fechada', 'encaminhado_instituicao') and p_status_destino = 'aguardando_pagamento_nf')
    or (v_status_origem = 'aguardando_pagamento_nf' and p_status_destino = 'compra_concluida')
  ) then
    raise exception 'Transicao de status nao permitida: % -> %.', v_status_origem, p_status_destino
      using errcode = '22023';
  end if;

  perform set_config('app.pedido_interno_transicao', 'permitida', true);

  update pedidos_internos
     set status = p_status_destino
   where id = p_pedido_id;

  insert into pedidos_internos_aprovacoes(
    pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino
  )
  values (
    p_pedido_id,
    coalesce(nullif(btrim(p_etapa), ''), p_status_destino),
    p_decisao,
    v_email,
    current_papel(),
    nullif(btrim(p_observacao), ''),
    v_status_origem,
    p_status_destino
  );

  insert into eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('pedido_interno', p_pedido_id, v_status_origem, p_status_destino, v_email, nullif(btrim(p_observacao), ''));

  return jsonb_build_object('status_origem', v_status_origem, 'status_destino', p_status_destino);
end $function$;

CREATE OR REPLACE FUNCTION public.transicionar_pedido_compra(p_pedido_id bigint, p_status_destino text, p_observacao text DEFAULT NULL::text, p_data_prevista_entrega date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pedido record;
  v_claims jsonb;
  v_ator text;
  v_tem_recebimento boolean;
  v_interno bigint;
  v_internos bigint[];
  v_tudo_recebido boolean;
  v_bloqueio record;
begin
  perform kontrol_private.exigir_permissao(case when p_status_destino = 'cancelado' then 'compras.cancelar' else 'compras.aprovar' end);

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), nullif(v_claims->>'sub', ''));
  if v_ator is null then
    raise exception 'Contexto JWT do ator e obrigatorio para transicionar a compra.' using errcode = '42501';
  end if;

  select id, status, solicitante, projeto_id
    into v_pedido
  from public.pedidos_compra
  where id = p_pedido_id
  for update;

  if not found then
    raise exception 'Pedido de compra nao encontrado.' using errcode = 'P0002';
  end if;

  -- 0136 (D2): quem pediu a compra não a aprova, salvo o coordenador do projeto (ou admin).
  if p_status_destino = 'aprovado'
     and not kontrol_private.pode_decidir_proprio_pedido(v_pedido.solicitante, v_pedido.projeto_id) then
    raise exception 'Quem pediu a compra não pode aprová-la. Peça ao coordenador do projeto ou a outra pessoa com a permissão.'
      using errcode = '42501';
  end if;

  if not (
    (v_pedido.status = 'solicitado' and p_status_destino = 'aprovado') or
    (v_pedido.status = 'aprovado' and p_status_destino = 'enviado') or
    (v_pedido.status = 'enviado' and p_status_destino = 'em_transito') or
    (v_pedido.status in ('solicitado', 'aprovado', 'enviado', 'em_transito') and p_status_destino = 'cancelado') or
    (v_pedido.status in ('aprovado', 'enviado', 'em_transito') and p_status_destino = 'recebido')
  ) then
    raise exception 'Transicao de status nao permitida: % -> %.', v_pedido.status, p_status_destino
      using errcode = '22023';
  end if;

  -- 0130 (D1): compra que nasceu de pedido interno só anda depois que o pedido
  -- chega a "Aprovado para compra". Compra sem pedido interno (rascunho de
  -- reposição, compra criada em Compras, pendência de outra compra) segue a
  -- regra própria: basta a permissão de aprovar compras.
  if p_status_destino in ('aprovado', 'enviado', 'em_transito') then
    select pi.id, pi.status into v_bloqueio
    from public.pedidos_internos pi
    where pi.status <> 'cancelado'
      and (pi.pedido_compra_id = p_pedido_id
           or exists (
             select 1
             from public.pedidos_compra_itens ci
             join public.pedidos_internos_itens pii on pii.id = ci.pedido_interno_item_id
             where ci.pedido_id = p_pedido_id and pii.pedido_interno_id = pi.id))
      and pi.status not in ('aprovado_para_compra', 'compra_fechada', 'encaminhado_instituicao',
                            'aguardando_pagamento_nf', 'compra_concluida')
    order by pi.id
    limit 1;
    if found then
      raise exception 'Esta compra vem do pedido interno #%, que está em "%". Ela só pode ser aprovada ou enviada depois que o pedido chegar a "Aprovado para compra".',
        v_bloqueio.id, kontrol_private.rotulo_status_pedido_interno(v_bloqueio.status)
        using errcode = '22023';
    end if;
  end if;

  -- 0130: encerrar com pendência exige destino para o que faltou; só a RPC
  -- encerrar_compra_com_pendencia chega aqui com essa marca.
  if p_status_destino = 'recebido'
     and coalesce(current_setting('app.encerramento_com_destino', true), '') <> 'sim' then
    raise exception 'Para encerrar a compra com pendência, use "Encerrar com pendência" e escolha o destino do que faltou.'
      using errcode = '22023';
  end if;

  select exists (
      select 1
      from public.pedidos_compra_item_recebimentos r
      where r.pedido_compra_id = p_pedido_id
        and r.estornado_em is null
        and r.quantidade > 0
    ) or exists (
      select 1
      from public.pedidos_internos_item_recebimentos r
      join public.pedidos_compra_itens i on i.id = r.pedido_compra_item_id
      where i.pedido_id = p_pedido_id
        and r.estornado_em is null
        and r.quantidade > 0
    ) or exists (
      select 1 from public.pedidos_compra_itens
      where pedido_id = p_pedido_id and lote_id is not null
    )
    into v_tem_recebimento;

  if p_status_destino = 'cancelado' and v_tem_recebimento then
    raise exception 'Pedido com recebimento parcial ou total nao pode ser cancelado. Use "Encerrar com pendência".' using errcode = '22023';
  end if;

  if p_status_destino = 'recebido' then
    if not v_tem_recebimento then
      raise exception 'Nada foi recebido nesta compra; para desistir dela, cancele.' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_observacao, '')), '') is null then
      raise exception 'Informe por que a compra será encerrada com itens pendentes.' using errcode = '22023';
    end if;
    update public.pedidos_compra_itens
       set divergencia_recebimento = left(
             'Encerrado com pendência: recebido '
               || coalesce(quantidade_recebida, 0) || ' de ' || quantidade
               || '. Motivo: ' || btrim(p_observacao), 500)
     where pedido_id = p_pedido_id
       and coalesce(quantidade_recebida, case when lote_id is not null then quantidade else 0 end) < quantidade;

    -- Decisão do dono (EST2-7): o pedido interno de origem conclui o
    -- recebimento com a pendência registrada em cada item não recebido.
    with afetados as (
      update public.pedidos_internos_itens pii
         set divergencia_recebimento = left(
               'Compra #' || p_pedido_id || ' encerrada com pendência: recebido '
                 || coalesce(pii.quantidade_recebida, 0) || ' de ' || pii.quantidade
                 || '. Motivo: ' || btrim(p_observacao), 500),
             recebido_em = now(),
             recebido_por = v_ator
        from public.pedidos_compra_itens ci
       where ci.pedido_id = p_pedido_id
         and ci.pedido_interno_item_id = pii.id
         and pii.recebido_em is null
      returning pii.pedido_interno_id
    )
    select coalesce(array_agg(distinct pedido_interno_id), '{}') into v_internos from afetados;

    foreach v_interno in array v_internos
    loop
      select not exists (
        select 1 from public.pedidos_internos_itens
        where pedido_interno_id = v_interno
          and tipo = 'material' and recebido_em is null
      ) into v_tudo_recebido;
      update public.pedidos_internos
         set recebido_em = case when v_tudo_recebido then coalesce(recebido_em, now()) else recebido_em end,
             recebido_por = case when v_tudo_recebido then coalesce(recebido_por, v_ator) else recebido_por end
       where id = v_interno;
      insert into public.eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
      select 'pedido_interno', p.id, p.status, p.status, v_ator,
             left('Recebimento concluído com pendência: a compra #' || p_pedido_id
               || ' foi encerrada. Motivo: ' || btrim(p_observacao), 1000)
      from public.pedidos_internos p where p.id = v_interno;
    end loop;
  end if;

  perform set_config('app.pedido_compra_transicao', 'permitida', true);
  update public.pedidos_compra
     set status = p_status_destino,
         aprovador = case when p_status_destino = 'aprovado' then v_ator else aprovador end,
         data_aprovacao = case when p_status_destino = 'aprovado' then current_date else data_aprovacao end,
         data_prevista_entrega = case
           when p_status_destino = 'aprovado' then p_data_prevista_entrega
           -- 0132: ao sair para o fornecedor a tramitação acabou; a previsão
           -- passa a ser o envio + prazo do fornecedor, informada pelo app.
           when p_status_destino = 'enviado' and p_data_prevista_entrega is not null
             then p_data_prevista_entrega
           else data_prevista_entrega
         end
   where id = p_pedido_id;

  insert into public.eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
  values (
    'pedido_compra', p_pedido_id, v_pedido.status, p_status_destino, v_ator,
    case when p_status_destino = 'recebido'
      then 'Encerrada com pendência: ' || btrim(p_observacao)
      else p_observacao
    end
  );

  return jsonb_build_object(
    'status_origem', v_pedido.status,
    'status_destino', p_status_destino,
    'data_prevista_entrega', p_data_prevista_entrega
  );
end $function$;

-- compra de pendência: mesma pessoa que pediu a compra original (D2)
create or replace function public.encerrar_compra_com_pendencia(
  p_pedido_id bigint,
  p_destino text,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_claims jsonb;
  v_ator text;
  v_compra record;
  v_nova bigint;
  v_itens int := 0;
  v_rotulo text;
begin
  perform kontrol_private.exigir_permissao('compras.aprovar');

  if p_destino is null or p_destino not in ('nova_compra', 'desistencia', 'atendido_outra_forma') then
    raise exception 'Escolha o destino do que faltou: nova compra, desistência ou atendido de outra forma.'
      using errcode = '22023';
  end if;
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'Explique o motivo (pelo menos 3 letras).' using errcode = '22023';
  end if;

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), nullif(v_claims->>'sub', ''));
  if v_ator is null then
    raise exception 'Contexto JWT do ator e obrigatorio para encerrar a compra.' using errcode = '42501';
  end if;

  select id, status, fornecedor_id, projeto, projeto_id, solicitante into v_compra
  from pedidos_compra where id = p_pedido_id
  for update;
  if not found then
    raise exception 'Pedido de compra nao encontrado.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from pedidos_compra_itens i
    where i.pedido_id = p_pedido_id
      and i.quantidade - coalesce(i.quantidade_recebida, case when i.lote_id is not null then i.quantidade else 0 end) > 0
  ) then
    raise exception 'Nada ficou pendente nesta compra.' using errcode = '22023';
  end if;

  v_rotulo := case p_destino
    when 'nova_compra' then 'Nova compra'
    when 'desistencia' then 'Desistência'
    else 'Atendido de outra forma'
  end;

  if p_destino = 'nova_compra' then
    insert into pedidos_compra(fornecedor_id, projeto, projeto_id, status, solicitante, observacao, compra_origem_id)
    -- 0136 (D2): a continuação herda quem pediu os itens, não quem encerrou
    values (v_compra.fornecedor_id, v_compra.projeto, v_compra.projeto_id, 'solicitado', coalesce(nullif(btrim(v_compra.solicitante), ''), v_ator),
            left('Pendência da compra #' || p_pedido_id || ': ' || v_motivo, 500), p_pedido_id)
    returning id into v_nova;

    insert into pedidos_compra_itens(pedido_id, insumo_id, quantidade, quantidade_em, conteudo_embalagem, custo_unitario_estimado)
    select v_nova, i.insumo_id,
           i.quantidade - coalesce(i.quantidade_recebida, case when i.lote_id is not null then i.quantidade else 0 end),
           i.quantidade_em, i.conteudo_embalagem, i.custo_unitario_estimado
    from pedidos_compra_itens i
    where i.pedido_id = p_pedido_id
      and i.quantidade - coalesce(i.quantidade_recebida, case when i.lote_id is not null then i.quantidade else 0 end) > 0
    order by i.id;
    get diagnostics v_itens = row_count;
  end if;

  update pedidos_compra_itens i
     set quantidade_nao_atendida = i.quantidade - coalesce(i.quantidade_recebida, case when i.lote_id is not null then i.quantidade else 0 end),
         destino_pendencia = p_destino,
         compra_pendencia_id = v_nova
   where i.pedido_id = p_pedido_id
     and i.quantidade - coalesce(i.quantidade_recebida, case when i.lote_id is not null then i.quantidade else 0 end) > 0;

  perform set_config('app.encerramento_com_destino', 'sim', true);
  perform transicionar_pedido_compra(
    p_pedido_id, 'recebido',
    v_rotulo || case when v_nova is not null then ' (compra #' || v_nova || ')' else '' end || ': ' || v_motivo
  );
  perform set_config('app.encerramento_com_destino', '', true);

  if v_nova is not null then
    insert into eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
    values ('pedido_compra', v_nova, null, 'solicitado', v_ator,
            left('Criada para repor o que faltou na compra #' || p_pedido_id || ': ' || v_motivo, 1000));
  end if;

  return jsonb_build_object(
    'pedido_compra_id', p_pedido_id,
    'destino', p_destino,
    'nova_compra_id', v_nova,
    'itens_nova_compra', v_itens
  );
end $function$;

-- ---- D3: aviso de validação para o coordenador -----------------------------------
create or replace function kontrol_private.avisar_passagem_etapa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_coluna text := coalesce(nullif(tg_argv[0], ''), 'status');
  v_novo_reg jsonb := to_jsonb(new);
  v_novo text;
  v_antigo text;
  v_id bigint := (to_jsonb(new) ->> 'id')::bigint;
  v_permissao text;
  v_titulo text;
  v_corpo text;
  v_entidade_tipo text;
  v_entidade_id bigint := (to_jsonb(new) ->> 'id')::bigint;
  v_chave text;
  v_rotulo text;
  v_usuario uuid;
begin
  v_novo := v_novo_reg ->> v_coluna;
  if tg_op = 'UPDATE' then
    v_antigo := to_jsonb(old) ->> v_coluna;
  end if;
  if v_novo is null or v_novo is not distinct from v_antigo then
    return null;
  end if;
  v_chave := format('etapa:%s:%s:%s:%s', tg_table_name, v_id, v_novo,
    (extract(epoch from clock_timestamp()) * 1000)::bigint);

  if tg_table_name = 'pedidos_internos' and v_novo = 'em_validacao' then
    -- 0136 (D3): com coordenador cadastrado como usuário, o aviso vai para ele;
    -- sem coordenador, para quem tem a permissão de aprovar.
    select coordenador_id into v_usuario
      from public.projetos where id = nullif(v_novo_reg ->> 'projeto_id', '')::bigint;
    v_permissao := case when v_usuario is null then 'pedido.aprovar' end;
    v_titulo := 'Pedido interno aguardando validação';
    v_corpo := format('Pedido interno #%s: %s. Solicitante: %s.', v_id,
      coalesce(v_novo_reg ->> 'titulo', 'sem título'), coalesce(v_novo_reg ->> 'solicitante', '—'));
    v_entidade_tipo := 'pedido_interno';
  elsif tg_table_name = 'pedidos_compra' and v_novo = 'solicitado' then
    v_permissao := 'compras.aprovar';
    v_titulo := 'Compra aguardando aprovação';
    v_corpo := format('Compra #%s solicitada%s.', v_id,
      coalesce(' para ' || nullif(v_novo_reg ->> 'projeto', ''), ''));
    v_entidade_tipo := 'pedido_compra';
  elsif tg_table_name = 'pedidos_compra' and v_novo in ('aprovado', 'enviado') then
    v_permissao := 'compras.receber';
    v_titulo := case v_novo when 'aprovado' then 'Compra aprovada: acompanhe até o recebimento'
      else 'Compra enviada: prepare o recebimento' end;
    v_corpo := format('Compra #%s está %s.', v_id, case v_novo when 'aprovado' then 'aprovada' else 'enviada' end);
    v_entidade_tipo := 'pedido_compra';
  elsif tg_table_name = 'lotes_estoque' and v_novo = 'quarentena' then
    v_permissao := 'estoque.lote.aceitar';
    select especificacao into v_rotulo from public.insumos where id = (v_novo_reg ->> 'insumo_id')::bigint;
    v_titulo := 'Lote em quarentena aguardando aceite';
    v_corpo := format('Lote %s de %s aguarda conferência e aceite.',
      coalesce(v_novo_reg ->> 'codigo_lote', '#' || v_id), coalesce(v_rotulo, 'insumo'));
    v_entidade_tipo := 'lote';
    v_chave := format('etapa:lotes_estoque:%s:quarentena', v_id);
  elsif tg_table_name = 'orcamentos' and v_novo = 'revisado' then
    v_permissao := 'orcamentos.emitir';
    v_titulo := 'Módulo laboratorial revisado: proposta pronta para emissão';
    v_corpo := format('O orçamento de análises #%s foi revisado.', v_id);
    if v_novo_reg ->> 'demanda_id' is not null then
      v_entidade_tipo := 'demanda';
      v_entidade_id := (v_novo_reg ->> 'demanda_id')::bigint;
    else
      v_entidade_tipo := 'orcamento';
    end if;
  elsif tg_table_name = 'orcamento_projetos' and v_novo = 'enviado' then
    v_permissao := 'orcamentos.emitir';
    v_titulo := 'Custos de projeto revisados: proposta pronta para emissão';
    v_corpo := format('Os custos de projeto #%s foram revisados.', v_id);
    if v_novo_reg ->> 'demanda_id' is not null then
      v_entidade_tipo := 'demanda';
      v_entidade_id := (v_novo_reg ->> 'demanda_id')::bigint;
    else
      v_entidade_tipo := 'orcamento_projeto';
    end if;
  else
    return null;
  end if;

  begin
    insert into public.notificacoes (tipo, titulo, corpo, entidade_tipo, entidade_id, permissao_destino, usuario_destino, dedupe_key)
    values ('aprovacao_pendente', v_titulo, v_corpo, v_entidade_tipo, v_entidade_id, v_permissao, v_usuario, v_chave)
    on conflict do nothing;
  exception when others then
    raise warning 'Kontrol: aviso de etapa não gravado (% #%): %', tg_table_name, v_id, sqlerrm;
  end;
  return null;
end $function$;

-- ---- D5: coordenador bloqueia e descarta lotes -----------------------------------
update public.permissoes_categorias
   set permissoes = coalesce(permissoes, '{}'::jsonb) || '{"estoque.descartar_bloquear": true}'::jsonb,
       atualizado_em = now()
 where papel = 'coordenador';

-- ---- D7: inventário --------------------------------------------------------------
-- contagem nova só em campanha aberta (o app já conferia; agora o banco também)
create or replace function kontrol_private.exigir_ciclo_inventario_aberto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.inventario_ciclos where id = new.ciclo_id and status = 'aberto') then
    raise exception 'A campanha de inventário #% não está aberta: não recebe contagem nova.', new.ciclo_id
      using errcode = '22023';
  end if;
  return new;
end $function$;

revoke all on function kontrol_private.exigir_ciclo_inventario_aberto() from public, anon, authenticated;
drop trigger if exists trg_contagem_em_ciclo_aberto on public.inventario_contagens;
create trigger trg_contagem_em_ciclo_aberto
  before insert on public.inventario_contagens
  for each row execute function kontrol_private.exigir_ciclo_inventario_aberto();

create or replace function public.fechar_ciclo_inventario(p_ciclo_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ciclo record;
  v_pendentes integer;
  v_contagens integer;
  v_ajustes integer;
  v_responsavel text := coalesce(nullif(auth.jwt() ->> 'email', ''), nullif(auth.uid()::text, ''), current_user);
begin
  perform kontrol_private.exigir_permissao('estoque.lote.gerir');

  select id, status into v_ciclo from public.inventario_ciclos where id = p_ciclo_id for update;
  if not found then
    raise exception 'Campanha de inventário não encontrada.' using errcode = 'P0002';
  end if;
  if v_ciclo.status <> 'aberto' then
    raise exception 'A campanha de inventário já está %.', v_ciclo.status using errcode = '22023';
  end if;

  select count(*) filter (where not ajuste_aplicado and abs(divergencia) > 0.000001),
         count(*),
         count(*) filter (where ajuste_aplicado)
    into v_pendentes, v_contagens, v_ajustes
    from public.inventario_contagens where ciclo_id = p_ciclo_id;
  if v_pendentes > 0 then
    raise exception 'Há % contagem(ns) com diferença sem ajuste aplicado. Aplique os ajustes antes de fechar a campanha.', v_pendentes
      using errcode = '22023';
  end if;

  update public.inventario_ciclos set status = 'fechado', fechado_em = now() where id = p_ciclo_id;
  insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('inventario_ciclo', p_ciclo_id, 'aberto', 'fechado', v_responsavel,
          format('Campanha fechada: %s contagem(ns), %s ajuste(s) aplicado(s).', v_contagens, v_ajustes));

  return jsonb_build_object('ciclo_id', p_ciclo_id, 'contagens', v_contagens, 'ajustes', v_ajustes);
end $function$;

revoke all on function public.fechar_ciclo_inventario(bigint) from public, anon;
grant execute on function public.fechar_ciclo_inventario(bigint) to authenticated;

commit;
