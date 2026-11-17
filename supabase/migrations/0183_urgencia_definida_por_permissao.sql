-- 0183 — A urgência do pedido é definida só por quem tem a permissão
-- (relatório de ajustes de Compras de 17/11/2026, ajuste 2, pedido por Antonio).
--
-- Quem pede escolhia a urgência no formulário, e a urgência fura o ciclo de
-- compras do dia 10. Quem solicita pode considerar urgente o que não é; a
-- decisão passa a ser de quem tem a permissão nova "Definir urgência do pedido"
-- (pedido.urgencia), que nasce marcada para a função Administrativo. O
-- Administrador tem todas as permissões. Nome de pessoa não entra no banco:
-- quem recebe a permissão é escolhido em Usuários.
--
-- O que muda:
--   * pedido criado direto pela tela nasce Normal e sem justificativa de
--     urgência; o banco recusa outra coisa vinda de quem usa o app;
--   * urgência e justificativa só mudam pela função nova
--     definir_urgencia_pedido_interno, que exige a permissão, pede
--     justificativa para Alta ou Crítica, grava quem definiu e quando e
--     registra o evento na linha do tempo;
--   * em pedido que espera o ciclo (situação "validado"), marcar a urgência
--     traz o pedido para o ciclo do mês corrente; tirar a urgência devolve o
--     pedido ao ciclo da data da aprovação. Depois de formalizado, o ciclo
--     gravado é histórico e não muda.
--
-- O que não muda:
--   * pedido criado pelo sistema continua nascendo urgente: a reposição de
--     insumo crítico (justificada desde a 0172) e o pedido gerado pelo
--     planejamento sem saldo, que agora também nasce com a justificativa
--     escrita (antes quem pedia tinha de escrevê-la). Quem tem a permissão
--     pode baixar a urgência;
--   * as regras do ciclo (0172), a trava do ciclo seguinte (0176/0177) e a
--     exigência de justificativa no envio continuam como estão.
--
-- Só acrescenta: duas colunas que aceitam vazio, uma função de gatilho, um
-- gatilho, uma função pública e a marcação da permissão na função
-- Administrativo. Não mexe em função, gatilho, RLS nem dado existente, e não
-- acerta pedidos antigos: o rascunho que já estava urgente continua urgente
-- até alguém com a permissão decidir.
--
-- Rollback:
--   drop function public.definir_urgencia_pedido_interno(bigint, text, text);
--   drop trigger pedidos_internos_proteger_urgencia on public.pedidos_internos;
--   drop function kontrol_private.proteger_urgencia_pedido();
--   update public.permissoes_categorias set permissoes = permissoes - 'pedido.urgencia'
--    where papel = 'administrativo';
--   (só depois de exportar, se houver dados) alter table public.pedidos_internos
--     drop column urgencia_definida_por, drop column urgencia_definida_em.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regprocedure('kontrol_private.definir_ciclo_pagamento()') is null then
    raise exception '0183: requer a migration 0172';
  end if;
  if to_regprocedure('kontrol_private.travar_ciclo_seguinte()') is null then
    raise exception '0183: requer a migration 0176';
  end if;
  if not exists (select 1 from public.permissoes_categorias where papel = 'administrativo') then
    raise exception '0183: requer a migration 0180';
  end if;
end $$;

-- ---- 1. Quem definiu a urgência e quando ------------------------------------------
alter table public.pedidos_internos
  add column if not exists urgencia_definida_por text,
  add column if not exists urgencia_definida_em timestamptz;

comment on column public.pedidos_internos.urgencia_definida_por is
  '0183: e-mail de quem definiu a urgência pela função definir_urgencia_pedido_interno. Vazio: urgência de nascimento (Normal, ou a do pedido criado pelo sistema).';
comment on column public.pedidos_internos.urgencia_definida_em is
  '0183: quando a urgência foi definida pela função definir_urgencia_pedido_interno.';

-- ---- 2. Permissão nova, marcada para o Administrativo ---------------------------------
update public.permissoes_categorias
   set permissoes = coalesce(permissoes, '{}'::jsonb) || '{"pedido.urgencia": true}'::jsonb
 where papel = 'administrativo'
   and not (coalesce(permissoes, '{}'::jsonb) ? 'pedido.urgencia');

-- ---- 3. Gatilho: quem usa o app não escreve urgência direto na tabela -----------------
-- SECURITY INVOKER de propósito: current_user = 'authenticated' identifica a
-- gravação direta pela API (dentro das RPCs, current_user é o dono). O nome do
-- gatilho o coloca depois de pedidos_internos_definir_ciclo (0172, que
-- justifica a reposição de insumo crítico) e antes de
-- pedidos_internos_travar_ciclo (0177), cuja regra antiga de urgência deixa de
-- ser alcançada por quem usa o app.
create or replace function kontrol_private.proteger_urgencia_pedido()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' then
      if coalesce(new.urgencia, 'normal') <> 'normal'
         or nullif(btrim(coalesce(new.urgencia_justificativa, '')), '') is not null then
        raise exception 'A urgência do pedido é definida por quem tem a permissão "Definir urgência do pedido", não por quem pede. Crie o pedido sem urgência.'
          using errcode = '42501';
      end if;
      new.urgencia_definida_por := null;
      new.urgencia_definida_em := null;
      return new;
    end if;
    -- pedido gerado pelo planejamento sem saldo nasce urgente: fica justificado,
    -- porque quem pede não escreve mais a justificativa da urgência
    if coalesce(new.urgencia, 'normal') in ('alta', 'critica')
       and nullif(btrim(coalesce(new.urgencia_justificativa, '')), '') is null
       and new.planejamento_id is not null then
      new.urgencia_justificativa := 'Falta de saldo para iniciar o planejamento (pedido gerado pelo planejamento).';
    end if;
    return new;
  end if;

  if current_user = 'authenticated'
     and (coalesce(new.urgencia, 'normal') is distinct from coalesce(old.urgencia, 'normal')
          or nullif(btrim(coalesce(new.urgencia_justificativa, '')), '')
             is distinct from nullif(btrim(coalesce(old.urgencia_justificativa, '')), '')
          or new.urgencia_definida_por is distinct from old.urgencia_definida_por
          or new.urgencia_definida_em is distinct from old.urgencia_definida_em) then
    raise exception 'A urgência do pedido é definida por quem tem a permissão "Definir urgência do pedido", pelo botão "Definir urgência" do pedido.'
      using errcode = '42501';
  end if;
  return new;
end $function$;

revoke all on function kontrol_private.proteger_urgencia_pedido() from public, anon;

comment on function kontrol_private.proteger_urgencia_pedido() is
  '0183: urgência e justificativa de urgência do pedido interno não são gravadas direto por quem usa o app; só pela função definir_urgencia_pedido_interno.';

drop trigger if exists pedidos_internos_proteger_urgencia on public.pedidos_internos;
create trigger pedidos_internos_proteger_urgencia
  before insert or update on public.pedidos_internos
  for each row execute function kontrol_private.proteger_urgencia_pedido();

-- ---- 4. Definir a urgência ---------------------------------------------------------------
create or replace function public.definir_urgencia_pedido_interno(
  p_pedido_id bigint,
  p_urgencia text,
  p_justificativa text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text;
  v_urgencia text := lower(btrim(coalesce(p_urgencia, '')));
  v_justificativa text := nullif(btrim(coalesce(p_justificativa, '')), '');
  v_urgente boolean;
  v_era_urgente boolean;
  v_p record;
  v_aprovado_em timestamptz;
  v_ciclo date;
  v_rotulo constant jsonb := '{"baixa": "Baixa", "normal": "Normal", "alta": "Alta", "critica": "Crítica"}'::jsonb;
begin
  perform kontrol_private.exigir_permissao('pedido.urgencia');
  begin
    v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_email := null;
  end;

  if v_urgencia not in ('baixa', 'normal', 'alta', 'critica') then
    raise exception 'Urgência inválida: use Baixa, Normal, Alta ou Crítica.' using errcode = '22023';
  end if;
  v_urgente := v_urgencia in ('alta', 'critica');
  if v_urgente and char_length(coalesce(v_justificativa, '')) < 15 then
    raise exception 'Pedido urgente fura o ciclo do dia 10 e precisa de justificativa: escreva por que não pode esperar o próximo ciclo.'
      using errcode = '22023';
  end if;
  if char_length(coalesce(v_justificativa, '')) > 1000 then
    raise exception 'A justificativa da urgência tem no máximo 1.000 caracteres.' using errcode = '22023';
  end if;
  -- sem urgência não há o que justificar
  if not v_urgente then
    v_justificativa := null;
  end if;

  select p.status, p.urgencia, p.urgencia_justificativa, p.ciclo_pagamento, p.validado_em, p.aprovacao_area_em
    into v_p
    from public.pedidos_internos p
   where p.id = p_pedido_id
   for update;
  if not found then
    raise exception 'Pedido interno não encontrado.' using errcode = 'P0002';
  end if;
  if v_p.status in ('compra_concluida', 'cancelado') then
    raise exception 'Pedido concluído ou cancelado não muda de urgência.' using errcode = '22023';
  end if;

  v_era_urgente := coalesce(v_p.urgencia, 'normal') in ('alta', 'critica');
  if coalesce(v_p.urgencia, 'normal') = v_urgencia
     and nullif(btrim(coalesce(v_p.urgencia_justificativa, '')), '') is not distinct from v_justificativa then
    return jsonb_build_object('pedido_id', p_pedido_id, 'urgencia', v_urgencia, 'alterado', false,
                              'ciclo', v_p.ciclo_pagamento);
  end if;

  -- O ciclo só é refeito enquanto o pedido espera em "validado": é ali que a
  -- trava do ciclo seguinte vale. Depois de formalizado, o ciclo é histórico.
  v_ciclo := v_p.ciclo_pagamento;
  if v_p.status = 'validado' and v_p.ciclo_pagamento is not null and v_urgente is distinct from v_era_urgente then
    if v_urgente then
      v_ciclo := kontrol_private.ciclo_para(now(), true);
    else
      select greatest(
               coalesce(v_p.validado_em,
                        (select max(ap.criado_em)
                           from public.pedidos_internos_aprovacoes ap
                          where ap.pedido_interno_id = p_pedido_id and ap.status_destino = 'validado')),
               v_p.aprovacao_area_em)
        into v_aprovado_em;
      if v_aprovado_em is not null then
        v_ciclo := kontrol_private.ciclo_para(v_aprovado_em, false);
      end if;
    end if;
  end if;

  update public.pedidos_internos
     set urgencia = v_urgencia,
         urgencia_justificativa = v_justificativa,
         urgencia_definida_por = v_email,
         urgencia_definida_em = now(),
         ciclo_pagamento = v_ciclo
   where id = p_pedido_id;

  insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('pedido_interno', p_pedido_id, null, v_p.status, v_email,
          'Urgência: ' || coalesce(v_rotulo ->> coalesce(v_p.urgencia, 'normal'), v_p.urgencia)
            || ' → ' || (v_rotulo ->> v_urgencia)
            || coalesce('. Motivo: ' || v_justificativa, '.'));

  return jsonb_build_object('pedido_id', p_pedido_id, 'urgencia', v_urgencia, 'alterado', true,
                            'ciclo', v_ciclo);
end $function$;

revoke all on function public.definir_urgencia_pedido_interno(bigint, text, text) from public, anon;
grant execute on function public.definir_urgencia_pedido_interno(bigint, text, text) to authenticated, service_role;

comment on function public.definir_urgencia_pedido_interno(bigint, text, text) is
  '0183: define a urgência do pedido interno. Exige a permissão pedido.urgencia; Alta ou Crítica pedem justificativa de ao menos 15 caracteres; grava quem definiu, quando e o evento na linha do tempo.';

notify pgrst, 'reload schema';

commit;
