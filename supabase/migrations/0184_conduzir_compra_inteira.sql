-- 0184 — Caixinha "Conduzir a compra inteira" (compras.conduzir) e função
-- Compra com todas as caixinhas de Compras.
--
-- Pedido de Antonio em 24/11/2026 (thread "Corrigir importação da planilha de
-- insumos"): quem tem a permissão de compras tem de conseguir executar todas
-- as etapas da compra, sem parar na etapa 3 (Administrativo). Escolha dele no
-- cartão: "Executa todas as etapas" (não só acompanhar), pelo menos na fase
-- de ajustes e testes; depois pode mudar (é só desmarcar a caixinha).
--
-- Antes, mesmo com todas as caixinhas, quatro regras de pessoa paravam o
-- pedido: a aprovação do coordenador do projeto, a da coordenação do
-- laboratório, a aprovação do próprio pedido (D2, 0136) e a trava do ciclo
-- seguinte (0176/0177, etapa 3). O Administrador substituía nas três primeiras.
--
-- O que muda:
--   * caixinha nova compras.conduzir ("Conduzir a compra inteira"): quem a tem
--     age como substituto em cada etapa, como o Administrador: envia pedido de
--     projeto sem coordenador indicado, aprova no lugar do coordenador do
--     projeto e da coordenação do laboratório, dá a aprovação final do próprio
--     pedido e segue para compras antes do ciclo do dia 10 abrir (fica na
--     linha do tempo do pedido). O Administrador tem todas as caixinhas, então
--     também deixa de parar na trava do ciclo;
--   * a função Compra passa a ter todas as caixinhas de Compras, mais
--     "Conduzir a compra inteira". Até aqui ela parava na formalização (sem
--     "Aprovar pedidos").
--
-- O que não muda: as caixinhas de cada etapa continuam valendo; quem aprova
-- continua gravado com nome e função; quem não tem a caixinha segue as regras
-- de antes; ajustes por pessoa (Usuários) continuam valendo sobre a função.
--
-- Só acrescenta: uma função, a recriação de quatro funções (mesmo corpo, com a
-- caixinha nova nos pontos de substituição) e caixinhas da função Compra que
-- ainda não estavam marcadas. Não apaga dado, coluna, RLS nem auditoria.
--
-- Rollback:
--   reaplicar kontrol_private.exigir_competencia_pedido() e
--     public.decidir_coordenacao_laboratorio(bigint, text, text) da 0169,
--     kontrol_private.travar_ciclo_seguinte() da 0177 e
--     kontrol_private.pode_decidir_proprio_pedido(text, bigint) da 0136;
--   drop function kontrol_private.conduz_compra();
--   update public.permissoes_categorias set permissoes = permissoes - 'compras.conduzir'
--     where papel = 'compra';
--   (as outras caixinhas da Compra: voltar pelo relatório de impacto do ensaio)

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regprocedure('public.definir_urgencia_pedido_interno(bigint,text,text)') is null then
    raise exception '0184: requer a migration 0183';
  end if;
  if to_regprocedure('kontrol_private.travar_ciclo_seguinte()') is null
     or to_regprocedure('kontrol_private.exigir_competencia_pedido()') is null
     or to_regprocedure('kontrol_private.pode_decidir_proprio_pedido(text,bigint)') is null then
    raise exception '0184: requer as migrations 0136, 0169 e 0177';
  end if;
end $$;

-- ---- 1. Quem conduz a compra inteira ------------------------------------------------
-- A caixinha (o Administrador tem todas). Usada nos pontos em que antes só o
-- Administrador substituía.
create or replace function kontrol_private.conduz_compra()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(kontrol_private.tem_permissao_efetiva('compras.conduzir'), false)
$function$;

revoke all on function kontrol_private.conduz_compra() from public, anon;
grant execute on function kontrol_private.conduz_compra() to authenticated, service_role;

-- ---- 2. Função Compra: todas as caixinhas de Compras --------------------------------
-- Relatório de impacto: o que a função Compra tinha antes, para o rollback.
do $$
begin
  raise notice '0184: caixinhas da função Compra antes: %',
    coalesce((select permissoes::text from public.permissoes_categorias where papel = 'compra'), '(sem linha)');
  raise notice '0184: pessoas ativas com a função Compra: %',
    coalesce((select string_agg(coalesce(nome, email), ', ' order by coalesce(nome, email))
                from public.perfis where papel = 'compra' and not coalesce(suspenso, false)), 'nenhuma');
end $$;

insert into public.permissoes_categorias (papel, permissoes)
values ('compra', '{}'::jsonb)
on conflict (papel) do nothing;

update public.permissoes_categorias
   set permissoes = coalesce(permissoes, '{}'::jsonb) || (
     select jsonb_object_agg(k, true)
       from unnest(array[
         'pedido.ver', 'pedido.criar', 'pedido.aprovar', 'pedido.urgencia',
         'compras.ver', 'compras.solicitar', 'compras.aprovar', 'compras.receber', 'compras.cancelar',
         'compras.conduzir',
         'recebimento.ver', 'recebimento.registrar'
       ]::text[]) as k)
 where papel = 'compra';

-- ---- 3. Os pontos de substituição passam a aceitar a caixinha ----------------------
-- 3a. Envio e aprovação do coordenador (gatilho da 0169)
create or replace function kontrol_private.exigir_competencia_pedido()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_ap jsonb;
begin
  if current_user = 'authenticated' and (
       new.aprovacao_area_em is distinct from old.aprovacao_area_em
       or new.aprovacao_area_por is distinct from old.aprovacao_area_por) then
    raise exception 'A aprovação da coordenação do laboratório só é registrada pelo botão do pedido.'
      using errcode = '42501';
  end if;

  if current_user = 'authenticated'
     and old.status not in ('rascunho', 'ajuste_solicitante', 'ajuste_compras')
     and (new.area_id is distinct from old.area_id
          or new.natureza is distinct from old.natureza
          or new.projeto_id is distinct from old.projeto_id) then
    raise exception 'Projeto, tipo de material e laboratório só mudam com o pedido em rascunho ou devolvido para ajuste.'
      using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Envio para validação: precisa haver quem valide (e, para material de
  -- consumo de laboratório, quem aprove pelo laboratório).
  if new.status = 'em_validacao' then
    -- 0184: quem conduz a compra inteira envia mesmo sem coordenador indicado
    -- (ele próprio aprova como substituto)
    if v_uid is not null and not kontrol_private.conduz_compra() then
      v_ap := kontrol_private.aprovadores_pedido(new.projeto_id, new.natureza, new.area_id);
      if v_ap ->> 'falta_coordenador' is not null then
        raise exception '%', v_ap ->> 'falta_coordenador' using errcode = '22023';
      end if;
      if v_ap ->> 'falta_laboratorio' is not null then
        raise exception '%', v_ap ->> 'falta_laboratorio' using errcode = '22023';
      end if;
    end if;
    -- cada envio pede a aprovação do laboratório de novo
    new.aprovacao_area_em := null;
    new.aprovacao_area_por := null;
    return new;
  end if;

  -- Validação: só o coordenador competente; como substituto, o Administrador
  -- ou quem tem "Conduzir a compra inteira" (0184).
  if old.status = 'em_validacao' and new.status = 'validado' and v_uid is not null then
    v_ap := kontrol_private.aprovadores_pedido(new.projeto_id, new.natureza, new.area_id);
    -- sem coordenador indicado, só o Administrador ou quem conduz a compra inteira
    if v_ap ->> 'falta_coordenador' is not null and not kontrol_private.conduz_compra() then
      raise exception '%', v_ap ->> 'falta_coordenador' using errcode = '42501';
    end if;
    if not kontrol_private.conduz_compra()
       and not coalesce((v_ap -> 'coordenador' -> 'ids') ? v_uid::text, false) then
      raise exception 'Este pedido é validado por % (%). Na ausência, o Administrador ou quem tem "Conduzir a compra inteira" valida como substituto.',
        coalesce(v_ap -> 'coordenador' ->> 'nome', 'quem coordena'),
        coalesce(v_ap -> 'coordenador' ->> 'rotulo', 'coordenador competente')
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Material de consumo de laboratório não segue para compras sem a
  -- coordenação do laboratório.
  if old.status = 'validado'
     and new.status not in ('ajuste_solicitante', 'cancelado')
     and coalesce(new.natureza, '') = 'material_consumo_lab'
     and new.aprovacao_area_em is null then
    raise exception 'Material de consumo de laboratório precisa da aprovação da coordenação do laboratório antes de seguir para compras.'
      using errcode = '42501';
  end if;

  return new;
end $function$;

-- 3b. Coordenação do laboratório (0169)
create or replace function public.decidir_coordenacao_laboratorio(
  p_pedido_id bigint,
  p_decisao text,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_papel text := public.current_papel();
  v_status text;
  v_natureza text;
  v_area_id bigint;
  v_projeto_id bigint;
  v_aprovado_em timestamptz;
  v_ap jsonb;
  v_obs text := nullif(btrim(coalesce(p_observacao, '')), '');
begin
  if v_uid is null then
    raise exception 'Entre no Kontrol para registrar a decisão.' using errcode = '42501';
  end if;
  begin
    v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_email := null;
  end;
  if p_decisao is null or p_decisao not in ('aprovado', 'devolvido') then
    raise exception 'Decisão inválida: use aprovar ou devolver.' using errcode = '22023';
  end if;

  select pi.status, pi.natureza, pi.area_id, pi.projeto_id, pi.aprovacao_area_em
    into v_status, v_natureza, v_area_id, v_projeto_id, v_aprovado_em
    from public.pedidos_internos pi
   where pi.id = p_pedido_id
   for update;
  if not found then
    raise exception 'Pedido interno não encontrado.' using errcode = 'P0002';
  end if;
  if v_status <> 'validado' or coalesce(v_natureza, '') <> 'material_consumo_lab' then
    raise exception 'Este pedido não está aguardando a coordenação do laboratório.' using errcode = '22023';
  end if;
  if v_aprovado_em is not null then
    raise exception 'A coordenação do laboratório já aprovou este pedido.' using errcode = '22023';
  end if;

  v_ap := kontrol_private.aprovadores_pedido(v_projeto_id, v_natureza, v_area_id);
  if v_ap ->> 'falta_laboratorio' is not null and not kontrol_private.conduz_compra() then
    raise exception '%', v_ap ->> 'falta_laboratorio' using errcode = '22023';
  end if;
  if not kontrol_private.conduz_compra()
     and not coalesce((v_ap -> 'laboratorio' -> 'ids') ? v_uid::text, false) then
    raise exception 'Esta etapa é da coordenação do laboratório % (%). Na ausência, o substituto cadastrado, o Administrador ou quem tem "Conduzir a compra inteira" decide.',
      coalesce(v_ap -> 'laboratorio' ->> 'area', ''), coalesce(v_ap -> 'laboratorio' ->> 'nome', 'sem coordenador')
      using errcode = '42501';
  end if;
  if p_decisao = 'devolvido' and v_obs is null then
    raise exception 'Escreva o motivo da devolução.' using errcode = '22023';
  end if;

  if p_decisao = 'aprovado' then
    update public.pedidos_internos
       set aprovacao_area_em = now(), aprovacao_area_por = coalesce(v_email, v_uid::text)
     where id = p_pedido_id;
    insert into public.pedidos_internos_aprovacoes (
      pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino)
    values (p_pedido_id, 'Aprovação da coordenação do laboratório', 'aprovado', v_email, v_papel, v_obs,
            'validado', 'validado');
  else
    perform set_config('app.pedido_interno_transicao', 'permitida', true);
    update public.pedidos_internos set status = 'ajuste_solicitante' where id = p_pedido_id;
    perform set_config('app.pedido_interno_transicao', '', true);
    insert into public.pedidos_internos_aprovacoes (
      pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino)
    values (p_pedido_id, 'Aprovação da coordenação do laboratório', 'devolvido', v_email, v_papel, v_obs,
            'validado', 'ajuste_solicitante');
    insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
    values ('pedido_interno', p_pedido_id, 'validado', 'ajuste_solicitante', v_email, v_obs);
  end if;

  return jsonb_build_object('pedido_id', p_pedido_id, 'decisao', p_decisao);
end $function$;

-- 3c. Trava do ciclo seguinte (0177)
create or replace function kontrol_private.travar_ciclo_seguinte()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_libera date;
  v_email text;
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
  -- 0184: quem conduz a compra inteira segue antes do ciclo abrir; fica na
  -- linha do tempo do pedido
  if v_libera is not null and auth.uid() is not null and kontrol_private.conduz_compra() then
    begin
      v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
    exception when others then
      v_email := null;
    end;
    insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
    values ('pedido_interno', new.id, null, old.status, v_email,
            format('Seguiu para compras antes do ciclo de %s abrir (%s), por quem conduz a compra inteira.',
                   kontrol_private.rotulo_ciclo(v_libera), to_char(v_libera, 'DD/MM/YYYY')));
    return new;
  end if;
  if v_libera is not null then
    raise exception 'Este pedido entrou no ciclo de compras de % porque foi aprovado depois do prazo do dia 10. Ele segue para compras a partir de %. Só pedido urgente, com justificativa, ou quem tem "Conduzir a compra inteira" fura o ciclo.',
      kontrol_private.rotulo_ciclo(v_libera), to_char(v_libera, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  return new;
end $function$;

-- 3d. Aprovação do próprio pedido (D2, 0136)
create or replace function kontrol_private.pode_decidir_proprio_pedido(p_solicitante text, p_projeto_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select lower(btrim(coalesce(p_solicitante, ''))) is distinct from lower(coalesce(auth.jwt() ->> 'email', '-'))
      or public.current_papel() = 'admin'
      or kontrol_private.conduz_compra()
      or exists (
           select 1 from public.projetos pr
            where pr.id = p_projeto_id and pr.coordenador_id = auth.uid());
$function$;

revoke all on function kontrol_private.exigir_competencia_pedido() from public, anon;
revoke all on function public.decidir_coordenacao_laboratorio(bigint, text, text) from public, anon;
grant execute on function public.decidir_coordenacao_laboratorio(bigint, text, text) to authenticated;
revoke all on function kontrol_private.travar_ciclo_seguinte() from public, anon;
revoke all on function kontrol_private.pode_decidir_proprio_pedido(text, bigint) from public, anon, authenticated;

commit;
