-- 0170 — caminho único da compra e entrega antes do pagamento.
--
-- Etapa 4 do plano de adaptação do fluxo de compras (decisões de Antonio em
-- 09/11/2026):
--
--   * D7 (unificar pedido interno e compra formal): a compra formal que nasce
--     de um pedido interno deixa de ter aprovação própria. Quando o pedido
--     chega a "Aprovado para compra", a compra ligada a ele é aprovada junto,
--     com registro na linha do tempo da compra. O caminho único é o pedido;
--     a compra continua guardando fornecedor, envio, prazo e recebimento.
--     Compras ligadas que ficaram "solicitadas" com o pedido já aprovado são
--     acertadas aqui (o app ainda não está em uso real; autorizado em 09/11).
--   * D6 (pagamento só depois que o produto chega ou o serviço é prestado):
--     o pedido só passa a "Aguardando pagamento/NF" (e a "Compra concluída")
--     com a entrega registrada:
--       - materiais e equipamentos: todos recebidos (recebido_em, como hoje);
--       - serviços (e pedidos sem item físico): entrega confirmada no pedido
--         (RPC confirmar_entrega_pedido_interno, com quem e quando);
--       - diária: paga antes da viagem, sem essa exigência;
--       - exceção só com acordo específico registrado
--         (RPC registrar_excecao_pagamento, com justificativa, quem e quando).
--
-- Não destrutiva: acrescenta colunas que aceitam vazio, funções e gatilhos.
-- Nada é apagado; RLS e auditoria preservadas (aud_pedidos_internos grava a
-- linha inteira, então as colunas novas entram na auditoria sozinhas).
--
-- Rollback:
--   drop trigger pedidos_internos_aprovar_compra_ligada on public.pedidos_internos;
--   drop trigger pedidos_internos_exigir_entrega on public.pedidos_internos;
--   drop function kontrol_private.aprovar_compra_ligada();
--   drop function kontrol_private.exigir_entrega_antes_pagamento();
--   drop function public.confirmar_entrega_pedido_interno(bigint, text);
--   drop function public.registrar_excecao_pagamento(bigint, text);
--   drop function public.pendencia_pagamento_pedido_interno(bigint);
--   drop function kontrol_private.pendencia_pagamento(bigint);
--   (só depois de exportar, se houver dados) alter table public.pedidos_internos
--     drop column entrega_confirmada_em, drop column entrega_confirmada_por,
--     drop column entrega_observacao, drop column excecao_pagamento,
--     drop column excecao_pagamento_por, drop column excecao_pagamento_em;
--   As compras acertadas pelo passo 4 ficam com o evento "Aprovada junto com
--   o pedido interno" na linha do tempo; voltar a "solicitado" exige decisão.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $$
begin
  if to_regprocedure('kontrol_private.exigir_competencia_pedido()') is null then
    raise exception '0170: requer a migration 0169';
  end if;
end $$;

-- ---- 1. Colunas ------------------------------------------------------------------
alter table public.pedidos_internos
  add column if not exists entrega_confirmada_em timestamptz,
  add column if not exists entrega_confirmada_por text,
  add column if not exists entrega_observacao text,
  add column if not exists excecao_pagamento text,
  add column if not exists excecao_pagamento_por text,
  add column if not exists excecao_pagamento_em timestamptz;

alter table public.pedidos_internos
  drop constraint if exists pedidos_internos_textos_0170_check,
  add constraint pedidos_internos_textos_0170_check check (
    coalesce(char_length(entrega_observacao), 0) <= 1000
    and coalesce(char_length(excecao_pagamento), 0) <= 1000
  );

comment on column public.pedidos_internos.entrega_confirmada_em is
  '0170: serviço prestado ou entrega confirmada (pedidos com serviço ou sem item físico). Gravado só pela RPC confirmar_entrega_pedido_interno.';
comment on column public.pedidos_internos.excecao_pagamento is
  '0170: acordo específico que permite pagar antes da entrega, com a justificativa. Gravado só pela RPC registrar_excecao_pagamento.';

-- ---- 2. O que falta para pagar ----------------------------------------------------
-- Uma regra só, usada pelo gatilho e pela tela. Devolve null quando pode pagar.
create or replace function kontrol_private.pendencia_pagamento(p_pedido_id bigint)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_natureza text;
  v_recebido_em timestamptz;
  v_entrega_em timestamptz;
  v_excecao_em timestamptz;
  v_tem_fisico boolean;
  v_tem_servico boolean;
begin
  select pi.natureza, pi.recebido_em, pi.entrega_confirmada_em, pi.excecao_pagamento_em
    into v_natureza, v_recebido_em, v_entrega_em, v_excecao_em
    from public.pedidos_internos pi where pi.id = p_pedido_id;
  if not found then
    return 'Pedido interno não encontrado.';
  end if;
  -- diária é paga antes da viagem; acordo registrado libera o pagamento
  if coalesce(v_natureza, '') = 'diaria' or v_excecao_em is not null then
    return null;
  end if;

  select exists (select 1 from public.pedidos_internos_itens i
                  where i.pedido_interno_id = p_pedido_id and i.tipo in ('material', 'equipamento')),
         exists (select 1 from public.pedidos_internos_itens i
                  where i.pedido_interno_id = p_pedido_id and coalesce(i.tipo, '') not in ('material', 'equipamento'))
    into v_tem_fisico, v_tem_servico;

  if v_tem_fisico and v_recebido_em is null then
    return 'Pagamento só depois do recebimento: registre a chegada de todos os materiais e equipamentos do pedido.';
  end if;
  if (v_tem_servico or not v_tem_fisico) and v_entrega_em is null then
    return 'Pagamento só depois que o serviço for prestado ou a entrega for confirmada: use "Confirmar entrega" no pedido.';
  end if;
  return null;
end $function$;

revoke all on function kontrol_private.pendencia_pagamento(bigint) from public, anon;
grant execute on function kontrol_private.pendencia_pagamento(bigint) to authenticated, service_role;

-- Leitura para a tela: só para quem enxerga o pedido (RLS).
create or replace function public.pendencia_pagamento_pedido_interno(p_pedido_id bigint)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if not exists (select 1 from public.pedidos_internos where id = p_pedido_id) then
    return null;
  end if;
  return kontrol_private.pendencia_pagamento(p_pedido_id);
end $function$;

revoke all on function public.pendencia_pagamento_pedido_interno(bigint) from public, anon;
grant execute on function public.pendencia_pagamento_pedido_interno(bigint) to authenticated, service_role;

-- ---- 3. O banco exige a entrega antes do pagamento --------------------------------
-- SECURITY INVOKER: current_user = 'authenticated' identifica a alteração
-- direta pela API; as RPCs (dono) gravam as marcas.
create or replace function kontrol_private.exigir_entrega_antes_pagamento()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_pendencia text;
begin
  if current_user = 'authenticated' and (
       new.entrega_confirmada_em is distinct from old.entrega_confirmada_em
       or new.entrega_confirmada_por is distinct from old.entrega_confirmada_por
       or new.entrega_observacao is distinct from old.entrega_observacao
       or new.excecao_pagamento is distinct from old.excecao_pagamento
       or new.excecao_pagamento_por is distinct from old.excecao_pagamento_por
       or new.excecao_pagamento_em is distinct from old.excecao_pagamento_em) then
    raise exception 'Entrega e exceção de pagamento só são registradas pelos botões do pedido.'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     and new.status in ('aguardando_pagamento_nf', 'compra_concluida')
     and old.status not in ('aguardando_pagamento_nf', 'compra_concluida') then
    v_pendencia := kontrol_private.pendencia_pagamento(new.id);
    if v_pendencia is not null then
      raise exception '%', v_pendencia using errcode = '22023';
    end if;
  end if;
  return new;
end $function$;

revoke all on function kontrol_private.exigir_entrega_antes_pagamento() from public, anon;

drop trigger if exists pedidos_internos_exigir_entrega on public.pedidos_internos;
create trigger pedidos_internos_exigir_entrega
  before update on public.pedidos_internos
  for each row execute function kontrol_private.exigir_entrega_antes_pagamento();

-- ---- 4. Confirmar entrega (serviço prestado) --------------------------------------
create or replace function public.confirmar_entrega_pedido_interno(
  p_pedido_id bigint,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text;
  v_status text;
  v_entrega timestamptz;
  v_obs text := nullif(btrim(coalesce(p_observacao, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Entre no Kontrol para confirmar a entrega.' using errcode = '42501';
  end if;
  if not (kontrol_private.tem_permissao_efetiva('recebimento.registrar')
          or kontrol_private.tem_permissao_efetiva('pedido.aprovar')) then
    raise exception 'Confirmar a entrega exige a permissão "Registrar recebimento" ou "Aprovar pedidos internos".'
      using errcode = '42501';
  end if;
  begin
    v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_email := null;
  end;

  select pi.status, pi.entrega_confirmada_em into v_status, v_entrega
    from public.pedidos_internos pi where pi.id = p_pedido_id for update;
  if not found then
    raise exception 'Pedido interno não encontrado.' using errcode = 'P0002';
  end if;
  if v_status not in ('aprovado_para_compra', 'compra_fechada', 'encaminhado_instituicao') then
    raise exception 'A entrega só é confirmada depois que a compra é aprovada e antes do pagamento.'
      using errcode = '22023';
  end if;
  if v_entrega is not null then
    raise exception 'A entrega deste pedido já foi confirmada.' using errcode = '22023';
  end if;
  if exists (select 1 from public.pedidos_internos_itens i
              where i.pedido_interno_id = p_pedido_id
                and i.tipo in ('material', 'equipamento') and i.recebido_em is null) then
    raise exception 'Ainda há materiais ou equipamentos sem recebimento. Registre a chegada deles em Recebimento.'
      using errcode = '22023';
  end if;

  update public.pedidos_internos
     set entrega_confirmada_em = now(),
         entrega_confirmada_por = coalesce(v_email, auth.uid()::text),
         entrega_observacao = v_obs
   where id = p_pedido_id;
  insert into public.pedidos_internos_aprovacoes (
    pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino)
  values (p_pedido_id, 'Entrega confirmada (serviço prestado)', 'registrado', v_email, public.current_papel(), v_obs,
          v_status, v_status);
  insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('pedido_interno', p_pedido_id, v_status, v_status, v_email,
          coalesce('Entrega confirmada: ' || v_obs, 'Entrega confirmada.'));
  return jsonb_build_object('pedido_id', p_pedido_id, 'entrega_confirmada', true);
end $function$;

revoke all on function public.confirmar_entrega_pedido_interno(bigint, text) from public, anon;
grant execute on function public.confirmar_entrega_pedido_interno(bigint, text) to authenticated;

-- ---- 5. Exceção: pagar antes da entrega, só com acordo registrado -----------------
create or replace function public.registrar_excecao_pagamento(
  p_pedido_id bigint,
  p_justificativa text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text;
  v_status text;
  v_excecao timestamptz;
  v_texto text := nullif(btrim(coalesce(p_justificativa, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Entre no Kontrol para registrar a exceção.' using errcode = '42501';
  end if;
  perform kontrol_private.exigir_permissao('pedido.aprovar');
  if v_texto is null or char_length(v_texto) < 15 then
    raise exception 'Descreva o acordo que permite pagar antes da entrega (com quem, o quê e por quê).'
      using errcode = '22023';
  end if;
  begin
    v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_email := null;
  end;

  select pi.status, pi.excecao_pagamento_em into v_status, v_excecao
    from public.pedidos_internos pi where pi.id = p_pedido_id for update;
  if not found then
    raise exception 'Pedido interno não encontrado.' using errcode = 'P0002';
  end if;
  if v_status not in ('aprovado_para_compra', 'compra_fechada', 'encaminhado_instituicao') then
    raise exception 'A exceção de pagamento só é registrada depois que a compra é aprovada e antes do pagamento.'
      using errcode = '22023';
  end if;
  if v_excecao is not null then
    raise exception 'Este pedido já tem exceção de pagamento registrada.' using errcode = '22023';
  end if;

  update public.pedidos_internos
     set excecao_pagamento = left(v_texto, 1000),
         excecao_pagamento_por = coalesce(v_email, auth.uid()::text),
         excecao_pagamento_em = now()
   where id = p_pedido_id;
  insert into public.pedidos_internos_aprovacoes (
    pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino)
  values (p_pedido_id, 'Exceção: pagamento antes da entrega (acordo registrado)', 'registrado', v_email,
          public.current_papel(), left(v_texto, 1000), v_status, v_status);
  insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('pedido_interno', p_pedido_id, v_status, v_status, v_email,
          left('Exceção de pagamento antes da entrega: ' || v_texto, 1000));
  return jsonb_build_object('pedido_id', p_pedido_id, 'excecao_registrada', true);
end $function$;

revoke all on function public.registrar_excecao_pagamento(bigint, text) from public, anon;
grant execute on function public.registrar_excecao_pagamento(bigint, text) to authenticated;

-- ---- 6. Caminho único: a compra ligada é aprovada junto com o pedido --------------
create or replace function kontrol_private.aprovar_compra_ligada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ator text;
  v_compra record;
begin
  if new.status is not distinct from old.status or new.status <> 'aprovado_para_compra' then
    return null;
  end if;
  begin
    v_ator := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_ator := null;
  end;
  v_ator := coalesce(v_ator, 'pedido interno #' || new.id);

  for v_compra in
    select pc.id
      from public.pedidos_compra pc
     where pc.status = 'solicitado'
       and (pc.id = new.pedido_compra_id
            or exists (select 1
                         from public.pedidos_compra_itens ci
                         join public.pedidos_internos_itens pii on pii.id = ci.pedido_interno_item_id
                        where ci.pedido_id = pc.id and pii.pedido_interno_id = new.id))
       -- todos os pedidos internos de origem já liberados
       and not exists (
         select 1 from public.pedidos_internos pi
          where pi.status <> 'cancelado'
            and pi.id <> new.id
            and pi.status not in ('aprovado_para_compra', 'compra_fechada', 'encaminhado_instituicao',
                                  'aguardando_pagamento_nf', 'compra_concluida')
            and (pi.pedido_compra_id = pc.id
                 or exists (select 1
                              from public.pedidos_compra_itens ci
                              join public.pedidos_internos_itens pii on pii.id = ci.pedido_interno_item_id
                             where ci.pedido_id = pc.id and pii.pedido_interno_id = pi.id)))
     for update of pc
  loop
    perform set_config('app.pedido_compra_transicao', 'permitida', true);
    update public.pedidos_compra
       set status = 'aprovado',
           aprovador = v_ator,
           data_aprovacao = current_date
     where id = v_compra.id;
    perform set_config('app.pedido_compra_transicao', '', true);
    insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
    values ('pedido_compra', v_compra.id, 'solicitado', 'aprovado', v_ator,
            format('Aprovada junto com o pedido interno #%s (caminho único: a aprovação é feita no pedido).', new.id));
  end loop;
  return null;
end $function$;

revoke all on function kontrol_private.aprovar_compra_ligada() from public, anon, authenticated;

drop trigger if exists pedidos_internos_aprovar_compra_ligada on public.pedidos_internos;
create trigger pedidos_internos_aprovar_compra_ligada
  after update of status on public.pedidos_internos
  for each row execute function kontrol_private.aprovar_compra_ligada();

-- Acerto das compras ligadas que ficaram "solicitadas" com o pedido já liberado.
do $$
declare
  v_compra record;
  v_n integer := 0;
begin
  for v_compra in
    select distinct pc.id, pi.id as pedido_id
      from public.pedidos_compra pc
      join public.pedidos_internos pi on pi.pedido_compra_id = pc.id
     where pc.status = 'solicitado'
       and pi.status in ('aprovado_para_compra', 'compra_fechada', 'encaminhado_instituicao',
                         'aguardando_pagamento_nf', 'compra_concluida')
       and not exists (
         select 1 from public.pedidos_internos outro
          where outro.pedido_compra_id = pc.id and outro.status <> 'cancelado'
            and outro.status not in ('aprovado_para_compra', 'compra_fechada', 'encaminhado_instituicao',
                                     'aguardando_pagamento_nf', 'compra_concluida'))
  loop
    perform set_config('app.pedido_compra_transicao', 'permitida', true);
    update public.pedidos_compra
       set status = 'aprovado',
           aprovador = coalesce(aprovador, 'migration 0170'),
           data_aprovacao = coalesce(data_aprovacao, current_date)
     where id = v_compra.id and status = 'solicitado';
    perform set_config('app.pedido_compra_transicao', '', true);
    insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
    values ('pedido_compra', v_compra.id, 'solicitado', 'aprovado', 'migration 0170',
            format('Aprovada junto com o pedido interno #%s (acerto do caminho único, 0170).', v_compra.pedido_id));
    v_n := v_n + 1;
  end loop;
  raise notice '0170: % compra(s) ligada(s) acertada(s) para "aprovado"', v_n;
end $$;

notify pgrst, 'reload schema';

commit;
