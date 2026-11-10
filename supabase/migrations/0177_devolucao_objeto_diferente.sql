-- 0177 — devolução: objeto diferente pede nova aprovação; "ciclo de compras".
--
-- Ajuste da 0175 (decisão D5 de 09/11/2026) pedido por Antonio em 10/11/2026:
-- "não tratar uma aprovação antiga como autorização para um objeto diferente".
--
-- A 0175 guardava, na validação do coordenador, projeto, justificativa e valor
-- (soma de quantidade x cotação prévia). Um pedido devolvido podia trocar o
-- item, a quantidade ou a especificação mantendo o mesmo total, e as aprovações
-- continuavam valendo. Agora a foto da validação guarda também a marca dos
-- itens (insumo, tipo, especificação, modelo, volume, características,
-- exigência técnica, quantidade e unidade). No reenvio:
--   * itens, valor, justificativa e projeto iguais aos da validação: as
--     aprovações continuam valendo (como na 0175);
--   * qualquer um deles mudou: o pedido passa de novo pelo coordenador.
-- Fornecedor sugerido, outros fornecedores, exclusividade e observação do item
-- não entram na marca: não mudam o objeto aprovado.
--
-- Pedido que já estava devolvido para ajuste antes desta migration não tem a
-- marca dos itens aprovados: no reenvio ele passa de novo pelo coordenador (não
-- há como provar que o objeto é o mesmo).
--
-- Nome do ciclo: a mensagem da trava do ciclo seguinte (0176) dizia "ciclo de
-- pagamento". O ciclo do dia 10 organiza solicitações e compras; a mensagem
-- passa a dizer "ciclo de compras". A coluna pedidos_internos.ciclo_pagamento
-- mantém o nome (só o comentário muda); nenhuma regra do ciclo muda.
--
-- Não destrutiva: uma coluna que aceita vazio e uma função nova; recria
-- guardar_validacao_pedido, reenvio_mantem_aprovacoes e reenviar_pedido_interno
-- (0175) e travar_ciclo_seguinte (0176) mantendo tudo o que faziam. Permissões
-- das funções recriadas ficam como estavam (create or replace preserva grants).
-- Nada é apagado; RLS e auditoria preservadas (aud_pedidos_internos grava a
-- linha inteira, então a coluna nova entra na auditoria sozinha).
--
-- Rollback:
--   reaplicar kontrol_private.guardar_validacao_pedido(),
--     public.reenvio_mantem_aprovacoes(bigint) e
--     public.reenviar_pedido_interno(bigint, text) da 0175 e
--     kontrol_private.travar_ciclo_seguinte() da 0176;
--   drop function kontrol_private.marca_itens_pedido_interno(bigint);
--   (só depois de exportar) alter table public.pedidos_internos drop column validacao_itens.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regprocedure('kontrol_private.ciclo_libera_em(date,text,text)') is null
     or to_regprocedure('public.reenviar_pedido_interno(bigint,text)') is null then
    raise exception '0177: requer as migrations 0175 e 0176';
  end if;
end $$;

-- ---- 1. Marca dos itens aprovados ---------------------------------------------------
alter table public.pedidos_internos
  add column if not exists validacao_itens text;

comment on column public.pedidos_internos.validacao_itens is
  '0177: marca (md5) dos itens que o coordenador validou: insumo, tipo, especificação, modelo, volume, características, exigência técnica, quantidade e unidade. Gravada pelo banco; vazia em pedido devolvido antes da 0177.';
comment on column public.pedidos_internos.ciclo_pagamento is
  '0172 (D1): mês do ciclo de compras do dia 10 (primeiro dia do mês; o nome da coluna vem da 0172). Gravado pelo banco na última aprovação de coordenação: até o dia 10 (sábado/domingo vão para a segunda) é o ciclo do mês; depois, o seguinte. Urgência justificada fica no ciclo do mês.';

-- Texto sem diferença de maiúsculas e de espaços: "Kit  X" e "kit x" são o mesmo objeto.
create or replace function kontrol_private.marca_itens_pedido_interno(p_pedido_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select md5(coalesce(string_agg(t.linha, E'\n' order by t.linha), ''))
    from (
      select concat_ws('|',
               coalesce(i.insumo_id::text, ''),
               coalesce(i.tipo, ''),
               lower(regexp_replace(btrim(coalesce(i.especificacao, '')), '\s+', ' ', 'g')),
               lower(regexp_replace(btrim(coalesce(i.modelo, '')), '\s+', ' ', 'g')),
               lower(regexp_replace(btrim(coalesce(i.volume, '')), '\s+', ' ', 'g')),
               lower(regexp_replace(btrim(coalesce(i.caracteristicas, '')), '\s+', ' ', 'g')),
               lower(regexp_replace(btrim(coalesce(i.exigencia_tecnica, '')), '\s+', ' ', 'g')),
               trim_scale(coalesce(i.quantidade, 0))::text,
               lower(btrim(coalesce(i.unidade, '')))) as linha
        from public.pedidos_internos_itens i
       where i.pedido_interno_id = p_pedido_id) t
$function$;

revoke all on function kontrol_private.marca_itens_pedido_interno(bigint) from public, anon;
grant execute on function kontrol_private.marca_itens_pedido_interno(bigint) to authenticated, service_role;

-- ---- 2. Foto da validação com a marca dos itens --------------------------------------
create or replace function kontrol_private.guardar_validacao_pedido()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_user = 'authenticated' and (
       new.validacao_projeto_id is distinct from old.validacao_projeto_id
       or new.validacao_justificativa is distinct from old.validacao_justificativa
       or new.validacao_valor is distinct from old.validacao_valor
       or new.validacao_itens is distinct from old.validacao_itens
       or new.validacao_registrada_em is distinct from old.validacao_registrada_em) then
    raise exception 'A foto da validação é gravada pelo sistema.' using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  -- validação do coordenador: guarda o que foi aprovado
  if old.status = 'em_validacao' and new.status = 'validado' then
    new.validacao_projeto_id := new.projeto_id;
    new.validacao_justificativa := new.justificativa;
    new.validacao_valor := kontrol_private.valor_pedido_interno(new.id);
    new.validacao_itens := kontrol_private.marca_itens_pedido_interno(new.id);
    new.validacao_registrada_em := now();
    return new;
  end if;

  -- volta para validação: a foto antiga não vale mais
  if new.status = 'em_validacao' then
    new.validacao_projeto_id := null;
    new.validacao_justificativa := null;
    new.validacao_valor := null;
    new.validacao_itens := null;
    new.validacao_registrada_em := null;
  end if;
  return new;
end $function$;

revoke all on function kontrol_private.guardar_validacao_pedido() from public, anon;

-- ---- 3. O que acontece no reenvio ---------------------------------------------------
create or replace function public.reenvio_mantem_aprovacoes(p_pedido_id bigint)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_p record;
  v_valor numeric;
  v_mudou text[] := array[]::text[];
begin
  select p.id, p.status, p.projeto_id, p.justificativa, p.natureza, p.aprovacao_area_em,
         p.validacao_projeto_id, p.validacao_justificativa, p.validacao_valor, p.validacao_itens,
         p.validacao_registrada_em
    into v_p
    from public.pedidos_internos p
   where p.id = p_pedido_id;
  if not found then
    return null;
  end if;

  select round(coalesce(sum(coalesce(i.quantidade, 0) * coalesce(i.orcamento_previo, 0)), 0), 2)
    into v_valor
    from public.pedidos_internos_itens i
   where i.pedido_interno_id = p_pedido_id;

  if v_p.validacao_registrada_em is null then
    return jsonb_build_object(
      'mantem', false, 'mudou', '[]'::jsonb, 'motivo', 'sem_validacao',
      'valor_atual', v_valor, 'valor_validado', null, 'validado_em', null,
      'aguarda_laboratorio', false);
  end if;

  -- objeto diferente (item, quantidade ou especificação) não herda a aprovação;
  -- sem a marca (pedido devolvido antes da 0177) não há como provar que é o mesmo
  if v_p.validacao_itens is null
     or kontrol_private.marca_itens_pedido_interno(p_pedido_id) is distinct from v_p.validacao_itens then
    v_mudou := array_append(v_mudou, 'itens');
  end if;
  if v_valor is distinct from v_p.validacao_valor then
    v_mudou := array_append(v_mudou, 'valor');
  end if;
  if nullif(btrim(coalesce(v_p.justificativa, '')), '') is distinct from nullif(btrim(coalesce(v_p.validacao_justificativa, '')), '') then
    v_mudou := array_append(v_mudou, 'justificativa');
  end if;
  if v_p.projeto_id is distinct from v_p.validacao_projeto_id then
    v_mudou := array_append(v_mudou, 'projeto');
  end if;

  return jsonb_build_object(
    'mantem', cardinality(v_mudou) = 0,
    'mudou', to_jsonb(v_mudou),
    'motivo', case when cardinality(v_mudou) = 0 then 'igual' else 'mudou' end,
    'valor_atual', v_valor,
    'valor_validado', v_p.validacao_valor,
    'validado_em', v_p.validacao_registrada_em,
    'aguarda_laboratorio', cardinality(v_mudou) = 0
                           and coalesce(v_p.natureza, '') = 'material_consumo_lab'
                           and v_p.aprovacao_area_em is null);
end $function$;

revoke all on function public.reenvio_mantem_aprovacoes(bigint) from public, anon;
grant execute on function public.reenvio_mantem_aprovacoes(bigint) to authenticated, service_role;

-- ---- 4. Reenvio depois do ajuste (só muda o texto do registro) -------------------------
create or replace function public.reenviar_pedido_interno(p_pedido_id bigint, p_observacao text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text;
  v_status text;
  v_projeto_id bigint;
  v_urgencia text;
  v_urg_just text;
  v_sit jsonb;
  v_obs text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_comentario text;
  v_resultado jsonb;
begin
  perform kontrol_private.exigir_permissao('pedido.criar');
  begin
    v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_email := null;
  end;

  select p.status, p.projeto_id, p.urgencia, p.urgencia_justificativa
    into v_status, v_projeto_id, v_urgencia, v_urg_just
    from public.pedidos_internos p
   where p.id = p_pedido_id
   for update;
  if not found then
    raise exception 'Pedido interno não encontrado.' using errcode = 'P0002';
  end if;
  if v_status not in ('ajuste_solicitante', 'ajuste_compras') then
    raise exception 'Só pedido devolvido para ajuste é reenviado.' using errcode = '22023';
  end if;

  v_sit := public.reenvio_mantem_aprovacoes(p_pedido_id);

  -- algo mudou (ou não há validação anterior): segue para validação como antes;
  -- produto controlado sem projeto também vai pela validação, que barra.
  if not coalesce((v_sit ->> 'mantem')::boolean, false)
     or (v_projeto_id is null and kontrol_private.itens_controlados_pedido(p_pedido_id) is not null) then
    v_resultado := public.registrar_etapa_pedido_interno(
      p_pedido_id, 'em_validacao', 'Lista de materiais', 'registrado', v_obs);
    return v_resultado || jsonb_build_object('aprovacoes_mantidas', false, 'mudou', v_sit -> 'mudou');
  end if;

  -- as regras do envio que não dependem das aprovações continuam valendo
  if coalesce(v_urgencia, 'normal') in ('alta', 'critica')
     and char_length(btrim(coalesce(v_urg_just, ''))) < 15 then
    raise exception 'Pedido urgente fura o ciclo do dia 10 e precisa de justificativa: escreva por que não pode esperar o próximo ciclo.'
      using errcode = '22023';
  end if;

  v_comentario := concat_ws(' ',
    format('Aprovações mantidas: itens, valor, justificativa e projeto iguais aos da validação de %s.',
           to_char((v_sit ->> 'validado_em')::timestamptz at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')),
    case when (v_sit ->> 'aguarda_laboratorio')::boolean then 'Volta para a coordenação do laboratório.' end,
    v_obs);

  perform set_config('app.pedido_interno_transicao', 'permitida', true);
  update public.pedidos_internos
     set status = 'validado', enviado_validacao_em = now()
   where id = p_pedido_id;
  perform set_config('app.pedido_interno_transicao', '', true);

  insert into public.pedidos_internos_aprovacoes (
    pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino)
  values (p_pedido_id, 'Reenvio depois do ajuste', 'registrado', v_email, public.current_papel(), v_comentario,
          v_status, 'validado');
  insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('pedido_interno', p_pedido_id, v_status, 'validado', v_email, v_comentario);

  return jsonb_build_object('status_origem', v_status, 'status_destino', 'validado',
                            'aprovacoes_mantidas', true,
                            'aguarda_laboratorio', (v_sit ->> 'aguarda_laboratorio')::boolean);
end $function$;

revoke all on function public.reenviar_pedido_interno(bigint, text) from public, anon;
grant execute on function public.reenviar_pedido_interno(bigint, text) to authenticated, service_role;

-- ---- 5. Trava do ciclo seguinte: o nome é "ciclo de compras" ---------------------------
-- SECURITY INVOKER de propósito: current_user = 'authenticated' identifica a
-- alteração direta pela API (dentro das RPCs, current_user é o dono).
create or replace function kontrol_private.travar_ciclo_seguinte()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_libera date;
begin
  if current_user = 'authenticated'
     and old.status not in ('rascunho', 'ajuste_solicitante', 'ajuste_compras')
     and (coalesce(new.urgencia, 'normal') is distinct from coalesce(old.urgencia, 'normal')
          or nullif(btrim(coalesce(new.urgencia_justificativa, '')), '')
             is distinct from nullif(btrim(coalesce(old.urgencia_justificativa, '')), '')) then
    raise exception 'A urgência só muda com o pedido em rascunho ou devolvido para ajuste. Para mudar, devolva o pedido ao solicitante.'
      using errcode = '42501';
  end if;

  if new.status is not distinct from old.status
     or old.status <> 'validado'
     or new.status in ('ajuste_solicitante', 'ajuste_compras', 'em_validacao', 'cancelado') then
    return new;
  end if;

  v_libera := kontrol_private.ciclo_libera_em(new.ciclo_pagamento, new.urgencia, new.urgencia_justificativa);
  if v_libera is not null then
    raise exception 'Este pedido entrou no ciclo de compras de % porque foi aprovado depois do prazo do dia 10. Ele segue para compras a partir de %. Só pedido urgente, com justificativa, fura o ciclo.',
      kontrol_private.rotulo_ciclo(v_libera), to_char(v_libera, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  return new;
end $function$;

revoke all on function kontrol_private.travar_ciclo_seguinte() from public, anon;

-- ---- 6. Pedidos já validados recebem a marca dos itens --------------------------------
-- Só quem está validado ou adiante: os itens de hoje são os que foram aprovados.
-- Pedido devolvido para ajuste fica sem a marca e passa de novo pelo coordenador.
do $$
declare
  v_n integer;
begin
  update public.pedidos_internos p
     set validacao_itens = kontrol_private.marca_itens_pedido_interno(p.id)
   where p.validacao_registrada_em is not null
     and p.validacao_itens is null
     and p.status in ('validado', 'formalizado', 'analise_administrativa', 'aprovado_compra', 'orcamentos',
                      'orcamentos_recebidos', 'aguardando_aprovacao_final', 'aprovado_para_compra',
                      'compra_fechada', 'encaminhado_instituicao', 'aguardando_pagamento_nf');
  get diagnostics v_n = row_count;
  raise notice '0177: % pedido(s) já validado(s) receberam a marca dos itens aprovados', v_n;
end $$;

commit;
