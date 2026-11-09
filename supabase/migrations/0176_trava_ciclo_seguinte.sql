-- 0176 — trava do ciclo seguinte.
--
-- Decisão de Antonio em 09/11/2026 (20:58 UTC), sobre a 0172 (D1): o pedido
-- aprovado depois do prazo do dia 10 entra no ciclo do mês seguinte e só segue
-- para compras quando esse ciclo abrir; a urgência justificada fura a trava.
--
--   * O pedido validado do ciclo seguinte não sai de "validado" para compras
--     antes do dia 1 do mês do ciclo (horário de Brasília). Devolver ao
--     solicitante e cancelar continuam livres.
--   * Urgência alta ou crítica, com justificativa, fura a trava (a 0172 já põe
--     o pedido urgente no ciclo do mês).
--   * A urgência só muda com o pedido em rascunho ou devolvido para ajuste: sem
--     isso, mudar a urgência de um pedido validado contornaria a trava.
--   * "Aguardando você" do administrativo não mostra o pedido travado; ele
--     aparece no dia em que o ciclo abre.
--   * O aviso de validação (e o de aprovação do laboratório) diz quando a
--     formalização abre; no dia 1, uma rotina agendada avisa o responsável do
--     administrativo de cada pedido liberado.
--   * Feriados continuam fora da conta (não houve decisão sobre eles).
--
-- Não destrutiva: funções, um gatilho e uma rotina agendada; recria
-- avisar_passagem_etapa (da 0175), avisar_marcos_pedido e aguardando_voce (da
-- 0173) mantendo tudo o que elas faziam.
--
-- Rollback:
--   select cron.unschedule('kontrol-ciclo-aberto');
--   drop trigger pedidos_internos_travar_ciclo on public.pedidos_internos;
--   drop function kontrol_private.travar_ciclo_seguinte();
--   drop function kontrol_private.avisar_ciclo_aberto();
--   reaplicar kontrol_private.avisar_passagem_etapa() da 0175 e
--     kontrol_private.avisar_marcos_pedido() e public.aguardando_voce() da 0173;
--   drop function kontrol_private.ciclo_libera_em(date, text, text);
--   drop function kontrol_private.rotulo_ciclo(date);
--   drop function kontrol_private.hoje_brasilia();

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $$
begin
  if to_regprocedure('public.reenviar_pedido_interno(bigint,text)') is null then
    raise exception '0176: requer a migration 0175';
  end if;
end $$;

-- ---- 1. Regras da trava ----------------------------------------------------------------
-- Hoje em Brasília (a mesma referência da 0172).
create or replace function kontrol_private.hoje_brasilia()
returns date
language sql
stable
set search_path = ''
as $function$
  select (now() at time zone 'America/Sao_Paulo')::date
$function$;

-- "novembro/2026"
create or replace function kontrol_private.rotulo_ciclo(p_ciclo date)
returns text
language sql
immutable
set search_path = ''
as $function$
  select (array['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
                'setembro', 'outubro', 'novembro', 'dezembro'])[extract(month from p_ciclo)::integer]
         || '/' || extract(year from p_ciclo)::integer
$function$;

-- Dia em que o pedido pode seguir para compras; vazio quando já pode.
create or replace function kontrol_private.ciclo_libera_em(p_ciclo date, p_urgencia text, p_justificativa text)
returns date
language sql
stable
set search_path = ''
as $function$
  select case
           when p_ciclo is null then null
           when coalesce(p_urgencia, 'normal') in ('alta', 'critica')
                and char_length(btrim(coalesce(p_justificativa, ''))) >= 15 then null
           when p_ciclo > kontrol_private.hoje_brasilia() then p_ciclo
           else null
         end
$function$;

revoke all on function kontrol_private.hoje_brasilia() from public, anon;
revoke all on function kontrol_private.rotulo_ciclo(date) from public, anon;
revoke all on function kontrol_private.ciclo_libera_em(date, text, text) from public, anon;
grant execute on function kontrol_private.hoje_brasilia() to authenticated, service_role;
grant execute on function kontrol_private.rotulo_ciclo(date) to authenticated, service_role;
grant execute on function kontrol_private.ciclo_libera_em(date, text, text) to authenticated, service_role;

-- ---- 2. Gatilho: o pedido do ciclo seguinte não sai de "validado" ---------------------
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
    raise exception 'Este pedido entrou no ciclo de pagamento de % porque foi aprovado depois do prazo do dia 10. Ele segue para compras a partir de %. Só pedido urgente, com justificativa, fura o ciclo.',
      kontrol_private.rotulo_ciclo(v_libera), to_char(v_libera, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  return new;
end $function$;

revoke all on function kontrol_private.travar_ciclo_seguinte() from public, anon;

drop trigger if exists pedidos_internos_travar_ciclo on public.pedidos_internos;
create trigger pedidos_internos_travar_ciclo
  before update on public.pedidos_internos
  for each row execute function kontrol_private.travar_ciclo_seguinte();

-- ---- 3. Avisos: validação e laboratório dizem quando a formalização abre ---------------
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
  v_libera date;
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

    elsif v_novo = 'validado'
          and kontrol_private.ciclo_libera_em(nullif(v_novo_reg ->> 'ciclo_pagamento', '')::date,
                v_novo_reg ->> 'urgencia', v_novo_reg ->> 'urgencia_justificativa') is not null then
      -- 0176: aprovado depois do prazo do dia 10: só segue quando o ciclo dele abrir
      v_libera := kontrol_private.ciclo_libera_em(nullif(v_novo_reg ->> 'ciclo_pagamento', '')::date,
                    v_novo_reg ->> 'urgencia', v_novo_reg ->> 'urgencia_justificativa');
      perform kontrol_private.notificar_pedido('sistema',
        format('Pedido interno validado: aguarda o ciclo de %s', kontrol_private.rotulo_ciclo(v_libera)),
        format('%s %s Aprovado depois do prazo do dia 10, entrou no ciclo de %s: a formalização abre em %s, e você recebe outro aviso nesse dia.',
               v_pedido,
               case when v_antigo in ('ajuste_solicitante', 'ajuste_compras')
                    then 'Reenviado depois do ajuste, com as aprovações mantidas.'
                    else 'O coordenador validou.' end,
               kontrol_private.rotulo_ciclo(v_libera), to_char(v_libera, 'DD/MM/YYYY')),
        v_id, v_admin_resp, null, v_chave, 'admin');

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

create or replace function kontrol_private.avisar_marcos_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pedido text := format('Pedido interno #%s: %s.', new.id, coalesce(new.titulo, 'sem título'));
  v_libera date;
begin
  -- laboratório aprovou: o pedido pode ser formalizado (0176: ou espera o ciclo dele abrir)
  v_libera := kontrol_private.ciclo_libera_em(new.ciclo_pagamento, new.urgencia, new.urgencia_justificativa);
  if new.aprovacao_area_em is not null and old.aprovacao_area_em is null and new.status = 'validado'
     and v_libera is not null then
    perform kontrol_private.notificar_pedido('sistema',
      format('Laboratório aprovou: aguarda o ciclo de %s', kontrol_private.rotulo_ciclo(v_libera)),
      format('%s A coordenação do laboratório aprovou depois do prazo do dia 10: o pedido entrou no ciclo de %s, e a formalização abre em %s. Você recebe outro aviso nesse dia.',
             v_pedido, kontrol_private.rotulo_ciclo(v_libera), to_char(v_libera, 'DD/MM/YYYY')),
      new.id, kontrol_private.responsavel_compras('administrativo'), null,
      format('marco:pedido:%s:laboratorio:%s', new.id, new.aprovacao_area_em), 'admin');
  elsif new.aprovacao_area_em is not null and old.aprovacao_area_em is null and new.status = 'validado' then
    perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Laboratório aprovou: formalizar a compra',
      format('%s A coordenação do laboratório aprovou. Formalize para seguir à autorização administrativa.', v_pedido),
      new.id, kontrol_private.responsavel_compras('administrativo'), null,
      format('marco:pedido:%s:laboratorio:%s', new.id, new.aprovacao_area_em), 'admin');
  end if;

  -- entrega registrada: o pedido pode ir para pagamento
  if new.status in ('compra_fechada', 'encaminhado_instituicao')
     and ((new.recebido_em is not null and old.recebido_em is null)
          or (new.entrega_confirmada_em is not null and old.entrega_confirmada_em is null)
          or (new.excecao_pagamento_em is not null and old.excecao_pagamento_em is null))
     and kontrol_private.pendencia_pagamento(new.id) is null then
    perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Entrega registrada: pedido pronto para pagamento',
      format('%s %s Siga para "Aguardar pagamento/NF".', v_pedido,
             case when new.excecao_pagamento_em is not null and old.excecao_pagamento_em is null
                  then 'Exceção registrada: pagamento antes da entrega.' else 'A entrega foi registrada.' end),
      new.id, kontrol_private.responsavel_compras('pagamento'), null,
      format('marco:pedido:%s:pagamento:%s', new.id, (extract(epoch from clock_timestamp()) * 1000)::bigint), 'admin');
  end if;
  return null;
end $function$;

revoke all on function kontrol_private.avisar_marcos_pedido() from public, anon, authenticated;

-- ---- 4. No dia 1, o administrativo é avisado dos pedidos do ciclo que abriu ------------
create or replace function kontrol_private.avisar_ciclo_aberto()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ciclo date := date_trunc('month', kontrol_private.hoje_brasilia())::date;
  v_resp uuid := kontrol_private.responsavel_compras('administrativo');
  v_n integer := 0;
  r record;
begin
  for r in
    select p.id, p.titulo
      from public.pedidos_internos p
     -- roda no dia 1 às 07:00: o pedido validado do ciclo do mês estava travado
     -- (o aviso se repete só se a rotina rodar de novo no mesmo ciclo; a chave evita)
     where p.status = 'validado'
       and p.ciclo_pagamento = v_ciclo
       and (coalesce(p.natureza, '') <> 'material_consumo_lab' or p.aprovacao_area_em is not null)
     order by p.id
  loop
    perform kontrol_private.notificar_pedido('aprovacao_pendente',
      format('Ciclo de %s aberto: formalizar a compra', kontrol_private.rotulo_ciclo(v_ciclo)),
      format('Pedido interno #%s: %s. Aprovado depois do prazo do dia 10, entrou no ciclo de %s, que abriu hoje. Formalize para seguir à autorização administrativa.',
             r.id, coalesce(r.titulo, 'sem título'), kontrol_private.rotulo_ciclo(v_ciclo)),
      r.id, v_resp, null, format('ciclo-aberto:pedido:%s:%s', r.id, v_ciclo), 'admin');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;

revoke all on function kontrol_private.avisar_ciclo_aberto() from public, anon, authenticated, service_role;

-- Dia 1, 07:00 em Brasília (10:00 UTC), antes do envio diário de e-mails (10:15 UTC).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'kontrol-ciclo-aberto';
    perform cron.schedule(
      'kontrol-ciclo-aberto',
      '0 10 1 * *',
      $cron$select kontrol_private.avisar_ciclo_aberto();$cron$
    );
  else
    raise notice '0176: pg_cron ausente; agende kontrol_private.avisar_ciclo_aberto() no dia 1 de cada mês.';
  end if;
end $$;

-- ---- 5. "Aguardando você": o pedido travado aparece quando o ciclo abrir ----------------
create or replace function public.aguardando_voce()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_saida jsonb := '[]'::jsonb;
  v_qtd bigint;
  v_itens jsonb;
  v_uid uuid := auth.uid();
  v_admin boolean := coalesce(public.current_papel(), '') = 'admin';
begin
  if v_uid is null then
    return v_saida;
  end if;

  -- 0173: validação só para quem decide (coordenador competente ou Administrador)
  with minhas as (
    select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo,
           coalesce(p.enviado_validacao_em, p.atualizado_em, p.criado_em) as desde
      from public.pedidos_internos p
     where p.status = 'em_validacao'
       and (v_admin or coalesce(
             (kontrol_private.aprovadores_pedido(p.projeto_id, p.natureza, p.area_id) -> 'coordenador' -> 'ids') ? v_uid::text,
             false))
  )
  select (select count(*) from minhas),
         coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                     from (select id, rotulo from minhas order by desde limit 3) s), '[]'::jsonb)
    into v_qtd, v_itens;
  if v_qtd > 0 or kontrol_private.tem_permissao_efetiva('pedido.aprovar') then
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_validacao', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  -- 0173: coordenação do laboratório (coordenador ou substituto)
  with minhas as (
    select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo, p.atualizado_em as desde
      from public.pedidos_internos p
      join public.coordenacoes_area c on c.id = p.area_id
     where p.status = 'validado' and p.natureza = 'material_consumo_lab' and p.aprovacao_area_em is null
       and (v_admin or v_uid in (c.coordenador_id, c.substituto_id))
  )
  select (select count(*) from minhas),
         coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                     from (select id, rotulo from minhas order by desde limit 3) s), '[]'::jsonb)
    into v_qtd, v_itens;
  if v_qtd > 0 then
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_laboratorio', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  -- 0173: etapas de compras (responsável do administrativo; sem ele, o Administrador)
  if v_admin or v_uid is not distinct from kontrol_private.responsavel_compras('administrativo') then
    -- formalizar e autorizar (fonte e rubrica)
    with fila as (
      select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo, p.atualizado_em as desde
        from public.pedidos_internos p
       where p.status in ('formalizado', 'analise_administrativa')
          or (p.status = 'validado'
              and (coalesce(p.natureza, '') <> 'material_consumo_lab' or p.aprovacao_area_em is not null)
              -- 0176: pedido do ciclo seguinte aparece quando o ciclo dele abrir
              and kontrol_private.ciclo_libera_em(p.ciclo_pagamento, p.urgencia, p.urgencia_justificativa) is null)
    )
    select (select count(*) from fila),
           coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                       from (select id, rotulo from fila order by desde limit 3) s), '[]'::jsonb)
      into v_qtd, v_itens;
    if v_qtd > 0 then
      v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_administrativo', 'quantidade', v_qtd, 'itens', v_itens));
    end if;
    -- 3 orçamentos, aprovação final e fechamento da compra
    with fila as (
      select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo, p.atualizado_em as desde
        from public.pedidos_internos p
       where p.status in ('aprovado_compra', 'orcamentos', 'orcamentos_recebidos', 'aguardando_aprovacao_final', 'aprovado_para_compra')
    )
    select (select count(*) from fila),
           coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                       from (select id, rotulo from fila order by desde limit 3) s), '[]'::jsonb)
      into v_qtd, v_itens;
    if v_qtd > 0 then
      v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_compras', 'quantidade', v_qtd, 'itens', v_itens));
    end if;
  end if;
  if v_admin or v_uid is not distinct from kontrol_private.responsavel_compras('pagamento') then
    with prontos as (
      select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo, p.atualizado_em as desde
        from public.pedidos_internos p
       where p.status = 'aguardando_pagamento_nf'
          or (p.status in ('compra_fechada', 'encaminhado_instituicao') and kontrol_private.pendencia_pagamento(p.id) is null)
    )
    select (select count(*) from prontos),
           coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                       from (select id, rotulo from prontos order by desde limit 3) s), '[]'::jsonb)
      into v_qtd, v_itens;
    if v_qtd > 0 then
      v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_pagamento', 'quantidade', v_qtd, 'itens', v_itens));
    end if;
  end if;

  if kontrol_private.tem_permissao_efetiva('compras.aprovar') then
    -- 0173: compra ligada a pedido interno é aprovada junto com ele (0170)
    with soltas as (
      select pc.id, 'Compra #' || pc.id || coalesce(' · ' || nullif(pc.projeto, ''), '') as rotulo, pc.criado_em
        from public.pedidos_compra pc
       where pc.status = 'solicitado'
         and coalesce(pc.observacao, '') not like 'Formalizado a partir do pedido interno #%'
         and not exists (select 1 from public.pedidos_internos pi where pi.pedido_compra_id = pc.id)
    )
    select (select count(*) from soltas),
           coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                       from (select id, rotulo from soltas order by criado_em limit 3) s), '[]'::jsonb)
      into v_qtd, v_itens;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'compras_aprovar', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  if kontrol_private.tem_permissao_efetiva('compras.receber') then
    select count(*) into v_qtd from public.pedidos_compra where status in ('aprovado', 'enviado', 'em_transito');
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo)), '[]'::jsonb) into v_itens
    from (
      select id, 'Compra #' || id || coalesce(' · ' || nullif(projeto, ''), '') as rotulo
      from public.pedidos_compra where status in ('aprovado', 'enviado', 'em_transito')
      order by criado_em limit 3
    ) s;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'compras_receber', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  if kontrol_private.tem_permissao_efetiva('orcamentos.emitir') then
    with prontas as (
      select d.id, coalesce(d.titulo, 'Proposta #' || d.id) as rotulo, d.criado_em
      from public.demandas_propostas d
      where d.status in ('nova', 'em_analise')
        and (
          exists (select 1 from public.orcamentos o where o.demanda_id = d.id and o.status_operacional = 'revisado')
          or exists (select 1 from public.orcamento_projetos p where p.demanda_id = d.id and p.status = 'enviado')
        )
        and not exists (
          select 1 from public.orcamento_final_versoes f
          where f.demanda_id = d.id and f.status not in ('cancelado', 'substituido')
        )
    )
    select (select count(*) from prontas),
      coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
        from (select id, rotulo from prontas order by criado_em limit 3) s), '[]'::jsonb)
    into v_qtd, v_itens;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'propostas_emitir', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  if kontrol_private.tem_permissao_efetiva('planejamento.editar') then
    select count(*) into v_qtd from public.planejamento where coalesce(status_operacional, 'rascunho') = 'rascunho';
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo)), '[]'::jsonb) into v_itens
    from (
      select id, coalesce(nome, 'Plano #' || id) as rotulo
      from public.planejamento where coalesce(status_operacional, 'rascunho') = 'rascunho'
      order by coalesce(data_alvo, criado_em::date), id limit 3
    ) s;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'planos_rascunho', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  return v_saida;
end $function$;

revoke all on function public.aguardando_voce() from public, anon;
grant execute on function public.aguardando_voce() to authenticated;

-- ---- 6. Situação no dia da aplicação ----------------------------------------------------
do $$
declare
  v_n integer;
begin
  select count(*) into v_n
    from public.pedidos_internos p
   where p.status = 'validado'
     and kontrol_private.ciclo_libera_em(p.ciclo_pagamento, p.urgencia, p.urgencia_justificativa) is not null;
  raise notice '0176: % pedido(s) validado(s) aguardam o ciclo seguinte', v_n;
end $$;

notify pgrst, 'reload schema';

commit;
