-- 0175 — devolução sem perder as aprovações (decisão D5 de 09/11/2026).
--
-- "A devolução volta ao solicitante; as aprovações valem, mas se mudou valor,
-- justificativa ou projeto, passa de novo pelo coordenador."
--
--   * Na validação do coordenador (em_validacao -> validado) o banco guarda a
--     foto do que foi aprovado: projeto, justificativa e valor (soma de
--     quantidade x cotação prévia dos itens).
--   * Pedido devolvido (ajuste_solicitante ou ajuste_compras) é reenviado pela
--     RPC reenviar_pedido_interno. Se valor, justificativa e projeto estão
--     iguais aos da foto, as aprovações continuam valendo e o pedido volta
--     direto para "validado" (material de laboratório: a aprovação do
--     laboratório também vale, se já tinha sido dada; se foi o laboratório que
--     devolveu, ele decide de novo). Se algo mudou, segue para validação como
--     antes, e a foto é descartada.
--   * Produto controlado sem projeto e urgência sem justificativa continuam
--     barrando o reenvio.
--   * reenvio_mantem_aprovacoes(pedido) diz à tela o que vai acontecer.
--   * O aviso da coordenação do laboratório não sai quando o laboratório já
--     aprovou, e o aviso de devolução explica a regra.
--
-- Não destrutiva: acrescenta quatro colunas que aceitam vazio, cria funções e
-- um gatilho, recria avisar_passagem_etapa (0173). Pedidos já validados recebem
-- a foto com os valores de hoje (o app ainda não está em uso real).
--
-- Rollback:
--   drop function public.reenviar_pedido_interno(bigint, text);
--   drop function public.reenvio_mantem_aprovacoes(bigint);
--   drop trigger pedidos_internos_guardar_validacao on public.pedidos_internos;
--   drop function kontrol_private.guardar_validacao_pedido();
--   drop function kontrol_private.valor_pedido_interno(bigint);
--   recriar kontrol_private.avisar_passagem_etapa() da 0173;
--   (só depois de exportar) alter table public.pedidos_internos drop column validacao_projeto_id,
--     drop column validacao_justificativa, drop column validacao_valor, drop column validacao_registrada_em;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regclass('public.responsaveis_compras') is null
     or to_regprocedure('kontrol_private.itens_controlados_pedido(bigint)') is null then
    raise exception '0175: requer as migrations 0173 e 0174';
  end if;
end $$;

-- ---- 1. Foto da validação ----------------------------------------------------------
alter table public.pedidos_internos
  add column if not exists validacao_projeto_id bigint,
  add column if not exists validacao_justificativa text,
  add column if not exists validacao_valor numeric(14, 2),
  add column if not exists validacao_registrada_em timestamptz;

comment on column public.pedidos_internos.validacao_projeto_id is
  '0175 (D5): projeto do pedido quando o coordenador validou. Gravado pelo banco.';
comment on column public.pedidos_internos.validacao_justificativa is
  '0175 (D5): justificativa quando o coordenador validou. Gravada pelo banco.';
comment on column public.pedidos_internos.validacao_valor is
  '0175 (D5): valor (quantidade x cotação prévia) quando o coordenador validou. Gravado pelo banco.';
comment on column public.pedidos_internos.validacao_registrada_em is
  '0175 (D5): quando a foto da validação foi gravada; vazio = reenvio passa de novo pela validação.';

create or replace function kontrol_private.valor_pedido_interno(p_pedido_id bigint)
returns numeric
language sql
stable
security definer
set search_path = ''
as $function$
  select round(coalesce(sum(coalesce(i.quantidade, 0) * coalesce(i.orcamento_previo, 0)), 0), 2)
    from public.pedidos_internos_itens i
   where i.pedido_interno_id = p_pedido_id
$function$;

revoke all on function kontrol_private.valor_pedido_interno(bigint) from public, anon;
grant execute on function kontrol_private.valor_pedido_interno(bigint) to authenticated, service_role;

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
    new.validacao_registrada_em := now();
    return new;
  end if;

  -- volta para validação: a foto antiga não vale mais
  if new.status = 'em_validacao' then
    new.validacao_projeto_id := null;
    new.validacao_justificativa := null;
    new.validacao_valor := null;
    new.validacao_registrada_em := null;
  end if;
  return new;
end $function$;

revoke all on function kontrol_private.guardar_validacao_pedido() from public, anon;

drop trigger if exists pedidos_internos_guardar_validacao on public.pedidos_internos;
create trigger pedidos_internos_guardar_validacao
  before update on public.pedidos_internos
  for each row execute function kontrol_private.guardar_validacao_pedido();

-- ---- 2. O que acontece no reenvio --------------------------------------------------
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
         p.validacao_projeto_id, p.validacao_justificativa, p.validacao_valor, p.validacao_registrada_em
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

-- ---- 3. Reenvio depois do ajuste ---------------------------------------------------
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
    format('Aprovações mantidas: valor, justificativa e projeto iguais aos da validação de %s.',
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

-- ---- 4. Avisos (recria a da 0173 com dois ajustes) ------------------------------------
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
  v_solicitante uuid;
  v_pedido text;
  v_admin_resp uuid;
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

  -- ---- pedido interno: cada passagem avisa quem age (e o solicitante nos marcos) ----
  if tg_table_name = 'pedidos_internos' then
    v_pedido := format('Pedido interno #%s: %s.', v_id, coalesce(v_novo_reg ->> 'titulo', 'sem título'));
    v_solicitante := kontrol_private.usuario_por_email(v_novo_reg ->> 'solicitante');
    -- etapas de compras: o responsável do administrativo (D8); sem ele, o Administrador (D3)
    v_admin_resp := kontrol_private.responsavel_compras('administrativo');

    if v_novo = 'em_validacao' then
      -- 0136 (D3): coordenador do projeto; 0169: sem projeto, a Supervisão.
      if nullif(v_novo_reg ->> 'projeto_id', '') is not null then
        select coordenador_id into v_usuario
          from public.projetos where id = (v_novo_reg ->> 'projeto_id')::bigint;
      else
        select pf.id into v_usuario
          from public.perfis pf
         where pf.papel = 'supervisor' and not coalesce(pf.suspenso, false)
         order by coalesce(pf.nome, pf.email)
         limit 1;
      end if;
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando validação',
        format('%s Solicitante: %s.', v_pedido, coalesce(v_novo_reg ->> 'solicitante', '—')),
        v_id, v_usuario, 'pedido.aprovar', v_chave);

    elsif v_novo = 'validado' and coalesce(v_novo_reg ->> 'natureza', '') = 'material_consumo_lab'
          and v_novo_reg ->> 'aprovacao_area_em' is null then
      select c.coordenador_id, c.nome into v_usuario, v_rotulo
        from public.coordenacoes_area c
       where c.id = nullif(v_novo_reg ->> 'area_id', '')::bigint;
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando a coordenação do laboratório',
        format('%s Laboratório: %s. O coordenador do projeto já validou.', v_pedido, coalesce(v_rotulo, 'não informado')),
        v_id, v_usuario, 'pedido.aprovar', v_chave);

    elsif v_novo = 'validado' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno validado: formalizar a compra',
        format('%s %s Formalize para seguir à autorização administrativa.', v_pedido,
               case when v_antigo in ('ajuste_solicitante', 'ajuste_compras')
                    then 'Reenviado depois do ajuste, com as aprovações mantidas.'
                    else 'O coordenador validou.' end),
        v_id, v_admin_resp, null, v_chave, 'admin');

    elsif v_novo in ('ajuste_solicitante', 'ajuste_compras') then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno devolvido para ajuste',
        format('%s Devolvido %s. Ajuste e reenvie: se valor, justificativa e projeto não mudarem, as aprovações continuam valendo.', v_pedido,
               case v_novo when 'ajuste_solicitante' then 'pela validação' else 'pelo administrativo' end),
        v_id, v_solicitante, null, v_chave);

    elsif v_novo in ('formalizado', 'analise_administrativa') and v_antigo is distinct from 'formalizado' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando autorização administrativa',
        format('%s Defina fonte e rubrica e autorize a compra.', v_pedido),
        v_id, v_admin_resp, null, v_chave, 'admin');

    elsif v_novo = 'aprovado_compra' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Compra autorizada: pedir os 3 orçamentos',
        format('%s Autorizado pelo administrativo (fonte: %s; rubrica: %s).', v_pedido,
               coalesce(v_novo_reg ->> 'fonte_recurso', '—'), coalesce(v_novo_reg ->> 'rubrica', '—')),
        v_id, v_admin_resp, null, v_chave, 'admin');

    elsif v_novo = 'orcamentos_recebidos' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Orçamentos recebidos: escolher o orçamento',
        format('%s Os 3 orçamentos foram registrados. Escolha um e envie para a aprovação final.', v_pedido),
        v_id, v_admin_resp, null, v_chave, 'admin');

    elsif v_novo = 'aguardando_aprovacao_final' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando aprovação final',
        format('%s Orçamento escolhido; falta a aprovação final da compra.', v_pedido),
        v_id, v_admin_resp, null, v_chave, 'admin');

    elsif v_novo = 'aprovado_para_compra' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Compra aprovada: fechar com o fornecedor',
        format('%s Feche com o fornecedor ou encaminhe à instituição.', v_pedido),
        v_id, v_admin_resp, null, v_chave, 'admin');
      perform kontrol_private.notificar_pedido('sistema', 'Seu pedido interno foi aprovado para compra',
        format('%s A compra foi aprovada.', v_pedido), v_id, v_solicitante, null, v_chave || ':solicitante');

    elsif v_novo in ('compra_fechada', 'encaminhado_instituicao') then
      perform kontrol_private.notificar_pedido('sistema', 'Seu pedido interno está a caminho',
        format('%s %s Quando chegar (ou o serviço for prestado), registre no pedido: o pagamento só sai depois disso.', v_pedido,
               case v_novo when 'compra_fechada' then 'A compra foi fechada com o fornecedor.' else 'Foi encaminhado à instituição.' end),
        v_id, v_solicitante, null, v_chave);

    elsif v_novo = 'aguardando_pagamento_nf' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando pagamento e nota fiscal',
        format('%s Entrega registrada. Faça o pagamento e anexe a nota fiscal.', v_pedido),
        v_id, kontrol_private.responsavel_compras('pagamento'), null, v_chave, 'admin');

    elsif v_novo = 'compra_concluida' then
      perform kontrol_private.notificar_pedido('sistema', 'Seu pedido interno foi concluído',
        format('%s Compra concluída e paga.', v_pedido), v_id, v_solicitante, null, v_chave);

    elsif v_novo = 'cancelado' then
      perform kontrol_private.notificar_pedido('sistema', 'Seu pedido interno foi cancelado',
        format('%s O motivo está no histórico do pedido.', v_pedido), v_id, v_solicitante, null, v_chave);
    end if;
    return null;
  end if;

  if tg_table_name = 'pedidos_compra' and v_novo = 'solicitado' then
    -- 0173: a compra que nasce de pedido interno é aprovada junto com ele (0170)
    if coalesce(v_novo_reg ->> 'observacao', '') like 'Formalizado a partir do pedido interno #%' then
      return null;
    end if;
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

revoke all on function kontrol_private.avisar_passagem_etapa() from public, anon, authenticated;
-- ---- 5. Pedidos já validados recebem a foto ------------------------------------------
do $$
declare
  v_n integer;
begin
  update public.pedidos_internos p
     set validacao_projeto_id = p.projeto_id,
         validacao_justificativa = p.justificativa,
         validacao_valor = kontrol_private.valor_pedido_interno(p.id),
         validacao_registrada_em = coalesce(p.validado_em, p.aprovado_coordenador_em, now())
   where p.validacao_registrada_em is null
     and p.status in ('validado', 'formalizado', 'analise_administrativa', 'aprovado_compra', 'orcamentos',
                      'orcamentos_recebidos', 'aguardando_aprovacao_final', 'aprovado_para_compra',
                      'compra_fechada', 'encaminhado_instituicao', 'aguardando_pagamento_nf');
  get diagnostics v_n = row_count;
  raise notice '0175: % pedido(s) já validado(s) receberam a foto da validação', v_n;
end $$;

commit;
